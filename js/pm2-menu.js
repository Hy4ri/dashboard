/* ── PM2 context menu ───────────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { fetchStatus } from './api.js';

let pm2MenuEl = null;
let pm2MenuTarget = null;

function showPM2Menu(name, status, rect) {
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

function closePM2Menu() {
  if (pm2MenuEl) {
    pm2MenuEl.remove();
    pm2MenuEl = null;
  }
  pm2MenuTarget = null;
}

async function pm2ControlAction(name, action) {
  try {
    const res = await fetch('/api/pm2/' + action + '/' + encodeURIComponent(name), { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      fetchStatus();
    } else {
      alert('Error: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Request failed: ' + err.message);
  }
}

export function setupPM2Menu() {
  // Click on PM2 name → show menu
  $('pm2-body').addEventListener('click', (e) => {
    const nameEl = e.target.closest('td:nth-child(2) strong');
    if (!nameEl) return;
    e.stopPropagation();
    const row = nameEl.closest('tr[data-pm-id]');
    const cells = row.querySelectorAll('td');
    const statusText = cells[2].textContent.trim();
    const name = nameEl.textContent.trim();
    const rect = nameEl.getBoundingClientRect();
    showPM2Menu(name, statusText, rect);
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (pm2MenuEl && !pm2MenuEl.contains(e.target) && !e.target.closest('td:nth-child(2) strong')) {
      closePM2Menu();
    }
  });

  // Close menu on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePM2Menu();
  });

  // Restart All button
  const restartAllBtn = $('restart-all-btn');
  if (restartAllBtn) {
    restartAllBtn.addEventListener('click', async () => {
      if (!confirm('Restart all processes?')) return;
      
      restartAllBtn.disabled = true;
      restartAllBtn.textContent = '↻ Restarting...';
      
      try {
        // Get all PM2 processes from the table
        const rows = $('pm2-body').querySelectorAll('tr[data-pm-id]');
        const names = Array.from(rows).map(row => {
          const nameEl = row.querySelector('td:nth-child(2) strong');
          return nameEl ? nameEl.textContent.trim() : null;
        }).filter(Boolean);
        
        // Restart each process
        for (const name of names) {
          await fetch('/api/pm2/restart/' + encodeURIComponent(name), { method: 'POST' });
        }
        
        // Refresh the status
        fetchStatus();
      } catch (err) {
        alert('Restart failed: ' + err.message);
      } finally {
        restartAllBtn.disabled = false;
        restartAllBtn.textContent = '↻ Restart All';
      }
    });
  }
}

export { showPM2Menu, closePM2Menu, pm2ControlAction, pm2MenuEl, pm2MenuTarget };
