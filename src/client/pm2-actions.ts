/* ── PM2 actions ────────────────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { fetchStatus } from './api.js';

// Guard sets to prevent duplicate mutations across renders
const pendingPM2Targets = new Set<string>();
let isPM2BulkPending = false;

export async function pm2ControlAction(id: number, action: string, name: string): Promise<boolean> {
  const targetKey = String(id);
  if (isPM2BulkPending || pendingPM2Targets.has(targetKey)) {
    return false;
  }

  if (action === 'delete' && !confirm(`Permanently delete process "${name}" from PM2? This cannot be undone.`)) {
    return false;
  }

  pendingPM2Targets.add(targetKey);
  let ok = false;
  try {
    const res = await fetch('/api/pm2/' + action + '/' + id, { method: 'POST' });
    let data: any = null;
    try {
      data = await res.json();
    } catch {}
    if (res.ok && data?.success) {
      ok = true;
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
  return ok;
}

export function setupPM2Actions(): void {
  const restartAllBtn = $<HTMLButtonElement>('restart-all-btn');
  if (!restartAllBtn) return;

  // The button holds an icon and a label. Only the label text changes.
  const setLabel = (text: string): void => {
    const label = restartAllBtn.querySelector('.btn-label');
    (label || restartAllBtn).textContent = text;
  };

  restartAllBtn.addEventListener('click', async () => {
    if (isPM2BulkPending || pendingPM2Targets.size > 0) return;
    if (!confirm('Restart all processes?')) return;

    isPM2BulkPending = true;
    restartAllBtn.disabled = true;
    setLabel('Restarting...');

    try {
      // One server call restarts the whole inventory except the dashboard,
      // which the server restarts last so this response gets through.
      const res = await fetch('/api/pm2/restart-all', { method: 'POST' });
      let data: any = null;
      try {
        data = await res.json();
      } catch {}

      if (!res.ok || !data?.success) {
        const errDetail = data?.error || (res.status ? `HTTP ${res.status}` : 'Unknown error');
        alert('Restart failed: ' + errDetail);
      }

      fetchStatus();
    } catch (err: any) {
      alert('Restart failed: ' + (err?.message || 'Network error'));
    } finally {
      isPM2BulkPending = false;
      restartAllBtn.disabled = false;
      setLabel('Restart All');
    }
  });
}
