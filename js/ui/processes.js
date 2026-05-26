import { $, esc } from '../utils/dom.js';

function renderProcesses(data) {
  const container = $('processes-grid');
  if (!container) return;

  if (!data || (!data.topCpu && !data.topMem)) {
    container.innerHTML = '<div class="none">No process data available</div>';
    return;
  }

  const renderTable = (title, list, metricKey, unit) => {
    if (!list || list.length === 0) {
      return `<div class="proc-table-wrap"><h3>${title}</h3><div class="none">No data</div></div>`;
    }

    return `
      <div class="proc-table-wrap">
        <h3>${title}</h3>
        <table>
          <thead>
            <tr>
              <th style="width: 60px">PID</th>
              <th>Process</th>
              <th style="text-align: right; width: 80px">${metricKey === 'cpu' ? 'CPU' : 'Memory'}</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(p => {
              const val = metricKey === 'cpu' ? p.cpu.toFixed(1) : p.mem.toFixed(1);
              return `
                <tr>
                  <td><code>${p.pid}</code></td>
                  <td><strong class="proc-name-cell" title="${esc(p.name)}">${esc(p.name)}</strong></td>
                  <td style="text-align: right" class="${metricKey === 'cpu' ? 'val-red' : 'val-blue'}">${val}${unit}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  container.innerHTML = `
    ${renderTable('Top CPU Processes', data.topCpu, 'cpu', '%')}
    ${renderTable('Top Memory Processes', data.topMem, 'mem', '%')}
  `;
}

export { renderProcesses };
