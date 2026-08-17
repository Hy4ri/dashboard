import { MemoryData } from '../../shared/types';

export function parseMemInfo(text: string): MemoryData {
  const result: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon);
    // Only extract the fields we need
    if (!/^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree)$/.test(key)) continue;
    const valStr = line.slice(colon + 1).trim();
    const val = parseInt(valStr, 10) * 1024; // kB → bytes
    if (!isNaN(val)) result[key] = val;
  }

  const memTotal = result.MemTotal || 0;
  const memAvail = result.MemAvailable || 0;
  const used = memTotal - memAvail;
  const used_pct = memTotal > 0 ? (used / memTotal) * 100 : 0;

  return {
    MemTotal: memTotal,
    MemFree: result.MemFree || 0,
    MemAvailable: memAvail,
    Buffers: result.Buffers || 0,
    Cached: result.Cached || 0,
    SwapTotal: result.SwapTotal,
    SwapFree: result.SwapFree,
    used_pct: Math.round(used_pct * 10) / 10,
  };
}
