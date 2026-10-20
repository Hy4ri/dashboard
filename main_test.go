package main

import (
	"encoding/json"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestStaticRejectsPrivateFiles(t *testing.T) {
	for _, path := range []string{"main.go", "go.mod", "package.json", ".git/HEAD", "vendor/xterm.min.js", "dist/client/ui/terminal.js", "../monit-other/file"} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			serveStaticFile(w, httptest.NewRequest("GET", "/"+path, nil), path)
			if w.Code != http.StatusNotFound && w.Code != http.StatusForbidden {
				t.Fatalf("private path %q served: %d", path, w.Code)
			}
		})
	}
}

func TestPM2PayloadExcludesRawEnvironment(t *testing.T) {
	b, err := json.Marshal(PM2Process{ID: 1, Full: map[string]any{"pm2_env": map[string]any{"SAMPLE_PRIVATE_TOKEN": "fixture"}}})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "_full") || strings.Contains(string(b), "SAMPLE_PRIVATE_TOKEN") {
		t.Fatal("raw PM2 metadata is exposed")
	}
}

func TestEmptyTorrentsClearPreviousResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
	}))
	defer server.Close()
	oldCfg, oldCache, oldCookie := cfg, qbCache, qbCookie
	defer func() { cfg, qbCache, qbCookie = oldCfg, oldCache, oldCookie }()
	u, _ := url.Parse(server.URL)
	cfg.QBHost = u.Hostname()
	cfg.QBPort = mustPort(t, u.Port())
	cfg.QBCacheTTL = time.Second
	qbCache = Cache[[]TorrentItem]{Value: []TorrentItem{{Hash: "old"}}}
	qbCookie = ""
	got := collectQBittorrent()
	if got == nil || len(got) != 0 {
		t.Fatalf("empty response returned stale torrents: %+v", got)
	}
	if qbCache.Time.IsZero() {
		t.Fatal("successful empty response was not cached")
	}
}

