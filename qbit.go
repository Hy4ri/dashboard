package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

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
