/* ── PM2 context menu ───────────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { fetchStatus } from './api.js';

export let pm2MenuEl: HTMLElement | null = null;
export let pm2MenuTarget: { name: string; status: string } | null = null;

// Guard sets to prevent duplicate mutations across renders
const pendingPM2Targets = new Set<string>();
let isPM2BulkPending = false;

export function showPM2Menu(name: string, status: string, rect: DOMRect): void {
  // Remove any existing menu
  closePM2Menu();

  const menu = document.createElement('div');
  menu.className = 'pm2-menu';

  const actions = status === 'stopped'
    ? [{ label: 'Start', action: 'start', cls: 'pm2-btn-start' }]
    : status === 'online' || status === 'errored'
    ? [
        { label: 'Stop', action: 'stop', cls: 'pm2-btn-stop' },
        { label: 'Restart', action: 'restart', cls: 'pm2-btn-restart' },
        { label: 'Delete', action: 'delete', cls: 'pm2-btn-delete' },
      ]
    : [];

  actions.forEach(({ label, action, cls }) => {
    const btn = document.createElement('button');
    btn.className = 'pm2-btn ' + cls;
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      pm2ControlAction(name, action);
      closePM2Menu();
    });
    menu.appendChild(btn);
  });

  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';

  document.body.appendChild(menu);
  pm2MenuEl = menu;
  pm2MenuTarget = { name, status };
}

export function closePM2Menu(): void {
  if (pm2MenuEl) {
    pm2MenuEl.remove();
    pm2MenuEl = null;
  }
  pm2MenuTarget = null;
}

export async function pm2ControlAction(target: string | number, action: string): Promise<void> {
  const targetKey = String(target);
  if (isPM2BulkPending || pendingPM2Targets.has(targetKey)) {
    return;
  }

  if (action === 'delete' && !confirm(`Permanently delete process "${target}" from PM2? This cannot be undone.`)) {
    return;
  }

  pendingPM2Targets.add(targetKey);
  try {
    const res = await fetch('/api/pm2/' + action + '/' + encodeURIComponent(targetKey), { method: 'POST' });
    let data: any = null;
    try {
      data = await res.json();
    } catch {}
    if (res.ok && data?.success) {
      fetchStatus();
    } else {
      const errDetail = data?.error || (res.status ? `HTTP ${res.status}` : 'Unknown error');
      alert('Error: ' + errDetail);
    }
  } catch (err: any) {
    alert('Request failed: ' + (err?.message || 'Network error'));
  } finally {
    pendingPM2Targets.delete(targetKey);
  }
}

export function setupPM2Menu(): void {
  // Click on PM2 name → show menu
  const tbody = $('pm2-body');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      if (!(e.target instanceof Element)) return;
      const nameEl = e.target.closest('td strong');
      if (!nameEl) return;
      e.stopPropagation();
      const row = nameEl.closest('tr[data-pm-id]');
      if (!row) return;
      const indicator = row.querySelector('.status-indicator');
      const statusText = indicator
        ? (indicator.classList.contains('online') ? 'online' : indicator.classList.contains('errored') ? 'errored' : 'stopped')
        : 'stopped';
      const name = nameEl.textContent?.trim() || '';
      const rect = nameEl.getBoundingClientRect();
      showPM2Menu(name, statusText, rect);
    });
  }

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Node)) return;
    if (pm2MenuEl && !pm2MenuEl.contains(e.target) && (e.target instanceof Element && !e.target.closest('td strong'))) {
      closePM2Menu();
    }
  });

  // Close menu on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePM2Menu();
  });

  // Restart All button
  const restartAllBtn = $<HTMLButtonElement>('restart-all-btn');
  if (restartAllBtn) {
    restartAllBtn.addEventListener('click', async () => {
      if (isPM2BulkPending || pendingPM2Targets.size > 0) return;
      if (!confirm('Restart all processes?')) return;

      isPM2BulkPending = true;
      restartAllBtn.disabled = true;
      restartAllBtn.textContent = '↻ Restarting...';

      let hadFailure = false;
      let failureMsg = '';

      try {
        // Fetch latest process inventory from API
        const statusRes = await fetch('/api/status');
        if (!statusRes.ok) {
          throw new Error(`Failed to fetch inventory (HTTP ${statusRes.status})`);
        }
        const statusData = await statusRes.json();
        if (!Array.isArray(statusData?.pm2)) throw new Error('Process inventory unavailable');
        const processes = statusData.pm2;

        // Restart each process by ID, stopping dashboard process last
        const sortedProcesses = [...processes].sort((a: any, b: any) => {
          const aIsDash = (a?.name === 'dashboard' || a?.name === 'monit') ? 1 : 0;
          const bIsDash = (b?.name === 'dashboard' || b?.name === 'monit') ? 1 : 0;
          return aIsDash - bIsDash;
        });

        for (const proc of sortedProcesses) {
          const target = proc.id !== undefined && proc.id !== null ? proc.id : proc.name;
          if (target === undefined || target === null || target === '') continue;

          try {
            const res = await fetch('/api/pm2/restart/' + encodeURIComponent(String(target)), { method: 'POST' });
            let data: any = null;
            try {
              data = await res.json();
            } catch {}

            if (!res.ok || !data?.success) {
              hadFailure = true;
              if (!failureMsg) {
                failureMsg = data?.error || (res.status ? `HTTP ${res.status}` : 'Unknown error');
              }
            }
          } catch (err: any) {
            hadFailure = true;
            if (!failureMsg) {
              failureMsg = err?.message || 'Network error';
            }
          }
        }

        if (hadFailure) {
          alert('Restart failed: ' + (failureMsg || 'One or more processes failed to restart'));
        }

        // Refresh the status
        fetchStatus();
      } catch (err: any) {
        alert('Restart failed: ' + (err?.message || 'Network error'));
      } finally {
        isPM2BulkPending = false;
        restartAllBtn.disabled = false;
        restartAllBtn.textContent = '↻ Restart All';
      }
    });
  }
}
