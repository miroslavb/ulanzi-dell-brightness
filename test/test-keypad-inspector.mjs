// Keypad Property Inspector <-> Node main-service messaging.
//
// Part 1 exercises handleInspectorMessage() directly. Part 2 loads the real
// packaged browser SDK scripts plus property-inspector/inspector.js into a VM
// with a small DOM, connects it to a fake Studio host, and routes every
// sendToPlugin payload through the real backend handler.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { handleInspectorMessage, normalizeMonitors } from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/inspectorMessages.js';
import { BRIGHTNESS_ICONS, QUICK_PICK_ICONS } from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/icons.js';

const pluginRoot = new URL('../com.ulanzi.dellbrightness.ulanziPlugin/', import.meta.url);
const nativeSetTimeout = setTimeout;
const nativeClearTimeout = clearTimeout;
const sleep = (ms = 0) => new Promise(resolve => nativeSetTimeout(resolve, ms));
const plain = value => JSON.parse(JSON.stringify(value));

const controller = {
  gets: [],
  async list() { return { ok: true, monitors: { index: 0, name: 'Generic DDC monitor', capable: true, current: 64 } }; },
  async get(monitor) { this.gets.push(monitor); return { ok: true, current: 64, min: 0, max: 100 }; }
};

// ---- Part 1: backend handler -----------------------------------------------

assert.equal(await handleInspectorMessage(null, { controller }), null);
assert.equal(await handleInspectorMessage({ op: 'deleteEverything' }, { controller }), null);
assert.deepEqual(normalizeMonitors({ monitors: { index: 3 } }), [{ index: 3 }]);

const monitors = await handleInspectorMessage({ op: 'listMonitors' }, { controller });
assert.deepEqual(plain(monitors), {
  type: 'monitors', ok: true,
  monitors: [{ index: 0, name: 'Generic DDC monitor', capable: true, current: 64 }]
});
const failedList = await handleInspectorMessage({ op: 'listMonitors' }, {
  controller: { async list() { throw new Error('worker crashed'); } }
});
assert.deepEqual(plain(failedList), { type: 'monitors', ok: false, monitors: [] });

const reading = await handleInspectorMessage({ op: 'getBrightness', monitor: '2' }, { controller });
assert.equal(reading.type, 'brightness');
assert.equal(reading.result.current, 64);
assert.deepEqual(controller.gets, ['2']);
const failedReading = await handleInspectorMessage({ op: 'getBrightness' }, {
  controller: { async get() { throw new Error('no monitor'); } }
});
assert.deepEqual(plain(failedReading), { type: 'brightness', result: { ok: false, error: 'no monitor' } });

const quick = await handleInspectorMessage({ op: 'searchIcons', query: '', seq: 7 }, { controller });
assert.equal(quick.type, 'icons');
assert.equal(quick.seq, 7);
assert.equal(quick.quickPicks, true);
assert.deepEqual(quick.results.map(r => r.name), [...QUICK_PICK_ICONS]);
assert.ok(quick.results.every(r => r.path === BRIGHTNESS_ICONS[r.name]));

const found = await handleInspectorMessage({ op: 'searchIcons', query: 'mdi:lightbulb', seq: 8, limit: 6 }, { controller });
assert.equal(found.seq, 8);
assert.equal(found.quickPicks, false);
assert.equal(found.query, 'lightbulb');
assert.equal(found.results.length, 6);
assert.equal(found.results[0].name, 'lightbulb');
assert.ok(found.total > 6);
const bogusSeq = await handleInspectorMessage({ op: 'searchIcons', query: 'sun', seq: 'x' }, { controller });
assert.equal(bogusSeq.seq, 0);
assert.ok(bogusSeq.results.length <= 40);

const icon = await handleInspectorMessage({ op: 'getIcon', name: 'mdi:weather-night', seq: 3 }, { controller });
assert.deepEqual(Object.keys(icon).sort(), ['name', 'path', 'seq', 'type']);
assert.equal(icon.name, 'weather-night');
assert.match(icon.path, /^M/);
for (const name of ['no-such-icon-xyz', '../../secret', '', 42, '__proto__']) {
  const missing = await handleInspectorMessage({ op: 'getIcon', name }, { controller });
  assert.equal(missing.path, null, `getIcon(${String(name)})`);
}

