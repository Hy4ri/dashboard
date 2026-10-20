package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
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
	AntiGravTTL      time.Duration
	AntiGravAuthsDir string
	AntiGravEndpoint string
	TechnitiumToken  string
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
		AntiGravTTL:      30 * time.Second,
		AntiGravAuthsDir:  "/opt/cliproxyapi/auths",
		TechnitiumToken:  os.Getenv("TECHNITIUM_TOKEN"),
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
	Full     interface{} `json:"-"`
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

type ClaudeUsageWindow struct {
	Utilization float64 `json:"utilization"`
	ResetsAt    string  `json:"resetsAt,omitempty"`
}

type ClaudeUsageData struct {
	Email     string             `json:"email,omitempty"`
	PlanType  string             `json:"planType,omitempty"`
	FiveHour  *ClaudeUsageWindow `json:"fiveHour,omitempty"`
	SevenDay  *ClaudeUsageWindow `json:"sevenDay,omitempty"`
	Breakdown map[string]int     `json:"breakdown,omitempty"`
}

type CodexUsageWindow struct {
	UsedPercent        float64 `json:"usedPercent"`
	WindowDurationMins int64   `json:"windowDurationMins,omitempty"`
	ResetsAt           int64   `json:"resetsAt"`
}

type CodexUsageData struct {
	Email           string            `json:"email,omitempty"`
	PlanType        string            `json:"planType,omitempty"`
	PrimaryWindow   *CodexUsageWindow `json:"primaryWindow,omitempty"`
	SecondaryWindow *CodexUsageWindow `json:"secondaryWindow,omitempty"`
}

type DashboardState struct {
	Timestamp   int64                       `json:"timestamp,omitempty"`
	PM2         []PM2Process                `json:"pm2"`
	CPU         *float64                    `json:"cpu"`
	CPUCores    []*float64                  `json:"cpuCores,omitempty"`
	Thermal     []ThermalSensor             `json:"thermal,omitempty"`
	Frequency   []CpuFrequency              `json:"frequency,omitempty"`
	LoadAvg     []float64                   `json:"loadavg"`
	Memory      *MemoryData                 `json:"memory"`
	Swap        *SwapData                   `json:"swap"`
	Disk        *DiskData                   `json:"disk,omitempty"`
	Network     map[string]NetworkInterface `json:"network,omitempty"`
	Internet    *ConnectivityStatus         `json:"internet,omitempty"`
	DNS         *ConnectivityStatus         `json:"dns,omitempty"`
	Battery     *BatteryData                `json:"battery,omitempty"`
	System      *SystemData                 `json:"system,omitempty"`
	Torrents    []TorrentItem               `json:"torrents"`
	Services    map[string]bool             `json:"services,omitempty"`
	DNSStats    *TechnitiumStats            `json:"dnsStats,omitempty"`
	Antigravity []AntigravityAccountQuota   `json:"antigravity,omitempty"`
	ClaudeUsage *ClaudeUsageData            `json:"claudeUsage,omitempty"`
	CodexUsage  *CodexUsageData             `json:"codexUsage,omitempty"`
	AuthEnabled bool                        `json:"authEnabled"`
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
	claudeCache      Cache[*ClaudeUsageData]
	codexCache       Cache[*CodexUsageData]
	qbCookie         string
	wsClients        = make(map[*websocket.Conn]*statsClient)
	wsMu             sync.Mutex
	sessions         = make(map[string]time.Time)
	sessionsMu       sync.RWMutex
	rateLimiterMap   = make(map[string][]time.Time)
	rateLimiterMu    sync.Mutex
	lastLimiterSweep time.Time
	collectMu        sync.Mutex
	pm2Mu            sync.Mutex
	qbMu             sync.Mutex
	slowMu           sync.Mutex
	slowState        DashboardState
	slowInFlight     = make(map[string]bool)
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
	if now.Sub(lastLimiterSweep) > time.Minute {
		for key, times := range rateLimiterMap {
			if len(times) == 0 || now.Sub(times[len(times)-1]) > time.Minute {
				delete(rateLimiterMap, key)
			}
		}
		sessionsMu.Lock()
		for token, expiry := range sessions {
			if now.After(expiry) {
				delete(sessions, token)
			}
		}
		sessionsMu.Unlock()
		lastLimiterSweep = now
	}
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
	pm2Mu.Lock()
	defer pm2Mu.Unlock()
	now := time.Now()
	if !pm2Cache.Time.IsZero() && now.Sub(pm2Cache.Time) < cfg.PM2CacheTTL {
		return pm2Cache.Value
	}
	// A failed refresh must not keep old measurements looking current.
	pm2Cache.Value = nil
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	defer func() { pm2Cache.Time = now }()
	out, err := exec.CommandContext(ctx, "pm2", "jlist").Output()
	if err != nil {
		return pm2Cache.Value
	}
	var raw []map[string]interface{}
	if err := json.Unmarshal(out, &raw); err != nil {
		return pm2Cache.Value
	}
	res := make([]PM2Process, 0, len(raw))
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
	if !connCache.Time.IsZero() && now.Sub(connCache.Time) < cfg.ConnCacheTTL {
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

var technitiumClient = &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, MaxIdleConnsPerHost: 2, IdleConnTimeout: 30 * time.Second}}

