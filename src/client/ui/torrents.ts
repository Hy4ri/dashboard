import { $, esc } from '../utils/dom.js';
import { fmtBytesRate, fmtBytes } from '../utils/format.js';
import { TorrentItem } from '../../shared/types.js';

export function renderTorrents(torrents?: TorrentItem[] | null): void {
  const card = $('torrent-card');
  const list = $('torrent-list');
  const countEl = $('torrent-count');
  if (!card || !list) return;

  if (!torrents || torrents.length === 0) {
    list.innerHTML = '<div class="none">No active downloads. Torrents will appear here when downloading.</div>';
    if (countEl) countEl.textContent = '';
    return;
  }

  // Skip rebuild if data hasn't changed
  const serialized = JSON.stringify(torrents);
  if (list.dataset.lastTorrents === serialized) return;
  list.dataset.lastTorrents = serialized;

  const total = torrents.length;
  const done = torrents.filter(t => t.progress >= 1).length;
  const seeded = torrents.filter(t => t.ratio > 1).length;
  if (countEl) {
    const parts = [done + '/' + total];
    if (seeded > 0) parts.push('<span class="torrent-seeded">' + seeded + '</span>');
    countEl.innerHTML = parts.join(' ');
  }

  list.innerHTML = torrents.map(t => {
    const pct = t.progress * 100;
    const stateLabel = t.state ? t.state.charAt(0).toUpperCase() + t.state.slice(1) : 'Unknown';
    const ratioClass = t.ratio > 1 ? 'ratio-good' : '';
    const ratio = t.ratio != null
      ? '<span class="' + ratioClass + '">' + t.ratio.toFixed(2) + ' ratio</span>'
      : '';
    return '<div class="torrent-item">' +
      '<div class="torrent-header">' +
        '<span class="torrent-name" title="' + esc(t.name) + '">' + esc(t.name) + '</span>' +
        '<button class="torrent-delete" data-hash="' + esc(t.hash) + '" data-name="' + esc(t.name) + '" title="Delete torrent and remove files" aria-label="Delete ' + esc(t.name) + '">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="3 6 5 6 21 6"/>' +
            '<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>' +
            '<line x1="10" y1="11" x2="10" y2="17"/>' +
            '<line x1="14" y1="11" x2="14" y2="17"/>' +
          '</svg>' +
        '</button>' +
      '</div>' +
      '<div class="torrent-bar"><div class="torrent-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="torrent-stats">' +
        '<span>' + stateLabel + '</span>' +
        '<span>↓ ' + fmtBytesRate(t.dlspeed) + '</span>' +
        '<span>↑ ' + fmtBytesRate(t.upspeed) + '</span>' +
        '<span>' + fmtBytes(t.size) + '</span>' +
        '<span>Seeds: ' + (t.num_seeds || 0) + '</span>' +
        '<span>Peers: ' + (t.num_peers || 0) + '</span>' +
        ratio +
      '</div>' +
      '</div>';
  }).join('');
}
