/* ── Dashboard Entry Point ──────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { connectWS, disconnectWS, forceRefresh } from './api.js';
import { setupPM2Actions } from './pm2-actions.js';
import { initPM2UI } from './ui/pm2.js';
import { initTorrentsUI } from './ui/torrents.js';
import { setupTorrentDelete } from './events.js';
import { initNotifications, notificationsGranted } from './ui/alerts.js';
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

// Init accordions
initAccordions();

// Notification state is read once: the toggle button keeps its own listener.
initNotifications();

// Setup event handlers
setupPM2Actions();
initPM2UI();
initTorrentsUI();
setupTorrentDelete();

// Refresh Button handler
const refreshBtn = $('refresh-btn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    if (refreshBtn.hasAttribute('disabled')) return;
    refreshBtn.setAttribute('disabled', 'true');
    refreshBtn.classList.add('spinning');
    try {
      await forceRefresh();
    } finally {
      setTimeout(() => {
        refreshBtn.removeAttribute('disabled');
        refreshBtn.classList.remove('spinning');
      }, 400);
    }
  });
}

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

// Initial connect (only if page is visible)
if (typeof document === 'undefined' || !document.hidden) {
  connectWS();
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('ServiceWorker registration error:', err);
    });
  });
}

// Keep the socket open while the tab is hidden only when desktop alerts are
// allowed; otherwise there is nothing to notify, so stop the polling.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (notificationsGranted()) return;
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
