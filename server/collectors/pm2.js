const { runCmd } = require('../utils/helpers');
const { PM2_CACHE_MS } = require('../config');
let { pm2Cache } = require('../state');

async function collectPM2() {
  const now = Date.now();
  if (pm2Cache.value && (now - pm2Cache.time) < PM2_CACHE_MS) {
    return pm2Cache.value;
  }
  return await refreshPM2Cache(now);
}

// Shared cache — avoids spawning pm2 jlist twice per tick
async function refreshPM2Cache(now) {
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
      // Keep full env for log path lookup
      _full:    p,
    }));
    pm2Cache = { value: result, time: now || Date.now() };
    return result;
  } catch (err) {
    console.warn('PM2 parse failed:', err.message);
    return pm2Cache.value || [];
  }
}

// Used by pm2-logs route to avoid spawning another jlist
async function getPM2Process(name) {
  const now = Date.now();
  // Use cached list if fresh
  let list = (pm2Cache.value && (now - pm2Cache.time) < PM2_CACHE_MS)
    ? pm2Cache.value
    : await refreshPM2Cache(now);
  return list.find(p => p.name === name) || null;
}

module.exports = { collectPM2, getPM2Process };
