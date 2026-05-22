import { fmtBytes, NONE } from '../utils/format.js';
import { $, setText, updateBar, barClass } from '../utils/dom.js';

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

export { renderMemory, renderSwap };
