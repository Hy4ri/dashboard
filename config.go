package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// --- Configuration ---

type Config struct {
	Port             int
	CollectMS        time.Duration
	IdleTimeout      time.Duration
	DiskCacheTTL     time.Duration
	PM2CacheTTL      time.Duration
	ThermalCacheTTL  time.Duration
	QBCacheTTL       time.Duration
	ConnCacheTTL     time.Duration
	AntiGravTTL      time.Duration
	CodexTTL         time.Duration
	AntiGravAuthsDir string
	AntiGravEndpoint string
	TechnitiumToken  string
	TechnitiumURL    string
	AuthUser         string
	AuthPass         string
	QBHost           string
	QBPort           int
	QBUser           string
	QBPass           string
	TrustProxy       bool
	NetIfaces        []string
	ThermalZones     []string
	AppRoot          string
	ClaudeCreds      string
	Services         []ServiceStatus
}

var cfg Config

// defaultAppRoot is the directory of the running executable, so the server
// finds its files whichever directory starts it.
func defaultAppRoot() string {
	if exe, err := os.Executable(); err == nil {
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			exe = resolved
		}
		return filepath.Dir(exe)
	}
	return "/opt/monit"
}

func splitList(value string, fallback []string) []string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	parts := strings.Split(value, ",")
	res := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			res = append(res, p)
		}
	}
	if len(res) == 0 {
		return fallback
	}
	return res
}

func loadDotEnv() {
	paths := []string{".env", filepath.Join(defaultAppRoot(), ".env")}
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

// envDuration accepts a Go duration ("5m") or a plain number of seconds.
func envDuration(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return d
	}
	if secs, err := strconv.Atoi(raw); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	return fallback
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
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
		Port:             port,
		CollectMS:        3000 * time.Millisecond,
		IdleTimeout:      10000 * time.Millisecond,
		DiskCacheTTL:     120 * time.Second,
		PM2CacheTTL:      5 * time.Second,
		ThermalCacheTTL:  5 * time.Second,
		QBCacheTTL:       10 * time.Second,
		ConnCacheTTL:     10 * time.Second,
		AntiGravTTL:      30 * time.Second,
		CodexTTL:         envDuration("CODEX_TTL", 5*time.Minute),
		AntiGravAuthsDir: "/opt/cliproxyapi/auths",
		TechnitiumToken:  os.Getenv("TECHNITIUM_TOKEN"),
		TechnitiumURL:    techURL,
		AuthUser:         authUser,
		AuthPass:         os.Getenv("AUTH_PASS"),
		QBHost:           qbHost,
		QBPort:           qbPort,
		QBUser:           qbUser,
		QBPass:           os.Getenv("QB_PASS"),
		TrustProxy:       os.Getenv("TRUST_PROXY") == "true" || os.Getenv("TRUST_PROXY") == "1",
		NetIfaces:        splitList(os.Getenv("NET_IFACES"), []string{"wlan0", "tun0"}),
		ThermalZones:     splitList(os.Getenv("THERMAL_ZONES"), []string{"cpu-1-6-step", "battery", "gpuss-0-step", "ddr-usr"}),
		AppRoot:          envOr("APP_ROOT", defaultAppRoot()),
		ClaudeCreds:      envOr("CLAUDE_CREDENTIALS", "/.claude/.credentials.json"),
		Services:         parseServices(os.Getenv("SERVICES")),
	}
	initCaches()
}

// initCaches applies the configured TTLs. The caches are package-level, so
// they cannot read cfg at construction time.
func initCaches() {
	diskCache = newCache[*DiskUsage](cfg.DiskCacheTTL)
	pm2Cache = newCache[[]PM2Process](cfg.PM2CacheTTL)
	thermalCache = newCache[[]ThermalSensor](cfg.ThermalCacheTTL)
	qbCache = newCache[[]TorrentItem](cfg.QBCacheTTL)
	connCache = newCache[connStatus](cfg.ConnCacheTTL)
	antiGravCache = newCache[[]AntigravityAccountQuota](cfg.AntiGravTTL)
	claudeCache = newCache[*ClaudeUsageData](cfg.AntiGravTTL)
	codexCache = newCache[*CodexUsageData](cfg.CodexTTL)
}