func collectTechnitium() *TechnitiumStats {
	if cfg.TechnitiumToken == "" {
		return &TechnitiumStats{Configured: false}
	}
	u := fmt.Sprintf("%s/api/dashboard/stats/get?token=%s&type=LastDay",
		strings.TrimRight(cfg.TechnitiumURL, "/"), url.QueryEscape(cfg.TechnitiumToken))
	resp, err := technitiumClient.Get(u)
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
	qbMu.Lock()
	defer qbMu.Unlock()
	now := time.Now()
	if !qbCache.Time.IsZero() && now.Sub(qbCache.Time) < cfg.QBCacheTTL {
		return qbCache.Value
	}
	// A failed refresh must not keep old measurements looking current.
	qbCache.Value = nil
	defer func() { qbCache.Time = now }()
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
		res := make([]TorrentItem, 0, len(raw))
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
			// qBittorrent 5.x scopes the session cookie to the WebUI port (for example, QBT_SID_7777); older versions used SID.
			if c.Name == "SID" || strings.HasPrefix(c.Name, "QBT_SID_") {
				qbCookie = c.Name + "=" + c.Value
				return true
			}
		}
		return resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNoContent
	}

	list, code, err := fetchTorrents()
	if (code == 403 || qbCookie == "") && cfg.QBPass != "" {
		if qbLogin() {
			list, code, err = fetchTorrents()
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
	if !antiGravCache.Time.IsZero() && now.Sub(antiGravCache.Time) < cfg.AntiGravTTL {
		return antiGravCache.Value
	}
	// A failed refresh must not keep old measurements looking current.
	antiGravCache.Value = nil
	defer func() { antiGravCache.Time = now }()
	authsDir := cfg.AntiGravAuthsDir
	if authsDir == "" {
		authsDir = "/opt/cliproxyapi/auths"
	}
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
			endpoints := []string{
				"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
				"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
			}
			if cfg.AntiGravEndpoint != "" {
				endpoints = []string{cfg.AntiGravEndpoint}
			}

			type rawQuotaResp struct {
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

			var mergedGroups []AntigravityQuotaGroup
			seenGroupNames := make(map[string]bool)
			hasGemini := false
			hasClaude := false

			for _, ep := range endpoints {
				if hasGemini && hasClaude {
					break
				}
				req, err := http.NewRequest("POST", ep, bytes.NewReader(payload))
				if err != nil {
					continue
				}
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

				var quotaResp rawQuotaResp
				decodeErr := json.NewDecoder(resp.Body).Decode(&quotaResp)
				resp.Body.Close()
				if decodeErr != nil {
					continue
				}

				for _, g := range quotaResp.Groups {
					gName := g.DisplayName
					if gName == "" {
						gName = "Model Group"
					}
					key := strings.ToLower(strings.TrimSpace(gName))
					if strings.Contains(key, "gemini") && !strings.Contains(key, "argon") {
						hasGemini = true
					}
					if strings.Contains(key, "claude") {
						hasClaude = true
					}
					if seenGroupNames[key] {
						continue
					}
					seenGroupNames[key] = true

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
					mergedGroups = append(mergedGroups, AntigravityQuotaGroup{
						DisplayName: gName,
						Buckets:     buckets,
					})
				}
			}

			if len(mergedGroups) > 0 {
				res = append(res, AntigravityAccountQuota{
					Email:   email,
					Project: project,
					Groups:  mergedGroups,
				})
			}
		}
	}
	antiGravCache = Cache[[]AntigravityAccountQuota]{Value: res, Time: now}
	return res
}

