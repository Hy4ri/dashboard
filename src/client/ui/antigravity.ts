import { $, esc } from '../utils/dom.js';
import {
  AntigravityAccountQuota,
  AntigravityQuotaBucket,
  ClaudeUsageData,
  CodexUsageData,
} from '../../shared/types.js';

type ProviderTab = 'antigravity' | 'claude' | 'codex';
let activeProvider: ProviderTab = 'antigravity';
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

function formatRelativeTime(isoOrTimestamp?: string | number): string {
  if (!isoOrTimestamp) return '';
  const target = typeof isoOrTimestamp === 'number'
    ? (isoOrTimestamp < 1e11 ? isoOrTimestamp * 1000 : isoOrTimestamp)
    : new Date(isoOrTimestamp).getTime();

  if (isNaN(target)) return '';
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
  resetTime?: string | number;
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
  const win = bucket.window === '5h' ? '5-Hour' : 'Weekly';

  return `
    <div class="agy-mini-card" title="${esc(label)} ${esc(bucket.displayName)}${resetTag ? ' — resets in ' + esc(resetTag) : ''}">
      <div class="agy-circle-box">
        <svg width="42" height="42" viewBox="0 0 32 32" class="agy-circle-svg">
          <circle cx="16" cy="16" r="12.5" class="agy-circle-track" />
          <circle cx="16" cy="16" r="12.5" class="agy-circle-fill" 
            style="stroke: ${strokeColor}; stroke-dasharray: ${CIRCUMFERENCE}; stroke-dashoffset: ${offset};" />
        </svg>
        <span class="agy-circle-num ${statCls}">${Math.round(pct)}%</span>
      </div>
      <div class="agy-meta">
        <span class="agy-meta-title">${esc(label)} <span class="agy-meta-win">${win}</span></span>
        <span class="agy-meta-time">${resetTag ? 'Resets ' + esc(resetTag) : '100% available'}</span>
      </div>
    </div>
  `;
}

