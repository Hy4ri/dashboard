import path from 'path';
import fs from 'fs';

// Load .env manually if it exists (avoids adding external dotenv dependency)
const dotenvPath = path.join(__dirname, '../../.env');
const dotenvPathRoot = path.join(process.cwd(), '.env');

const targetEnvPath = fs.existsSync(dotenvPathRoot) ? dotenvPathRoot : dotenvPath;

if (fs.existsSync(targetEnvPath)) {
  try {
    const content = fs.readFileSync(targetEnvPath, 'utf-8');
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
  } catch (err: any) {
    console.warn('Failed to parse .env file:', err.message);
  }
}

export const PORT: number = parseInt(process.env.PORT || '', 10) || 8080;
export const COLLECT_MS: number = 3000;        // match client POLL_MS — no wasted cycles
export const IDLE_TIMEOUT_MS: number = 10000;  // stop polling if no request for 10s
export const DISK_CACHE_MS: number = 120000;   // refresh disk usage every 2 min (barely changes)
export const PM2_CACHE_MS: number = 5000;      // cache pm2 jlist (avoids spawning node every 3s)
export const FREQ_CACHE_MS: number = 5000;     // cache CPU frequency readings
export const THERMAL_CACHE_MS: number = 5000;  // cache thermal sensor readings
export const QB_CACHE_MS: number = 10000;      // cache qBittorrent API responses
export const RATE_LIMIT: number = 10;          // requests per second per IP
export const CONNECTIVITY_CACHE_MS: number = 10000;  // 10 seconds

// Technitium configuration
export const TECHNITIUM_TOKEN: string | null = process.env.TECHNITIUM_TOKEN || null;
export const TECHNITIUM_URL: string = process.env.TECHNITIUM_URL || 'http://127.0.0.1:5380';

// Authentication configuration (disabled if AUTH_PASS is not defined)
export const AUTH_USER: string = process.env.AUTH_USER || 'admin';
export const AUTH_PASS: string | null = process.env.AUTH_PASS || null;