// ---- Part 2: real SDK + inspector.js in a VM ----------------------------------

class Element {
  constructor(tag, props = {}) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.styleVars = {};
    this.style = { setProperty: (name, value) => { this.styleVars[name] = value; } };
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name),
      toggle: (name, on) => { (on ?? !this.classes.has(name)) ? this.classes.add(name) : this.classes.delete(name); }
    };
    this.text = '';
    this.value = '';
    this.name = '';
    this.type = '';
    this.id = '';
    Object.assign(this, props);
  }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this.children = []; this.text = String(value); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  get innerText() { return this.textContent; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  dispatch(name, event = {}) {
    const full = { target: this, key: undefined, preventDefault() { this.defaultPrevented = true; }, ...event };
    for (let node = this; node; node = node.parentNode) {
      for (const fn of node.listeners[name] || []) fn(full);
    }
    return full;
  }
  closest(selector) {
    const cls = selector.replace(/^\./, '');
    for (let node = this; node; node = node.parentNode) if (node.classes.has(cls)) return node;
    return null;
  }
  querySelectorAll() { return []; }
}

class Select extends Element {
  constructor(props) { super('select', props); this.options = []; }
  appendChild(option) { this.options.push(option); return option; }
  remove(index) { this.options.splice(index, 1); }
}

const form = new Element('form', { id: 'property-inspector' });
const byId = { 'property-inspector': form };
function add(element) { byId[element.id] = element; form.appendChild(element); return element; }
const step = add(new Select({ id: 'step', name: 'step', value: '5' }));
step.options = ['1', '3', '5', '10'].map(value => ({ value }));
const iconInput = add(new Element('input', { id: 'icon', name: 'icon', type: 'hidden', value: '' }));
const colorInput = add(new Element('input', { id: 'iconColor', name: 'iconColor', type: 'color', value: '#facc15' }));
const search = add(new Element('input', { id: 'iconSearch', type: 'search', value: '' }));
const monitor = add(new Select({ id: 'monitor', name: 'monitor', value: 'auto' }));
monitor.options = [{ value: 'auto', textContent: 'Auto' }];
for (const id of ['iconSwatch', 'iconName', 'iconClear', 'iconStatus', 'iconGrid', 'reading', 'refresh']) {
  add(new Element(id === 'iconClear' || id === 'refresh' ? 'button' : 'div', { id }));
}
form.elements = [step, iconInput, colorInput, search, monitor];
const wrapper = new Element('div');
wrapper.classes.add('uspi-wrapper');
wrapper.classes.add('hidden');

class FakeFormData {
  constructor(target) {
    this.entries = target.elements.filter(el => el.name).map(el => [el.name, el.value]);
  }
  forEach(fn) { for (const [key, value] of this.entries) fn(value, key); }
}

const hostMessages = [];
class BrowserWorker {
  constructor() { this.nativeTimers = new Map(); }
  postMessage(message) {
    if (message.type === 'clearTimeout' || message.type === 'clearInterval') {
      nativeClearTimeout(this.nativeTimers.get(message.id));
      this.nativeTimers.delete(message.id);
      return;
    }
    if (message.type === 'setTimeout') {
      const timer = nativeSetTimeout(() => {
        this.onmessage?.({ data: { id: message.id } });
        this.onmessage?.({ data: { id: message.id, type: 'clearTimer' } });
        this.nativeTimers.delete(message.id);
      }, message.delay || 0);
      this.nativeTimers.set(message.id, timer);
    }
  }
}
class HostSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    HostSocket.instances.push(this);
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(raw) { hostMessages.push(JSON.parse(raw)); }
  close() { this.readyState = 3; }
  receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

