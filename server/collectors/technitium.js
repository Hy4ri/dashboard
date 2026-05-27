const { execFile } = require('child_process');
const { TECHNITIUM_TOKEN, TECHNITIUM_URL } = require('../config');

async function collectTechnitium() {
  if (!TECHNITIUM_TOKEN) {
    return { configured: false };
  }

  try {
    const baseUrl = (TECHNITIUM_URL || 'http://127.0.0.1:5380').replace(/\/$/, '');
    const tk = encodeURIComponent(TECHNITIUM_TOKEN);
    const url = baseUrl + '/api/dashboard/stats/get?token=' + tk + '&type=LastDay';

    const data = await new Promise((resolve, reject) => {
      execFile('curl', ['-skL', '--max-time', '10', url], { timeout: 15000 }, (err, stdout) => {
        if (err) return reject(new Error('curl: ' + (err.message || 'failed')));
        if (!stdout || !stdout.trim()) return reject(new Error('Empty response'));
        try { resolve(JSON.parse(stdout)); }
        catch (e) { reject(new Error('JSON: ' + e.message)); }
      });
    });

    if (data && data.status === 'ok') {
      const stats = (data.response && data.response.stats) || {};
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
      error: data ? (data.errorMessage || 'API error') : 'Unknown response'
    };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}

module.exports = { collectTechnitium };
