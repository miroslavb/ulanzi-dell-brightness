import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import WebSocket from '../com.ulanzi.dellbrightness.ulanziPlugin/node_modules/ws/wrapper.mjs';
import DdcBridgeServer from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/ddc/DdcBridgeServer.js';

const controller = {
  calls: [],
  async list() { this.calls.push(['list']); return { ok: true, monitors: [{ index: 0, name: 'Dell', capable: true, current: 40 }] }; },
  async get(monitor) { this.calls.push(['get', monitor]); return { ok: true, current: 40, index: 0, name: 'Dell' }; },
  async requestAdjust(monitor, delta) { this.calls.push(['adjust', monitor, delta]); return { ok: true, current: 40 + delta, index: 0, name: 'Dell' }; }
};

const bridge = new DdcBridgeServer(controller, { port: 0 });
const address = await bridge.start();
const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
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

const hostile = new WebSocket(`ws://127.0.0.1:${address.port}`, { origin: 'https://evil.example' });
const hostileRejected = await new Promise(resolve => {
  hostile.once('open', () => resolve(false));
  hostile.once('error', () => resolve(true));
});
assert.equal(hostileRejected, true);

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
  `ws://127.0.0.1:${address.port}`
);
const browserResult = await browserClient.request('get', { monitor: '0' });
assert.equal(browserResult.ok, true);
assert.equal(browserResult.current, 40);
browserClient.socket.close();

socket.close();
await bridge.close();
console.log('6 bridge checks passed');
