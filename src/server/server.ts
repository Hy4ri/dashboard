import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { WebSocketServer, WebSocket } from 'ws';
import rateLimiter from './utils/rate-limiter';
import stateModule from './state';
import { collect } from './collect';
import { PORT, COLLECT_MS, IDLE_TIMEOUT_MS, AUTH_USER, AUTH_PASS } from './config';
import { createHandleAPI } from './routes/api';
import { createPM2Route } from './routes/pm2-control';
import { createPM2LogsRoute } from './routes/pm2-logs';
import { createQBittorrentRoute } from './routes/qbittorrent';
import { createTerminalRoute } from './routes/terminal';

export interface HeaderMap {
  [header: string]: string;
}

export interface CookieMap {
  [name: string]: string;
}

const MIME: HeaderMap = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// Root of the project (parent of src/server or dist/server)
const ROOT = path.resolve(__dirname, '../..');
export const SECURITY_HEADERS: HeaderMap = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:",
};

interface SessionData {
  username: string;
  expiresAt: number;
}

// Session Store
const activeSessions = new Map<string, SessionData>();
const WebSocketClients = new Set<WebSocket>();

function parseCookies(cookieHeader?: string): CookieMap {
  const cookies: CookieMap = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 1) {
      const name = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      cookies[name] = decodeURIComponent(value);
    }
  });
  return cookies;
}

export function isAuthenticated(req: http.IncomingMessage): boolean {
  if (!AUTH_PASS) return true; // Auth is disabled if no password is configured
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.session_token;
  if (!token) return false;

  const session = activeSessions.get(token);
  if (!session) return false;

  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

let lastStateJson = '{}';

function broadcastState(): void {
  const payload = lastStateJson;
  for (const client of WebSocketClients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(payload);
      } catch (err: any) {
        console.error('WS broadcast error:', err.message);
      }
    }
  }
}

export function ensureActivePolling(): void {
  stateModule.lastRequestTime = Date.now();
  if (stateModule.pollTimer) return;
  console.log('Polling started (active client/WS connection)');

  collect().then(() => {
    lastStateJson = JSON.stringify(stateModule.state);
    if (WebSocketClients.size > 0) broadcastState();
  });

  stateModule.pollTimer = setInterval(async () => {
    const hasWsClients = WebSocketClients.size > 0;
    const isHttpActive = (Date.now() - stateModule.lastRequestTime) <= IDLE_TIMEOUT_MS;

    if (!hasWsClients && !isHttpActive) {
      if (stateModule.pollTimer) {
        clearInterval(stateModule.pollTimer);
        stateModule.pollTimer = null;
      }
      console.log('Polling stopped (idle)');
      return;
    }

    try {
      await collect();
      lastStateJson = JSON.stringify(stateModule.state);
      if (hasWsClients) {
        broadcastState();
      }
    } catch (err: any) {
      console.error('Error in collect loop:', err.message);
    }
  }, COLLECT_MS);
}

const handleAPI = createHandleAPI({
  state: stateModule.state,
  ensureActivePolling,
  SECURITY_HEADERS,
});
const handlePM2Control = createPM2Route({ collect });
const handlePM2Logs = createPM2LogsRoute();
const handleQBAction = createQBittorrentRoute();

