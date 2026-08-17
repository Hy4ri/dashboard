import { readFile } from './utils/helpers';
import { parseMemInfo } from './parsers/memory';
import { collectCPU } from './parsers/cpu';
import { collectNetwork } from './parsers/network';
import { collectDiskIO } from './parsers/disk';
import { collectThermal } from './collectors/thermal';
import { collectFreq } from './collectors/frequency';
import { collectDiskUsage } from './collectors/disk-usage';
import { collectBattery } from './collectors/battery';
import { collectSystem } from './collectors/system';
import { collectPM2 } from './collectors/pm2';
import { collectQBittorrent } from './collectors/qbittorrent';
import { collectConnectivity } from './collectors/connectivity';
import { collectServices } from './collectors/services';
import { collectTechnitium } from './collectors/technitium';
import { AUTH_PASS } from './config';
import { state, prev } from './state';

export async function collect(): Promise<void> {
  const now = Date.now();
  const interval = (now - prev.time) / 1000;

  const [
    cpuText, netText, diskText, loadText, memText,
    thermal, freq, diskUse, battery, sys, pm2List, torrents,
    services, dnsStats
  ] = await Promise.all([
    readFile('/proc/stat'),
    readFile('/proc/net/dev'),
    readFile('/proc/diskstats'),
    readFile('/proc/loadavg'),
    readFile('/proc/meminfo'),
    collectThermal(),
    collectFreq(),
    collectDiskUsage(),
    collectBattery(),
    collectSystem(),
    collectPM2(),
    collectQBittorrent(),
    collectServices(),
    collectTechnitium(),
  ]);

  const { cpuOverall, cpuCores } = collectCPU(cpuText, interval);
  const network = collectNetwork(netText, interval);
  const io = collectDiskIO(diskText, interval);
  prev.time = now;

  let loadavg: [number, number, number] | null = null;
  if (loadText) {
    const parts = loadText.split(' ');
    const nums = parts.slice(0, 3).map(Number);
    if (nums.length === 3) {
      loadavg = [nums[0], nums[1], nums[2]];
    }
  }

  const memory = memText ? parseMemInfo(memText) : null;
  const swap = memory
    ? { total: memory.SwapTotal || 0, free: memory.SwapFree || 0 }
    : null;

  const connectivity = await collectConnectivity();

  Object.assign(state, {
    timestamp: now,
    pm2: pm2List,
    cpu: cpuOverall,
    cpuCores,
    thermal,
    frequency: freq,
    loadavg,
    memory,
    swap,
    disk: { ...diskUse, io },
    network,
    internet: connectivity.internet,
    dns: connectivity.dns,
    battery,
    system: sys,
    torrents,
    services,
    dnsStats,
    authEnabled: !!AUTH_PASS,
  });
}
