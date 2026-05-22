/* ── Data fetching and UI update coordination ───────────────────── */

import { $ } from './utils/dom.js';
import { fmtTime } from './utils/format.js';
import { POLL_MS } from './config.js';

// Renderers - import all of them
import { renderPM2 } from './ui/pm2.js';
import { renderCPU, renderCPUCores, renderLoad } from './ui/cpu.js';
import { renderMemory, renderSwap } from './ui/memory.js';
import { renderDisk } from './ui/disk.js';
import { renderNetwork, renderConnectivity, renderSpeedtest } from './ui/network.js';
import { renderBattery } from './ui/battery.js';
import { renderTorrents } from './ui/torrents.js';
import { renderThermal, renderFreq } from './ui/thermal.js';
import { renderSystem } from './ui/system.js';

let staleTimer = null;

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
  renderFreq(data.frequency);
  renderLoad(data.loadavg);
  renderMemory(data.memory);
  renderSwap(data.swap);
  renderDisk(data.disk);
  renderNetwork(data.network);
  renderConnectivity({ internet: data.internet, dns: data.dns });
  renderBattery(data.battery);
  renderTorrents(data.torrents);
  renderSpeedtest(data.speedtest);
  renderSystem(data.system);
}

function setErrorState(msg) {
  $('status-dot').className = 'status-dot off';
  $('last-update').textContent = 'Connection lost. Retrying\u2026';
  $('status-text').textContent = 'Disconnected \u2014 ' + msg;
}

function doFetch({ onStart, onDone }) {
  if (onStart) onStart();
  fetch('/api/status')
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(data => {
      updateUI(data);
      $('status-dot').className = 'status-dot';
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        $('status-dot').className = 'status-dot stale';
        $('status-text').textContent = 'Connected \u2014 data stale';
      }, POLL_MS * 2);
      if (onDone) onDone();
    })
    .catch(err => {
      setErrorState(err.message);
      if (onDone) onDone();
    });
}

function fetchStatus() {
  doFetch({});
}

export { fetchStatus, doFetch, setErrorState };
