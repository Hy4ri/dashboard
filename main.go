package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

// --- Configuration ---

type Config struct {
	Port            int
	CollectMS       time.Duration
	IdleTimeout     time.Duration
	DiskCacheTTL    time.Duration
	PM2CacheTTL     time.Duration
	FreqCacheTTL    time.Duration
	ThermalCacheTTL time.Duration
	QBCacheTTL      time.Duration
	ConnCacheTTL    time.Duration
	AntiGravTTL     time.Duration
	TechnitiumToken string
	TechnitiumURL   string
	AuthUser        string
	AuthPass        string
	QBHost          string
	QBPort          int
	QBUser          string
	QBPass          string
}

var cfg Config

func loadDotEnv() {
	paths := []string{".env", "/opt/monit/.env"}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				val := strings.TrimSpace(parts[1])
				val = strings.Trim(val, `"'`)
				if _, exists := os.LookupEnv(key); !exists {
					os.Setenv(key, val)
				}
			}
		}
		break
	}
}

func initConfig() {
	loadDotEnv()
	port := 8080
	if p, err := strconv.Atoi(os.Getenv("PORT")); err == nil && p > 0 {
		port = p
	}
	qbPort := 7777
	if p, err := strconv.Atoi(os.Getenv("QB_PORT")); err == nil && p > 0 {
		qbPort = p
	}

	qbHost := os.Getenv("QB_HOST")
	if qbHost == "" {
		qbHost = "localhost"
	}
	qbUser := os.Getenv("QB_USER")
	if qbUser == "" {
		qbUser = "admin"
	}

	techURL := os.Getenv("TECHNITIUM_URL")
	if techURL == "" {
		techURL = "http://127.0.0.1:5380"
	}

	authUser := os.Getenv("AUTH_USER")
	if authUser == "" {
		authUser = "admin"
	}

	cfg = Config{
		Port:            port,
		CollectMS:       3000 * time.Millisecond,
		IdleTimeout:     10000 * time.Millisecond,
		DiskCacheTTL:    120 * time.Second,
		PM2CacheTTL:     5 * time.Second,
		FreqCacheTTL:    5 * time.Second,
		ThermalCacheTTL: 5 * time.Second,
		QBCacheTTL:      10 * time.Second,
		ConnCacheTTL:    10 * time.Second,
		AntiGravTTL:     30 * time.Second,
		TechnitiumToken: os.Getenv("TECHNITIUM_TOKEN"),
		TechnitiumURL:   techURL,
		AuthUser:        authUser,
		AuthPass:        os.Getenv("AUTH_PASS"),
		QBHost:          qbHost,
		QBPort:          qbPort,
		QBUser:          qbUser,
		QBPass:          os.Getenv("QB_PASS"),
	}
}

// --- Data Models (matching shared/types.ts 100%) ---

type PM2Process struct {
	ID       int         `json:"id"`
	Name     string      `json:"name"`
	Status   string      `json:"status"`
	CPU      float64     `json:"cpu"`
	Memory   int64       `json:"memory"`
	Uptime   *int64      `json:"uptime"`
	Restarts int         `json:"restarts"`
	PID      int         `json:"pid"`
	Full     interface{} `json:"_full,omitempty"`
}

type ThermalSensor struct {
	Name string  `json:"name"`
	Temp float64 `json:"temp"`
}

type CpuFrequency struct {
	Core     int     `json:"core"`
	Current  *int    `json:"current,omitempty"`
	Min      *int    `json:"min"`
	Max      *int    `json:"max"`
	Governor *string `json:"governor"`
}

type DiskUsage struct {
	Total     uint64  `json:"total"`
	Used      uint64  `json:"used"`
	Available uint64  `json:"available"`
	UsedPct   float64 `json:"used_pct,omitempty"`
}

type DiskIOItem struct {
	Reads                int64   `json:"reads"`
	Writes               int64   `json:"writes"`
	SectorsRead          int64   `json:"sectorsRead"`
	SectorsWritten       int64   `json:"sectorsWritten"`
	IOTime               int64   `json:"ioTime"`
	ReadsPerSec          float64 `json:"readsPerSec,omitempty"`
	WritesPerSec         float64 `json:"writesPerSec,omitempty"`
	SectorsReadPerSec    float64 `json:"sectorsReadPerSec,omitempty"`
	SectorsWrittenPerSec float64 `json:"sectorsWrittenPerSec,omitempty"`
}

type DiskData struct {
	Total     uint64                `json:"total,omitempty"`
	Used      uint64                `json:"used,omitempty"`
	Available uint64                `json:"available,omitempty"`
	UsedPct   float64               `json:"used_pct,omitempty"`
	IO        map[string]DiskIOItem `json:"io"`
}

type MemoryData struct {
	MemTotal     uint64  `json:"MemTotal"`
	MemFree      uint64  `json:"MemFree"`
	MemAvailable uint64  `json:"MemAvailable"`
	Buffers      uint64  `json:"Buffers"`
	Cached       uint64  `json:"Cached"`
	SwapTotal    *uint64 `json:"SwapTotal,omitempty"`
	SwapFree     *uint64 `json:"SwapFree,omitempty"`
	UsedPct      float64 `json:"used_pct,omitempty"`
}

type SwapData struct {
	Total uint64 `json:"total"`
	Free  uint64 `json:"free"`
}

