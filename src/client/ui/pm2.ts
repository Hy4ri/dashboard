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
      showLogsModal(id, name, () => pm2ControlAction(id, 'delete', name));
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

  // Each sortable header holds a real button, so the keyboard can sort.
  const buttons = table.querySelectorAll<HTMLElement>('thead [data-sort-btn]');
  buttons.forEach((btn) => {
    const field = btn.getAttribute('data-sort-btn') as keyof PM2Process | null;
    if (field) btn.addEventListener('click', () => toggleSort(field));
  });

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

const SORT_ARROW_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
const SORT_ARROW_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

// aria-sort tells assistive technology which column is sorted and how.
// The arrow shows the same state to sighted users.
function updateHeaderIndicators(): void {
  const table = document.querySelector('#pm2-card table');
  if (!table) return;
  table.querySelectorAll<HTMLElement>('thead th[data-sort]').forEach((th) => {
    const active = th.getAttribute('data-sort') === currentSortBy;
    th.setAttribute('aria-sort', active ? (currentSortOrder === 'asc' ? 'ascending' : 'descending') : 'none');
    const ind = th.querySelector<HTMLElement>('.sort-ind');
    if (ind) ind.innerHTML = active ? (currentSortOrder === 'asc' ? SORT_ARROW_UP : SORT_ARROW_DOWN) : '';
  });
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
      pills.forEach((p) => {
        p.classList.remove('active');
        p.setAttribute('aria-pressed', 'false');
      });
      pill.classList.add('active');
      pill.setAttribute('aria-pressed', 'true');
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

const ICON_ATTRS = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_PLAY = '<svg ' + ICON_ATTRS + '><polygon points="6 4 20 12 6 20 6 4"/></svg>';
const ICON_STOP = '<svg ' + ICON_ATTRS + '><rect x="5" y="5" width="14" height="14" rx="1"/></svg>';
const ICON_RESTART = '<svg ' + ICON_ATTRS + '><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>';
const ICON_LOGS = '<svg ' + ICON_ATTRS + '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

// Delete is not a row action. It lives in the process dialog, away from Stop
// and Restart, so a mis-tap cannot remove a process.
function buildActionsHTML(p: PM2Process): string {
  const name = esc(p.name);
  const attrs = 'data-id="' + p.id + '" data-name="' + name + '"';
  return '<div class="pm2-actions-cell">' +
    (p.status === 'stopped'
      ? '<button class="pm2-action-btn start" data-action="start" ' + attrs + ' title="Start" aria-label="Start ' + name + '">' + ICON_PLAY + '</button>'
      : '<button class="pm2-action-btn stop" data-action="stop" ' + attrs + ' title="Stop" aria-label="Stop ' + name + '">' + ICON_STOP + '</button>') +
    '<button class="pm2-action-btn restart" data-action="restart" ' + attrs + ' title="Restart" aria-label="Restart ' + name + '">' + ICON_RESTART + '</button>' +
    '<button class="pm2-action-btn logs" ' + attrs + ' title="Details and logs" aria-label="Details and logs for ' + name + '">' + ICON_LOGS + '</button>' +
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

// Status is shown with a dot, and also as text: errored and stopped have a
// visible label, online has a screen-reader label.
function applyStatus(cell: HTMLElement, status: string): void {
  const stCls = status === 'online' ? 'online' : status === 'errored' ? 'errored' : 'stopped';
  const indicator = cell.querySelector('.status-indicator');
  if (indicator) indicator.className = 'status-indicator ' + stCls;
  let text = cell.querySelector<HTMLElement>('.status-text');
  if (!text) {
    text = document.createElement('span');
    cell.appendChild(text);
  }
  text.className = stCls === 'online' ? 'status-text sr-only' : 'status-text ' + stCls;
  text.textContent = status;
}

function applyRestarts(cell: HTMLElement, restarts: number): void {
  let span = cell.querySelector<HTMLElement>('.restart-count');
  if (restarts > 0) {
    if (!span) {
      span = document.createElement('span');
      cell.appendChild(span);
    }
    span.className = 'restart-count' + (restarts >= 5 ? ' restart-high' : '');
    span.textContent = restarts + (restarts === 1 ? ' restart' : ' restarts');
  } else if (span) {
    span.remove();
  }
}

function createRowElement(p: PM2Process): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.setAttribute('data-pm-id', String(p.id));

  // Cell 0: Name + Status
  const td0 = document.createElement('td');
  const indicator = document.createElement('span');
  indicator.className = 'status-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  const strong = document.createElement('strong');
  strong.textContent = p.name;
  td0.appendChild(indicator);
  td0.appendChild(strong);
  applyStatus(td0, p.status);
  applyRestarts(td0, p.restarts);
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

  // Cell 0: Name + Status
  const nameStrong = cells[0].querySelector('strong');
  if (nameStrong) setTextOf(nameStrong, p.name);
  applyStatus(cells[0], p.status);
  applyRestarts(cells[0], p.restarts);

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
