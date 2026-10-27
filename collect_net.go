package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

func collectServices() map[string]bool {
	services := []struct {
		name string
		port int
	}{
		{"Jellyfin", 8096},
		{"Seerr", 5055},
		{"qBittorrent", 7777},
		{"Sonarr", 8989},
		{"Radarr", 7878},
		{"Prowlarr", 9696},
		{"Bazarr", 6767},
		{"Dufs", 5050},
		{"Technitium", 5380},
		{"Hermes", 9119},
	}
	res := make(map[string]bool)
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, s := range services {
		wg.Add(1)
		go func(name string, port int) {
			defer wg.Done()
			conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 400*time.Millisecond)
			isUp := err == nil
			if isUp {
				conn.Close()
			}
			mu.Lock()
			res[name] = isUp
			mu.Unlock()
		}(s.name, s.port)
	}
	wg.Wait()
	return res
}

func collectConnectivity() (ConnectivityStatus, ConnectivityStatus) {
	now := time.Now()
	if !connCache.Time.IsZero() && now.Sub(connCache.Time) < cfg.ConnCacheTTL {
		return connCache.Value.Internet, connCache.Value.DNS
	}
	var internet, dnsStatus ConnectivityStatus

	// 1. Check Internet (8.8.8.8:53)
	startNet := time.Now()
	conn, err := net.DialTimeout("tcp", "8.8.8.8:53", 1500*time.Millisecond)
	if err == nil {
		lat := time.Since(startNet).Milliseconds()
		conn.Close()
		internet = ConnectivityStatus{Ok: true, Latency: &lat}
	} else {
		errStr := err.Error()
		internet = ConnectivityStatus{Ok: false, Error: &errStr}
	}

	// 2. Check DNS via local Technitium (127.0.0.1:53)
	r := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			d := net.Dialer{Timeout: 2000 * time.Millisecond}
			return d.DialContext(ctx, "udp", "127.0.0.1:53")
		},
	}
	startDNS := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
	_, dnsErr := r.LookupHost(ctx, "google.com")
	cancel()
	if dnsErr == nil {
		lat := time.Since(startDNS).Milliseconds()
		dnsStatus = ConnectivityStatus{Ok: true, Latency: &lat}
	} else {
		errStr := dnsErr.Error()
		dnsStatus = ConnectivityStatus{Ok: false, Error: &errStr}
	}

	res := struct{ Internet, DNS ConnectivityStatus }{Internet: internet, DNS: dnsStatus}
	connCache = Cache[struct{ Internet, DNS ConnectivityStatus }]{Value: res, Time: now}
	return internet, dnsStatus
}

var technitiumClient = &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, MaxIdleConnsPerHost: 2, IdleConnTimeout: 30 * time.Second}}

func collectTechnitium() *TechnitiumStats {
	if cfg.TechnitiumToken == "" {
		return &TechnitiumStats{Configured: false}
	}
	u := fmt.Sprintf("%s/api/dashboard/stats/get?token=%s&type=LastDay",
		strings.TrimRight(cfg.TechnitiumURL, "/"), url.QueryEscape(cfg.TechnitiumToken))
	resp, err := technitiumClient.Get(u)
	if err != nil {
		errStr := err.Error()
		f := false
		return &TechnitiumStats{Configured: true, Ok: &f, Error: &errStr}
	}
	defer resp.Body.Close()
	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		errStr := err.Error()
		f := false
		return &TechnitiumStats{Configured: true, Ok: &f, Error: &errStr}
	}
	if st, _ := body["status"].(string); st == "ok" {
		t := true
		var total, blocked, cached int64
		if respMap, ok := body["response"].(map[string]interface{}); ok {
			if statsMap, ok := respMap["stats"].(map[string]interface{}); ok {
				if v, ok := statsMap["totalQueries"].(float64); ok {
					total = int64(v)
				}
				if v, ok := statsMap["totalBlocked"].(float64); ok {
					blocked = int64(v)
				}
				if v, ok := statsMap["totalCached"].(float64); ok {
					cached = int64(v)
				}
			}
		}
		pct := 0.0
		if total > 0 {
			pct = math.Round((float64(blocked)/float64(total))*10000) / 100
		}
		return &TechnitiumStats{
			Configured:        true,
			Ok:                &t,
			TotalQueries:      &total,
			BlockedQueries:    &blocked,
			BlockedPercentage: &pct,
			CachedQueries:     &cached,
		}
	}
	errMsg, _ := body["errorMessage"].(string)
	if errMsg == "" {
		errMsg = "API error"
	}
	f := false
	return &TechnitiumStats{Configured: true, Ok: &f, Error: &errMsg}
}
