#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const COLLECT_MS = 2000;
const IDLE_TIMEOUT_MS = 10000;  // stop polling if no request for 10s
const DISK_CACHE_MS = 30000;    // refresh disk df every 30s
const RATE_LIMIT = 10; // requests per second per IP

const rateLimiter = (() => {
  const hits = {};
  setInterval(() => {
    for (const k in hits) delete hits[k];
  }, 1000);
  return (ip) => {
    hits[ip] = (hits[ip] || 0) + 1;
    return hits[ip] <= RATE_LIMIT;
  };
})();

// ── Cached state & previous-readings for delta calculations ────────

let state = {};
let prev = { cpu: null, net: null, disk: null, time: 0 };
let pollTimer = null;
let lastRequestTime = Date.now();
let diskCache = { value: null, time: 0 };

// ── Static caches (filled once at startup) ─────────────────────────

let staticSystem = null;
let thermalPaths = [];     // [{name, path}] – wanted zones mapped to temp files
let cpuStaticInfo = [];    // [{core, min, max, governor}] – per-core static data

// ── Async helpers (silent on error – never crash) ──────────────────

const readFile = p => new Promise(r =>
  fs.readFile(p, 'utf8', (e, d) => r(e ? null : d)));

const readDir = p => new Promise(r =>
  fs.readdir(p, (e, d) => r(e ? [] : d)));

const runCmd = (cmd, args = [], tmo = 3000) => new Promise(r =>
  execFile(cmd, args, { timeout: tmo }, (e, o) => r(e ? '' : o.trim())));

// ── Startup initializers (run once) ─────────────────────────────────

async function initStaticSystem() {
  const [osRel, host, ip, kern, lscpu] = await Promise.all([
    readFile('/etc/os-release'),
    runCmd('hostname'),
    runCmd('hostname', ['-I']),
    runCmd('uname', ['-r']),
    runCmd('lscpu'),
  ]);
  let os = null;
  if (osRel) {
    const m = osRel.match(/PRETTY_NAME="(.+)"/);
    if (m) os = m[1];
  }
  let arch = null;
  for (const line of (lscpu || '').split('\n')) {
    const s = line.split(':').map(x => x.trim());
    if (s[0] === 'Model name')    { arch = s[1]; break; }
    if (s[0] === 'Architecture' && !arch) arch = s[1];
  }
  staticSystem = { hostname: host, ip, kernel: kern, os, arch };
}

async function initThermalPaths() {
  const wanted = new Set([
    'cpu-1-6-step', 'battery', 'gpuss-0-step', 'ddr-usr',
    'modem-lte-sub6-pa1', 'pmr735a_tz',
  ]);
  const zones = await readDir('/sys/class/thermal');
  const result = [];
  // Use Promise.all for speed
  await Promise.all(zones.map(async z => {
    if (!z.startsWith('thermal_zone')) return;
    const type = (await readFile(`/sys/class/thermal/${z}/type`))?.trim();
    if (!type || !wanted.has(type)) return;
    result.push({ name: type, path: `/sys/class/thermal/${z}/temp` });
  }));
  thermalPaths = result;
}

async function initCpuStaticInfo() {
  const dirs = await readDir('/sys/devices/system/cpu');
  const result = [];
  await Promise.all(dirs.map(async d => {
    const m = d.match(/^cpu(\d+)$/);
    if (!m) return;
    const core = parseInt(m[1], 10);
    const base = `/sys/devices/system/cpu/${d}/cpufreq`;
    const [min, max, gov] = await Promise.all([
      readFile(`${base}/scaling_min_freq`),
      readFile(`${base}/scaling_max_freq`),
      readFile(`${base}/scaling_governor`),
    ]);
    result.push({
      core,
      min:  min ? Math.round(parseInt(min.trim(), 10) / 1000) : null,
      max:  max ? Math.round(parseInt(max.trim(), 10) / 1000) : null,
      governor: gov ? gov.trim() : null,
    });
  }));
  result.sort((a, b) => a.core - b.core);
  cpuStaticInfo = result;
}

// ── Parsers ────────────────────────────────────────────────────────

function parseProcStat(text) {
  const result = { overall: null, cores: {} };
  for (const line of text.split('\n')) {
    if (!line.startsWith('cpu')) continue;
    const parts = line.trim().split(/\s+/);
    const name = parts[0];
    const nums = parts.slice(1).map(Number);
    if (nums.length < 4) continue;
    const total = nums.reduce((a, b) => a + b, 0);
    const idle = nums[3] + (nums[4] || 0);   // idle + iowait
    if (name === 'cpu') result.overall = { total, idle };
    else result.cores[name] = { total, idle };
  }
  return result;
}

