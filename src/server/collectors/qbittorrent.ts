import http from 'http';
import { QB_CACHE_MS } from '../config';
import stateModule from '../state';
import { TorrentItem } from '../../shared/types';

// Load qBittorrent config from environment variables
export function loadQBConfig(): void {
  stateModule.QB_HOST = process.env.QB_HOST || 'localhost';
  stateModule.QB_PORT = parseInt(process.env.QB_PORT || '', 10) || 7777;
  stateModule.QB_USER = process.env.QB_USER || 'admin';
  stateModule.QB_PASS = process.env.QB_PASS || null;
}

// Validate config on startup (called from startup())
export function validateQBConfig(): void {
  if (!stateModule.QB_PASS) {
    throw new Error(
      'qBittorrent password not set.\n' +
      '  Set QB_PASS in /opt/dashboard/.env or environment'
    );
  }
}

export interface QBResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export function qbRequest(method: string, requestPath: string, body?: string | null): Promise<QBResponse> {
  return new Promise(resolve => {
    const headers: Record<string, string | number> = {};
    if (stateModule.qbCookie) {
      headers['Cookie'] = stateModule.qbCookie;
    }
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const options: http.RequestOptions = {
      hostname: stateModule.QB_HOST,
      port: stateModule.QB_PORT,
      path: requestPath,
      method: method,
      headers: headers,
    };
    const req = http.request(options, (res: http.IncomingMessage) => {
      let data = '';
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: data }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
    req.setTimeout(3000, () => { req.destroy(); resolve({ status: 0, headers: {}, body: '' }); });
    if (body) req.write(body);
    req.end();
  });
}

export async function qbLogin(): Promise<boolean> {
  const body = `username=${encodeURIComponent(stateModule.QB_USER)}&password=${encodeURIComponent(stateModule.QB_PASS || '')}`;
  const res = await qbRequest('POST', '/api/v2/auth/login', body);
  if (res.status === 200 || res.status === 204 || (res.headers['set-cookie'] && res.body === 'Ok.')) {
    const rawCookies = res.headers['set-cookie'];
    if (rawCookies) {
      const cookieStr = Array.isArray(rawCookies) ? rawCookies[0] : rawCookies;
      stateModule.qbCookie = cookieStr.split(';')[0];
    }
    return true;
  }
  stateModule.qbCookie = null;
  return false;
}

export async function collectQBittorrent(): Promise<TorrentItem[]> {
  const now = Date.now();
  if (stateModule.qbCache.value && (now - stateModule.qbCache.time) < QB_CACHE_MS) {
    return stateModule.qbCache.value;
  }
  let res = await qbRequest('GET', '/api/v2/torrents/info', null);
  if (res.status === 403) {
    const ok = await qbLogin();
    if (!ok) return stateModule.qbCache.value || [];
    res = await qbRequest('GET', '/api/v2/torrents/info', null);
  }
  if (res.status !== 200) return stateModule.qbCache.value || [];
  try {
    const parsed = JSON.parse(res.body);
    const result: TorrentItem[] = parsed.map((t: any) => ({
      hash: t.hash,
      name: t.name,
      size: t.size,
      progress: t.progress,
      dlspeed: t.dlspeed,
      upspeed: t.upspeed,
      eta: t.eta,
      state: t.state,
      num_seeds: t.num_seeds,
      num_peers: t.num_leechs,
      ratio: t.ratio,
    }));
    stateModule.qbCache = { value: result, time: now };
    return result;
  } catch (err: any) {
    console.warn('qBittorrent parse failed:', err.message);
    return stateModule.qbCache.value || [];
  }
}

export async function qbDelete(hash: string): Promise<{ success: boolean; error?: string }> {
  const body = `hashes=${encodeURIComponent(hash)}&deleteFiles=true`;
  let res = await qbRequest('POST', '/api/v2/torrents/delete', body);
  if (res.status === 403) {
    const ok = await qbLogin();
    if (!ok) return { success: false, error: 'Authentication failed' };
    res = await qbRequest('POST', '/api/v2/torrents/delete', body);
  }
  if (res.status === 200) {
    // Invalidate the qBittorrent cache so the next collect picks up the change
    stateModule.qbCache = { value: null, time: 0 };
    return { success: true };
  }
  return { success: false, error: `HTTP ${res.status}` };
}
