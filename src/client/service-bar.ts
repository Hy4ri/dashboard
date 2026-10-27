/* ── Init service bar ───────────────────────────────────────────── */

import { $, esc } from './utils/dom.js';
import { SERVICE_ICONS, DEFAULT_SERVICE_ICON } from './config.js';
import type { ServiceStatus } from '../shared/types.js';

let renderedKey = '';

function statusClass(up: boolean): string {
  return up ? 'online' : 'offline';
}

function statusLabel(up: boolean): string {
  return up ? 'Status: Online' : 'Status: Offline';
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
      '<a href="' + protocol + '//' + host + ':' + s.port + '" target="_blank" rel="noopener noreferrer" class="service-btn" data-service="' + esc(s.name) + '">' +
      (SERVICE_ICONS[s.name] || DEFAULT_SERVICE_ICON) +
      '<span>' + esc(s.name) + '</span>' +
      '<span class="service-status-dot ' + statusClass(s.up) + '" aria-label="' + statusLabel(s.up) + '"></span>' +
      '</a>'
    ).join('');
    return;
  }

  for (const s of services) {
    const btn = bar.querySelector<HTMLElement>('.service-btn[data-service="' + CSS.escape(s.name) + '"]');
    const dot = btn?.querySelector('.service-status-dot');
    if (!dot) continue;
    dot.className = 'service-status-dot ' + statusClass(s.up);
    dot.setAttribute('aria-label', statusLabel(s.up));
  }
}