function computePct(prev, curr) {
  if (!prev || !curr) return null;
  const dT = curr.total - prev.total;
  const dI = curr.idle - prev.idle;
  return dT === 0 ? 0 : Math.round(((dT - dI) / dT) * 1000) / 10;
}

function parseProcNetDev(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(wlan0|tun0)\s*:\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
    if (m) result[m[1]] = { rx: parseInt(m[2], 10), tx: parseInt(m[3], 10) };
  }
  return result;
}

function parseProcDiskStats(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 14) continue;
    const name = parts[2];
    if (name === 'sda' || name === 'sda26' || name === 'zram0') {
      result[name] = {
        reads:           parseInt(parts[3], 10),
        writes:          parseInt(parts[7], 10),
        sectorsRead:     parseInt(parts[5], 10),
        sectorsWritten:  parseInt(parts[9], 10),
        ioTime:          parseInt(parts[12], 10),
      };
    }
  }
  return result;
}

function parseMemInfo(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (!m) continue;
    const key = m[1];
    const val = parseInt(m[2], 10) * 1024;   // kB → bytes
    if (/^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree)$/.test(key)) {
      result[key] = val;
    }
  }
  return result;
}

// ── Individual collectors ──────────────────────────────────────────

async function collectPM2() {
  const out = await runCmd('pm2', ['jlist', '--mini']);
  if (!out) return [];
  try {
    return JSON.parse(out).map(p => ({
      id:       p.pm_id,
      name:     p.name,
      status:   p.status,
      cpu:      p.monit?.cpu ?? 0,
      memory:   p.monit?.memory ?? 0,
      uptime:   p.pm2_env?.pm_uptime ?? null,
      restarts: p.pm2_env?.restart_time ?? 0,
      pid:      p.pid,
    }));
  } catch { return []; }
}

async function collectThermal() {
  // thermalPaths was populated once at startup – just read the temp files
  const result = [];
  await Promise.all(thermalPaths.map(async tp => {
    const raw = await readFile(tp.path);
    if (raw) result.push({ name: tp.name, temp: parseInt(raw.trim(), 10) / 1000 });
  }));
  return result;
}

async function collectFreq() {
  // cpuStaticInfo was populated once at startup – only read current freq
  const result = [];
  await Promise.all(cpuStaticInfo.map(async info => {
    const base = `/sys/devices/system/cpu/cpu${info.core}/cpufreq`;
    const cur = await readFile(`${base}/scaling_cur_freq`);
    result.push({
      core:     info.core,
      current:  cur ? Math.round(parseInt(cur.trim(), 10) / 1000) : null,
      min:      info.min,
      max:      info.max,
      governor: info.governor,
    });
  }));
  return result;
}

async function collectDiskUsage() {
  const now = Date.now();
  // Return cached value if fresh enough
  if (diskCache.value && (now - diskCache.time) < DISK_CACHE_MS) {
    return diskCache.value;
  }
  const out = await runCmd('df', ['-B1', '/']);
  if (!out) return diskCache.value || null;
  for (const line of out.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 6 && parts[0] !== 'Filesystem') {
      diskCache = {
        value: {
          total:     parseInt(parts[1], 10),
          used:      parseInt(parts[2], 10),
          available: parseInt(parts[3], 10),
        },
        time: now,
      };
      return diskCache.value;
    }
  }
  return diskCache.value || null;
}

async function collectBattery() {
  const base = '/sys/class/power_supply/battery';
  const [cap, status, volt, curr] = await Promise.all([
    readFile(`${base}/capacity`),
    readFile(`${base}/status`),
    readFile(`${base}/voltage_now`),
    readFile(`${base}/current_now`),
  ]);
  return {
    capacity: cap     ? parseInt(cap.trim(), 10)     : null,
    status:   status  ? status.trim()                 : null,
    voltage:  volt    ? parseInt(volt.trim(), 10)     : null,
    current:  curr    ? parseInt(curr.trim(), 10)     : null,
  };
}

async function collectSystem() {
  // staticSystem was populated once at startup – just read uptime
  const upt = await readFile('/proc/uptime');
  return {
    uptime:   upt ? parseFloat(upt.split(' ')[0]) : null,
    hostname: staticSystem?.hostname || null,
    ip:       staticSystem?.ip       || null,
    kernel:   staticSystem?.kernel   || null,
    os:       staticSystem?.os       || null,
    arch:     staticSystem?.arch     || null,
  };
}

