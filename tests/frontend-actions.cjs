/**
 * Frontend actions contract regression test suite
 * Tests contracts defined in .hermes/cache/scratch/monit-cleanup-contract.md
 *
 * Target modules:
 * - events.ts (setupTorrentActions, bulk torrent actions pause/resume/delete)
 * - pm2-actions.ts (setupPM2Actions, pm2ControlAction, Restart All)
 * - ui/alerts.ts (checkAlerts, renderAlertsList, dynamic names escaping/textContent)
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

// Minimal DOM Element Mock
class MockElement {
  constructor(tagName = 'DIV', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = '';
    this._textContent = '';
    this._innerHTML = '';
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this._handlers = {};
    this.disabled = false;
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(val) {
    this._textContent = String(val);
    this._innerHTML = escapeHtml(String(val));
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = String(val);
    this._textContent = String(val).replace(/<[^>]*>/g, '');
    this.children=[];
    for(const match of String(val).matchAll(/<span class="([^"]*)">([\s\S]*?)<\/span>/g)){const span=new MockElement('span');span.className=match[1];span._innerHTML=match[2];span._textContent=match[2].replace(/<[^>]*>/g,'');this.appendChild(span);}
  }

  get classList() {
    const self = this;
    return {
      classes: new Set(self.className ? self.className.split(/\s+/).filter(Boolean) : []),
      add(...cls) {
        cls.forEach(c => this.classes.add(c));
        self.className = Array.from(this.classes).join(' ');
      },
      remove(...cls) {
        cls.forEach(c => this.classes.delete(c));
        self.className = Array.from(this.classes).join(' ');
      },
      contains(c) {
        return this.classes.has(c);
      },
      toggle(c, force) {
        if (force === true || (force === undefined && !this.contains(c))) {
          this.add(c);
          return true;
        } else {
          this.remove(c);
          return false;
        }
      }
    };
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }

  getAttribute(k) {
    return this.attributes[k] !== undefined ? this.attributes[k] : null;
  }

  removeAttribute(k) {
    delete this.attributes[k];
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(newChild, refChild) {
    newChild.parentNode = this;
    const idx = this.children.indexOf(refChild);
    if (idx === -1) {
      this.children.push(newChild);
    } else {
      this.children.splice(idx, 0, newChild);
    }
    return newChild;
  }

  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) {
        this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
  }

  addEventListener(evt, cb, options) {
    if (!this._handlers[evt]) this._handlers[evt] = [];
    this._handlers[evt].push({ cb, once: options?.once || false });
  }

  removeEventListener(evt, cb) {
    if (this._handlers[evt]) {
      this._handlers[evt] = this._handlers[evt].filter(h => h.cb !== cb);
    }
  }

  dispatchEvent(evt) {
    const handlers = (this._handlers && this._handlers[evt.type]) || [];
    const toRun = [...handlers];
    // Filter once handlers
    this._handlers[evt.type] = handlers.filter(h => !h.once);
    for (const h of toRun) {
      evt.target = evt.target || this;
      evt.currentTarget = this;
      h.cb(evt);
    }
    if(this.parentNode)this.parentNode.dispatchEvent(evt);
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches && curr.matches(selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('[')) {
      const match = selector.match(/\[([a-zA-Z0-9_-]+)(?:="?([^"\]]*)"?)?\]/);
      if (match) {
        const [_, attr, val] = match;
        if (attr.startsWith('data-')) {
          const key = attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          return val !== undefined ? this.dataset[key] === val : this.dataset[key] !== undefined;
        }
        return val !== undefined ? this.getAttribute(attr) === val : this.getAttribute(attr) !== null;
      }
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(sel) {
    const res = [];
    function search(node) {
      for (const child of node.children) {
        if (child.matches && child.matches(sel)) {
          res.push(child);
        }
        search(child);
      }
    }
    search(this);
    return res;
  }

  getBoundingClientRect() {
    return { left: 10, top: 20, right: 100, bottom: 50, width: 90, height: 30 };
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function createMockEnvironment() {
  const elementsById = new Map();
  const docListeners = new Map();

  const body = new MockElement('BODY', 'body');

  const doc = {
    body,
    getElementById(id) {
      return elementsById.get(id) || body.querySelector('#'+id);
    },
    createElement(tag) {
      const el = new MockElement(tag);
      return el;
    },
    querySelector(sel) {
      if (sel.startsWith('#')) {
        return elementsById.get(sel.slice(1)) || null;
      }
      return body.querySelector(sel);
    },
    querySelectorAll(sel) {
      return body.querySelectorAll(sel);
    },
    addEventListener(evt, cb) {
      if (!docListeners.has(evt)) docListeners.set(evt, []);
      docListeners.get(evt).push(cb);
    },
    removeEventListener(evt, cb) {
      if (docListeners.has(evt)) {
        const filtered = docListeners.get(evt).filter(fn => fn !== cb);
        docListeners.set(evt, filtered);
      }
    },
    dispatchEvent(evt) {
      const arr = docListeners.get(evt.type) || [];
      arr.forEach(fn => fn(evt));
    }
  };

  function registerElement(id, el) {
    el.id = id;
    elementsById.set(id, el);
    return el;
  }

  const win = {
    document: doc,
    location: {
      protocol: 'http:',
      host: 'localhost:8080'
    },
    confirm: (msg) => true,
    alert: (msg) => {},
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  return { doc, win, body, elementsById, registerElement };
}

async function runTests() {
  console.log('--- Running frontend actions tests ---');
  console.log(`Using distDir: ${distDir}`);

  // Test 1: Bulk torrent actions check HTTP status and data.success, and report failure
  await test('events: bulk torrent operations check HTTP and success, alert on failure', async () => {
    // Contract: bulk torrent and restart operations check HTTP and success
    // Baseline events.ts:
    // const resumeAllBtn = $('torrent-resume-all-btn');
    // resumeAllBtn.addEventListener('click', async (e) => {
    //   e.preventDefault();
    //   try {
    //     await fetch('/api/qbittorrent/resume/all', { method: 'POST' });
    //     setTimeout(() => fetchStatus(), 300);
    //   } catch (err: any) { alert(...) }
    // });
    // If the server returns res.ok = false (e.g. 500) or { success: false, error: 'qB unreachable' },
    // baseline fetch() resolves without throwing, ignores HTTP error and data.success,
    // does not alert, and proceeds to fetchStatus() silently!
    const eventsPath = path.join(distDir, 'client/events.js');
    if (!fs.existsSync(eventsPath)) {
      assert.fail(`File not found: ${eventsPath}. Dist must be built.`);
    }

    const { doc, win, registerElement } = createMockEnvironment();
    let alerted = null;
    win.alert = (msg) => { alerted = msg; };

    const resumeBtn = registerElement('torrent-resume-all-btn', new MockElement('BUTTON'));
    const pauseBtn = registerElement('torrent-pause-all-btn', new MockElement('BUTTON'));

    let fetchCalled = false;
    let fetchResponse = { ok: false, status: 500, json: async () => ({ success: false, error: 'Torrent client offline' }) };

    const sandbox = {
      window: win,
      document: doc,
      console,
      setTimeout: (fn) => fn(),
      clearTimeout: () => {},
      HTMLButtonElement: MockElement,
      Element: MockElement,
      Node: MockElement,
      confirm: win.confirm,
      alert: (m) => win.alert(m),
      fetch: async (url, opts) => {
        fetchCalled = true;
        return fetchResponse;
      }
    };
    vm.createContext(sandbox);

    // Load compiled events module using vm.SourceTextModule
    let eventsModule;
    if (vm.SourceTextModule) {
      const code = fs.readFileSync(eventsPath, 'utf8');
      const mod = new vm.SourceTextModule(code, { context: sandbox });
      await mod.link(async (specifier) => {
        const empty = new vm.SourceTextModule('export default {}; export const $ = (id) => globalThis.document.getElementById(id); export const THRESHOLDS = {cpu:{warn:60,crit:80},mem:{warn:60,crit:80},swap:{warn:60,crit:80},disk:{warn:70,crit:85},temp:{warn:60,crit:75}}; export const fetchStatus = () => {};', { context: sandbox });
        await empty.link(() => {});
        await empty.evaluate();
        return empty;
      });
      await mod.evaluate();
      eventsModule = mod.namespace;
    } else {
      assert.fail('vm.SourceTextModule is required to test ES modules');
    }

    eventsModule.setupTorrentActions();

    // Trigger resume all with failed response
    alerted = null;
    resumeBtn.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
    await new Promise(r => setTimeout(r, 20));

    assert(alerted !== null, 'Expected alert() when bulk resume HTTP or success is false, but nothing was alerted');
  });

  // Test 2: Restart All uses full latest API process inventory, not filtered DOM rows
  await test('pm2-actions: Restart All uses full latest API process inventory not filtered DOM', async () => {
    // Contract: Restart All uses full latest API process inventory not filtered DOM, uses IDs (not names) and stop dashboard last
    // Baseline pm2-menu.ts:
    // const rows = document.querySelectorAll('#pm2-body tr[data-pm-id]');
    // const names = Array.from(rows).map(row => ...).filter(Boolean);
    // for (const name of names) { await fetch('/api/pm2/restart/' + encodeURIComponent(name)); }
    // When the user has searched or filtered the PM2 table, document.querySelectorAll('#pm2-body tr[data-pm-id]')
    // only contains visible rows! Filtered-out processes are omitted.
    const pm2MenuPath = path.join(distDir, 'client/pm2-actions.js');
    if (!fs.existsSync(pm2MenuPath)) {
      assert.fail(`File not found: ${pm2MenuPath}. Dist must be built.`);
    }

    const { doc, win, registerElement, body } = createMockEnvironment();
    const restartAllBtn = registerElement('restart-all-btn', new MockElement('BUTTON'));
    const pm2Body = registerElement('pm2-body', new MockElement('TBODY'));

    // Simulate filtered DOM: only 1 row displayed in DOM
    const tr1 = new MockElement('TR');
    tr1.setAttribute('data-pm-id', '1');
    const td1 = new MockElement('TD');
    const strong1 = new MockElement('STRONG');
    strong1.textContent = 'proc-1';
    td1.appendChild(strong1);
    tr1.appendChild(td1);
    pm2Body.appendChild(tr1);

    const restartedTargets = [];
    const sandbox = {
      window: win,
      document: doc,
      console,
      setTimeout: (fn) => fn(),
      clearTimeout: () => {},
      HTMLButtonElement: MockElement,
      Element: MockElement,
      Node: MockElement,
      confirm: () => true,
      alert: () => {},
      fetch: async (url, opts) => {
        if(url==='/api/status')return {ok:true,status:200,json:async()=>({pm2:[{id:3,name:'dashboard'},{id:1,name:'proc-1'},{id:2,name:'proc-2'}]})};
        restartedTargets.push(url);
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
    };
    vm.createContext(sandbox);

    let pm2MenuModule;
    if (vm.SourceTextModule) {
      const code = fs.readFileSync(pm2MenuPath, 'utf8');
      const mod = new vm.SourceTextModule(code, { context: sandbox });
      await mod.link(async (specifier) => {
        const empty = new vm.SourceTextModule('export default {}; export const $ = (id) => globalThis.document.getElementById(id); export const THRESHOLDS = {cpu:{warn:60,crit:80},mem:{warn:60,crit:80},swap:{warn:60,crit:80},disk:{warn:70,crit:85},temp:{warn:60,crit:75}}; export const fetchStatus = () => {};', { context: sandbox });
        await empty.link(() => {});
        await empty.evaluate();
        return empty;
      });
      await mod.evaluate();
      pm2MenuModule = mod.namespace;
    } else {
      assert.fail('vm.SourceTextModule is required');
    }

    pm2MenuModule.setupPM2Actions();

    // Trigger restart all
    await restartAllBtn.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
    await new Promise(r => setTimeout(r, 20));

    // Restart All is one server call. The server restarts the full PM2
    // inventory and restarts the dashboard last, so filtered DOM rows and
    // names cannot affect the target list.
    assert.deepStrictEqual(restartedTargets,['/api/pm2/restart-all'],'Restart All must make one server call for the full inventory');
  });

  // Test 3: Restart All bulk operation checks HTTP and success on each restart call
  await test('pm2-actions: Restart All checks HTTP status and success response', async () => {
    // Contract: bulk torrent and restart operations check HTTP and success
    // Baseline pm2-menu.ts:
    // for (const name of names) {
    //   await fetch('/api/pm2/restart/' + encodeURIComponent(name), { method: 'POST' });
    // }
    // Baseline completely ignores res.ok and data.success!
    const pm2MenuPath = path.join(distDir, 'client/pm2-actions.js');
    const { doc, win, registerElement } = createMockEnvironment();
    const restartAllBtn = registerElement('restart-all-btn', new MockElement('BUTTON'));
    const pm2Body = registerElement('pm2-body', new MockElement('TBODY'));

    const tr = new MockElement('TR');
    tr.setAttribute('data-pm-id', '1');
    const td = new MockElement('TD');
    const strong = new MockElement('STRONG');
    strong.textContent = 'app';
    td.appendChild(strong);
    tr.appendChild(td);
    pm2Body.appendChild(tr);

    let alerted = null;
    const sandbox = {
      window: win,
      document: doc,
      console,
      setTimeout: (fn) => fn(),
      clearTimeout: () => {},
      HTMLButtonElement: MockElement,
      Element: MockElement,
      Node: MockElement,
      confirm: () => true,
      alert: (m) => { alerted = m; },
      fetch: async url => url==='/api/status'?{ok:true,json:async()=>({pm2:[{id:1,name:'app'}]})}:({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: 'PM2 daemon unresponsive' })
      })
    };
    vm.createContext(sandbox);

    const code = fs.readFileSync(pm2MenuPath, 'utf8');
    const mod = new vm.SourceTextModule(code, { context: sandbox });
    await mod.link(async () => {
      const empty = new vm.SourceTextModule('export default {}; export const $ = (id) => globalThis.document.getElementById(id); export const THRESHOLDS = {cpu:{warn:60,crit:80},mem:{warn:60,crit:80},swap:{warn:60,crit:80},disk:{warn:70,crit:85},temp:{warn:60,crit:75}}; export const fetchStatus = () => {};', { context: sandbox });
      await empty.link(() => {});
      await empty.evaluate();
      return empty;
    });
    await mod.evaluate();

    mod.namespace.setupPM2Actions();
    await restartAllBtn.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
    await new Promise(r => setTimeout(r, 20));

    assert(alerted !== null, 'Expected error alert when restart operation returns HTTP failure or data.success: false');
  });

  // Test 4: Per-entity pending guard prevents duplicate mutations despite renders and releases on every terminal path
  await test('events & pm2-actions: per-entity pending guard blocks duplicates and releases on terminal paths', async () => {
    // Contract: per-entity pending guard prevents duplicate mutations despite renders; release every terminal path.
    // In baseline events.ts:
    // Only btn.disabled = true is set on the specific button element!
    // When a background render occurs (e.g. renderTorrents(data)), new button DOM nodes are created or innerHTML replaced,
    // completely bypassing btn.disabled and allowing concurrent duplicate mutations for the same hash/id!
    // In baseline pm2-menu.ts:
    // pm2ControlAction(name, action) does not even disable any button or track in-flight actions by entity ID/name!
    const pm2MenuPath = path.join(distDir, 'client/pm2-actions.js');
    const { doc, win } = createMockEnvironment();

    let fetchCount = 0;
    let resolveFetch;
    const pendingPromise = new Promise(resolve => { resolveFetch = resolve; });

    const sandbox = {
      window: win,
      document: doc,
      console,
      setTimeout: (fn) => fn(),
      clearTimeout: () => {},
      HTMLButtonElement: MockElement,
      Element: MockElement,
      Node: MockElement,
      confirm: () => true,
      alert: () => {},
      fetch: async () => {
        fetchCount++;
        await pendingPromise;
        return { ok: true, json: async () => ({ success: true }) };
      }
    };
    vm.createContext(sandbox);

    const code = fs.readFileSync(pm2MenuPath, 'utf8');
    const mod = new vm.SourceTextModule(code, { context: sandbox });
    await mod.link(async () => {
      const empty = new vm.SourceTextModule('export default {}; export const $ = (id) => globalThis.document.getElementById(id); export const THRESHOLDS = {cpu:{warn:60,crit:80},mem:{warn:60,crit:80},swap:{warn:60,crit:80},disk:{warn:70,crit:85},temp:{warn:60,crit:75}}; export const fetchStatus = () => {};', { context: sandbox });
      await empty.link(() => {});
      await empty.evaluate();
      return empty;
    });
    await mod.evaluate();

    const { pm2ControlAction } = mod.namespace;

    // Trigger action 1
    const p1 = pm2ControlAction('worker-1', 'restart');
    // Immediately trigger duplicate action 2 while action 1 is pending
    const p2 = pm2ControlAction('worker-1', 'restart');

    // If per-entity pending guard exists, fetchCount must be 1 (second call blocked/ignored)
    assert.strictEqual(fetchCount, 1, 'Duplicate mutation for the same entity while pending must be prevented');

    // Release promise and verify terminal path releases the guard
    resolveFetch();
    await Promise.all([p1, p2]);

    // Now a new action on worker-1 should be allowed
    const p3 = pm2ControlAction('worker-1', 'restart');
    assert.strictEqual(fetchCount, 2, 'Pending guard must be released after completion so subsequent actions succeed');
  });

  await test('events: successful mutation keeps the button disabled until the next render',async()=>{
    const {doc,win,registerElement}=createMockEnvironment();
    const list=registerElement('torrent-list',new MockElement('DIV')),btn=new MockElement('BUTTON');
    btn.className='torrent-action-btn';btn.dataset.action='pause';btn.dataset.hash='fixture';btn.innerHTML='pause';list.appendChild(btn);
    const context=vm.createContext({document:doc,window:win,Element:MockElement,HTMLButtonElement:MockElement,console,confirm:()=>true,alert:()=>{},setTimeout:()=>1,fetch:async()=>({ok:true,json:async()=>({success:true})})});
    const mod=new vm.SourceTextModule(fs.readFileSync(path.join(distDir,'client/events.js'),'utf8'),{context});
    await mod.link(async()=>{const stub=new vm.SourceTextModule('export const $=id=>document.getElementById(id);export const fetchStatus=()=>{};',{context});await stub.link(()=>{});return stub;});await mod.evaluate();mod.namespace.setupTorrentActions();
    list.dispatchEvent({type:'click',target:btn,preventDefault(){},stopPropagation(){}});await new Promise(r=>setTimeout(r,0));
    assert.strictEqual(btn.disabled,true,'Successful action must leave the button disabled for the next render');
    assert.strictEqual(btn.getAttribute('aria-disabled'),'true','aria-disabled must stay set until the row re-renders');
  });

  // Test 5: Alerts safely render dynamic sensor and process names using textContent (prevent XSS)
  await test('alerts: safely render dynamic names with textContent instead of innerHTML injection', async () => {
    // Contract: Alerts use textContent for dynamic message and update existing banner messages.
    // Baseline ui/alerts.ts:
    // banner.innerHTML = `
    //   <span class="alert-icon">...</span>
    //   <span class="alert-message">${a.message}</span>
    // `;
    // Where message is constructed from dynamic names:
    // `High temperature: ${sensor.name} is ${sensor.temp}°C`
    // `PM2 process errored: '${p.name}'`
    // If a sensor or PM2 process has a name like `<img src=x onerror=alert(1)>`,
    // it gets injected directly into banner.innerHTML!
    const alertsPath = path.join(distDir, 'client/ui/alerts.js');
    if (!fs.existsSync(alertsPath)) {
      assert.fail(`File not found: ${alertsPath}. Dist must be built.`);
    }

    const { doc, win, body } = createMockEnvironment();
    const sandbox = {
      window: win,
      document: doc,
      console,
      setTimeout: (fn) => fn(),
      clearTimeout: () => {},
      Notification: class {
        static get permission() { return 'denied'; }
      },
      HTMLElement: MockElement,
      Element: MockElement
    };
    vm.createContext(sandbox);

    let alertsModule;
    if (vm.SourceTextModule) {
      const code = fs.readFileSync(alertsPath, 'utf8');
      const mod = new vm.SourceTextModule(code, { context: sandbox });
      await mod.link(async () => {
        const empty = new vm.SourceTextModule('export default {}; export const $ = (id) => globalThis.document.getElementById(id); export const THRESHOLDS = {cpu:{warn:60,crit:80},mem:{warn:60,crit:80},swap:{warn:60,crit:80},disk:{warn:70,crit:85},temp:{warn:60,crit:75}};', { context: sandbox });
        await empty.link(() => {});
        await empty.evaluate();
        return empty;
      });
      await mod.evaluate();
      alertsModule = mod.namespace;
    } else {
      assert.fail('vm.SourceTextModule is required');
    }

    const maliciousName = '<img src="x" onerror="evil()">&payload';
    alertsModule.checkAlerts({
      pm2: [{
        id: 1,
        name: maliciousName,
        status: 'errored',
        cpu: 0,
        memory: 0,
        restarts: 1
      }]
    });

    const container = doc.getElementById('alerts-container');
    assert(container, 'alerts-container should be created');
    const msgEl = container.querySelector('.alert-message');
    assert(msgEl, 'alert-message element should exist');

    // Contract: Alerts use textContent for dynamic message.
    // If msgEl was populated via innerHTML interpolation, raw '<img' tags would exist in its DOM or unescaped HTML.
    // In our MockElement, textContent setter escapes HTML or preserves raw text safely.
    // Check that msgEl.textContent equals the full message and does not contain raw unescaped child elements.
    assert(msgEl.children.length === 0, 'Dynamic alert message should not create HTML child elements via innerHTML injection');
    assert(msgEl.textContent.includes(maliciousName), 'Alert message must faithfully contain the process name as text');
  });

  // Test 6: Alerts update existing banner messages when alert values change
  await test('alerts: update existing banner messages when alert content changes', async () => {
    // Contract: Alerts use textContent for dynamic message and update existing banner messages.
    // Baseline ui/alerts.ts:
    // alerts.forEach(a => {
    //   if (!existingKeys.has(a.key)) {
    //     // create new banner
    //   }
    // });
    // If an alert already exists (e.g. ram_high or temp_CPU), baseline skips it completely!
    // If the temperature changes from 82°C to 95°C, or RAM from 96% to 99%,
    // existingKeys.has(a.key) is true, so the banner is NEVER updated with the new value!
    const alertsPath = path.join(distDir, 'client/ui/alerts.js');
    const { doc, win } = createMockEnvironment();
    const sandbox = {
      window: win,
      document: doc,
      console,
      setTimeout: (fn) => fn(),
      clearTimeout: () => {},
      Notification: class {
        static get permission() { return 'denied'; }
      },
      HTMLElement: MockElement,
      Element: MockElement
    };
    vm.createContext(sandbox);

    const code = fs.readFileSync(alertsPath, 'utf8');
    const mod = new vm.SourceTextModule(code, { context: sandbox });
    await mod.link(async () => {
      const empty = new vm.SourceTextModule('export default {}; export const $ = (id) => globalThis.document.getElementById(id); export const THRESHOLDS = {cpu:{warn:60,crit:80},mem:{warn:60,crit:80},swap:{warn:60,crit:80},disk:{warn:70,crit:85},temp:{warn:60,crit:75}};', { context: sandbox });
      await empty.link(() => {});
      await empty.evaluate();
      return empty;
    });
    await mod.evaluate();

    const { checkAlerts } = mod.namespace;

    // First alert: 82°C
    checkAlerts({
      thermal: [{ name: 'Core0', temp: 82 }]
    });

    const container = doc.getElementById('alerts-container');
    assert(container, 'alerts-container should exist');
    let banner = container.querySelector('[data-alert-key="temp_Core0"]');
    assert(banner, 'temp_Core0 banner should exist');
    assert(banner.querySelector('.alert-message').textContent.includes('82°C'), 'Initial message should show 82°C');

    // Second check: temperature rises to 95°C
    checkAlerts({
      thermal: [{ name: 'Core0', temp: 95 }]
    });

    banner = container.querySelector('[data-alert-key="temp_Core0"]');
    assert(banner, 'temp_Core0 banner should still exist');
    const updatedText = banner.querySelector('.alert-message').textContent;
    assert(updatedText.includes('95°C'), `Existing banner message must be updated to 95°C, but was: "${updatedText}"`);
  });

  // Test 7: Preserves user confirmations for destructive actions
  await test('pm2-actions & events: preserve user confirmations for destructive actions', async () => {
    // Contract: Preserve user confirmations.
    // Ensure confirm dialog is prompted before delete, and action cancelled if user rejects.
    const eventsPath = path.join(distDir, 'client/events.js');
    const { doc, win, registerElement } = createMockEnvironment();

    let confirmPrompted = false;
    win.confirm = (msg) => {
      confirmPrompted = true;
      return false; // User cancels!
    };

    let fetchCalled = false;
    const torrentList = registerElement('torrent-list', new MockElement('DIV'));
    const deleteBtn = new MockElement('BUTTON');
    deleteBtn.className = 'torrent-action-btn';
    deleteBtn.dataset.action = 'delete';
    deleteBtn.dataset.hash = 'hash123';
    deleteBtn.dataset.name = 'Test Torrent';
    torrentList.appendChild(deleteBtn);

    const sandbox = {
      window: win,
      document: doc,
      console,
      setTimeout: (fn) => fn(),
      clearTimeout: () => {},
      HTMLButtonElement: MockElement,
      Element: MockElement,
      Node: MockElement,
      confirm: (m) => win.confirm(m),
      alert: () => {},
      fetch: async () => {
        fetchCalled = true;
        return { ok: true, json: async () => ({ success: true }) };
      }
    };
    vm.createContext(sandbox);

    const code = fs.readFileSync(eventsPath, 'utf8');
    const mod = new vm.SourceTextModule(code, { context: sandbox });
    await mod.link(async () => {
      const empty = new vm.SourceTextModule('export default {}; export const $ = (id) => globalThis.document.getElementById(id); export const THRESHOLDS = {cpu:{warn:60,crit:80},mem:{warn:60,crit:80},swap:{warn:60,crit:80},disk:{warn:70,crit:85},temp:{warn:60,crit:75}}; export const fetchStatus = () => {};', { context: sandbox });
      await empty.link(() => {});
      await empty.evaluate();
      return empty;
    });
    await mod.evaluate();

    mod.namespace.setupTorrentActions();

    torrentList.dispatchEvent({
      type: 'click',
      target: deleteBtn,
      preventDefault: () => {},
      stopPropagation: () => {}
    });

    assert(confirmPrompted, 'Confirmation prompt must be shown before deleting torrent');
    assert(!fetchCalled, 'Mutation must not proceed if user rejects confirmation');
  });

  console.log(`\nResults: ${passedTests} passed, ${failedTests} failed.`);
}

// Execute tests if invoked directly
if (require.main === module) {
  runTests()
    .then(() => {
      // Exit explicitly to work around host libuv bugs if any
      process.exit(failedTests > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Fatal test error:', err);
      process.exit(1);
    });
}

module.exports = { runTests };