type NetworkInterface struct {
	RxBytes int64   `json:"rx_bytes"`
	TxBytes int64   `json:"tx_bytes"`
	RxRate  float64 `json:"rx_rate,omitempty"`
	TxRate  float64 `json:"tx_rate,omitempty"`
}

type ConnectivityStatus struct {
	Ok      bool    `json:"ok"`
	Latency *int64  `json:"latency,omitempty"`
	Error   *string `json:"error,omitempty"`
}

type TechnitiumStats struct {
	Configured        bool     `json:"configured"`
	Ok                *bool    `json:"ok,omitempty"`
	TotalQueries      *int64   `json:"totalQueries,omitempty"`
	BlockedQueries    *int64   `json:"blockedQueries,omitempty"`
	BlockedPercentage *float64 `json:"blockedPercentage,omitempty"`
	CachedQueries     *int64   `json:"cachedQueries,omitempty"`
	Error             *string  `json:"error,omitempty"`
}

type BatteryData struct {
	Capacity *int    `json:"capacity"`
	Status   *string `json:"status"`
	Voltage  *int    `json:"voltage"`
	Current  *int    `json:"current"`
}

type SystemData struct {
	Uptime   *float64 `json:"uptime"`
	Hostname *string  `json:"hostname"`
	IP       *string  `json:"ip"`
	Kernel   *string  `json:"kernel"`
	OS       *string  `json:"os"`
	Arch     *string  `json:"arch"`
}

type TorrentItem struct {
	Hash     string  `json:"hash"`
	Name     string  `json:"name"`
	Size     int64   `json:"size"`
	Progress float64 `json:"progress"`
	DlSpeed  int64   `json:"dlspeed"`
	UpSpeed  int64   `json:"upspeed"`
	ETA      int64   `json:"eta"`
	State    string  `json:"state"`
	NumSeeds int     `json:"num_seeds"`
	NumPeers int     `json:"num_peers"`
	Ratio    float64 `json:"ratio"`
}

type AntigravityQuotaBucket struct {
	BucketId          string  `json:"bucketId"`
	DisplayName       string  `json:"displayName"`
	Window            string  `json:"window"`
	ResetTime         string  `json:"resetTime,omitempty"`
	RemainingFraction float64 `json:"remainingFraction"`
	RemainingPct      float64 `json:"remainingPct"`
}

type AntigravityQuotaGroup struct {
	DisplayName string                   `json:"displayName"`
	Buckets     []AntigravityQuotaBucket `json:"buckets"`
}

type AntigravityAccountQuota struct {
	Email   string                  `json:"email"`
	Project string                  `json:"project,omitempty"`
	Groups  []AntigravityQuotaGroup `json:"groups"`
}

type DashboardState struct {
	Timestamp   int64                              `json:"timestamp,omitempty"`
	PM2         []PM2Process                       `json:"pm2,omitempty"`
	CPU         *float64                           `json:"cpu"`
	CPUCores    []*float64                         `json:"cpuCores,omitempty"`
	Thermal     []ThermalSensor                    `json:"thermal,omitempty"`
	Frequency   []CpuFrequency                     `json:"frequency,omitempty"`
	LoadAvg     []float64                          `json:"loadavg"`
	Memory      *MemoryData                        `json:"memory"`
	Swap        *SwapData                          `json:"swap"`
	Disk        *DiskData                          `json:"disk,omitempty"`
	Network     map[string]NetworkInterface        `json:"network,omitempty"`
	Internet    *ConnectivityStatus                `json:"internet,omitempty"`
	DNS         *ConnectivityStatus                `json:"dns,omitempty"`
	Battery     *BatteryData                       `json:"battery,omitempty"`
	System      *SystemData                        `json:"system,omitempty"`
	Torrents    []TorrentItem                      `json:"torrents,omitempty"`
	Services    map[string]bool                    `json:"services,omitempty"`
	DNSStats    *TechnitiumStats                   `json:"dnsStats,omitempty"`
	Antigravity []AntigravityAccountQuota          `json:"antigravity,omitempty"`
	AuthEnabled bool                               `json:"authEnabled"`
}

// --- State and Cache ---

type ProcStatCpu struct {
	Total float64
	Idle  float64
}

type RawDiskEntry struct {
	Reads          int64
	Writes         int64
	SectorsRead    int64
	SectorsWritten int64
	IOTime         int64
}

type PrevState struct {
	CPUOverall *ProcStatCpu
	CPUCores   map[string]ProcStatCpu
	Net        map[string][2]int64 // rx, tx
	Disk       map[string]RawDiskEntry
	Time       time.Time
}

type CpuStaticInfoItem struct {
	Core     int
	Min      *int
	Max      *int
	Governor *string
}

type ThermalPathItem struct {
	Name string
	Path string
}

type Cache[T any] struct {
	Value T
	Time  time.Time
}

var (
	stateMu          sync.RWMutex
	globalState      DashboardState
	lastStateJSON    []byte
	prevState        PrevState
	lastRequestTime  time.Time
	isPollingActive  bool
	pollingMu        sync.Mutex
	staticSystem     SystemData
	cpuStaticInfo    []CpuStaticInfoItem
	thermalPaths     []ThermalPathItem
	diskCache        Cache[*DiskUsage]
	pm2Cache         Cache[[]PM2Process]
	freqCache        Cache[[]CpuFrequency]
	thermalCache     Cache[[]ThermalSensor]
	qbCache          Cache[[]TorrentItem]
	connCache        Cache[struct{ Internet, DNS ConnectivityStatus }]
	antiGravCache    Cache[[]AntigravityAccountQuota]
	qbCookie         string
	wsClients        = make(map[*websocket.Conn]bool)
	wsMu             sync.Mutex
	sessions         = make(map[string]time.Time)
	sessionsMu       sync.RWMutex
	rateLimiterMap   = make(map[string][]time.Time)
	rateLimiterMu    sync.Mutex
)

