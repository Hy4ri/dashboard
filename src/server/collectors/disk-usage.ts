import fs from 'fs';
import { DISK_CACHE_MS } from '../config';
import { runCmd } from '../utils/helpers';
import stateModule from '../state';
import { DiskUsage } from '../../shared/types';

export async function collectDiskUsage(): Promise<DiskUsage | null> {
  const now = Date.now();
  // Return cached value if fresh enough
  if (stateModule.diskCache.value && (now - stateModule.diskCache.time) < DISK_CACHE_MS) {
    return stateModule.diskCache.value;
  }

  // Prefer fs.promises.statfs (Node 18+) — avoids spawning df process
  try {
    const s = await fs.promises.statfs('/');
    if (s) {
      const total = Number(s.blocks * s.bsize);
      const available = Number(s.bavail * s.bsize);
      const used = total - available;
      const used_pct = total > 0 ? (used / total) * 100 : 0;
      const val: DiskUsage = {
        total,
        used,
        available,
        used_pct: Math.round(used_pct * 10) / 10,
      };
      stateModule.diskCache = {
        value: val,
        time: now,
      };
      return stateModule.diskCache.value;
    }
  } catch {
    // Fall through to df
  }

  // Fallback: spawn df (Node < 18 or fallback environments)
  const out = await runCmd('df', ['-B1', '/']);
  if (!out) return stateModule.diskCache.value || null;
  for (const line of out.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 6 && parts[0] !== 'Filesystem') {
      const total = parseInt(parts[1], 10);
      const used = parseInt(parts[2], 10);
      const available = parseInt(parts[3], 10);
      const used_pct = total > 0 ? (used / total) * 100 : 0;
      const val: DiskUsage = {
        total,
        used,
        available,
        used_pct: Math.round(used_pct * 10) / 10,
      };
      stateModule.diskCache = {
        value: val,
        time: now,
      };
      return stateModule.diskCache.value;
    }
  }
  return stateModule.diskCache.value || null;
}
