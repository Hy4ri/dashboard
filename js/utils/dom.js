/* ── DOM helpers ──────────────────────────────────────────────────── */

import { NONE } from './format.js';

export const $ = id => document.getElementById(id);
export const esc = s => s == null ? '' : String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Update textContent of an element, given its id
export function setText(id, val) {
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
export function updateBar(id, pct, valText) {
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

export function barClass(pct, warn, crit) {
  if (pct > crit) return ' critical';
  if (pct > warn) return ' high';
  return '';
}

// Set textContent of an element
export function setTextOf(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

// Set textContent of last text node / child
export function setTextOfLast(el, text) {
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