// --- Helper Utilities ---

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

func parseCookies(cookieHeader string) map[string]string {
	res := make(map[string]string)
	if cookieHeader == "" {
		return res
	}
	parts := strings.Split(cookieHeader, ";")
	for _, p := range parts {
		kv := strings.SplitN(strings.TrimSpace(p), "=", 2)
		if len(kv) == 2 {
			val, _ := url.QueryUnescape(kv[1])
			res[kv[0]] = val
		}
	}
	return res
}

func isAuthenticated(r *http.Request) bool {
	if cfg.AuthPass == "" {
		return true
	}
	cookies := parseCookies(r.Header.Get("Cookie"))
	token := cookies["session_token"]
	if token == "" {
		return false
	}
	sessionsMu.RLock()
	exp, ok := sessions[token]
	sessionsMu.RUnlock()
	if !ok || time.Now().After(exp) {
		if ok {
			sessionsMu.Lock()
			delete(sessions, token)
			sessionsMu.Unlock()
		}
		return false
	}
	return true
}

func checkRateLimit(ip string) bool {
	rateLimiterMu.Lock()
	defer rateLimiterMu.Unlock()
	now := time.Now()
	cutoff := now.Add(-1 * time.Second)
	times := rateLimiterMap[ip]
	valid := make([]time.Time, 0, len(times))
	for _, t := range times {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	if len(valid) >= 10 { // 10 req/sec limit
		rateLimiterMap[ip] = valid
		return false
	}
	rateLimiterMap[ip] = append(valid, now)
	return true
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
		"cpu-1-6-step":        true,
		"battery":             true,
		"gpuss-0-step":        true,
		"ddr-usr":             true,
		"modem-lte-sub6-pa1":  true,
		"pmr735a_tz":          true,
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
		for _, v := range nums {
			total += v
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
	now := time.Now()
	if thermalCache.Value != nil && now.Sub(thermalCache.Time) < cfg.ThermalCacheTTL {
		return thermalCache.Value
	}
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
	thermalCache = Cache[[]ThermalSensor]{Value: res, Time: now}
	return res
}

func collectFreq() []CpuFrequency {
	now := time.Now()
	if freqCache.Value != nil && now.Sub(freqCache.Time) < cfg.FreqCacheTTL {
		return freqCache.Value
	}
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
	freqCache = Cache[[]CpuFrequency]{Value: res, Time: now}
	return res
}

func collectDiskUsage() *DiskUsage {
	now := time.Now()
	if diskCache.Value != nil && now.Sub(diskCache.Time) < cfg.DiskCacheTTL {
		return diskCache.Value
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err == nil {
		bsize := uint64(stat.Bsize)
		total := stat.Blocks * bsize
		avail := stat.Bavail * bsize
		used := total - avail
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
		diskCache = Cache[*DiskUsage]{Value: val, Time: now}
		return val
	}
	return nil
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

func collectPM2() []PM2Process {
	now := time.Now()
	if pm2Cache.Value != nil && now.Sub(pm2Cache.Time) < cfg.PM2CacheTTL {
		return pm2Cache.Value
	}
	out, err := exec.Command("pm2", "jlist").Output()
	if err != nil {
		return pm2Cache.Value
	}
	var raw []map[string]interface{}
	if err := json.Unmarshal(out, &raw); err != nil {
		return pm2Cache.Value
	}
	var res []PM2Process
	for _, p := range raw {
		pmId := 0
		if idVal, ok := p["pm_id"].(float64); ok {
			pmId = int(idVal)
		}
		name, _ := p["name"].(string)
		pid := 0
		if pidVal, ok := p["pid"].(float64); ok {
			pid = int(pidVal)
		}
		status := "stopped"
		var uptime *int64
		restarts := 0
		if env, ok := p["pm2_env"].(map[string]interface{}); ok {
			if s, ok := env["status"].(string); ok {
				status = s
			}
			if u, ok := env["pm_uptime"].(float64); ok {
				val := int64(u)
				uptime = &val
			}
			if r, ok := env["restart_time"].(float64); ok {
				restarts = int(r)
			}
		}
		cpu := 0.0
		mem := int64(0)
		if monit, ok := p["monit"].(map[string]interface{}); ok {
			if c, ok := monit["cpu"].(float64); ok {
				cpu = c
			}
			if m, ok := monit["memory"].(float64); ok {
				mem = int64(m)
			}
		}
		res = append(res, PM2Process{
			ID:       pmId,
			Name:     name,
			Status:   status,
			CPU:      cpu,
			Memory:   mem,
			Uptime:   uptime,
			Restarts: restarts,
			PID:      pid,
			Full:     p,
		})
	}
	pm2Cache = Cache[[]PM2Process]{Value: res, Time: now}
	return res
}

func collectServices() map[string]bool {
	services := []struct {
		name string
		port int
	}{
		{"Jellyfin", 8096},
		{"Seerr", 5055},
		{"qBittorrent", 7777},
		{"Sonarr", 8989},
		{"Radarr", 7878},
		{"Prowlarr", 9696},
		{"Bazarr", 6767},
		{"Dufs", 5050},
		{"Technitium", 5380},
		{"Hermes", 9119},
	}
	res := make(map[string]bool)
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, s := range services {
		wg.Add(1)
		go func(name string, port int) {
			defer wg.Done()
			conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 400*time.Millisecond)
			isUp := err == nil
			if isUp {
				conn.Close()
			}
			mu.Lock()
			res[name] = isUp
			mu.Unlock()
		}(s.name, s.port)
	}
	wg.Wait()
	return res
}

func collectConnectivity() (ConnectivityStatus, ConnectivityStatus) {
	now := time.Now()
	if connCache.Value.Internet.Ok && now.Sub(connCache.Time) < cfg.ConnCacheTTL {
		return connCache.Value.Internet, connCache.Value.DNS
	}
	var internet, dnsStatus ConnectivityStatus

	// 1. Check Internet (8.8.8.8:53)
	startNet := time.Now()
	conn, err := net.DialTimeout("tcp", "8.8.8.8:53", 1500*time.Millisecond)
	if err == nil {
		lat := time.Since(startNet).Milliseconds()
		conn.Close()
		internet = ConnectivityStatus{Ok: true, Latency: &lat}
	} else {
		errStr := err.Error()
		internet = ConnectivityStatus{Ok: false, Error: &errStr}
	}

	// 2. Check DNS via local Technitium (127.0.0.1:53)
	r := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			d := net.Dialer{Timeout: 2000 * time.Millisecond}
			return d.DialContext(ctx, "udp", "127.0.0.1:53")
		},
	}
	startDNS := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
	_, dnsErr := r.LookupHost(ctx, "google.com")
	cancel()
	if dnsErr == nil {
		lat := time.Since(startDNS).Milliseconds()
		dnsStatus = ConnectivityStatus{Ok: true, Latency: &lat}
	} else {
		errStr := dnsErr.Error()
		dnsStatus = ConnectivityStatus{Ok: false, Error: &errStr}
	}

	res := struct{ Internet, DNS ConnectivityStatus }{Internet: internet, DNS: dnsStatus}
	connCache = Cache[struct{ Internet, DNS ConnectivityStatus }]{Value: res, Time: now}
	return internet, dnsStatus
}

func collectTechnitium() *TechnitiumStats {
	if cfg.TechnitiumToken == "" {
		return &TechnitiumStats{Configured: false}
	}
	u := fmt.Sprintf("%s/api/dashboard/stats/get?token=%s&type=LastDay",
		strings.TrimRight(cfg.TechnitiumURL, "/"), url.QueryEscape(cfg.TechnitiumToken))
	client := &http.Client{
		Timeout: 3 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}
	resp, err := client.Get(u)
	if err != nil {
		errStr := err.Error()
		f := false
		return &TechnitiumStats{Configured: true, Ok: &f, Error: &errStr}
	}
	defer resp.Body.Close()
	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		errStr := err.Error()
		f := false
		return &TechnitiumStats{Configured: true, Ok: &f, Error: &errStr}
	}
	if st, _ := body["status"].(string); st == "ok" {
		t := true
		var total, blocked, cached int64
		if respMap, ok := body["response"].(map[string]interface{}); ok {
			if statsMap, ok := respMap["stats"].(map[string]interface{}); ok {
				if v, ok := statsMap["totalQueries"].(float64); ok {
					total = int64(v)
				}
				if v, ok := statsMap["totalBlocked"].(float64); ok {
					blocked = int64(v)
				}
				if v, ok := statsMap["totalCached"].(float64); ok {
					cached = int64(v)
				}
			}
		}
		pct := 0.0
		if total > 0 {
			pct = math.Round((float64(blocked)/float64(total))*10000) / 100
		}
		return &TechnitiumStats{
			Configured:        true,
			Ok:                &t,
			TotalQueries:      &total,
			BlockedQueries:    &blocked,
			BlockedPercentage: &pct,
			CachedQueries:     &cached,
		}
	}
	errMsg, _ := body["errorMessage"].(string)
	if errMsg == "" {
		errMsg = "API error"
	}
	f := false
	return &TechnitiumStats{Configured: true, Ok: &f, Error: &errMsg}
}

