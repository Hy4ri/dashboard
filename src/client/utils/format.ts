/* ── Format helpers ──────────────────────────────────────────────── */

export const NONE = 'N/A';

export function fmtBytes(v: number | null | undefined): string {
  if (v == null) return NONE;
  if (v === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), units.length - 1);
  return (v / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

export function fmtBytesRate(v: number | null | undefined): string {
  if (v == null) return NONE;
  return fmtBytes(v) + '/s';
}

export function fmtTime(ts?: number | null): string {
  if (!ts) return NONE;
  return new Date(ts).toLocaleTimeString();
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null) return NONE;
  return v.toFixed(1) + '%';
}

export function fmtTemp(v: number | null | undefined): string {
  if (v == null) return NONE;
  return v.toFixed(0) + '°C';
}
