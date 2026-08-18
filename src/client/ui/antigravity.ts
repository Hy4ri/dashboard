import { $, esc } from '../utils/dom.js';
import { AntigravityAccountQuota } from '../../shared/types.js';

let selectedAccountIndex = 0;

function getStatClass(pct: number): string {
  if (pct >= 50) return 'val-green';
  if (pct >= 20) return 'val-yellow';
  return 'val-red';
}

function formatRelativeTime(isoStr?: string): string {
  if (!isoStr) return '';
  const target = new Date(isoStr).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return 'now';

  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remHours = hours % 24;
    return `in ${days}d ${remHours}h`;
  }
  if (hours > 0) {
    const remMins = mins % 60;
    return `in ${hours}h ${remMins}m`;
  }
  return `in ${mins}m`;
}

export function renderAntigravity(data?: AntigravityAccountQuota[] | null): void {
  const card = $('antigravity-card');
  const container = $('antigravity-content');
  if (!card || !container) return;

  if (!data || data.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  if (selectedAccountIndex >= data.length) {
    selectedAccountIndex = 0;
  }

  const account = data[selectedAccountIndex];
  if (!account) return;

  // Account selector pills
  let accountSelectorHtml = '';
  if (data.length > 1) {
    accountSelectorHtml = `
      <div class="agy-toolbar">
        <div class="agy-filter-pills" role="group" aria-label="Select account">
          ${data.map((acc, idx) => `
            <button class="filter-pill ${idx === selectedAccountIndex ? 'active' : ''}" data-idx="${idx}">
              ${esc(acc.email.split('@')[0])}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  let itemsHtml = '';
  if (account.groups && account.groups.length > 0) {
    const rows: string[] = [];

    for (const group of account.groups) {
      const isGemini = group.displayName.toLowerCase().includes('gemini');
      const groupLabel = isGemini ? 'Gemini' : 'Claude / GPT';

      for (const bucket of group.buckets) {
        const is5h = bucket.window === '5h' || bucket.bucketId.includes('5h');
        const winLabel = is5h ? '5h' : 'Weekly';
        const pct = bucket.remainingPct;
        const cls = getStatClass(pct);
        const resetTag = formatRelativeTime(bucket.resetTime);

        rows.push(`
          <div class="agy-item">
            <div class="info-row">
              <span class="key">${groupLabel} <span class="agy-win-tag">${winLabel}</span></span>
              <span class="val ${cls}">
                ${pct.toFixed(1)}%
                ${resetTag ? `<span class="agy-reset-hint">${esc(resetTag)}</span>` : ''}
              </span>
            </div>
            <div class="bar-wrap agy-bar">
              <div class="bar-fill ${cls}" style="width: ${Math.min(Math.max(pct, 0), 100)}%"></div>
            </div>
          </div>
        `);
      }
    }

    itemsHtml = `<div class="agy-grid">${rows.join('')}</div>`;
  } else {
    itemsHtml = '<div class="none">No quota data available.</div>';
  }

  container.innerHTML = accountSelectorHtml + itemsHtml;

  // Event handlers for account tabs
  const pills = container.querySelectorAll<HTMLButtonElement>('.filter-pill[data-idx]');
  pills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      const idx = parseInt(pill.dataset.idx || '0', 10);
      selectedAccountIndex = idx;
      renderAntigravity(data);
    });
  });
}
