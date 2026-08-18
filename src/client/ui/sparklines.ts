import { $ } from '../utils/dom.js';
import { DashboardState } from '../../shared/types.js';

const HISTORY_LIMIT = 30;

interface MetricHistory {
  cpu: number[];
  mem: number[];
  rx: number[];
  tx: number[];
  ping: number[];
}

const history: MetricHistory = {
  cpu: [],
  mem: [],
  rx: [],
  tx: [],
  ping: [],
};

function pushHistory(key: keyof MetricHistory, val: number): void {
  history[key].push(val);
  if (history[key].length > HISTORY_LIMIT) {
    history[key].shift();
  }
}

function generatePath(data: number[], maxVal: number | 'auto' = 100): string {
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

function generateAreaPath(data: number[], maxVal: number | 'auto' = 100): string {
  if (data.length < 2) return '';
  const width = 120;
  const height = 24;
  const max = maxVal === 'auto' ? Math.max(...data, 1) : maxVal;

  const points = data.map((val, idx) => {
    const x = idx * (width / (HISTORY_LIMIT - 1));
    const y = height - ((val / max) * (height - 6)) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const lastX = ((data.length - 1) * (width / (HISTORY_LIMIT - 1))).toFixed(1);
  return `M ${points.join(' L ')} L ${lastX},${height} L 0,${height} Z`;
}

function updateSparkline(
  id: string,
  data: number[],
  maxVal: number | 'auto',
  color: string,
  parentSelector: string,
  labelText: string
): void {
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
        <path class="sparkline-area" fill="${color}" fill-opacity="0.15" />
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
  const area = wrapper.querySelector('.sparkline-area');
  if (area) {
    area.setAttribute('d', generateAreaPath(data, maxVal));
  }
}

export function renderSparklines(data?: DashboardState | null): void {
  if (!data) return;

  // 1. Push current metrics into history
  if (data.cpu !== undefined && data.cpu !== null) {
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

  if (data.internet && data.internet.latency !== undefined) {
    pushHistory('ping', data.internet.latency);
  }

  // 2. Render CPU Sparkline
  updateSparkline(
    'cpu-sparkline',
    history.cpu,
    100,
    '#CC3333',
    '#cpu-sparkline-container',
    '30s Load'
  );

  // 3. Render Memory Sparkline
  updateSparkline(
    'mem-sparkline',
    history.mem,
    100,
    '#CC3333',
    '#mem-sparkline-container',
    '30s RAM'
  );

  // 4. Create Network Sparkline container in card if not exists
  let netWrapper = $('net-sparklines-row');
  if (!netWrapper) {
    const connectivity = $('net-connectivity');
    if (connectivity) {
      netWrapper = document.createElement('div');
      netWrapper.id = 'net-sparklines-row';
      netWrapper.className = 'net-sparklines-row';
      connectivity.after(netWrapper);
    }
  }

  if (netWrapper) {
    // Render RX (Download) Sparkline
    updateSparkline(
      'rx-sparkline',
      history.rx,
      'auto',
      '#4CAF50',
      '#net-sparklines-row',
      'Download'
    );

    // Render TX (Upload) Sparkline
    updateSparkline(
      'tx-sparkline',
      history.tx,
      'auto',
      '#FFB74D',
      '#net-sparklines-row',
      'Upload'
    );

    // Render Ping (Latency) Sparkline
    if (history.ping.length > 0) {
      updateSparkline(
        'ping-sparkline',
        history.ping,
        'auto',
        '#64B5F6',
        '#net-sparklines-row',
        'Ping (ms)'
      );
    }
  }
}