export function createServer(): http.Server {
  const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    let requestPath = url.pathname;

    // Login Endpoint (unauthenticated POST)
    if (requestPath === '/api/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', () => {
        try {
          const credentials = JSON.parse(body);
          if (credentials.username === AUTH_USER && credentials.password === AUTH_PASS) {
            const token = crypto.randomBytes(32).toString('hex');
            const remember = !!credentials.remember;
            const maxAgeMs = remember ? 30 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;

            activeSessions.set(token, {
              username: AUTH_USER,
              expiresAt: Date.now() + maxAgeMs,
            });

            const maxAgeSec = Math.floor(maxAgeMs / 1000);
            res.writeHead(200, Object.assign({
              'Content-Type': 'application/json',
              'Set-Cookie': `session_token=${token}; Path=/; HttpOnly; SameSite=Strict${remember ? `; Max-Age=${maxAgeSec}` : ''}`,
            }, SECURITY_HEADERS));
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(401, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS));
            res.end(JSON.stringify({ success: false, error: 'Invalid username or password' }));
          }
        } catch {
          res.writeHead(400, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS));
          res.end(JSON.stringify({ success: false, error: 'Invalid payload' }));
        }
      });
      return;
    }

    // Logout Endpoint
    if (requestPath === '/api/logout' && req.method === 'POST') {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies.session_token;
      if (token) {
        activeSessions.delete(token);
      }
      res.writeHead(200, Object.assign({
        'Content-Type': 'application/json',
        'Set-Cookie': 'session_token=; Path=/; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      }, SECURITY_HEADERS));
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // Auth gate for everything else
    const authed = isAuthenticated(req);
    if (!authed) {
      if (requestPath.startsWith('/api')) {
        res.writeHead(401, SECURITY_HEADERS);
        return res.end('Unauthorized');
      }

      // Serve login.html directly for unauthenticated browsers
      const loginPath = path.join(ROOT, 'login.html');
      fs.readFile(loginPath, (err, data) => {
        if (err) {
          res.writeHead(500, SECURITY_HEADERS);
          return res.end('Error loading login screen');
        }
        res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, SECURITY_HEADERS));
        res.end(data);
      });
      return;
    }

    // API routes — rate limited
    if (requestPath.startsWith('/api')) {
      if (!rateLimiter(req.socket.remoteAddress)) {
        res.writeHead(429, SECURITY_HEADERS);
        return res.end('Too Many Requests');
      }

      // PM2 control endpoints (POST only)
      const pm2Match = requestPath.match(/^\/api\/pm2\/(stop|start|restart|delete)\/(.+)$/);
      if (pm2Match && req.method === 'POST') {
        return handlePM2Control(req, res, pm2Match[1], pm2Match[2]);
      }

      // PM2 logs endpoint (GET only)
      const pm2LogsMatch = requestPath.match(/^\/api\/pm2\/logs\/(.+)$/);
      if (pm2LogsMatch && req.method === 'GET') {
        const linesParam = parseInt(url.searchParams.get('lines') || '100', 10) || 100;
        return handlePM2Logs(req, res, pm2LogsMatch[1], linesParam);
      }

      // qBittorrent action endpoint (POST only: delete, pause, resume)
      const qbActionMatch = requestPath.match(/^\/api\/qbittorrent\/(delete|pause|resume)\/([a-fA-F0-9]{40}|all)$/);
      if (qbActionMatch && req.method === 'POST') {
        return handleQBAction(req, res, qbActionMatch[1], qbActionMatch[2]);
      }

      // API status endpoint
      if (requestPath === '/api/status') {
        return handleAPI(req, res);
      }
    }

    // Default to index.html (static files — no rate limiting)
    if (requestPath === '/') requestPath = '/index.html';

    // Path traversal protection
    const filePath = path.join(ROOT, requestPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, SECURITY_HEADERS);
      return res.end('Forbidden');
    }

    // Static files — with gzip + caching
    const ext = path.extname(filePath);
    const contentType = MIME[ext] || 'application/octet-stream';
    const canCache = ['.html', '.css', '.js', '.svg', '.json'].includes(ext);
    const rawEncoding = req.headers['accept-encoding'];
    const acceptEncoding = Array.isArray(rawEncoding) ? rawEncoding.join(',') : (rawEncoding || '');

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, SECURITY_HEADERS);
        return res.end('Not Found');
      }

      const headers: HeaderMap = {
        'Content-Type': contentType,
      };

      if (canCache) {
        headers['Cache-Control'] = 'public, max-age=3600';
      }

      // Gzip compressible types
      if (canCache && acceptEncoding.includes('gzip') && data.length > 1024) {
        zlib.gzip(data, (gzipErr, gzipped) => {
          if (gzipErr || gzipped.length >= data.length) {
            // Serve uncompressed if gzip doesn't help
            res.writeHead(200, Object.assign(headers, SECURITY_HEADERS));
            return res.end(data);
          }
          res.writeHead(200, Object.assign(headers, { 'Content-Encoding': 'gzip' }, SECURITY_HEADERS));
          res.end(gzipped);
        });
      } else {
        res.writeHead(200, Object.assign(headers, SECURITY_HEADERS));
        res.end(data);
      }
    });
  });

  // Attach WebSocket Server
  const wss = new WebSocketServer({ noServer: true });
  const wssTerminal = new WebSocketServer({ noServer: true });

  createTerminalRoute(wssTerminal);

  server.on('upgrade', (request: http.IncomingMessage, socket: any, head: Buffer) => {
    // Validate WebSocket handshake auth
    if (!isAuthenticated(request)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (url.pathname === '/ws/terminal') {
      wssTerminal.handleUpgrade(request, socket, head, (ws) => {
        wssTerminal.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    WebSocketClients.add(ws);
    ensureActivePolling();

    // Push current status immediately on connection
    ws.send(lastStateJson);

    ws.on('close', () => {
      WebSocketClients.delete(ws);
    });

    ws.on('error', (err: Error) => {
      console.warn('WS Client connection error:', err.message);
      WebSocketClients.delete(ws);
    });
  });

  return server;
}
