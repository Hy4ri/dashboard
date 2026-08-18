import { fmtBytes } from '../utils/format.js';
import { $, esc, setTextOf } from '../utils/dom.js';
import { showLogsModal } from './logs-modal.js';
import { pm2ControlAction } from '../pm2-menu.js';
import { PM2Process } from '../../shared/types.js';

let eventsRegistered = false;
let headersRegistered = false;
let filtersRegistered = false;
let currentSortBy: keyof PM2Process | null = 'name'; // default sort by name
let currentSortOrder: 'asc' | 'desc' = 'asc'; // asc or desc
let lastPM2Data: PM2Process[] | null = null; // cached copy of last data payload for immediate resort
let searchQuery = '';
let statusFilter = 'all';

const COLS = 4; // Name+Status, CPU, Memory, Actions

function setupPM2Actions(): void {
  if (eventsRegistered) return;
  const tbody = $('pm2-body');
  if (!tbody) return;

  tbody.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const btn = e.target.closest('.pm2-action-btn');
    if (!btn) return;

    e.stopPropagation();
    const name = btn.getAttribute('data-name');
    if (!name) return;

    if (btn.classList.contains('logs')) {
      showLogsModal(name);
    } else {
      const action = btn.getAttribute('data-action');
      if (action) {
        pm2ControlAction(name, action);
      }
    }
  });

  eventsRegistered = true;
}

function setupPM2Headers(): void {
  if (headersRegistered) return;
  const table = document.querySelector('#pm2-card table');
  if (!table) return;
  const headers = table.querySelectorAll<HTMLElement>('thead th');

  const cpuHeader = headers[1];
  const memHeader = headers[2];

  const makeClickable = (header: HTMLElement | undefined, field: keyof PM2Process) => {
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

function toggleSort(field: keyof PM2Process): void {
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

function updateHeaderIndicators(): void {
  const table = document.querySelector('#pm2-card table');
  if (!table) return;
  const headers = table.querySelectorAll<HTMLElement>('thead th');

  const resetHeader = (header: HTMLElement | undefined, text: string) => {
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

function setupPM2Filters(): void {
  if (filtersRegistered) return;

  const searchInput = $<HTMLInputElement>('pm2-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      if (lastPM2Data) renderPM2(lastPM2Data);
    });
  }

  const pills = document.querySelectorAll<HTMLElement>('#pm2-filter-pills .filter-pill');
  pills.forEach((pill) => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      statusFilter = pill.getAttribute('data-filter') || 'all';
      if (lastPM2Data) renderPM2(lastPM2Data);
    });
  });

  filtersRegistered = true;
}

function updateFilterCounts(data: PM2Process[]): void {
  const total = data.length;
  const online = data.filter(p => p.status === 'online').length;
  const errored = data.filter(p => p.status === 'errored').length;
  const stopped = data.filter(p => p.status === 'stopped').length;

  const setCnt = (id: string, val: number) => {
    const el = $(id);
    if (el) el.textContent = String(val);
  };

  setCnt('filter-count-all', total);
  setCnt('filter-count-online', online);
  setCnt('filter-count-errored', errored);
  setCnt('filter-count-stopped', stopped);
}

export function initPM2UI(): void {
  setupPM2Actions();
  setupPM2Headers();
  setupPM2Filters();
}

function buildActionsHTML(name: string, status: string): string {
  return '<div class="pm2-actions-cell">' +
    (status === 'stopped'
      ? '<button class="pm2-action-btn start" data-action="start" data-name="' + esc(name) + '" title="Start">▶</button>'
      : '<button class="pm2-action-btn stop" data-action="stop" data-name="' + esc(name) + '" title="Stop">■</button>') +
    '<button class="pm2-action-btn restart" data-action="restart" data-name="' + esc(name) + '" title="Restart">↻</button>' +
    '<button class="pm2-action-btn delete" data-action="delete" data-name="' + esc(name) + '" title="Delete">✕</button>' +
    '<button class="pm2-action-btn logs" data-name="' + esc(name) + '" title="View Logs">📄</button>' +
  '</div>';
}

export function renderPM2(data?: PM2Process[] | null): void {
  const tbody = $('pm2-body');
  if (!tbody) return;
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="' + COLS + '" class="none">No processes monitored. Is PM2 running?</td></tr>';
    return;
  }

  // Cache data
  lastPM2Data = data;

  setupPM2Actions();
  setupPM2Headers();
  setupPM2Filters();
  updateHeaderIndicators();
  updateFilterCounts(data);

  // Apply search & status filters
  let filteredData = [...data];
  if (searchQuery) {
    filteredData = filteredData.filter(p => p.name.toLowerCase().includes(searchQuery));
  }
  if (statusFilter !== 'all') {
    filteredData = filteredData.filter(p => p.status === statusFilter);
  }

  if (filteredData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="' + COLS + '" class="none">No matching processes found</td></tr>';
    return;
  }

  // Sort data copy
  const sortedData = filteredData;
  if (currentSortBy) {
    const field = currentSortBy;
    sortedData.sort((a, b) => {
      if (field === 'name' || field === 'status') {
        const strA = String(a[field] ?? '');
        const strB = String(b[field] ?? '');
        return currentSortOrder === 'asc'
          ? strA.localeCompare(strB)
          : strB.localeCompare(strA);
      }
      const numA = Number(a[field] ?? 0);
      const numB = Number(b[field] ?? 0);
      return currentSortOrder === 'asc' ? numA - numB : numB - numA;
    });
  }

  // Check if row count changed (full rebuild needed)
  const existing = tbody.querySelectorAll('tr[data-pm-id]');
  if (existing.length !== sortedData.length) {
    // Rebuild all rows
    tbody.innerHTML = sortedData.map(p => {
      const stCls = p.status === 'online' ? 'online' : p.status === 'errored' ? 'errored' : 'stopped';
      const restartWarnCls = p.restarts >= 5 ? ' restart-high' : '';
      const nameSuffix = p.restarts > 0 ? ' <span class="restart-count' + restartWarnCls + '" title="' + p.restarts + ' restarts">• ' + p.restarts + '</span>' : '';
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

    row.setAttribute('data-pm-id', targetProcess.id.toString());

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
        cells[0].appendChild(restSpan);
      }
      const restartWarnCls = targetProcess.restarts >= 5 ? ' restart-high' : '';
      restSpan.className = 'restart-count' + restartWarnCls;
      restSpan.textContent = '• ' + targetProcess.restarts;
      restSpan.setAttribute('title', targetProcess.restarts + ' restarts');
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