func collectClaudeUsage() *ClaudeUsageData {
	now := time.Now()
	if !claudeCache.Time.IsZero() && now.Sub(claudeCache.Time) < cfg.AntiGravTTL {
		return claudeCache.Value
	}
	// A failed refresh must not keep old measurements looking current.
	claudeCache.Value = nil
	defer func() { claudeCache.Time = now }()

	credPath := "/.claude/.credentials.json"
	raw, err := os.ReadFile(credPath)
	if err != nil {
		log.Printf("Claude read error: %v", err)
		return claudeCache.Value
	}

	var credMap map[string]interface{}
	if err := json.Unmarshal(raw, &credMap); err != nil {
		log.Printf("Claude json error: %v", err)
		return claudeCache.Value
	}
	oauth, _ := credMap["claudeAiOauth"].(map[string]interface{})
	if oauth == nil {
		log.Printf("Claude oauth nil")
		return claudeCache.Value
	}
	token, _ := oauth["accessToken"].(string)
	if token == "" {
		log.Printf("Claude token empty")
		return claudeCache.Value
	}

	client := &http.Client{Timeout: 4 * time.Second}
	req, err := http.NewRequest("GET", "https://api.anthropic.com/api/oauth/usage", nil)
	if err != nil {
		log.Printf("Claude new request err: %v", err)
		return claudeCache.Value
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", "claude-code/2.1.283")

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp != nil {
			log.Printf("Claude request failed with status: %d", resp.StatusCode)
			resp.Body.Close()
		} else {
			log.Printf("Claude request err: %v", err)
		}
		return claudeCache.Value
	}
	defer resp.Body.Close()

	var apiResp struct {
		FiveHour *struct {
			Utilization float64 `json:"utilization"`
			ResetsAt    string  `json:"resets_at"`
		} `json:"five_hour"`
		SevenDay *struct {
			Utilization float64 `json:"utilization"`
			ResetsAt    string  `json:"resets_at"`
		} `json:"seven_day"`
		SevenDayBreakdown struct {
			Rows []struct {
				Key     string `json:"key"`
				Percent int    `json:"percent"`
			} `json:"rows"`
		} `json:"seven_day_breakdown"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		log.Printf("Claude decode error: %v", err)
		return claudeCache.Value
	}

	breakdown := make(map[string]int)
	for _, row := range apiResp.SevenDayBreakdown.Rows {
		breakdown[row.Key] = row.Percent
	}

	result := &ClaudeUsageData{Breakdown: breakdown}
	if apiResp.FiveHour != nil {
		result.FiveHour = &ClaudeUsageWindow{Utilization: apiResp.FiveHour.Utilization, ResetsAt: apiResp.FiveHour.ResetsAt}
	}
	if apiResp.SevenDay != nil {
		result.SevenDay = &ClaudeUsageWindow{Utilization: apiResp.SevenDay.Utilization, ResetsAt: apiResp.SevenDay.ResetsAt}
	}

	claudeCache = Cache[*ClaudeUsageData]{Value: result, Time: now}
	return result
}

func collectCodexUsage() *CodexUsageData {
	now := time.Now()
	if !codexCache.Time.IsZero() && now.Sub(codexCache.Time) < cfg.AntiGravTTL {
		return codexCache.Value
	}
	// A failed refresh must not keep old measurements looking current.
	codexCache.Value = nil
	defer func() { codexCache.Time = now }()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "codex", "app-server", "--stdio")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return codexCache.Value
	}
	defer stdin.Close()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return codexCache.Value
	}
	if err = cmd.Start(); err != nil {
		return codexCache.Value
	}
	defer func() { stdin.Close(); cmd.Process.Kill(); cmd.Wait() }()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	send := func(message string) bool { _, err := io.WriteString(stdin, message+"\n"); return err == nil }
	read := func(id int) (json.RawMessage, bool) {
		for scanner.Scan() {
			var msg struct {
				ID     int             `json:"id"`
				Result json.RawMessage `json:"result"`
				Error  json.RawMessage `json:"error"`
			}
			if json.Unmarshal(scanner.Bytes(), &msg) != nil || msg.ID != id {
				continue
			}
			if len(msg.Error) > 0 && string(msg.Error) != "null" {
				return nil, false
			}
			return msg.Result, len(msg.Result) > 0 && string(msg.Result) != "null"
		}
		return nil, false
	}
	if !send(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"monit","title":"monit","version":"1.0.0"},"capabilities":{}}}`) {
		return codexCache.Value
	}
	if _, ok := read(1); !ok {
		return codexCache.Value
	}
	if !send(`{"jsonrpc":"2.0","method":"initialized","params":{}}`) || !send(`{"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read","params":{}}`) {
		return codexCache.Value
	}
	raw, ok := read(2)
	if !ok {
		return codexCache.Value
	}
	var response struct {
		RateLimits *struct {
			PlanType  string            `json:"planType"`
			Primary   *CodexUsageWindow `json:"primary"`
			Secondary *CodexUsageWindow `json:"secondary"`
		} `json:"rateLimits"`
	}
	if json.Unmarshal(raw, &response) != nil || response.RateLimits == nil {
		return codexCache.Value
	}
	limits := response.RateLimits
	result := &CodexUsageData{PlanType: limits.PlanType, PrimaryWindow: limits.Primary, SecondaryWindow: limits.Secondary}
	codexCache = Cache[*CodexUsageData]{Value: result, Time: now}
	return result
}

