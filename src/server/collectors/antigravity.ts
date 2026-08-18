import https from 'https';
import fs from 'fs';
import path from 'path';
import { AntigravityAccountQuota, AntigravityQuotaBucket, AntigravityQuotaGroup } from '../../shared/types';

interface RawBucket {
  bucketId?: string;
  displayName?: string;
  window?: string;
  resetTime?: string;
  description?: string;
  remainingFraction?: number;
}

interface RawGroup {
  displayName?: string;
  description?: string;
  buckets?: RawBucket[];
}

interface RawQuotaSummaryResponse {
  groups?: RawGroup[];
}

interface CacheEntry {
  value: AntigravityAccountQuota[];
  time: number;
}

const AUTHS_DIR = '/opt/cliproxyapi/auths';
const CACHE_TTL_MS = 30000; // 30 seconds cache
let cache: CacheEntry = { value: [], time: 0 };

function fetchUserQuotaSummary(token: string, project: string): Promise<RawQuotaSummaryResponse | null> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ project: project || '' });
    const options: https.RequestOptions = {
      hostname: 'cloudcode-pa.googleapis.com',
      port: 443,
      path: '/v1internal:retrieveUserQuotaSummary',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'Antigravity/1.0',
        'Accept': 'application/json',
      },
      timeout: 5000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed: RawQuotaSummaryResponse = JSON.parse(data);
            resolve(parsed);
          } catch (err) {
            console.warn('Antigravity JSON parse error:', err);
            resolve(null);
          }
        } else {
          console.warn(`Antigravity quota HTTP ${res.statusCode}:`, data);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      console.warn('Antigravity request error:', err.message);
      resolve(null);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

export async function collectAntigravity(): Promise<AntigravityAccountQuota[]> {
  const now = Date.now();
  if (cache.value.length > 0 && (now - cache.time) < CACHE_TTL_MS) {
    return cache.value;
  }

  if (!fs.existsSync(AUTHS_DIR)) {
    return [];
  }

  try {
    const files = fs.readdirSync(AUTHS_DIR).filter(f => f.startsWith('antigravity') && f.endsWith('.json'));
    if (files.length === 0) return [];

    const accounts: AntigravityAccountQuota[] = [];

    for (const file of files) {
      const fullPath = path.join(AUTHS_DIR, file);
      try {
        const rawAuth = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        const token = rawAuth.access_token;
        const email = rawAuth.email || file.replace(/^antigravity-/, '').replace(/\.json$/, '');
        const project = rawAuth.project_id || '';

        if (!token) continue;

        const summary = await fetchUserQuotaSummary(token, project);
        const groups: AntigravityQuotaGroup[] = [];

        if (summary && Array.isArray(summary.groups)) {
          for (const g of summary.groups) {
            const groupName = g.displayName || 'Model Group';
            const buckets: AntigravityQuotaBucket[] = [];

            if (Array.isArray(g.buckets)) {
              for (const b of g.buckets) {
                const fraction = b.remainingFraction != null && Number.isFinite(b.remainingFraction)
                  ? Number(b.remainingFraction)
                  : 0;
                const pct = Math.round(fraction * 1000) / 10; // e.g. 47.1%
                buckets.push({
                  bucketId: b.bucketId || '',
                  displayName: b.displayName || '',
                  window: b.window || (b.bucketId?.includes('5h') ? '5h' : 'weekly'),
                  resetTime: b.resetTime,
                  remainingFraction: fraction,
                  remainingPct: pct,
                });
              }
            }

            groups.push({
              displayName: groupName,
              buckets,
            });
          }
        }

        accounts.push({
          email,
          project,
          groups,
        });
      } catch (err: unknown) {
        console.warn(`Failed to process antigravity auth file ${file}:`, err);
      }
    }

    cache = { value: accounts, time: now };
    return accounts;
  } catch (err: unknown) {
    console.warn('Failed to collect Antigravity quota:', err);
    return cache.value;
  }
}
