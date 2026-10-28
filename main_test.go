package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/gorilla/websocket"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	// Static-file tests serve from the package directory.
	if wd, err := os.Getwd(); err == nil {
		cfg.AppRoot = wd
	}
	os.Exit(m.Run())
}

func TestStaticRejectsPrivateFiles(t *testing.T) {
	for _, path := range []string{"main.go", "go.mod", "package.json", ".git/HEAD", "vendor/xterm.min.js", "dist/client/does-not-exist.js", "../monit-other/file"} {
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
	oldCfg, oldCache := cfg, qbCache
	defer func() {
		cfg, qbCache = oldCfg, oldCache
		qbCache.setForTest(nil)
		qb.setCookie("")
	}()
	u, _ := url.Parse(server.URL)
	cfg.QBHost = u.Hostname()
	cfg.QBPort = mustPort(t, u.Port())
	cfg.QBCacheTTL = time.Second
	initCaches()
	qbCache.setStale([]TorrentItem{{Hash: "old"}})
	qb.setCookie("")
	got := collectQBittorrent()
	if got == nil || len(got) != 0 {
		t.Fatalf("empty response returned stale torrents: %+v", got)
	}
	if !qbCache.isFresh() {
		t.Fatal("successful empty response was not cached")
	}
}

func TestLoginLockoutAfterFiveFailures(t *testing.T) {
	oldCfg := cfg
	defer func() { cfg = oldCfg }()
	cfg.AuthUser, cfg.AuthPass = "test", "expected"
	rateLimiterMu.Lock()
	rateLimiterMap = make(map[string][]time.Time)
	rateLimiterMu.Unlock()
	loginFailuresMu.Lock()
	loginFailures = make(map[string][]time.Time)
	loginFailuresMu.Unlock()

	attempt := func(password string) int {
		body := `{"username":"test","password":"` + password + `"}`
		req := httptest.NewRequest("POST", "/api/login", strings.NewReader(body))
		req.RemoteAddr = "192.0.2.1:4567"
		w := httptest.NewRecorder()
		handleLogin(w, req)
		return w.Code
	}

	for i := 0; i < 5; i++ {
		if code := attempt("wrong"); code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i+1, code)
		}
	}
	if code := attempt("wrong"); code != http.StatusTooManyRequests {
		t.Fatalf("sixth failure not locked out: %d", code)
	}
	if code := attempt("expected"); code != http.StatusTooManyRequests {
		t.Fatalf("correct password bypassed the lockout: %d", code)
	}

	// After the window expires the entry is dropped and a good login works.
	loginFailuresMu.Lock()
	loginFailures = make(map[string][]time.Time)
	loginFailuresMu.Unlock()
	if code := attempt("expected"); code != http.StatusOK {
		t.Fatalf("correct password rejected after the lockout: %d", code)
	}
}