// Slow collectors publish independently; only one refresh per source may run.
func refreshSlow(name string, collect func() func(*DashboardState)) {
	slowMu.Lock()
	if slowInFlight[name] {
		slowMu.Unlock()
		return
	}
	slowInFlight[name] = true
	slowMu.Unlock()
	go func() {
		update := collect()
		slowMu.Lock()
		update(&slowState)
		delete(slowInFlight, name)
		slowMu.Unlock()
	}()
}

func refreshSlowCollectors() {
	refreshSlow("pm2", func() func(*DashboardState) { v := collectPM2(); return func(s *DashboardState) { s.PM2 = v } })
	refreshSlow("qb", func() func(*DashboardState) {
		v := collectQBittorrent()
		return func(s *DashboardState) { s.Torrents = v }
	})
	refreshSlow("services", func() func(*DashboardState) {
		v := collectServices()
		return func(s *DashboardState) { s.Services = v }
	})
	refreshSlow("connectivity", func() func(*DashboardState) {
		i, d := collectConnectivity()
		return func(s *DashboardState) { s.Internet = &i; s.DNS = &d }
	})
	refreshSlow("dns", func() func(*DashboardState) {
		v := collectTechnitium()
		return func(s *DashboardState) { s.DNSStats = v }
	})
	refreshSlow("antigravity", func() func(*DashboardState) {
		v := collectAntigravity()
		return func(s *DashboardState) { s.Antigravity = v }
	})
	refreshSlow("claude", func() func(*DashboardState) {
		v := collectClaudeUsage()
		return func(s *DashboardState) { s.ClaudeUsage = v }
	})
	refreshSlow("codex", func() func(*DashboardState) {
		v := collectCodexUsage()
		return func(s *DashboardState) { s.CodexUsage = v }
	})
}

func collectAll() {
	collectMu.Lock()
	defer collectMu.Unlock()
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
	refreshSlowCollectors()
	slowMu.Lock()
	slow := slowState
	slowMu.Unlock()
	pm2List, torrents, services := slow.PM2, slow.Torrents, slow.Services
	internet, dnsStat := slow.Internet, slow.DNS
	dnsStats, antiGrav, claudeUsage, codexUsage := slow.DNSStats, slow.Antigravity, slow.ClaudeUsage, slow.CodexUsage

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
		Internet:    internet,
		DNS:         dnsStat,
		Battery:     battery,
		System:      sysData,
		Torrents:    torrents,
		Services:    services,
		DNSStats:    dnsStats,
		Antigravity: antiGrav,
		ClaudeUsage: claudeUsage,
		CodexUsage:  codexUsage,
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
	pollingMu.Lock()
	lastRequestTime = time.Now()
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

			pollingMu.Lock()
			isHttpActive := time.Since(lastRequestTime) <= cfg.IdleTimeout

			if !hasWs && !isHttpActive {
				isPollingActive = false
				pollingMu.Unlock()
				log.Println("Polling stopped (idle)")
				return
			}

			pollingMu.Unlock()
			collectAll()
			if hasWs {
				broadcastState()
			}
		}
	}()
}

type statsClient struct {
	conn    *websocket.Conn
	request *http.Request
	send    chan []byte
}