func collectQBittorrent() []TorrentItem {
	now := time.Now()
	if qbCache.Value != nil && now.Sub(qbCache.Time) < cfg.QBCacheTTL {
		return qbCache.Value
	}
	fetchTorrents := func() ([]TorrentItem, int, error) {
		u := fmt.Sprintf("http://%s:%d/api/v2/torrents/info", cfg.QBHost, cfg.QBPort)
		req, _ := http.NewRequest("GET", u, nil)
		if qbCookie != "" {
			req.Header.Set("Cookie", qbCookie)
		}
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return nil, 0, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, resp.StatusCode, nil
		}
		var raw []map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
			return nil, resp.StatusCode, err
		}
		var res []TorrentItem
		for _, t := range raw {
			hash, _ := t["hash"].(string)
			name, _ := t["name"].(string)
			size, _ := t["size"].(float64)
			progress, _ := t["progress"].(float64)
			dlspeed, _ := t["dlspeed"].(float64)
			upspeed, _ := t["upspeed"].(float64)
			eta, _ := t["eta"].(float64)
			state, _ := t["state"].(string)
			numSeeds, _ := t["num_seeds"].(float64)
			numPeers, _ := t["num_leechs"].(float64)
			ratio, _ := t["ratio"].(float64)

			res = append(res, TorrentItem{
				Hash:     hash,
				Name:     name,
				Size:     int64(size),
				Progress: progress,
				DlSpeed:  int64(dlspeed),
				UpSpeed:  int64(upspeed),
				ETA:      int64(eta),
				State:    state,
				NumSeeds: int(numSeeds),
				NumPeers: int(numPeers),
				Ratio:    ratio,
			})
		}
		return res, 200, nil
	}

	qbLogin := func() bool {
		u := fmt.Sprintf("http://%s:%d/api/v2/auth/login", cfg.QBHost, cfg.QBPort)
		data := url.Values{}
		data.Set("username", cfg.QBUser)
		data.Set("password", cfg.QBPass)
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.PostForm(u, data)
		if err != nil {
			return false
		}
		defer resp.Body.Close()
		for _, c := range resp.Cookies() {
			if c.Name == "SID" {
				qbCookie = c.String()
				return true
			}
		}
		return resp.StatusCode == 200
	}

	list, code, err := fetchTorrents()
	if (code == 403 || qbCookie == "") && cfg.QBPass != "" {
		if qbLogin() {
			list, _, _ = fetchTorrents()
		}
	}
	if err == nil && list != nil {
		qbCache = Cache[[]TorrentItem]{Value: list, Time: now}
		return list
	}
	return qbCache.Value
}

