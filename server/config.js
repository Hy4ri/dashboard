const path = require('path');
const fs = require('fs');

// Load .env manually if it exists (avoids adding external dotenv dependency)
const dotenvPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(dotenvPath)) {
  try {
    const content = fs.readFileSync(dotenvPath, 'utf-8');
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/(^['"]|['"]$)/g, ''); // strip quotes
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    });
  } catch (err) {
    console.warn('Failed to parse .env file:', err.message);
  }
}

const PORT = parseInt(process.env.PORT, 10) || 8080;
const COLLECT_MS = 3000;        // match client POLL_MS — no wasted cycles
const IDLE_TIMEOUT_MS = 10000;  // stop polling if no request for 10s
const DISK_CACHE_MS = 120000;   // refresh disk usage every 2 min (barely changes)
const PM2_CACHE_MS = 5000;      // cache pm2 jlist (avoids spawning node every 3s)
const FREQ_CACHE_MS = 5000;     // cache CPU frequency readings
const THERMAL_CACHE_MS = 5000;  // cache thermal sensor readings
const QB_CACHE_MS = 10000;      // cache qBittorrent API responses
const RATE_LIMIT = 10; // requests per second per IP
const CONNECTIVITY_CACHE_MS = 10000;  // 10 seconds

// Technitium configuration
const TECHNITIUM_TOKEN = process.env.TECHNITIUM_TOKEN || null;
const TECHNITIUM_URL = process.env.TECHNITIUM_URL || 'http://127.0.0.1:5380';

// Authentication configuration (disabled if AUTH_PASS is not defined)
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASS = process.env.AUTH_PASS || null;

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
  CONNECTIVITY_CACHE_MS,
  TECHNITIUM_TOKEN,
  TECHNITIUM_URL,
  AUTH_USER,
  AUTH_PASS,
};