func TestCodexRPCErrorIsNotZeroUsage(t *testing.T) {
	oldCfg, oldCache := cfg, codexCache
	defer func() { cfg = oldCfg; codexCache = oldCache }()
	cfg.CodexTTL = time.Minute
	initCaches()
	codexCache.setStale(&CodexUsageData{PlanType: "old-fixture", PrimaryWindow: &CodexUsageWindow{UsedPercent: 20}})
	dir := t.TempDir()
	script := "#!/bin/sh\nread init\nprintf '%s\\n' '{\"id\":1,\"result\":{}}'\nread notified\nread limits\nprintf '%s\\n' '{\"id\":2,\"error\":{\"code\":-1,\"message\":\"fixture unavailable\"}}'\n"
	if err := os.WriteFile(filepath.Join(dir, "codex"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+":"+os.Getenv("PATH"))
	if got := collectCodexUsage(); got != nil {
		t.Fatalf("RPC error manufactured quota: %+v", got)
	}
	if !codexCache.isFresh() {
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

func TestRefreshEndpointInvalidatesCachesAndReturnsState(t *testing.T) {
	oldCfg := cfg
	defer func() {
		cfg = oldCfg
		pollingMu.Lock()
		isPollingActive = false
		pollingMu.Unlock()
	}()
	cfg.AuthPass = ""
	cfg.CollectMS = 100 * time.Millisecond
	cfg.IdleTimeout = 100 * time.Millisecond

	// Seed cache with dummy data
	initCaches()
	antiGravCache.setForTest([]AntigravityAccountQuota{{Email: "dummy@test.com"}})

	// Drop the slow sources so this test makes no external calls.
	oldSources := slowSources
	slowSources = nil
	defer func() { slowSources = oldSources }()

	handler := dashboardHandler()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/refresh", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var res DashboardState
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}

	// Verify cache was invalidated
	if got := antiGravCache.peek(); len(got) != 0 {
		t.Fatalf("expected antiGravCache to be cleared, got %v", got)
	}
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
		slowInFlight[name] = make(chan struct{})
	}
	slowMu.Unlock()
	defer func() {
		slowMu.Lock()
		slowInFlight = make(map[string]chan struct{})
		slowMu.Unlock()
	}()
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

func TestPM2ControlRequiresNumericID(t *testing.T) {
	oldCfg, oldCache, oldRun, oldLoader := cfg, pm2Cache, pm2Run, pm2Loader
	defer func() {
		cfg, pm2Cache, pm2Run, pm2Loader = oldCfg, oldCache, oldRun, oldLoader
		pollingMu.Lock()
		isPollingActive = false
		pollingMu.Unlock()
	}()
	cfg.PM2CacheTTL = time.Minute
	initCaches()
	pm2Cache.setForTest([]PM2Process{{ID: 7, Name: "A&B"}, {ID: 3, Name: "3"}})
	pm2Loader = func() ([]PM2Process, bool) { return []PM2Process{{ID: 7, Name: "A&B"}, {ID: 3, Name: "3"}}, true }
	pollingMu.Lock()
	isPollingActive = true
	pollingMu.Unlock()

	var calls []string
	pm2Run = func(ctx context.Context, args ...string) error {
		calls = append(calls, strings.Join(args, " "))
		return nil
	}

	w := httptest.NewRecorder()
	handlePM2Control(w, httptest.NewRequest("POST", "/api/pm2/restart/7", nil), "restart", 7)
	if w.Code != 200 {
		t.Fatalf("valid id rejected: %d %s", w.Code, w.Body.String())
	}
	if len(calls) != 1 || calls[0] != "restart 7" {
		t.Fatalf("wrong PM2 target: %q", calls)
	}
	var body map[string]any
	json.Unmarshal(w.Body.Bytes(), &body)
	if body["message"] != "Process A&B restarted" {
		t.Fatalf("wrong message: %v", body["message"])
	}

	w = httptest.NewRecorder()
	handlePM2Control(w, httptest.NewRequest("POST", "/api/pm2/start/99", nil), "start", 99)
	if w.Code != 404 {
		t.Fatalf("unknown id accepted: %d", w.Code)
	}

	// Names must not resolve, even when the name is a number.
	if regexp.MustCompile(`^/api/pm2/(stop|start|restart|delete)/(\d+)$`).MatchString("/api/pm2/restart/A%26B") {
		t.Fatal("name route accepted")
	}
	if !regexp.MustCompile(`^/api/pm2/(stop|start|restart|delete)/(\d+)$`).MatchString("/api/pm2/restart/7") {
		t.Fatal("id route rejected")
	}
}

func TestPM2RestartAllRestartsSelfLast(t *testing.T) {
	oldCfg, oldCache, oldRun, oldLoader := cfg, pm2Cache, pm2Run, pm2Loader
	defer func() {
		cfg, pm2Cache, pm2Run, pm2Loader = oldCfg, oldCache, oldRun, oldLoader
	}()
	cfg.PM2CacheTTL = time.Minute
	initCaches()
	self := os.Getpid()
	pm2Cache.setForTest([]PM2Process{{ID: 1, Name: "worker", PID: 111}, {ID: 2, Name: "dashboard", PID: self}})
	pm2Loader = func() ([]PM2Process, bool) {
		return []PM2Process{{ID: 1, Name: "worker", PID: 111}, {ID: 2, Name: "dashboard", PID: self}}, true
	}

	mu := sync.Mutex{}
	var calls []string
	pm2Run = func(ctx context.Context, args ...string) error {
		mu.Lock()
		calls = append(calls, strings.Join(args, " "))
		mu.Unlock()
		return nil
	}

	w := httptest.NewRecorder()
	handlePM2RestartAll(w, httptest.NewRequest("POST", "/api/pm2/restart-all", nil))
	if w.Code != 200 {
		t.Fatalf("restart-all failed: %d %s", w.Code, w.Body.String())
	}
	mu.Lock()
	before := append([]string(nil), calls...)
	mu.Unlock()
	if len(before) != 1 || before[0] != "restart 1" {
		t.Fatalf("self restarted before the response: %q", before)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(calls)
		last := ""
		if n > 0 {
			last = calls[n-1]
		}
		mu.Unlock()
		if n == 2 && last == "restart 2" {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	t.Fatalf("self was not restarted after the response: %q", calls)
}

func TestFailedTorrentRefreshDoesNotMasqueradeAsFreshData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }))
	defer server.Close()
	oldCfg, oldCache := cfg, qbCache
	defer func() {
		cfg, qbCache = oldCfg, oldCache
		qbCache.setForTest(nil)
		qb.setCookie("")
	}()
	u, _ := url.Parse(server.URL)
	cfg.QBHost = u.Hostname()
	cfg.QBPort = mustPort(t, u.Port())
	cfg.QBPass = ""
	cfg.QBCacheTTL = time.Minute
	initCaches()
	qbCache.setStale([]TorrentItem{{Hash: "old"}})
	qb.setCookie("")
	if got := collectQBittorrent(); got != nil {
		t.Fatalf("stale torrents presented as fresh: %+v", got)
	}
	if !qbCache.isFresh() {
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
		// Legacy client identities receive only third-party quotas upstream.
		if r.UserAgent() != "antigravity/cli/1.4.3" {
			t.Errorf("quota summary requires supported CLI identity, got %q", r.UserAgent())
			w.Write([]byte(`{"groups":[{"displayName":"Claude and GPT models","buckets":[{"bucketId":"3p-weekly","window":"weekly","remainingFraction":0.5}]}]}`))
			return
		}
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
	initCaches()
	antiGravCache.Invalidate()

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

func TestExtractJSONArray(t *testing.T) {
	banner := "\n\x1b[31m\x1b[1m>>>> In-memory PM2 is out-of-date, do:\x1b[22m\x1b[39m\n>>>> $ pm2 update\n[{\"name\":\"test-proc\",\"pm_id\":1}]\n"
	cleaned := extractJSONArray([]byte(banner))
	var raw []map[string]interface{}
	if err := json.Unmarshal(cleaned, &raw); err != nil {
		t.Fatalf("expected valid json, got err: %v", err)
	}
	if len(raw) != 1 || raw[0]["name"] != "test-proc" {
		t.Fatalf("unexpected unmarshaled result: %+v", raw)
	}

	emptyCleaned := extractJSONArray([]byte("prefix banner\n[]\n"))
	if err := json.Unmarshal(emptyCleaned, &raw); err != nil {
		t.Fatalf("expected valid empty json array, got err: %v", err)
	}
	if len(raw) != 0 {
		t.Fatalf("expected 0 items, got %d", len(raw))
	}
}

func TestCacheConcurrentInvalidateAndLoad(t *testing.T) {
	c := newCache[int](time.Hour)
	c.setForTest(1)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(3)
		go func() { defer wg.Done(); c.Invalidate() }()
		go func() { defer wg.Done(); c.Get(func() (int, bool) { return 2, true }) }()
		go func() { defer wg.Done(); _ = c.peek() }()
	}
	wg.Wait()
}

func TestInvalidateAllCachesReplacesValues(t *testing.T) {
	old := struct {
		disk    *Cache[*DiskUsage]
		pm2     *Cache[[]PM2Process]
		qb      *Cache[[]TorrentItem]
		thermal *Cache[[]ThermalSensor]
	}{diskCache, pm2Cache, qbCache, thermalCache}
	defer func() {
		diskCache, pm2Cache, qbCache, thermalCache = old.disk, old.pm2, old.qb, old.thermal
	}()
	initCaches()
	pm2Cache.setForTest([]PM2Process{{ID: 1, Name: "x"}})
	qbCache.setForTest([]TorrentItem{{Hash: "abc"}})
	thermalCache.setForTest([]ThermalSensor{{Name: "cpu", Temp: 50}})
	invalidateAllCaches()
	if got := pm2Cache.peek(); len(got) != 0 {
		t.Fatalf("pm2 cache kept its value: %v", got)
	}
	if got := qbCache.peek(); len(got) != 0 {
		t.Fatalf("qb cache kept its value: %v", got)
	}
	if got := thermalCache.peek(); len(got) != 0 {
		t.Fatalf("thermal cache kept its value: %v", got)
	}
}

func TestRefreshReturnsFreshSlowData(t *testing.T) {
	oldCfg := cfg
	oldLoader := pm2Loader
	defer func() {
		cfg = oldCfg
		pm2Loader = oldLoader
		pollingMu.Lock()
		isPollingActive = false
		pollingMu.Unlock()
		slowMu.Lock()
		slowState = DashboardState{}
		slowInFlight = make(map[string]chan struct{})
		slowMu.Unlock()
	}()
	cfg.AuthPass = ""
	cfg.CollectMS = time.Minute
	cfg.QBHost = "127.0.0.1"
	cfg.QBPort = 1
	cfg.QBPass = ""
	cfg.TechnitiumURL = "http://127.0.0.1:1"
	cfg.AntiGravAuthsDir = t.TempDir()
	initCaches()

	pm2Loader = func() ([]PM2Process, bool) {
		return []PM2Process{{ID: 9, Name: "fresh"}}, true
	}

	handler := dashboardHandler()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/refresh", nil)
	req.RemoteAddr = "192.0.2.11:1234"
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("refresh failed: %d %s", w.Code, w.Body.String())
	}
	var res DashboardState
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	for _, p := range res.PM2 {
		if p.ID == 9 && p.Name == "fresh" {
			return
		}
	}
	t.Fatalf("refresh returned stale slow data: %+v", res.PM2)
}

