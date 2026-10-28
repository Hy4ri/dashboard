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

function isTorrentSeeding(t: TorrentItem): boolean {
  if (isTorrentPaused(t.state)) return false;
  const s = (t.state || '').toLowerCase();
  // qB states: uploading, stalledUP, queuedUP, forcedUP
  if (s === 'uploading' || s === 'stalledup' || s === 'queuedup' || s === 'forcedup') {
    return true;
  }
  return false;
}

function isTorrentDownloading(t: TorrentItem): boolean {
  if (isTorrentPaused(t.state)) return false;
  const s = (t.state || '').toLowerCase();
  if (s === 'downloading' || s === 'stalleddl' || s === 'queueddl' || s === 'forceddl') {
    return true;
  }
  return t.progress < 1;
}

function setupTorrentFilters(): void {
  if (filtersRegistered) return;

  const pills = document.querySelectorAll<HTMLElement>('#torrent-filter-pills .filter-pill');
  pills.forEach((pill) => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      pills.forEach((p) => {
        p.classList.remove('active');
        p.setAttribute('aria-pressed', 'false');
      });
      pill.classList.add('active');
      pill.setAttribute('aria-pressed', 'true');
      torrentFilter = pill.getAttribute('data-filter') || 'all';
      if (lastTorrentData) renderTorrents(lastTorrentData);
    });
  });

  filtersRegistered = true;
}

