import { fmtBytes } from '../utils/format.js';
import { $, esc, setTextOf } from '../utils/dom.js';
import { showLogsModal } from './logs-modal.js';
import { pm2ControlAction } from '../pm2-actions.js';
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
    const id = Number(btn.getAttribute('data-id'));
    const name = btn.getAttribute('data-name') || '';
    if (!Number.isInteger(id)) return;

    if (btn.classList.contains('logs')) {
      showLogsModal(id, name);
    } else {
      const action = btn.getAttribute('data-action');
      if (action) {
        pm2ControlAction(id, action, name);
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

  const nameHeader = headers[0];
  const cpuHeader = headers[1];
  const memHeader = headers[2];

  const makeClickable = (header: HTMLElement | undefined, field: keyof PM2Process) => {
    if (header) {
      header.style.cursor = 'pointer';
      header.style.userSelect = 'none';
      header.addEventListener('click', () => toggleSort(field));
    }
  };

  makeClickable(nameHeader, 'name');
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
  resetHeader(headers[0], 'Name');
  resetHeader(headers[1], 'CPU');
  resetHeader(headers[2], 'Memory');

  const indicator = currentSortOrder === 'asc' ? ' ▲' : ' ▼';
  const active = { name: headers[0], cpu: headers[1], memory: headers[2] }[currentSortBy as 'name' | 'cpu' | 'memory'];
  if (active) {
    active.innerHTML = active.textContent + indicator;
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

function buildActionsHTML(p: PM2Process): string {
  const attrs = 'data-id="' + p.id + '" data-name="' + esc(p.name) + '"';
  return '<div class="pm2-actions-cell">' +
    (p.status === 'stopped'
      ? '<button class="pm2-action-btn start" data-action="start" ' + attrs + ' title="Start">▶</button>'
      : '<button class="pm2-action-btn stop" data-action="stop" ' + attrs + ' title="Stop">■</button>') +
    '<button class="pm2-action-btn restart" data-action="restart" ' + attrs + ' title="Restart">↻</button>' +
    '<button class="pm2-action-btn delete" data-action="delete" ' + attrs + ' title="Delete">✕</button>' +
    '<button class="pm2-action-btn logs" ' + attrs + ' title="View Logs">📄</button>' +
  '</div>';
}

function updateActionsCell(cell: HTMLElement, p: PM2Process): void {
  const desiredSig = `${p.id}::${p.status}`;
  if (cell.dataset.actionSig === desiredSig) {
    return;
  }
  cell.dataset.actionSig = desiredSig;
  cell.innerHTML = buildActionsHTML(p);
}

function createRowElement(p: PM2Process): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.setAttribute('data-pm-id', String(p.id));

  // Cell 0: Name + Status
  const td0 = document.createElement('td');
  const indicator = document.createElement('span');
  const stCls = p.status === 'online' ? 'online' : p.status === 'errored' ? 'errored' : 'stopped';
  indicator.className = 'status-indicator ' + stCls;
  const strong = document.createElement('strong');
  strong.textContent = p.name;
  td0.appendChild(indicator);
  td0.appendChild(strong);

  if (p.restarts > 0) {
    const restartSpan = document.createElement('span');
    const restartWarnCls = p.restarts >= 5 ? ' restart-high' : '';
    restartSpan.className = 'restart-count' + restartWarnCls;
    restartSpan.textContent = '• ' + p.restarts;
    restartSpan.setAttribute('title', p.restarts + ' restarts');
    td0.appendChild(document.createTextNode(' '));
    td0.appendChild(restartSpan);
  }
  tr.appendChild(td0);

  // Cell 1: CPU
  const td1 = document.createElement('td');
  td1.textContent = p.cpu.toFixed(1) + '%';
  tr.appendChild(td1);

  // Cell 2: Memory
  const td2 = document.createElement('td');
  td2.textContent = fmtBytes(p.memory);
  tr.appendChild(td2);

  // Cell 3: Actions
  const td3 = document.createElement('td');
  updateActionsCell(td3, p);
  tr.appendChild(td3);

  return tr;
}

function updateRowElement(row: HTMLTableRowElement, p: PM2Process): void {
  row.setAttribute('data-pm-id', String(p.id));
  const cells = row.querySelectorAll('td');
  if (cells.length < COLS) return;

  const stCls = p.status === 'online' ? 'online' : p.status === 'errored' ? 'errored' : 'stopped';

  // Cell 0: Name + Status
  const indicator = cells[0].querySelector('.status-indicator');
  if (indicator) indicator.className = 'status-indicator ' + stCls;

  const nameStrong = cells[0].querySelector('strong');
  if (nameStrong) setTextOf(nameStrong, p.name);

  let restSpan = cells[0].querySelector('.restart-count');
  if (p.restarts > 0) {
    if (!restSpan) {
      restSpan = document.createElement('span');
      cells[0].appendChild(document.createTextNode(' '));
      cells[0].appendChild(restSpan);
    }
    const restartWarnCls = p.restarts >= 5 ? ' restart-high' : '';
    restSpan.className = 'restart-count' + restartWarnCls;
    restSpan.textContent = '• ' + p.restarts;
    restSpan.setAttribute('title', p.restarts + ' restarts');
  } else if (restSpan) {
    restSpan.remove();
  }

  // Cell 1: CPU
  setTextOf(cells[1], p.cpu.toFixed(1) + '%');

  // Cell 2: Memory
  setTextOf(cells[2], fmtBytes(p.memory));

  // Cell 3: Actions - preserve buttons if signature identical
  updateActionsCell(cells[3], p);
}

export function renderPM2(data?: PM2Process[] | null): void {
  const tbody = $('pm2-body');
  if (!tbody) return;
  if (!data || data.length === 0) {
    const message = data == null ? 'PM2 data unavailable.' : 'No processes monitored. Is PM2 running?';
    tbody.innerHTML = '<tr><td colspan="' + COLS + '" class="none">' + message + '</td></tr>';
    updateFilterCounts([]);
    lastPM2Data = null;
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

  // Keyed row reconciliation by stable key (process id)
  const existingRows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-pm-id]'));
  const existingMap = new Map<string, HTMLTableRowElement>();
  for (const row of existingRows) {
    const key = row.getAttribute('data-pm-id');
    if (key) existingMap.set(key, row);
  }

  // Clear none/empty message if present
  const nonDataRows = tbody.querySelectorAll('tr:not([data-pm-id])');
  nonDataRows.forEach(r => r.remove());

  const targetKeys = new Set<string>();
  let position = 0;
  const active = document.activeElement as HTMLElement | null;
  const restoreFocus = active && tbody.contains(active);

  for (const p of sortedData) {
    const key = String(p.id);
    targetKeys.add(key);
    let row = existingMap.get(key);
    if (row) {
      updateRowElement(row, p);
    } else {
      row = createRowElement(p);
    }
    if (tbody.children[position] !== row) {
      tbody.insertBefore(row, tbody.children[position] || null);
    }
    position++;
  }

  // Remove rows that no longer exist in sortedData
  for (const [key, row] of existingMap.entries()) {
    if (!targetKeys.has(key)) {
      row.remove();
    }
  }

  // Re-append rows in sorted order
  if (restoreFocus && active.isConnected && document.activeElement !== active) {
    active.focus({ preventScroll: true });
  }
}