func collectAntigravity() []AntigravityAccountQuota {
	now := time.Now()
	if antiGravCache.Value != nil && now.Sub(antiGravCache.Time) < cfg.AntiGravTTL {
		return antiGravCache.Value
	}
	authsDir := "/opt/cliproxyapi/auths"
	entries, err := os.ReadDir(authsDir)
	if err != nil {
		return antiGravCache.Value
	}
	var res []AntigravityAccountQuota
	client := &http.Client{Timeout: 4 * time.Second}

	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "antigravity") && strings.HasSuffix(e.Name(), ".json") {
			fullPath := filepath.Join(authsDir, e.Name())
			raw, err := os.ReadFile(fullPath)
			if err != nil {
				continue
			}
			var authMap map[string]interface{}
			if err := json.Unmarshal(raw, &authMap); err != nil {
				continue
			}
			token, _ := authMap["access_token"].(string)
			if token == "" {
				continue
			}
			email, _ := authMap["email"].(string)
			if email == "" {
				email = strings.TrimSuffix(strings.TrimPrefix(e.Name(), "antigravity-"), ".json")
			}
			project, _ := authMap["project_id"].(string)

			payload := []byte(fmt.Sprintf(`{"project":"%s"}`, project))
			req, _ := http.NewRequest("POST", "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary", bytes.NewReader(payload))
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("User-Agent", "Antigravity/1.0")

			resp, err := client.Do(req)
			if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
				if resp != nil {
					resp.Body.Close()
				}
				continue
			}
			var quotaResp struct {
				Groups []struct {
					DisplayName string `json:"displayName"`
					Buckets     []struct {
						BucketId          string  `json:"bucketId"`
						DisplayName       string  `json:"displayName"`
						Window            string  `json:"window"`
						ResetTime         string  `json:"resetTime"`
						RemainingFraction float64 `json:"remainingFraction"`
					} `json:"buckets"`
				} `json:"groups"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&quotaResp); err == nil {
				var groups []AntigravityQuotaGroup
				for _, g := range quotaResp.Groups {
					gName := g.DisplayName
					if gName == "" {
						gName = "Model Group"
					}
					var buckets []AntigravityQuotaBucket
					for _, b := range g.Buckets {
						w := b.Window
						if w == "" {
							if strings.Contains(b.BucketId, "5h") {
								w = "5h"
							} else {
								w = "weekly"
							}
						}
						pct := math.Round(b.RemainingFraction*1000) / 10
						buckets = append(buckets, AntigravityQuotaBucket{
							BucketId:          b.BucketId,
							DisplayName:       b.DisplayName,
							Window:            w,
							ResetTime:         b.ResetTime,
							RemainingFraction: b.RemainingFraction,
							RemainingPct:      pct,
						})
					}
					groups = append(groups, AntigravityQuotaGroup{
						DisplayName: gName,
						Buckets:     buckets,
					})
				}
				res = append(res, AntigravityAccountQuota{
					Email:   email,
					Project: project,
					Groups:  groups,
				})
			}
			resp.Body.Close()
		}
	}
	antiGravCache = Cache[[]AntigravityAccountQuota]{Value: res, Time: now}
	return res
}

func collectAll() {
	now := time.Now()
	interval := now.Sub(prevState.Time).Seconds()

	statText, _ := readFileString("/proc/stat")
	netText, _ := readFileString("/proc/net/dev")
	diskText, _ := readFileString("/proc/diskstats")
	loadText, _ := readFileString("/proc/loadavg")
	memText, _ := readFileString("/proc/meminfo")

	cpuOverall, cpuCores := collectCPU(statText, interval)
	network := collectNetwork(netText, interval)
	ioMap := collectDiskIO(diskText, interval)
	prevState.Time = now

	var loadavg []float64
	if loadText != "" {
		fields := strings.Fields(loadText)
		if len(fields) >= 3 {
			for i := 0; i < 3; i++ {
				if v, err := strconv.ParseFloat(fields[i], 64); err == nil {
					loadavg = append(loadavg, v)
				}
			}
		}
	}

	var memData *MemoryData
	var swapData *SwapData
	if memText != "" {
		memData = parseMemInfo(memText)
		if memData != nil {
			st := uint64(0)
			sf := uint64(0)
			if memData.SwapTotal != nil {
				st = *memData.SwapTotal
			}
			if memData.SwapFree != nil {
				sf = *memData.SwapFree
			}
			swapData = &SwapData{Total: st, Free: sf}
		}
	}

	diskUse := collectDiskUsage()
	var diskData *DiskData
	if diskUse != nil {
		diskData = &DiskData{
			Total:     diskUse.Total,
			Used:      diskUse.Used,
			Available: diskUse.Available,
			UsedPct:   diskUse.UsedPct,
			IO:        ioMap,
		}
	} else {
		diskData = &DiskData{IO: ioMap}
	}

	thermal := collectThermal()
	freq := collectFreq()
	battery := collectBattery()
	sysData := collectSystem()
	pm2List := collectPM2()
	torrents := collectQBittorrent()
	services := collectServices()
	internet, dnsStat := collectConnectivity()
	dnsStats := collectTechnitium()
	antiGrav := collectAntigravity()

	newState := DashboardState{
		Timestamp:   now.UnixMilli(),
		PM2:         pm2List,
		CPU:         cpuOverall,
		CPUCores:    cpuCores,
		Thermal:     thermal,
		Frequency:   freq,
		LoadAvg:     loadavg,
		Memory:      memData,
		Swap:        swapData,
		Disk:        diskData,
		Network:     network,
		Internet:    &internet,
		DNS:         &dnsStat,
		Battery:     battery,
		System:      sysData,
		Torrents:    torrents,
		Services:    services,
		DNSStats:    dnsStats,
		Antigravity: antiGrav,
		AuthEnabled: cfg.AuthPass != "",
	}

	jsonBytes, err := json.Marshal(newState)
	if err == nil {
		stateMu.Lock()
		globalState = newState
		lastStateJSON = jsonBytes
		stateMu.Unlock()
	}
}

func ensureActivePolling() {
	lastRequestTime = time.Now()
	pollingMu.Lock()
	defer pollingMu.Unlock()
	if isPollingActive {
		return
	}
	isPollingActive = true
	log.Println("Polling started (active client/WS connection)")

	go func() {
		collectAll()
		broadcastState()

		ticker := time.NewTicker(cfg.CollectMS)
		defer ticker.Stop()

		for range ticker.C {
			wsMu.Lock()
			hasWs := len(wsClients) > 0
			wsMu.Unlock()

			isHttpActive := time.Since(lastRequestTime) <= cfg.IdleTimeout

			if !hasWs && !isHttpActive {
				pollingMu.Lock()
				isPollingActive = false
				pollingMu.Unlock()
				log.Println("Polling stopped (idle)")
				return
			}

			collectAll()
			if hasWs {
				broadcastState()
			}
		}
	}()
}

func broadcastState() {
	stateMu.RLock()
	payload := lastStateJSON
	stateMu.RUnlock()
	if len(payload) == 0 {
		return
	}

	wsMu.Lock()
	defer wsMu.Unlock()
	for client := range wsClients {
		if err := client.WriteMessage(websocket.TextMessage, payload); err != nil {
			client.Close()
			delete(wsClients, client)
		}
	}
}

// --- HTTP Handlers ---

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:")
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w)
	if r.Method != "POST" {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	var creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Remember bool   `json:"remember"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Invalid payload"})
		return
	}
	if creds.Username == cfg.AuthUser && creds.Password == cfg.AuthPass {
		b := make([]byte, 32)
		rand.Read(b)
		token := hex.EncodeToString(b)
		duration := 2 * time.Hour
		if creds.Remember {
			duration = 30 * 24 * time.Hour
		}
		sessionsMu.Lock()
		sessions[token] = time.Now().Add(duration)
		sessionsMu.Unlock()

		cookie := &http.Cookie{
			Name:     "session_token",
			Value:    token,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   int(duration.Seconds()),
		}
		http.SetCookie(w, cookie)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(401)
	json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Invalid username or password"})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w)
	cookies := parseCookies(r.Header.Get("Cookie"))
	if token := cookies["session_token"]; token != "" {
		sessionsMu.Lock()
		delete(sessions, token)
		sessionsMu.Unlock()
	}
	cookie := &http.Cookie{
		Name:     "session_token",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	}
	http.SetCookie(w, cookie)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func handlePM2Control(w http.ResponseWriter, r *http.Request, action, name string) {
	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if name == "" || regexp.MustCompile(`[;|&$`+"`"+`()<>]`).MatchString(name) {
		w.WriteHeader(400)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request"})
		return
	}
	if err := exec.Command("pm2", action, name).Run(); err != nil {
		w.WriteHeader(500)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Process %s %sed", name, action),
	})
	go func() {
		time.Sleep(300 * time.Millisecond)
		collectPM2()
		collectAll()
	}()
}

