package main

import (
	"encoding/json"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// --- State and Cache ---

type ProcStatCpu struct {
	Total float64
	Idle  float64
}

type PrevState struct {
	CPUOverall *ProcStatCpu
	CPUCores   map[string]ProcStatCpu
	Net        map[string][2]int64 // rx, tx
	Time       time.Time
}

type ThermalPathItem struct {
	Name string
	Path string
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
	thermalPaths     []ThermalPathItem
	diskCache        = newCache[*DiskUsage](0)
	pm2Cache         = newCache[[]PM2Process](0)
	thermalCache     = newCache[[]ThermalSensor](0)
	qbCache          = newCache[[]TorrentItem](0)
	connCache        = newCache[connStatus](0)
	antiGravCache    = newCache[[]AntigravityAccountQuota](0)
	claudeCache      = newCache[*ClaudeUsageData](0)
	codexCache       = newCache[*CodexUsageData](0)
	wsClients        = make(map[*websocket.Conn]*statsClient)
	wsMu             sync.Mutex
	sessions         = make(map[string]time.Time)
	sessionsMu       sync.RWMutex
	rateLimiterMap   = make(map[string][]time.Time)
	rateLimiterMu    sync.Mutex
	lastLimiterSweep time.Time
	collectMu        sync.Mutex
	slowMu           sync.Mutex
	slowState        DashboardState
	slowInFlight     = make(map[string]chan struct{})
)

// slowSources are the collectors that do network or process work. Each one
// publishes its result on its own, so a slow source never delays the ticker.
var slowSources = []struct {
	name string
	load func() func(*DashboardState)
}{
	{"pm2", func() func(*DashboardState) {
		v := collectPM2()
		return func(s *DashboardState) { s.PM2 = v }
	}},
	{"qb", func() func(*DashboardState) {
		v := collectQBittorrent()
		return func(s *DashboardState) { s.Torrents = v }
	}},
	{"services", func() func(*DashboardState) {
		v := collectServices()
		return func(s *DashboardState) { s.Services = v }
	}},
	{"connectivity", func() func(*DashboardState) {
		i, d := collectConnectivity()
		return func(s *DashboardState) { s.Internet = &i; s.DNS = &d }
	}},
	{"dns", func() func(*DashboardState) {
		v := collectTechnitium()
		return func(s *DashboardState) { s.DNSStats = v }
	}},
	{"antigravity", func() func(*DashboardState) {
		v := collectAntigravity()
		return func(s *DashboardState) { s.Antigravity = v }
	}},
	{"claude", func() func(*DashboardState) {
		v := collectClaudeUsage()
		return func(s *DashboardState) { s.ClaudeUsage = v }
	}},
	{"codex", func() func(*DashboardState) {
		v := collectCodexUsage()
		return func(s *DashboardState) { s.CodexUsage = v }
	}},
}

// refreshSlow starts one source unless it already runs, and returns a channel
// that closes when that source published. Callers wait on it to get fresh data.
func refreshSlow(name string, collect func() func(*DashboardState)) <-chan struct{} {
	slowMu.Lock()
	if done, ok := slowInFlight[name]; ok {
		slowMu.Unlock()
		return done
	}
	done := make(chan struct{})
	slowInFlight[name] = done
	slowMu.Unlock()

	go func() {
		update := collect()
		slowMu.Lock()
		update(&slowState)
		delete(slowInFlight, name)
		slowMu.Unlock()
		close(done)
	}()
	return done
}

func refreshSlowCollectors() []<-chan struct{} {
	pending := make([]<-chan struct{}, 0, len(slowSources))
	for _, source := range slowSources {
		pending = append(pending, refreshSlow(source.name, source.load))
	}
	return pending
}

// refreshSlowCollectorsAndWait starts every slow source and waits until all of
// them publish, or until the total timeout ends.
func refreshSlowCollectorsAndWait(timeout time.Duration) {
	pending := refreshSlowCollectors()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for _, done := range pending {
		select {
		case <-done:
		case <-timer.C:
			return
		}
	}
}

func invalidateAllCaches() {
	diskCache.Invalidate()
	pm2Cache.Invalidate()
	thermalCache.Invalidate()
	qbCache.Invalidate()
	connCache.Invalidate()
	antiGravCache.Invalidate()
	claudeCache.Invalidate()
	codexCache.Invalidate()
}

// fastSample holds the metrics read from /proc on the last tick.
type fastSample struct {
	cpu     *float64
	cores   []*float64
	thermal []ThermalSensor
	load    []float64
	mem     *MemoryData
	swap    *SwapData
	disk    *DiskData
	network map[string]NetworkInterface
	battery *BatteryData
	system  *SystemData
}

var fastState fastSample

// sampleFast reads the fast /proc metrics and advances the CPU and byte
// counters. Only the polling ticker calls it: a refresh must not move the
// counter baseline, or the next CPU percentage is measured over milliseconds.
func sampleFast() {
	collectMu.Lock()
	defer collectMu.Unlock()
	now := time.Now()
	interval := now.Sub(prevState.Time).Seconds()

	statText, _ := readFileString("/proc/stat")
	netText, _ := readFileString("/proc/net/dev")
	loadText, _ := readFileString("/proc/loadavg")
	memText, _ := readFileString("/proc/meminfo")

	cpuOverall, cpuCores := collectCPU(statText, interval)
	network := collectNetwork(netText, interval)
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
		}
	}

	fastState = fastSample{
		cpu:     cpuOverall,
		cores:   cpuCores,
		thermal: collectThermal(),
		load:    loadavg,
		mem:     memData,
		swap:    swapData,
		disk:    diskData,
		network: network,
		battery: collectBattery(),
		system:  collectSystem(),
	}
}

// publishState combines the last fast sample with the last slow results.
func publishState() {
	collectMu.Lock()
	empty := fastState.system == nil
	collectMu.Unlock()
	if empty {
		// A refresh can arrive before the first tick; publish needs one sample.
		sampleFast()
	}

	collectMu.Lock()
	fast := fastState
	slowMu.Lock()
	slow := slowState
	slowMu.Unlock()
	collectMu.Unlock()

	newState := DashboardState{
		Timestamp:   time.Now().UnixMilli(),
		PM2:         slow.PM2,
		CPU:         fast.cpu,
		CPUCores:    fast.cores,
		Thermal:     fast.thermal,
		LoadAvg:     fast.load,
		Memory:      fast.mem,
		Swap:        fast.swap,
		Disk:        fast.disk,
		Network:     fast.network,
		Internet:    slow.Internet,
		DNS:         slow.DNS,
		Battery:     fast.battery,
		System:      fast.system,
		Torrents:    slow.Torrents,
		Services:    slow.Services,
		DNSStats:    slow.DNSStats,
		Antigravity: slow.Antigravity,
		ClaudeUsage: slow.ClaudeUsage,
		CodexUsage:  slow.CodexUsage,
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

func collectAll() {
	sampleFast()
	publishState()
}

func ensureActivePolling() {
	pollingMu.Lock()
	lastRequestTime = time.Now()
	defer pollingMu.Unlock()
	if isPollingActive {
		return
	}
	interval := cfg.CollectMS
	if interval <= 0 {
		interval = 2 * time.Second
	}
	isPollingActive = true
	log.Println("Polling started (active client/WS connection)")

	go func() {
		collectAll()
		broadcastState()

		ticker := time.NewTicker(interval)
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
