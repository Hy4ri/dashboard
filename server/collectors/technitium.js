const http = require('http');
const https = require('https');
const { TECHNITIUM_TOKEN, TECHNITIUM_URL } = require('../config');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const mod = isHttps ? https : http;
    const opts = { timeout: 10000 };
    if (isHttps) opts.rejectUnauthorized = false; // self-signed certs
    mod.get(url, opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          httpGet(res.headers.location).then(resolve, reject);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

async function collectTechnitium() {
  if (!TECHNITIUM_TOKEN) {
    return { configured: false };
  }

  try {
    const baseUrl = (TECHNITIUM_URL || 'http://127.0.0.1:5380').replace(/\/$/, '');
    const tk = encodeURIComponent(TECHNITIUM_TOKEN);
    const url = baseUrl + '/api/dashboard/stats/get?token=' + tk + '&type=LastDay';

    const data = await httpGet(url);
    const parsed = JSON.parse(data);

    if (parsed && parsed.status === 'ok') {
      const stats = (parsed.response && parsed.response.stats) || {};
      return {
        configured: true, ok: true,
        totalQueries: stats.totalQueries || 0,
        blockedQueries: stats.totalBlocked || 0,
        blockedPercentage: stats.totalQueries
          ? parseFloat(((stats.totalBlocked / stats.totalQueries) * 100).toFixed(2)) : 0,
        cachedQueries: stats.totalCached || 0
      };
    }

    return {
      configured: true, ok: false,
      error: parsed ? (parsed.errorMessage || 'API error') : 'Unknown response'
    };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}

module.exports = { collectTechnitium };
