const fs = require('fs');
const { DISK_CACHE_MS } = require('../config');
const { runCmd } = require('../utils/helpers');
let { diskCache } = require('../state');

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

module.exports = { collectDiskUsage };
