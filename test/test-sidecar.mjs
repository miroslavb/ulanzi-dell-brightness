import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../com.ulanzi.dellbrightnessencoder.ulanziPlugin/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
assert.equal(manifest.UUID, 'com.ulanzi.ulanzistudio.dellbrightnessencoder');
assert.equal(manifest.CodePath, 'plugin/app.html');
assert.equal(manifest.Actions.length, 1);
assert.deepEqual(manifest.Actions[0].Controllers, ['Encoder']);
assert.equal(manifest.Actions[0].Encoder.layout, '$UA1');
assert.equal(Object.hasOwn(manifest.Actions[0], 'Devices'), false);

const html = fs.readFileSync(new URL('plugin/app.html', root), 'utf8');
for (const script of [
  '../libs/js/constants.js',
  '../libs/js/eventEmitter.js',
  '../libs/js/timers.js',
  '../libs/js/utils.js',
  '../libs/js/ulanziApi.js',
  'icons.js',
  'app.js'
]) {
  assert.match(html, new RegExp(`src=["']${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
}

class FakeUlanziApi {
  constructor() {
    this.icons = [];
    this.alerts = [];
    this.handlers = {};
    FakeUlanziApi.instance = this;
  }
  connect(uuid) { this.uuid = uuid; }
  onConnected(fn) { this.handlers.connected = fn; }
  onAdd(fn) { this.handlers.add = fn; }
  onParamFromPlugin(fn) { this.handlers.paramFromPlugin = fn; }
  onParamFromApp(fn) { this.handlers.paramFromApp = fn; }
  onSetActive(fn) { this.handlers.setActive = fn; }
  onDialRotateLeft(fn) { this.handlers.left = fn; }
  onDialRotateRight(fn) { this.handlers.right = fn; }
  onDialDown(fn) { this.handlers.down = fn; }
  onSendToPlugin(fn) { this.handlers.sendToPlugin = fn; }
  onClear(fn) { this.handlers.clear = fn; }
  setBaseDataIcon(context, data, text) { this.icons.push({ context, data, text }); }
  showAlert(context) { this.alerts.push(context); }
  logMessage() {}
  setSettings() {}
  sendToPropertyInspector() {}
  encodeContext(item) { return item.context; }
}

const canvas = {
  width: 0,
  height: 0,
  getContext() {
    return {
      fillStyle: '', font: '', textAlign: '', textBaseline: '',
      fillRect() {}, fillText() {}, save() {}, restore() {}, translate() {}, scale() {}, fill() {}
    };
  },
  toDataURL() { return 'data:image/png;base64,ZmFrZS1wbmc='; }
};
const sandbox = {
  window: { DELL_BRIGHTNESS_ICONS: { 'brightness-7': 'M0 0', monitor: 'M0 0', gauge: 'M0 0' } },
  document: { createElement: kind => { assert.equal(kind, 'canvas'); return { ...canvas }; } },
  UlanziApi: FakeUlanziApi,
  WebSocket: class {},
  setTimeout,
  clearTimeout,
  console
};
vm.createContext(sandbox);
const appSource = fs.readFileSync(new URL('plugin/app.js', root), 'utf8');
new vm.Script(appSource, { filename: 'encoder/plugin/app.js' }).runInContext(sandbox);

const exported = sandbox.window.DellBrightnessEncoder;
assert.ok(exported);
assert.deepEqual(
  JSON.parse(JSON.stringify(exported.parseSettings({ step: '10', monitor: 2, icon: 'mdi:gauge', showFeedback: false }))),
  { step: 10, monitor: '2', icon: 'gauge', showFeedback: false }
);
assert.equal(exported.parseSettings({ step: '999', icon: 'missing' }).step, 5);
assert.equal(exported.parseSettings({ step: '999', icon: 'missing' }).icon, 'brightness-7');
assert.equal(exported.renderFeedback({ showFeedback: false }, 50, false), exported.BLANK_FEEDBACK);

const bridge = {
  calls: [],
  async request(op, data) {
    this.calls.push({ op, data });
    return { ok: true, current: op === 'adjust' ? 55 : 50 };
  }
};
const action = new exported.BrightnessEncoderAction('ctx', bridge);
action.settings = exported.parseSettings({ step: '5', monitor: '0', icon: 'gauge', showFeedback: true });
await action.adjust(-1);
await action.adjust(1);
assert.deepEqual(JSON.parse(JSON.stringify(bridge.calls)), [
  { op: 'adjust', data: { monitor: '0', delta: -5 } },
  { op: 'adjust', data: { monitor: '0', delta: 5 } }
]);
assert.equal(FakeUlanziApi.instance.alerts.length, 0);
assert.equal(FakeUlanziApi.instance.icons.length, 2);
assert.equal(FakeUlanziApi.instance.icons.at(-1).data, 'ZmFrZS1wbmc=');

console.log('14 sidecar checks passed');
