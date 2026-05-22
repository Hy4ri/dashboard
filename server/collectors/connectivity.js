const http = require('http');
const dns = require('dns');
const { CONNECTIVITY_CACHE_MS } = require('../config');
let { connectivityCache } = require('../state');

function checkInternet() {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.get('http://1.1.1.1', { timeout: 3000 }, (res) => {
      // Any response means internet is reachable
      res.resume(); // consume response data to free up memory
      res.on('end', () => resolve({ ok: true, latency: Date.now() - start }));
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}

function checkDNS() {
  return new Promise((resolve) => {
    const resolver = new dns.Resolver();
    resolver.setServers(['127.0.0.1']);
    const start = Date.now();
    resolver.resolve4('google.com', (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        resolve({ ok: false, error: err ? (err.code || err.message) : 'No addresses' });
      } else {
        resolve({ ok: true, latency: Date.now() - start });
      }
    });
    // Safety timeout
    setTimeout(() => resolve({ ok: false, error: 'Timeout' }), 5000);
  });
}

async function collectConnectivity() {
  const now = Date.now();
  if (connectivityCache.value && (now - connectivityCache.time) < CONNECTIVITY_CACHE_MS) {
    return connectivityCache.value;
  }

  const [internet, dnsStatus] = await Promise.all([
    checkInternet(),
    checkDNS(),
  ]);

  const result = { internet, dns: dnsStatus };
  connectivityCache = { value: result, time: now };
  return result;
}

module.exports = { checkInternet, checkDNS, collectConnectivity };
