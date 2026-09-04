import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import {
  publishBridgeConfig,
  resolveBridgeAuthPath
} from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/ddc/BridgeAuth.js';

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
  'bridge-auth.js',
  'app.js'
]) {
  assert.match(html, new RegExp(`src=["']${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`));
}

class FakeUlanziApi {
  constructor() {
    this.icons = [];
    this.alerts = [];
    this.savedSettings = [];
    this.piMessages = [];
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
  setSettings(settings, context) { this.savedSettings.push({ settings, context }); }
  sendToPropertyInspector(payload, context) { this.piMessages.push({ payload, context }); }
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
  URL,
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

const failureAction = new exported.BrightnessEncoderAction('failure', {
  async request() { return { ok: false, error: 'no monitor' }; }
});
failureAction.settings = exported.parseSettings({ showFeedback: true });
await failureAction.adjust(1);
assert.deepEqual(FakeUlanziApi.instance.alerts, ['failure']);

const throwingAction = new exported.BrightnessEncoderAction('throwing', {
  async request() { throw new Error('offline'); }
});
throwingAction.settings = exported.parseSettings({ showFeedback: true });
await throwingAction.adjust(1);
assert.deepEqual(FakeUlanziApi.instance.alerts, ['failure', 'throwing']);

const rapidResolvers = [];
const rapidAction = new exported.BrightnessEncoderAction('rapid', {
  request() { return new Promise(resolve => rapidResolvers.push(resolve)); }
});
rapidAction.settings = exported.parseSettings({ showFeedback: true });
const iconsBeforeRapid = FakeUlanziApi.instance.icons.length;
const firstRapid = rapidAction.adjust(1);
const secondRapid = rapidAction.adjust(1);
rapidResolvers[0]({ ok: true, current: 55 });
rapidResolvers[1]({ ok: true, current: 55 });
await Promise.all([firstRapid, secondRapid]);
assert.equal(FakeUlanziApi.instance.icons.length, iconsBeforeRapid + 1,
  'one feedback frame is painted for a coalesced dial burst');

const mixedResolvers = [];
const mixedAction = new exported.BrightnessEncoderAction('mixed', {
  request(op) { return new Promise(resolve => mixedResolvers.push({ op, resolve })); }
});
mixedAction.settings = exported.parseSettings({ showFeedback: true });
const iconsBeforeMixed = FakeUlanziApi.instance.icons.length;
const staleRefresh = mixedAction.refresh();
const latestAdjust = mixedAction.adjust(1);
mixedResolvers.find(item => item.op === 'adjust').resolve({ ok: true, current: 55 });
await latestAdjust;
mixedResolvers.find(item => item.op === 'get').resolve({ ok: true, current: 50 });
await staleRefresh;
assert.equal(FakeUlanziApi.instance.icons.length, iconsBeforeMixed + 1,
  'a stale refresh cannot overwrite newer dial feedback');

const eventCalls = [];
exported.BridgeClient.prototype.request = async function (op, data) {
  eventCalls.push({ op, data });
  if (op === 'list') return { ok: true, monitors: [{ Index: 0, Name: 'Dell', Capable: true }] };
  return { ok: true, current: op === 'adjust' ? 60 : 50 };
};
const ud = FakeUlanziApi.instance;
ud.icons = [];
ud.alerts = [];
ud.savedSettings = [];
ud.piMessages = [];
ud.handlers.add({ context: 'event-ctx', param: { step: '10', monitor: '2', showFeedback: false } });
await new Promise(resolve => setTimeout(resolve, 0));
ud.handlers.left({ context: 'event-ctx' });
ud.handlers.right({ context: 'event-ctx' });
ud.handlers.down({ context: 'event-ctx' });
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(eventCalls.some(call => call.op === 'adjust' && call.data.delta === -10));
assert.ok(eventCalls.some(call => call.op === 'adjust' && call.data.delta === 10));
assert.ok(eventCalls.some(call => call.op === 'get' && call.data.monitor === '2'));

await ud.handlers.sendToPlugin({
  context: 'event-ctx',
  payload: { op: 'configure', settings: { step: '3', monitor: '1', icon: 'monitor' } }
});
assert.equal(ud.savedSettings.at(-1).settings.step, 3);
assert.equal(ud.savedSettings.at(-1).context, 'event-ctx');

await ud.handlers.sendToPlugin({ context: 'event-ctx', payload: { op: 'listMonitors' } });
assert.equal(ud.piMessages.at(-1).payload.type, 'monitors');
assert.equal(ud.piMessages.at(-1).payload.monitors[0].Name, 'Dell');

await ud.handlers.sendToPlugin({
  context: 'event-ctx', payload: { op: 'getBrightness', monitor: '1' }
});
assert.equal(ud.piMessages.at(-1).payload.type, 'brightness');
assert.equal(ud.piMessages.at(-1).payload.result.current, 50);

ud.handlers.clear({ param: [{ context: 'event-ctx' }] });
assert.doesNotThrow(() => ud.handlers.setActive({ context: 'event-ctx', active: true }));
await new Promise(resolve => setTimeout(resolve, 0));

assert.equal(exported.validBridgeConfig({
  url: 'ws://127.0.0.1:9236', token: 'a'.repeat(64)
}), true);
assert.equal(exported.validBridgeConfig({
  url: 'ws://127.0.0.1:9236', token: 'short'
}), false);
assert.equal(exported.validBridgeConfig({
  url: 'https://127.0.0.1:9236', token: 'a'.repeat(64)
}), false);

const installedRoot = resolve('/tmp', 'UlanziDeck', 'Plugins');
const mainServiceUrl = pathToFileURL(resolve(
  installedRoot, 'com.ulanzi.dellbrightness.ulanziPlugin', 'plugin', 'app.js'
));
assert.equal(resolveBridgeAuthPath(mainServiceUrl), resolve(
  installedRoot, 'com.ulanzi.dellbrightnessencoder.ulanziPlugin', 'plugin', 'bridge-auth.js'
));

const tempInstall = fs.mkdtempSync(resolve(tmpdir(), 'dell-bridge-auth-'));
try {
  const tempMain = resolve(
    tempInstall, 'Plugins', 'com.ulanzi.dellbrightness.ulanziPlugin', 'plugin', 'app.js'
  );
  const tempAuthDir = resolve(
    tempInstall, 'Plugins', 'com.ulanzi.dellbrightnessencoder.ulanziPlugin', 'plugin'
  );
  fs.mkdirSync(resolve(tempMain, '..'), { recursive: true });
  fs.mkdirSync(tempAuthDir, { recursive: true });
  const publishedPath = publishBridgeConfig({
    mainServiceUrl: pathToFileURL(tempMain), port: 9236, token: 'c'.repeat(64)
  });
  assert.equal(publishedPath, resolve(tempAuthDir, 'bridge-auth.js'));
  const firstConfig = fs.readFileSync(publishedPath, 'utf8');
  assert.match(firstConfig, /ws:\/\/127\.0\.0\.1:9236/);
  assert.match(firstConfig, new RegExp('c{64}'));
  publishBridgeConfig({
    mainServiceUrl: pathToFileURL(tempMain), port: 9236, token: 'd'.repeat(64)
  });
  const rotatedConfig = fs.readFileSync(publishedPath, 'utf8');
  assert.match(rotatedConfig, new RegExp('d{64}'));
  assert.doesNotMatch(rotatedConfig, new RegExp('c{64}'));
} finally {
  fs.rmSync(tempInstall, { recursive: true, force: true });
}

const realSetTimeout = sandbox.setTimeout;
sandbox.setTimeout = fn => { fn(); return 1; };
sandbox.document.createElement = kind => {
  assert.equal(kind, 'script');
  return { src: '', remove() {} };
};
let reloadCount = 0;
sandbox.document.head = {
  appendChild(script) {
    reloadCount++;
    if (reloadCount === 2) {
      sandbox.window.DELL_BRIGHTNESS_BRIDGE = {
        url: 'ws://127.0.0.1:9236', token: 'e'.repeat(64)
      };
    }
    script.onload();
  }
};
sandbox.window.DELL_BRIGHTNESS_BRIDGE = {};
const loadedConfig = await exported.loadBridgeConfig();
assert.equal(loadedConfig.token, 'e'.repeat(64));
assert.equal(reloadCount, 2, 'placeholder config is retried until the backend publishes a token');

sandbox.document.head.appendChild = script => script.onload();
sandbox.window.DELL_BRIGHTNESS_BRIDGE = {};
await assert.rejects(exported.loadBridgeConfig(), /token is unavailable/);
sandbox.setTimeout = realSetTimeout;

class ControlledWebSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    ControlledWebSocket.instances.push(this);
  }
  send(raw) { this.sent.push(raw); }
  close() { this.readyState = 3; }
  open() { this.readyState = ControlledWebSocket.OPEN; this.onopen(); }
}
sandbox.WebSocket = ControlledWebSocket;
const raceClient = new exported.BridgeClient(async () => ({
  url: 'ws://127.0.0.1:9236', token: 'b'.repeat(64)
}));
const firstConnect = raceClient.connect();
assert.strictEqual(raceClient.connect(), firstConnect, 'concurrent callers share one connection attempt');
await new Promise(resolve => setTimeout(resolve, 0));
const socketA = ControlledWebSocket.instances.at(-1);
socketA.onerror();
await assert.rejects(firstConnect, /unavailable/);

const secondConnect = raceClient.connect();
await new Promise(resolve => setTimeout(resolve, 0));
const socketB = ControlledWebSocket.instances.at(-1);
socketB.open();
await secondConnect;
assert.strictEqual(raceClient.socket, socketB);
assert.equal(socketB.readyState, sandbox.WebSocket.OPEN);
let successorRejected = false;
const successorTimer = setTimeout(() => {}, 1000);
raceClient.pending.set(999, {
  socket: socketB,
  timer: successorTimer,
  resolve() {},
  reject() { successorRejected = true; }
});
socketA.onclose();
assert.strictEqual(raceClient.socket, socketB, 'a stale close cannot discard its successor socket');
assert.equal(successorRejected, false, 'a stale close cannot reject successor requests');
assert.equal(raceClient.pending.has(999), true);
clearTimeout(successorTimer);
raceClient.pending.delete(999);

const rejectedConfigClient = new exported.BridgeClient(async () => {
  throw new Error('config missing');
});
await assert.rejects(rejectedConfigClient.connect(), /config missing/);

console.log('sidecar manifest, action, and Ulanzi event-wiring checks passed');
