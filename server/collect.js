const { readFile } = require('./utils/helpers');
const { parseMemInfo } = require('./parsers/memory');
const { collectNetwork } = require('./parsers/network');
const { collectDiskIO } = require('./parsers/disk');
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
    netText, diskText, memText,
    diskUse,  battery,  sys, pm2List, torrents,
    services, dnsStats, processes
  ] = await Promise.all([
    readFile('/proc/net/dev'),
    readFile('/proc/diskstats'),
    readFile('/proc/meminfo'),
    collectDiskUsage(),
    collectBattery(),
    collectSystem(),
    collectPM2(),
    collectQBittorrent(),
    collectServices(),
    collectTechnitium(),
    collectProcesses(),
  ]);

  const network = collectNetwork(netText, interval);
  const io = collectDiskIO(diskText, interval);
  prev.time = now;

  const memory = memText ? parseMemInfo(memText) : null;
  const swap = memory
    ? { total: memory.SwapTotal, free: memory.SwapFree }
    : null;

  const connectivity = await collectConnectivity();
  const speedtest = getSpeedtestResults();

  Object.assign(state, {
    timestamp: now,
    pm2: pm2List,
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
