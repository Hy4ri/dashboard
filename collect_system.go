package main

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"syscall"
)

func readFileString(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func readDirNames(path string) ([]string, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names, nil
}

// --- Init Static Information ---

func initStaticData() {
	hostname, _ := os.Hostname()
	var hostPtr *string
	if hostname != "" {
		hostPtr = &hostname
	}
	staticSystem = SystemData{Hostname: hostPtr}

	// Thermal zone names are stable at boot, so resolve their paths once.
	wantedZones := make(map[string]bool, len(cfg.ThermalZones))
	for _, name := range cfg.ThermalZones {
		wantedZones[name] = true
	}
	if zones, err := readDirNames("/sys/class/thermal"); err == nil {
		for _, z := range zones {
			if !strings.HasPrefix(z, "thermal_zone") {
				continue
			}
			if typeStr, err := readFileString(fmt.Sprintf("/sys/class/thermal/%s/type", z)); err == nil {
				name := strings.TrimSpace(typeStr)
				if wantedZones[name] {
					thermalPaths = append(thermalPaths, ThermalPathItem{
						Name: name,
						Path: fmt.Sprintf("/sys/class/thermal/%s/temp", z),
					})
				}
			}
		}
	}
}

// --- Collectors ---

func collectCPU(statText string, interval float64) (*float64, []*float64) {
	currOverall := &ProcStatCpu{}
	currCores := make(map[string]ProcStatCpu)

	for _, line := range strings.Split(statText, "\n") {
		if !strings.HasPrefix(line, "cpu") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		name := fields[0]
		var nums []float64
		for _, f := range fields[1:] {
			if n, err := strconv.ParseFloat(f, 64); err == nil {
				nums = append(nums, n)
			}
		}
		if len(nums) < 4 {
			continue
		}
		total := 0.0
		for i, v := range nums {
			if i < 8 {
				total += v
			} // guest counters are already included in user/nice
		}
		idle := nums[3]
		if len(nums) > 4 {
			idle += nums[4]
		}
		if name == "cpu" {
			currOverall = &ProcStatCpu{Total: total, Idle: idle}
		} else {
			currCores[name] = ProcStatCpu{Total: total, Idle: idle}
		}
	}

	computePct := func(prev, curr ProcStatCpu) *float64 {
		dT := curr.Total - prev.Total
		dI := curr.Idle - prev.Idle
		if dT <= 0 {
			v := 0.0
			return &v
		}
		pct := math.Round(((dT-dI)/dT)*1000) / 10
		return &pct
	}

	var overallPct *float64
	var coresPct []*float64

	if prevState.CPUOverall != nil && currOverall != nil {
		overallPct = computePct(*prevState.CPUOverall, *currOverall)
		// Cores in order cpu0, cpu1...
		for i := 0; ; i++ {
			cName := fmt.Sprintf("cpu%d", i)
			cCurr, ok := currCores[cName]
			if !ok {
				break
			}
			if cPrev, okPrev := prevState.CPUCores[cName]; okPrev {
				coresPct = append(coresPct, computePct(cPrev, cCurr))
			} else {
				coresPct = append(coresPct, nil)
			}
		}
	}

	prevState.CPUOverall = currOverall
	prevState.CPUCores = currCores
	return overallPct, coresPct
}

func parseMemInfo(text string) *MemoryData {
	res := make(map[string]uint64)
	for _, line := range strings.Split(text, "\n") {
		idx := strings.Index(line, ":")
		if idx < 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		valStr := strings.TrimSpace(line[idx+1:])
		valFields := strings.Fields(valStr)
		if len(valFields) > 0 {
			if n, err := strconv.ParseUint(valFields[0], 10, 64); err == nil {
				res[key] = n * 1024 // kB -> bytes
			}
		}
	}
	memTotal := res["MemTotal"]
	memAvail := res["MemAvailable"]
	used := uint64(0)
	if memTotal > memAvail {
		used = memTotal - memAvail
	}
	usedPct := 0.0
	if memTotal > 0 {
		usedPct = math.Round((float64(used)/float64(memTotal))*1000) / 10
	}
	var swapTotal, swapFree *uint64
	if st, ok := res["SwapTotal"]; ok {
		swapTotal = &st
	}
	if sf, ok := res["SwapFree"]; ok {
		swapFree = &sf
	}

	return &MemoryData{
		MemTotal:     memTotal,
		MemFree:      res["MemFree"],
		MemAvailable: memAvail,
		Buffers:      res["Buffers"],
		Cached:       res["Cached"],
		SwapTotal:    swapTotal,
		SwapFree:     swapFree,
		UsedPct:      usedPct,
	}
}

func collectNetwork(netText string, interval float64) map[string]NetworkInterface {
	currNet := make(map[string][2]int64)
	wanted := make(map[string]bool, len(cfg.NetIfaces))
	for _, name := range cfg.NetIfaces {
		wanted[name] = true
	}
	for _, line := range strings.Split(netText, "\n") {
		colon := strings.Index(line, ":")
		if colon < 0 {
			continue
		}
		name := strings.TrimSpace(line[:colon])
		if !wanted[name] {
			continue
		}
		fields := strings.Fields(line[colon+1:])
		if len(fields) < 9 {
			continue
		}
		rx, errRx := strconv.ParseInt(fields[0], 10, 64)
		tx, errTx := strconv.ParseInt(fields[8], 10, 64)
		if errRx != nil || errTx != nil {
			continue
		}
		currNet[name] = [2]int64{rx, tx}
	}

	res := make(map[string]NetworkInterface)
	for _, iface := range cfg.NetIfaces {
		cur, ok := currNet[iface]
		if !ok {
			continue
		}
		item := NetworkInterface{
			RxBytes: cur[0],
			TxBytes: cur[1],
		}
		if prevState.Net != nil && interval > 0 {
			if prev, okPrev := prevState.Net[iface]; okPrev {
				item.RxRate = byteRate(cur[0], prev[0], interval)
				item.TxRate = byteRate(cur[1], prev[1], interval)
			}
		}
		res[iface] = item
	}
	prevState.Net = currNet
	return res
}

// byteRate returns bytes per second between two counter readings. A counter
// that went backwards means the interface or the counter reset, so the rate is
// zero, never negative.
func byteRate(cur, prev int64, interval float64) float64 {
	if interval <= 0 || cur < prev {
		return 0
	}
	return math.Round(float64(cur-prev) / interval)
}

func collectThermal() []ThermalSensor {
	return thermalCache.Get(func() ([]ThermalSensor, bool) {
		var res []ThermalSensor
		for _, tp := range thermalPaths {
			if raw, err := readFileString(tp.Path); err == nil {
				if v, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil {
					res = append(res, ThermalSensor{
						Name: tp.Name,
						Temp: float64(v) / 1000.0,
					})
				}
			}
		}
		return res, true
	})
}

func collectDiskUsage() *DiskUsage {
	return diskCache.Get(func() (*DiskUsage, bool) {
		var stat syscall.Statfs_t
		if err := syscall.Statfs("/", &stat); err == nil {
			bsize := uint64(stat.Bsize)
			total := stat.Blocks * bsize
			avail := stat.Bavail * bsize
			used := total - stat.Bfree*bsize
			usedPct := 0.0
			if total > 0 {
				usedPct = math.Round((float64(used)/float64(total))*1000) / 10
			}
			val := &DiskUsage{
				Total:     total,
				Used:      used,
				Available: avail,
				UsedPct:   usedPct,
			}
			return val, true
		}
		return nil, true
	})
}

func collectBattery() *BatteryData {
	base := "/sys/class/power_supply/battery"
	var capPtr *int
	var statusPtr *string

	if str, err := readFileString(base + "/capacity"); err == nil {
		if v, err := strconv.Atoi(strings.TrimSpace(str)); err == nil {
			capPtr = &v
		}
	}
	if str, err := readFileString(base + "/status"); err == nil {
		s := strings.TrimSpace(str)
		statusPtr = &s
	}
	return &BatteryData{
		Capacity: capPtr,
		Status:   statusPtr,
	}
}

func collectSystem() *SystemData {
	return &SystemData{Hostname: staticSystem.Hostname}
}
