/* ── Dashboard Frontend ─────────────────────────────────────────────── */

const POLL_MS = 3000;
let staleTimer = null;
let pollTimer = null;
let pm2MenuEl = null;
let pm2MenuTarget = null;

// ── Name maps ──────────────────────────────────────────────────────

const THERMAL_MAP = {
  'cpu-1-6-step':    'CPU Hotspot',
  'battery':         'Battery',
  'gpuss-0-step':    'GPU',
  'ddr-usr':         'RAM',
  'modem-lte-sub6-pa1': '5G Modem',
  'pmr735a_tz':      'PMIC',
};

const GOVERNOR_MAP = {
  schedutil:   'Scheduler-guided',
  performance: 'Max Performance',
  powersave:   'Power Saving',
  ondemand:    'On Demand',
  conservative:'Conservative',
  userspace:   'Userspace',
};

const NET_IFACE_MAP = {
  'wlan0': 'WiFi',
  'wl': 'WiFi',
  'eth0': 'Ethernet',
  'enp': 'Ethernet',
  'tun0': 'VPN',
  'wg0': 'WireGuard',
  'lo': 'Loopback',
  'docker0': 'Docker',
  'br-': 'Bridge',
};

// ── Service dashboard links ────────────────────────────────────────

const SERVICE_LINKS = [
  { name: 'Jellyfin',    port: 8096, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"/><polyline points="9 3 9 21"/></svg>' },
  { name: 'Seerr',       port: 5055, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' },
  { name: 'qBittorrent', port: 7777, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' },
  { name: 'Sonarr',      port: 8989, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
  { name: 'Radarr',      port: 7878, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>' },
  { name: 'Prowlarr',    port: 9696, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' },
  { name: 'Bazarr',      port: 6767, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>' },
  { name: 'Dufs',        port: 5050, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>' },
  { name: 'Technitium',  port: 5380, icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>' },
];

document.title = 'Server Dashboard \u2014 Loading...';

// ── Format helpers ──────────────────────────────────────────────────

const NONE = 'N/A';

function fmtBytes(v) {
  if (v == null) return NONE;
  if (v === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), units.length - 1);
  return (v / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function fmtBytesRate(v) {
  if (v == null) return NONE;
  return fmtBytes(v) + '/s';
}

function fmtUptime(s) {
  if (s == null) return NONE;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(d + 'd');
  if (h > 0) parts.push(h + 'h');
  parts.push(m + 'm');
  return parts.join(' ');
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

function fmtPct(v) {
  if (v == null) return NONE;
  return v.toFixed(1) + '%';
}

function fmtTemp(v) {
  if (v == null) return NONE;
  return v.toFixed(0) + '\u00B0C';
}

function fmtFreq(v) {
  if (v == null) return NONE;
  if (v >= 1000) return (v / 1000).toFixed(2) + ' GHz';
  return v + ' MHz';
}

function fmtVolt(v) {
  if (v == null) return NONE;
  return (v / 1_000_000).toFixed(3) + ' V';
}

function fmtCurrent(v) {
  if (v == null) return NONE;
  if (v === 0) return 'Not drawing';
  return (Math.abs(v) / 1_000_000).toFixed(3) + ' A';
}

function fmtSectors(v) {
  if (v == null) return NONE;
  return fmtBytes(v * 512) + '/s';
}

// ── DOM helpers ─────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const esc = s => s == null ? '' : String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Update textContent of an element, given its id
function setText(id, val) {
  const el = $(id);
  if (!el) return;
  el.textContent = val;
  if (val === NONE) {
    el.setAttribute('aria-label', 'Not available');
  } else {
    el.removeAttribute('aria-label');
  }
}

// Update bar fill width, text label, and ARIA
function updateBar(id, pct, valText) {
  const fill = $(id);
  if (!fill) return;
  fill.style.width = Math.min(pct * 100, 100) + '%';
  fill.setAttribute('aria-valuenow', Math.round(pct * 100));
  const bar = fill.closest('.bar-wrap');
  if (bar) {
    const label = bar.querySelector('.bar-label');
    if (label) {
      const pctSpan = label.querySelector('span:last-child');
      if (pctSpan) {
        let suffix = '';
        if (pct > 0.85) suffix = ' \uD83D\uDEA8 Critical';
        else if (pct > 0.7) suffix = ' \u26A0 High';
        pctSpan.textContent = valText + suffix;
      }
    }
  }
}

function barClass(pct, warn, crit) {
  if (pct > crit) return ' critical';
  if (pct > warn) return ' high';
  return '';
}

// ── Render functions (granular DOM patching) ────────────────────────

function renderPM2(data) {
  const tbody = $('pm2-body');
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="none">No processes monitored. Is PM2 running?</td></tr>';
    return;
  }

  // Check if row count changed (full rebuild needed)
  const existing = tbody.querySelectorAll('tr[data-pm-id]');
  if (existing.length !== data.length) {
    // Rebuild all rows
    tbody.innerHTML = data.map(p => {
      const stCls = p.status === 'online' ? 'online' : p.status === 'errored' ? 'errored' : 'stopped';
      const uptime = p.uptime ? (Date.now() - p.uptime) / 1000 : null;
      return '<tr data-pm-id="' + p.id + '">' +
        '<td>' + p.id + '</td>' +
        '<td><strong>' + esc(p.name) + '</strong></td>' +
        '<td><span class="status-indicator ' + stCls + '"></span>' + esc(p.status) + '</td>' +
        '<td>' + p.cpu.toFixed(1) + '%</td>' +
        '<td>' + fmtBytes(p.memory) + '</td>' +
        '<td>' + fmtUptime(uptime) + '</td>' +
        '<td>' + p.restarts + '</td>' +
        '<td>' + (p.pid || NONE) + '</td>' +
        '</tr>';
    }).join('');
    return;
  }

  // Patch existing rows in-place
  const rows = tbody.querySelectorAll('tr[data-pm-id]');
  const map = {};
  data.forEach(p => { map[p.id] = p; });

  for (const row of rows) {
    const id = parseInt(row.getAttribute('data-pm-id'), 10);
    const p = map[id];
    if (!p) continue;

    const cells = row.querySelectorAll('td');
    if (cells.length < 8) continue;

    const uptime = p.uptime ? (Date.now() - p.uptime) / 1000 : null;
    const stCls = p.status === 'online' ? 'online' : p.status === 'errored' ? 'errored' : 'stopped';

    // Name
    const nameStrong = cells[1].querySelector('strong');
    if (nameStrong) setTextOf(nameStrong, esc(p.name));

    // Status (cell[2] has span + text)
    const indicator = cells[2].querySelector('.status-indicator');
    if (indicator) {
      indicator.className = 'status-indicator ' + stCls;
    }
    setTextOfLast(cells[2], esc(p.status));

    setTextOf(cells[3], p.cpu.toFixed(1) + '%');
    setTextOf(cells[4], fmtBytes(p.memory));
    setTextOf(cells[5], fmtUptime(uptime));
    setTextOf(cells[6], '' + p.restarts);
    setTextOf(cells[7], p.pid || NONE);
  }
}

// Set textContent of an element
function setTextOf(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

// Set textContent of last text node / child
function setTextOfLast(el, text) {
  if (!el) return;
  // Walk children backward to find the last text-containing node
  const children = el.childNodes;
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].nodeType === Node.TEXT_NODE) {
      if (children[i].textContent !== text) children[i].textContent = text;
      return;
    }
  }
}

function renderCPU(data) {
  if (data == null) {
    const fill = $('cpu-bar-fill');
    if (fill) fill.style.width = '0%';
    setText('cpu-pct', NONE);
    return;
  }
  const pct = data / 100;
  const fill = $('cpu-bar-fill');
  if (fill) {
    fill.className = 'bar-fill cpu' + barClass(pct, 0.6, 0.8);
  }
  updateBar('cpu-bar-fill', pct, data.toFixed(1) + '%');
}

function renderCPUCores(cores) {
  const container = $('cpu-cores');
  if (!cores || cores.length === 0) {
    container.innerHTML = '';
    return;
  }

  const existing = container.querySelectorAll('.core-item');

  if (existing.length !== cores.length) {
    // Rebuild
    container.innerHTML = cores.map((c, i) => {
      const pct = Math.min((c || 0) / 100, 1);
      return '<div class="core-item" data-core="' + i + '">' +
        '<div class="core-label"><span>CPU' + i + '</span><span class="core-val">' + (c != null ? c.toFixed(1) + '%' : NONE) + '</span></div>' +
        '<div class="core-bar"><div class="core-fill" style="width:' + (pct * 100) + '%"></div></div></div>';
    }).join('');
    return;
  }

  // Patch
  for (let i = 0; i < cores.length; i++) {
    const item = existing[i];
    if (!item) continue;
    const valEl = item.querySelector('.core-val');
    if (valEl) valEl.textContent = cores[i] != null ? cores[i].toFixed(1) + '%' : NONE;
    const fill = item.querySelector('.core-fill');
    if (fill) fill.style.width = Math.min((cores[i] || 0), 100) + '%';
  }
}

function renderThermal(data) {
  const container = $('thermal-grid');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="none">No thermal sensors detected</div>';
    return;
  }

  // Sort for consistent ordering
  const sorted = data.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const existing = container.querySelectorAll('.thermal-item[data-zone]');

  if (existing.length !== sorted.length) {
    container.innerHTML = sorted.map(t => {
      const hot = t.temp > 70 ? 'very-hot' : t.temp > 55 ? 'hot' : '';
      const label = THERMAL_MAP[t.name] || t.name;
      return '<div class="thermal-item" data-zone="' + esc(t.name) + '">' +
        '<span class="label">' + esc(label) + '</span>' +
        '<span class="temp ' + hot + '">' + fmtTemp(t.temp) + '</span></div>';
    }).join('');
    return;
  }

  // Patch
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const item = existing[i];
    if (!item) continue;
    const tempEl = item.querySelector('.temp');
    if (tempEl) {
      const hot = t.temp > 70 ? 'very-hot' : t.temp > 55 ? 'hot' : '';
      tempEl.className = 'temp' + (hot ? ' ' + hot : '');
      setTextOf(tempEl, fmtTemp(t.temp));
    }
  }
}

function renderFreq(data) {
  const container = $('freq-grid');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="none">No CPU frequency data available</div>';
    return;
  }

  const existing = container.querySelectorAll('.freq-item[data-core]');

  if (existing.length !== data.length) {
    container.innerHTML = data.map(f =>
      '<div class="freq-item" data-core="' + f.core + '">' +
      '<div class="core-label">CPU' + f.core + '</div>' +
      '<div class="value">' + fmtFreq(f.current) + '</div>' +
      '<div class="freq-sub">min ' + fmtFreq(f.min) + ' \u00B7 max ' + fmtFreq(f.max) + '</div>' +
      '<div class="freq-sub">' + esc(GOVERNOR_MAP[f.governor] || f.governor || NONE) + '</div>' +
      '</div>'
    ).join('');
    return;
  }

  // Patch
  for (let i = 0; i < data.length; i++) {
    const f = data[i];
    const item = existing[i];
    if (!item) continue;
    const val = item.querySelector('.value');
    if (val) setTextOf(val, fmtFreq(f.current));
    const subs = item.querySelectorAll('.freq-sub');
    if (subs.length >= 2) {
      setTextOf(subs[0], 'min ' + fmtFreq(f.min) + ' \u00B7 max ' + fmtFreq(f.max));
      setTextOf(subs[1], esc(GOVERNOR_MAP[f.governor] || f.governor || NONE));
    }
  }
}

function renderLoad(data) {
  setText('load-1', data ? data[0].toFixed(2) : NONE);
  setText('load-5', data ? data[1].toFixed(2) : NONE);
  setText('load-15', data ? data[2].toFixed(2) : NONE);
}

function renderMemory(mem) {
  if (!mem) {
    const fill = $('mem-bar-fill');
    if (fill) fill.style.width = '0%';
    setText('mem-pct', NONE);
    setText('mem-total', NONE);
    setText('mem-avail', NONE);
    setText('mem-free', NONE);
    setText('mem-buffers', NONE);
    setText('mem-cached', NONE);
    return;
  }
  const used = mem.MemTotal - mem.MemAvailable;
  const pct = mem.MemTotal > 0 ? used / mem.MemTotal : 0;
  const fill = $('mem-bar-fill');
  if (fill) {
    fill.className = 'bar-fill memory' + barClass(pct, 0.6, 0.8);
  }
  updateBar('mem-bar-fill', pct, fmtBytes(used) + ' / ' + fmtBytes(mem.MemTotal));
  setText('mem-total', fmtBytes(mem.MemTotal));
  setText('mem-avail', fmtBytes(mem.MemAvailable));
  setText('mem-free', fmtBytes(mem.MemFree));
  setText('mem-buffers', fmtBytes(mem.Buffers));
  setText('mem-cached', fmtBytes(mem.Cached));
}

function renderSwap(swap) {
  if (!swap) {
    const fill = $('swap-bar-fill');
    if (fill) fill.style.width = '0%';
    setText('swap-pct', NONE);
    setText('swap-total', NONE);
    setText('swap-free', NONE);
    return;
  }
  const used = swap.total - swap.free;
  const pct = swap.total > 0 ? used / swap.total : 0;
  const fill = $('swap-bar-fill');
  if (fill) {
    fill.className = 'bar-fill swap' + barClass(pct, 0.6, 0.8);
  }
  updateBar('swap-bar-fill', pct, fmtBytes(used) + ' / ' + fmtBytes(swap.total));
  setText('swap-total', fmtBytes(swap.total));
  setText('swap-free', fmtBytes(swap.free));
}

function renderDisk(disk) {
  if (!disk || !disk.total) {
    const fill = $('disk-bar-fill');
    if (fill) fill.style.width = '0%';
    setText('disk-used-label', NONE);
    setText('disk-pct', NONE);
    setText('disk-total', NONE);
    setText('disk-used', NONE);
    setText('disk-avail', NONE);
    $('disk-io-rows').innerHTML = '';
    return;
  }
  const pct = disk.total > 0 ? disk.used / disk.total : 0;
  const fill = $('disk-bar-fill');
  if (fill) {
    fill.className = 'bar-fill disk' + barClass(pct, 0.7, 0.85);
  }
  updateBar('disk-bar-fill', pct, (pct * 100).toFixed(1) + '%');
  setText('disk-used-label', fmtBytes(disk.used) + ' / ' + fmtBytes(disk.total));
  setText('disk-total', fmtBytes(disk.total));
  setText('disk-used', fmtBytes(disk.used));
  setText('disk-avail', fmtBytes(disk.available));

  // I/O — patch in place to avoid DOM thrashing
  const ioEl = $('disk-io-rows');
  const io = disk.io;
  if (!io || Object.keys(io).length === 0) {
    ioEl.innerHTML = '<div class="none">No disk I/O data available</div>';
    return;
  }

  const ioEntries = Object.entries(io);
  const existingBlocks = ioEl.querySelectorAll('.io-block[data-dev]');

  if (existingBlocks.length !== ioEntries.length) {
    // Rebuild only when device count changes
    ioEl.innerHTML = ioEntries.map(([dev, d]) =>
      '<div class="io-block" data-dev="' + dev + '">' +
      '<h3 class="io-device">' + dev + '</h3>' +
      '<div class="info-row"><span class="key">Read Ops</span><span class="val">' + (d.reads || 0).toLocaleString() + ' (' + d.readsPerSec + '/s)</span></div>' +
      '<div class="info-row"><span class="key">Write Ops</span><span class="val">' + (d.writes || 0).toLocaleString() + ' (' + d.writesPerSec + '/s)</span></div>' +
      '<div class="info-row"><span class="key">Read Rate</span><span class="val">' + fmtSectors(d.sectorsReadPerSec) + '</span></div>' +
      '<div class="info-row"><span class="key">Write Rate</span><span class="val">' + fmtSectors(d.sectorsWrittenPerSec) + '</span></div>' +
      '</div>'
    ).join('');
    return;
  }

  // Patch values in place
  for (let i = 0; i < ioEntries.length; i++) {
    const [, d] = ioEntries[i];
    const block = existingBlocks[i];
    if (!block) continue;
    const vals = block.querySelectorAll('.val');
    if (vals.length >= 4) {
      setTextOf(vals[0], (d.reads || 0).toLocaleString() + ' (' + d.readsPerSec + '/s)');
      setTextOf(vals[1], (d.writes || 0).toLocaleString() + ' (' + d.writesPerSec + '/s)');
      setTextOf(vals[2], fmtSectors(d.sectorsReadPerSec));
      setTextOf(vals[3], fmtSectors(d.sectorsWrittenPerSec));
    }
  }
}

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

function renderConnectivity(data) {
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
}

function renderBattery(bat) {
  const container = $('header-battery');
  const valEl = $('bat-header-val');
  const fillEl = $('bat-fill');
  if (!container || !valEl) return;

  if (!bat || bat.capacity == null) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'inline-flex';
  valEl.textContent = bat.capacity + '%';

  // Update CSS battery fill level
  if (fillEl) {
    fillEl.style.width = bat.capacity + '%';
    fillEl.className = 'battery-fill';
    if (bat.capacity <= 15) fillEl.classList.add('low');
    else if (bat.capacity <= 30) fillEl.classList.add('warn');
  }
}

function renderSystem(sys) {
  if (!sys || !sys.hostname) return;
  document.title = 'Dashboard \u2014 ' + sys.hostname;
}

// ── Render torrents ──────────────────────────────────────────────

function renderTorrents(torrents) {
  const card = $('torrent-card');
  const list = $('torrent-list');
  if (!card || !list) return;

  if (!torrents || torrents.length === 0) {
    list.innerHTML = '<div class="none">No active downloads. Torrents will appear here when downloading.</div>';
    return;
  }

  list.innerHTML = torrents.map(t => {
    const pct = t.progress * 100;
    const stateLabel = t.state ? t.state.charAt(0).toUpperCase() + t.state.slice(1) : 'Unknown';
    const ratioClass = t.ratio > 1 ? 'ratio-good' : '';
    const ratio = t.ratio != null
      ? '<span class="' + ratioClass + '">' + t.ratio.toFixed(2) + ' ratio</span>'
      : '';
    const meta = [stateLabel, ratio].filter(Boolean).join(' \u00B7 ');

    return '<div class="torrent-item">' +
      '<div class="torrent-header">' +
        '<span class="torrent-name" title="' + esc(t.name) + '">' + esc(t.name) + '</span>' +
        '<span class="torrent-meta">' + meta + '</span>' +
      '</div>' +
      '<div class="torrent-bar"><div class="torrent-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="torrent-stats">' +
        '<span>\u2193 ' + fmtBytesRate(t.dlspeed) + '</span>' +
        '<span>\u2191 ' + fmtBytesRate(t.upspeed) + '</span>' +
        '<span>' + fmtBytes(t.size) + '</span>' +
        '<span>Seeds: ' + (t.num_seeds || 0) + '</span>' +
        '<span>Peers: ' + (t.num_peers || 0) + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
}

// ── Update ──────────────────────────────────────────────────────────

function updateUI(data) {
  if (!data) return;

  // Timestamp & status
  $('last-update').textContent = 'Last: ' + fmtTime(data.timestamp);
  const dot = $('status-dot');
  dot.className = 'status-dot';

  // Update sr-only status text
  $('status-text').textContent = 'Connected';

  // Sections
  renderPM2(data.pm2);
  renderCPU(data.cpu);
  renderCPUCores(data.cpuCores);
  renderThermal(data.thermal);
  renderFreq(data.frequency);
  renderLoad(data.loadavg);
  renderMemory(data.memory);
  renderSwap(data.swap);
  renderDisk(data.disk);
  renderNetwork(data.network);
  renderConnectivity({ internet: data.internet, dns: data.dns });
  renderBattery(data.battery);
  renderTorrents(data.torrents);
  renderSystem(data.system);
}

function setErrorState(msg) {
  $('status-dot').className = 'status-dot off';
  $('last-update').textContent = 'Connection lost. Retrying\u2026';
  $('status-text').textContent = 'Disconnected \u2014 ' + msg;
}

function doFetch({ onStart, onDone }) {
  if (onStart) onStart();
  fetch('/api/status')
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(data => {
      updateUI(data);
      $('status-dot').className = 'status-dot';
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        $('status-dot').className = 'status-dot stale';
        $('status-text').textContent = 'Connected \u2014 data stale';
      }, POLL_MS * 2);
      if (onDone) onDone();
    })
    .catch(err => {
      setErrorState(err.message);
      if (onDone) onDone();
    });
}

function fetchStatus() {
  doFetch({});
}

// ── PM2 context menu ─────────────────────────────────────────────

function showPM2Menu(name, status, rect) {
  // Remove any existing menu
  closePM2Menu();

  const menu = document.createElement('div');
  menu.className = 'pm2-menu';

  const actions = status === 'stopped'
    ? [{ label: 'Start', action: 'start', cls: 'pm2-btn-start' }]
    : status === 'online' || status === 'errored'
    ? [
        { label: 'Stop', action: 'stop', cls: 'pm2-btn-stop' },
        { label: 'Restart', action: 'restart', cls: 'pm2-btn-restart' },
      ]
    : [];

  actions.forEach(({ label, action, cls }) => {
    const btn = document.createElement('button');
    btn.className = 'pm2-btn ' + cls;
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      pm2ControlAction(name, action);
      closePM2Menu();
    });
    menu.appendChild(btn);
  });

  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';

  document.body.appendChild(menu);
  pm2MenuEl = menu;
  pm2MenuTarget = { name, status };
}

function closePM2Menu() {
  if (pm2MenuEl) {
    pm2MenuEl.remove();
    pm2MenuEl = null;
  }
  pm2MenuTarget = null;
}

async function pm2ControlAction(name, action) {
  try {
    const res = await fetch('/api/pm2/' + action + '/' + encodeURIComponent(name), { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      fetchStatus();
    } else {
      alert('Error: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Request failed: ' + err.message);
  }
}

// Click on PM2 name → show menu
$('pm2-body').addEventListener('click', (e) => {
  const nameEl = e.target.closest('td:nth-child(2) strong');
  if (!nameEl) return;
  e.stopPropagation();
  const row = nameEl.closest('tr[data-pm-id]');
  const cells = row.querySelectorAll('td');
  const statusText = cells[2].textContent.trim();
  const name = nameEl.textContent.trim();
  const rect = nameEl.getBoundingClientRect();
  showPM2Menu(name, statusText, rect);
});

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  if (pm2MenuEl && !pm2MenuEl.contains(e.target) && !e.target.closest('td:nth-child(2) strong')) {
    closePM2Menu();
  }
});

// Close menu on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePM2Menu();
});

// ── Auto-pause when tab is hidden ──────────────────────────────────

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(pollTimer);
    $('last-update').textContent = 'Updates paused while tab is hidden';
    $('status-text').textContent = 'Paused';
  } else {
    fetchStatus();
    pollTimer = setInterval(fetchStatus, POLL_MS);
  }
});

// ── Init service bar ─────────────────────────────────────────────

function initServiceBar() {
  const bar = $('service-bar');
  if (!bar) return;

  const host = window.location.hostname;
  const protocol = window.location.protocol;

  bar.innerHTML = SERVICE_LINKS.map(s =>
    '<a href="' + protocol + '//' + host + ':' + s.port + '" target="_blank" rel="noopener noreferrer" class="service-btn">' +
    s.icon +
    '<span>' + esc(s.name) + '</span>' +
    '<span aria-hidden="true" style="font-size:10px;opacity:0.5">\u2197</span>' +
    '</a>'
  ).join('');
}

// ── Start ──────────────────────────────────────────────────────────

initServiceBar();
fetchStatus();
pollTimer = setInterval(fetchStatus, POLL_MS);
