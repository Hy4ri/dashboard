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

export function fmtUptime(s: number | null | undefined): string {
  if (s == null) return NONE;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(d + 'd');
  if (h > 0) parts.push(h + 'h');
  parts.push(m + 'm');
  return parts.join(' ');
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

export function fmtFreq(v: number | null | undefined): string {
  if (v == null) return NONE;
  if (v >= 1000) return (v / 1000).toFixed(2) + ' GHz';
  return v + ' MHz';
}

export function fmtVolt(v: number | null | undefined): string {
  if (v == null) return NONE;
  return (v / 1_000_000).toFixed(3) + ' V';
}

export function fmtCurrent(v: number | null | undefined): string {
  if (v == null) return NONE;
  if (v === 0) return 'Not drawing';
  return (Math.abs(v) / 1_000_000).toFixed(3) + ' A';
}

export function fmtSectors(v: number | null | undefined): string {
  if (v == null) return NONE;
  return fmtBytes(v * 512) + '/s';
}
