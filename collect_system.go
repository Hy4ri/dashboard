package main

import (
	"fmt"
	"math"
	"os"
	"os/exec"
	"regexp"
	"sort"
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
	// 1. Static System
	upt := ""
	if b, err := os.ReadFile("/etc/os-release"); err == nil {
		re := regexp.MustCompile(`PRETTY_NAME="(.+)"`)
		if m := re.FindStringSubmatch(string(b)); len(m) > 1 {
			upt = m[1]
		}
	}
	var osName *string
	if upt != "" {
		osName = &upt
	}

	hostname, _ := os.Hostname()
	var hostPtr *string
	if hostname != "" {
		hostPtr = &hostname
	}

	ipStr := ""
	if out, err := exec.Command("hostname", "-I").Output(); err == nil {
		ipStr = strings.TrimSpace(string(out))
	}
	var ipPtr *string
	if ipStr != "" {
		ipPtr = &ipStr
	}

	kernStr := ""
	if out, err := exec.Command("uname", "-r").Output(); err == nil {
		kernStr = strings.TrimSpace(string(out))
	}
	var kernPtr *string
	if kernStr != "" {
		kernPtr = &kernStr
	}

	archStr := ""
	if out, err := exec.Command("lscpu").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				k := strings.TrimSpace(parts[0])
				v := strings.TrimSpace(parts[1])
				if k == "Model name" {
					archStr = v
					break
				}
				if k == "Architecture" && archStr == "" {
					archStr = v
				}
			}
		}
	}
	var archPtr *string
	if archStr != "" {
		archPtr = &archStr
	}

	staticSystem = SystemData{
		Hostname: hostPtr,
		IP:       ipPtr,
		Kernel:   kernPtr,
		OS:       osName,
		Arch:     archPtr,
	}

	// 2. CPU Static Info
	if dirs, err := readDirNames("/sys/devices/system/cpu"); err == nil {
		re := regexp.MustCompile(`^cpu(\d+)$`)
		for _, d := range dirs {
			m := re.FindStringSubmatch(d)
			if len(m) < 2 {
				continue
			}
			core, _ := strconv.Atoi(m[1])
			base := fmt.Sprintf("/sys/devices/system/cpu/%s/cpufreq", d)
			var minF, maxF *int
			var gov *string
			if minStr, err := readFileString(base + "/scaling_min_freq"); err == nil {
				if v, err := strconv.Atoi(strings.TrimSpace(minStr)); err == nil {
					val := v / 1000
					minF = &val
				}
			}
			if maxStr, err := readFileString(base + "/scaling_max_freq"); err == nil {
				if v, err := strconv.Atoi(strings.TrimSpace(maxStr)); err == nil {
					val := v / 1000
					maxF = &val
				}
			}
			if govStr, err := readFileString(base + "/scaling_governor"); err == nil {
				g := strings.TrimSpace(govStr)
				gov = &g
			}
			cpuStaticInfo = append(cpuStaticInfo, CpuStaticInfoItem{
				Core:     core,
				Min:      minF,
				Max:      maxF,
				Governor: gov,
			})
		}
		sort.Slice(cpuStaticInfo, func(i, j int) bool {
			return cpuStaticInfo[i].Core < cpuStaticInfo[j].Core
		})
	}

	// 3. Thermal Paths
	wantedZones := map[string]bool{
		"cpu-1-6-step":       true,
		"battery":            true,
		"gpuss-0-step":       true,
		"ddr-usr":            true,
		"modem-lte-sub6-pa1": true,
		"pmr735a_tz":         true,
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
	re := regexp.MustCompile(`^\s*(wlan0|tun0)\s*:\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)`)
	for _, line := range strings.Split(netText, "\n") {
		m := re.FindStringSubmatch(line)
		if len(m) == 4 {
			rx, _ := strconv.ParseInt(m[2], 10, 64)
			tx, _ := strconv.ParseInt(m[3], 10, 64)
			currNet[m[1]] = [2]int64{rx, tx}
		}
	}

	res := make(map[string]NetworkInterface)
	for _, iface := range []string{"wlan0", "tun0"} {
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
				item.RxRate = math.Round(float64(cur[0]-prev[0]) / interval)
				item.TxRate = math.Round(float64(cur[1]-prev[1]) / interval)
			}
		}
		res[iface] = item
	}
	prevState.Net = currNet
	return res
}

