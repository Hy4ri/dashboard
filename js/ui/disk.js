import { fmtBytes, fmtSectors, NONE } from '../utils/format.js';
import { $, setText, setTextOf, updateBar, barClass } from '../utils/dom.js';

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

export { renderDisk };
