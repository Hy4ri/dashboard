/* ── Torrent Event handlers ──────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { fetchStatus } from './api.js';

export function setupTorrentEvents(): void {
  const torrentList = $('torrent-list');
  if (torrentList) {
    torrentList.addEventListener('click', async (e) => {
      if (!(e.target instanceof Element)) return;
      const btn = e.target.closest('.torrent-action-btn');
      if (!(btn instanceof HTMLButtonElement)) return;
      e.preventDefault();
      e.stopPropagation();

      const action = btn.dataset.action;
      const hash = btn.dataset.hash;
      const name = btn.dataset.name || 'torrent';
      if (!action || !hash) return;

      if (action === 'delete') {
        if (!confirm(`Delete "${name}" and remove downloaded files?`)) return;
      }

      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '…';

      try {
        const res = await fetch(`/api/qbittorrent/${action}/${hash}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          setTimeout(() => fetchStatus(), 300);
        } else {
          alert(`Failed to ${action}: ` + (data.error || 'Unknown error'));
          btn.disabled = false;
          btn.removeAttribute('aria-disabled');
          btn.innerHTML = originalHTML;
        }
      } catch (err: any) {
        alert('Request failed: ' + err.message);
        btn.disabled = false;
        btn.removeAttribute('aria-disabled');
        btn.innerHTML = originalHTML;
      }
    });
  }

  // Header Bulk Actions (Pause All / Resume All)
  const resumeAllBtn = $('torrent-resume-all-btn');
  if (resumeAllBtn) {
    resumeAllBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await fetch('/api/qbittorrent/resume/all', { method: 'POST' });
        setTimeout(() => fetchStatus(), 300);
      } catch (err: any) {
        alert('Resume all failed: ' + err.message);
      }
    });
  }

  const pauseAllBtn = $('torrent-pause-all-btn');
  if (pauseAllBtn) {
    pauseAllBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await fetch('/api/qbittorrent/pause/all', { method: 'POST' });
        setTimeout(() => fetchStatus(), 300);
      } catch (err: any) {
        alert('Pause all failed: ' + err.message);
      }
    });
  }
}

export const setupTorrentDelete = setupTorrentEvents;
