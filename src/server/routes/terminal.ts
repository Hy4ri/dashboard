import pty from 'node-pty';
import os from 'os';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

function resolveShell(): string {
  if (os.platform() === 'win32') return 'powershell.exe';
  const candidates = [process.env.SHELL, '/bin/bash', '/bin/sh', '/usr/bin/bash'];
  for (const sh of candidates) {
    if (sh && fs.existsSync(sh)) return sh;
  }
  return '/bin/sh';
}

export function createTerminalRoute(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws/terminal') return;

    const cols = parseInt(url.searchParams.get('cols') || '', 10) || 120;
    const rows = parseInt(url.searchParams.get('rows') || '', 10) || 30;

    const shell = resolveShell();
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME || '/',
      env: Object.assign({}, process.env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }),
    });

    console.log(`[Terminal] PTY started: pid=${term.pid} cols=${term.cols} rows=${term.rows}`);

    // Send PTY output to WebSocket client
    term.onData((data: string) => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(JSON.stringify({ type: 'output', data }));
        } catch (e) {
          /* client gone */
        }
      }
    });

    term.onExit(({ exitCode }) => {
      console.log(`[Terminal] PTY exited: code=${exitCode}`);
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
          ws.close();
        } catch (e) {
          /* */
        }
      }
    });

    // Receive commands from WebSocket client
    ws.on('message', (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'input':
            term.write(msg.data);
            break;
          case 'resize':
            if (msg.cols && msg.rows) {
              term.resize(msg.cols, msg.rows);
            }
            break;
        }
      } catch (e) {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      console.log(`[Terminal] Client disconnected, killing PTY pid=${term.pid}`);
      try {
        term.kill();
      } catch (e) {
        /* already dead */
      }
    });

    ws.on('error', (err: Error) => {
      console.warn(`[Terminal] WS error: ${err.message}`);
      try {
        term.kill();
      } catch (e) {
        /* */
      }
    });

    // Acknowledge connection
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'connected', pid: term.pid }));
    }
  });
}
