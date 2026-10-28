import { $ } from '../utils/dom.js';

let modalEl: HTMLElement | null = null;
let currentProcessId: number | null = null;
let currentProcessName: string | null = null;
let activeLogTab: 'out' | 'err' = 'out';
const logData = { out: '', err: '' };
let autoScroll = true;
let lastFetchedAt = '';
let selectedLines = 100;
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let currentAbortController: AbortController | null = null;
let currentGeneration = 0;
let isFetching = false;
let opener: HTMLElement | null = null;

const ICON_ATTRS = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_CLOSE = '<svg ' + ICON_ATTRS + '><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const ICON_REFRESH = '<svg ' + ICON_ATTRS + '><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>';
const ICON_TRASH = '<svg ' + ICON_ATTRS + '><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

function esc(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function fetchLogs(silent: boolean = false): Promise<void> {
  const codeEl = $('pm2-log-content');
  if (!codeEl || currentProcessId === null) return;

  if (isFetching) {
    return;
  }

  isFetching = true;
  const generation = currentGeneration;

  if (currentAbortController) {
    currentAbortController.abort();
  }
  const controller = new AbortController();
  currentAbortController = controller;

  if (!silent) {
    codeEl.textContent = 'Loading logs...';
  }

  try {
    const res = await fetch(`/api/pm2/logs/${currentProcessId}?lines=${selectedLines}`, {
      signal: controller.signal
    });
    const data = await res.json();

    if (generation !== currentGeneration || !modalEl) {
      return;
    }

    if (data.success) {
      logData.out = data.out || 'No stdout logs.';
      logData.err = data.err || 'No stderr logs.';
      const now = new Date();
      lastFetchedAt = String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');
      renderLogContent();
    } else {
      codeEl.textContent = 'Error: ' + (data.error || 'Unknown error');
    }
  } catch (err: any) {
    if (generation !== currentGeneration || !modalEl) {
      return;
    }
    if (err?.name === 'AbortError') {
      return;
    }
    codeEl.textContent = 'Failed to load logs: ' + err.message;
  } finally {
    if (currentAbortController === controller) {
      currentAbortController = null;
      isFetching = false;
    }
  }
}

function renderLogContent(): void {
  const codeEl = $('pm2-log-content');
  if (!codeEl) return;

  const content = activeLogTab === 'out' ? logData.out : logData.err;
  codeEl.innerHTML = esc(content);

  const tsEl = $('pm2-log-timestamp');
  if (tsEl) {
    tsEl.textContent = lastFetchedAt ? 'Fetched: ' + lastFetchedAt : '';
  }

  if (autoScroll) {
    const container = $('pm2-log-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }
}

export function closeLogsModal(): void {
  currentGeneration++;
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  isFetching = false;
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
    // Return focus to the control that opened the dialog.
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  currentProcessId = null;
  currentProcessName = null;
  logData.out = '';
  logData.err = '';
  lastFetchedAt = '';
}

export function showLogsModal(processId: number, processName: string, onDelete?: () => Promise<boolean>): void {
  const active = document.activeElement as HTMLElement | null;
  const trigger = active && typeof active.focus === 'function' ? active : null;
  closeLogsModal();
  opener = trigger;
  currentGeneration++;
  currentProcessId = processId;
  currentProcessName = processName;
  activeLogTab = 'out';
  autoScroll = true;
  selectedLines = 100;
  logData.out = '';
  logData.err = '';
  lastFetchedAt = '';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'pm2-logs-modal';

  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="pm2-logs-title">
      <div class="modal-header">
        <h3 id="pm2-logs-title">Process: <code>${esc(processName)}</code></h3>
        ${onDelete ? `<button type="button" class="btn-danger" id="pm2-delete-btn" title="Delete this process from PM2">${ICON_TRASH}<span>Delete</span></button>` : ''}
        <button type="button" class="modal-close-btn" id="pm2-logs-close" aria-label="Close">${ICON_CLOSE}</button>
      </div>
      <div class="modal-tabs" role="tablist" aria-label="Log stream">
        <button type="button" class="tab-btn active" id="tab-out-btn" role="tab" aria-selected="true">stdout</button>
        <button type="button" class="tab-btn" id="tab-err-btn" role="tab" aria-selected="false">stderr</button>
      </div>
      <div class="modal-controls">
        <label class="checkbox-label">
          <input type="checkbox" id="auto-scroll-chk" checked>
          Auto-scroll
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="auto-refresh-chk">
          Live (3s)
        </label>
        <select id="pm2-log-lines" class="pm2-select-lines" aria-label="Log line count">
          <option value="50">50 lines</option>
          <option value="100" selected>100 lines</option>
          <option value="200">200 lines</option>
          <option value="500">500 lines</option>
        </select>
        <span id="pm2-log-timestamp" class="log-timestamp"></span>
        <button type="button" class="refresh-btn" id="refresh-logs-btn">${ICON_REFRESH}<span>Refresh</span></button>
      </div>
      <div class="modal-body" id="pm2-log-container">
        <pre><code id="pm2-log-content">Loading...</code></pre>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modalEl = modal;

  // Event Listeners
  $('pm2-logs-close')?.addEventListener('click', closeLogsModal);
  $<HTMLButtonElement>('pm2-logs-close')?.focus?.();

  const deleteBtn = $<HTMLButtonElement>('pm2-delete-btn');
  deleteBtn?.addEventListener('click', async () => {
    if (!onDelete) return;
    deleteBtn.disabled = true;
    const deleted = await onDelete();
    if (deleted) {
      closeLogsModal();
    } else {
      deleteBtn.disabled = false;
    }
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeLogsModal();
  });

  $('tab-out-btn')?.addEventListener('click', () => {
    $('tab-out-btn')?.classList.add('active');
    $('tab-err-btn')?.classList.remove('active');
    $('tab-out-btn')?.setAttribute('aria-selected', 'true');
    $('tab-err-btn')?.setAttribute('aria-selected', 'false');
    activeLogTab = 'out';
    renderLogContent();
  });

  $('tab-err-btn')?.addEventListener('click', () => {
    $('tab-err-btn')?.classList.add('active');
    $('tab-out-btn')?.classList.remove('active');
    $('tab-err-btn')?.setAttribute('aria-selected', 'true');
    $('tab-out-btn')?.setAttribute('aria-selected', 'false');
    activeLogTab = 'err';
    renderLogContent();
  });

  const scrollChk = $<HTMLInputElement>('auto-scroll-chk');
  scrollChk?.addEventListener('change', () => {
    if (scrollChk) {
      autoScroll = scrollChk.checked;
      if (autoScroll) renderLogContent();
    }
  });

  const refreshChk = $<HTMLInputElement>('auto-refresh-chk');
  refreshChk?.addEventListener('change', () => {
    if (refreshChk?.checked) {
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      autoRefreshTimer = setInterval(() => {
        fetchLogs(true);
      }, 3000);
    } else {
      if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
      }
    }
  });

  const linesSelect = $<HTMLSelectElement>('pm2-log-lines');
  linesSelect?.addEventListener('change', () => {
    selectedLines = parseInt(linesSelect.value, 10) || 100;
    currentGeneration++;
    currentAbortController?.abort();
    currentAbortController = null;
    isFetching = false;
    fetchLogs();
  });

  $('refresh-logs-btn')?.addEventListener('click', () => fetchLogs(false));

  // Initial Fetch
  fetchLogs();
}

// Escape closes the dialog. Tab stays inside it while it is open.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLogsModal();
    return;
  }
  if (e.key !== 'Tab' || !modalEl) return;
  const focusable = Array.from(
    modalEl.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [href]')
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
});
