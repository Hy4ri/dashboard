const { readDir, readFile } = require('../utils/helpers');
const { FREQ_CACHE_MS } = require('../config');
let { cpuStaticInfo, freqCache } = require('../state');

async function initCpuStaticInfo() {
  const dirs = await readDir('/sys/devices/system/cpu');
  const result = [];
  await Promise.all(dirs.map(async d => {
    const m = d.match(/^cpu(\d+)$/);
    if (!m) return;
    const core = parseInt(m[1], 10);
    const base = `/sys/devices/system/cpu/${d}/cpufreq`;
    const [min, max, gov] = await Promise.all([
      readFile(`${base}/scaling_min_freq`),
      readFile(`${base}/scaling_max_freq`),
      readFile(`${base}/scaling_governor`),
    ]);
    result.push({
      core,
      min:  min ? Math.round(parseInt(min.trim(), 10) / 1000) : null,
      max:  max ? Math.round(parseInt(max.trim(), 10) / 1000) : null,
      governor: gov ? gov.trim() : null,
    });
  }));
  result.sort((a, b) => a.core - b.core);
  cpuStaticInfo = result;
}

async function collectFreq() {
  const now = Date.now();
  if (freqCache.value && (now - freqCache.time) < FREQ_CACHE_MS) {
    return freqCache.value;
  }
  // cpuStaticInfo was populated once at startup – only read current freq
  const result = [];
  await Promise.all(cpuStaticInfo.map(async info => {
    const base = `/sys/devices/system/cpu/cpu${info.core}/cpufreq`;
    const cur = await readFile(`${base}/scaling_cur_freq`);
    result.push({
      core:     info.core,
      current:  cur ? Math.round(parseInt(cur.trim(), 10) / 1000) : null,
      min:      info.min,
      max:      info.max,
      governor: info.governor,
    });
  }));
  freqCache = { value: result, time: now };
  return result;
}

module.exports = { initCpuStaticInfo, collectFreq };