function updateTorrentCounts(torrents: TorrentItem[]): void {
  const total = torrents.length;
  const down = torrents.filter(t => isTorrentDownloading(t)).length;
  const seed = torrents.filter(t => isTorrentSeeding(t)).length;
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

// With no torrents the card shrinks to one line, and the bulk buttons are
// disabled with a reason: they would do nothing.
function setEmptyState(card: HTMLElement, empty: boolean): void {
  if (empty) card.setAttribute('data-empty', 'true');
  else card.removeAttribute('data-empty');
  const reason: Record<string, string> = {
    'torrent-resume-all-btn': 'Resume all downloads',
    'torrent-pause-all-btn': 'Pause all downloads',
  };
  for (const id of Object.keys(reason)) {
    const btn = $<HTMLButtonElement>(id);
    if (!btn) continue;
    btn.disabled = empty;
    btn.title = empty ? 'No downloads to ' + reason[id].split(' ')[0].toLowerCase() : reason[id];
  }
}

function buildPauseResumeBtnHTML(t: TorrentItem, paused: boolean): string {
  return paused
    ? '<button class="torrent-action-btn resume" data-action="resume" data-hash="' + esc(t.hash) + '" data-name="' + esc(t.name) + '" title="Resume torrent" aria-label="Resume ' + esc(t.name) + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>'
    : '<button class="torrent-action-btn pause" data-action="pause" data-hash="' + esc(t.hash) + '" data-name="' + esc(t.name) + '" title="Pause torrent" aria-label="Pause ' + esc(t.name) + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="4.5" height="16" rx="0.5"/><rect x="14.5" y="4" width="4.5" height="16" rx="0.5"/></svg></button>';
}

function buildDeleteBtnHTML(t: TorrentItem): string {
  return '<button class="torrent-action-btn delete" data-action="delete" data-hash="' + esc(t.hash) + '" data-name="' + esc(t.name) + '" title="Delete torrent and remove files" aria-label="Delete ' + esc(t.name) + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
}

function updateTorrentActions(actionsEl: HTMLElement, t: TorrentItem, paused: boolean): void {
  const desiredAction = paused ? 'resume' : 'pause';
  const existingPauseResume = actionsEl.querySelector('.torrent-action-btn.pause, .torrent-action-btn.resume') as HTMLButtonElement | null;
  const existingDelete = actionsEl.querySelector('.torrent-action-btn.delete') as HTMLButtonElement | null;

  if (!existingPauseResume || !existingDelete) {
    actionsEl.innerHTML = buildPauseResumeBtnHTML(t, paused) + buildDeleteBtnHTML(t);
    return;
  }

  const currentAction = existingPauseResume.getAttribute('data-action');
  if (currentAction !== desiredAction || existingPauseResume.getAttribute('data-hash') !== t.hash || existingPauseResume.getAttribute('data-name') !== t.name) {
    const temp = document.createElement('div');
    temp.innerHTML = buildPauseResumeBtnHTML(t, paused);
    const newBtn = temp.firstElementChild;
    if (newBtn) {
      actionsEl.replaceChild(newBtn, existingPauseResume);
    }
  }

  if (existingDelete.getAttribute('data-hash') !== t.hash || existingDelete.getAttribute('data-name') !== t.name) {
    const temp = document.createElement('div');
    temp.innerHTML = buildDeleteBtnHTML(t);
    const newBtn = temp.firstElementChild;
    if (newBtn) {
      actionsEl.replaceChild(newBtn, existingDelete);
    }
  }
}

function createTorrentElement(t: TorrentItem): HTMLElement {
  const paused = isTorrentPaused(t.state);
  const pct = (t.progress * 100).toFixed(1);
  const stateLabel = t.state ? t.state.charAt(0).toUpperCase() + t.state.slice(1) : 'Unknown';
  const ratioClass = 'torrent-ratio' + (t.ratio > 1 ? ' ratio-good' : '');
  const ratio = t.ratio != null
    ? '<span class="' + ratioClass + '">' + t.ratio.toFixed(2) + ' ratio</span>'
    : '';

  const div = document.createElement('div');
  div.setAttribute('data-torrent-hash', t.hash);
  div.className = 'torrent-item' + (paused ? ' paused' : '');
  div.innerHTML =
    '<div class="torrent-header">' +
      '<span class="torrent-name" title="' + esc(t.name) + '"></span>' +
      '<div class="torrent-actions">' +
        buildPauseResumeBtnHTML(t, paused) +
        buildDeleteBtnHTML(t) +
      '</div>' +
    '</div>' +
    '<div class="torrent-bar"><div class="torrent-fill" style="width:' + pct + '%"></div></div>' +
    '<div class="torrent-stats">' +
      '<span class="torrent-state-pill ' + (paused ? 'paused' : 'active') + '">' + esc(stateLabel) + ' (' + pct + '%)</span>' +
      '<span class="torrent-stat-dl">↓ ' + fmtBytesRate(t.dlspeed) + '</span>' +
      '<span class="torrent-stat-ul">↑ ' + fmtBytesRate(t.upspeed) + '</span>' +
      '<span class="torrent-stat-size">' + fmtBytes(t.size) + '</span>' +
      '<span class="torrent-stat-seeds">Seeds: ' + (t.num_seeds || 0) + '</span>' +
      '<span class="torrent-stat-peers">Peers: ' + (t.num_peers || 0) + '</span>' +
      ratio +
    '</div>';

  const nameEl = div.querySelector('.torrent-name');
  if (nameEl) nameEl.textContent = t.name;

  return div;
}

function updateTorrentElement(el: HTMLElement, t: TorrentItem): void {
  const paused = isTorrentPaused(t.state);
  const pct = (t.progress * 100).toFixed(1);
  const stateLabel = t.state ? t.state.charAt(0).toUpperCase() + t.state.slice(1) : 'Unknown';

  // Toggle paused class on container
  el.className = 'torrent-item' + (paused ? ' paused' : '');

  // Update name safely via textContent
  const nameEl = el.querySelector<HTMLElement>('.torrent-name');
  if (nameEl) {
    if (nameEl.textContent !== t.name) nameEl.textContent = t.name;
    nameEl.title = t.name;
  }

  // Update actions without replacing unchanged buttons
  const actionsEl = el.querySelector<HTMLElement>('.torrent-actions');
  if (actionsEl) {
    updateTorrentActions(actionsEl, t, paused);
  }

  // Update bar fill
  const fillEl = el.querySelector<HTMLElement>('.torrent-fill');
  if (fillEl) {
    fillEl.style.width = pct + '%';
  }

  // Update state pill with escaped label
  const pillEl = el.querySelector<HTMLElement>('.torrent-state-pill');
  if (pillEl) {
    pillEl.className = 'torrent-state-pill ' + (paused ? 'paused' : 'active');
    pillEl.textContent = `${stateLabel} (${pct}%)`;
  }

  // Update stats
  const dlEl = el.querySelector<HTMLElement>('.torrent-stat-dl');
  if (dlEl) dlEl.textContent = '↓ ' + fmtBytesRate(t.dlspeed);
  const ulEl = el.querySelector<HTMLElement>('.torrent-stat-ul');
  if (ulEl) ulEl.textContent = '↑ ' + fmtBytesRate(t.upspeed);
  const sizeEl = el.querySelector<HTMLElement>('.torrent-stat-size');
  if (sizeEl) sizeEl.textContent = fmtBytes(t.size);
  const seedsEl = el.querySelector<HTMLElement>('.torrent-stat-seeds');
  if (seedsEl) seedsEl.textContent = 'Seeds: ' + (t.num_seeds || 0);
  const peersEl = el.querySelector<HTMLElement>('.torrent-stat-peers');
  if (peersEl) peersEl.textContent = 'Peers: ' + (t.num_peers || 0);

  // Update or create ratio
  const statsContainer = el.querySelector<HTMLElement>('.torrent-stats');
  if (statsContainer) {
    let ratioSpan = statsContainer.querySelector<HTMLElement>('.ratio-good, .torrent-ratio');
    if (t.ratio != null) {
      if (!ratioSpan) {
        ratioSpan = document.createElement('span');
        statsContainer.appendChild(ratioSpan);
      }
      ratioSpan.className = 'torrent-ratio' + (t.ratio > 1 ? ' ratio-good' : '');
      ratioSpan.textContent = t.ratio.toFixed(2) + ' ratio';
    } else if (ratioSpan) {
      ratioSpan.remove();
    }
  }
}

export function renderTorrents(torrents?: TorrentItem[] | null): void {
  const card = $('torrent-card');
  const list = $('torrent-list');
  const countEl = $('torrent-count');
  if (!card || !list) return;

  setupTorrentFilters();

  if (!torrents || torrents.length === 0) {
    list.innerHTML = torrents == null
      ? '<div class="none">Torrent data unavailable.</div>'
      : '<div class="none">No active downloads.</div>';
    if (countEl) countEl.textContent = '';
    updateTorrentCounts([]);
    lastTorrentData = null;
    setEmptyState(card, true);
    return;
  }

  setEmptyState(card, false);
  lastTorrentData = torrents;
  updateTorrentCounts(torrents);

  const total = torrents.length;
  const done = torrents.filter(t => t.progress >= 1).length;
  const seeded = torrents.filter(t => isTorrentSeeding(t)).length;
  if (countEl) {
    const parts = [done + '/' + total];
    if (seeded > 0) parts.push('<span class="torrent-seeded">' + seeded + '</span>');
    countEl.innerHTML = parts.join(' ');
    countEl.title = done + ' of ' + total + ' complete' + (seeded > 0 ? ', ' + seeded + ' seeding' : '');
  }

  // Filter torrents
  let filtered = torrents;
  if (torrentFilter === 'downloading') {
    filtered = torrents.filter(t => isTorrentDownloading(t));
  } else if (torrentFilter === 'seeding') {
    filtered = torrents.filter(t => isTorrentSeeding(t));
  } else if (torrentFilter === 'paused') {
    filtered = torrents.filter(t => isTorrentPaused(t.state));
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="none">No torrents matching filter "' + esc(torrentFilter) + '"</div>';
    return;
  }

  // Keyed element reconciliation by t.hash
  const existingElements = Array.from(list.querySelectorAll<HTMLElement>('[data-torrent-hash]'));
  const existingMap = new Map<string, HTMLElement>();
  for (const el of existingElements) {
    const hash = el.getAttribute('data-torrent-hash');
    if (hash) existingMap.set(hash, el);
  }

  // Remove none/empty placeholder if present
  const nonData = Array.from(list.children).filter(el => !el.hasAttribute('data-torrent-hash'));
  nonData.forEach(el => el.remove());

  const targetHashes = new Set<string>();
  let position = 0;
  const active = document.activeElement as HTMLElement | null;
  const restoreFocus = active && list.contains(active);

  for (const t of filtered) {
    targetHashes.add(t.hash);
    let el = existingMap.get(t.hash);
    if (el) {
      updateTorrentElement(el, t);
    } else {
      el = createTorrentElement(t);
    }
    if (list.children[position] !== el) {
      list.insertBefore(el, list.children[position] || null);
    }
    position++;
  }

  for (const [hash, el] of existingMap.entries()) {
    if (!targetHashes.has(hash)) {
      el.remove();
    }
  }

  if (restoreFocus && active.isConnected && document.activeElement !== active) {
    active.focus({ preventScroll: true });
  }
}
