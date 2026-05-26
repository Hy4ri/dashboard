/* ── Init service bar ───────────────────────────────────────────── */

import { $, esc } from './utils/dom.js';
import { SERVICE_LINKS } from './config.js';

function initServiceBar() {
  const bar = $('service-bar');
  if (!bar) return;

  const host = window.location.hostname;
  const protocol = window.location.protocol;

  bar.innerHTML = SERVICE_LINKS.map(s =>
    '<a href="' + protocol + '//' + host + ':' + s.port + '" target="_blank" rel="noopener noreferrer" class="service-btn" data-service="' + esc(s.name) + '">' +
    s.icon +
    '<span>' + esc(s.name) + '</span>' +
    '<span class="service-status-dot unknown" aria-label="Status: Unknown"></span>' +
    '</a>'
  ).join('');
}

function updateServiceHealth(services) {
  if (!services) return;
  const buttons = document.querySelectorAll('.service-btn[data-service]');
  buttons.forEach(btn => {
    const name = btn.getAttribute('data-service');
    const isUp = services[name];
    const dot = btn.querySelector('.service-status-dot');
    if (dot) {
      if (isUp === true) {
        dot.className = 'service-status-dot online';
        dot.setAttribute('aria-label', 'Status: Online');
      } else if (isUp === false) {
        dot.className = 'service-status-dot offline';
        dot.setAttribute('aria-label', 'Status: Offline');
      } else {
        dot.className = 'service-status-dot unknown';
        dot.setAttribute('aria-label', 'Status: Unknown');
      }
    }
  });
}

export { initServiceBar, updateServiceHealth };
