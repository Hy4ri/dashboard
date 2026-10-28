# monit

A small Go server with a TypeScript dashboard. It shows the host, the PM2
processes, qBittorrent torrents, service health, and the AI quota usage that the
host can read.

## Run

```sh
go build -o monit-server .
cp .env.example .env   # fill QB_USER and QB_PASS
./monit-server
```

`npm run build` compiles the client to `dist/`. `npm test` runs the Go tests and
the frontend contract tests. `npm run test:browser` adds the Chromium smoke
test.

The server reads `index.html` and `dist/` from the executable directory. Set
`APP_ROOT` to use another directory.

## Data sources

| Data | Source | Notes |
| --- | --- | --- |
| Hostname | `os.Hostname` | The only static system field. |
| CPU and cores | `/proc/stat` | Two samples; the rate uses the delta between them. |
| Load average | `/proc/loadavg` | 1, 5, and 15 minute values. |
| Memory and swap | `/proc/meminfo` | `MemAvailable` is the free-memory value. |
| Disk usage | `statfs("/")` | Total, used, and available bytes. |
| Network rate | `/proc/net/dev` | Only the interfaces in `NET_IFACES`. |
| Thermal zones | `/sys/class/thermal/thermal_zone*/` | Only the names in `THERMAL_ZONES`; `temp` is millidegrees. |
| Battery | `/sys/class/power_supply/battery/` | `capacity` and `status`. |
| Connectivity | TCP to `8.8.8.8:53`, DNS to `127.0.0.1:53` | The DNS probe resolves `google.com`. |
| Technitium stats | Technitium API | Needs `TECHNITIUM_TOKEN`; off when the token is empty. |
| PM2 processes | `pm2 jlist` | Name, id, status, CPU, memory, restarts, and pid. |
| qBittorrent | qBittorrent Web API | Login with `QB_USER` and `QB_PASS`. |
| Service health | TCP to each `SERVICES` port | Default list is in `.env.example`. |
| Antigravity quota | Antigravity API | Uses the local Antigravity credentials. |
| Claude usage | Claude OAuth credentials | Path from `CLAUDE_CREDENTIALS`. |
| Codex usage | `codex app-server --stdio` | Refreshed every `CODEX_TTL` (default 5m). |

## Configuration

All settings are environment variables. See `.env.example` for the full list:
`PORT`, `QB_*`, `TECHNITIUM_*`, `TRUST_PROXY`, `NET_IFACES`, `THERMAL_ZONES`,
`APP_ROOT`, `CLAUDE_CREDENTIALS`, `SERVICES`, `CODEX_TTL`, and the optional
login pairs `AUTH_USER` and `AUTH_PASS`.

Set `TRUST_PROXY=true` only when a trusted reverse proxy sets
`X-Forwarded-Proto`. The login lockout and the secure-cookie check use it.

## Test

```sh
go test ./...
npx tsc -p tsconfig.client.json --noEmit
npm test
npm run test:browser
```

The race detector cannot run on this Android 5.4 kernel
(`ThreadSanitizer: unsupported VMA range`). Concurrency tests and review cover
the shared state instead.
