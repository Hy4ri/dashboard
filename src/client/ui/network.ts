import { fmtBytesRate, fmtBytes, NONE } from '../utils/format.js';
import { $, esc } from '../utils/dom.js';
import { NET_IFACE_MAP } from '../config.js';
import { NetworkInterface, ConnectivityStatus, TechnitiumStats } from '../../shared/types.js';

export function netIfaceLabel(iface: string): string {
  if (NET_IFACE_MAP[iface]) return NET_IFACE_MAP[iface] + ' (' + iface + ')';
  for (const [prefix, label] of Object.entries(NET_IFACE_MAP)) {
    if (iface.startsWith(prefix)) return label + ' (' + iface + ')';
  }
  return iface;
}

export function renderNetworkRates(net?: Record<string, NetworkInterface> | null): void {
  const indicator = $('net-rate-indicator');
  const ifaceContainer = $('net-interfaces');

  if (!net || Object.keys(net).length === 0) {
    if (indicator) indicator.style.display = 'none';
    if (ifaceContainer) ifaceContainer.innerHTML = '';
    return;
  }

  let totalDown = 0;
  let totalUp = 0;
  for (const d of Object.values(net)) {
    totalDown += d.rx_rate || 0;
    totalUp += d.tx_rate || 0;
  }

  if (indicator) {
    if (totalDown === 0 && totalUp === 0) {
      indicator.style.display = 'none';
    } else {
      const downEl = indicator.querySelector('.net-rate-down');
      const upEl = indicator.querySelector('.net-rate-up');
      if (downEl) downEl.textContent = '↓ ' + fmtBytesRate(totalDown);
      if (upEl) upEl.textContent = '↑ ' + fmtBytesRate(totalUp);
      indicator.style.display = 'inline-flex';
    }
  }

  // Render network interfaces
  if (ifaceContainer) {
    const entries = Object.entries(net).filter(([name]) => name !== 'lo');
    if (entries.length === 0) {
      ifaceContainer.innerHTML = '';
      return;
    }

    ifaceContainer.innerHTML = entries.map(([name, stats]) => {
      const label = netIfaceLabel(name);
      const totalRx = fmtBytes(stats.rx_bytes || 0);
      const totalTx = fmtBytes(stats.tx_bytes || 0);
      const rxRate = fmtBytesRate(stats.rx_rate || 0);
      const txRate = fmtBytesRate(stats.tx_rate || 0);

      return `
        <div class="net-iface-item">
          <div class="net-iface-header">
            <span class="net-iface-name">${esc(label)}</span>
            <span class="net-iface-speeds">
              <span class="net-rate-down">↓ ${rxRate}</span>
              <span class="net-rate-up">↑ ${txRate}</span>
            </span>
          </div>
          <div class="net-iface-totals">
            <span>RX: ${totalRx}</span>
            <span>TX: ${totalTx}</span>
          </div>
        </div>
      `;
    }).join('');
  }
}

export function renderConnectivity(
  data?: { internet?: ConnectivityStatus; dns?: ConnectivityStatus } | null,
  dnsStats?: TechnitiumStats | null
): void {
  const internetEl = $('net-internet-status');
  const dnsEl = $('net-dns-status');

  if (!data) {
    if (internetEl) { internetEl.textContent = NONE; internetEl.className = 'connectivity-status'; }
    if (dnsEl) { dnsEl.textContent = NONE; dnsEl.className = 'connectivity-status'; }
    return;
  }

  if (internetEl) {
    if (data.internet && data.internet.ok) {
      const ms = data.internet.latency != null ? ` (${data.internet.latency}ms)` : '';
      internetEl.textContent = 'Online' + ms;
      internetEl.className = 'connectivity-status online';
    } else {
      internetEl.textContent = 'Offline';
      internetEl.className = 'connectivity-status offline';
    }
  }

  if (dnsEl) {
    if (data.dns && data.dns.ok) {
      const ms = data.dns.latency != null ? ` (${data.dns.latency}ms)` : '';
      dnsEl.textContent = 'Resolving' + ms;
      dnsEl.className = 'connectivity-status online';
    } else {
      const err = data.dns && data.dns.error ? ` (${data.dns.error})` : '';
      dnsEl.textContent = 'Issue' + err;
      dnsEl.className = 'connectivity-status offline';
    }
  }

  // Technitium DNS Stats render
  const statsEl = $('net-dns-stats');
  if (dnsStats && dnsStats.configured && statsEl) {
    if (dnsStats.ok) {
      const total = dnsStats.totalQueries || 0;
      const blocked = dnsStats.blockedQueries || 0;
      const cached = dnsStats.cachedQueries || 0;
      const blockedPct = (dnsStats.blockedPercentage || 0).toFixed(1);

      statsEl.innerHTML = `
        <div class="dns-block-bar-wrapper">
          <div class="dns-block-bar-header">
            <span class="dns-block-label">Ad & Tracker Blocking</span>
            <span class="dns-block-pct">${blockedPct}% blocked</span>
          </div>
          <div class="dns-progress-bar">
            <div class="dns-progress-fill" style="width:${blockedPct}%"></div>
          </div>
        </div>
        <div class="dns-stats-grid">
          <div class="dns-stat-item">
            <span class="dns-stat-key">Queries (24h)</span>
            <span class="dns-stat-val">${total.toLocaleString()}</span>
          </div>
          <div class="dns-stat-item">
            <span class="dns-stat-key">Blocked</span>
            <span class="dns-stat-val val-red">${blocked.toLocaleString()}</span>
          </div>
          <div class="dns-stat-item">
            <span class="dns-stat-key">Cached</span>
            <span class="dns-stat-val val-green">${cached.toLocaleString()}</span>
          </div>
        </div>
      `;
      statsEl.style.display = 'block';
    } else {
      statsEl.innerHTML = `<div class="dns-stats-error">Technitium API Error: ${esc(dnsStats.error)}</div>`;
      statsEl.style.display = 'block';
    }
  } else if (statsEl) {
    statsEl.style.display = 'none';
  }
}