// ── qBittorrent API ──────────────────────────────────────────────

let qbCookie = null;
const QB_HOST = 'localhost';
const QB_PORT = 7777;
const QB_USER = process.env.QB_USER || 'admin';
const QB_PASS = process.env.QB_PASS;

if (!QB_PASS) {
  console.error('FATAL: QB_PASS environment variable is required');
  process.exit(1);
}

function qbRequest(method, path, body) {
  return new Promise(resolve => {
    const options = {
      hostname: QB_HOST,
      port: QB_PORT,
      path: path,
      method: method,
      headers: {}
    };
    if (qbCookie) options.headers['Cookie'] = qbCookie;
    if (body) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
    req.setTimeout(3000, () => { req.destroy(); resolve({ status: 0, headers: {}, body: '' }); });
    if (body) req.write(body);
    req.end();
  });
}

async function qbLogin() {
  const body = `username=${QB_USER}&password=${QB_PASS}`;
  const res = await qbRequest('POST', '/api/v2/auth/login', body);
  if (res.status === 200 || res.status === 204 || (res.headers['set-cookie'] && res.body === 'Ok.')) {
    const cookies = res.headers['set-cookie'];
    if (cookies) {
      qbCookie = Array.isArray(cookies) ? cookies[0].split(';')[0] : cookies.split(';')[0];
    }
    return true;
  }
  qbCookie = null;
  return false;
}

async function collectQBittorrent() {
  let res = await qbRequest('GET', '/api/v2/torrents/info', null);
  if (res.status === 403) {
    const ok = await qbLogin();
    if (!ok) return [];
    res = await qbRequest('GET', '/api/v2/torrents/info', null);
  }
  if (res.status !== 200) return [];
  try {
    return JSON.parse(res.body).map(t => ({
      name: t.name,
      size: t.size,
      progress: t.progress,
      dlspeed: t.dlspeed,
      upspeed: t.upspeed,
      eta: t.eta,
      state: t.state,
      num_seeds: t.num_seeds,
      num_peers: t.num_leechs,
      ratio: t.ratio,
    }));
  } catch { return []; }
}

// ── Main collection ────────────────────────────────────────────────

async function collect() {
  const now = Date.now();
  const interval = (now - prev.time) / 1000;   // seconds since last run

  const [
    cpuText, netText, diskText, loadText, memText,
    thermal,  freq,    diskUse,  battery,  sys, pm2List, torrents,
  ] = await Promise.all([
    readFile('/proc/stat'),
    readFile('/proc/net/dev'),
    readFile('/proc/diskstats'),
    readFile('/proc/loadavg'),
    readFile('/proc/meminfo'),
    collectThermal(),
    collectFreq(),
    collectDiskUsage(),
    collectBattery(),
    collectSystem(),
    collectPM2(),
    collectQBittorrent(),
  ]);

  // ── CPU ────────────────────────────────────────────────────────
  const cpuData = cpuText ? parseProcStat(cpuText) : null;
  let cpuOverall = null;
  const cpuCores = [];
  if (cpuData && prev.cpu) {
    cpuOverall = computePct(prev.cpu.overall, cpuData.overall);
    for (const [name, cd] of Object.entries(cpuData.cores)) {
      const p = prev.cpu.cores[name];
      cpuCores.push(p ? computePct(p, cd) : null);
    }
  }
  prev.cpu = cpuData;

  // ── Network rates ──────────────────────────────────────────────
  const netData = netText ? parseProcNetDev(netText) : {};
  const network = {};
  for (const iface of ['wlan0', 'tun0']) {
    const cur = netData[iface];
    if (!cur) continue;
    const p = prev.net?.[iface];
    const obj = { rx_bytes: cur.rx, tx_bytes: cur.tx };
    if (p && interval > 0) {
      obj.rx_rate = Math.round((cur.rx - p.rx) / interval);
      obj.tx_rate = Math.round((cur.tx - p.tx) / interval);
    } else {
      obj.rx_rate = 0;
      obj.tx_rate = 0;
    }
    network[iface] = obj;
  }
  prev.net = netData;

  // ── Disk I/O rates ─────────────────────────────────────────────
  const diskData = diskText ? parseProcDiskStats(diskText) : {};
  const io = {};
  for (const dev of ['sda', 'sda26', 'zram0']) {
    const cur = diskData[dev];
    if (!cur) continue;
    const p = prev.disk?.[dev];
    const obj = { reads: cur.reads, writes: cur.writes, ioTime: cur.ioTime };
    if (p && interval > 0) {
      obj.readsPerSec  = Math.round((cur.reads        - p.reads)        / interval);
      obj.writesPerSec = Math.round((cur.writes       - p.writes)       / interval);
      obj.sectorsReadPerSec  = Math.round((cur.sectorsRead    - p.sectorsRead)    / interval);
      obj.sectorsWrittenPerSec = Math.round((cur.sectorsWritten - p.sectorsWritten) / interval);
    } else {
      obj.readsPerSec = 0; obj.writesPerSec = 0;
      obj.sectorsReadPerSec = 0; obj.sectorsWrittenPerSec = 0;
    }
    io[dev] = obj;
  }
  prev.disk = diskData;
  prev.time = now;

  // ── Load average ───────────────────────────────────────────────
  let loadavg = null;
  if (loadText) {
    const parts = loadText.split(' ');
    loadavg = parts.slice(0, 3).map(Number);
  }

  // ── Memory ─────────────────────────────────────────────────────
  const memory = memText ? parseMemInfo(memText) : null;
  const swap = memory
    ? { total: memory.SwapTotal, free: memory.SwapFree }
    : null;

  // ── Build state ────────────────────────────────────────────────
  state = {
    timestamp: now,
    pm2: pm2List,
    cpu: cpuOverall,
    cpuCores,
    thermal,
    frequency: freq,
    loadavg,
    memory,
    swap,
    disk: { ...(diskUse || {}), io },
    network,
    battery,
    system: sys,
    torrents,
  };
}

