#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const dns = require('dns');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const COLLECT_MS = 3000;        // match client POLL_MS — no wasted cycles
const IDLE_TIMEOUT_MS = 10000;  // stop polling if no request for 10s
const DISK_CACHE_MS = 120000;   // refresh disk usage every 2 min (barely changes)
const PM2_CACHE_MS = 5000;      // cache pm2 jlist (avoids spawning node every 3s)
const FREQ_CACHE_MS = 5000;     // cache CPU frequency readings
const THERMAL_CACHE_MS = 5000;  // cache thermal sensor readings
const QB_CACHE_MS = 10000;      // cache qBittorrent API responses
const RATE_LIMIT = 10; // requests per second per IP
const SPEEDTEST_INTERVAL_MS = 30 * 60 * 1000;  // 30 minutes
const SPEEDTEST_LOG_FILE = path.join(__dirname, 'speedtest-log.json');
const MAX_SPEEDTEST_ENTRIES = 50;
const SPEEDTEST_CACHE_MS = 5000;  // cache results for 5s

const rateLimiter = (() => {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now - entry.ts >= 1000) {
      hits.set(ip, { ts: now, count: 1 });
      return true;
    }
    entry.count++;
    // Prune stale entries lazily (every 50 unique IPs)
    if (hits.size > 50) {
      for (const [k, v] of hits) {
        if (now - v.ts > 2000) hits.delete(k);
      }
    }
    return entry.count <= RATE_LIMIT;
  };
})();

// ── Cached state & previous-readings for delta calculations ────────

let state = {};
let prev = { cpu: null, net: null, disk: null, time: 0 };
let pollTimer = null;
let lastRequestTime = Date.now();
let diskCache    = { value: null, time: 0 };
let pm2Cache     = { value: null, time: 0 };
let freqCache    = { value: null, time: 0 };
let thermalCache = { value: null, time: 0 };
let qbCache      = { value: null, time: 0 };
let connectivityCache = { value: null, time: 0 };
const CONNECTIVITY_CACHE_MS = 10000;  // 10 seconds
let speedtestCache = { value: null, time: 0 };
let speedtestRunning = false;
let speedtestInstalled = null;  // null = unchecked, true, false
let speedtestTimer = null;

// ── Static caches (filled once at startup) ─────────────────────────

let staticSystem = null;
let thermalPaths = [];     // [{name, path}] – wanted zones mapped to temp files
let cpuStaticInfo = [];    // [{core, min, max, governor}] – per-core static data

// ── Async helpers (silent on error – never crash) ──────────────────

const readFile = filePath => new Promise(resolve =>
  fs.readFile(filePath, 'utf8', (e, d) => resolve(e ? null : d)));

const readDir = dirPath => new Promise(resolve =>
  fs.readdir(dirPath, (e, d) => resolve(e ? [] : d)));

const runCmd = (cmd, args = [], tmo = 3000) => new Promise(resolve =>
  execFile(cmd, args, { timeout: tmo }, (e, o) => resolve(e ? '' : o.trim())));

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
    const idle = nums[3] + (nums[4] ?? 0);   // idle + iowait
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
  const now = Date.now();
  if (pm2Cache.value && (now - pm2Cache.time) < PM2_CACHE_MS) {
    return pm2Cache.value;
  }
  // NOTE: --mini is NOT supported by jlist — only by pm2 list (CLI)
  const out = await runCmd('pm2', ['jlist']);
  if (!out) return pm2Cache.value || [];
  try {
    const result = JSON.parse(out).map(p => ({
      id:       p.pm_id,
      name:     p.name,
      status:   p.pm2_env?.status,
      cpu:      p.monit?.cpu ?? 0,
      memory:   p.monit?.memory ?? 0,
      uptime:   p.pm2_env?.pm_uptime ?? null,
      restarts: p.pm2_env?.restart_time ?? 0,
      pid:      p.pid,
    }));
    pm2Cache = { value: result, time: now };
    return result;
  } catch (err) {
    console.warn('PM2 parse failed:', err.message);
    return pm2Cache.value || [];
  }
}

async function collectThermal() {
  const now = Date.now();
  if (thermalCache.value && (now - thermalCache.time) < THERMAL_CACHE_MS) {
    return thermalCache.value;
  }
  // thermalPaths was populated once at startup – just read the temp files
  const result = [];
  await Promise.all(thermalPaths.map(async tp => {
    const raw = await readFile(tp.path);
    if (raw) result.push({ name: tp.name, temp: parseInt(raw.trim(), 10) / 1000 });
  }));
  thermalCache = { value: result, time: now };
  return result;
}

