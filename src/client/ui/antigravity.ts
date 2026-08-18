import { $, esc } from '../utils/dom.js';
import { AntigravityAccountQuota, AntigravityQuotaBucket } from '../../shared/types.js';

let selectedAccountIndex = 0;
const CIRCUMFERENCE = 138.23; // 2 * Math.PI * 22

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

function renderCircularGauge(bucket: NormalizedBucket): string {
  const pct = Math.min(Math.max(bucket.remainingPct, 0), 100);
  const strokeColor = getStrokeColor(pct);
  const statCls = getStatClass(pct);
  const offset = (CIRCUMFERENCE * (1 - pct / 100)).toFixed(2);
  const resetTag = formatRelativeTime(bucket.resetTime);
  const winLabel = bucket.window === '5h' ? '5h Limit' : 'Weekly';

  return `
    <div class="agy-gauge-item" title="${esc(bucket.displayName)}${resetTag ? ' (resets ' + esc(resetTag) + ')' : ''}">
      <div class="agy-circle-wrapper">
        <svg width="54" height="54" viewBox="0 0 54 54" class="agy-circle-svg">
          <circle cx="27" cy="27" r="22" class="agy-circle-track" />
          <circle cx="27" cy="27" r="22" class="agy-circle-fill" 
            style="stroke: ${strokeColor}; stroke-dasharray: ${CIRCUMFERENCE}; stroke-dashoffset: ${offset};" />
        </svg>
        <span class="agy-circle-text ${statCls}">${Math.round(pct)}<span class="agy-pct-sym">%</span></span>
      </div>
      <div class="agy-gauge-info">
        <span class="agy-gauge-window">${winLabel}</span>
        <span class="agy-gauge-reset">${resetTag ? esc(resetTag) : '100%'}</span>
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

  let modelsHtml = '';
  if (account.groups && account.groups.length > 0) {
    const groupCards = account.groups.map(group => {
      const isGemini = group.displayName.toLowerCase().includes('gemini');
      const modelTitle = isGemini ? 'Gemini Models' : 'Claude & GPT Models';
      const { fiveHour, weekly } = extractModelBuckets(group.buckets);

      return `
        <div class="agy-model-group">
          <div class="agy-model-title">${esc(modelTitle)}</div>
          <div class="agy-gauges-row">
            ${renderCircularGauge(fiveHour)}
            ${renderCircularGauge(weekly)}
          </div>
        </div>
      `;
    }).join('');

    modelsHtml = `<div class="agy-models-container">${groupCards}</div>`;
  } else {
    modelsHtml = '<div class="none">No quota data available.</div>';
  }

  container.innerHTML = accountSelectorHtml + modelsHtml;

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
