/**
 * Frontend transport contract regression test suite
 * Tests contracts defined in .hermes/cache/scratch/monit-cleanup-contract.md
 *
 * Target modules:
 * - api.ts (connectWS, disconnectWS, fetchStatus, updateUI, setErrorState)
 * - main.ts (visibilitychange handling, connectWS calling)
 * - ui/logs-modal.ts (showLogsModal, closeLogsModal, fetchLogs)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// Path to compiled frontend code passed via MONIT_TEST_DIST
const distDir = process.env.MONIT_TEST_DIST || path.resolve(__dirname, '../dist');

let passedTests = 0;
let failedTests = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failedTests++;
    failures.push({ name, error: err });
  }
}

// Minimal DOM & Browser environment mock creator
function createMockEnvironment() {
  const elements = new Map();
  const docListeners = new Map();
  const winListeners = new Map();
  let title = 'Server Dashboard';
  let hidden = false;

  function makeElement(id = '', tag = 'DIV') {
    const el = {
      tagName: tag.toUpperCase(),
      id,
      textContent: '',
      innerHTML: '',
      className: '',
      style: {},
      dataset: {},
      attributes: {},
      scrollTop: 0,
      scrollHeight: 100,
      checked: false,
      value: '',
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k]; },
      removeAttribute(k) { delete this.attributes[k]; },
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); }
      },
      children: [],
      childNodes: [],
      appendChild(child) {
        this.children.push(child);
        this.childNodes.push(child);
        if (child.id) elements.set(child.id, child);
        return child;
      },
      remove() {
        if (this.id) elements.delete(this.id);
      },
      addEventListener(evt, cb) {
        if (!this._handlers) this._handlers = {};
        if (!this._handlers[evt]) this._handlers[evt] = [];
        this._handlers[evt].push(cb);
      },
      removeEventListener(evt, cb) {
        if (!this._handlers || !this._handlers[evt]) return;
        this._handlers[evt] = this._handlers[evt].filter(fn => fn !== cb);
      },
      dispatchEvent(evt) {
        const handlers = (this._handlers && this._handlers[evt.type || evt]) || [];
        const e = typeof evt === 'string' ? { type: evt, target: this } : { target: this, ...evt };
        handlers.forEach(h => h(e));
      },
      querySelector(sel) {
        if (sel.startsWith('#')) return elements.get(sel.slice(1)) || null;
        return null;
      },
      querySelectorAll() { return []; }
    };
    if (id) elements.set(id, el);
    return el;
  }

  // Prepopulate standard UI elements expected by api.ts / logs-modal.ts
  makeElement('status-dot');
  makeElement('status-text');
  makeElement('last-update');
  makeElement('logout-btn');

  const doc = {
    get title() { return title; },
    set title(val) { title = val; },
    get hidden() { return hidden; },
    set hidden(val) { hidden = val; },
    getElementById(id) {
      if (!elements.has(id)) {
        return makeElement(id);
      }
      return elements.get(id);
    },
    createElement(tag) {
      return makeElement('', tag);
    },
    body: {
      appendChild(el) {
        if (el.id) elements.set(el.id, el);
        return el;
      }
    },
    addEventListener(evt, cb) {
      if (!docListeners.has(evt)) docListeners.set(evt, []);
      docListeners.get(evt).push(cb);
    },
    removeEventListener(evt, cb) {
      if (docListeners.has(evt)) {
        docListeners.set(evt, docListeners.get(evt).filter(fn => fn !== cb));
      }
    },
    dispatchEvent(evt) {
      const arr = docListeners.get(evt.type || evt) || [];
      const e = typeof evt === 'string' ? { type: evt, target: doc } : { target: doc, ...evt };
      arr.forEach(fn => fn(e));
    }
  };

  const win = {
    location: {
      protocol: 'http:',
      host: 'localhost:8080'
    },
    addEventListener(evt, cb) {
      if (!winListeners.has(evt)) winListeners.set(evt, []);
      winListeners.get(evt).push(cb);
    },
    removeEventListener(evt, cb) {
      if (winListeners.has(evt)) {
        winListeners.set(evt, winListeners.get(evt).filter(fn => fn !== cb));
      }
    },
    dispatchEvent(evt) {
      const arr = winListeners.get(evt.type || evt) || [];
      const e = typeof evt === 'string' ? { type: evt, target: win } : { target: win, ...evt };
      arr.forEach(fn => fn(e));
    }
  };

  return { doc, win, elements, docListeners, winListeners };
}

// Dynamic module loader with stubs
async function loadModuleWithMocks(moduleRelativePath, mocks = {}, env = null) {
  if (!vm.SourceTextModule) {
    throw new Error('vm.SourceTextModule required. Run node with --experimental-vm-modules');
  }

  const fullPath = path.resolve(distDir, moduleRelativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Target module not found at: ${fullPath}. MONIT_TEST_DIST=${distDir}`);
  }

  const { doc, win } = env || createMockEnvironment();

  const sandbox = {
    window: win,
    document: doc,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    AbortController,
    encodeURIComponent,
    parseInt,
    ...mocks.globals
  };
  vm.createContext(sandbox);

  const moduleCache = new Map();

  async function resolveImport(specifier, referencingModule) {
    // 1. Direct mock override
    if (mocks.modules && mocks.modules[specifier]) {
      const mockExports = mocks.modules[specifier];
      const mockMod = new vm.SyntheticModule(Object.keys(mockExports), function () {
        for (const [k, v] of Object.entries(mockExports)) this.setExport(k, v);
      }, { context: sandbox });
      await mockMod.link(() => {});
      await mockMod.evaluate();
      return mockMod;
    }

    // Transport tests isolate renderers: a renderer is not the behavior under test.
    if (moduleRelativePath === 'client/api.js') {
      const names = { './utils/dom.js':['$'], './utils/format.js':['fmtTime'], './config.js':['POLL_MS'],
        './ui/pm2.js':['renderPM2'], './ui/cpu.js':['renderCPU','renderCPUCores','renderLoad'],
        './ui/memory.js':['renderMemory','renderSwap'], './ui/disk.js':['renderDisk'],
        './ui/network.js':['renderNetworkRates','renderConnectivity'], './ui/battery.js':['renderBattery'],
        './ui/torrents.js':['renderTorrents'], './ui/thermal.js':['renderThermal'], './ui/system.js':['renderSystem'],
        './ui/sparklines.js':['renderSparklines'], './ui/antigravity.js':['renderAntigravity'],
        './ui/alerts.js':['checkAlerts','initNotifications'], './service-bar.js':['updateServiceHealth'], './particles.js':['updateCPULoad'] }[specifier];
      if (names) {
        const stub=new vm.SyntheticModule(names,function(){for(const n of names) this.setExport(n,n==='$'?id=>doc.getElementById(id):n==='fmtTime'?ts=>String(ts):n==='POLL_MS'?3000:()=>{});},{context:sandbox});
        await stub.link(()=>{}); await stub.evaluate(); return stub;
      }
    }
    // 2. Relative file import
    const refPath = referencingModule.identifier;
    const targetPath = path.resolve(path.dirname(refPath), specifier);
    if (moduleCache.has(targetPath)) {
      return moduleCache.get(targetPath);
    }

    if (fs.existsSync(targetPath)) {
      const targetCode = fs.readFileSync(targetPath, 'utf8');
      const loadedMod = new vm.SourceTextModule(targetCode, {
        identifier: targetPath,
        context: sandbox,
        initializeImportMeta(meta) { meta.url = 'file://' + targetPath; }
      });
      moduleCache.set(targetPath, loadedMod);
      await loadedMod.link(resolveImport);
      await loadedMod.evaluate();
      return loadedMod;
    }

    // Default empty stub for any unspecified child module
    const emptyMod = new vm.SourceTextModule('export default {}; export const $ = (id) => document.getElementById(id);', { context: sandbox });
    await emptyMod.link(() => {});
    await emptyMod.evaluate();
    return emptyMod;
  }

  const code = fs.readFileSync(fullPath, 'utf8');
  const rootMod = new vm.SourceTextModule(code, {
    identifier: fullPath,
    context: sandbox,
    initializeImportMeta(meta) { meta.url = 'file://' + fullPath; }
  });
  moduleCache.set(fullPath, rootMod);
  await rootMod.link(resolveImport);
  await rootMod.evaluate();

  return { namespace: rootMod.namespace, sandbox };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite Definition
// ─────────────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('=== Frontend Transport Contract Tests ===');
  console.log(`Target dist directory: ${distDir}`);

  // Test 1: fetchStatus: older timestamp must not overwrite newer data
  await test('fetchStatus: older timestamp must not overwrite newer data', async () => {
    let capturedUpdates = [];
    const env = createMockEnvironment();

    // Responses setup:
    // Call 1 returns timestamp 100
    // Call 2 returns timestamp 200
    let resolveFirstFetch;
    const firstFetchPromise = new Promise(resolve => { resolveFirstFetch = resolve; });

    let fetchCount = 0;
    const mockFetch = async (url) => {
      fetchCount++;
      if (fetchCount === 1) {
        return firstFetchPromise;
      }
      return {
        ok: true,
        json: async () => ({ timestamp: 200, pm2: [], cpu: 20 })
      };
    };

    const domMock = {
      $: (id) => env.doc.getElementById(id),
      esc: (s) => s,
      setText: () => {},
      updateBar: () => {},
      barClass: () => '',
      setTextOf: () => {},
      setTextOfLast: () => {}
    };

    const { namespace, sandbox } = await loadModuleWithMocks('client/api.js', {
      globals: {
        fetch: mockFetch,
        WebSocket: class MockWebSocket {}
      },
      modules: {
        './utils/dom.js': domMock,
        '../utils/dom.js': domMock
      }
    }, env);

    // Call 1 starts (pending)
    const p1 = namespace.fetchStatus();

    // Call 2 starts and completes immediately with timestamp 200
    await namespace.fetchStatus();
    assert.strictEqual(env.doc.getElementById('last-update').textContent.includes('200') || env.elements.get('last-update')?.textContent !== '', true);
    const textAfterNewer = env.doc.getElementById('last-update').textContent;

    // Call 1 completes now with older timestamp 100
    resolveFirstFetch({
      ok: true,
      json: async () => ({ timestamp: 100, pm2: [], cpu: 10 })
    });
    await p1;

    // Contract: Older timestamp must NOT overwrite newer data
    const textAfterOlder = env.doc.getElementById('last-update').textContent;
    assert.strictEqual(
      textAfterOlder,
      textAfterNewer,
      'Older timestamp response overwrote newer status data! Contract violation.'
    );
  });

  // Test 2: connectWS: intentional disconnect cancels stale and reconnect callbacks
  await test('disconnectWS: intentional disconnect cancels stale timer and reconnect callbacks', async () => {
    const env = createMockEnvironment();
    let scheduledTimers = [];

    const customSetTimeout = (fn, ms) => {
      const id = setTimeout(fn, ms);
      scheduledTimers.push({ id, fn, ms, cleared: false });
      return id;
    };
    const customClearTimeout = (id) => {
      scheduledTimers.forEach(t => { if (t.id === id) t.cleared = true; });
      clearTimeout(id);
    };

    let activeSocket = null;
    class MockWebSocket {
      constructor(url) {
        activeSocket = this;
      }
      close() {
        if (this.onclose) this.onclose({});
      }
    }

    const { namespace } = await loadModuleWithMocks('client/api.js', {
      globals: {
        WebSocket: MockWebSocket,
        setTimeout: customSetTimeout,
        clearTimeout: customClearTimeout
      }
    }, env);

    // Trigger updateUI to start staleTimer
    namespace.updateUI({ timestamp: 100, pm2: [], cpu: 10 });

    // Verify staleTimer was scheduled
    const staleEntry = scheduledTimers.find(t => !t.cleared);
    assert.ok(staleEntry, 'Expected stale timer to be scheduled after updateUI');

    // Call disconnectWS
    namespace.disconnectWS();

    // Contract: intentional disconnect cancels stale/reconnect and callbacks
    assert.ok(staleEntry.cleared, 'disconnectWS failed to clear staleTimer!');
  });

  await test('connectWS: repeated failed reconnects keep scheduling', async () => {
    const env=createMockEnvironment(), sockets=[], timers=new Map(); let next=0;
    class MockWebSocket { constructor(){sockets.push(this);} close(){} }
    const { namespace }=await loadModuleWithMocks('client/api.js',{globals:{WebSocket:MockWebSocket,setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)}},env);
    namespace.connectWS(); sockets[0].onclose();
    assert.strictEqual(timers.size,1);
    const [id,retry]=timers.entries().next().value; timers.delete(id); retry();
    sockets[1].onclose(); assert.strictEqual(timers.size,1,'Second failed connection must schedule another retry');
    namespace.disconnectWS();
  });

  // Test 3: connectWS: do not connect when tab is hidden
  await test('connectWS: do not connect when tab is hidden', async () => {
    const env = createMockEnvironment();
    env.doc.hidden = true; // Tab is hidden

    let socketCreated = false;
    class MockWebSocket {
      constructor() {
        socketCreated = true;
      }
    }

    const { namespace } = await loadModuleWithMocks('client/api.js', {
      globals: {
        WebSocket: MockWebSocket
      }
    }, env);

    namespace.connectWS();

    // Contract: don't connect hidden
    assert.strictEqual(
      socketCreated,
      false,
      'connectWS initiated a WebSocket connection while document.hidden is true!'
    );
  });

  // Test 4: connectWS: old socket events cannot affect replacement
  await test('connectWS: old socket events cannot affect replacement', async () => {
    const env = createMockEnvironment();
    const sockets = [];

    class MockWebSocket {
      constructor(url) {
        this.url = url;
        sockets.push(this);
      }
      close() {
        // Mock close
      }
    }

    const { namespace } = await loadModuleWithMocks('client/api.js', {
      globals: {
        WebSocket: MockWebSocket
      }
    }, env);

    // Initial connection
    namespace.connectWS();
    assert.strictEqual(sockets.length, 1);
    const oldSocket = sockets[0];

    // Simulate connection established
    oldSocket.onopen?.();

    // Simulate intentional or replaced reconnection
    namespace.disconnectWS();
    namespace.connectWS();
    assert.strictEqual(sockets.length, 2);
    const newSocket = sockets[1];
    newSocket.onopen?.();

    // Now old socket triggers an error/close event late
    oldSocket.onerror?.(new Error('Old socket late error'));
    oldSocket.onclose?.({});

    // Status dot should remain connected because newSocket is active!
    const dot = env.doc.getElementById('status-dot');
    assert.strictEqual(
      dot.className,
      'status-dot',
      'Old socket close/error event corrupted the state of replacement active socket!'
    );
  });

  // Test 5: WebSocket onmessage: render errors distinct from parse errors
  await test('connectWS onmessage: render errors distinct from parse errors', async () => {
    const env = createMockEnvironment();
    let currentSocket = null;
    let loggedErrors = [];

    class MockWebSocket {
      constructor() {
        currentSocket = this;
      }
    }

    const { namespace } = await loadModuleWithMocks('client/api.js', {
      globals: {
        WebSocket: MockWebSocket,
        console: {
          ...console,
          error: (...args) => loggedErrors.push(args.join(' ')),
          warn: () => {},
          log: () => {}
        }
      },
      modules: {
        './ui/pm2.js': {
          renderPM2: () => {
            throw new Error('Explosive Render Exception');
          }
        }
      }
    }, env);

    namespace.connectWS();
    currentSocket.onopen?.();

    // Send valid JSON payload
    const validJson = JSON.stringify({ timestamp: 1234, pm2: [] });
    currentSocket.onmessage?.({ data: validJson });

    // Contract: Render errors distinct from parse errors.
    // It must NOT report "Failed to parse WS packet" for a render error!
    assert.ok(loggedErrors.some(msg => msg.includes('Explosive Render Exception')), 'Render failure was swallowed');
    const loggedParseError = loggedErrors.some(msg => msg.includes('Failed to parse WS packet'));
    assert.strictEqual(
      loggedParseError,
      false,
      'Render error was incorrectly caught and reported as a WS parse error!'
    );
  });

  // Test 6: logs-modal: stale responses cannot touch current modal (generation/abort)
  await test('logs-modal: stale responses cannot touch current modal', async () => {
    const env = createMockEnvironment();
    let resolveFirstFetch;
    const firstFetchPromise = new Promise(resolve => { resolveFirstFetch = resolve; });

    let fetchCount = 0;
    let requestedUrls = [];
    const mockFetch = async (url) => {
      fetchCount++;
      requestedUrls.push(url);
      if (fetchCount === 1) {
        return firstFetchPromise;
      }
      return {
        ok: true,
        json: async () => ({ success: true, out: 'LOGS FOR PROC B', err: '' })
      };
    };

    const { namespace } = await loadModuleWithMocks('client/ui/logs-modal.js', {
      globals: {
        fetch: mockFetch
      }
    }, env);

    // Open modal for procA -> starts fetch #1
    namespace.showLogsModal('procA');

    // Switch/open modal for procB -> starts fetch #2 and finishes immediately
    namespace.showLogsModal('procB');
    await new Promise(r => setTimeout(r, 10));

    // Verify modal content is for procB
    const contentEl = env.doc.getElementById('pm2-log-content');
    assert.strictEqual(contentEl.innerHTML.includes('LOGS FOR PROC B'), true);

    // Now delayed fetch #1 for procA resolves
    resolveFirstFetch({
      ok: true,
      json: async () => ({ success: true, out: 'STALE LOGS FOR PROC A', err: '' })
    });
    await new Promise(r => setTimeout(r, 10));

    // Contract: Stale responses cannot touch current modal
    assert.strictEqual(
      contentEl.innerHTML.includes('STALE LOGS FOR PROC A'),
      false,
      'Stale fetch response for procA overwrote current modal for procB!'
    );
  });

  // Test 7: logs-modal: no overlapping refreshes
  await test('logs-modal: no overlapping refreshes', async () => {
    const env = createMockEnvironment();
    let inflightFetches = 0;
    let maxConcurrent = 0;

    let finishFetch;
    const slowFetch = () => new Promise(r => { finishFetch = r; });

    const mockFetch = async () => {
      inflightFetches++;
      if (inflightFetches > maxConcurrent) maxConcurrent = inflightFetches;
      await slowFetch();
      inflightFetches--;
      return {
        ok: true,
        json: async () => ({ success: true, out: 'output', err: '' })
      };
    };

    const { namespace } = await loadModuleWithMocks('client/ui/logs-modal.js', {
      globals: {
        fetch: mockFetch
      }
    }, env);

    namespace.showLogsModal('testProc');

    // Click refresh button multiple times while first fetch is pending
    const refreshBtn = env.doc.getElementById('refresh-logs-btn');
    refreshBtn?.dispatchEvent('click');
    refreshBtn?.dispatchEvent('click');

    // Contract: no overlapping refreshes
    assert.strictEqual(
      maxConcurrent <= 1,
      true,
      `Detected ${maxConcurrent} concurrent in-flight log refreshes! Expected at most 1.`
    );

    finishFetch();
  });

  await test('logs-modal: old finally must not release a newer in-flight request',async()=>{
    const env=createMockEnvironment(),pending=[];
    const {namespace}=await loadModuleWithMocks('client/ui/logs-modal.js',{globals:{fetch:()=>new Promise(resolve=>pending.push(resolve))}},env);
    namespace.showLogsModal('A');namespace.showLogsModal('B');
    pending[0]({ok:true,json:async()=>({success:true,out:'old'})});
    await new Promise(r=>setTimeout(r,0));
    env.doc.getElementById('refresh-logs-btn').dispatchEvent('click');
    assert.strictEqual(pending.length,2,'Old request cleanup released the newer request guard');
    pending[1]({ok:true,json:async()=>({success:true,out:'new'})});namespace.closeLogsModal();
  });

  // Test 8: logs-modal: reset stored content on open
  await test('logs-modal: reset stored content on open', async () => {
    const env = createMockEnvironment();
    let procName = 'proc1';

    const mockFetch = async () => {
      return {
        ok: true,
        json: async () => ({ success: true, out: `Output for ${procName}`, err: `Err for ${procName}` })
      };
    };

    const { namespace } = await loadModuleWithMocks('client/ui/logs-modal.js', {
      globals: {
        fetch: mockFetch
      }
    }, env);

    // Open first modal and let it populate logData
    procName = 'proc1';
    namespace.showLogsModal('proc1');
    await new Promise(r => setTimeout(r, 10));

    // Close first modal
    namespace.closeLogsModal();

    // Now open second modal with pending/delayed fetch
    let delayedResolve;
    mockFetch.current = new Promise(r => { delayedResolve = r; });
    procName = 'proc2';

    // Show modal for proc2
    namespace.showLogsModal('proc2');

    // Switch to stderr tab before fetch completes
    const tabErrBtn = env.doc.getElementById('tab-err-btn');
    tabErrBtn?.dispatchEvent('click');

    const contentEl = env.doc.getElementById('pm2-log-content');

    // Contract: reset stored content on open
    // It must NOT show 'Err for proc1'
    assert.strictEqual(
      contentEl.innerHTML.includes('Err for proc1'),
      false,
      'Old process log content leaked into new modal before fetch completed!'
    );
  });

  console.log(`\n========================================`);
  console.log(`Tests finished: ${passedTests} passed, ${failedTests} failed.`);
  console.log(`========================================\n`);
}

if (require.main === module) {
  runTests()
    .then(() => {
      process.exit(failedTests > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Test runner fatal error:', err);
      process.exit(1);
    });
}

module.exports = { runTests };
