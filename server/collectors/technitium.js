const http = require('http');
const { TECHNITIUM_TOKEN, TECHNITIUM_URL } = require('../config');

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const req = http.get(urlStr, { timeout: 1500 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Status: ${res.statusCode}`));
      }
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function collectTechnitium() {
  if (!TECHNITIUM_TOKEN) {
    return { configured: false };
  }

  try {
    const baseUrl = (TECHNITIUM_URL || 'http://127.0.0.1:5380').replace(/\/$/, '');
    const url = `${baseUrl}/api/dashboard/stats?token=${encodeURIComponent(TECHNITIUM_TOKEN)}&type=LastDay`;
    const data = await fetchJson(url);

    if (data && data.status === 'ok') {
      const stats = data.stats || {};
      const total = stats.totalQueries || 0;
      const blocked = stats.blockedQueries || 0;
      const cached = stats.cachedQueries || 0;
      return {
        configured: true,
        ok: true,
        totalQueries: total,
        blockedQueries: blocked,
        blockedPercentage: total ? parseFloat(((blocked / total) * 100).toFixed(2)) : 0,
        cachedQueries: cached
      };
    } else {
      return {
        configured: true,
        ok: false,
        error: data ? (data.errorMessage || 'API error') : 'Unknown response'
      };
    }
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: err.message
    };
  }
}

module.exports = { collectTechnitium };
