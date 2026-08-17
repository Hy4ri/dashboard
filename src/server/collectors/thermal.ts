import { readDir, readFile } from '../utils/helpers';
import { THERMAL_CACHE_MS } from '../config';
import stateModule, { ThermalPathItem } from '../state';
import { ThermalSensor } from '../../shared/types';

export async function initThermalPaths(): Promise<void> {
  const wanted = new Set([
    'cpu-1-6-step', 'battery', 'gpuss-0-step', 'ddr-usr',
    'modem-lte-sub6-pa1', 'pmr735a_tz',
  ]);
  const zones = await readDir('/sys/class/thermal');
  const result: ThermalPathItem[] = [];
  // Use Promise.all for speed
  await Promise.all(zones.map(async z => {
    if (!z.startsWith('thermal_zone')) return;
    const type = (await readFile(`/sys/class/thermal/${z}/type`))?.trim();
    if (!type || !wanted.has(type)) return;
    result.push({ name: type, path: `/sys/class/thermal/${z}/temp` });
  }));
  stateModule.thermalPaths = result;
}

export async function collectThermal(): Promise<ThermalSensor[]> {
  const now = Date.now();
  if (stateModule.thermalCache.value && (now - stateModule.thermalCache.time) < THERMAL_CACHE_MS) {
    return stateModule.thermalCache.value;
  }
  // thermalPaths was populated once at startup – just read the temp files
  const result: ThermalSensor[] = [];
  await Promise.all(stateModule.thermalPaths.map(async tp => {
    const raw = await readFile(tp.path);
    if (raw) result.push({ name: tp.name, temp: parseInt(raw.trim(), 10) / 1000 });
  }));
  stateModule.thermalCache = { value: result, time: now };
  return result;
}
