let term = null;
let fitAddon = null;
let ws = null;
let connected = false;

function getStatusEl() {
  return document.getElementById('terminal-status');
}

function getContainerEl() {
  return document.getElementById('terminal-container');
}

function connect() {
  if (connected || ws) return;

  const statusEl = getStatusEl();
  const containerEl = getContainerEl();
  if (!containerEl) return;

  statusEl.textContent = 'Connecting...';
  statusEl.className = 'terminal-status';

  // Create terminal if not already
  if (!term) {
    term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', Menlo, monospace",
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
      },
      allowProposedApi: true,
      scrollback: 5000,
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerEl);
    fitAddon.fit();

    // Send keystrokes to server
    term.onData((data) => {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      if (fitAddon && term) {
        fitAddon.fit();
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      }
    });
  }

  // Connect WebSocket
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/terminal?cols=${term.cols}&rows=${term.rows}`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    connected = true;
    statusEl.textContent = `Connected (PID: —)`;
    statusEl.className = 'terminal-status connected';
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'output':
          term.write(msg.data);
          break;
        case 'connected':
          statusEl.textContent = `Connected (PID: ${msg.pid})`;
          break;
        case 'exit':
          statusEl.textContent = `Shell exited (code ${msg.code})`;
          statusEl.className = 'terminal-status error';
          connected = false;
          ws = null;
          break;
      }
    } catch (e) { /* ignore */ }
  };

  ws.onclose = () => {
    if (connected) {
      statusEl.textContent = 'Disconnected — click to reconnect';
      statusEl.className = 'terminal-status error';
    }
    connected = false;
    ws = null;
  };

  ws.onerror = () => {
    statusEl.textContent = 'Connection error';
    statusEl.className = 'terminal-status error';
    connected = false;
    ws = null;
  };
}

// Lazy-init on first accordion open
function initTerminal() {
  const card = document.getElementById('terminal-card');
  if (!card) return;

  // Connect when card is opened
  card.addEventListener('click', (e) => {
    const trigger = card.querySelector('[data-accordion-trigger]');
    if (trigger && e.target.closest('[data-accordion-trigger]')) {
      // Give accordion time to animate open
      setTimeout(() => {
        if (!connected) {
          connect();
        } else if (fitAddon && term) {
          fitAddon.fit();
        }
      }, 100);
    }
  });

  // Auto-connect if already open
  if (card.dataset.state === 'open') {
    setTimeout(connect, 500);
  }
}

export { initTerminal };
