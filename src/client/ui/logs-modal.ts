import { $ } from '../utils/dom.js';

let modalEl: HTMLElement | null = null;
let currentProcessName: string | null = null;
let activeLogTab: 'out' | 'err' = 'out';
let logData = { out: '', err: '' };
let autoScroll = true;
let lastFetchedAt = '';

function esc(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function fetchLogs(): Promise<void> {
  const codeEl = $('pm2-log-content');
  if (!codeEl || !currentProcessName) return;

  codeEl.textContent = 'Loading logs...';

  try {
    const res = await fetch('/api/pm2/logs/' + encodeURIComponent(currentProcessName));
    const data = await res.json();
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
    codeEl.textContent = 'Failed to load logs: ' + err.message;
  }
}

function renderLogContent(): void {
  const codeEl = $('pm2-log-content');
  if (!codeEl) return;

  const content = activeLogTab === 'out' ? logData.out : logData.err;
  codeEl.innerHTML = esc(content);

  const tsEl = $('pm2-log-timestamp');
  if (tsEl) {
    tsEl.textContent = lastFetchedAt ? '📋 Fetched: ' + lastFetchedAt : '';
  }

  if (autoScroll) {
    const container = $('pm2-log-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }
}

export function closeLogsModal(): void {
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
  }
  currentProcessName = null;
}

export function showLogsModal(processName: string): void {
  closeLogsModal();
  currentProcessName = processName;
  activeLogTab = 'out';
  autoScroll = true;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'pm2-logs-modal';

  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3>PM2 Process Logs: <code>${esc(processName)}</code></h3>
        <button class="modal-close-btn" id="pm2-logs-close">&times;</button>
      </div>
      <div class="modal-tabs">
        <button class="tab-btn active" id="tab-out-btn">stdout (out)</button>
        <button class="tab-btn" id="tab-err-btn">stderr (err)</button>
      </div>
      <div class="modal-controls">
        <label class="checkbox-label">
          <input type="checkbox" id="auto-scroll-chk" checked>
          Auto-scroll to bottom
        </label>
        <span id="pm2-log-timestamp" class="log-timestamp"></span>
        <button class="refresh-btn" id="refresh-logs-btn">↻ Refresh</button>
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
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeLogsModal();
  });

  $('tab-out-btn')?.addEventListener('click', () => {
    $('tab-out-btn')?.classList.add('active');
    $('tab-err-btn')?.classList.remove('active');
    activeLogTab = 'out';
    renderLogContent();
  });

  $('tab-err-btn')?.addEventListener('click', () => {
    $('tab-err-btn')?.classList.add('active');
    $('tab-out-btn')?.classList.remove('active');
    activeLogTab = 'err';
    renderLogContent();
  });

  const scrollChk = $('auto-scroll-chk') as HTMLInputElement | null;
  scrollChk?.addEventListener('change', (e) => {
    autoScroll = (e.target as HTMLInputElement).checked;
    if (autoScroll) renderLogContent();
  });

  $('refresh-logs-btn')?.addEventListener('click', fetchLogs);

  // Initial Fetch
  fetchLogs();
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLogsModal();
});
