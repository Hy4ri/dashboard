/* ── Dashboard Entry Point ──────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { connectWS, disconnectWS } from './api.js';
import { initServiceBar } from './service-bar.js';
import { setupPM2Menu } from './pm2-menu.js';
import { initPM2UI } from './ui/pm2.js';
import { initTorrentsUI } from './ui/torrents.js';
import { setupTorrentDelete } from './events.js';
import { initTerminal } from './ui/terminal.js';
import './particles.js';

document.title = 'Server Dashboard — Loading...';

// ── Accordion Init ───────────────────────────────────────────────
function initAccordions(): void {
  const cards = document.querySelectorAll<HTMLElement>('[data-accordion]');
  cards.forEach(card => {
    const trigger = card.querySelector<HTMLElement>('[data-accordion-trigger]');
    if (!trigger) return;

    // Restore saved state from localStorage
    const saved = localStorage.getItem('acc-' + card.id);
    if (saved === 'closed') {
      card.dataset.state = 'closed';
      trigger.setAttribute('aria-expanded', 'false');
    } else {
      card.dataset.state = 'open';
      trigger.setAttribute('aria-expanded', 'true');
    }

    trigger.addEventListener('click', () => {
      const isOpen = card.dataset.state === 'open';
      card.dataset.state = isOpen ? 'closed' : 'open';
      trigger.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      // Persist
      localStorage.setItem('acc-' + card.id, isOpen ? 'closed' : 'open');
    });

    // Keyboard: Enter/Space on the trigger
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger.click();
      }
    });
  });
}

// Init service bar
initServiceBar();

// Init accordions
initAccordions();

// Setup event handlers
setupPM2Menu();
initPM2UI();
initTorrentsUI();
setupTorrentDelete();
initTerminal();

// Logout Button handler
const logoutBtn = $('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to log out?')) {
      try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.reload();
      } catch (err: any) {
        alert('Logout failed: ' + err.message);
      }
    }
  });
}

// Initial connect
connectWS();

// Register Service Worker for PWA
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('ServiceWorker registration error:', err);
    });
  });
}

// Pause WebSocket connection when tab is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    disconnectWS();
    const lastUpdate = $('last-update');
    if (lastUpdate) lastUpdate.textContent = 'Updates paused while tab is hidden';
    const statusText = $('status-text');
    if (statusText) statusText.textContent = 'Paused';
    const dot = $('status-dot');
    if (dot) dot.className = 'status-dot off';
  } else {
    connectWS();
  }
});