func handlePM2Logs(w http.ResponseWriter, r *http.Request, name string, lines int) {
	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if name == "" || regexp.MustCompile(`[;|&$`+"`"+`()<>]`).MatchString(name) {
		w.WriteHeader(400)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid process name"})
		return
	}
	procs := collectPM2()
	var target *PM2Process
	for _, p := range procs {
		if p.Name == name {
			target = &p
			break
		}
	}
	if target == nil {
		w.WriteHeader(404)
		json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("Process '%s' not found", name)})
		return
	}

	var outPath, errPath string
	if target.Full != nil {
		if fullMap, ok := target.Full.(map[string]interface{}); ok {
			if env, ok := fullMap["pm2_env"].(map[string]interface{}); ok {
				outPath, _ = env["pm_out_log_path"].(string)
				errPath, _ = env["pm_err_log_path"].(string)
			}
		}
	}

	tailFile := func(path string, count int) string {
		if path == "" {
			return ""
		}
		if count < 10 {
			count = 10
		}
		if count > 1000 {
			count = 1000
		}
		out, err := exec.Command("tail", "-n", strconv.Itoa(count), path).Output()
		if err != nil {
			return fmt.Sprintf("[Error reading log: %s]", err.Error())
		}
		nowStr := time.Now().Format("2006-01-02 15:04:05")
		return fmt.Sprintf("[%s] (last %d lines)\n%s", nowStr, count, string(out))
	}

	outLogs := tailFile(outPath, lines)
	errLogs := tailFile(errPath, lines)

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"name":    name,
		"out":     outLogs,
		"err":     errLogs,
	})
}

