import net from 'net';
import dns from 'dns';
import { CONNECTIVITY_CACHE_MS } from '../config';
import stateModule from '../state';
import { ConnectivityStatus } from '../../shared/types';

export function checkInternet(): Promise<ConnectivityStatus> {
  return new Promise((resolve) => {
    const start = Date.now();
    // Connect directly to 8.8.8.8 (Google Public DNS) on port 53 (DNS TCP)
    // This tests raw IP routing completely bypassing local and system DNS.
    const socket = net.createConnection({
      host: '8.8.8.8',
      port: 53,
      timeout: 2000,
    });

    socket.on('connect', () => {
      const latency = Date.now() - start;
      socket.end();
      resolve({ ok: true, latency });
    });

    socket.on('error', () => {
      resolve({ ok: false });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false });
    });
  });
}

export function checkDNS(): Promise<ConnectivityStatus> {
  return new Promise((resolve) => {
    const resolver = new dns.Resolver();
    resolver.setServers(['127.0.0.1']);
    const start = Date.now();

    let finished = false;

    // Safety timeout
    const timeoutId = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve({ ok: false, error: 'Timeout' });
      }
    }, 4000);

    // Resolves google.com (universally supported/cached) using the local Technitium DNS server
    resolver.resolve4('google.com', (err: any, addresses?: string[]) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);

      if (err || !addresses || addresses.length === 0) {
        resolve({ ok: false, error: err ? (err.code || err.message) : 'No addresses' });
      } else {
        resolve({ ok: true, latency: Date.now() - start });
      }
    });
  });
}

export async function collectConnectivity(): Promise<{ internet: ConnectivityStatus; dns: ConnectivityStatus }> {
  const now = Date.now();
  if (stateModule.connectivityCache.value && (now - stateModule.connectivityCache.time) < CONNECTIVITY_CACHE_MS) {
    return stateModule.connectivityCache.value;
  }

  const [internet, dnsStatus] = await Promise.all([
    checkInternet(),
    checkDNS(),
  ]);

  const result = { internet, dns: dnsStatus };
  stateModule.connectivityCache = { value: result, time: now };
  return result;
}
