import { readDir, readFile } from '../utils/helpers';
import { FREQ_CACHE_MS } from '../config';
import stateModule, { CpuStaticInfoItem } from '../state';
import { CpuFrequency } from '../../shared/types';

export async function initCpuStaticInfo(): Promise<void> {
  const dirs = await readDir('/sys/devices/system/cpu');
  const result: CpuStaticInfoItem[] = [];
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
      min: min ? Math.round(parseInt(min.trim(), 10) / 1000) : null,
      max: max ? Math.round(parseInt(max.trim(), 10) / 1000) : null,
      governor: gov ? gov.trim() : null,
    });
  }));
  result.sort((a, b) => a.core - b.core);
  stateModule.cpuStaticInfo = result;
}

export async function collectFreq(): Promise<CpuFrequency[]> {
  const now = Date.now();
  if (stateModule.freqCache.value && (now - stateModule.freqCache.time) < FREQ_CACHE_MS) {
    return stateModule.freqCache.value;
  }
  // cpuStaticInfo was populated once at startup – only read current freq
  const result: CpuFrequency[] = [];
  await Promise.all(stateModule.cpuStaticInfo.map(async info => {
    const base = `/sys/devices/system/cpu/cpu${info.core}/cpufreq`;
    const cur = await readFile(`${base}/scaling_cur_freq`);
    result.push({
      core: info.core,
      current: cur ? Math.round(parseInt(cur.trim(), 10) / 1000) : null,
      min: info.min,
      max: info.max,
      governor: info.governor,
    });
  }));
  stateModule.freqCache = { value: result, time: now };
  return result;
}
