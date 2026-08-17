import { fmtBytes, NONE } from '../utils/format.js';
import { $, setText, updateBar, barClass } from '../utils/dom.js';
import { DiskData } from '../../shared/types.js';

export function renderDisk(disk?: DiskData | null): void {
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
  const used = disk.used || 0;
  const total = disk.total;
  const pct = total > 0 ? used / total : 0;
  const fill = $('disk-bar-fill');
  if (fill) {
    fill.className = 'bar-fill disk' + barClass(pct, 0.7, 0.85);
  }
  updateBar('disk-bar-fill', pct, (pct * 100).toFixed(1) + '%');
  setText('disk-used-label', fmtBytes(used) + ' / ' + fmtBytes(total));
  setText('disk-total', fmtBytes(total));
  setText('disk-used', fmtBytes(used));
  setText('disk-avail', fmtBytes(disk.available));
}