export function renderAntigravity(
  agyData?: AntigravityAccountQuota[] | null,
  claudeData?: ClaudeUsageData | null,
  codexData?: CodexUsageData | null
): void {
  const card = $('antigravity-card');
  const container = $('antigravity-content');
  if (!card || !container) return;

  const hasAgy = !!(agyData && agyData.length > 0);
  const hasClaude = !!claudeData;
  const hasCodex = !!codexData;

  if (!hasAgy && !hasClaude && !hasCodex) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  // Ensure activeProvider is valid based on available data
  if (activeProvider === 'antigravity' && !hasAgy) {
    activeProvider = hasClaude ? 'claude' : (hasCodex ? 'codex' : 'antigravity');
  } else if (activeProvider === 'claude' && !hasClaude) {
    activeProvider = hasCodex ? 'codex' : (hasAgy ? 'antigravity' : 'claude');
  } else if (activeProvider === 'codex' && !hasCodex) {
    activeProvider = hasAgy ? 'antigravity' : (hasClaude ? 'claude' : 'codex');
  }

  // Top Provider Tabs
  const providerTabs = [
    { id: 'antigravity', label: 'Antigravity', available: hasAgy },
    { id: 'claude', label: 'Claude', available: hasClaude },
    { id: 'codex', label: 'Codex', available: hasCodex },
  ].filter(p => p.available);

  let providerToolbarHtml = '';
  if (providerTabs.length > 1) {
    providerToolbarHtml = `
      <div class="agy-toolbar ai-provider-toolbar">
        <div class="agy-filter-pills" role="group" aria-label="Select AI provider">
          ${providerTabs.map(tab => `
            <button class="filter-pill ai-provider-pill ${tab.id === activeProvider ? 'active' : ''}" data-provider="${tab.id}">
              ${tab.label}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  let bodyHtml = '';

  if (activeProvider === 'antigravity' && hasAgy && agyData) {
    if (selectedAccountIndex >= agyData.length) {
      selectedAccountIndex = 0;
    }
    const account = agyData[selectedAccountIndex];
    if (account) {
      let accountSelectorHtml = '';
      if (agyData.length > 1) {
        accountSelectorHtml = `
          <div class="agy-account-bar">
            <div class="agy-filter-pills" role="group" aria-label="Select account">
              ${agyData.map((acc, idx) => `
                <button class="filter-pill agy-acc-pill ${idx === selectedAccountIndex ? 'active' : ''}" data-idx="${idx}">
                  ${esc(acc.email.split('@')[0])}
                </button>
              `).join('')}
            </div>
          </div>
        `;
      }

      let groupsHtml = '';
      if (account.groups && account.groups.length > 0) {
        const sections: string[] = [];
        for (const group of account.groups) {
          const isGemini = group.displayName.toLowerCase().includes('gemini');
          const groupTitle = isGemini ? 'Gemini Models' : 'Claude Models';
          const shortName = isGemini ? 'Gemini' : 'Claude';
          const { fiveHour, weekly } = extractModelBuckets(group.buckets);

          sections.push(`
            <div class="ai-model-group">
              <div class="ai-group-header">
                <span>${esc(groupTitle)}</span>
              </div>
              <div class="agy-mini-grid">
                ${renderCircularGauge(shortName, fiveHour)}
                ${renderCircularGauge(shortName, weekly)}
              </div>
            </div>
          `);
        }
        groupsHtml = `<div class="ai-card-sections">${sections.join('')}</div>`;
      } else {
        groupsHtml = '<div class="none">No quota data available.</div>';
      }
      bodyHtml = accountSelectorHtml + groupsHtml;
    }
  } else if (activeProvider === 'claude' && claudeData) {
    const fiveHourBucket: NormalizedBucket = {
      displayName: '5-Hour Window',
      window: '5h',
      remainingPct: Math.round(100 - (claudeData.fiveHour?.utilization || 0)),
      resetTime: claudeData.fiveHour?.resetsAt,
    };
    const weeklyBucket: NormalizedBucket = {
      displayName: '7-Day Window',
      window: 'weekly',
      remainingPct: Math.round(100 - (claudeData.sevenDay?.utilization || 0)),
      resetTime: claudeData.sevenDay?.resetsAt,
    };

    const userEmail = claudeData.email || 'Claude';
    const plan = claudeData.planType ? ` (${claudeData.planType.toUpperCase()})` : '';

    bodyHtml = `
      <div class="agy-account-bar ai-info-bar">
        <span class="ai-account-badge">${esc(userEmail)}${esc(plan)}</span>
        <span class="ai-meta-badge">Claude Code</span>
      </div>
      <div class="ai-model-group">
        <div class="ai-group-header">
          <span>Usage Quota</span>
        </div>
        <div class="agy-mini-grid">
          ${renderCircularGauge('Session', fiveHourBucket)}
          ${renderCircularGauge('Weekly', weeklyBucket)}
        </div>
      </div>
      <div class="ai-meta-pills">
        <span class="ai-meta-pill">Traffic: 100% Claude Code</span>
        <span class="ai-meta-pill">Active Pro Plan</span>
      </div>
    `;
  } else if (activeProvider === 'codex' && codexData) {
    const fiveHourBucket: NormalizedBucket = {
      displayName: '5-Hour Window',
      window: '5h',
      remainingPct: Math.round(100 - (codexData.primaryWindow?.usedPercent || 0)),
      resetTime: codexData.primaryWindow?.resetsAt,
    };
    const weeklyBucket: NormalizedBucket = {
      displayName: 'Weekly Window',
      window: 'weekly',
      remainingPct: Math.round(100 - (codexData.secondaryWindow?.usedPercent || 0)),
      resetTime: codexData.secondaryWindow?.resetsAt,
    };

    const userEmail = codexData.email || 'Codex';
    const plan = codexData.planType ? ` (${codexData.planType.toUpperCase()})` : '';

    bodyHtml = `
      <div class="agy-account-bar ai-info-bar">
        <span class="ai-account-badge">${esc(userEmail)}${esc(plan)}</span>
        <span class="ai-meta-badge">ChatGPT Plus</span>
      </div>
      <div class="ai-model-group">
        <div class="ai-group-header">
          <span>Rate Limits</span>
        </div>
        <div class="agy-mini-grid">
          ${renderCircularGauge('Primary', fiveHourBucket)}
          ${renderCircularGauge('Secondary', weeklyBucket)}
        </div>
      </div>
      <div class="ai-meta-pills">
        <span class="ai-meta-pill">Model: gpt-6-astra</span>
        <span class="ai-meta-pill">Credits: Standard</span>
      </div>
    `;
  }

  container.innerHTML = providerToolbarHtml + bodyHtml;

  // Event handlers for provider tabs
  const providerButtons = container.querySelectorAll<HTMLButtonElement>('.ai-provider-pill[data-provider]');
  providerButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const prov = btn.dataset.provider as ProviderTab;
      if (prov && prov !== activeProvider) {
        activeProvider = prov;
        renderAntigravity(agyData, claudeData, codexData);
      }
    });
  });

  // Event handlers for Antigravity account tabs
  const pills = container.querySelectorAll<HTMLButtonElement>('.agy-acc-pill[data-idx]');
  pills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      const idx = parseInt(pill.dataset.idx || '0', 10);
      selectedAccountIndex = idx;
      renderAntigravity(agyData, claudeData, codexData);
    });
  });
}
