const http = require('http');
const { QB_CACHE_MS } = require('../config');
let { qbCookie, QB_HOST, QB_PORT, QB_USER, QB_PASS, qbCache } = require('../state');

// Load qBittorrent config from environment variables
function loadQBConfig() {
  QB_HOST = process.env.QB_HOST || 'localhost';
  QB_PORT = parseInt(process.env.QB_PORT, 10) || 7777;
  QB_USER = process.env.QB_USER || 'admin';
  QB_PASS = process.env.QB_PASS || null;
}

// Validate config on startup (called from startup())
function validateQBConfig() {
  if (!QB_PASS) {
    throw new Error(
      'qBittorrent password not set.\n' +
      '  Set QB_PASS in /opt/dashboard/.env'
    );
  }
}

function qbRequest(method, path, body) {
  return new Promise(resolve => {
    const options = {
      hostname: QB_HOST,
      port: QB_PORT,
      path: path,
      method: method,
      headers: {}
    };
    if (qbCookie) options.headers['Cookie'] = qbCookie;
    if (body) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
    req.setTimeout(3000, () => { req.destroy(); resolve({ status: 0, headers: {}, body: '' }); });
    if (body) req.write(body);
    req.end();
  });
}

async function qbLogin() {
  const body = `username=${QB_USER}&password=${QB_PASS}`;
  const res = await qbRequest('POST', '/api/v2/auth/login', body);
  if (res.status === 200 || res.status === 204 || (res.headers['set-cookie'] && res.body === 'Ok.')) {
    const cookies = res.headers['set-cookie'];
    if (cookies) {
      qbCookie = Array.isArray(cookies) ? cookies[0].split(';')[0] : cookies.split(';')[0];
    }
    return true;
  }
  qbCookie = null;
  return false;
}

async function collectQBittorrent() {
  const now = Date.now();
  if (qbCache.value && (now - qbCache.time) < QB_CACHE_MS) {
    return qbCache.value;
  }
  let res = await qbRequest('GET', '/api/v2/torrents/info', null);
  if (res.status === 403) {
    const ok = await qbLogin();
    if (!ok) return qbCache.value || [];
    res = await qbRequest('GET', '/api/v2/torrents/info', null);
  }
  if (res.status !== 200) return qbCache.value || [];
  try {
    const result = JSON.parse(res.body).map(t => ({
      hash: t.hash,
      name: t.name,
      size: t.size,
      progress: t.progress,
      dlspeed: t.dlspeed,
      upspeed: t.upspeed,
      eta: t.eta,
      state: t.state,
      num_seeds: t.num_seeds,
      num_peers: t.num_leechs,
      ratio: t.ratio,
    }));
    qbCache = { value: result, time: now };
    return result;
  } catch (err) {
    console.warn('qBittorrent parse failed:', err.message);
    return qbCache.value || [];
  }
}

async function qbDelete(hash) {
  const body = `hashes=${encodeURIComponent(hash)}&deleteFiles=true`;
  let res = await qbRequest('POST', '/api/v2/torrents/delete', body);
  if (res.status === 403) {
    const ok = await qbLogin();
    if (!ok) return { success: false, error: 'Authentication failed' };
    res = await qbRequest('POST', '/api/v2/torrents/delete', body);
  }
  if (res.status === 200) {
    // Invalidate the qBittorrent cache so the next collect picks up the change
    qbCache = { value: null, time: 0 };
    return { success: true };
  }
  return { success: false, error: `HTTP ${res.status}` };
}

module.exports = { loadQBConfig, validateQBConfig, qbRequest, qbLogin, collectQBittorrent, qbDelete };
