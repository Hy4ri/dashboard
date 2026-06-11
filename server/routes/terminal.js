const pty = require('node-pty');
const os = require('os');

function createTerminalRoute(wss) {
  // We handle terminal connections on a separate path: /ws/terminal
  // The upgrade handler in server.js will route to this

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws/terminal') return;

    const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: parseInt(url.searchParams.get('cols')) || 120,
      rows: parseInt(url.searchParams.get('rows')) || 30,
      cwd: process.env.HOME || '/',
      env: Object.assign({}, process.env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }),
    });

    console.log(`[Terminal] PTY started: pid=${term.pid} cols=${term.cols} rows=${term.rows}`);

    // Send PTY output to WebSocket client
    term.onData((data) => {
      if (ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: 'output', data })); }
        catch (e) { /* client gone */ }
      }
    });

    term.onExit(({ exitCode }) => {
      console.log(`[Terminal] PTY exited: code=${exitCode}`);
      if (ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: 'exit', code: exitCode })); ws.close(); }
        catch (e) { /* */ }
      }
    });

    // Receive commands from WebSocket client
    ws.on('message', (raw) => {
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
      try { term.kill(); } catch (e) { /* already dead */ }
    });

    ws.on('error', (err) => {
      console.warn(`[Terminal] WS error: ${err.message}`);
      try { term.kill(); } catch (e) { /* */ }
    });

    // Acknowledge connection
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'connected', pid: term.pid }));
    }
  });
}

module.exports = { createTerminalRoute };