func TestRefreshKeepsLastFastSample(t *testing.T) {
	oldCfg, oldSources := cfg, slowSources
	defer func() {
		cfg, slowSources = oldCfg, oldSources
		pollingMu.Lock()
		isPollingActive = false
		pollingMu.Unlock()
	}()
	cfg.AuthPass = ""
	cfg.CollectMS = time.Minute
	slowSources = nil
	initCaches()

	pollingMu.Lock()
	isPollingActive = true
	pollingMu.Unlock()

	collectAll()
	stateMu.RLock()
	first := globalState.CPU
	stateMu.RUnlock()
	if first == nil {
		t.Fatal("no CPU sample")
	}

	handler := dashboardHandler()
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/api/refresh", nil)
		req.RemoteAddr = "192.0.2.12:1234"
		handler.ServeHTTP(w, req)
		stateMu.RLock()
		got := globalState.CPU
		stateMu.RUnlock()
		if got == nil || *got != *first {
			t.Fatalf("refresh %d took a new CPU sample: first=%v now=%v", i, first, got)
		}
	}
}

func TestQBLoginRequiresOkBody(t *testing.T) {
	oldCfg := cfg
	oldCookie := qb.getCookie()
	oldHTTP := qb.http
	defer func() {
		cfg = oldCfg
		qb.setCookie(oldCookie)
		qb.http = oldHTTP
	}()
	body := "Fails."
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(body))
	}))
	defer server.Close()
	u, _ := url.Parse(server.URL)
	cfg.QBHost = u.Hostname()
	cfg.QBPort = mustPort(t, u.Port())
	cfg.QBUser = "admin"
	cfg.QBPass = "wrong"
	qb.setCookie("")

	if qb.login() {
		t.Fatal("a 200 Fails. response was treated as a successful login")
	}

	body = "Ok."
	if !qb.login() {
		t.Fatal("a 200 Ok. response was rejected")
	}
}

