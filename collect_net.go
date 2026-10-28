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
	"time"
)

type connStatus struct{ Internet, DNS ConnectivityStatus }

func collectConnectivity() (ConnectivityStatus, ConnectivityStatus) {
	res := connCache.Get(func() (connStatus, bool) {
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

		return connStatus{Internet: internet, DNS: dnsStatus}, true
	})
	return res.Internet, res.DNS
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
