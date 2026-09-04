import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import WebSocket from '../com.ulanzi.dellbrightness.ulanziPlugin/node_modules/ws/wrapper.mjs';
import DdcBridgeServer, { DDC_BRIDGE_MAX_PAYLOAD } from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/ddc/DdcBridgeServer.js';

const TOKEN = 'a'.repeat(64);

const controller = {
  calls: [],
  async list() { this.calls.push(['list']); return { ok: true, monitors: [{ index: 0, name: 'Dell', capable: true, current: 40 }] }; },
  async get(monitor) {
    this.calls.push(['get', monitor]);
    if (monitor === '63') throw new Error('controller exploded');
    return { ok: true, current: 40, index: 0, name: 'Dell' };
  },
  async requestAdjust(monitor, delta) { this.calls.push(['adjust', monitor, delta]); return { ok: true, current: 40 + delta, index: 0, name: 'Dell' }; }
};

await assert.rejects(() => new DdcBridgeServer(controller, { port: 0 }).start(), /token is required/);

const bridge = new DdcBridgeServer(controller, { port: 0, token: TOKEN });
const address = await bridge.start();
assert.deepEqual(await bridge.start(), address, 'start is idempotent while listening');
assert.equal(address.address, '127.0.0.1');
assert.equal(bridge.server.options.maxPayload, DDC_BRIDGE_MAX_PAYLOAD);
const bridgeUrl = `ws://127.0.0.1:${address.port}/?token=${TOKEN}`;
const socket = new WebSocket(bridgeUrl, { origin: 'null' });
await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});

let nextId = 1;
function request(payload) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error('bridge timeout')), 2000);
    const handler = raw => {
      const message = JSON.parse(String(raw));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.off('message', handler);
      resolve(message.result);
    };
    socket.on('message', handler);
    socket.send(JSON.stringify({ id, ...payload }));
  });
}

const listed = await request({ op: 'list' });
assert.equal(listed.ok, true);
assert.equal(listed.monitors[0].name, 'Dell');

const adjusted = await request({ op: 'adjust', monitor: '0', delta: 5 });
assert.equal(adjusted.current, 45);
assert.deepEqual(controller.calls.at(-1), ['adjust', '0', 5]);

const rejected = await request({ op: 'adjust', monitor: '0', delta: 1000 });
assert.equal(rejected.ok, false);
assert.equal(rejected.error, 'invalid_delta');

async function connectionRejected(url, options) {
  const candidate = new WebSocket(url, options);
  return new Promise(resolve => {
    candidate.once('open', () => { candidate.close(); resolve(false); });
    candidate.once('error', () => resolve(true));
  });
}

assert.equal(await connectionRejected(
  `ws://127.0.0.1:${address.port}/`, { origin: 'null' }
), true, 'opaque origins need the token');
assert.equal(await connectionRejected(
  `ws://127.0.0.1:${address.port}/?token=${'b'.repeat(64)}`, { origin: 'file://' }
), true, 'a wrong same-length token is rejected');
assert.equal(await connectionRejected(
  bridgeUrl, { origin: 'https://evil.example' }
), true, 'remote web origins stay blocked even with a token');

for (const delta of [0, 1.5, -26, 26]) {
  const callsBefore = controller.calls.length;
  const result = await request({ op: 'adjust', monitor: '0', delta });
  assert.equal(result.error, 'invalid_delta');
  assert.equal(controller.calls.length, callsBefore);
}

const unsupported = await request({ op: 'execute', command: 'ignored' });
assert.equal(unsupported.error, 'unsupported_operation');

const thrown = await request({ op: 'get', monitor: '63' });
assert.equal(thrown.ok, false);
assert.match(thrown.error, /controller exploded/);

for (const monitor of [null, '', 'auto', 'invalid', 64, -1]) {
  const normalized = await request({ op: 'get', monitor });
  assert.equal(normalized.ok, true);
  assert.deepEqual(controller.calls.at(-1), ['get', 'auto']);
}
const boundaryMonitor = await request({ op: 'get', monitor: 0 });
assert.equal(boundaryMonitor.ok, true);
assert.deepEqual(controller.calls.at(-1), ['get', '0']);

const invalidJson = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('invalid JSON response timeout')), 2000);
  socket.once('message', raw => {
    clearTimeout(timer);
    resolve(JSON.parse(String(raw)));
  });
  socket.send('{');
});
assert.equal(invalidJson.id, null);
assert.equal(invalidJson.result.error, 'invalid_json');

const oversized = new WebSocket(bridgeUrl, { origin: 'file://' });
await new Promise((resolve, reject) => {
  oversized.once('open', resolve);
  oversized.once('error', reject);
});
const closeCode = await new Promise(resolve => {
  oversized.once('close', code => resolve(code));
  oversized.send('x'.repeat(DDC_BRIDGE_MAX_PAYLOAD + 1));
});
assert.equal(closeCode, 1009);

class FakeUlanziApi {
  connect() {}
  onConnected() {}
  onAdd() {}
  onParamFromPlugin() {}
  onParamFromApp() {}
  onSetActive() {}
  onDialRotateLeft() {}
  onDialRotateRight() {}
  onDialDown() {}
  onSendToPlugin() {}
  onClear() {}
}
const sandbox = {
  window: { DELL_BRIGHTNESS_ICONS: { 'brightness-7': 'M0 0' } },
  document: {}, UlanziApi: FakeUlanziApi, WebSocket, setTimeout, clearTimeout, console
};
vm.createContext(sandbox);
const appSource = fs.readFileSync(new URL(
  '../com.ulanzi.dellbrightnessencoder.ulanziPlugin/plugin/app.js', import.meta.url
), 'utf8');
new vm.Script(appSource).runInContext(sandbox);
const browserClient = new sandbox.window.DellBrightnessEncoder.BridgeClient(
  async () => ({ url: `ws://127.0.0.1:${address.port}`, token: TOKEN })
);
const browserResult = await browserClient.request('get', { monitor: '0' });
assert.equal(browserResult.ok, true);
assert.equal(browserResult.current, 40);
browserClient.socket.close();

socket.close();
await bridge.close();
await bridge.close();

const idleBridge = new DdcBridgeServer(controller, { port: 0, token: TOKEN });
await idleBridge.close();
assert.ok(await idleBridge.start());
await idleBridge.close();
console.log('bridge authentication, validation, and browser-client checks passed');