func (client *statsClient) write(payload []byte) {
	if !isAuthenticated(client.request) {
		client.conn.Close()
		return
	}
	client.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if err := client.conn.WriteMessage(websocket.TextMessage, payload); err != nil {
		client.conn.Close()
	}
}

func broadcastState() {
	stateMu.RLock()
	payload := lastStateJSON
	stateMu.RUnlock()
	if len(payload) == 0 {
		return
	}
	wsMu.Lock()
	clients := make([]*statsClient, 0, len(wsClients))
	for _, client := range wsClients {
		clients = append(clients, client)
	}
	wsMu.Unlock()
	for _, client := range clients {
		select {
		case client.send <- payload:
		default:
			// Keep only the newest waiting sample; never block the collector on a browser.
			select {
			case <-client.send:
			default:
			}
			select {
			case client.send <- payload:
			default:
			}
		}
	}
}

// --- HTTP Handlers ---

var upgrader = websocket.Upgrader{}

func setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:")
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w)
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip == "" {
		ip = r.RemoteAddr
	}
	if !checkRateLimit(ip) {
		http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
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
		if _, err := rand.Read(b); err != nil {
			http.Error(w, "Session creation failed", http.StatusInternalServerError)
			return
		}
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
			Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
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
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
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

func findPM2Process(name string) *PM2Process {
	procs := collectPM2()
	for i := range procs {
		if strconv.Itoa(procs[i].ID) == name {
			return &procs[i]
		}
	}
	for i := range procs {
		if procs[i].Name == name {
			return &procs[i]
		}
	}
	return nil
}

func handlePM2Control(w http.ResponseWriter, r *http.Request, action, name string) {
	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	target := findPM2Process(name)
	if target == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "Process not found"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if err := exec.CommandContext(ctx, "pm2", action, strconv.Itoa(target.ID)).Run(); err != nil {
		w.WriteHeader(500)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Process %s %sed", name, action),
	})
	pm2Mu.Lock()
	pm2Cache.Time = time.Time{}
	pm2Mu.Unlock()
	ensureActivePolling()
}

func handlePM2Logs(w http.ResponseWriter, r *http.Request, name string, lines int) {
	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	target := findPM2Process(name)
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
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, "tail", "-n", strconv.Itoa(count), "--", path).Output()
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
	qbMu.Lock()
	defer qbMu.Unlock()
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
			// qBittorrent 5.x scopes the session cookie to the WebUI port (for example, QBT_SID_7777); older versions used SID.
			if c.Name == "SID" || strings.HasPrefix(c.Name, "QBT_SID_") {
				qbCookie = c.Name + "=" + c.Value
				return true
			}
		}
		return resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNoContent
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
			ensureActivePolling()
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

func handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WS upgrade error:", err)
		return
	}

	client := &statsClient{conn: conn, request: r, send: make(chan []byte, 1)}
	conn.SetReadLimit(4096)
	conn.SetReadDeadline(time.Now().Add(75 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(75 * time.Second)) })
	stateMu.RLock()
	payload := lastStateJSON
	stateMu.RUnlock()
	if len(payload) > 0 {
		client.write(payload)
	}
	wsMu.Lock()
	wsClients[conn] = client
	wsMu.Unlock()
	ensureActivePolling()
	done := make(chan struct{})
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case payload := <-client.send:
				client.write(payload)
			case <-ticker.C:
				if !isAuthenticated(r) || conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
					conn.Close()
					return
				}
			}
		}
	}()

	defer func() {
		wsMu.Lock()
		delete(wsClients, conn)
		wsMu.Unlock()
		close(done)
		conn.Close()
		<-writerDone
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

// --- Static File Server ---

var staticAssets = func() map[string]bool {
	assets := map[string]bool{"index.html": true, "login.html": true, "style.css": true, "sw.js": true, "manifest.json": true, "icon.svg": true, "icon-192.png": true, "icon-512.png": true}
	for _, name := range strings.Fields("main api config events particles pm2-menu service-bar ui/alerts ui/antigravity ui/battery ui/cpu ui/disk ui/logs-modal ui/memory ui/network ui/pm2 ui/sparklines ui/system ui/thermal ui/torrents utils/dom utils/format") {
		assets["dist/client/"+name+".js"] = true
	}
	assets["dist/shared/types.js"] = true
	return assets
}()

type staticAsset struct {
	modTime        time.Time
	size           int64
	data, gzipData []byte
}

var assetMu sync.Mutex
var assetCache = make(map[string]staticAsset)

func serveStaticFile(w http.ResponseWriter, r *http.Request, relPath string) {
	setSecurityHeaders(w)
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	if !staticAssets[relPath] {
		http.NotFound(w, r)
		return
	}
	root := "/opt/monit"
	fullPath, err := filepath.EvalSymlinks(filepath.Join(root, relPath))
	if err != nil || !strings.HasPrefix(fullPath, root+string(os.PathSeparator)) {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(fullPath)
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	assetMu.Lock()
	asset, ok := assetCache[relPath]
	if !ok || asset.modTime != info.ModTime() || asset.size != info.Size() {
		data, readErr := os.ReadFile(fullPath)
		if readErr != nil {
			assetMu.Unlock()
			http.NotFound(w, r)
			return
		}
		asset = staticAsset{modTime: info.ModTime(), size: info.Size(), data: data}
		if len(data) > 1024 {
			var buf bytes.Buffer
			gz := gzip.NewWriter(&buf)
			gz.Write(data)
			gz.Close()
			if buf.Len() < len(data) {
				asset.gzipData = buf.Bytes()
			}
		}
		assetCache[relPath] = asset
	}
	assetMu.Unlock()
	ext := strings.ToLower(filepath.Ext(relPath))
	mimeMap := map[string]string{".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json"}
	w.Header().Set("Content-Type", mimeMap[ext])
	w.Header().Set("Vary", "Accept-Encoding")
	w.Header().Set("Cache-Control", "private, no-cache")
	if ext == ".html" || relPath == "sw.js" {
		w.Header().Set("Cache-Control", "no-store")
	}
	data := asset.data
	for _, encoding := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		fields := strings.Split(strings.TrimSpace(encoding), ";")
		if fields[0] == "gzip" && len(asset.gzipData) > 0 {
			disabled := false
			for _, param := range fields[1:] {
				pair := strings.SplitN(strings.TrimSpace(param), "=", 2)
				if len(pair) == 2 && pair[0] == "q" {
					q, e := strconv.ParseFloat(pair[1], 64)
					disabled = e != nil || q <= 0
				}
			}
			if !disabled {
				w.Header().Set("Content-Encoding", "gzip")
				data = asset.gzipData
			}
		}
	}
	http.ServeContent(w, r, relPath, asset.modTime, bytes.NewReader(data))
}

func dashboardHandler() http.Handler {
	pm2ControlRe := regexp.MustCompile(`^/api/pm2/(stop|start|restart|delete)/(.+)$`)
	pm2LogsRe := regexp.MustCompile(`^/api/pm2/logs/(.+)$`)
	qbRe := regexp.MustCompile(`^/api/qbittorrent/(delete|pause|resume)/([a-fA-F0-9]{40}|all)$`)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if r.Method == http.MethodPost && r.Header.Get("Origin") != "" {
			origin, err := url.Parse(r.Header.Get("Origin"))
			if err != nil || origin.Host != r.Host || (origin.Scheme != "http" && origin.Scheme != "https") {
				http.Error(w, "Forbidden origin", http.StatusForbidden)
				return
			}
		}

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
			if path != "/" && path != "/index.html" && path != "/login.html" {
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

		// API routes
		if path == "/api/status" {
			if r.Method != http.MethodGet {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			ensureActivePolling()
			setSecurityHeaders(w)
			w.Header().Set("Content-Type", "application/json")
			stateMu.RLock()
			w.Write(lastStateJSON)
			stateMu.RUnlock()
			return
		}

		// PM2 control: /api/pm2/:action/:name
		if m := pm2ControlRe.FindStringSubmatch(path); len(m) == 3 && r.Method == "POST" {
			handlePM2Control(w, r, m[1], m[2])
			return
		}

		// PM2 logs: /api/pm2/logs/:name
		if m := pm2LogsRe.FindStringSubmatch(path); len(m) == 2 && r.Method == "GET" {
			lines := 100
			if l, err := strconv.Atoi(r.URL.Query().Get("lines")); err == nil && l > 0 {
				lines = l
			}
			handlePM2Logs(w, r, m[1], lines)
			return
		}

		// qBittorrent: /api/qbittorrent/:action/:hash
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
}

func main() {
	initConfig()
	initStaticData()
	log.Printf("Starting monit Go server on port %d...", cfg.Port)
	collectAll()
	server := &http.Server{
		Handler:      dashboardHandler(),
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
