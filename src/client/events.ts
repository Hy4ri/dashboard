/* ── Torrent Event handlers ──────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { fetchStatus } from './api.js';

// Guard sets to prevent duplicate mutations across renders
const pendingTorrentHashes = new Set<string>();
let isTorrentBulkPending = false;

export function setupTorrentActions(): void {
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

      if (isTorrentBulkPending || pendingTorrentHashes.has(hash)) {
        return;
      }

      let deleteFiles = false;
      if (action === 'delete') {
        if (!confirm(`Delete torrent "${name}"?`)) return;
        deleteFiles = confirm('Also remove the downloaded files?');
      }

      pendingTorrentHashes.add(hash);
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '…';

      let ok = false;
      try {
        const query = action === 'delete' && deleteFiles ? '?files=1' : '';
        const res = await fetch(`/api/qbittorrent/${action}/${hash}${query}`, { method: 'POST' });
        let data: any = null;
        try {
          data = await res.json();
        } catch {
          // data stays null
        }
        ok = Boolean(res.ok && data?.success);
        if (ok) {
          setTimeout(() => fetchStatus(), 300);
        } else {
          const errDetail = data?.error || (res.status ? `HTTP ${res.status}` : 'Unknown error');
          alert(`Failed to ${action}: ` + errDetail);
        }
      } catch (err: any) {
        alert('Request failed: ' + (err?.message || 'Network error'));
      } finally {
        pendingTorrentHashes.delete(hash);
        // On success the button stays disabled until the next render replaces
        // the row; on failure it must be usable again.
        if (!ok) {
          btn.disabled = false;
          btn.removeAttribute('aria-disabled');
          btn.innerHTML = originalHTML;
        }
      }
    });
  }

  // Header Bulk Actions (Pause All / Resume All)
  const resumeAllBtn = $('torrent-resume-all-btn');
  if (resumeAllBtn) {
    resumeAllBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (isTorrentBulkPending || pendingTorrentHashes.size > 0) return;
      isTorrentBulkPending = true;
      try {
        const res = await fetch('/api/qbittorrent/resume/all', { method: 'POST' });
        let data: any = null;
        try {
          data = await res.json();
        } catch {}
        if (res.ok && data?.success) {
          setTimeout(() => fetchStatus(), 300);
        } else {
          const errDetail = data?.error || (res.status ? `HTTP ${res.status}` : 'Unknown error');
          alert('Resume all failed: ' + errDetail);
        }
      } catch (err: any) {
        alert('Resume all failed: ' + (err?.message || 'Network error'));
      } finally {
        isTorrentBulkPending = false;
      }
    });
  }

  const pauseAllBtn = $('torrent-pause-all-btn');
  if (pauseAllBtn) {
    pauseAllBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (isTorrentBulkPending || pendingTorrentHashes.size > 0) return;
      isTorrentBulkPending = true;
      try {
        const res = await fetch('/api/qbittorrent/pause/all', { method: 'POST' });
        let data: any = null;
        try {
          data = await res.json();
        } catch {}
        if (res.ok && data?.success) {
          setTimeout(() => fetchStatus(), 300);
        } else {
          const errDetail = data?.error || (res.status ? `HTTP ${res.status}` : 'Unknown error');
          alert('Pause all failed: ' + errDetail);
        }
      } catch (err: any) {
        alert('Pause all failed: ' + (err?.message || 'Network error'));
      } finally {
        isTorrentBulkPending = false;
      }
    });
  }
}
