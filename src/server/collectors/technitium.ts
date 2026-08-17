import http from 'http';
import https from 'https';
import { TECHNITIUM_TOKEN, TECHNITIUM_URL } from '../config';
import { TechnitiumStats } from '../../shared/types';

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const mod: typeof http | typeof https = isHttps ? https : http;
    const opts: http.RequestOptions = { timeout: 10000 };
    if (isHttps) (opts as https.RequestOptions).rejectUnauthorized = false; // self-signed certs
    mod.get(url, opts, (res: http.IncomingMessage) => {
      let data = '';
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          httpGet(res.headers.location).then(resolve, reject);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject).on('timeout', function (this: http.ClientRequest) { this.destroy(); reject(new Error('Timeout')); });
  });
}

export async function collectTechnitium(): Promise<TechnitiumStats> {
  if (!TECHNITIUM_TOKEN) {
    return { configured: false };
  }

  try {
    const baseUrl = (TECHNITIUM_URL || 'http://127.0.0.1:5380').replace(/\/$/, '');
    const tk = encodeURIComponent(TECHNITIUM_TOKEN);
    const url = baseUrl + '/api/dashboard/stats/get?token=' + tk + '&type=LastDay';

    const data = await httpGet(url);
    const parsed = JSON.parse(data);

    if (parsed && parsed.status === 'ok') {
      const stats = (parsed.response && parsed.response.stats) || {};
      const total = stats.totalQueries || 0;
      const blocked = stats.totalBlocked || 0;
      return {
        configured: true,
        ok: true,
        totalQueries: total,
        blockedQueries: blocked,
        blockedPercentage: total
          ? parseFloat(((blocked / total) * 100).toFixed(2)) : 0,
        cachedQueries: stats.totalCached || 0,
      };
    }

    return {
      configured: true,
      ok: false,
      error: parsed ? (parsed.errorMessage || 'API error') : 'Unknown response',
    };
  } catch (err: any) {
    return { configured: true, ok: false, error: err.message };
  }
}