func TestLoginRateLimited(t *testing.T) {
	oldCfg := cfg
	defer func() { cfg = oldCfg }()
	cfg.AuthUser, cfg.AuthPass = "test", "expected"
	rateLimiterMu.Lock()
	rateLimiterMap = make(map[string][]time.Time)
	rateLimiterMu.Unlock()
	for i := 0; i < 11; i++ {
		req := httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"username":"test","password":"wrong"}`))
		req.RemoteAddr = "192.0.2.1:4567"
		w := httptest.NewRecorder()
		handleLogin(w, req)
		if i == 10 && w.Code != http.StatusTooManyRequests {
			t.Fatalf("login bypassed limit: %d", w.Code)
		}
	}
}

func TestCodexRPCErrorIsNotZeroUsage(t *testing.T) {
	oldCfg, oldCache := cfg, codexCache
	defer func() { cfg = oldCfg; codexCache = oldCache }()
	cfg.AntiGravTTL = time.Minute
	codexCache = Cache[*CodexUsageData]{Value: &CodexUsageData{PlanType: "old-fixture", PrimaryWindow: &CodexUsageWindow{UsedPercent: 20}}}
	dir := t.TempDir()
	script := "#!/bin/sh\nread init\nprintf '%s\\n' '{\"id\":1,\"result\":{}}'\nread notified\nread limits\nprintf '%s\\n' '{\"id\":2,\"error\":{\"code\":-1,\"message\":\"fixture unavailable\"}}'\n"
	if err := os.WriteFile(filepath.Join(dir, "codex"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))
	if got := collectCodexUsage(); got != nil {
		t.Fatalf("RPC error manufactured quota: %+v", got)
	}
	if codexCache.Time.IsZero() {
		t.Fatal("failed request must be throttled")
	}
}

func TestHTTPRoutesAndWebsocket(t *testing.T) {
	oldCfg := cfg
	cfg.AuthPass = ""
	pollingMu.Lock()
	isPollingActive = true
	pollingMu.Unlock()
	stateMu.Lock()
	oldJSON := lastStateJSON
	lastStateJSON = []byte(`{"timestamp":1,"pm2":[],"torrents":[]}`)
	stateMu.Unlock()
	server := httptest.NewServer(dashboardHandler())
	defer func() {
		server.Close()
		cfg = oldCfg
		pollingMu.Lock()
		isPollingActive = false
		pollingMu.Unlock()
		stateMu.Lock()
		lastStateJSON = oldJSON
		stateMu.Unlock()
	}()
	for _, item := range []struct {
		path string
		want int
	}{{"/", 200}, {"/api/status", 200}, {"/main.go", 404}, {"/ws/terminal", 404}} {
		response, err := http.Get(server.URL + item.path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != item.want {
			t.Fatalf("%s: %d", item.path, response.StatusCode)
		}
	}
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	headers := http.Header{"Origin": []string{"http://evil.invalid"}}
	if conn, resp, err := websocket.DefaultDialer.Dial(wsURL, headers); err == nil {
		conn.Close()
		t.Fatal("cross-origin socket accepted")
	} else if resp == nil || resp.StatusCode != 403 {
		t.Fatalf("origin rejection: %v", err)
	}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(time.Second))
	_, payload, err := conn.ReadMessage()
	if err != nil || !json.Valid(payload) {
		t.Fatalf("initial WS packet invalid: %s %v", payload, err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); broadcastState() }()
	}
	wg.Wait()
	conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatal(err)
	}
	conn.Close()
}

func TestAuthRejectsAPIsAndAssetsWithoutServingLoginHTML(t *testing.T) {
	old := cfg
	defer func() { cfg = old }()
	cfg.AuthPass = "fixture"
	handler := dashboardHandler()
	for _, path := range []string{"/api/status", "/ws", "/dist/client/main.js"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 401 || strings.Contains(w.Body.String(), "<html") {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
		}
	}
}

func TestFastCollectionDoesNotWaitOnSlowCollectors(t *testing.T) {
	// Fence each slow source as already in flight: no real integrations/credentials are accessed.
	slowMu.Lock()
	for _, name := range []string{"pm2", "qb", "services", "connectivity", "dns", "antigravity", "claude", "codex"} {
		slowInFlight[name] = true
	}
	slowMu.Unlock()
	defer func() { slowMu.Lock(); slowInFlight = make(map[string]bool); slowMu.Unlock() }()
	start := time.Now()
	collectAll()
	if time.Since(start) > time.Second {
		t.Fatal("fast metrics waited on slow work")
	}
	stateMu.RLock()
	cpuPresent := globalState.Memory != nil
	stateMu.RUnlock()
	if !cpuPresent {
		t.Fatal("system metrics not published")
	}
}

func TestPM2ControlResolvesKnownNamesToIDs(t *testing.T) {
	oldCfg, oldCache := cfg, pm2Cache
	defer func() {
		cfg = oldCfg
		pm2Cache = oldCache
		pollingMu.Lock()
		isPollingActive = false
		pollingMu.Unlock()
	}()
	cfg.PM2CacheTTL = time.Minute
	pm2Cache = Cache[[]PM2Process]{Value: []PM2Process{{ID: 7, Name: "A&B"}}, Time: time.Now()}
	pollingMu.Lock()
	isPollingActive = true
	pollingMu.Unlock()
	dir := t.TempDir()
	output := filepath.Join(dir, "args")
	if err := os.WriteFile(filepath.Join(dir, "pm2"), []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$MONIT_FAKE_ARGS\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))
	t.Setenv("MONIT_FAKE_ARGS", output)
	w := httptest.NewRecorder()
	handlePM2Control(w, httptest.NewRequest("POST", "/api/pm2/restart/A&B", nil), "restart", "A&B")
	if w.Code != 200 {
		t.Fatalf("valid name rejected: %d %s", w.Code, w.Body.String())
	}
	args, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(args) != "restart\n7\n" {
		t.Fatalf("wrong PM2 target: %q", args)
	}
	w = httptest.NewRecorder()
	handlePM2Control(w, httptest.NewRequest("POST", "/api/pm2/start/unknown", nil), "start", "unknown")
	if w.Code != 404 {
		t.Fatalf("unknown target accepted: %d", w.Code)
	}
}

func TestFailedTorrentRefreshDoesNotMasqueradeAsFreshData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }))
	defer server.Close()
	oldCfg, oldCache, oldCookie := cfg, qbCache, qbCookie
	defer func() { cfg = oldCfg; qbCache = oldCache; qbCookie = oldCookie }()
	u, _ := url.Parse(server.URL)
	cfg.QBHost = u.Hostname()
	cfg.QBPort = mustPort(t, u.Port())
	cfg.QBPass = ""
	cfg.QBCacheTTL = time.Minute
	qbCache = Cache[[]TorrentItem]{Value: []TorrentItem{{Hash: "old"}}}
	qbCookie = ""
	if got := collectQBittorrent(); got != nil {
		t.Fatalf("stale torrents presented as fresh: %+v", got)
	}
	if qbCache.Time.IsZero() {
		t.Fatal("failure retry not throttled")
	}
}

func BenchmarkStaticCSS(b *testing.B) {
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/style.css", nil)
		req.Header.Set("Accept-Encoding", "gzip")
		serveStaticFile(w, req, "style.css")
		if w.Code != 200 {
			b.Fatal(w.Code)
		}
	}
}

func mustPort(t *testing.T, s string) int {
	t.Helper()
	var n int
	for _, c := range s {
		n = n*10 + int(c-'0')
	}
	return n
}

func TestCPUGuestTimeNotCountedTwice(t *testing.T) {
	old := prevState
	defer func() { prevState = old }()
	prevState = PrevState{}
	collectCPU("cpu 100 0 0 100 0 0 0 0 50 0\ncpu0 100 0 0 100 0 0 0 0 50 0", 1)
	pct, _ := collectCPU("cpu 200 0 0 200 0 0 0 0 100 0\ncpu0 200 0 0 200 0 0 0 0 100 0", 1)
	if pct == nil || *pct != 50 {
		t.Fatalf("guest time double-counted, got %v", pct)
	}
}

func TestAntigravityCollectAndMergeWithArgon(t *testing.T) {
	oldCfg, oldCache := cfg, antiGravCache
	defer func() { cfg = oldCfg; antiGravCache = oldCache }()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := `{
			"groups": [
				{
					"displayName": "Gemini Models",
					"buckets": [
						{"bucketId": "gemini-weekly", "displayName": "Weekly Limit", "window": "weekly", "remainingFraction": 0.85},
						{"bucketId": "gemini-5h", "displayName": "Five Hour Limit", "window": "5h", "remainingFraction": 1.0}
					]
				},
				{
					"displayName": "Claude and GPT models",
					"buckets": [
						{"bucketId": "3p-weekly", "displayName": "Weekly Limit", "window": "weekly", "remainingFraction": 0.5}
					]
				},
				{
					"displayName": "Gemini 4 Argon",
					"buckets": [
						{"bucketId": "gemini-argon-wtu-weekly", "displayName": "Gemini 4 Argon Weekly Limit", "window": "weekly", "remainingFraction": 0.9}
					]
				}
			]
		}`
		w.Write([]byte(resp))
	}))
	defer ts.Close()

	dir := t.TempDir()
	authData := `{"access_token":"fake-token","email":"test@example.com","project_id":"fake-proj"}`
	if err := os.WriteFile(filepath.Join(dir, "antigravity-test@example.com.json"), []byte(authData), 0600); err != nil {
		t.Fatal(err)
	}

	cfg.AntiGravAuthsDir = dir
	cfg.AntiGravEndpoint = ts.URL
	cfg.AntiGravTTL = time.Minute
	antiGravCache = Cache[[]AntigravityAccountQuota]{}

	res := collectAntigravity()
	if len(res) != 1 {
		t.Fatalf("expected 1 account, got %d", len(res))
	}
	if len(res[0].Groups) != 3 {
		t.Fatalf("expected 3 groups, got %d", len(res[0].Groups))
	}
	if res[0].Groups[0].DisplayName != "Gemini Models" || res[0].Groups[0].Buckets[0].RemainingPct != 85 {
		t.Fatalf("unexpected group 0: %+v", res[0].Groups[0])
	}
	if res[0].Groups[2].DisplayName != "Gemini 4 Argon" || res[0].Groups[2].Buckets[0].RemainingPct != 90 {
		t.Fatalf("unexpected Argon group: %+v", res[0].Groups[2])
	}
}
