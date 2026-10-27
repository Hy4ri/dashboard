package main

import (
	"strconv"
)

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"time"
)

func extractJSONArray(data []byte) []byte {
	end := bytes.LastIndexByte(data, ']')
	if end == -1 {
		return data
	}
	for i := 0; i < end; i++ {
		if data[i] == '[' {
			if i > 0 && data[i-1] == 0x1b {
				continue
			}
			candidate := data[i : end+1]
			if json.Valid(candidate) {
				return candidate
			}
		}
	}
	return data
}

func collectPM2() []PM2Process {
	return pm2Cache.Get(func() ([]PM2Process, bool) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, "pm2", "jlist").Output()
		if err != nil {
			return nil, false
		}
		var raw []map[string]interface{}
		if err := json.Unmarshal(extractJSONArray(out), &raw); err != nil {
			return nil, false
		}
		res := make([]PM2Process, 0, len(raw))
		for _, p := range raw {
			pmId := 0
			if idVal, ok := p["pm_id"].(float64); ok {
				pmId = int(idVal)
			}
			name, _ := p["name"].(string)
			pid := 0
			if pidVal, ok := p["pid"].(float64); ok {
				pid = int(pidVal)
			}
			status := "stopped"
			var uptime *int64
			restarts := 0
			if env, ok := p["pm2_env"].(map[string]interface{}); ok {
				if s, ok := env["status"].(string); ok {
					status = s
				}
				if u, ok := env["pm_uptime"].(float64); ok {
					val := int64(u)
					uptime = &val
				}
				if r, ok := env["restart_time"].(float64); ok {
					restarts = int(r)
				}
			}
			cpu := 0.0
			mem := int64(0)
			if monit, ok := p["monit"].(map[string]interface{}); ok {
				if c, ok := monit["cpu"].(float64); ok {
					cpu = c
				}
				if m, ok := monit["memory"].(float64); ok {
					mem = int64(m)
				}
			}
			res = append(res, PM2Process{
				ID:       pmId,
				Name:     name,
				Status:   status,
				CPU:      cpu,
				Memory:   mem,
				Uptime:   uptime,
				Restarts: restarts,
				PID:      pid,
				Full:     p,
			})
		}
		return res, true
	})
}

func findPM2Process(name string) *PM2Process {
	procs := collectPM2()
	for i := range procs {
		if strconv.Itoa(procs[i].ID) == name {
			return &procs[i]
		}
	}
	for i := range procs {
		if procs[i].Name == name {
			return &procs[i]
		}
	}
	return nil
}
