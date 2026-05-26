import { fmtBytes, NONE } from '../utils/format.js';
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
}

export { renderDisk };
