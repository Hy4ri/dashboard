/**
 * tests/frontend-render.cjs
 *
 * Render contract tests for Monit dashboard:
 * - Section 3 & 5 of monit-cleanup-contract.md:
 *   1. PM2: raw textContent PM2 names (safe against punctuation/escaping bugs),
 *      empty payload resets filters/cache/counts, avoids rewriting identical action cells.
 *   2. Torrents: node retention keyed by hash, unchanged buttons retain pending/disabled state/focus,
 *      state classification for seeding (qB states uploading, stalledUP, queuedUP, forcedUP; paused states not seeding; no ratio inference),
 *      escape state labels, empty list resets.
 *   3. AI / Antigravity: absent windows show "Unknown", not "100%", no fabricated model/plan/traffic/credits labels.
 *
 * Loads compiled ES modules from MONIT_TEST_DIST (defaults to ./dist) in a DOM environment.
 * Runs behavioral assertions and exits with code 0 on success, code 1 on failure.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIST_DIR = process.env.MONIT_TEST_DIST || path.resolve(__dirname, '../dist');

let failedTests = 0;
let passedTests = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.stack || err.message}`);
    failedTests++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.stack || err.message}`);
    failedTests++;
  }
}

/**
 * Minimal realistic DOM implementation for testing rendering contracts without external bloat
 */
