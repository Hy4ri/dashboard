const stateModule = require('./state');
const { PORT } = require('./config');
const { createServer } = require('./server');
const { collect } = require('./collect');
const { initStaticSystem } = require('./collectors/system');
const { loadQBConfig, validateQBConfig } = require('./collectors/qbittorrent');
const { checkSpeedtestInstalled, startSpeedtestTimer, runSpeedtest } = require('./collectors/speedtest');

async function startup() {
  // Load qBittorrent config
  loadQBConfig();
  validateQBConfig();

  // Initialize all static caches
  await Promise.all([
    initStaticSystem(),
  ]);

  // Perform initial collection then wait for first request
  await collect();
  console.log('Initial collection done, idle until first request');

  const server = createServer();
  stateModule.server = server;

  server.listen(PORT, () => {
    console.log(`Dashboard → http://localhost:${PORT}`);
    // Don't start polling yet – wait for first API request
    checkSpeedtestInstalled().then(() => {
      startSpeedtestTimer();
      // Run first test after 10 seconds
      setTimeout(() => runSpeedtest(), 10000);
    });
  });
}

function shutdown(signal) {
  return () => {
    console.log(`Received ${signal}, shutting down...`);
    if (stateModule.pollTimer) clearInterval(stateModule.pollTimer);
    stateModule.pollTimer = null;
    if (stateModule.speedtestTimer) clearInterval(stateModule.speedtestTimer);
    if (stateModule.server) {
      stateModule.server.close(() => process.exit(0));
    }
    // Force exit after 5 seconds
    setTimeout(() => process.exit(1), 5000);
  };
}

startup().then(() => {
  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
});

process.on('uncaughtException', err => {
  console.error('Uncaught:', err.stack || err.message);
  process.exit(1);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled:', err.stack || err.message);
});
