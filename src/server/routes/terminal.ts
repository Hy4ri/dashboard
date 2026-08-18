import * as pty from 'node-pty';
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
    let term: any;
    try {
      term = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.env.HOME || '/',
        env: Object.assign({}, process.env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }),
      });
      console.log(`[Terminal] PTY started: pid=${term.pid} cols=${term.cols} rows=${term.rows}`);
    } catch (err: any) {
      console.warn(`[Terminal] Failed to spawn PTY: ${err?.message || err}`);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31mFailed to spawn terminal: ${err?.message || err}\x1b[0m\r\n` }));
        ws.close();
      }
      return;
    }

    // Send PTY output to WebSocket client
    term.onData((data: string) => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(JSON.stringify({ type: 'output', data }));
        } catch {
          /* client gone */
        }
      }
    });

    term.onExit(({ exitCode }: { exitCode: number }) => {
      console.log(`[Terminal] PTY exited: code=${exitCode}`);
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
          ws.close();
        } catch {
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
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      console.log(`[Terminal] Client disconnected, killing PTY pid=${term.pid}`);
      try {
        term.kill();
      } catch {
        /* already dead */
      }
    });

    ws.on('error', (err: Error) => {
      console.warn(`[Terminal] WS error: ${err.message}`);
      try {
        term.kill();
      } catch {
        /* */
      }
    });

    // Acknowledge connection
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'connected', pid: term.pid }));
    }
  });
}
