/* ── Data fetching and UI update coordination ───────────────────── */

import { $ } from './utils/dom.js';
import { fmtTime } from './utils/format.js';
import { POLL_MS } from './config.js';

// Renderers - import all of them
import { renderPM2 } from './ui/pm2.js';
import { renderCPU, renderCPUCores, renderLoad } from './ui/cpu.js';
import { renderMemory, renderSwap } from './ui/memory.js';
import { renderDisk } from './ui/disk.js';
import { renderNetworkRates, renderConnectivity } from './ui/network.js';
import { renderBattery } from './ui/battery.js';
import { renderTorrents } from './ui/torrents.js';
import { renderThermal } from './ui/thermal.js';
import { renderSystem } from './ui/system.js';
import { renderSparklines } from './ui/sparklines.js';
import { checkAlerts, initNotifications } from './ui/alerts.js';
import { updateServiceHealth } from './service-bar.js';
import { updateCPULoad } from './particles.js';
import { DashboardState } from '../shared/types.js';

let staleTimer: any = null;
let socket: WebSocket | null = null;
let reconnectTimeout: any = null;

export function updateUI(data?: DashboardState | null): void {
  if (!data) return;

  // Timestamp & status
  const lastUpdate = $('last-update');
  if (lastUpdate) {
    lastUpdate.textContent = 'Last: ' + fmtTime(data.timestamp);
  }
  const dot = $('status-dot');
  if (dot) {
    dot.className = 'status-dot';
  }

  // Update sr-only status text
  const statusText = $('status-text');
  if (statusText) {
    statusText.textContent = 'Connected';
  }

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
  renderSystem(data.system);

  // New modules
  renderSparklines(data);
  checkAlerts(data);
  updateServiceHealth(data.services);
  updateCPULoad(data.cpu);

  // Toggle logout button visibility based on auth settings
  const logoutBtn = $('logout-btn');
  if (logoutBtn) {
    logoutBtn.style.display = data.authEnabled ? 'inline-flex' : 'none';
  }

  // Reset stale timer
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    if (dot) dot.className = 'status-dot stale';
    if (statusText) statusText.textContent = 'Connected — data stale';
  }, POLL_MS * 2.5);
}

export function setErrorState(msg: string): void {
  const dot = $('status-dot');
  if (dot) dot.className = 'status-dot off';
  const lastUpdate = $('last-update');
  if (lastUpdate) lastUpdate.textContent = 'Connection lost. Retrying…';
  const statusText = $('status-text');
  if (statusText) statusText.textContent = 'Disconnected — ' + msg;
}

export function connectWS(): void {
  if (socket) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('WebSocket connected');
    document.title = 'Server Dashboard';
    const dot = $('status-dot');
    if (dot) dot.className = 'status-dot';
    const statusText = $('status-text');
    if (statusText) statusText.textContent = 'Connected';
    initNotifications(); // initialize HTML5 notification requests
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };

  socket.onmessage = (event) => {
    try {
      const data: DashboardState = JSON.parse(event.data);
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
    socket?.close();
  };
}

export function disconnectWS(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
}

export async function fetchStatus(): Promise<void> {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      const data: DashboardState = await res.json();
      updateUI(data);
    }
  } catch (err) {
    console.warn('fetchStatus failed:', err);
  }
}