const UUID = 'com.ulanzi.ulanzistudio.dellbrightness.brighter';
const sandbox = {
  console: { ...console, log() {}, warn() {} },
  URL, URLSearchParams, Blob, queueMicrotask,
  setTimeout: nativeSetTimeout, clearTimeout: nativeClearTimeout,
  WebSocket: HostSocket, Worker: BrowserWorker, FormData: FakeFormData,
  navigator: { language: 'en-US' },
  location: {
    search: `?address=127.0.0.1&port=3906&uuid=${UUID}&key=4&actionid=pi-test&language=en`,
    pathname: '/plugins/com.ulanzi.dellbrightness.ulanziPlugin/property-inspector/inspector.html'
  },
  document: {
    documentElement: { style: {} },
    body: { style: {} },
    querySelector(selector) {
      if (selector === '.uspi-wrapper') return wrapper;
      if (selector === '.udpi-wrapper') return null;
      return selector.startsWith('#') ? byId[selector.slice(1)] || null : null;
    },
    createElement(tag) { return new Element(tag); },
    createElementNS(ns, tag) { assert.equal(ns, 'http://www.w3.org/2000/svg'); return new Element(tag); }
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ['constants.js', 'eventEmitter.js', 'timers.js', 'utils.js', 'ulanziApi.js']) {
  const source = fs.readFileSync(new URL(`libs/js/${file}`, pluginRoot), 'utf8');
  new vm.Script(source, { filename: `libs/js/${file}` }).runInContext(sandbox);
}
const inspectorSource = fs.readFileSync(new URL('property-inspector/inspector.js', pluginRoot), 'utf8');
new vm.Script(inspectorSource, { filename: 'property-inspector/inspector.js' }).runInContext(sandbox);

const host = HostSocket.instances[0];
const envelope = { uuid: UUID, key: '4', actionid: 'pi-test' };
let relayed = 0;
// Fake Studio host: forwards sendToPlugin to the real backend handler and
// returns its reply as sendToPropertyInspector.
async function pump(filter = () => true) {
  await sleep(5);
  for (let round = 0; round < 25; round++) { // bounded: a request loop fails, not hangs
    const pending = hostMessages.slice(relayed);
    relayed = hostMessages.length;
    if (!pending.length) break;
    for (const message of pending) {
      if (message.cmd !== 'sendToPlugin' || !filter(message.payload)) continue;
      const reply = await handleInspectorMessage(message.payload, { controller });
      if (reply) host.receive({ cmd: 'sendToPropertyInspector', ...envelope, payload: reply });
    }
    await sleep(5);
  }
}
const toPlugin = () => hostMessages.filter(m => m.cmd === 'sendToPlugin').map(m => m.payload);
const saves = () => hostMessages.filter(m => m.cmd === 'paramfromplugin').map(m => plain(m.param));
const gridNames = () => byId.iconGrid.children.map(cell => cell.dataset.name);

await sleep(5);
assert.ok(hostMessages.some(m => m.cmd === 'connected'), 'the real SDK connected to the host');
assert.equal(wrapper.classes.has('hidden'), false);
assert.deepEqual(plain(toPlugin().find(p => p.op === 'searchIcons')), { op: 'searchIcons', query: '', seq: 1, limit: 40 });
await pump();
assert.deepEqual(gridNames(), [...QUICK_PICK_ICONS], 'quick picks are shown by default');
assert.equal(byId.iconName.textContent, 'Keep Studio icon');
assert.equal(byId.iconClear.textContent, '', 'Brighter/Darker keep the Keep Studio icon label');

host.receive({ cmd: 'add', ...envelope, param: { step: '10', monitor: 'auto', icon: 'mdi:Gauge', iconColor: 'bogus' } });
await pump();
assert.equal(iconInput.value, 'gauge');
assert.equal(colorInput.value, '#facc15', 'invalid saved colours fall back to the default');
assert.equal(byId.iconName.textContent, 'mdi:gauge');
assert.deepEqual(byId.iconGrid.children.filter(c => c.classes.has('selected')).map(c => c.dataset.name), ['gauge']);
assert.equal(byId.iconSwatch.classes.has('empty'), false, 'the selected glyph is previewed');
assert.equal(saves().length, 0, 'loading settings does not echo a save');

// Typing a query searches after a debounce and never saves settings.
search.value = 'light';
search.dispatch('input');
search.value = 'lightbulb';
search.dispatch('input');
await sleep(260);
const searches = toPlugin().filter(p => p.op === 'searchIcons');
assert.equal(searches.length, 2, 'debounced: one request for the final query');
assert.equal(searches.at(-1).query, 'lightbulb');
assert.equal(saves().length, 0);
await pump();
assert.equal(gridNames()[0], 'lightbulb');
// A late reply to an older search (seq 1 = quick picks) is ignored.
host.receive({ cmd: 'sendToPropertyInspector', ...envelope, payload: {
  type: 'icons', seq: 1, query: '', quickPicks: true, total: 1, results: [{ name: 'tune', path: 'M0 0Z' }]
} });
await pump();
assert.equal(gridNames()[0], 'lightbulb');
assert.ok(gridNames().length > 1 && gridNames().length <= 40);
assert.match(byId.iconStatus.textContent, /matches/);

// Clicking a result selects and saves it.
const cell = byId.iconGrid.children.find(c => c.dataset.name === 'lightbulb-on');
cell.children[0].dispatch('click');
await pump();
assert.deepEqual(saves().at(-1), { step: '10', icon: 'lightbulb-on', iconColor: '#facc15', monitor: 'auto' });
assert.equal(byId.iconName.textContent, 'mdi:lightbulb-on');

// Enter resolves an exact typed mdi: name through the backend.
search.value = 'mdi:weather-night';
const enter = search.dispatch('keydown', { key: 'Enter' });
assert.equal(enter.defaultPrevented, true, 'Enter never submits the form');
await pump();
assert.equal(saves().at(-1).icon, 'weather-night');
search.value = 'mdi:no-such-icon-xyz';
search.dispatch('keydown', { key: 'Enter' });
await pump();
assert.equal(saves().at(-1).icon, 'weather-night', 'unknown names are not saved');
assert.match(byId.iconStatus.textContent, /No icon named mdi:no-such-icon-xyz/);

// Colour edits are saved (debounced), lowercased and applied to previews.
colorInput.value = '#22C55E';
colorInput.dispatch('input');
await sleep(220);
assert.equal(saves().at(-1).iconColor, '#22c55e');
assert.equal(byId.iconGrid.styleVars['--icon-color'], '#22c55e');

// "Keep Studio icon" clears the icon so Brighter/Darker never paint.
byId.iconClear.dispatch('click');
assert.equal(saves().at(-1).icon, '');
assert.equal(byId.iconName.textContent, 'Keep Studio icon');
assert.equal(byId.iconSwatch.classes.has('empty'), true);

// Previews are built from validated paths only.
host.receive({ cmd: 'sendToPropertyInspector', ...envelope, payload: {
  type: 'icons', seq: toPlugin().filter(p => p.op === 'searchIcons').at(-1).seq, query: 'x', quickPicks: false, total: 2,
  results: [{ name: 'ok-icon', path: 'M1 1Z' }, { name: 'evil', path: 'M0 0"/><script>' }]
} });
assert.deepEqual(gridNames(), ['ok-icon']);

// A saved icon the backend cannot resolve is looked up once and flagged.
host.receive({ cmd: 'paramfromapp', ...envelope, param: { icon: 'mdi:retired-icon-name', iconColor: '#22c55e' } });
await pump();
assert.equal(byId.iconName.textContent, 'mdi:retired-icon-name (not found)');
assert.equal(toPlugin().filter(p => p.op === 'getIcon' && p.name === 'retired-icon-name').length, 1);

const iconLookups = toPlugin().filter(p => p.op === 'getIcon').map(p => p.name);
assert.equal(new Set(iconLookups).size, iconLookups.length, 'preview lookups are never repeated');

console.log('keypad Property Inspector <-> backend icon/colour messaging checks passed');
