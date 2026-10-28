/* ── Init service bar ───────────────────────────────────────────── */

import { $, esc } from './utils/dom.js';
import { SERVICE_ICONS, DEFAULT_SERVICE_ICON } from './config.js';
import type { ServiceStatus } from '../shared/types.js';

let renderedKey = '';

function statusClass(up: boolean): string {
  return up ? 'online' : 'offline';
}

function statusLabel(up: boolean): string {
  return up ? 'Online' : 'Offline';
}

// State is also text, not only a coloured dot. Offline is visible, online is
// announced to screen readers.
function applyState(link: Element, dot: Element, up: boolean): void {
  dot.className = 'service-status-dot ' + statusClass(up);
  link.classList.toggle('is-offline', !up);
  const state = link.querySelector('.service-state');
  if (state) {
    state.className = up ? 'service-state sr-only' : 'service-state';
    state.textContent = statusLabel(up);
  }
}

// The server sends the whole list, so the bar is rebuilt only when the list
// itself changes. Otherwise each poll just repaints the status dots.
export function updateServiceHealth(services?: ServiceStatus[]): void {
  const bar = $('service-bar');
  if (!bar || !services) return;

  const key = services.map(s => s.name + ':' + s.port).join('|');
  if (key !== renderedKey) {
    renderedKey = key;
    const host = window.location.hostname;
    const protocol = window.location.protocol;
    bar.innerHTML = services.map(s =>
      '<a href="' + protocol + '//' + host + ':' + s.port + '" target="_blank" rel="noopener noreferrer" class="service-btn' + (s.up ? '' : ' is-offline') + '" data-service="' + esc(s.name) + '">' +
      (SERVICE_ICONS[s.name] || DEFAULT_SERVICE_ICON) +
      '<span>' + esc(s.name) + '</span>' +
      '<span class="service-status-dot ' + statusClass(s.up) + '" aria-hidden="true"></span>' +
      '<span class="service-state' + (s.up ? ' sr-only' : '') + '">' + statusLabel(s.up) + '</span>' +
      '</a>'
    ).join('');
    return;
  }

  for (const s of services) {
    const btn = bar.querySelector<HTMLElement>('.service-btn[data-service="' + CSS.escape(s.name) + '"]');
    const dot = btn?.querySelector('.service-status-dot');
    if (!btn || !dot) continue;
    applyState(btn, dot, s.up);
  }
}
