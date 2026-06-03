/* ── Event handlers ─────────────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { fetchStatus } from './api.js';

export function setupTorrentDelete() {
  $('torrent-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.torrent-delete');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const hash = btn.dataset.hash;
    const name = btn.dataset.name;

    if (!confirm('Delete "' + name + '" and remove downloaded files?')) return;

    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '...';

    try {
      const res = await fetch('/api/qbittorrent/delete/' + hash, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        // Refresh the torrent list
        setTimeout(() => fetchStatus(), 500);
      } else {
        alert('Failed to delete: ' + (data.error || 'Unknown error'));
        btn.disabled = false;
        btn.removeAttribute('aria-disabled');
        btn.innerHTML = originalHTML;
      }
    } catch (err) {
      alert('Request failed: ' + err.message);
      btn.disabled = false;
      btn.removeAttribute('aria-disabled');
      btn.innerHTML = originalHTML;
    }
  });
}
