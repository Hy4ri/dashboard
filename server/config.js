const path = require('path');

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
const SPEEDTEST_LOG_FILE = path.join(__dirname, '..', 'speedtest-log.json');
const MAX_SPEEDTEST_ENTRIES = 50;
const SPEEDTEST_CACHE_MS = 5000;  // cache results for 5s
const CONNECTIVITY_CACHE_MS = 10000;  // 10 seconds

module.exports = {
  PORT,
  COLLECT_MS,
  IDLE_TIMEOUT_MS,
  DISK_CACHE_MS,
  PM2_CACHE_MS,
  FREQ_CACHE_MS,
  THERMAL_CACHE_MS,
  QB_CACHE_MS,
  RATE_LIMIT,
  SPEEDTEST_INTERVAL_MS,
  SPEEDTEST_LOG_FILE,
  MAX_SPEEDTEST_ENTRIES,
  SPEEDTEST_CACHE_MS,
  CONNECTIVITY_CACHE_MS,
};
