/* ── Dashboard Entry Point ──────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { connectWS, disconnectWS } from './api.js';
import { initServiceBar } from './service-bar.js';
import { setupPM2Menu } from './pm2-menu.js';
import { setupSpeedtestButton, setupTorrentDelete } from './events.js';

document.title = 'Server Dashboard \u2014 Loading...';

// Init service bar
initServiceBar();

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
