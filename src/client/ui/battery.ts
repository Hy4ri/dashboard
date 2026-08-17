import { $ } from '../utils/dom.js';
import { BatteryData } from '../../shared/types.js';

export function renderBattery(bat?: BatteryData | null): void {
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
