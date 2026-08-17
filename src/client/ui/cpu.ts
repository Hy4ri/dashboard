import { NONE } from '../utils/format.js';
import { $, setText, updateBar, barClass } from '../utils/dom.js';

export function renderCPU(data?: number | null): void {
  if (data == null) {
    const fill = $('cpu-bar-fill');
    if (fill) fill.style.width = '0%';
    setText('cpu-pct', NONE);
    return;
  }
  const pct = data / 100;
  const fill = $('cpu-bar-fill');
  if (fill) {
    fill.className = 'bar-fill cpu' + barClass(pct, 0.6, 0.8);
  }
  updateBar('cpu-bar-fill', pct, data.toFixed(1) + '%');
}

export function renderCPUCores(cores?: (number | null)[]): void {
  const container = $('cpu-cores');
  if (!container) return;
  if (!cores || cores.length === 0) {
    container.innerHTML = '';
    return;
  }

  const existing = container.querySelectorAll('.core-item');

  if (existing.length !== cores.length) {
    // Rebuild
    container.innerHTML = cores.map((c, i) => {
      const pct = Math.min((c || 0) / 100, 1);
      return '<div class="core-item" data-core="' + i + '">' +
        '<div class="core-label"><span>CPU' + i + '</span><span class="core-val">' + (c != null ? c.toFixed(1) + '%' : NONE) + '</span></div>' +
        '<div class="core-bar"><div class="core-fill" style="width:' + (pct * 100) + '%"></div></div></div>';
    }).join('');
    return;
  }

  // Patch
  for (let i = 0; i < cores.length; i++) {
    const item = existing[i];
    if (!item) continue;
    const valEl = item.querySelector('.core-val');
    if (valEl) valEl.textContent = cores[i] != null ? cores[i]!.toFixed(1) + '%' : NONE;
    const fill = item.querySelector<HTMLElement>('.core-fill');
    if (fill) fill.style.width = Math.min((cores[i] || 0), 100) + '%';
  }
}

export function renderLoad(data?: [number, number, number] | null): void {
  setText('load-1', data ? data[0].toFixed(2) : NONE);
  setText('load-5', data ? data[1].toFixed(2) : NONE);
  setText('load-15', data ? data[2].toFixed(2) : NONE);
}