// ── Polling lifecycle ──────────────────────────────────────────────

function ensureActivePolling() {
  lastRequestTime = Date.now();
  if (pollTimer) return; // already running
  console.log('Polling resumed (client connected)');
  collect(); // fire immediately
  pollTimer = setInterval(() => {
    // Stop if idle too long
    if (Date.now() - lastRequestTime > IDLE_TIMEOUT_MS) {
      clearInterval(pollTimer);
      pollTimer = null;
      console.log('Polling paused (idle)');
      return;
    }
    collect();
  }, COLLECT_MS);
}

// ── HTTP server ────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.json': 'application/json',
};
const ROOT = __dirname;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let p = url.pathname;

  if (!rateLimiter(req.socket.remoteAddress)) {
    res.writeHead(429, SECURITY_HEADERS);
    return res.end('Too Many Requests');
  }

  if (p === '/api/status') {
    const apiKey = req.headers['x-api-key'] || url.searchParams.get('key');
    const expectedKey = process.env.API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      res.writeHead(401, Object.assign({ 'Content-Type': 'text/plain' }, SECURITY_HEADERS));
      return res.end('Unauthorized');
    }
    ensureActivePolling();
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS));
    res.end(JSON.stringify(state));
    return;
  }

  if (p === '/') p = '/index.html';

  const filePath = path.join(ROOT, p);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, SECURITY_HEADERS);
    return res.end('Forbidden');
  }

  const ext = path.extname(filePath);
  // Special handling for .html files: inject API key from environment
  if (ext === '.html') {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, SECURITY_HEADERS);
        return res.end('Not Found');
      }
      const content = data.replace('{{API_KEY}}', process.env.API_KEY || '');
      res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] }, SECURITY_HEADERS));
      res.end(content);
    });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, SECURITY_HEADERS);
      return res.end('Not Found');
    }
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream' }, SECURITY_HEADERS));
    res.end(data);
  });
});

// ── Start ──────────────────────────────────────────────────────────

async function startup() {
  // Initialize all static caches
  await Promise.all([
    initStaticSystem(),
    initThermalPaths(),
    initCpuStaticInfo(),
  ]);

  // Perform initial collection then wait for first request
  await collect();
  console.log('Initial collection done, idle until first request');

  server.listen(PORT, () => {
    console.log(`Dashboard → http://localhost:${PORT}`);
    // Don't start polling yet – wait for first API request
  });
}

startup();

function shutdown(signal) {
  return () => {
    console.log(`Received ${signal}, shutting down...`);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    server.close(() => process.exit(0));
    // Force exit after 5 seconds
    setTimeout(() => process.exit(1), 5000);
  };
}

process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));
process.on('uncaughtException', err => {
  console.error('Uncaught:', err.message);
  process.exit(1);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled:', err.message);
});
