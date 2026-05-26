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

function renderNetwork(net) {
  const el = $('net-rows');
  if (!net || Object.keys(net).length === 0) {
    el.innerHTML = '<div class="none">No network interfaces detected</div>';
    return;
  }

  const netEntries = Object.entries(net);
  const existingBlocks = el.querySelectorAll('.net-block[data-iface]');

  if (existingBlocks.length !== netEntries.length) {
    // Rebuild only when interface count changes
    el.innerHTML = netEntries.map(([iface, d]) =>
      '<div class="net-block" data-iface="' + esc(iface) + '">' +
      '<h4>\u2193 ' + esc(netIfaceLabel(iface)) + ' \u2191</h4>' +
      '<div class="info-row"><span class="key">RX Total</span><span class="val">' + fmtBytes(d.rx_bytes) + '</span></div>' +
      '<div class="info-row"><span class="key">TX Total</span><span class="val">' + fmtBytes(d.tx_bytes) + '</span></div>' +
      '<div class="info-row"><span class="key">\u2193 RX Rate</span><span class="val val-green">' + fmtBytesRate(d.rx_rate) + '</span></div>' +
      '<div class="info-row"><span class="key">\u2191 TX Rate</span><span class="val val-yellow">' + fmtBytesRate(d.tx_rate) + '</span></div>' +
      '</div>'
    ).join('');
    return;
  }

  // Patch values in place
  for (let i = 0; i < netEntries.length; i++) {
    const [, d] = netEntries[i];
    const block = existingBlocks[i];
    if (!block) continue;
    const vals = block.querySelectorAll('.val');
    if (vals.length >= 4) {
      setTextOf(vals[0], fmtBytes(d.rx_bytes));
      setTextOf(vals[1], fmtBytes(d.tx_bytes));
      setTextOf(vals[2], fmtBytesRate(d.rx_rate));
      setTextOf(vals[3], fmtBytesRate(d.tx_rate));
    }
  }
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

export { renderNetwork, renderConnectivity, renderSpeedtest, netIfaceLabel };