func TestQBTorrentDeleteAllRejected(t *testing.T) {
	oldCfg := cfg
	defer func() { cfg = oldCfg }()
	cfg.AuthPass = ""
	handler := dashboardHandler()
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("POST", "/api/qbittorrent/delete/all", nil))
	if w.Code != http.StatusNotFound && w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("delete all is still routable: %d", w.Code)
	}
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("POST", "/api/qbittorrent/delete/"+strings.Repeat("a", 40), nil))
	if w.Code == http.StatusNotFound {
		t.Fatal("single delete route is not registered")
	}
}

func TestByteRateClampsCounterReset(t *testing.T) {
	if got := byteRate(100, 500, 1); got != 0 {
		t.Fatalf("counter reset produced a rate: %v", got)
	}
	if got := byteRate(1500, 500, 2); got != 500 {
		t.Fatalf("wrong rate: %v", got)
	}
	if got := byteRate(100, 50, 0); got != 0 {
		t.Fatalf("zero interval produced a rate: %v", got)
	}
}

func TestCSPDisallowsInlineScripts(t *testing.T) {
	w := httptest.NewRecorder()
	setSecurityHeaders(w)
	csp := w.Header().Get("Content-Security-Policy")
	if strings.Contains(csp, "script-src 'self' 'unsafe-inline'") {
		t.Fatalf("inline scripts are still allowed: %s", csp)
	}
	if !strings.Contains(csp, "script-src 'self'") {
		t.Fatalf("missing script policy: %s", csp)
	}
}

