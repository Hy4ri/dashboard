const { readDir, readFile } = require('../utils/helpers');
const { THERMAL_CACHE_MS } = require('../config');
let { thermalPaths, thermalCache } = require('../state');

async function initThermalPaths() {
  const wanted = new Set([
    'cpu-1-6-step', 'battery', 'gpuss-0-step', 'ddr-usr',
    'modem-lte-sub6-pa1', 'pmr735a_tz',
  ]);
  const zones = await readDir('/sys/class/thermal');
  const result = [];
  // Use Promise.all for speed
  await Promise.all(zones.map(async z => {
    if (!z.startsWith('thermal_zone')) return;
    const type = (await readFile(`/sys/class/thermal/${z}/type`))?.trim();
    if (!type || !wanted.has(type)) return;
    result.push({ name: type, path: `/sys/class/thermal/${z}/temp` });
  }));
  thermalPaths = result;
}

async function collectThermal() {
  const now = Date.now();
  if (thermalCache.value && (now - thermalCache.time) < THERMAL_CACHE_MS) {
    return thermalCache.value;
  }
  // thermalPaths was populated once at startup – just read the temp files
  const result = [];
  await Promise.all(thermalPaths.map(async tp => {
    const raw = await readFile(tp.path);
    if (raw) result.push({ name: tp.name, temp: parseInt(raw.trim(), 10) / 1000 });
  }));
  thermalCache = { value: result, time: now };
  return result;
}

module.exports = { initThermalPaths, collectThermal };
