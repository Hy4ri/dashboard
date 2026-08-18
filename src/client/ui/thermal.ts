import { fmtTemp } from '../utils/format.js';
import { $, esc, setTextOf } from '../utils/dom.js';
import { THERMAL_MAP } from '../config.js';
import { ThermalSensor } from '../../shared/types.js';

function getTempClass(temp: number): string {
  if (temp >= 75) return 'temp-critical';
  if (temp >= 60) return 'temp-warm';
  return 'temp-cool';
}

export function renderThermal(data?: ThermalSensor[] | null): void {
  const container = $('thermal-grid');
  if (!container) return;

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="none">No thermal sensors detected</div>';
    return;
  }

  // Filter out 5G and PMIC sensors, then sort for consistent ordering
  const filtered = data.filter(t => t.name !== 'modem-lte-sub6-pa1' && t.name !== 'pmr735a_tz');
  const sorted = filtered.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

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
