/* ── Dashboard Frontend ─────────────────────────────────────────────── */

const POLL_MS = 3000;
let staleTimer = null;
let prevData = null;

// ── Format helpers ──────────────────────────────────────────────────

function fmtBytes(v) {
  if (v == null) return 'N/A';
  if (v === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), units.length - 1);
  return (v / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function fmtBytesRate(v) {
  if (v == null) return 'N/A';
  return fmtBytes(v) + '/s';
}

function fmtUptime(s) {
  if (s == null) return 'N/A';
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
  if (v == null) return '—';
  return v.toFixed(1) + '%';
}

function fmtTemp(v) {
  if (v == null) return '—';
  return v.toFixed(0) + '°C';
}

function fmtMHz(v) {
  if (v == null) return '—';
  return v + ' MHz';
}

function fmtVolt(v) {
  if (v == null) return 'N/A';
  return (v / 1_000_000).toFixed(3) + ' V';
}

function fmtCurrent(v) {
  if (v == null) return 'N/A';
  return (v / 1_000_000).toFixed(3) + ' A';
}

function fmtSectors(v) {
  if (v == null) return 'N/A';
  // 1 sector = 512 bytes
  return fmtBytes(v * 512) + '/s';
}

// ── DM helpers ───────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

// ── Render functions ─────────────────────────────────────────────────

function renderPM2(data) {
  const tbody = $('pm2-body');
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="none">No PM2 data</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(p => {
    const stCls = p.status === 'online' ? 'online' : p.status === 'errored' ? 'errored' : 'stopped';
    return '<tr>' +
      `<td>${p.id}</td>` +
      `<td><strong>${esc(p.name)}</strong></td>` +
      `<td><span class="status-indicator ${stCls}"></span>${p.status}</td>` +
      `<td>${p.cpu.toFixed(1)}%</td>` +
      `<td>${fmtBytes(p.memory)}</td>` +
      `<td>${fmtUptime(p.uptime ? (Date.now() - p.uptime) / 1000 : null)}</td>` +
      `<td>${p.restarts}</td>` +
      `<td>${p.pid || '—'}</td>` +
      '</tr>';
  }).join('');
}

function renderCPU(data) {
  const overall = $('cpu-overall');
  const cores  = $('cpu-cores');

  if (data == null) {
    overall.innerHTML = '<div class="none">No data</div>';
    cores.innerHTML = '';
    return;
  }

  const pct = data / 100;
  const cls = pct > 0.8 ? 'critical' : pct > 0.6 ? 'high' : '';
  overall.innerHTML =
    `<div class="bar-wrap"><div class="bar-fill cpu ${cls}" style="width:${Math.min(pct * 100, 100)}%"></div>` +
    `<div class="bar-label"><span>Overall</span><span>${data.toFixed(1)}%</span></div></div>`;
}

function renderCPUCores(cores) {
  const el = $('cpu-cores');
  if (!cores || cores.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = cores.map((c, i) => {
    const pct = Math.min((c || 0) / 100, 1);
    return '<div class="core-item">' +
      '<div class="core-label"><span>CPU' + i + '</span><span>' + (c != null ? c.toFixed(1) + '%' : '—') + '</span></div>' +
      '<div class="core-bar"><div class="core-fill" style="width:' + (pct * 100) + '%"></div></div>' +
      '</div>';
  }).join('');
}

function renderThermal(data) {
  const el = $('thermal-grid');
  if (!data || data.length === 0) {
    el.innerHTML = '<div class="none">No thermal data</div>';
    return;
  }
  el.innerHTML = data.map(t => {
    const hot = t.temp > 70 ? 'very-hot' : t.temp > 55 ? 'hot' : '';
    return '<div class="thermal-item">' +
      '<span class="label">' + esc(t.name) + '</span>' +
      '<span class="temp ' + hot + '">' + fmtTemp(t.temp) + '</span>' +
      '</div>';
  }).join('');
}

function renderFreq(data) {
  const el = $('freq-grid');
  if (!data || data.length === 0) {
    el.innerHTML = '<div class="none">No frequency data</div>';
    return;
  }
  el.innerHTML = data.map(f =>
    '<div class="freq-item">' +
    '<div class="core-label">CPU' + f.core + '</div>' +
    '<div class="value">' + fmtMHz(f.current) + '</div>' +
    '<div style="font-size:11px;color:var(--text-muted)">min ' + fmtMHz(f.min) + ' · max ' + fmtMHz(f.max) + '</div>' +
    '<div style="font-size:11px;color:var(--text-muted)">' + esc(f.governor || '—') + '</div>' +
    '</div>'
  ).join('');
}

function renderLoad(data) {
  const el = $('load-rows');
  if (!data) {
    el.innerHTML = '<div class="none">No data</div>';
    return;
  }
  const labels = ['1 min', '5 min', '15 min'];
  el.innerHTML = data.map((v, i) =>
    '<div class="info-row"><span class="key">' + labels[i] + '</span><span class="val">' + v.toFixed(2) + '</span></div>'
  ).join('');
}

function renderMemory(mem) {
  const bar = $('mem-bar');
  const rows = $('mem-rows');
  if (!mem) {
    bar.innerHTML = '<div class="none">No data</div>';
    rows.innerHTML = '';
    return;
  }
  const used = mem.MemTotal - mem.MemAvailable;
  const pct = mem.MemTotal > 0 ? used / mem.MemTotal : 0;
  const cls = pct > 0.8 ? 'critical' : pct > 0.6 ? 'high' : '';
  bar.innerHTML =
    '<div class="bar-wrap"><div class="bar-fill memory ' + cls + '" style="width:' + (pct * 100) + '%"></div>' +
    '<div class="bar-label"><span>Used</span><span>' + fmtBytes(used) + ' / ' + fmtBytes(mem.MemTotal) + '</span></div></div>';
  rows.innerHTML =
    '<div class="info-row"><span class="key">Total</span><span class="val">' + fmtBytes(mem.MemTotal) + '</span></div>' +
    '<div class="info-row"><span class="key">Available</span><span class="val val-green">' + fmtBytes(mem.MemAvailable) + '</span></div>' +
    '<div class="info-row"><span class="key">Free</span><span class="val">' + fmtBytes(mem.MemFree) + '</span></div>' +
    '<div class="info-row"><span class="key">Buffers</span><span class="val">' + fmtBytes(mem.Buffers) + '</span></div>' +
    '<div class="info-row"><span class="key">Cached</span><span class="val">' + fmtBytes(mem.Cached) + '</span></div>';
}

function renderSwap(swap) {
  const bar = $('swap-bar');
  const rows = $('swap-rows');
  if (!swap) {
    bar.innerHTML = '<div class="none">No data</div>';
    rows.innerHTML = '';
    return;
  }
  const used = swap.total - swap.free;
  const pct = swap.total > 0 ? used / swap.total : 0;
  const cls = pct > 0.8 ? 'critical' : pct > 0.6 ? 'high' : '';
  bar.innerHTML =
    '<div class="bar-wrap"><div class="bar-fill swap ' + cls + '" style="width:' + (pct * 100) + '%"></div>' +
    '<div class="bar-label"><span>Used</span><span>' + fmtBytes(used) + ' / ' + fmtBytes(swap.total) + '</span></div></div>';
  rows.innerHTML =
    '<div class="info-row"><span class="key">Total</span><span class="val">' + fmtBytes(swap.total) + '</span></div>' +
    '<div class="info-row"><span class="key">Free</span><span class="val val-green">' + fmtBytes(swap.free) + '</span></div>';
}

function renderDisk(disk) {
  const bar = $('disk-bar');
  const rows = $('disk-rows');
  const ioEl = $('disk-io-rows');

  if (!disk || !disk.total) {
    bar.innerHTML = '<div class="none">No data</div>';
    rows.innerHTML = '';
    ioEl.innerHTML = '';
    return;
  }
  const pct = disk.total > 0 ? disk.used / disk.total : 0;
  const cls = pct > 0.85 ? 'critical' : pct > 0.7 ? 'high' : '';
  bar.innerHTML =
    '<div class="bar-wrap"><div class="bar-fill disk ' + cls + '" style="width:' + (pct * 100) + '%"></div>' +
    '<div class="bar-label"><span>' + fmtBytes(disk.used) + ' / ' + fmtBytes(disk.total) + '</span><span>' + (pct * 100).toFixed(1) + '%</span></div></div>';
  rows.innerHTML =
    '<div class="info-row"><span class="key">Total</span><span class="val">' + fmtBytes(disk.total) + '</span></div>' +
    '<div class="info-row"><span class="key">Used</span><span class="val">' + fmtBytes(disk.used) + '</span></div>' +
    '<div class="info-row"><span class="key">Available</span><span class="val val-green">' + fmtBytes(disk.available) + '</span></div>';

  // I/O
  const io = disk.io;
  if (!io || Object.keys(io).length === 0) {
    ioEl.innerHTML = '<div class="none">No I/O data</div>';
    return;
  }
  ioEl.innerHTML = Object.entries(io).map(([dev, d]) =>
    '<div style="margin-bottom:6px">' +
    '<h4>' + dev + '</h4>' +
    '<div class="info-row"><span class="key">Reads</span><span class="val">' + (d.reads || 0).toLocaleString() + ' (' + d.readsPerSec + '/s)</span></div>' +
    '<div class="info-row"><span class="key">Writes</span><span class="val">' + (d.writes || 0).toLocaleString() + ' (' + d.writesPerSec + '/s)</span></div>' +
    '<div class="info-row"><span class="key">Read</span><span class="val">' + fmtSectors(d.sectorsReadPerSec) + '</span></div>' +
    '<div class="info-row"><span class="key">Write</span><span class="val">' + fmtSectors(d.sectorsWrittenPerSec) + '</span></div>' +
    '</div>'
  ).join('');
}

function renderNetwork(net) {
  const el = $('net-rows');
  if (!net || Object.keys(net).length === 0) {
    el.innerHTML = '<div class="none">No network data</div>';
    return;
  }
  el.innerHTML = Object.entries(net).map(([iface, d]) =>
    '<div class="net-block">' +
    '<h4>' + esc(iface) + '</h4>' +
    '<div class="info-row"><span class="key">RX Total</span><span class="val">' + fmtBytes(d.rx_bytes) + '</span></div>' +
    '<div class="info-row"><span class="key">TX Total</span><span class="val">' + fmtBytes(d.tx_bytes) + '</span></div>' +
    '<div class="info-row"><span class="key">RX Rate</span><span class="val val-green">' + fmtBytesRate(d.rx_rate) + '</span></div>' +
    '<div class="info-row"><span class="key">TX Rate</span><span class="val val-yellow">' + fmtBytesRate(d.tx_rate) + '</span></div>' +
    '</div>'
  ).join('');
}

function renderBattery(bat, thermal) {
  const el = $('battery-grid');
  if (!bat || (bat.capacity == null && bat.status == null)) {
    el.innerHTML = '<div class="none">No battery data</div>';
    return;
  }
  // Find battery temp from thermal data
  let temp = null;
  if (thermal) {
    const t = thermal.find(t => t.name === 'battery');
    if (t) temp = t.temp;
  }
  el.innerHTML =
    '<div class="battery-stat"><span class="val">' + (bat.capacity != null ? bat.capacity + '%' : '—') + '</span><span class="label">Capacity</span></div>' +
    '<div class="battery-stat"><span class="val">' + esc(bat.status || '—') + '</span><span class="label">Status</span></div>' +
    '<div class="battery-stat"><span class="val">' + fmtVolt(bat.voltage) + '</span><span class="label">Voltage</span></div>' +
    '<div class="battery-stat"><span class="val">' + fmtCurrent(bat.current) + '</span><span class="label">Current</span></div>' +
    '<div class="battery-stat"><span class="val">' + fmtTemp(temp) + '</span><span class="label">Temp</span></div>';
}

function renderSystem(sys) {
  const el = $('system-rows');
  if (!sys) {
    el.innerHTML = '<div class="none">No data</div>';
    return;
  }
  const items = [
    ['Uptime',    fmtUptime(sys.uptime)],
    ['Hostname',  esc(sys.hostname) || '—'],
    ['IP',        esc(sys.ip)        || '—'],
    ['Kernel',    esc(sys.kernel)    || '—'],
    ['OS',        esc(sys.os)        || '—'],
    ['Arch',      esc(sys.arch)      || '—'],
  ];
  el.innerHTML = items.map(([k, v]) =>
    '<div class="info-row"><span class="key">' + k + '</span><span class="val">' + v + '</span></div>'
  ).join('');
}

// ── Update ──────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateUI(data) {
  if (!data) return;

  // Timestamp & status
  $('last-update').textContent = 'Last: ' + fmtTime(data.timestamp);
  const dot = $('status-dot');
  dot.className = 'status-dot';

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
  renderBattery(data.battery, data.thermal);
  renderSystem(data.system);

  prevData = data;
}

function fetchStatus() {
  fetch('/api/status')
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(data => {
      updateUI(data);
      // Mark dot green, clear stale timer
      $('status-dot').className = 'status-dot';
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        $('status-dot').className = 'status-dot stale';
      }, POLL_MS * 2);
    })
    .catch(err => {
      $('status-dot').className = 'status-dot off';
      $('last-update').textContent = 'Error: ' + err.message;
    });
}

// ── Start ──────────────────────────────────────────────────────────

fetchStatus();
setInterval(fetchStatus, POLL_MS);
