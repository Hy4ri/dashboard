/* ── Data fetching and UI update coordination ───────────────────── */

import { $ } from './utils/dom.js';
import { fmtTime } from './utils/format.js';
import { POLL_MS } from './config.js';

// Renderers - import all of them
import { renderPM2 } from './ui/pm2.js';
import { renderCPU, renderCPUCores, renderLoad } from './ui/cpu.js';
import { renderMemory, renderSwap } from './ui/memory.js';
import { renderDisk } from './ui/disk.js';
import { renderNetworkRates, renderConnectivity, renderSpeedtest } from './ui/network.js';
import { renderBattery } from './ui/battery.js';
import { renderTorrents } from './ui/torrents.js';
import { renderThermal } from './ui/thermal.js';
import { renderSystem } from './ui/system.js';
import { renderSparklines } from './ui/sparklines.js';
import { checkAlerts, initNotifications } from './ui/alerts.js';
import { updateServiceHealth } from './service-bar.js';

let staleTimer = null;
let socket = null;
let reconnectTimeout = null;

function updateUI(data) {
  if (!data) return;

  // Timestamp & status
  $('last-update').textContent = 'Last: ' + fmtTime(data.timestamp);
  const dot = $('status-dot');
  dot.className = 'status-dot';

  // Update sr-only status text
  $('status-text').textContent = 'Connected';

  // Sections
  renderPM2(data.pm2);
  renderCPU(data.cpu);
  renderCPUCores(data.cpuCores);
  renderThermal(data.thermal);
  renderLoad(data.loadavg);
  renderMemory(data.memory);
  renderSwap(data.swap);
  renderDisk(data.disk);
  renderNetworkRates(data.network);
  renderConnectivity({ internet: data.internet, dns: data.dns }, data.dnsStats);
  renderBattery(data.battery);
  renderTorrents(data.torrents);
  renderSpeedtest(data.speedtest);
  renderSystem(data.system);

  // New modules
  renderSparklines(data);
  checkAlerts(data);
  updateServiceHealth(data.services);

  // Toggle logout button visibility based on auth settings
  const logoutBtn = $('logout-btn');
  if (logoutBtn) {
    logoutBtn.style.display = data.authEnabled ? 'inline-flex' : 'none';
  }

  // Reset stale timer
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    dot.className = 'status-dot stale';
    $('status-text').textContent = 'Connected \u2014 data stale';
  }, POLL_MS * 2.5);
}

function setErrorState(msg) {
  $('status-dot').className = 'status-dot off';
  $('last-update').textContent = 'Connection lost. Retrying\u2026';
  $('status-text').textContent = 'Disconnected \u2014 ' + msg;
}

function connectWS() {
  if (socket) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('WebSocket connected');
    document.title = 'Server Dashboard';
    $('status-dot').className = 'status-dot';
    $('status-text').textContent = 'Connected';
    initNotifications(); // initialize HTML5 notification requests
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      updateUI(data);
    } catch (err) {
      console.error('Failed to parse WS packet:', err);
    }
  };

  socket.onclose = () => {
    socket = null;
    setErrorState('WS connection closed');
    // Reconnect in 5s if page is active
    if (!document.hidden && !reconnectTimeout) {
      reconnectTimeout = setTimeout(connectWS, 5000);
    }
  };

  socket.onerror = (err) => {
    console.error('WS error:', err);
    socket.close();
  };
}

function disconnectWS() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
}

function fetchStatus() {
  // Legacy fallback or WS trigger
  if (!socket) connectWS();
}

export { fetchStatus, connectWS, disconnectWS, setErrorState, updateUI };