async function collectFreq() {
  const now = Date.now();
  if (freqCache.value && (now - freqCache.time) < FREQ_CACHE_MS) {
    return freqCache.value;
  }
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
  freqCache = { value: result, time: now };
  return result;
}

const _statfs = fs.statfs ? (p => new Promise(r => fs.statfs(p, (e, s) => r(e ? null : s)))) : null;

async function collectDiskUsage() {
  const now = Date.now();
  // Return cached value if fresh enough
  if (diskCache.value && (now - diskCache.time) < DISK_CACHE_MS) {
    return diskCache.value;
  }
  // Prefer fs.statfs (Node 18+) — avoids spawning df process
  if (_statfs) {
    const s = await _statfs('/');
    if (s) {
      const total = s.blocks * s.bsize;
      const available = s.bavail * s.bsize;
      diskCache = {
        value: { total, used: total - available, available },
        time: now,
      };
      return diskCache.value;
    }
  }
  // Fallback: spawn df (Node < 18)
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

// ── Connectivity checks ────────────────────────────────────────

function checkInternet() {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.get('http://1.1.1.1', { timeout: 3000 }, (res) => {
      // Any response means internet is reachable
      res.resume(); // consume response data to free up memory
      res.on('end', () => resolve({ ok: true, latency: Date.now() - start }));
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}

function checkDNS() {
  return new Promise((resolve) => {
    const resolver = new dns.Resolver();
    resolver.setServers(['127.0.0.1']);
    const start = Date.now();
    resolver.resolve4('google.com', (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        resolve({ ok: false, error: err ? (err.code || err.message) : 'No addresses' });
      } else {
        resolve({ ok: true, latency: Date.now() - start });
      }
    });
    // Safety timeout
    setTimeout(() => resolve({ ok: false, error: 'Timeout' }), 5000);
  });
}

async function collectConnectivity() {
  const now = Date.now();
  if (connectivityCache.value && (now - connectivityCache.time) < CONNECTIVITY_CACHE_MS) {
    return connectivityCache.value;
  }

  const [internet, dnsStatus] = await Promise.all([
    checkInternet(),
    checkDNS(),
  ]);

  const result = { internet, dns: dnsStatus };
  connectivityCache = { value: result, time: now };
  return result;
}

// ── Speedtest ──────────────────────────────────────────────────

function checkSpeedtestInstalled() {
  return new Promise((resolve) => {
    runCmd('which', ['speedtest-cli']).then((out) => {
      speedtestInstalled = out.trim().length > 0;
      resolve(speedtestInstalled);
    }).catch(() => {
      speedtestInstalled = false;
      resolve(false);
    });
  });
}

async function runSpeedtest() {
  if (speedtestRunning || !speedtestInstalled) return;
  speedtestRunning = true;

  const start = Date.now();
  try {
    const out = await runCmd('speedtest-cli', ['--json', '--timeout', '60'], 90000);
    if (!out) throw new Error('No output from speedtest-cli');

    const parsed = JSON.parse(out);
    const entry = {
      timestamp: Date.now(),
      download: typeof parsed.download === 'number' ? Math.round(parsed.download / 1_000_000 * 10) / 10 : null,
      upload:   typeof parsed.upload === 'number'   ? Math.round(parsed.upload / 1_000_000 * 10) / 10 : null,
      ping:     typeof parsed.ping === 'number'     ? Math.round(parsed.ping * 10) / 10 : null,
    };

    // Read existing log, append, trim, write back
    let entries = [];
    try {
      const raw = fs.readFileSync(SPEEDTEST_LOG_FILE, 'utf8');
      entries = JSON.parse(raw);
      if (!Array.isArray(entries)) entries = [];
    } catch (_) {
      entries = [];
    }
    entries.push(entry);
    if (entries.length > MAX_SPEEDTEST_ENTRIES) {
      entries = entries.slice(-MAX_SPEEDTEST_ENTRIES);
    }
    fs.writeFileSync(SPEEDTEST_LOG_FILE, JSON.stringify(entries, null, 2));

    // Invalidate cache
    speedtestCache = { value: null, time: 0 };
    console.log('Speedtest complete: download=' + entry.download + ' Mbps, upload=' + entry.upload + ' Mbps, ping=' + entry.ping + ' ms');

    return entry;
  } catch (err) {
    console.warn('Speedtest failed:', err.message);
    return { error: err.message };
  } finally {
    speedtestRunning = false;
  }
}

function getSpeedtestResults() {
  const now = Date.now();
  if (speedtestCache.value && (now - speedtestCache.time) < SPEEDTEST_CACHE_MS) {
    return speedtestCache.value;
  }

  let results = [];
  try {
    const raw = fs.readFileSync(SPEEDTEST_LOG_FILE, 'utf8');
    results = JSON.parse(raw);
    if (!Array.isArray(results)) results = [];
  } catch (_) {
    results = [];
  }

  const last5 = results.slice(-5);

  const data = {
    installed: speedtestInstalled,
    running: speedtestRunning,
    results: last5,
    lastTestTime: last5.length > 0 ? last5[last5.length - 1].timestamp : null,
  };
  speedtestCache = { value: data, time: now };
  return data;
}

function startSpeedtestTimer() {
  if (speedtestTimer) return;
  speedtestTimer = setInterval(() => {
    runSpeedtest();
  }, SPEEDTEST_INTERVAL_MS);
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
let QB_HOST = 'localhost';
let QB_PORT = 7777;
let QB_USER = 'admin';
let QB_PASS = null;

// Load qBittorrent config from qb-config.json, falling back to env vars
function loadQBConfig() {
  const configPath = path.join(__dirname, 'qb-config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    QB_HOST = config.host || 'localhost';
    QB_PORT = config.port || 7777;
    QB_USER = config.username || 'admin';
    QB_PASS = config.password || null;
    console.log('qBittorrent config loaded from qb-config.json');
  } catch {
    // Fall back to environment variables
    QB_HOST = process.env.QB_HOST || 'localhost';
    QB_PORT = parseInt(process.env.QB_PORT, 10) || 7777;
    QB_USER = process.env.QB_USER || 'admin';
    QB_PASS = process.env.QB_PASS || null;
  }
}

// Validate config on startup (called from startup())
function validateQBConfig() {
  if (!QB_PASS) {
    throw new Error(
      'qBittorrent password not set.\n' +
      '  Option 1: Copy qb-config.example.json → qb-config.json and fill in your password.\n' +
      '  Option 2: Set the QB_PASS environment variable.'
    );
  }
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
  const now = Date.now();
  if (qbCache.value && (now - qbCache.time) < QB_CACHE_MS) {
    return qbCache.value;
  }
  let res = await qbRequest('GET', '/api/v2/torrents/info', null);
  if (res.status === 403) {
    const ok = await qbLogin();
    if (!ok) return qbCache.value || [];
    res = await qbRequest('GET', '/api/v2/torrents/info', null);
  }
  if (res.status !== 200) return qbCache.value || [];
  try {
    const result = JSON.parse(res.body).map(t => ({
      hash: t.hash,
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
    qbCache = { value: result, time: now };
    return result;
  } catch (err) {
    console.warn('qBittorrent parse failed:', err.message);
    return qbCache.value || [];
  }
}

async function qbDelete(hash) {
  const body = `hashes=${encodeURIComponent(hash)}&deleteFiles=true`;
  let res = await qbRequest('POST', '/api/v2/torrents/delete', body);
  if (res.status === 403) {
    const ok = await qbLogin();
    if (!ok) return { success: false, error: 'Authentication failed' };
    res = await qbRequest('POST', '/api/v2/torrents/delete', body);
  }
  if (res.status === 200) {
    // Invalidate the qBittorrent cache so the next collect picks up the change
    qbCache = { value: null, time: 0 };
    return { success: true };
  }
  return { success: false, error: `HTTP ${res.status}` };
}

// ── Extracted collectors (CPU, Network, Disk I/O) ──────────────────

function collectCPU(cpuText, interval) {
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
  return { cpuOverall, cpuCores };
}

function collectNetwork(netText, interval) {
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
  return network;
}

function collectDiskIO(diskText, interval) {
  const diskData = diskText ? parseProcDiskStats(diskText) : {};
  const io = {};
  for (const dev of ['sda', 'sda26', 'zram0']) {
    const cur = diskData[dev];
    if (!cur) continue;
    const p = prev.disk?.[dev];
    const obj = { reads: cur.reads, writes: cur.writes, ioTime: cur.ioTime };
    if (p && interval > 0) {
      obj.readsPerSec  = Math.round((cur.reads - p.reads) / interval);
      obj.writesPerSec = Math.round((cur.writes - p.writes) / interval);
      obj.sectorsReadPerSec  = Math.round((cur.sectorsRead - p.sectorsRead) / interval);
      obj.sectorsWrittenPerSec = Math.round((cur.sectorsWritten - p.sectorsWritten) / interval);
    } else {
      obj.readsPerSec = 0; obj.writesPerSec = 0;
      obj.sectorsReadPerSec = 0; obj.sectorsWrittenPerSec = 0;
    }
    io[dev] = obj;
  }
  prev.disk = diskData;
  return io;
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

  // Process CPU, network, and disk I/O (with delta tracking)
  const { cpuOverall, cpuCores } = collectCPU(cpuText, interval);
  const network = collectNetwork(netText, interval);
  const io = collectDiskIO(diskText, interval);
  prev.time = now;

  // Load average ───────────────────────────────────────────────
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

  // ── Connectivity check ─────────────────────────────────────────
  const connectivity = await collectConnectivity();

  // ── Speedtest ────────────────────────────────────────────────
  const speedtest = getSpeedtestResults();

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
    internet: connectivity.internet,
    dns: connectivity.dns,
    battery,
    system: sys,
    torrents,
    speedtest,
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

// ── Route handlers ──────────────────────────────────────────────────

function handleAPI(req, res) {
  ensureActivePolling();
  res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS));
  res.end(JSON.stringify(state));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let requestPath = url.pathname;

  // Rate limiting
  if (!rateLimiter(req.socket.remoteAddress)) {
    res.writeHead(429, SECURITY_HEADERS);
    return res.end('Too Many Requests');
  }

  // PM2 control endpoints (POST only)
  const pm2Match = requestPath.match(/^\/api\/pm2\/(stop|start|restart)\/(.+)$/);
  if (pm2Match && req.method === 'POST') {
    const action = pm2Match[1];
    const name = pm2Match[2];

    // Validate name: non-empty and no shell metacharacters
    if (!name || /[;|&$`()<>]/.test(name)) {
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(JSON.stringify({ error: 'Invalid request' }));
    }

    // Run the PM2 command asynchronously
    (async () => {
      try {
        const out = await runCmd('pm2', [action, name]);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ success: true, message: `Process ${name} ${action}ed` }));
        // Trigger a fresh collection after a brief delay
        setTimeout(() => collect(), 300);
      } catch (err) {
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    })();
    return;
  }

  // Speedtest manual trigger (POST only)
  if (requestPath === '/api/speedtest/run' && req.method === 'POST') {
    if (speedtestRunning) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(JSON.stringify({ error: 'Speedtest already running' }));
    }
    // Fire and respond quickly
    runSpeedtest().then((result) => {
      // Already logged, nothing extra needed
    });
    res.writeHead(202, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(JSON.stringify({ ok: true, message: 'Speedtest started' }));
  }

  // qBittorrent delete endpoint (POST only)
  const qbDeleteMatch = requestPath.match(/^\/api\/qbittorrent\/delete\/([a-fA-F0-9]{40})$/);
  if (qbDeleteMatch && req.method === 'POST') {
    const hash = qbDeleteMatch[1];
    (async () => {
      const result = await qbDelete(hash);
      const code = result.success ? 200 : 500;
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(result));
    })();
    return;
  }

  // API endpoint
  if (requestPath === '/api/status') {
    return handleAPI(req, res);
  }

  // Default to index.html
  if (requestPath === '/') requestPath = '/index.html';

  // Path traversal protection
  const filePath = path.join(ROOT, requestPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, SECURITY_HEADERS);
    return res.end('Forbidden');
  }

  // HTML files — serve as static
  if (path.extname(filePath) === '.html') {
    // fall through to static file handler below
  }

  // Other static files
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, SECURITY_HEADERS);
      return res.end('Not Found');
    }
    const contentType = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, Object.assign({ 'Content-Type': contentType }, SECURITY_HEADERS));
    res.end(data);
  });
});

// ── Start ──────────────────────────────────────────────────────────

async function startup() {
  // Load qBittorrent config
  loadQBConfig();
  validateQBConfig();

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

    // Check speedtest availability and start timer
    checkSpeedtestInstalled().then(() => {
      startSpeedtestTimer();
      // Run first test after 10 seconds
      setTimeout(() => runSpeedtest(), 10000);
    });
  });
}

startup();

function shutdown(signal) {
  return () => {
    console.log(`Received ${signal}, shutting down...`);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (speedtestTimer) clearInterval(speedtestTimer);
    server.close(() => process.exit(0));
    // Force exit after 5 seconds
    setTimeout(() => process.exit(1), 5000);
  };
}

process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));
process.on('uncaughtException', err => {
  console.error('Uncaught:', err.stack || err.message);
  process.exit(1);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled:', err.stack || err.message);
});
