import { fmtBytes, fmtUptime, NONE } from '../utils/format.js';
import { $, esc, setTextOf, setTextOfLast } from '../utils/dom.js';
import { showLogsModal } from './logs-modal.js';
import { pm2ControlAction } from '../pm2-menu.js';

let eventsRegistered = false;
let headersRegistered = false;
let currentSortBy = 'id'; // default sort by ID
let currentSortOrder = 'asc'; // asc or desc
let lastPM2Data = null; // cached copy of last data payload for immediate resort

function setupPM2Actions() {
  if (eventsRegistered) return;
  const tbody = $('pm2-body');
  if (!tbody) return;

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.pm2-action-btn');
    if (!btn) return;

    e.stopPropagation();
    const name = btn.getAttribute('data-name');
    
    if (btn.classList.contains('logs')) {
      showLogsModal(name);
    } else {
      const action = btn.getAttribute('data-action');
      pm2ControlAction(name, action);
    }
  });

  eventsRegistered = true;
}

function setupPM2Headers() {
  if (headersRegistered) return;
  const table = document.querySelector('#pm2-card table');
  if (!table) return;
  const headers = table.querySelectorAll('thead th');

  const idHeader = headers[0];
  const cpuHeader = headers[3];
  const memHeader = headers[4];

  const makeClickable = (header, field) => {
    if (header) {
      header.style.cursor = 'pointer';
      header.style.userSelect = 'none';
      header.addEventListener('click', () => toggleSort(field));
    }
  };

  makeClickable(idHeader, 'id');
  makeClickable(cpuHeader, 'cpu');
  makeClickable(memHeader, 'memory');

  headersRegistered = true;
}

function toggleSort(field) {
  if (currentSortBy === field) {
    currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortBy = field;
    currentSortOrder = (field === 'cpu' || field === 'memory') ? 'desc' : 'asc';
  }
  
  if (lastPM2Data) {
    renderPM2(lastPM2Data);
  }
}

function updateHeaderIndicators() {
  const table = document.querySelector('#pm2-card table');
  if (!table) return;
  const headers = table.querySelectorAll('thead th');
  
  const resetHeader = (header, text) => {
    if (header) {
      header.innerHTML = text;
      header.title = `Sort by ${text}`;
    }
  };

  resetHeader(headers[0], 'ID');
  resetHeader(headers[3], 'CPU');
  resetHeader(headers[4], 'Memory');

  const indicator = currentSortOrder === 'asc' ? ' ▲' : ' ▼';
  if (currentSortBy === 'id' && headers[0]) {
    headers[0].innerHTML = 'ID' + indicator;
  } else if (currentSortBy === 'cpu' && headers[3]) {
    headers[3].innerHTML = 'CPU' + indicator;
  } else if (currentSortBy === 'memory' && headers[4]) {
    headers[4].innerHTML = 'Memory' + indicator;
  }
}

function renderPM2(data) {
  const tbody = $('pm2-body');
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="none">No processes monitored. Is PM2 running?</td></tr>';
    return;
  }

  // Cache data
  lastPM2Data = data;

  setupPM2Actions();
  setupPM2Headers();
  updateHeaderIndicators();

  // Sort data copy
  const sortedData = [...data];
  if (currentSortBy) {
    sortedData.sort((a, b) => {
      let valA = a[currentSortBy];
      let valB = b[currentSortBy];

      // Handle null/undef
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === 'string') {
        return currentSortOrder === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        return currentSortOrder === 'asc' 
          ? valA - valB 
          : valB - valA;
      }
    });
  }

  // Check if row count changed (full rebuild needed)
  const existing = tbody.querySelectorAll('tr[data-pm-id]');
  if (existing.length !== sortedData.length) {
    // Rebuild all rows
    tbody.innerHTML = sortedData.map(p => {
      const stCls = p.status === 'online' ? 'online' : p.status === 'errored' ? 'errored' : 'stopped';
      const uptime = p.uptime ? (Date.now() - p.uptime) / 1000 : null;
      return '<tr data-pm-id="' + p.id + '">' +
        '<td>' + p.id + '</td>' +
        '<td><strong>' + esc(p.name) + '</strong></td>' +
        '<td><span class="status-indicator ' + stCls + '"></span>' + esc(p.status) + '</td>' +
        '<td>' + p.cpu.toFixed(1) + '%</td>' +
        '<td>' + fmtBytes(p.memory) + '</td>' +
        '<td>' + fmtUptime(uptime) + '</td>' +
        '<td>' + p.restarts + '</td>' +
        '<td>' + (p.pid || NONE) + '</td>' +
        '<td>' +
          '<div class="pm2-actions-cell">' +
            (p.status === 'stopped'
              ? '<button class="pm2-action-btn start" data-action="start" data-name="' + esc(p.name) + '" title="Start">▶</button>'
              : '<button class="pm2-action-btn stop" data-action="stop" data-name="' + esc(p.name) + '" title="Stop">■</button>') +
            '<button class="pm2-action-btn restart" data-action="restart" data-name="' + esc(p.name) + '" title="Restart">↻</button>' +
            '<button class="pm2-action-btn logs" data-name="' + esc(p.name) + '" title="View Logs">📄</button>' +
          '</div>' +
        '</td>' +
        '</tr>';
    }).join('');
    return;
  }

  // Patch existing rows in-place
  const rows = tbody.querySelectorAll('tr[data-pm-id]');
  const map = {};
  sortedData.forEach(p => { map[p.id] = p; });

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const targetProcess = sortedData[idx];
    
    // If the sorted ID at this DOM position is different from before, re-bind row attributes
    row.setAttribute('data-pm-id', targetProcess.id);
    
    const cells = row.querySelectorAll('td');
    if (cells.length < 9) continue;

    const uptime = targetProcess.uptime ? (Date.now() - targetProcess.uptime) / 1000 : null;
    const stCls = targetProcess.status === 'online' ? 'online' : targetProcess.status === 'errored' ? 'errored' : 'stopped';

    // ID cell
    setTextOf(cells[0], '' + targetProcess.id);

    // Name
    const nameStrong = cells[1].querySelector('strong');
    if (nameStrong) setTextOf(nameStrong, esc(targetProcess.name));

    // Status (cell[2] has span + text)
    const indicator = cells[2].querySelector('.status-indicator');
    if (indicator) {
      indicator.className = 'status-indicator ' + stCls;
    }
    setTextOfLast(cells[2], esc(targetProcess.status));

    setTextOf(cells[3], targetProcess.cpu.toFixed(1) + '%');
    setTextOf(cells[4], fmtBytes(targetProcess.memory));
    setTextOf(cells[5], fmtUptime(uptime));
    setTextOf(cells[6], '' + targetProcess.restarts);
    setTextOf(cells[7], targetProcess.pid || NONE);

    // Update Action Buttons
    const actionCell = cells[8];
    if (actionCell) {
      actionCell.innerHTML = 
        '<div class="pm2-actions-cell">' +
          (targetProcess.status === 'stopped'
            ? '<button class="pm2-action-btn start" data-action="start" data-name="' + esc(targetProcess.name) + '" title="Start">▶</button>'
            : '<button class="pm2-action-btn stop" data-action="stop" data-name="' + esc(targetProcess.name) + '" title="Stop">■</button>') +
          '<button class="pm2-action-btn restart" data-action="restart" data-name="' + esc(targetProcess.name) + '" title="Restart">↻</button>' +
          '<button class="pm2-action-btn logs" data-name="' + esc(targetProcess.name) + '" title="View Logs">📄</button>' +
        '</div>';
    }
  }
}

export { renderPM2 };
