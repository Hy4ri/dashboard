package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var errQBAuth = errors.New("authentication failed")

// qbClient holds the qBittorrent session cookie. The lock guards only the
// cookie string: network calls run without it, so a slow torrent action never
// blocks the torrent collector.
type qbClient struct {
	mu     sync.Mutex
	cookie string
	http   *http.Client
}

var qb = &qbClient{http: &http.Client{Timeout: 3 * time.Second}}

func (c *qbClient) setCookie(cookie string) {
	c.mu.Lock()
	c.cookie = cookie
	c.mu.Unlock()
}

func (c *qbClient) getCookie() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cookie
}

func (c *qbClient) login() bool {
	u := fmt.Sprintf("http://%s:%d/api/v2/auth/login", cfg.QBHost, cfg.QBPort)
	data := url.Values{}
	data.Set("username", cfg.QBUser)
	data.Set("password", cfg.QBPass)
	resp, err := c.http.PostForm(u, data)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	for _, ck := range resp.Cookies() {
		// qBittorrent 5.x scopes the session cookie to the WebUI port (for example, QBT_SID_7777); older versions used SID.
		if ck.Name == "SID" || strings.HasPrefix(ck.Name, "QBT_SID_") {
			c.setCookie(ck.Name + "=" + ck.Value)
			return true
		}
	}
	return resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNoContent
}

func (c *qbClient) request(method, path string, data url.Values, cookie string) (*http.Response, error) {
	u := fmt.Sprintf("http://%s:%d%s", cfg.QBHost, cfg.QBPort, path)
	var body io.Reader
	if method == "POST" {
		body = strings.NewReader(data.Encode())
	}
	req, err := http.NewRequest(method, u, body)
	if err != nil {
		return nil, err
	}
	if method == "POST" {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	return c.http.Do(req)
}

// do sends one request and logs in again once if the session expired.
func (c *qbClient) do(method, path string, data url.Values) (*http.Response, error) {
	cookie := c.getCookie()
	if cookie == "" && cfg.QBPass != "" {
		if !c.login() {
			return nil, errQBAuth
		}
		cookie = c.getCookie()
	}
	resp, err := c.request(method, path, data, cookie)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusForbidden && cfg.QBPass != "" {
		resp.Body.Close()
		if !c.login() {
			return nil, errQBAuth
		}
		return c.request(method, path, data, c.getCookie())
	}
	return resp, nil
}

func collectQBittorrent() []TorrentItem {
	return qbCache.Get(func() ([]TorrentItem, bool) {
		resp, err := qb.do("GET", "/api/v2/torrents/info", nil)
		if err != nil {
			return nil, false
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, false
		}
		var raw []map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
			return nil, false
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
		return res, true
	})
}

func handleQBAction(w http.ResponseWriter, r *http.Request, action, hash string) {
	setSecurityHeaders(w)
	w.Header().Set("Content-Type", "application/json")

	doAction := func(act, h string) (bool, string) {
		data := url.Values{}
		data.Set("hashes", h)
		switch act {
		case "delete":
			data.Set("deleteFiles", "true")
		}
		apiPath := torrentActionPath(act)
		resp, err := qb.do("POST", apiPath, data)
		if err != nil {
			return false, err.Error()
		}
		code := resp.StatusCode
		resp.Body.Close()
		if code == http.StatusNotFound && (act == "pause" || act == "resume") {
			resp, err = qb.do("POST", torrentLegacyActionPath(act), data)
			if err != nil {
				return false, err.Error()
			}
			code = resp.StatusCode
			resp.Body.Close()
		}
		if code == http.StatusOK {
			qbCache.Invalidate()
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

func torrentActionPath(act string) string {
	switch act {
	case "delete":
		return "/api/v2/torrents/delete"
	case "pause":
		return "/api/v2/torrents/stop"
	case "resume":
		return "/api/v2/torrents/start"
	}
	return ""
}

func torrentLegacyActionPath(act string) string {
	if act == "pause" {
		return "/api/v2/torrents/pause"
	}
	return "/api/v2/torrents/resume"
}
