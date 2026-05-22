import { fmtTemp, fmtFreq, NONE } from '../utils/format.js';
import { $, esc, setTextOf } from '../utils/dom.js';
import { THERMAL_MAP, GOVERNOR_MAP } from '../config.js';

function renderThermal(data) {
  const container = $('thermal-grid');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="none">No thermal sensors detected</div>';
    return;
  }

  // Sort for consistent ordering
  const sorted = data.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const existing = container.querySelectorAll('.thermal-item[data-zone]');

  if (existing.length !== sorted.length) {
    container.innerHTML = sorted.map(t => {
      const hot = t.temp > 70 ? 'very-hot' : t.temp > 55 ? 'hot' : '';
      const label = THERMAL_MAP[t.name] || t.name;
      return '<div class="thermal-item" data-zone="' + esc(t.name) + '">' +
        '<span class="label">' + esc(label) + '</span>' +
        '<span class="temp ' + hot + '">' + fmtTemp(t.temp) + '</span></div>';
    }).join('');
    return;
  }

  // Patch
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const item = existing[i];
    if (!item) continue;
    const tempEl = item.querySelector('.temp');
    if (tempEl) {
      const hot = t.temp > 70 ? 'very-hot' : t.temp > 55 ? 'hot' : '';
      tempEl.className = 'temp' + (hot ? ' ' + hot : '');
      setTextOf(tempEl, fmtTemp(t.temp));
    }
  }
}

function renderFreq(data) {
  const container = $('freq-grid');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="none">No CPU frequency data available</div>';
    return;
  }

  const existing = container.querySelectorAll('.freq-item[data-core]');

  if (existing.length !== data.length) {
    container.innerHTML = data.map(f =>
      '<div class="freq-item" data-core="' + f.core + '">' +
      '<div class="core-label">CPU' + f.core + '</div>' +
      '<div class="value">' + fmtFreq(f.current) + '</div>' +
      '<div class="freq-sub">min ' + fmtFreq(f.min) + ' \u00B7 max ' + fmtFreq(f.max) + '</div>' +
      '<div class="freq-sub">' + esc(GOVERNOR_MAP[f.governor] || f.governor || NONE) + '</div>' +
      '</div>'
    ).join('');
    return;
  }

  // Patch
  for (let i = 0; i < data.length; i++) {
    const f = data[i];
    const item = existing[i];
    if (!item) continue;
    const val = item.querySelector('.value');
    if (val) setTextOf(val, fmtFreq(f.current));
    const subs = item.querySelectorAll('.freq-sub');
    if (subs.length >= 2) {
      setTextOf(subs[0], 'min ' + fmtFreq(f.min) + ' \u00B7 max ' + fmtFreq(f.max));
      setTextOf(subs[1], esc(GOVERNOR_MAP[f.governor] || f.governor || NONE));
    }
  }
}

export { renderThermal, renderFreq };
