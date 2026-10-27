package main

// --- Data Models (matching shared/types.ts 100%) ---

type PM2Process struct {
	ID       int         `json:"id"`
	Name     string      `json:"name"`
	Status   string      `json:"status"`
	CPU      float64     `json:"cpu"`
	Memory   int64       `json:"memory"`
	Restarts int         `json:"restarts"`
	PID      int         `json:"-"` // used only to keep restart-all from killing itself
	Full     interface{} `json:"-"`
}

type ThermalSensor struct {
	Name string  `json:"name"`
	Temp float64 `json:"temp"`
}

type DiskUsage struct {
	Total     uint64  `json:"total"`
	Used      uint64  `json:"used"`
	Available uint64  `json:"available"`
	UsedPct   float64 `json:"used_pct,omitempty"`
}

type DiskData struct {
	Total     uint64  `json:"total,omitempty"`
	Used      uint64  `json:"used,omitempty"`
	Available uint64  `json:"available,omitempty"`
	UsedPct   float64 `json:"used_pct,omitempty"`
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
}

// SystemData carries only the hostname: it is the one system field the UI uses.
type SystemData struct {
	Hostname *string `json:"hostname"`
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
	Services    []ServiceStatus             `json:"services,omitempty"`
	DNSStats    *TechnitiumStats            `json:"dnsStats,omitempty"`
	Antigravity []AntigravityAccountQuota   `json:"antigravity,omitempty"`
	ClaudeUsage *ClaudeUsageData            `json:"claudeUsage,omitempty"`
	CodexUsage  *CodexUsageData             `json:"codexUsage,omitempty"`
	AuthEnabled bool                        `json:"authEnabled"`
}
