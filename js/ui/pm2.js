import { fmtBytes, fmtUptime, NONE } from '../utils/format.js';
import { $, esc, setTextOf, setTextOfLast } from '../utils/dom.js';
import { showLogsModal } from './logs-modal.js';
import { pm2ControlAction } from '../pm2-menu.js';

let eventsRegistered = false;
let headersRegistered = false;
let currentSortBy = 'name'; // default sort by name
let currentSortOrder = 'asc'; // asc or desc
let lastPM2Data = null; // cached copy of last data payload for immediate resort

const COLS = 4; // Name+Status, CPU, Memory, Actions

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

  const cpuHeader = headers[1];
  const memHeader = headers[2];

  const makeClickable = (header, field) => {
    if (header) {
      header.style.cursor = 'pointer';
      header.style.userSelect = 'none';
      header.addEventListener('click', () => toggleSort(field));
    }
  };

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

  // Name = 0, CPU = 1, Memory = 2, Actions = 3
  resetHeader(headers[1], 'CPU');
  resetHeader(headers[2], 'Memory');

  const indicator = currentSortOrder === 'asc' ? ' ▲' : ' ▼';
  if (currentSortBy === 'cpu' && headers[1]) {
    headers[1].innerHTML = 'CPU' + indicator;
  } else if (currentSortBy === 'memory' && headers[2]) {
    headers[2].innerHTML = 'Memory' + indicator;
  }
}

function buildActionsHTML(name, status) {
  return '<div class="pm2-actions-cell">' +
    (status === 'stopped'
      ? '<button class="pm2-action-btn start" data-action="start" data-name="' + esc(name) + '" title="Start">▶</button>'
      : '<button class="pm2-action-btn stop" data-action="stop" data-name="' + esc(name) + '" title="Stop">■</button>') +
    '<button class="pm2-action-btn restart" data-action="restart" data-name="' + esc(name) + '" title="Restart">↻</button>' +
    '<button class="pm2-action-btn delete" data-action="delete" data-name="' + esc(name) + '" title="Delete">✕</button>' +
    '<button class="pm2-action-btn logs" data-name="' + esc(name) + '" title="View Logs">📄</button>' +
  '</div>';
}

function renderPM2(data) {
  const tbody = $('pm2-body');
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="' + COLS + '" class="none">No processes monitored. Is PM2 running?</td></tr>';
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
      const nameSuffix = p.restarts > 0 ? ' <span class="restart-count">• ' + p.restarts + '</span>' : '';
      return '<tr data-pm-id="' + p.id + '">' +
        '<td><span class="status-indicator ' + stCls + '"></span><strong>' + esc(p.name) + '</strong>' + nameSuffix + '</td>' +
        '<td>' + p.cpu.toFixed(1) + '%</td>' +
        '<td>' + fmtBytes(p.memory) + '</td>' +
        '<td>' + buildActionsHTML(p.name, p.status) + '</td>' +
        '</tr>';
    }).join('');
    return;
  }

  // Patch existing rows in-place
  const rows = tbody.querySelectorAll('tr[data-pm-id]');

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const targetProcess = sortedData[idx];
    
    row.setAttribute('data-pm-id', targetProcess.id);
    
    const cells = row.querySelectorAll('td');
    if (cells.length < COLS) continue;

    const stCls = targetProcess.status === 'online' ? 'online' : targetProcess.status === 'errored' ? 'errored' : 'stopped';

    // Name + Status (cell 0)
    const nameStrong = cells[0].querySelector('strong');
    if (nameStrong) setTextOf(nameStrong, esc(targetProcess.name));
    // Update restart count suffix
    let restSpan = cells[0].querySelector('.restart-count');
    if (targetProcess.restarts > 0) {
      if (!restSpan) {
        restSpan = document.createElement('span');
        restSpan.className = 'restart-count';
        cells[0].appendChild(restSpan);
      }
      restSpan.textContent = '• ' + targetProcess.restarts;
    } else {
      if (restSpan) restSpan.remove();
    }
    const indicator = cells[0].querySelector('.status-indicator');
    if (indicator) indicator.className = 'status-indicator ' + stCls;

    // CPU (cell 1)
    setTextOf(cells[1], targetProcess.cpu.toFixed(1) + '%');

    // Memory (cell 2)
    setTextOf(cells[2], fmtBytes(targetProcess.memory));

    // Actions (cell 3)
    cells[3].innerHTML = buildActionsHTML(targetProcess.name, targetProcess.status);
  }
}

export { renderPM2 };
