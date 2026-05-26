import { $ } from '../utils/dom.js';

const HISTORY_LIMIT = 30;
const history = {
  cpu: [],
  mem: [],
  rx: [],
  tx: []
};

function pushHistory(key, val) {
  history[key].push(val);
  if (history[key].length > HISTORY_LIMIT) {
    history[key].shift();
  }
}

function generatePath(data, maxVal = 100) {
  if (data.length < 2) return '';
  const width = 120;
  const height = 24;
  
  // Auto-scale or use absolute max
  const max = maxVal === 'auto' ? Math.max(...data, 1) : maxVal;
  
  const points = data.map((val, idx) => {
    // Distribute points horizontally across 120px
    const x = idx * (width / (HISTORY_LIMIT - 1));
    // Scale vertically (y goes 0..24, with padding)
    const y = height - ((val / max) * (height - 6)) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  
  return `M ${points.join(' L ')}`;
}

function updateSparkline(id, data, maxVal, color, parentSelector, labelText) {
  let wrapper = $(id);
  
  if (!wrapper) {
    const parent = document.querySelector(parentSelector);
    if (!parent) return;

    wrapper = document.createElement('div');
    wrapper.id = id;
    wrapper.className = 'sparkline-wrapper';
    wrapper.innerHTML = `
      ${labelText ? `<span class="sparkline-label">${labelText}</span>` : ''}
      <svg width="120" height="24" viewBox="0 0 120 24" class="sparkline-svg">
        <path class="sparkline-path" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
    
    // Insert into parent before the percentage/value element (the last child)
    if (parent.children.length > 0) {
      parent.insertBefore(wrapper, parent.lastElementChild);
    } else {
      parent.appendChild(wrapper);
    }
  }

  const path = wrapper.querySelector('.sparkline-path');
  if (path) {
    path.setAttribute('d', generatePath(data, maxVal));
  }
}

export function renderSparklines(data) {
  if (!data) return;

  // 1. Push current metrics into history
  if (data.cpu !== undefined) {
    pushHistory('cpu', data.cpu);
  }
  if (data.memory && data.memory.used_pct !== undefined) {
    pushHistory('mem', data.memory.used_pct);
  }

  let totalRx = 0;
  let totalTx = 0;
  if (data.network) {
    Object.values(data.network).forEach(iface => {
      totalRx += iface.rx_rate || 0;
      totalTx += iface.tx_rate || 0;
    });
  }
  pushHistory('rx', totalRx);
  pushHistory('tx', totalTx);

  // 2. Render CPU Sparkline
  updateSparkline(
    'cpu-sparkline', 
    history.cpu, 
    100, 
    'var(--primary-color, #ff3333)', 
    '#cpu-overall .bar-label',
    ''
  );

  // 3. Render Memory Sparkline
  updateSparkline(
    'mem-sparkline', 
    history.mem, 
    100, 
    'var(--accent-color, #33ccff)', 
    '#mem-bar .bar-label',
    ''
  );

  // 4. Create Network Sparkline container in card if not exists
  let netWrapper = $('net-sparklines-row');
  if (!netWrapper) {
    const netCard = $('net-card');
    const netRows = $('net-rows');
    if (netCard && netRows) {
      netWrapper = document.createElement('div');
      netWrapper.id = 'net-sparklines-row';
      netWrapper.className = 'net-sparklines-row';
      netCard.insertBefore(netWrapper, netRows);
    }
  }

  if (netWrapper) {
    // Render RX (Download) Sparkline
    updateSparkline(
      'rx-sparkline',
      history.rx,
      'auto',
      '#22c55e', // Green
      '#net-sparklines-row',
      'Download'
    );

    // Render TX (Upload) Sparkline
    updateSparkline(
      'tx-sparkline',
      history.tx,
      'auto',
      '#eab308', // Yellow
      '#net-sparklines-row',
      'Upload'
    );
  }
}
