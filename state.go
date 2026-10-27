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
	diskCache        = newCache[*DiskUsage](0)
	pm2Cache         = newCache[[]PM2Process](0)
	freqCache        = newCache[[]CpuFrequency](0)
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
	slowInFlight     = make(map[string]bool)
)

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

func invalidateAllCaches() {
	diskCache.Invalidate()
	pm2Cache.Invalidate()
	freqCache.Invalidate()
	thermalCache.Invalidate()
	qbCache.Invalidate()
	connCache.Invalidate()
	antiGravCache.Invalidate()
	claudeCache.Invalidate()
	codexCache.Invalidate()
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
