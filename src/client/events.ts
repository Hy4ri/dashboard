/* ── Event handlers ─────────────────────────────────────────────── */

import { $ } from './utils/dom.js';
import { fetchStatus } from './api.js';

export function setupTorrentDelete(): void {
  const torrentList = $('torrent-list');
  if (!torrentList) return;

  torrentList.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('.torrent-delete') as HTMLButtonElement | null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const hash = btn.dataset.hash;
    const name = btn.dataset.name;
    if (!hash || !name) return;

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
    } catch (err: any) {
      alert('Request failed: ' + err.message);
      btn.disabled = false;
      btn.removeAttribute('aria-disabled');
      btn.innerHTML = originalHTML;
    }
  });
}
