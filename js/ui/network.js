import { fmtBytes, fmtBytesRate, fmtTime, NONE } from '../utils/format.js';
import { $, esc, setTextOf } from '../utils/dom.js';
import { NET_IFACE_MAP } from '../config.js';

function netIfaceLabel(iface) {
  if (NET_IFACE_MAP[iface]) return NET_IFACE_MAP[iface] + ' (' + iface + ')';
  for (const [prefix, label] of Object.entries(NET_IFACE_MAP)) {
    if (iface.startsWith(prefix)) return label + ' (' + iface + ')';
  }
  return iface;
}

function renderNetworkRates(net) {
  const indicator = $('net-rate-indicator');
  if (!indicator) return;
  if (!net || Object.keys(net).length === 0) {
    indicator.style.display = 'none';
    return;
  }

  let totalDown = 0;
  let totalUp = 0;
  for (const d of Object.values(net)) {
    totalDown += d.rx_rate || 0;
    totalUp += d.tx_rate || 0;
  }

  if (totalDown === 0 && totalUp === 0) {
    indicator.style.display = 'none';
    return;
  }

  const downEl = indicator.querySelector('.net-rate-down');
  const upEl = indicator.querySelector('.net-rate-up');
  if (downEl) downEl.textContent = '\u2193 ' + fmtBytesRate(totalDown);
  if (upEl) upEl.textContent = '\u2191 ' + fmtBytesRate(totalUp);
  indicator.style.display = 'inline-flex';
}

function renderConnectivity(data, dnsStats) {
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
  let statsEl = $('net-dns-stats');
  if (dnsStats && dnsStats.configured) {
    if (!statsEl) {
      const netCard = $('net-card');
      if (netCard) {
        statsEl = document.createElement('div');
        statsEl.id = 'net-dns-stats';
        statsEl.className = 'dns-stats-container';
        const connRow = $('net-connectivity');
        if (connRow) {
          netCard.insertBefore(statsEl, connRow.nextSibling);
        } else {
          netCard.appendChild(statsEl);
        }
      }
    }

    if (statsEl) {
      if (dnsStats.ok) {
        statsEl.innerHTML = `
          <div class="dns-stat-item">
            <span class="dns-stat-key">Queries (24h)</span>
            <span class="dns-stat-val">${dnsStats.totalQueries.toLocaleString()}</span>
          </div>
          <div class="dns-stat-item">
            <span class="dns-stat-key">Blocked</span>
            <span class="dns-stat-val val-red">${dnsStats.blockedQueries.toLocaleString()} (${dnsStats.blockedPercentage}%)</span>
          </div>
          <div class="dns-stat-item">
            <span class="dns-stat-key">Cached</span>
            <span class="dns-stat-val val-green">${dnsStats.cachedQueries.toLocaleString()}</span>
          </div>
        `;
        statsEl.style.display = 'grid';
      } else {
        statsEl.innerHTML = `<div class="dns-stats-error">Technitium API Error: ${esc(dnsStats.error)}</div>`;
        statsEl.style.display = 'block';
      }
    }
  } else {
    if (statsEl) statsEl.style.display = 'none';
  }
}

function renderSpeedtest(data) {
  const section = $('speedtest-section');
  const statusEl = $('speedtest-status');
  const resultsEl = $('speedtest-results');
  const btn = $('speedtest-btn');

  if (!section) return;

  if (!data) {
    statusEl.innerHTML = '';
    resultsEl.innerHTML = '';
    return;
  }

  // Not installed
  if (data.installed === false) {
    statusEl.innerHTML = '<div class="speedtest-error">speedtest-cli not found. Install: <code>sudo apt install speedtest-cli</code></div>';
    resultsEl.innerHTML = '';
    if (btn) btn.style.display = 'none';
    return;
  }

  if (btn) btn.style.display = '';

  // Running
  if (data.running) {
    statusEl.innerHTML = '<div class="speedtest-running">Testing...</div>';
  } else {
    // Show last test time or empty state
    if (data.lastTestTime) {
      const ago = Math.round((Date.now() - data.lastTestTime) / 60000);
      statusEl.innerHTML = '<span class="speedtest-info">Last test: ' + (ago < 1 ? 'just now' : ago + ' min ago') + '</span>';
    } else {
      statusEl.innerHTML = '<span class="speedtest-info">No tests run yet</span>';
    }
  }

  // Results table
  if (!data.results || data.results.length === 0) {
    resultsEl.innerHTML = '<div class="speedtest-empty">Run a test or wait for auto-test</div>';
    return;
  }

  resultsEl.innerHTML = '<table class="speedtest-table">' +
    '<thead><tr><th>Time</th><th>\u2193 Download</th><th>\u2191 Upload</th><th>Ping</th></tr></thead>' +
    '<tbody>' +
    data.results.map(r => {
      const dl = r.download != null ? r.download.toFixed(1) + ' Mbps' : NONE;
      const ul = r.upload != null   ? r.upload.toFixed(1) + ' Mbps' : NONE;
      const pg = r.ping != null     ? r.ping.toFixed(0) + ' ms' : NONE;
      return '<tr>' +
        '<td>' + fmtTime(r.timestamp) + '</td>' +
        '<td>' + dl + '</td>' +
        '<td>' + ul + '</td>' +
        '<td>' + pg + '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table>';
}

export { renderNetworkRates, renderConnectivity, renderSpeedtest, netIfaceLabel };
