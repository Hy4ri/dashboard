const { readFile } = require('./utils/helpers');
const { parseMemInfo } = require('./parsers/memory');
const { collectCPU } = require('./parsers/cpu');
const { collectNetwork } = require('./parsers/network');
const { collectDiskIO } = require('./parsers/disk');
const { collectThermal } = require('./collectors/thermal');
const { collectFreq } = require('./collectors/frequency');
const { collectDiskUsage } = require('./collectors/disk-usage');
const { collectBattery } = require('./collectors/battery');
const { collectSystem } = require('./collectors/system');
const { collectPM2 } = require('./collectors/pm2');
const { collectQBittorrent } = require('./collectors/qbittorrent');
const { collectConnectivity } = require('./collectors/connectivity');
const { getSpeedtestResults } = require('./collectors/speedtest');
const { collectServices } = require('./collectors/services');
const { collectTechnitium } = require('./collectors/technitium');
const { collectProcesses } = require('./collectors/processes');
const { state, prev } = require('./state');

async function collect() {
  const now = Date.now();
  const interval = (now - prev.time) / 1000;

  const [
    cpuText, netText, diskText, loadText, memText,
    thermal,  freq,    diskUse,  battery,  sys, pm2List, torrents,
    services, dnsStats, processes
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
    collectProcesses(),
  ]);

  const { cpuOverall, cpuCores } = collectCPU(cpuText, interval);
  const network = collectNetwork(netText, interval);
  const io = collectDiskIO(diskText, interval);
  prev.time = now;

  let loadavg = null;
  if (loadText) {
    const parts = loadText.split(' ');
    loadavg = parts.slice(0, 3).map(Number);
  }

  const memory = memText ? parseMemInfo(memText) : null;
  const swap = memory
    ? { total: memory.SwapTotal, free: memory.SwapFree }
    : null;

  const connectivity = await collectConnectivity();
  const speedtest = getSpeedtestResults();

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
    disk: { ...(diskUse || {}), io },
    network,
    internet: connectivity.internet,
    dns: connectivity.dns,
    battery,
    system: sys,
    torrents,
    speedtest,
    services,
    dnsStats,
    processes,
    authEnabled: !!require('./config').AUTH_PASS,
  });
}

module.exports = { collect };
