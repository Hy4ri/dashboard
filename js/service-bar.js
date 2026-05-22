/* ── Init service bar ───────────────────────────────────────────── */

import { $, esc } from './utils/dom.js';
import { SERVICE_LINKS } from './config.js';

function initServiceBar() {
  const bar = $('service-bar');
  if (!bar) return;

  const host = window.location.hostname;
  const protocol = window.location.protocol;

  bar.innerHTML = SERVICE_LINKS.map(s =>
    '<a href="' + protocol + '//' + host + ':' + s.port + '" target="_blank" rel="noopener noreferrer" class="service-btn">' +
    s.icon +
    '<span>' + esc(s.name) + '</span>' +
    '<span aria-hidden="true" style="font-size:10px;opacity:0.5">\u2197</span>' +
    '</a>'
  ).join('');
}

export { initServiceBar };
