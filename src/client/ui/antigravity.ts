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

  // Account selector tabs if multiple accounts
  let accountSelectorHtml = '';
  if (data.length > 1) {
    accountSelectorHtml = `
      <div class="agy-account-tabs">
        ${data.map((acc, idx) => `
          <button class="agy-acc-tab ${idx === selectedAccountIndex ? 'active' : ''}" data-idx="${idx}">
            ${esc(acc.email.split('@')[0])}
          </button>
        `).join('')}
      </div>
    `;
  }

  let groupsHtml = '';
  if (account.groups && account.groups.length > 0) {
    groupsHtml = `
      <div class="agy-groups-grid">
        ${account.groups.map(group => `
          <div class="agy-group-col">
            <div class="agy-group-title">${esc(group.displayName)}</div>
            <div class="agy-buckets-row">
              ${group.buckets.map(b => {
                const pct = b.remainingPct;
                const cls = getStatClass(pct);
                const winLabel = b.window === '5h' ? '5-Hour' : 'Weekly';
                const timeLabel = formatRelativeTime(b.resetTime);
                return `
                  <div class="agy-bucket-card" title="Resets ${timeLabel ? esc(timeLabel) : 'soon'}">
                    <div class="agy-bucket-header">
                      <span class="agy-bucket-label">${winLabel}</span>
                      ${timeLabel ? `<span class="agy-reset-tag">${esc(timeLabel)}</span>` : ''}
                    </div>
                    <div class="agy-bucket-num ${cls}">${pct.toFixed(1)}%</div>
                    <div class="agy-mini-bar">
                      <div class="agy-mini-fill ${cls}" style="width: ${Math.min(Math.max(pct, 0), 100)}%"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    groupsHtml = '<div class="none">No quota buckets available.</div>';
  }

  container.innerHTML = accountSelectorHtml + groupsHtml;

  // Attach account tab switch handlers
  const tabBtns = container.querySelectorAll<HTMLButtonElement>('.agy-acc-tab');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const idx = parseInt(btn.dataset.idx || '0', 10);
      selectedAccountIndex = idx;
      renderAntigravity(data);
    });
  });
}
