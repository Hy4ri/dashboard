package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

func setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:")
}

// pm2Run executes one pm2 command. Tests replace it with a recorder.
var pm2Run = func(ctx context.Context, args ...string) error {
	return exec.CommandContext(ctx, "pm2", args...).Run()
}

var pm2PastTense = map[string]string{
	"stop":    "stopped",
	"start":   "started",
	"restart": "restarted",
	"delete":  "deleted",
}

func handlePM2Control(w http.ResponseWriter, r *http.Request, action string, id int) {
	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	target := findPM2Process(id)
	if target == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "Process not found"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if err := pm2Run(ctx, action, strconv.Itoa(target.ID)); err != nil {
		w.WriteHeader(500)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	message := "Process " + target.Name + " " + pm2PastTense[action]
	if past, ok := pm2PastTense[action]; ok {
		message = "Process " + target.Name + " " + past
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": message,
	})
	pm2Cache.Invalidate()
	ensureActivePolling()
}

// handlePM2RestartAll restarts every PM2 process except this server, sends the
// response, and only then restarts this server. Restarting it first would kill
// the connection before the client gets an answer.
func handlePM2RestartAll(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	self := os.Getpid()
	selfID := -1
	var failed []string
	restarted := 0
	for _, p := range collectPM2() {
		if p.PID == self {
			selfID = p.ID
			continue
		}
		if err := pm2Run(ctx, "restart", strconv.Itoa(p.ID)); err != nil {
			failed = append(failed, p.Name)
			continue
		}
		restarted++
	}

	if len(failed) > 0 {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("Restarted %d process(es); failed: %s", restarted, strings.Join(failed, ", ")),
			"error":   "restart failed for: " + strings.Join(failed, ", "),
		})
	} else {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": fmt.Sprintf("Restarted %d process(es)", restarted),
		})
	}

	pm2Cache.Invalidate()
	if selfID >= 0 {
		go func() {
			time.Sleep(500 * time.Millisecond)
			selfCtx, selfCancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer selfCancel()
			_ = pm2Run(selfCtx, "restart", strconv.Itoa(selfID))
		}()
	}
}

func handlePM2Logs(w http.ResponseWriter, r *http.Request, id int, lines int) {
	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	target := findPM2Process(id)
	if target == nil {
		w.WriteHeader(404)
		json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("Process %d not found", id)})
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
		"name":    target.Name,
		"out":     outLogs,
		"err":     errLogs,
	})
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
	pm2ControlRe := regexp.MustCompile(`^/api/pm2/(stop|start|restart|delete)/(\d+)$`)
	pm2LogsRe := regexp.MustCompile(`^/api/pm2/logs/(\d+)$`)
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
		if path == "/api/refresh" {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			ensureActivePolling()
			invalidateAllCaches()
			refreshSlowCollectorsAndWait(5 * time.Second)
			publishState()
			broadcastState()
			setSecurityHeaders(w)
			w.Header().Set("Content-Type", "application/json")
			stateMu.RLock()
			w.Write(lastStateJSON)
			stateMu.RUnlock()
			return
		}

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

		// PM2 control: /api/pm2/:action/:id
		if path == "/api/pm2/restart-all" && r.Method == "POST" {
			handlePM2RestartAll(w, r)
			return
		}
		if m := pm2ControlRe.FindStringSubmatch(path); len(m) == 3 && r.Method == "POST" {
			id, err := strconv.Atoi(m[2])
			if err != nil {
				http.Error(w, "Bad id", http.StatusBadRequest)
				return
			}
			handlePM2Control(w, r, m[1], id)
			return
		}

		// PM2 logs: /api/pm2/logs/:id
		if m := pm2LogsRe.FindStringSubmatch(path); len(m) == 2 && r.Method == "GET" {
			id, err := strconv.Atoi(m[1])
			if err != nil {
				http.Error(w, "Bad id", http.StatusBadRequest)
				return
			}
			lines := 100
			if l, err := strconv.Atoi(r.URL.Query().Get("lines")); err == nil && l > 0 {
				lines = l
			}
			handlePM2Logs(w, r, id, lines)
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
