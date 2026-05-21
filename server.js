#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const COLLECT_MS = 2000;

// ── Cached state & previous-readings for delta calculations ────────

let state = {};
let prev = { cpu: null, net: null, disk: null, time: 0 };

// ── Async helpers (silent on error – never crash) ──────────────────

const readFile = p => new Promise(r =>
  fs.readFile(p, 'utf8', (e, d) => r(e ? null : d)));

const readDir = p => new Promise(r =>
  fs.readdir(p, (e, d) => r(e ? [] : d)));

const runCmd = (cmd, tmo = 3000) => new Promise(r =>
  exec(cmd, { timeout: tmo }, (e, o) => r(e ? '' : o.trim())));

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
  const out = await runCmd('pm2 jlist --mini');
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
  const zones = await readDir('/sys/class/thermal');
  const wanted = new Set([
    'cpu-1-6-step', 'battery', 'gpuss-0-step', 'ddr-usr',
    'modem-lte-sub6-pa1', 'pmr735a_tz',
  ]);
  const result = [];
  for (const z of zones) {
    if (!z.startsWith('thermal_zone')) continue;
    const type = (await readFile(`/sys/class/thermal/${z}/type`))?.trim();
    if (!type || !wanted.has(type)) continue;
    const raw = await readFile(`/sys/class/thermal/${z}/temp`);
    if (raw) result.push({ name: type, temp: parseInt(raw.trim(), 10) / 1000 });
  }
  return result;
}

async function collectFreq() {
  const dirs = await readDir('/sys/devices/system/cpu');
  const result = [];
  for (const d of dirs) {
    const m = d.match(/^cpu(\d+)$/);
    if (!m) continue;
    const core = parseInt(m[1], 10);
    const base = `/sys/devices/system/cpu/${d}/cpufreq`;
    const [cur, min, max, gov] = await Promise.all([
      readFile(`${base}/scaling_cur_freq`),
      readFile(`${base}/scaling_min_freq`),
      readFile(`${base}/scaling_max_freq`),
      readFile(`${base}/scaling_governor`),
    ]);
    result.push({
      core,
      current: cur ? Math.round(parseInt(cur.trim(), 10) / 1000) : null,
      min:     min ? Math.round(parseInt(min.trim(), 10) / 1000) : null,
      max:     max ? Math.round(parseInt(max.trim(), 10) / 1000) : null,
      governor: gov ? gov.trim() : null,
    });
  }
  result.sort((a, b) => a.core - b.core);
  return result;
}

async function collectDiskUsage() {
  const out = await runCmd('df -B1 /');
  if (!out) return null;
  for (const line of out.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 6 && parts[0] !== 'Filesystem') {
      return {
        total:     parseInt(parts[1], 10),
        used:      parseInt(parts[2], 10),
        available: parseInt(parts[3], 10),
      };
    }
  }
  return null;
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
  const [upt, osRel, host, ip, kern, lscpu] = await Promise.all([
    readFile('/proc/uptime'),
    readFile('/etc/os-release'),
    runCmd('hostname'),
    runCmd('hostname -I'),
    runCmd('uname -r'),
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
  return {
    uptime:   upt ? parseFloat(upt.split(' ')[0]) : null,
    hostname: host || null,
    ip:       ip   || null,
    kernel:   kern || null,
    os,
    arch,
  };
}

// ── Main collection ────────────────────────────────────────────────

async function collect() {
  const now = Date.now();
  const interval = (now - prev.time) / 1000;   // seconds since last run

  const [
    cpuText, netText, diskText, loadText, memText,
    thermal,  freq,    diskUse,  battery,  sys, pm2List,
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
  };
}

// ── HTTP server ────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
};
const ROOT = __dirname;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let p = url.pathname;

  if (p === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  if (p === '/') p = '/index.html';

  const filePath = path.join(ROOT, p);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard → http://localhost:${PORT}`);
  collect().then(() => setInterval(collect, COLLECT_MS));
});

process.on('uncaughtException', err => {
  console.error('Uncaught:', err.message);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled:', err.message);
});
