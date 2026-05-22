/* ── Format helpers ──────────────────────────────────────────────── */

export const NONE = 'N/A';

export function fmtBytes(v) {
  if (v == null) return NONE;
  if (v === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), units.length - 1);
  return (v / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

export function fmtBytesRate(v) {
  if (v == null) return NONE;
  return fmtBytes(v) + '/s';
}

export function fmtUptime(s) {
  if (s == null) return NONE;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(d + 'd');
  if (h > 0) parts.push(h + 'h');
  parts.push(m + 'm');
  return parts.join(' ');
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

export function fmtPct(v) {
  if (v == null) return NONE;
  return v.toFixed(1) + '%';
}

export function fmtTemp(v) {
  if (v == null) return NONE;
  return v.toFixed(0) + '\u00B0C';
}

export function fmtFreq(v) {
  if (v == null) return NONE;
  if (v >= 1000) return (v / 1000).toFixed(2) + ' GHz';
  return v + ' MHz';
}

export function fmtVolt(v) {
  if (v == null) return NONE;
  return (v / 1_000_000).toFixed(3) + ' V';
}

export function fmtCurrent(v) {
  if (v == null) return NONE;
  if (v === 0) return 'Not drawing';
  return (Math.abs(v) / 1_000_000).toFixed(3) + ' A';
}

export function fmtSectors(v) {
  if (v == null) return NONE;
  return fmtBytes(v * 512) + '/s';
}
