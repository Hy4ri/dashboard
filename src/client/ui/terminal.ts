declare const Terminal: any;
declare const FitAddon: any;

let term: any = null;
let fitAddon: any = null;
let ws: WebSocket | null = null;
let connected = false;

function getStatusEl(): HTMLElement | null {
  return document.getElementById('terminal-status');
}

function getContainerEl(): HTMLElement | null {
  return document.getElementById('terminal-container');
}

export function connect(): void {
  if (connected || ws) return;

  const statusEl = getStatusEl();
  const containerEl = getContainerEl();
  if (!containerEl || !statusEl) return;

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
    term.onData((data: string) => {
      if (ws && ws.readyState === 1) { // WebSocket.OPEN
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
export function initTerminal(): void {
  const card = document.getElementById('terminal-card');
  if (!card) return;

  // Fullscreen toggle
  const fsBtn = document.getElementById('terminal-fullscreen-btn');
  if (fsBtn) {
    fsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isFs = card.dataset.fullscreen === 'true';
      card.dataset.fullscreen = isFs ? 'false' : 'true';
      document.body.style.overflow = isFs ? '' : 'hidden';
      // Refit after layout settles
      setTimeout(() => { if (fitAddon && term) fitAddon.fit(); }, 50);
      setTimeout(() => { if (fitAddon && term) fitAddon.fit(); }, 250);
    });
  }

  // Escape exits fullscreen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && card.dataset.fullscreen === 'true') {
      card.dataset.fullscreen = 'false';
      document.body.style.overflow = '';
      setTimeout(() => { if (fitAddon && term) fitAddon.fit(); }, 50);
    }
  });

  // Connect when card is opened
  card.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const trigger = card.querySelector('[data-accordion-trigger]');
    if (trigger && target.closest('[data-accordion-trigger]') && !target.closest('.terminal-fullscreen-btn')) {
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
