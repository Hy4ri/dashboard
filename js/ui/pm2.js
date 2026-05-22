import { fmtBytes, fmtUptime, NONE } from '../utils/format.js';
import { $, esc, setTextOf, setTextOfLast } from '../utils/dom.js';

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

export { renderPM2 };