func collectDiskIO(diskText string, interval float64) map[string]DiskIOItem {
	currDisk := make(map[string]RawDiskEntry)
	for _, line := range strings.Split(diskText, "\n") {
		f := strings.Fields(line)
		if len(f) < 14 {
			continue
		}
		name := f[2]
		if name == "sda" || name == "sda26" || name == "zram0" {
			r, _ := strconv.ParseInt(f[3], 10, 64)
			sr, _ := strconv.ParseInt(f[5], 10, 64)
			w, _ := strconv.ParseInt(f[7], 10, 64)
			sw, _ := strconv.ParseInt(f[9], 10, 64)
			iot, _ := strconv.ParseInt(f[12], 10, 64)
			currDisk[name] = RawDiskEntry{
				Reads:          r,
				Writes:         w,
				SectorsRead:    sr,
				SectorsWritten: sw,
				IOTime:         iot,
			}
		}
	}
	res := make(map[string]DiskIOItem)
	for _, dev := range []string{"sda", "sda26", "zram0"} {
		cur, ok := currDisk[dev]
		if !ok {
			continue
		}
		item := DiskIOItem{
			Reads:          cur.Reads,
			Writes:         cur.Writes,
			SectorsRead:    cur.SectorsRead,
			SectorsWritten: cur.SectorsWritten,
			IOTime:         cur.IOTime,
		}
		if prevState.Disk != nil && interval > 0 {
			if prev, okPrev := prevState.Disk[dev]; okPrev {
				item.ReadsPerSec = math.Round(float64(cur.Reads-prev.Reads) / interval)
				item.WritesPerSec = math.Round(float64(cur.Writes-prev.Writes) / interval)
				item.SectorsReadPerSec = math.Round(float64(cur.SectorsRead-prev.SectorsRead) / interval)
				item.SectorsWrittenPerSec = math.Round(float64(cur.SectorsWritten-prev.SectorsWritten) / interval)
			}
		}
		res[dev] = item
	}
	prevState.Disk = currDisk
	return res
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

func collectFreq() []CpuFrequency {
	return freqCache.Get(func() ([]CpuFrequency, bool) {
		var res []CpuFrequency
		for _, info := range cpuStaticInfo {
			var cur *int
			base := fmt.Sprintf("/sys/devices/system/cpu/cpu%d/cpufreq/scaling_cur_freq", info.Core)
			if curStr, err := readFileString(base); err == nil {
				if v, err := strconv.Atoi(strings.TrimSpace(curStr)); err == nil {
					val := v / 1000
					cur = &val
				}
			}
			res = append(res, CpuFrequency{
				Core:     info.Core,
				Current:  cur,
				Min:      info.Min,
				Max:      info.Max,
				Governor: info.Governor,
			})
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
	var capPtr, voltPtr, currPtr *int
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
	if str, err := readFileString(base + "/voltage_now"); err == nil {
		if v, err := strconv.Atoi(strings.TrimSpace(str)); err == nil {
			voltPtr = &v
		}
	}
	if str, err := readFileString(base + "/current_now"); err == nil {
		if v, err := strconv.Atoi(strings.TrimSpace(str)); err == nil {
			currPtr = &v
		}
	}
	return &BatteryData{
		Capacity: capPtr,
		Status:   statusPtr,
		Voltage:  voltPtr,
		Current:  currPtr,
	}
}

func collectSystem() *SystemData {
	var uptPtr *float64
	if uptStr, err := readFileString("/proc/uptime"); err == nil {
		fields := strings.Fields(uptStr)
		if len(fields) > 0 {
			if v, err := strconv.ParseFloat(fields[0], 64); err == nil {
				uptPtr = &v
			}
		}
	}
	return &SystemData{
		Uptime:   uptPtr,
		Hostname: staticSystem.Hostname,
		IP:       staticSystem.IP,
		Kernel:   staticSystem.Kernel,
		OS:       staticSystem.OS,
		Arch:     staticSystem.Arch,
	}
}
