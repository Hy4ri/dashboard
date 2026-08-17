import { runCmd } from '../utils/helpers';
import { PM2_CACHE_MS } from '../config';
import stateModule from '../state';
import { PM2Process } from '../../shared/types';

export async function collectPM2(): Promise<PM2Process[]> {
  const now = Date.now();
  if (stateModule.pm2Cache.value && (now - stateModule.pm2Cache.time) < PM2_CACHE_MS) {
    return stateModule.pm2Cache.value;
  }
  return await refreshPM2Cache(now);
}

// Shared cache — avoids spawning pm2 jlist twice per tick
export async function refreshPM2Cache(now?: number): Promise<PM2Process[]> {
  // NOTE: --mini is NOT supported by jlist — only by pm2 list (CLI)
  const out = await runCmd('pm2', ['jlist']);
  if (!out) return stateModule.pm2Cache.value || [];
  try {
    const parsed = JSON.parse(out);
    const result: PM2Process[] = parsed.map((p: any) => ({
      id: p.pm_id,
      name: p.name,
      status: p.pm2_env?.status,
      cpu: p.monit?.cpu ?? 0,
      memory: p.monit?.memory ?? 0,
      uptime: p.pm2_env?.pm_uptime ?? null,
      restarts: p.pm2_env?.restart_time ?? 0,
      pid: p.pid,
      // Keep full env for log path lookup
      _full: p,
    }));
    stateModule.pm2Cache = { value: result, time: now || Date.now() };
    return result;
  } catch (err: any) {
    console.warn('PM2 parse failed:', err.message);
    return stateModule.pm2Cache.value || [];
  }
}

// Used by pm2-logs route to avoid spawning another jlist
export async function getPM2Process(name: string): Promise<PM2Process | null> {
  const now = Date.now();
  // Use cached list if fresh
  const list = (stateModule.pm2Cache.value && (now - stateModule.pm2Cache.time) < PM2_CACHE_MS)
    ? stateModule.pm2Cache.value
    : await refreshPM2Cache(now);
  return list.find(p => p.name === name) || null;
}