func TestLoginScriptIsPublic(t *testing.T) {
	old := cfg
	defer func() { cfg = old }()
	cfg.AuthPass = "fixture"
	handler := dashboardHandler()
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/login.js", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("login.js needs auth: %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "api/login") {
		t.Fatalf("login.js content not served: %s", w.Body.String())
	}
}

func TestAntigravityPayloadEscapesProject(t *testing.T) {
	oldCfg := cfg
	defer func() { cfg = oldCfg }()
	var got string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := new(strings.Builder)
		_, _ = io.Copy(buf, r.Body)
		got = buf.String()
		w.Write([]byte(`{"groups":[]}`))
	}))
	defer ts.Close()
	dir := t.TempDir()
	auth := `{"access_token":"tok","email":"a@b","project_id":"pro\"ject"}`
	if err := os.WriteFile(filepath.Join(dir, "antigravity-a@b.json"), []byte(auth), 0600); err != nil {
		t.Fatal(err)
	}
	cfg.AntiGravAuthsDir = dir
	cfg.AntiGravEndpoint = ts.URL
	cfg.AntiGravTTL = time.Minute
	initCaches()
	antiGravCache.Invalidate()

	collectAntigravity()

	var payload map[string]string
	if err := json.Unmarshal([]byte(got), &payload); err != nil {
		t.Fatalf("invalid payload %q: %v", got, err)
	}
	if payload["project"] != `pro"ject` {
		t.Fatalf("project mangled: %q", payload["project"])
	}
}

