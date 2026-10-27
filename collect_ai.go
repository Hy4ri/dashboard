package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Upstream rejects unknown clients, so these strings mimic the official CLIs.
// Update them when the official CLI version changes.
const (
	antigravityUA = "antigravity/cli/1.4.3"
	claudeUA      = "claude-code/2.1.283"
)

func collectAntigravity() []AntigravityAccountQuota {
	return antiGravCache.Get(func() ([]AntigravityAccountQuota, bool) {
		authsDir := cfg.AntiGravAuthsDir
		if authsDir == "" {
			authsDir = "/opt/cliproxyapi/auths"
		}
		entries, err := os.ReadDir(authsDir)
		if err != nil {
			return nil, false
		}
		var res []AntigravityAccountQuota
		client := &http.Client{Timeout: 4 * time.Second}

		for _, e := range entries {
			if strings.HasPrefix(e.Name(), "antigravity") && strings.HasSuffix(e.Name(), ".json") {
				fullPath := filepath.Join(authsDir, e.Name())
				raw, err := os.ReadFile(fullPath)
				if err != nil {
					continue
				}
				var authMap map[string]interface{}
				if err := json.Unmarshal(raw, &authMap); err != nil {
					continue
				}
				token, _ := authMap["access_token"].(string)
				if token == "" {
					continue
				}
				email, _ := authMap["email"].(string)
				if email == "" {
					email = strings.TrimSuffix(strings.TrimPrefix(e.Name(), "antigravity-"), ".json")
				}
				project, _ := authMap["project_id"].(string)

				payload, err := json.Marshal(map[string]string{"project": project})
				if err != nil {
					continue
				}
				endpoints := []string{
					"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
					"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
				}
				if cfg.AntiGravEndpoint != "" {
					endpoints = []string{cfg.AntiGravEndpoint}
				}

				type rawQuotaResp struct {
					Groups []struct {
						DisplayName string `json:"displayName"`
						Buckets     []struct {
							BucketId          string  `json:"bucketId"`
							DisplayName       string  `json:"displayName"`
							Window            string  `json:"window"`
							ResetTime         string  `json:"resetTime"`
							RemainingFraction float64 `json:"remainingFraction"`
						} `json:"buckets"`
					} `json:"groups"`
				}

				var mergedGroups []AntigravityQuotaGroup
				seenGroupNames := make(map[string]bool)
				hasGemini := false
				hasClaude := false

				for _, ep := range endpoints {
					if hasGemini && hasClaude {
						break
					}
					req, err := http.NewRequest("POST", ep, bytes.NewReader(payload))
					if err != nil {
						continue
					}
					req.Header.Set("Authorization", "Bearer "+token)
					req.Header.Set("Content-Type", "application/json")
					// Legacy client identities omit Gemini and Argon quotas.
					req.Header.Set("User-Agent", antigravityUA)

					resp, err := client.Do(req)
					if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
						if resp != nil {
							resp.Body.Close()
						}
						continue
					}

					var quotaResp rawQuotaResp
					decodeErr := json.NewDecoder(resp.Body).Decode(&quotaResp)
					resp.Body.Close()
					if decodeErr != nil {
						continue
					}

					for _, g := range quotaResp.Groups {
						gName := g.DisplayName
						if gName == "" {
							gName = "Model Group"
						}
						key := strings.ToLower(strings.TrimSpace(gName))
						if strings.Contains(key, "gemini") && !strings.Contains(key, "argon") {
							hasGemini = true
						}
						if strings.Contains(key, "claude") {
							hasClaude = true
						}
						if seenGroupNames[key] {
							continue
						}
						seenGroupNames[key] = true

						var buckets []AntigravityQuotaBucket
						for _, b := range g.Buckets {
							w := b.Window
							if w == "" {
								if strings.Contains(b.BucketId, "5h") {
									w = "5h"
								} else {
									w = "weekly"
								}
							}
							pct := math.Round(b.RemainingFraction*1000) / 10
							buckets = append(buckets, AntigravityQuotaBucket{
								BucketId:          b.BucketId,
								DisplayName:       b.DisplayName,
								Window:            w,
								ResetTime:         b.ResetTime,
								RemainingFraction: b.RemainingFraction,
								RemainingPct:      pct,
							})
						}
						mergedGroups = append(mergedGroups, AntigravityQuotaGroup{
							DisplayName: gName,
							Buckets:     buckets,
						})
					}
				}

				if len(mergedGroups) > 0 {
					res = append(res, AntigravityAccountQuota{
						Email:   email,
						Project: project,
						Groups:  mergedGroups,
					})
				}
			}
		}
		return res, true
	})
}

