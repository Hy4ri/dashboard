/* ── Dashboard Entry Point ──────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { connectWS, disconnectWS } from './api.js';
import { initServiceBar } from './service-bar.js';
import { setupPM2Menu } from './pm2-menu.js';
import { setupSpeedtestButton, setupTorrentDelete } from './events.js';

document.title = 'Server Dashboard';

// Init service bar
initServiceBar();

// ── Accordion Layout ───────────────────────────────────────

const CARD_META = {
  'pm2-card':     { label: 'Processes', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>', startOpen: true },
  'cpu-card':     { label: 'CPU', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>', startOpen: true },
  'mem-card':     { label: 'Memory', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 19v-3M10 19v-6M14 19v-3M18 19v-9M4 15h16"/></svg>', startOpen: true },
  'disk-card':    { label: 'Disk', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>', startOpen: true },
  'net-card':     { label: 'Network', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>', startOpen: true },
  'torrent-card': { label: 'Downloads', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>', startOpen: false },
};

function initAccordion() {
  document.querySelectorAll('.card').forEach(card => {
    const meta = CARD_META[card.id];
    if (!meta) return;

    // Move existing children into a body div
    const body = document.createElement('div');
    body.className = 'accordion-body';
    body.setAttribute('role', 'region');
    body.setAttribute('aria-label', meta.label);
    while (card.firstChild) body.appendChild(card.firstChild);
    if (!meta.startOpen) body.setAttribute('hidden', '');

    // Remove the old h2 if present (it moved into body)
    const oldH2 = body.querySelector('h2');
    if (oldH2) oldH2.remove();

    // Build accordion header button
    const btn = document.createElement('button');
    btn.className = 'accordion-header' + (meta.startOpen ? ' open' : '');
    btn.setAttribute('aria-expanded', meta.startOpen ? 'true' : 'false');
    btn.setAttribute('aria-controls', card.id + '-body');
    body.id = card.id + '-body';

    btn.innerHTML = `
      <span class="accordion-title">
        <span class="accordion-icon">${meta.icon}</span>
        ${meta.label}
      </span>
      <span class="accordion-right">
        <span class="accordion-badge" id="${card.id}-badge"></span>
        <svg class="accordion-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </span>`;

    btn.addEventListener('click', () => {
      const isOpen = btn.classList.contains('open');
      btn.classList.toggle('open', !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
      if (isOpen) body.setAttribute('hidden', '');
      else body.removeAttribute('hidden');
    });

    card.appendChild(btn);
    card.appendChild(body);
    // Remove aria-label from card (moved to body)
    card.removeAttribute('aria-label');
  });
}

initAccordion();

// Setup event handlers
setupPM2Menu();
setupSpeedtestButton();
setupTorrentDelete();

// Logout Button handler
const logoutBtn = $('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to log out?')) {
      try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.reload();
      } catch (err) {
        alert('Logout failed: ' + err.message);
      }
    }
  });
}

// Initial connect
connectWS();

// Pause WebSocket connection when tab is hidden to save server resources
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    disconnectWS();
    $('last-update').textContent = 'Updates paused while tab is hidden';
    $('status-text').textContent = 'Paused';
    $('status-dot').className = 'status-dot off';
  } else {
    connectWS();
  }
});