function createMinimalDOM(initialHtml = '') {
  let elementIdMap = new Map();

  class Node {
    constructor(nodeType, nodeName) {
      this.nodeType = nodeType;
      this.nodeName = nodeName;
      this.parentNode = null;
      this.childNodes = [];
    }

    appendChild(child) {
      if (child.parentNode) {
        child.parentNode.removeChild(child);
      }
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }

    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx !== -1) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }

    replaceChild(newChild, oldChild) {
      const idx = this.childNodes.indexOf(oldChild);
      if (idx !== -1) {
        if (newChild.parentNode) {
          newChild.parentNode.removeChild(newChild);
        }
        this.childNodes[idx] = newChild;
        newChild.parentNode = this;
        oldChild.parentNode = null;
      }
      return oldChild;
    }

    remove() {
      if (this.parentNode) {
        this.parentNode.removeChild(this);
      }
    }
  }

  class TextNode extends Node {
    constructor(text = '') {
      super(3, '#text');
      this._textContent = String(text);
    }

    get textContent() {
      return this._textContent;
    }

    set textContent(val) {
      this._textContent = String(val);
    }
  }

  class Element extends Node {
    constructor(tagName) {
      super(1, tagName.toUpperCase());
      this.tagName = tagName.toUpperCase();
      this.attributes = new Map();
      this.classList = new ClassList(this);
      this.style = {};
      this.listeners = new Map();
      this.dataset = {};
    }

    get children() { return this.childNodes.filter(child=>child.nodeType===1); }
    get firstElementChild() { return this.children[0] || null; }
    insertBefore(child, reference) {
      if(child===reference)return child;
      if(child.parentNode)child.parentNode.removeChild(child);
      const index=reference?this.childNodes.indexOf(reference):-1;
      child.parentNode=this;
      if(index<0)this.childNodes.push(child);else this.childNodes.splice(index,0,child);
      return child;
    }

    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    setAttribute(name, val) {
      const strVal = String(val);
      this.attributes.set(name, strVal);
      if (name === 'id') {
        elementIdMap.set(strVal, this);
      }
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = strVal;
      }
      if (name === 'class') {
        this.classList._syncFromAttr(strVal);
      }
    }

    removeAttribute(name) {
      this.attributes.delete(name);
      if (name === 'id') {
        for (const [id, el] of elementIdMap.entries()) {
          if (el === this) elementIdMap.delete(id);
        }
      }
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        delete this.dataset[key];
      }
    }

    hasAttribute(name) {
      return this.attributes.has(name);
    }

    get id() {
      return this.getAttribute('id') || '';
    }

    set id(val) {
      this.setAttribute('id', val);
    }

    get className() {
      return this.getAttribute('class') || '';
    }

    set className(val) {
      this.setAttribute('class', val);
      this.classList._syncFromAttr(val);
    }

    get title() {
      return this.getAttribute('title') || '';
    }

    set title(val) {
      this.setAttribute('title', val);
    }

    get textContent() {
      let text = '';
      for (const child of this.childNodes) {
        if (child.nodeType === 3) {
          text += child.textContent;
        } else if (child.nodeType === 1) {
          text += child.textContent;
        }
      }
      return text;
    }

    set textContent(val) {
      this.childNodes = [];
      const textNode = new TextNode(val);
      textNode.parentNode = this;
      this.childNodes.push(textNode);
    }

    get innerHTML() {
      return serializeHTML(this);
    }

    set innerHTML(html) {
      this.childNodes = [];
      parseHTMLFragment(html, this, elementIdMap);
    }

    addEventListener(event, listener) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push(listener);
    }

    removeEventListener(event, listener) {
      if (this.listeners.has(event)) {
        const list = this.listeners.get(event).filter(l => l !== listener);
        this.listeners.set(event, list);
      }
    }

    dispatchEvent(evt) {
      evt.target = this;
      let curr = this;
      while (curr) {
        evt.currentTarget = curr;
        const list = curr.listeners.get(evt.type) || [];
        for (const l of list) {
          l(evt);
          if (evt._stopped) return;
        }
        curr = curr.parentNode;
      }
    }

    querySelector(selector) {
      const results = this.querySelectorAll(selector);
      return results.length > 0 ? results[0] : null;
    }

    querySelectorAll(selector) {
      const matches = [];
      walk(this, (node) => {
        if (node.nodeType === 1 && matchesSelector(node, selector)) {
          matches.push(node);
        }
      });
      return matches;
    }

    closest(selector) {
      let curr = this;
      while (curr && curr.nodeType === 1) {
        if (matchesSelector(curr, selector)) return curr;
        curr = curr.parentNode;
      }
      return null;
    }
  }

  class HTMLInputElement extends Element {
    constructor() {
      super('INPUT');
      this._value = '';
    }

    get value() {
      return this._value;
    }

    set value(v) {
      this._value = String(v);
    }
  }

  class HTMLButtonElement extends Element {
    constructor() {
      super('BUTTON');
      this.disabled = false;
    }
  }

  class ClassList {
    constructor(element) {
      this.element = element;
      this.classes = new Set();
    }

    _syncFromAttr(val) {
      this.classes.clear();
      if (val) {
        val.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
      }
    }

    _syncToAttr() {
      this.element.attributes.set('class', Array.from(this.classes).join(' '));
    }

    add(...cls) {
      cls.forEach(c => this.classes.add(c));
      this._syncToAttr();
    }

    remove(...cls) {
      cls.forEach(c => this.classes.delete(c));
      this._syncToAttr();
    }

    contains(c) {
      return this.classes.has(c);
    }

    toggle(c, force) {
      if (force !== undefined) {
        if (force) this.add(c);
        else this.remove(c);
      } else {
        if (this.contains(c)) this.remove(c);
        else this.add(c);
      }
    }
  }

  function matchesSelector(el, sel) {
    sel = sel.trim();
    if (sel.includes(',')) return sel.split(',').some(part=>matchesSelector(el,part));
    if (sel.includes(' ')) {
      const parts=sel.split(/\s+/);let curr=el;
      if(!matchesSelector(curr,parts.pop())) return false;
      while(parts.length){const part=parts.pop();curr=curr.parentNode;while(curr&&!matchesSelector(curr,part))curr=curr.parentNode;if(!curr)return false;}
      return true;
    }
    if (sel.startsWith('#')) {
      return el.getAttribute('id') === sel.slice(1);
    }
    const compound=sel.match(/^((?:\.[\w-]+)+)(\[.*\])?$/);
    if(compound)return compound[1].slice(1).split('.').every(c=>el.classList.contains(c))&&(!compound[2]||matchesSelector(el,compound[2]));
    const not=sel.match(/^([a-z]+)?:not\((.*)\)$/);
    if(not)return (!not[1]||el.tagName===not[1].toUpperCase())&&!matchesSelector(el,not[2]);
    // Simple tag[attr="val"]
    const attrMatch = sel.match(/^([a-z0-9_-]+)?\[([a-z0-9_-]+)(?:=([\"\']?)([^\"\'\]]+)\3)?\]$/i);
    if (attrMatch) {
      const [, tag, attr, , val] = attrMatch;
      if (tag && el.tagName !== tag.toUpperCase()) return false;
      if (!el.hasAttribute(attr)) return false;
      if (val !== undefined && el.getAttribute(attr) !== val) return false;
      return true;
    }
    // Tag match
    if (/^[a-z0-9]+$/i.test(sel)) {
      return el.tagName === sel.toUpperCase();
    }
    // Multiple classes or complex: split by space/combinators if needed
    if (sel.includes(' ')) {
      const parts = sel.split(/\s+/);
      let curr = el;
      for (let i = parts.length - 1; i >= 0; i--) {
        if (!curr || !matchesSelector(curr, parts[i])) return false;
        curr = curr.parentNode;
      }
      return true;
    }
    return false;
  }

  function walk(root, fn) {
    for (const child of root.childNodes) {
      fn(child);
      if (child.childNodes && child.childNodes.length > 0) {
        walk(child, fn);
      }
    }
  }

  function serializeHTML(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out += child.textContent;
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        let attrs = '';
        for (const [k, v] of child.attributes.entries()) {
          attrs += ` ${k}="${v.replace(/"/g, '&quot;')}"`;
        }
        if (['input', 'img', 'br', 'hr'].includes(tag)) {
          out += `<${tag}${attrs}>`;
        } else {
          out += `<${tag}${attrs}>${serializeHTML(child)}</${tag}>`;
        }
      }
    }
    return out;
  }

  function parseHTMLFragment(html, parentNode, idMap) {
    if (!html) return;
    const regex = /<([a-z0-9]+)((?:\s+[a-z0-9_-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|<\/([a-z0-9]+)>/gi;
    let match;
    let current = parentNode;
    const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

    while ((match = regex.exec(html)) !== null) {
      const [full, openTag, rawAttrs, isSelfClose, textContent, closeTag] = match;
      if (textContent) {
        const txtNode = new TextNode(decodeEntities(textContent));
        current.appendChild(txtNode);
      } else if (openTag) {
        const tagName = openTag.toLowerCase();
        let el;
        if (tagName === 'input') el = new HTMLInputElement();
        else if (tagName === 'button') el = new HTMLButtonElement();
        else el = new Element(tagName);

        if (rawAttrs) {
          const attrRegex = /([a-z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi;
          let attrMatch;
          while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
            const attrName = attrMatch[1];
            const attrVal = attrMatch[2] !== undefined ? attrMatch[2] :
              (attrMatch[3] !== undefined ? attrMatch[3] : (attrMatch[4] !== undefined ? attrMatch[4] : ''));
            el.setAttribute(attrName, decodeEntities(attrVal));
          }
        }

        current.appendChild(el);
        if (el.id) idMap.set(el.id, el);

        if (!isSelfClose && !voidTags.has(tagName)) {
          current = el;
        }
      } else if (closeTag) {
        if (current !== parentNode && current.parentNode) {
          current = current.parentNode;
        }
      }
    }
  }

  function decodeEntities(str) {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  const document = {
    getElementById(id) {
      return elementIdMap.get(id) || null;
    },
    querySelector(sel) {
      if (sel.startsWith('#') && !sel.includes(' ') && !sel.includes('.')) {
        return elementIdMap.get(sel.slice(1)) || null;
      }
      const results = this.querySelectorAll(sel);
      return results.length > 0 ? results[0] : null;
    },
    querySelectorAll(sel) {
      const matches = [];
      for (const el of elementIdMap.values()) {
        walk(el, (node) => {
          if (node.nodeType === 1 && matchesSelector(node, sel) && !matches.includes(node)) {
            matches.push(node);
          }
        });
        if (matchesSelector(el, sel) && !matches.includes(el)) {
          matches.push(el);
        }
      }
      return matches;
    },
    createElement(tagName) {
      tagName = tagName.toLowerCase();
      if (tagName === 'input') return new HTMLInputElement();
      if (tagName === 'button') return new HTMLButtonElement();
      return new Element(tagName);
    },
    createTextNode(text) {
      return new TextNode(text);
    },
    body: new Element('BODY'),
  };

  const window = {
    document,
    Element,
    Node,
    HTMLInputElement,
    HTMLButtonElement,
    Date,
    Math,
    parseInt,
    parseFloat,
    String,
    Number,
    Boolean,
    Set,
    Map,
    Array,
    Object,
    console,
  };

  if (initialHtml) {
    parseHTMLFragment(initialHtml, document.body, elementIdMap);
  }

  return { document, window, elementIdMap };
}

/**
 * Standard Dashboard DOM skeleton from index.html
 */
const BASE_HTML = `
  <div id="pm2-card">
    <input type="text" id="pm2-search" />
    <div id="pm2-filter-pills">
      <button class="filter-pill active" data-filter="all">All <span id="filter-count-all">0</span></button>
      <button class="filter-pill" data-filter="online">Online <span id="filter-count-online">0</span></button>
      <button class="filter-pill" data-filter="errored">Errored <span id="filter-count-errored">0</span></button>
      <button class="filter-pill" data-filter="stopped">Stopped <span id="filter-count-stopped">0</span></button>
    </div>
    <table>
      <thead>
        <tr><th>Name</th><th>CPU</th><th>Memory</th><th>Actions</th></tr>
      </thead>
      <tbody id="pm2-body"></tbody>
    </table>
  </div>
  <div id="torrent-card">
    <span id="torrent-count"></span>
    <div id="torrent-filter-pills">
      <button class="filter-pill active" data-filter="all">All <span id="torrent-count-all">0</span></button>
      <button class="filter-pill" data-filter="downloading">Down <span id="torrent-count-down">0</span></button>
      <button class="filter-pill" data-filter="seeding">Seed <span id="torrent-count-seed">0</span></button>
      <button class="filter-pill" data-filter="paused">Paused <span id="torrent-count-pause">0</span></button>
    </div>
    <div id="torrent-list"></div>
  </div>
  <div id="antigravity-card" style="display:none">
    <div id="antigravity-content"></div>
  </div>
`;

/**
 * ES Module loader with vm.SourceTextModule for compiled dist modules
 */
async function loadModule(modulePath, mockContext) {
  const code = fs.readFileSync(modulePath, 'utf8');
  const context = vm.createContext(mockContext);

  const mod = new vm.SourceTextModule(code, {
    context,
    identifier: modulePath,
    initializeImportMeta(meta) {
      meta.url = `file://${modulePath}`;
    },
    importModuleDynamically(specifier, referrer) {
      throw new Error(`Dynamic import not supported: ${specifier}`);
    }
  });

  const linker = async (specifier, referencingModule) => {
    if (specifier.endsWith('/pm2-actions.js') || specifier.endsWith('/logs-modal.js')) {
      const stub=new vm.SourceTextModule('export const showLogsModal=()=>{};export const pm2ControlAction=()=>{};', {context});
      await stub.link(()=>{}); return stub;
    }
    let resolvedPath;
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      resolvedPath = path.resolve(path.dirname(referencingModule.identifier), specifier);
      if (!fs.existsSync(resolvedPath) && fs.existsSync(resolvedPath + '.js')) {
        resolvedPath += '.js';
      }
    } else {
      resolvedPath = path.resolve(DIST_DIR, specifier);
    }

    if (fs.existsSync(resolvedPath)) {
      const depCode = fs.readFileSync(resolvedPath, 'utf8');
      const depMod = new vm.SourceTextModule(depCode, {
        context,
        identifier: resolvedPath,
      });
      await depMod.link(linker);
      await depMod.evaluate();
      return depMod;
    }

    // Default stub module
    return new vm.SourceTextModule(`
      export const showLogsModal = () => {};
      export const pm2ControlAction = () => {};
      export const fmtBytes = (b) => b + ' B';
      export const fmtBytesRate = (b) => b + ' B/s';
      export const NONE = '—';
    `, { context });
  };

  await mod.link(linker);
  await mod.evaluate();
  return mod.namespace;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite Execution
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nRunning Monit Frontend Render Contract Tests`);
  console.log(`Testing compiled output from MONIT_TEST_DIST: ${DIST_DIR}\n`);

  const pm2ModulePath = path.join(DIST_DIR, 'client/ui/pm2.js');
  const torrentsModulePath = path.join(DIST_DIR, 'client/ui/torrents.js');
  const antigravityModulePath = path.join(DIST_DIR, 'client/ui/antigravity.js');

  if (!fs.existsSync(pm2ModulePath) || !fs.existsSync(torrentsModulePath) || !fs.existsSync(antigravityModulePath)) {
    console.error(`ERROR: Compiled dist files not found in ${DIST_DIR}. Ensure MONIT_TEST_DIST points to compiled client output.`);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 1. PM2 Render Contract
  // ---------------------------------------------------------------------------
  console.log('[PM2 Render Contract]');

  await testAsync('PM2 name punctuation & HTML characters use raw textContent without escaping artefacts', async () => {
    const { document, window } = createMinimalDOM(BASE_HTML);
    const pm2Module = await loadModule(pm2ModulePath, window);

    const testProcesses = [
      { id: 1, name: 'api<prod>&service', status: 'online', cpu: 1.2, memory: 50000000, restarts: 0, pid: 123 },
      { id: 2, name: 'quotes"and\'apostrophes', status: 'online', cpu: 0.5, memory: 20000000, restarts: 0, pid: 124 },
    ];

    pm2Module.renderPM2(testProcesses);
    pm2Module.renderPM2(testProcesses);

    const tbody = document.getElementById('pm2-body');
    const rows = tbody.querySelectorAll('tr[data-pm-id]');
    assert(rows.length === 2, `Expected 2 rows, found ${rows.length}`);

    // Verify cell 0 name textContent contains exact punctuation and NOT escaped HTML entities
    const row0 = rows[0];
    const strong0 = row0.querySelector('strong');
    assert(strong0, 'Strong element for process name must exist');
    assert(strong0.textContent === 'api<prod>&service',
      `Process name should preserve raw characters via textContent. Found "${strong0.textContent}" instead of "api<prod>&service"`);

    // Verify second process
    const row1 = rows[1];
    const strong1 = row1.querySelector('strong');
    assert(strong1.textContent === "quotes\"and\'apostrophes",
      `Process name with quotes must match raw string. Found "${strong1.textContent}"`);
  });

  await testAsync('PM2 empty or null data resets filter counts, cache and shows empty message', async () => {
    const { document, window } = createMinimalDOM(BASE_HTML);
    const pm2Module = await loadModule(pm2ModulePath, window);

    // Initial render with processes
    pm2Module.renderPM2([
      { id: 1, name: 'worker-1', status: 'online', cpu: 0, memory: 1000, restarts: 0, pid: 1 },
      { id: 2, name: 'worker-2', status: 'stopped', cpu: 0, memory: 1000, restarts: 0, pid: 2 },
      { id: 3, name: 'worker-3', status: 'errored', cpu: 0, memory: 1000, restarts: 0, pid: 3 }
    ]);

    assert(document.getElementById('filter-count-all').textContent === '3', 'Total count should be 3');
    assert(document.getElementById('filter-count-online').textContent === '1', 'Online count should be 1');

    // Render empty / null
    pm2Module.renderPM2([]);

    const tbody = document.getElementById('pm2-body');
    assert(tbody.innerHTML.includes('No processes monitored'), 'Empty message must be rendered');

    // Empty reset contract: counts should be reset to 0
    const countAll = document.getElementById('filter-count-all').textContent;
    assert(countAll === '0', `Filter count for all should be reset to 0 on empty data, got: ${countAll}`);
    assert(document.getElementById('filter-count-online').textContent === '0', 'Online count should be reset to 0');
    assert(document.getElementById('filter-count-errored').textContent === '0', 'Errored count should be reset to 0');
    assert(document.getElementById('filter-count-stopped').textContent === '0', 'Stopped count should be reset to 0');
  });

  await testAsync('PM2 row patching preserves action cell DOM elements when actions unchanged', async () => {
    const { document, window } = createMinimalDOM(BASE_HTML);
    const pm2Module = await loadModule(pm2ModulePath, window);

    const initial = [
      { id: 1, name: 'app-service', status: 'online', cpu: 1.0, memory: 2000, restarts: 0, pid: 100 }
    ];

    pm2Module.renderPM2(initial);

    const tbody = document.getElementById('pm2-body');
    const firstRow = tbody.querySelector('tr[data-pm-id="1"]');
    const actionCell = firstRow.querySelectorAll('td')[3];
    assert(actionCell, 'Action cell must exist');

    // Attach a sentinel property on the action cell or its buttons to detect unnecessary overwrites
    actionCell._sentinelKeep = 'persisted';
    const firstBtn = actionCell.querySelector('button');
    if (firstBtn) firstBtn._btnSentinel = 'kept';

    // Render updated CPU and memory, same status and name
    const updated = [
      { id: 1, name: 'app-service', status: 'online', cpu: 4.5, memory: 3500, restarts: 0, pid: 100 }
    ];

    pm2Module.renderPM2(updated);

    // Contract: avoid rewriting identical action cells
    assert(actionCell._sentinelKeep === 'persisted', 'Action cell container should not be replaced if action state is unchanged');
    if (firstBtn) {
      assert(actionCell.querySelector('button') === firstBtn, 'Action buttons should be retained and not re-created with innerHTML when unchanged');
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Torrents Render Contract
  // ---------------------------------------------------------------------------
  console.log('\n[Torrents Render Contract]');

  await testAsync('Torrents state classification classifies qB upload states as seeding and paused states as not seeding without ratio inference', async () => {
    const { document, window } = createMinimalDOM(BASE_HTML);
    const torrentsModule = await loadModule(torrentsModulePath, window);

    const testTorrents = [
      // qB active upload states -> seeding
      { hash: 'h1', name: 't1', progress: 1.0, state: 'uploading', dlspeed: 0, upspeed: 100, ratio: 0.5, size: 1000, num_seeds: 0, num_peers: 5, eta: 0 },
      { hash: 'h2', name: 't2', progress: 1.0, state: 'stalledUP', dlspeed: 0, upspeed: 0, ratio: 0.1, size: 1000, num_seeds: 0, num_peers: 0, eta: 0 },
      { hash: 'h3', name: 't3', progress: 1.0, state: 'queuedUP', dlspeed: 0, upspeed: 0, ratio: 0.2, size: 1000, num_seeds: 0, num_peers: 0, eta: 0 },
      { hash: 'h4', name: 't4', progress: 1.0, state: 'forcedUP', dlspeed: 0, upspeed: 50, ratio: 0.3, size: 1000, num_seeds: 0, num_peers: 2, eta: 0 },

      // Paused state even with progress 1.0 or ratio > 0 must NOT be counted as seeding
      { hash: 'h5', name: 't5', progress: 1.0, state: 'pausedUP', dlspeed: 0, upspeed: 0, ratio: 5.0, size: 1000, num_seeds: 0, num_peers: 0, eta: 0 },
      { hash: 'h6', name: 't6', progress: 0.8, state: 'pausedDL', dlspeed: 0, upspeed: 0, ratio: 2.0, size: 1000, num_seeds: 0, num_peers: 0, eta: 0 },

      // Downloading state with ratio > 0 must NOT be classified as seeding based on ratio inference
      { hash: 'h7', name: 't7', progress: 0.5, state: 'downloading', dlspeed: 500, upspeed: 10, ratio: 1.5, size: 1000, num_seeds: 10, num_peers: 5, eta: 100 }
    ];

    torrentsModule.renderTorrents(testTorrents);

    const seedCountEl = document.getElementById('torrent-count-seed');
    assert(seedCountEl, 'Seed count element must exist');

    // Contract: classify seeding by qB state uploading/stalledUP/queuedUP/forcedUP; paused states not seeding; no ratio inference
    // Expected seeding: h1, h2, h3, h4 = 4 items
    assert(seedCountEl.textContent === '4',
      `Expected 4 seeding torrents based on qB upload states, got ${seedCountEl.textContent}. Paused or downloading torrents with ratio > 0 must not infer seeding.`);

    const pauseCountEl = document.getElementById('torrent-count-pause');
    assert(pauseCountEl.textContent === '2', `Expected 2 paused torrents, got ${pauseCountEl.textContent}`);

    const downCountEl = document.getElementById('torrent-count-down');
    assert(downCountEl.textContent === '1', `Expected 1 downloading torrent (h7), got ${downCountEl.textContent}`);
  });

  await testAsync('Torrents node retention keeps elements keyed by hash so pending/disabled button state survives', async () => {
    const { document, window } = createMinimalDOM(BASE_HTML);
    const torrentsModule = await loadModule(torrentsModulePath, window);

    const initial = [
      { hash: 'hash-abc', name: 'Linux ISO', progress: 0.3, state: 'downloading', dlspeed: 100, upspeed: 10, ratio: 0.1, size: 1000, num_seeds: 1, num_peers: 1, eta: 50 },
      { hash: 'hash-xyz', name: 'Data Archive', progress: 0.7, state: 'downloading', dlspeed: 200, upspeed: 20, ratio: 0.2, size: 2000, num_seeds: 2, num_peers: 2, eta: 20 }
    ];

    torrentsModule.renderTorrents(initial);

    const list = document.getElementById('torrent-list');
    const items = list.querySelectorAll('.torrent-item');
    assert(items.length === 2, `Expected 2 torrent items, found ${items.length}`);

    // Simulate an action button being pending/disabled by user interaction or actions contract
    const actionBtn = items[0].querySelector('button[data-action="pause"], button[data-action="resume"]');
    assert(actionBtn, 'Pause/resume button must exist in torrent item');
    actionBtn.disabled = true;
    actionBtn.setAttribute('data-pending', 'true');
    actionBtn._inFlightOperation = 'pause-pending';

    // Rerender with progress update but same state/hash
    const nextUpdate = [
      { hash: 'hash-abc', name: 'Linux ISO', progress: 0.35, state: 'downloading', dlspeed: 120, upspeed: 15, ratio: 0.11, size: 1000, num_seeds: 1, num_peers: 1, eta: 45 },
      { hash: 'hash-xyz', name: 'Data Archive', progress: 0.75, state: 'downloading', dlspeed: 210, upspeed: 25, ratio: 0.22, size: 2000, num_seeds: 2, num_peers: 2, eta: 15 }
    ];

    torrentsModule.renderTorrents(nextUpdate);

    // Contract: keep nodes keyed hash and unchanged buttons so pending disabled state/focus survives
    const updatedItems = list.querySelectorAll('.torrent-item');
    const updatedBtn = updatedItems[0].querySelector('button[data-action="pause"], button[data-action="resume"]');

    assert(updatedBtn, 'Button must remain in updated list');
    assert(updatedBtn.disabled === true, 'Button disabled state must survive across re-renders when keyed by hash');
    assert(updatedBtn.getAttribute('data-pending') === 'true', 'Pending attribute must survive across re-renders');
    assert(updatedBtn._inFlightOperation === 'pause-pending', 'Pending operation state on button DOM must not be blown away by innerHTML overwrite');
  });

  await testAsync('Torrents state labels are escaped and safe against script injection', async () => {
    const { document, window } = createMinimalDOM(BASE_HTML);
    const torrentsModule = await loadModule(torrentsModulePath, window);

    const maliciousTorrent = [
      { hash: 'sec-hash', name: 'test-torrent', progress: 0.5, state: '<script>alert(1)</script>', dlspeed: 0, upspeed: 0, ratio: 0, size: 500, num_seeds: 0, num_peers: 0, eta: 0 }
    ];

    torrentsModule.renderTorrents(maliciousTorrent);

    const list = document.getElementById('torrent-list');
    const statePill = list.querySelector('.torrent-state-pill');
    assert(statePill, 'State pill must exist');

    assert(!statePill.querySelector('script'), 'Script element must not be created in state label');
    assert(statePill.textContent.includes('script') || statePill.innerHTML.includes('&lt;script&gt;'),
      'State label must be sanitized/escaped properly');
  });

  // ---------------------------------------------------------------------------
  // 3. AI / Antigravity Render Contract
  // ---------------------------------------------------------------------------
  console.log('\n[AI / Antigravity Render Contract]');

  await testAsync('AI absent quota windows display "Unknown" instead of fabricating "100%"', async () => {
    const { document, window } = createMinimalDOM(BASE_HTML);
    const agyModule = await loadModule(antigravityModulePath, window);

    // Antigravity data with missing / empty buckets
    const agyEmptyBuckets = [
      {
        email: 'test@example.com',
        groups: [
          {
            displayName: 'Claude Models',
            buckets: [] // No buckets provided by backend
          }
        ]
      }
    ];

    agyModule.renderAntigravity(agyEmptyBuckets, null, null);

    const container = document.getElementById('antigravity-content');
    const content = container.innerHTML;

    // Contract: AI absent windows show Unknown not 100%
    assert(!content.includes('100% available') && !content.includes('100%</span>'),
      `Absent quota windows must not display default fabricated 100%. Found content:\n${content}`);

    assert(content.includes('Unknown') || content.includes('—') || content.includes('N/A'),
      `Absent quota windows should show "Unknown" or indeterminate symbol, not 100%. Got: ${content}`);
  });

  await testAsync('AI Antigravity renders Argon separately from Gemini with single weekly gauge', async () => {
    const { document, window } = createMinimalDOM(BASE_HTML);
    const agyModule = await loadModule(antigravityModulePath, window);

    const agyData = [
      {
        email: 'test@example.com',
        groups: [
          {
            displayName: 'Gemini Models',
            buckets: [
              { bucketId: 'gemini-weekly', displayName: 'Weekly', window: 'weekly', remainingPct: 100 },
              { bucketId: 'gemini-5h', displayName: '5-Hour', window: '5h', remainingPct: 80 }
            ]
          },
          {
            displayName: 'Claude and GPT models',
            buckets: [
              { bucketId: '3p-weekly', displayName: 'Weekly', window: 'weekly', remainingPct: 50 }
            ]
          },
          {
            displayName: 'Gemini 4 Argon',
            buckets: [
              { bucketId: 'gemini-argon-wtu-weekly', displayName: 'Weekly', window: 'weekly', remainingPct: 90 }
            ]
          }
        ]
      }
    ];

    agyModule.renderAntigravity(agyData, null, null);

    const container = document.getElementById('antigravity-content');
    const content = container.innerHTML;

    assert(content.includes('Gemini Models'), 'Must render Gemini Models group');
    assert(content.includes('Gemini 4 Argon'), 'Must render Gemini 4 Argon group');
    assert(content.includes('Claude and GPT models'), 'Must render the group label exactly as the API sends it');
    assert(content.includes('single-gauge'), 'Argon weekly-only quota must render with single-gauge grid');
    assert(content.includes('Argon <span class="agy-meta-win">Weekly</span>'), 'Argon bucket title must be rendered cleanly');
  });

  await testAsync('AI quota gauges show the tightest bucket in a window', async () => {
    const { document, window } = createMinimalDOM(BASE_HTML);
    const agyModule = await loadModule(antigravityModulePath, window);

    agyModule.renderAntigravity([
      {
        email: 'test@example.com',
        groups: [
          {
            displayName: 'Gemini Models',
            buckets: [
              { bucketId: 'a-5h', displayName: 'Wide', window: '5h', remainingPct: 70 },
              { bucketId: 'b-5h', displayName: 'Tight', window: '5h', remainingPct: 25 }
            ]
          }
        ]
      }
    ], null, null);

    const content = document.getElementById('antigravity-content').innerHTML;
    assert(content.includes('25%'), 'the binding bucket (25%) must be shown');
    assert(!content.includes('70%'), 'the looser bucket must not replace the binding one');
  });

  await testAsync('Claude and Codex usage tabs do NOT display fabricated model/plan/traffic/credits labels', async () => {
    const { document, window } = createMinimalDOM(BASE_HTML);
    const agyModule = await loadModule(antigravityModulePath, window);

    // Claude data without fabricated plan or traffic
    const claudeData = {
      email: 'user@anthropic.com',
      // no planType provided
      fiveHour: { utilization: 25 },
      sevenDay: { utilization: 40 }
    };

    // Render claude
    agyModule.renderAntigravity(null, claudeData, null);

    const container = document.getElementById('antigravity-content');
    let html = container.innerHTML;

    // Contract: no fabricated model/plan/traffic/credits labels
    assert(!html.includes('Traffic: 100% Claude Code'), 'Must not fabricate "Traffic: 100% Claude Code"');
    assert(!html.includes('Active Pro Plan'), 'Must not fabricate "Active Pro Plan" when planType is undefined');

    // Codex data without fabricated metadata
    const codexData = {
      email: 'user@openai.com',
      primaryWindow: { usedPercent: 10, resetsAt: Date.now() + 100000 },
      secondaryWindow: { usedPercent: 20, resetsAt: Date.now() + 200000 }
    };

    agyModule.renderAntigravity(null, null, codexData);
    html = container.innerHTML;

    assert(!html.includes('gpt-6-astra'), 'Must not fabricate "Model: gpt-6-astra" placeholder');
    assert(!html.includes('Credits: Standard'), 'Must not fabricate "Credits: Standard" placeholder');
    assert(!html.includes('ChatGPT Plus'), 'Must not fabricate "ChatGPT Plus" when planType is not provided');
  });

  // ---------------------------------------------------------------------------
  // Summary & Exit Handling
  // ---------------------------------------------------------------------------
  console.log(`\n========================================`);
  console.log(`Frontend Render Contract Test Summary:`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);
  console.log(`========================================\n`);

  if (failedTests > 0) {
    // Contract: Tests report exit failure correctly (explicit process.exit after completion for host libuv bug)
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Execute runner if invoked directly
if (require.main === module) {
  run().catch(err => {
    console.error('Unhandled test runner error:', err);
    process.exit(1);
  });
}

module.exports = { run, createMinimalDOM };