func handleQBAction(w http.ResponseWriter, r *http.Request, action, hash string) {
	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	qbRequest := func(method, path string, data url.Values) (int, error) {
		u := fmt.Sprintf("http://%s:%d%s", cfg.QBHost, cfg.QBPort, path)
		req, _ := http.NewRequest(method, u, strings.NewReader(data.Encode()))
		if method == "POST" {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
		if qbCookie != "" {
			req.Header.Set("Cookie", qbCookie)
		}
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return 0, err
		}
		defer resp.Body.Close()
		return resp.StatusCode, nil
	}

	qbLogin := func() bool {
		u := fmt.Sprintf("http://%s:%d/api/v2/auth/login", cfg.QBHost, cfg.QBPort)
		data := url.Values{}
		data.Set("username", cfg.QBUser)
		data.Set("password", cfg.QBPass)
		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.PostForm(u, data)
		if err != nil {
			return false
		}
		defer resp.Body.Close()
		for _, c := range resp.Cookies() {
			if c.Name == "SID" {
				qbCookie = c.String()
				return true
			}
		}
		return resp.StatusCode == 200
	}

	doAction := func(act, h string) (bool, string) {
		data := url.Values{}
		data.Set("hashes", h)
		var apiPath string
		switch act {
		case "delete":
			apiPath = "/api/v2/torrents/delete"
			data.Set("deleteFiles", "true")
		case "pause":
			apiPath = "/api/v2/torrents/stop"
		case "resume":
			apiPath = "/api/v2/torrents/start"
		}
		code, err := qbRequest("POST", apiPath, data)
		if code == 404 && act == "pause" {
			apiPath = "/api/v2/torrents/pause"
			code, err = qbRequest("POST", apiPath, data)
		} else if code == 404 && act == "resume" {
			apiPath = "/api/v2/torrents/resume"
			code, err = qbRequest("POST", apiPath, data)
		}
		if code == 403 {
			if qbLogin() {
				code, err = qbRequest("POST", apiPath, data)
			} else {
				return false, "Authentication failed"
			}
		}
		if err != nil {
			return false, err.Error()
		}
		if code == 200 {
			qbCache = Cache[[]TorrentItem]{}
			return true, ""
		}
		return false, fmt.Sprintf("HTTP %d", code)
	}

	ok, errStr := doAction(action, hash)
	if ok {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
	} else {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": errStr})
	}
}

func handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Terminal WS upgrade error:", err)
		return
	}
	defer conn.Close()

	cols := 120
	rows := 30
	if c, err := strconv.Atoi(r.URL.Query().Get("cols")); err == nil && c > 0 {
		cols = c
	}
	if rowsVal, err := strconv.Atoi(r.URL.Query().Get("rows")); err == nil && rowsVal > 0 {
		rows = rowsVal
	}

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	cmd := exec.Command(shell)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	cmd.Dir = os.Getenv("HOME")
	if cmd.Dir == "" {
		cmd.Dir = "/"
	}

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{
		Rows: uint16(rows),
		Cols: uint16(cols),
	})
	if err != nil {
		errMsg := fmt.Sprintf("\r\n\x1b[31mFailed to spawn terminal: %s\x1b[0m\r\n", err.Error())
		out, _ := json.Marshal(map[string]string{"type": "output", "data": errMsg})
		conn.WriteMessage(websocket.TextMessage, out)
		return
	}
	defer func() {
		ptmx.Close()
		cmd.Process.Kill()
	}()

	conn.WriteJSON(map[string]interface{}{"type": "connected", "pid": cmd.Process.Pid})

	// PTY stdout -> WS client
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				conn.WriteJSON(map[string]interface{}{"type": "exit", "code": 0})
				return
			}
			msg, _ := json.Marshal(map[string]string{
				"type": "output",
				"data": string(buf[:n]),
			})
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		}
	}()

	// WS client -> PTY stdin
	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var msg struct {
			Type string `json:"type"`
			Data string `json:"data"`
			Cols uint16 `json:"cols"`
			Rows uint16 `json:"rows"`
		}
		if err := json.Unmarshal(msgBytes, &msg); err == nil {
			switch msg.Type {
			case "input":
				ptmx.Write([]byte(msg.Data))
			case "resize":
				if msg.Cols > 0 && msg.Rows > 0 {
					pty.Setsize(ptmx, &pty.Winsize{Rows: msg.Rows, Cols: msg.Cols})
				}
			}
		}
	}
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WS upgrade error:", err)
		return
	}

	wsMu.Lock()
	wsClients[conn] = true
	wsMu.Unlock()

	ensureActivePolling()

	stateMu.RLock()
	if len(lastStateJSON) > 0 {
		conn.WriteMessage(websocket.TextMessage, lastStateJSON)
	}
	stateMu.RUnlock()

	defer func() {
		wsMu.Lock()
		delete(wsClients, conn)
		wsMu.Unlock()
		conn.Close()
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

// --- Static File Server ---

func serveStaticFile(w http.ResponseWriter, r *http.Request, relPath string) {
	setSecurityHeaders(w)
	root := "/opt/monit"
	fullPath := filepath.Join(root, relPath)
	cleanPath := filepath.Clean(fullPath)
	if !strings.HasPrefix(cleanPath, root) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	data, err := os.ReadFile(cleanPath)
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	ext := strings.ToLower(filepath.Ext(cleanPath))
	mimeMap := map[string]string{
		".html":        "text/html; charset=utf-8",
		".css":         "text/css; charset=utf-8",
		".js":          "text/javascript; charset=utf-8",
		".svg":         "image/svg+xml",
		".png":         "image/png",
		".ico":         "image/x-icon",
		".json":        "application/json",
		".webmanifest": "application/manifest+json",
	}
	cType := mimeMap[ext]
	if cType == "" {
		cType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", cType)

	canCache := mimeMap[ext] != ""
	if canCache {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}

	acceptEncoding := r.Header.Get("Accept-Encoding")
	if canCache && strings.Contains(acceptEncoding, "gzip") && len(data) > 1024 {
		var gzBuf bytes.Buffer
		gw := gzip.NewWriter(&gzBuf)
		gw.Write(data)
		gw.Close()
		if gzBuf.Len() < len(data) {
			w.Header().Set("Content-Encoding", "gzip")
			w.Write(gzBuf.Bytes())
			return
		}
	}
	w.Write(data)
}

func main() {
	initConfig()
	initStaticData()

	log.Printf("Starting monit Go server on port %d...", cfg.Port)

	// Single baseline collect
	collectAll()
	log.Printf("Initial collection done, idle until first request")

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Public assets
		isPublic := path == "/manifest.json" || path == "/sw.js" || strings.HasPrefix(path, "/icon") || path == "/favicon.ico"
		authed := isAuthenticated(r)

		if path == "/api/login" {
			handleLogin(w, r)
			return
		}
		if path == "/api/logout" {
			handleLogout(w, r)
			return
		}

		if !authed && !isPublic {
			if strings.HasPrefix(path, "/api") {
				setSecurityHeaders(w)
				w.WriteHeader(401)
				w.Write([]byte("Unauthorized"))
				return
			}
			serveStaticFile(w, r, "login.html")
			return
		}

		// Rate limiting on API
		if strings.HasPrefix(path, "/api") {
			clientIP, _, _ := net.SplitHostPort(r.RemoteAddr)
			if clientIP == "" {
				clientIP = r.RemoteAddr
			}
			if !checkRateLimit(clientIP) {
				setSecurityHeaders(w)
				w.WriteHeader(429)
				w.Write([]byte("Too Many Requests"))
				return
			}
		}

		// WebSockets
		if path == "/ws" {
			handleWS(w, r)
			return
		}
		if path == "/ws/terminal" {
			handleTerminalWS(w, r)
			return
		}

		// API routes
		if path == "/api/status" {
			ensureActivePolling()
			setSecurityHeaders(w)
			w.Header().Set("Content-Type", "application/json")
			stateMu.RLock()
			w.Write(lastStateJSON)
			stateMu.RUnlock()
			return
		}

		// PM2 control: /api/pm2/:action/:name
		pm2ControlRe := regexp.MustCompile(`^/api/pm2/(stop|start|restart|delete)/(.+)$`)
		if m := pm2ControlRe.FindStringSubmatch(path); len(m) == 3 && r.Method == "POST" {
			handlePM2Control(w, r, m[1], m[2])
			return
		}

		// PM2 logs: /api/pm2/logs/:name
		pm2LogsRe := regexp.MustCompile(`^/api/pm2/logs/(.+)$`)
		if m := pm2LogsRe.FindStringSubmatch(path); len(m) == 2 && r.Method == "GET" {
			lines := 100
			if l, err := strconv.Atoi(r.URL.Query().Get("lines")); err == nil && l > 0 {
				lines = l
			}
			handlePM2Logs(w, r, m[1], lines)
			return
		}

		// qBittorrent: /api/qbittorrent/:action/:hash
		qbRe := regexp.MustCompile(`^/api/qbittorrent/(delete|pause|resume)/([a-fA-F0-9]{40}|all)$`)
		if m := qbRe.FindStringSubmatch(path); len(m) == 3 && r.Method == "POST" {
			handleQBAction(w, r, m[1], m[2])
			return
		}

		// Static files
		if path == "/" {
			path = "/index.html"
		}
		serveStaticFile(w, r, strings.TrimPrefix(path, "/"))
	})

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("Dashboard → http://localhost:%d", cfg.Port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed: %v", err)
	}
}
