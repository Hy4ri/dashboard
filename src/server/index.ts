import stateModule from './state';
import { PORT } from './config';
import { createServer } from './server';
import { collect } from './collect';
import { initStaticSystem } from './collectors/system';
import { initThermalPaths } from './collectors/thermal';
import { initCpuStaticInfo } from './collectors/frequency';
import { loadQBConfig, validateQBConfig } from './collectors/qbittorrent';

export async function startup(): Promise<void> {
  // Load qBittorrent config
  loadQBConfig();
  validateQBConfig();

  // Initialize all static caches
  await Promise.all([
    initStaticSystem(),
    initThermalPaths(),
    initCpuStaticInfo(),
  ]);

  // Perform initial collection then wait for first request
  await collect();
  console.log('Initial collection done, idle until first request');

  const server = createServer();
  stateModule.server = server;

  server.listen(PORT, () => {
    console.log(`Dashboard → http://localhost:${PORT}`);
    // Don't start polling yet – wait for first API request
  });
}

export function shutdown(signal: string) {
  return () => {
    console.log(`Received ${signal}, shutting down...`);
    if (stateModule.pollTimer) clearInterval(stateModule.pollTimer);
    stateModule.pollTimer = null;
    if (stateModule.server) {
      stateModule.server.close(() => process.exit(0));
    }
    // Force exit after 5 seconds
    setTimeout(() => process.exit(1), 5000);
  };
}

if (require.main === module) {
  startup().then(() => {
    process.on('SIGTERM', shutdown('SIGTERM'));
    process.on('SIGINT', shutdown('SIGINT'));
  });

  process.on('uncaughtException', (err: Error) => {
    console.error('Uncaught:', err.stack || err.message);
    process.exit(1);
  });
  process.on('unhandledRejection', (err: any) => {
    console.error('Unhandled:', err?.stack || err?.message || err);
  });
}
