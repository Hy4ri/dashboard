package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	loginMaxFailures   = 5
	loginLockoutWindow = 15 * time.Minute
)

var (
	loginFailures   = make(map[string][]time.Time)
	loginFailuresMu sync.Mutex
)

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

// loginLocked reports whether this IP has failed too many logins inside the
// lockout window. A wrong password is cheap to try, so a per-second rate limit
// alone cannot stop a password guesser.
func loginLocked(ip string) bool {
	loginFailuresMu.Lock()
	defer loginFailuresMu.Unlock()
	cutoff := time.Now().Add(-loginLockoutWindow)
	times := loginFailures[ip]
	recent := make([]time.Time, 0, len(times))
	for _, t := range times {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) == 0 {
		delete(loginFailures, ip)
		return false
	}
	loginFailures[ip] = recent
	return len(recent) >= loginMaxFailures
}

func recordLoginFailure(ip string) {
	loginFailuresMu.Lock()
	loginFailures[ip] = append(loginFailures[ip], time.Now())
	loginFailuresMu.Unlock()
}

func clearLoginFailures(ip string) {
	loginFailuresMu.Lock()
	delete(loginFailures, ip)
	loginFailuresMu.Unlock()
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w)
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip == "" {
		ip = r.RemoteAddr
	}
	if !checkRateLimit(ip) || loginLocked(ip) {
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
	userOK := subtle.ConstantTimeCompare([]byte(creds.Username), []byte(cfg.AuthUser)) == 1
	passOK := subtle.ConstantTimeCompare([]byte(creds.Password), []byte(cfg.AuthPass)) == 1
	if userOK && passOK {
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
		clearLoginFailures(ip)

		cookie := &http.Cookie{
			Name:     "session_token",
			Value:    token,
			Path:     "/",
			HttpOnly: true,
			Secure:   requestIsHTTPS(r),
			SameSite: http.SameSiteStrictMode,
			MaxAge:   int(duration.Seconds()),
		}
		http.SetCookie(w, cookie)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}
	recordLoginFailure(ip)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(401)
	json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": "Invalid username or password"})
}

// requestIsHTTPS reports whether the browser reached this server over TLS.
// X-Forwarded-Proto is client-controlled, so it counts only when the operator
// sets TRUST_PROXY.
func requestIsHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return cfg.TrustProxy && r.Header.Get("X-Forwarded-Proto") == "https"
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
