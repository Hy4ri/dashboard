/* ── PM2 context menu ───────────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { fetchStatus } from './api.js';

export let pm2MenuEl: HTMLElement | null = null;
export let pm2MenuTarget: { name: string; status: string } | null = null;

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

export async function pm2ControlAction(name: string, action: string): Promise<void> {
  if (action === 'delete' && !confirm(`Permanently delete process "${name}" from PM2? This cannot be undone.`)) {
    return;
  }
  try {
    const res = await fetch('/api/pm2/' + action + '/' + encodeURIComponent(name), { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      fetchStatus();
    } else {
      alert('Error: ' + (data.error || 'Unknown error'));
    }
  } catch (err: any) {
    alert('Request failed: ' + err.message);
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
      if (!confirm('Restart all processes?')) return;

      restartAllBtn.disabled = true;
      restartAllBtn.textContent = '↻ Restarting...';

      try {
        // Get all PM2 processes from the table
        const rows = document.querySelectorAll('#pm2-body tr[data-pm-id]');
        const names = Array.from(rows).map(row => {
          const nameEl = row.querySelector('td strong');
          return nameEl ? nameEl.textContent?.trim() : null;
        }).filter(Boolean);

        // Restart each process
        for (const name of names) {
          if (name) {
            await fetch('/api/pm2/restart/' + encodeURIComponent(name), { method: 'POST' });
          }
        }

        // Refresh the status
        fetchStatus();
      } catch (err: any) {
        alert('Restart failed: ' + err.message);
      } finally {
        restartAllBtn.disabled = false;
        restartAllBtn.textContent = '↻ Restart All';
      }
    });
  }
}
