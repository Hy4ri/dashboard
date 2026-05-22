const http = require('http');
const fs = require('fs');
const path = require('path');
const rateLimiter = require('./utils/rate-limiter');
const stateModule = require('./state');
const { collect } = require('./collect');
const { PORT, COLLECT_MS, IDLE_TIMEOUT_MS } = require('./config');
const { createHandleAPI } = require('./routes/api');
const { createPM2Route } = require('./routes/pm2-control');
const { createSpeedtestRoute } = require('./routes/speedtest');
const { createQBittorrentRoute } = require('./routes/qbittorrent');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.json': 'application/json',
};

const ROOT = path.join(__dirname, '..');
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'",
};

function ensureActivePolling() {
  stateModule.lastRequestTime = Date.now();
  if (stateModule.pollTimer) return;
  console.log('Polling resumed (client connected)');
  collect();
  stateModule.pollTimer = setInterval(() => {
    if (Date.now() - stateModule.lastRequestTime > IDLE_TIMEOUT_MS) {
      clearInterval(stateModule.pollTimer);
      stateModule.pollTimer = null;
      console.log('Polling paused (idle)');
      return;
    }
    collect();
  }, COLLECT_MS);
}

const handleAPI = createHandleAPI({
  state: stateModule.state,
  ensureActivePolling,
  SECURITY_HEADERS,
});
const handlePM2Control = createPM2Route({ collect });
const handleSpeedtestRun = createSpeedtestRoute();
const handleQBDelete = createQBittorrentRoute();

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let requestPath = url.pathname;

    // Rate limiting
    if (!rateLimiter(req.socket.remoteAddress)) {
      res.writeHead(429, SECURITY_HEADERS);
      return res.end('Too Many Requests');
    }

    // PM2 control endpoints (POST only)
    const pm2Match = requestPath.match(/^\/api\/pm2\/(stop|start|restart)\/(.+)$/);
    if (pm2Match && req.method === 'POST') {
      return handlePM2Control(req, res, pm2Match[1], pm2Match[2]);
    }

    // Speedtest manual trigger (POST only)
    if (requestPath === '/api/speedtest/run' && req.method === 'POST') {
      return handleSpeedtestRun(req, res);
    }

    // qBittorrent delete endpoint (POST only)
    const qbDeleteMatch = requestPath.match(/^\/api\/qbittorrent\/delete\/([a-fA-F0-9]{40})$/);
    if (qbDeleteMatch && req.method === 'POST') {
      return handleQBDelete(req, res, qbDeleteMatch[1]);
    }

    // API endpoint
    if (requestPath === '/api/status') {
      return handleAPI(req, res);
    }

    // Default to index.html
    if (requestPath === '/') requestPath = '/index.html';

    // Path traversal protection
    const filePath = path.join(ROOT, requestPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, SECURITY_HEADERS);
      return res.end('Forbidden');
    }

    // Static files
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, SECURITY_HEADERS);
        return res.end('Not Found');
      }
      const contentType = MIME[path.extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, Object.assign({ 'Content-Type': contentType }, SECURITY_HEADERS));
      res.end(data);
    });
  });
}

module.exports = { createServer, ensureActivePolling, SECURITY_HEADERS };
