import { $, esc } from '../utils/dom.js';
import { AntigravityAccountQuota, AntigravityQuotaBucket } from '../../shared/types.js';

let selectedAccountIndex = 0;
// Circle radius r=12.5, viewBox 0 0 32 32 -> circumference = 2 * PI * 12.5
const CIRCUMFERENCE = 78.54;

function getStrokeColor(pct: number): string {
  if (pct >= 50) return 'var(--green)';
  if (pct >= 20) return 'var(--yellow)';
  return 'var(--red)';
}

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

interface NormalizedBucket {
  displayName: string;
  window: '5h' | 'weekly';
  remainingPct: number;
  resetTime?: string;
}

interface ModelQuotaPair {
  fiveHour: NormalizedBucket;
  weekly: NormalizedBucket;
}

function extractModelBuckets(buckets: AntigravityQuotaBucket[]): ModelQuotaPair {
  let fiveHour: NormalizedBucket = { displayName: '5-Hour Limit', window: '5h', remainingPct: 100 };
  let weekly: NormalizedBucket = { displayName: 'Weekly Limit', window: 'weekly', remainingPct: 100 };

  for (const b of buckets) {
    const is5h = b.window === '5h' || b.bucketId.includes('5h');
    if (is5h) {
      fiveHour = {
        displayName: b.displayName || '5-Hour Limit',
        window: '5h',
        remainingPct: b.remainingPct,
        resetTime: b.resetTime,
      };
    } else {
      weekly = {
        displayName: b.displayName || 'Weekly Limit',
        window: 'weekly',
        remainingPct: b.remainingPct,
        resetTime: b.resetTime,
      };
    }
  }

  return { fiveHour, weekly };
}

function renderCircularGauge(label: string, bucket: NormalizedBucket): string {
  const pct = Math.min(Math.max(bucket.remainingPct, 0), 100);
  const strokeColor = getStrokeColor(pct);
  const statCls = getStatClass(pct);
  const offset = (CIRCUMFERENCE * (1 - pct / 100)).toFixed(2);
  const resetTag = formatRelativeTime(bucket.resetTime);
  const win = bucket.window === '5h' ? '5h' : 'Wk';

  return `
    <div class="agy-mini-card" title="${esc(label)} ${esc(bucket.displayName)}${resetTag ? ' — resets in ' + esc(resetTag) : ''}">
      <div class="agy-circle-box">
        <svg width="34" height="34" viewBox="0 0 32 32" class="agy-circle-svg">
          <circle cx="16" cy="16" r="12.5" class="agy-circle-track" />
          <circle cx="16" cy="16" r="12.5" class="agy-circle-fill" 
            style="stroke: ${strokeColor}; stroke-dasharray: ${CIRCUMFERENCE}; stroke-dashoffset: ${offset};" />
        </svg>
        <span class="agy-circle-num ${statCls}">${Math.round(pct)}</span>
      </div>
      <div class="agy-meta">
        <span class="agy-meta-title">${esc(label)} <span class="agy-meta-win">${win}</span></span>
        <span class="agy-meta-time">${resetTag ? esc(resetTag) : '100%'}</span>
      </div>
    </div>
  `;
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

  // Compact account tabs
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

  let gaugesHtml = '';
  if (account.groups && account.groups.length > 0) {
    const gaugeItems: string[] = [];

    for (const group of account.groups) {
      const isGemini = group.displayName.toLowerCase().includes('gemini');
      const shortName = isGemini ? 'Gemini' : 'Claude';
      const { fiveHour, weekly } = extractModelBuckets(group.buckets);

      gaugeItems.push(renderCircularGauge(shortName, fiveHour));
      gaugeItems.push(renderCircularGauge(shortName, weekly));
    }

    gaugesHtml = `<div class="agy-mini-grid">${gaugeItems.join('')}</div>`;
  } else {
    gaugesHtml = '<div class="none">No quota data available.</div>';
  }

  container.innerHTML = accountSelectorHtml + gaugesHtml;

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
