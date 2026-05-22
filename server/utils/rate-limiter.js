const { RATE_LIMIT } = require('../config');

const hits = new Map();
const rateLimiter = (ip) => {
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

module.exports = rateLimiter;