func collectClaudeUsage() *ClaudeUsageData {
	return claudeCache.Get(func() (*ClaudeUsageData, bool) {
		credPath := cfg.ClaudeCreds
		if credPath == "" {
			credPath = "/.claude/.credentials.json"
		}
		raw, err := os.ReadFile(credPath)
		if err != nil {
			log.Printf("Claude read error: %v", err)
			return nil, false
		}

		var credMap map[string]interface{}
		if err := json.Unmarshal(raw, &credMap); err != nil {
			log.Printf("Claude json error: %v", err)
			return nil, false
		}
		oauth, _ := credMap["claudeAiOauth"].(map[string]interface{})
		if oauth == nil {
			log.Printf("Claude oauth nil")
			return nil, false
		}
		token, _ := oauth["accessToken"].(string)
		if token == "" {
			log.Printf("Claude token empty")
			return nil, false
		}

		client := &http.Client{Timeout: 4 * time.Second}
		req, err := http.NewRequest("GET", "https://api.anthropic.com/api/oauth/usage", nil)
		if err != nil {
			log.Printf("Claude new request err: %v", err)
			return nil, false
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("User-Agent", claudeUA)

		resp, err := client.Do(req)
		if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
			if resp != nil {
				log.Printf("Claude request failed with status: %d", resp.StatusCode)
				resp.Body.Close()
			} else {
				log.Printf("Claude request err: %v", err)
			}
			return nil, false
		}
		defer resp.Body.Close()

		var apiResp struct {
			FiveHour *struct {
				Utilization float64 `json:"utilization"`
				ResetsAt    string  `json:"resets_at"`
			} `json:"five_hour"`
			SevenDay *struct {
				Utilization float64 `json:"utilization"`
				ResetsAt    string  `json:"resets_at"`
			} `json:"seven_day"`
			SevenDayBreakdown struct {
				Rows []struct {
					Key     string `json:"key"`
					Percent int    `json:"percent"`
				} `json:"rows"`
			} `json:"seven_day_breakdown"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
			log.Printf("Claude decode error: %v", err)
			return nil, false
		}

		breakdown := make(map[string]int)
		for _, row := range apiResp.SevenDayBreakdown.Rows {
			breakdown[row.Key] = row.Percent
		}

		result := &ClaudeUsageData{Breakdown: breakdown}
		if apiResp.FiveHour != nil {
			result.FiveHour = &ClaudeUsageWindow{Utilization: apiResp.FiveHour.Utilization, ResetsAt: apiResp.FiveHour.ResetsAt}
		}
		if apiResp.SevenDay != nil {
			result.SevenDay = &ClaudeUsageWindow{Utilization: apiResp.SevenDay.Utilization, ResetsAt: apiResp.SevenDay.ResetsAt}
		}

		return result, true
	})
}

func collectCodexUsage() *CodexUsageData {
	return codexCache.Get(func() (*CodexUsageData, bool) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "codex", "app-server", "--stdio")
		stdin, err := cmd.StdinPipe()
		if err != nil {
			return nil, false
		}
		defer stdin.Close()
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			return nil, false
		}
		if err = cmd.Start(); err != nil {
			return nil, false
		}
		defer func() { stdin.Close(); cmd.Process.Kill(); cmd.Wait() }()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), 1024*1024)
		send := func(message string) bool { _, err := io.WriteString(stdin, message+"\n"); return err == nil }
		read := func(id int) (json.RawMessage, bool) {
			for scanner.Scan() {
				var msg struct {
					ID     int             `json:"id"`
					Result json.RawMessage `json:"result"`
					Error  json.RawMessage `json:"error"`
				}
				if json.Unmarshal(scanner.Bytes(), &msg) != nil || msg.ID != id {
					continue
				}
				if len(msg.Error) > 0 && string(msg.Error) != "null" {
					return nil, false
				}
				return msg.Result, len(msg.Result) > 0 && string(msg.Result) != "null"
			}
			return nil, false
		}
		if !send(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"monit","title":"monit","version":"1.0.0"},"capabilities":{}}}`) {
			return nil, false
		}
		if _, ok := read(1); !ok {
			return nil, false
		}
		if !send(`{"jsonrpc":"2.0","method":"initialized","params":{}}`) || !send(`{"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read","params":{}}`) {
			return nil, false
		}
		raw, ok := read(2)
		if !ok {
			return nil, false
		}
		var response struct {
			RateLimits *struct {
				PlanType  string            `json:"planType"`
				Primary   *CodexUsageWindow `json:"primary"`
				Secondary *CodexUsageWindow `json:"secondary"`
			} `json:"rateLimits"`
		}
		if json.Unmarshal(raw, &response) != nil || response.RateLimits == nil {
			return nil, false
		}
		limits := response.RateLimits
		result := &CodexUsageData{PlanType: limits.PlanType, PrimaryWindow: limits.Primary, SecondaryWindow: limits.Secondary}
		return result, true
	})
}

// Slow collectors publish independently; only one refresh per source may run.
