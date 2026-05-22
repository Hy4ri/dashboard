const fs = require('fs');
const { runCmd } = require('../utils/helpers');
const { SPEEDTEST_LOG_FILE, MAX_SPEEDTEST_ENTRIES, SPEEDTEST_CACHE_MS, SPEEDTEST_INTERVAL_MS } = require('../config');
let { speedtestInstalled, speedtestRunning, speedtestCache, speedtestTimer } = require('../state');

function checkSpeedtestInstalled() {
  return new Promise((resolve) => {
    runCmd('which', ['speedtest-cli']).then((out) => {
      speedtestInstalled = out.trim().length > 0;
      resolve(speedtestInstalled);
    }).catch(() => {
      speedtestInstalled = false;
      resolve(false);
    });
  });
}

async function runSpeedtest() {
  if (speedtestRunning || !speedtestInstalled) return;
  speedtestRunning = true;

  const start = Date.now();
  try {
    const out = await runCmd('speedtest-cli', ['--json', '--timeout', '60'], 90000);
    if (!out) throw new Error('No output from speedtest-cli');

    const parsed = JSON.parse(out);
    const entry = {
      timestamp: Date.now(),
      download: typeof parsed.download === 'number' ? Math.round(parsed.download / 1_000_000 * 10) / 10 : null,
      upload:   typeof parsed.upload === 'number'   ? Math.round(parsed.upload / 1_000_000 * 10) / 10 : null,
      ping:     typeof parsed.ping === 'number'     ? Math.round(parsed.ping * 10) / 10 : null,
    };

    // Read existing log, append, trim, write back
    let entries = [];
    try {
      const raw = fs.readFileSync(SPEEDTEST_LOG_FILE, 'utf8');
      entries = JSON.parse(raw);
      if (!Array.isArray(entries)) entries = [];
    } catch (_) {
      entries = [];
    }
    entries.push(entry);
    if (entries.length > MAX_SPEEDTEST_ENTRIES) {
      entries = entries.slice(-MAX_SPEEDTEST_ENTRIES);
    }
    fs.writeFileSync(SPEEDTEST_LOG_FILE, JSON.stringify(entries, null, 2));

    // Invalidate cache
    speedtestCache = { value: null, time: 0 };
    console.log('Speedtest complete: download=' + entry.download + ' Mbps, upload=' + entry.upload + ' Mbps, ping=' + entry.ping + ' ms');

    return entry;
  } catch (err) {
    console.warn('Speedtest failed:', err.message);
    return { error: err.message };
  } finally {
    speedtestRunning = false;
  }
}

function getSpeedtestResults() {
  const now = Date.now();
  if (speedtestCache.value && (now - speedtestCache.time) < SPEEDTEST_CACHE_MS) {
    return speedtestCache.value;
  }

  let results = [];
  try {
    const raw = fs.readFileSync(SPEEDTEST_LOG_FILE, 'utf8');
    results = JSON.parse(raw);
    if (!Array.isArray(results)) results = [];
  } catch (_) {
    results = [];
  }

  const last5 = results.slice(-5);

  const data = {
    installed: speedtestInstalled,
    running: speedtestRunning,
    results: last5,
    lastTestTime: last5.length > 0 ? last5[last5.length - 1].timestamp : null,
  };
  speedtestCache = { value: data, time: now };
  return data;
}

function startSpeedtestTimer() {
  if (speedtestTimer) return;
  speedtestTimer = setInterval(() => {
    runSpeedtest();
  }, SPEEDTEST_INTERVAL_MS);
}

module.exports = { checkSpeedtestInstalled, runSpeedtest, getSpeedtestResults, startSpeedtestTimer };
