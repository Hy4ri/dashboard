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
let speedtestCache = { value: null, time: 0 };
let speedtestRunning = false;
let speedtestInstalled = null;  // null = unchecked, true, false
let speedtestTimer = null;

// ── Static caches (filled once at startup) ─────────────────────────

let staticSystem = null;
let thermalPaths = [];     // [{name, path}] – wanted zones mapped to temp files
let cpuStaticInfo = [];    // [{core, min, max, governor}] – per-core static data

// ── qBittorrent state ──────────────────────────────────────────────

let qbCookie = null;
let QB_HOST = 'localhost';
let QB_PORT = 7777;
let QB_USER = 'admin';
let QB_PASS = null;

module.exports = {
  state,
  prev,
  pollTimer,
  lastRequestTime,
  diskCache,
  pm2Cache,
  freqCache,
  thermalCache,
  qbCache,
  connectivityCache,
  speedtestCache,
  speedtestRunning,
  speedtestInstalled,
  speedtestTimer,
  staticSystem,
  thermalPaths,
  cpuStaticInfo,
  qbCookie,
  QB_HOST,
  QB_PORT,
  QB_USER,
  QB_PASS,
};
