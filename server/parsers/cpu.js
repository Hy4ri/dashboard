const { prev } = require('../state');

function parseProcStat(text) {
  const result = { overall: null, cores: {} };
  for (const line of text.split('\n')) {
    if (!line.startsWith('cpu')) continue;
    const parts = line.trim().split(/\s+/);
    const name = parts[0];
    const nums = parts.slice(1).map(Number);
    if (nums.length < 4) continue;
    const total = nums.reduce((a, b) => a + b, 0);
    const idle = nums[3] + (nums[4] ?? 0);   // idle + iowait
    if (name === 'cpu') result.overall = { total, idle };
    else result.cores[name] = { total, idle };
  }
  return result;
}

function computePct(prev, curr) {
  if (!prev || !curr) return null;
  const dT = curr.total - prev.total;
  const dI = curr.idle - prev.idle;
  return dT === 0 ? 0 : Math.round(((dT - dI) / dT) * 1000) / 10;
}

function collectCPU(cpuText, interval) {
  const cpuData = cpuText ? parseProcStat(cpuText) : null;
  let cpuOverall = null;
  const cpuCores = [];
  if (cpuData && prev.cpu) {
    cpuOverall = computePct(prev.cpu.overall, cpuData.overall);
    for (const [name, cd] of Object.entries(cpuData.cores)) {
      const p = prev.cpu.cores[name];
      cpuCores.push(p ? computePct(p, cd) : null);
    }
  }
  prev.cpu = cpuData;
  return { cpuOverall, cpuCores };
}

module.exports = { parseProcStat, computePct, collectCPU };
