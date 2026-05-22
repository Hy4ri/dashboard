/* ── Dashboard Entry Point ──────────────────────────────────────── */

import { POLL_MS } from './config.js';
import { $ } from './utils/dom.js';
import { fetchStatus } from './api.js';
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

// Initial fetch
fetchStatus();

// Start polling
let pollTimer = setInterval(fetchStatus, POLL_MS);

// Pause polling when tab is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(pollTimer);
    $('last-update').textContent = 'Updates paused while tab is hidden';
    $('status-text').textContent = 'Paused';
  } else {
    fetchStatus();
    pollTimer = setInterval(fetchStatus, POLL_MS);
  }
});