func TestCollectNetworkUsesConfiguredInterfaces(t *testing.T) {
	oldCfg, oldPrev := cfg, prevState
	defer func() { cfg, prevState = oldCfg, oldPrev }()
	cfg.NetIfaces = []string{"eth9"}
	prevState = PrevState{}
	text := "Inter-|   Receive                                                |  Transmit\n" +
		" face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n" +
		"   eth9: 100 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0\n" +
		" wlan0: 300 0 0 0 0 0 0 0 400 0 0 0 0 0 0 0\n"
	got := collectNetwork(text, 1)
	if _, ok := got["eth9"]; !ok {
		t.Fatalf("configured interface missing: %+v", got)
	}
	if _, ok := got["wlan0"]; ok {
		t.Fatalf("hardcoded interface still collected: %+v", got)
	}
	if got["eth9"].RxBytes != 100 || got["eth9"].TxBytes != 200 {
		t.Fatalf("wrong counters: %+v", got["eth9"])
	}
}

func TestServicesListComesFromConfig(t *testing.T) {
	oldCfg := cfg
	defer func() { cfg = oldCfg }()
	cfg.Services = []ServiceStatus{{Name: "Alpha", Port: 1}, {Name: "Beta", Port: 2}}
	got := collectServices()
	if len(got) != 2 {
		t.Fatalf("wrong service count: %+v", got)
	}
	if got[0].Name != "Alpha" || got[0].Port != 1 || got[0].Up {
		t.Fatalf("wrong first service: %+v", got[0])
	}
	if got[1].Name != "Beta" || got[1].Port != 2 {
		t.Fatalf("wrong second service: %+v", got[1])
	}
}

func TestParseServicesSkipsInvalidEntries(t *testing.T) {
	got := parseServices(" A:8080 , bad , B:x , C:99999 , D:80")
	if len(got) != 2 {
		t.Fatalf("wrong entries kept: %+v", got)
	}
	if got[0].Name != "A" || got[0].Port != 8080 || got[1].Name != "D" || got[1].Port != 80 {
		t.Fatalf("wrong parsing: %+v", got)
	}
}

func TestStaticAssetIndexFollowsDist(t *testing.T) {
	oldCfg := cfg
	defer func() { cfg = oldCfg }()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "dist", "client"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "dist", "client", "brand-new.js"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg.AppRoot = root
	if !isServableAsset("dist/client/brand-new.js") {
		t.Fatal("file built into dist/ is not servable")
	}
	if isServableAsset("main.go") {
		t.Fatal("source file is servable")
	}
	if !isServableAsset("login.js") {
		t.Fatal("root asset is not servable")
	}
}

func TestLogOnceDedupesRepeatedMessages(t *testing.T) {
	logOnceMu.Lock()
	logOnceLast = make(map[string]string)
	logOnceMu.Unlock()

	var buf bytes.Buffer
	oldOut := log.Writer()
	log.SetOutput(&buf)
	defer log.SetOutput(oldOut)

	logOnce("k", "same error")
	logOnce("k", "same error")
	logOnce("k", "other error")
	logOnce("k2", "same error")

	got := strings.Count(buf.String(), "same error")
	if got != 2 {
		t.Fatalf("same message logged %d times, want 2 (one per key):\n%s", got, buf.String())
	}
	if strings.Count(buf.String(), "other error") != 1 {
		t.Fatalf("changed message not logged:\n%s", buf.String())
	}
}

func TestCodexCacheUsesItsOwnTTL(t *testing.T) {
	oldCfg := cfg
	defer func() { cfg = oldCfg }()
	cfg.AntiGravTTL = 30 * time.Second
	cfg.CodexTTL = 5 * time.Minute
	initCaches()
	if codexCache.ttl != cfg.CodexTTL {
		t.Fatalf("codex ttl %v, want %v", codexCache.ttl, cfg.CodexTTL)
	}
	if claudeCache.ttl != cfg.AntiGravTTL {
		t.Fatalf("claude ttl changed: %v", claudeCache.ttl)
	}
}

func TestHandlerConstructionDoesNotCollect(t *testing.T) {
	stateMu.Lock()
	lastStateJSON = nil
	stateMu.Unlock()
	_ = dashboardHandler()
	stateMu.RLock()
	empty := len(lastStateJSON) == 0
	stateMu.RUnlock()
	if !empty {
		t.Fatal("building the handler collected state before any client connected")
	}
}
