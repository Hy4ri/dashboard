package main

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ServiceStatus is one link in the header service bar. The server owns the
// list, so the browser does not repeat the ports and cannot drift from the
// probe targets.
type ServiceStatus struct {
	Name string `json:"name"`
	Port int    `json:"port"`
	Up   bool   `json:"up"`
}

// defaultServices is the built-in list. Override it with SERVICES in .env.
var defaultServices = []ServiceStatus{
	{Name: "Jellyfin", Port: 8096},
	{Name: "Seerr", Port: 5055},
	{Name: "qBittorrent", Port: 7777},
	{Name: "Sonarr", Port: 8989},
	{Name: "Radarr", Port: 7878},
	{Name: "Prowlarr", Port: 9696},
	{Name: "Bazarr", Port: 6767},
	{Name: "Dufs", Port: 5050},
	{Name: "Technitium", Port: 5380},
	{Name: "Hermes", Port: 9119},
}

// parseServices reads "Name:port,Name:port". Invalid entries are skipped so a
// typo removes one link instead of breaking the dashboard.
func parseServices(raw string) []ServiceStatus {
	res := make([]ServiceStatus, 0, len(defaultServices))
	for _, item := range strings.Split(raw, ",") {
		name, portStr, ok := strings.Cut(strings.TrimSpace(item), ":")
		if !ok {
			continue
		}
		port, err := strconv.Atoi(strings.TrimSpace(portStr))
		if err != nil || port <= 0 || port > 65535 || strings.TrimSpace(name) == "" {
			continue
		}
		res = append(res, ServiceStatus{Name: strings.TrimSpace(name), Port: port})
	}
	return res
}

func collectServices() []ServiceStatus {
	defs := cfg.Services
	if len(defs) == 0 {
		defs = defaultServices
	}
	res := make([]ServiceStatus, len(defs))
	var wg sync.WaitGroup
	for i, s := range defs {
		wg.Add(1)
		go func(i int, name string, port int) {
			defer wg.Done()
			up := false
			if conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 400*time.Millisecond); err == nil {
				conn.Close()
				up = true
			}
			res[i] = ServiceStatus{Name: name, Port: port, Up: up}
		}(i, s.Name, s.Port)
	}
	wg.Wait()
	return res
}
