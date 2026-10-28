import { fmtTemp } from '../utils/format.js';
import { $, esc, setTextOf } from '../utils/dom.js';
import { THERMAL_MAP, THRESHOLDS } from '../config.js';
import { ThermalSensor } from '../../shared/types.js';

function getTempClass(temp: number): string {
  if (temp >= THRESHOLDS.temp.crit) return 'temp-critical';
  if (temp >= THRESHOLDS.temp.warn) return 'temp-warm';
  return 'temp-cool';
}

export function renderThermal(data?: ThermalSensor[] | null): void {
  const container = $('thermal-grid');
  if (!container) return;

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="none">No thermal sensors detected</div>';
    return;
  }

  const sorted = data.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const existing = container.querySelectorAll('.thermal-item[data-zone]');

  if (existing.length !== sorted.length) {
    container.innerHTML = sorted.map(t => {
      const cls = getTempClass(t.temp);
      const label = THERMAL_MAP[t.name] || t.name;
      return '<div class="thermal-item" data-zone="' + esc(t.name) + '">' +
        '<span class="label">' + esc(label) + '</span>' +
        '<span class="temp ' + cls + '">' + fmtTemp(t.temp) + '</span></div>';
    }).join('');
    return;
  }

  // Patch
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const item = existing[i];
    if (!item) continue;
    const tempEl = item.querySelector<HTMLElement>('.temp');
    if (tempEl) {
      const cls = getTempClass(t.temp);
      tempEl.className = 'temp ' + cls;
      setTextOf(tempEl, fmtTemp(t.temp));
    }
  }
}
