import { $ } from '../utils/dom.js';
import { DashboardState } from '../../shared/types.js';
import { POLL_MS } from '../config.js';
import { fmtBytesRate } from '../utils/format.js';

const HISTORY_LIMIT = 30;

interface MetricHistory {
  cpu: number[];
  rx: number[];
  tx: number[];
}

const history: MetricHistory = {
  cpu: [],
  rx: [],
  tx: [],
};

function pushHistory(key: keyof MetricHistory, val: number): void {
  history[key].push(val);
  if (history[key].length > HISTORY_LIMIT) {
    history[key].shift();
  }
}

const WIDTH = 120;
const HEIGHT = 24;

function scale(data: number[], maxVal: number | 'auto'): { points: string[]; max: number } {
  const max = maxVal === 'auto' ? Math.max(...data, 1) : maxVal;
  // Points spread across the full width for however many samples exist, so a
  // short history is not a stub on the left edge.
  const step = data.length > 1 ? WIDTH / (data.length - 1) : 0;
  const points = data.map((val, idx) => {
    const x = idx * step;
    const y = HEIGHT - ((val / max) * (HEIGHT - 6)) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return { points, max };
}

function generatePath(data: number[], maxVal: number | 'auto' = 100): string {
  if (data.length < 2) return '';
  return `M ${scale(data, maxVal).points.join(' L ')}`;
}

function generateAreaPath(data: number[], maxVal: number | 'auto' = 100): string {
  if (data.length < 2) return '';
  return `M ${scale(data, maxVal).points.join(' L ')} L ${WIDTH},${HEIGHT} L 0,${HEIGHT} Z`;
}

interface SparkOptions {
  id: string;
  data: number[];
  maxVal: number | 'auto';
  colorClass: string;
  parentSelector: string;
  label: string;
  format: (v: number) => string;
  scaleNote: string;
}

function updateSparkline(o: SparkOptions): void {
  let wrapper = $(o.id);

  if (!wrapper) {
    const parent = document.querySelector(o.parentSelector);
    if (!parent) return;

    wrapper = document.createElement('div');
    wrapper.id = o.id;
    wrapper.className = 'sparkline-wrapper ' + o.colorClass;
    wrapper.innerHTML = `
      <div class="sparkline-head">
        <span class="sparkline-label">${o.label}</span>
        <span class="sparkline-val"></span>
      </div>
      <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" class="sparkline-svg" role="img" aria-label="${o.label} history">
        <path class="sparkline-area" fill="currentColor" fill-opacity="0.15" />
        <path class="sparkline-path" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div class="sparkline-foot"><span class="sparkline-note"></span></div>
    `;
    // Append in call order, so Download always comes before Upload.
    parent.appendChild(wrapper);
  }

  const path = wrapper.querySelector('.sparkline-path');
  if (path) path.setAttribute('d', generatePath(o.data, o.maxVal));
  const area = wrapper.querySelector('.sparkline-area');
  if (area) area.setAttribute('d', generateAreaPath(o.data, o.maxVal));

  const last = o.data.length > 0 ? o.data[o.data.length - 1] : null;
  const valEl = wrapper.querySelector('.sparkline-val');
  if (valEl) valEl.textContent = last == null ? '' : o.format(last);
  const noteEl = wrapper.querySelector('.sparkline-note');
  if (noteEl) {
    noteEl.textContent = o.data.length < 2
      ? ''
      : o.maxVal === 'auto'
        ? 'peak ' + o.format(Math.max(...o.data))
        : o.scaleNote;
  }
}

// renderSparklines draws the rolling history. Only the WebSocket tick adds a
// point: a manual refresh repeats the same interval, so it must not skew the
// time axis.
export function renderSparklines(data?: DashboardState | null, fromTick = false): void {
  if (!data) return;

  if (fromTick) {
    if (data.cpu !== undefined && data.cpu !== null) {
      pushHistory('cpu', data.cpu);
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
  }

  const windowLabel = Math.round((HISTORY_LIMIT * POLL_MS) / 1000) + 's';

  updateSparkline({
    id: 'cpu-sparkline',
    data: history.cpu,
    maxVal: 100,
    colorClass: 'spark-cpu',
    parentSelector: '#cpu-sparkline-container',
    label: 'CPU, last ' + windowLabel,
    format: (v) => v.toFixed(0) + '%',
    scaleNote: 'scale 0-100%',
  });

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
    updateSparkline({
      id: 'rx-sparkline',
      data: history.rx,
      maxVal: 'auto',
      colorClass: 'spark-rx',
      parentSelector: '#net-sparklines-row',
      label: 'Download',
      format: fmtBytesRate,
      scaleNote: '',
    });
    updateSparkline({
      id: 'tx-sparkline',
      data: history.tx,
      maxVal: 'auto',
      colorClass: 'spark-tx',
      parentSelector: '#net-sparklines-row',
      label: 'Upload',
      format: fmtBytesRate,
      scaleNote: '',
    });
  }
}
