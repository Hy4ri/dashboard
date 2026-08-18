import { $, esc } from '../utils/dom.js';
import { fmtBytesRate, fmtBytes } from '../utils/format.js';
import { TorrentItem } from '../../shared/types.js';

let torrentFilter = 'all';
let filtersRegistered = false;
let lastTorrentData: TorrentItem[] | null = null;

function isTorrentPaused(state: string | null | undefined): boolean {
  if (!state) return false;
  const s = state.toLowerCase();
  return s.includes('pause') || s.includes('stop');
}

function setupTorrentFilters(): void {
  if (filtersRegistered) return;

  const pills = document.querySelectorAll<HTMLElement>('#torrent-filter-pills .filter-pill');
  pills.forEach((pill) => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      torrentFilter = pill.getAttribute('data-filter') || 'all';
      if (lastTorrentData) renderTorrents(lastTorrentData);
    });
  });

  filtersRegistered = true;
}

function updateTorrentCounts(torrents: TorrentItem[]): void {
  const total = torrents.length;
  const down = torrents.filter(t => t.progress < 1 && !isTorrentPaused(t.state)).length;
  const seed = torrents.filter(t => t.progress >= 1 || (t.ratio != null && t.ratio > 0)).length;
  const paused = torrents.filter(t => isTorrentPaused(t.state)).length;

  const setCnt = (id: string, val: number) => {
    const el = $(id);
    if (el) el.textContent = String(val);
  };

  setCnt('torrent-count-all', total);
  setCnt('torrent-count-down', down);
  setCnt('torrent-count-seed', seed);
  setCnt('torrent-count-pause', paused);
}

export function initTorrentsUI(): void {
  setupTorrentFilters();
}

export function renderTorrents(torrents?: TorrentItem[] | null): void {
  const card = $('torrent-card');
  const list = $('torrent-list');
  const countEl = $('torrent-count');
  if (!card || !list) return;

  setupTorrentFilters();

  if (!torrents || torrents.length === 0) {
    list.innerHTML = '<div class="none">No active downloads. Torrents will appear here when downloading.</div>';
    if (countEl) countEl.textContent = '';
    updateTorrentCounts([]);
    lastTorrentData = null;
    return;
  }

  lastTorrentData = torrents;
  updateTorrentCounts(torrents);

  const total = torrents.length;
  const done = torrents.filter(t => t.progress >= 1).length;
  const seeded = torrents.filter(t => t.ratio > 1).length;
  if (countEl) {
    const parts = [done + '/' + total];
    if (seeded > 0) parts.push('<span class="torrent-seeded">' + seeded + '</span>');
    countEl.innerHTML = parts.join(' ');
  }

  // Filter torrents
  let filtered = torrents;
  if (torrentFilter === 'downloading') {
    filtered = torrents.filter(t => t.progress < 1 && !isTorrentPaused(t.state));
  } else if (torrentFilter === 'seeding') {
    filtered = torrents.filter(t => t.progress >= 1 || (t.ratio != null && t.ratio > 0));
  } else if (torrentFilter === 'paused') {
    filtered = torrents.filter(t => isTorrentPaused(t.state));
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="none">No torrents matching filter "' + esc(torrentFilter) + '"</div>';
    return;
  }

  list.innerHTML = filtered.map(t => {
    const pct = (t.progress * 100).toFixed(1);
    const paused = isTorrentPaused(t.state);
    const stateLabel = t.state ? t.state.charAt(0).toUpperCase() + t.state.slice(1) : 'Unknown';
    const ratioClass = t.ratio > 1 ? 'ratio-good' : '';
    const ratio = t.ratio != null
      ? '<span class="' + ratioClass + '">' + t.ratio.toFixed(2) + ' ratio</span>'
      : '';

    const pauseResumeBtn = paused
      ? '<button class="torrent-action-btn resume" data-action="resume" data-hash="' + esc(t.hash) + '" data-name="' + esc(t.name) + '" title="Resume torrent" aria-label="Resume ' + esc(t.name) + '">▶</button>'
      : '<button class="torrent-action-btn pause" data-action="pause" data-hash="' + esc(t.hash) + '" data-name="' + esc(t.name) + '" title="Pause torrent" aria-label="Pause ' + esc(t.name) + '">⏸</button>';

    return '<div class="torrent-item' + (paused ? ' paused' : '') + '">' +
      '<div class="torrent-header">' +
        '<span class="torrent-name" title="' + esc(t.name) + '">' + esc(t.name) + '</span>' +
        '<div class="torrent-actions">' +
          pauseResumeBtn +
          '<button class="torrent-action-btn delete" data-action="delete" data-hash="' + esc(t.hash) + '" data-name="' + esc(t.name) + '" title="Delete torrent and remove files" aria-label="Delete ' + esc(t.name) + '">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="torrent-bar"><div class="torrent-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="torrent-stats">' +
        '<span class="torrent-state-pill ' + (paused ? 'paused' : 'active') + '">' + stateLabel + ' (' + pct + '%)</span>' +
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
