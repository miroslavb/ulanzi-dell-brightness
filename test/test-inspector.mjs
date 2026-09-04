import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function control(value = '') {
  return {
    value,
    checked: false,
    options: [],
    listeners: {},
    addEventListener(name, fn) { this.listeners[name] = fn; },
    appendChild(option) { this.options.push(option); },
    set innerHTML(_value) {
      this.options = [{ value: 'auto', textContent: 'Auto (first responsive monitor)', disabled: false }];
      this.value = 'auto';
    }
  };
}

const step = control('5');
step.options = ['1', '3', '5', '10'].map(value => ({ value }));
const monitor = control('auto');
monitor.options = [{ value: 'auto', textContent: 'Auto (first responsive monitor)', disabled: false }];
const icon = control('brightness-7');
icon.options = ['brightness-7', 'brightness-6', 'brightness-5', 'monitor', 'gauge'].map(value => ({ value }));
const showFeedback = control();
showFeedback.checked = true;
const form = {
  elements: { step, monitor, icon, showFeedback },
  listeners: {},
  addEventListener(name, fn) { this.listeners[name] = fn; }
};
const status = { className: '', textContent: '' };
const refresh = control();

class FakeUlanziApi {
  constructor() {
    this.handlers = {};
    this.sent = [];
    this.saved = [];
    this.getSettingsCalls = 0;
    FakeUlanziApi.instance = this;
  }
  connect() {}
  onConnected(fn) { this.handlers.connected = fn; }
  onAdd(fn) { this.handlers.add = fn; }
  onDidReceiveSettings(fn) { this.handlers.didReceiveSettings = fn; }
  onSendToPropertyInspector(fn) { this.handlers.sendToPropertyInspector = fn; }
  getSettings() { this.getSettingsCalls++; }
  setSettings(settings) { this.saved.push(settings); }
  sendToPlugin(payload) { this.sent.push(payload); }
}

const document = {
  getElementById(id) {
    return { settings: form, status, refresh }[id];
  },
  createElement(kind) {
    assert.equal(kind, 'option');
    return { value: '', textContent: '', disabled: false };
  }
};
const sandbox = { UlanziApi: FakeUlanziApi, document, setTimeout, clearTimeout, console };
vm.createContext(sandbox);
const source = fs.readFileSync(new URL(
  '../com.ulanzi.dellbrightnessencoder.ulanziPlugin/property-inspector/inspector.js', import.meta.url
), 'utf8');
new vm.Script(source, { filename: 'encoder/property-inspector/inspector.js' }).runInContext(sandbox);

const ud = FakeUlanziApi.instance;
ud.handlers.connected();
assert.equal(ud.getSettingsCalls, 1);
assert.deepEqual(JSON.parse(JSON.stringify(ud.sent.at(-1))), { op: 'listMonitors' });

ud.handlers.didReceiveSettings({ param: {
  step: 'invalid', monitor: '', icon: 'missing', showFeedback: 'off'
} });
assert.equal(step.value, '5');
assert.equal(monitor.value, 'auto');
assert.equal(icon.value, 'brightness-7');
assert.equal(showFeedback.checked, false);

ud.handlers.add({ param: { step: '10', monitor: '7', icon: 'gauge', showFeedback: false } });
assert.equal(step.value, '10');
assert.equal(monitor.value, '7');
assert.equal(icon.value, 'gauge');
assert.equal(showFeedback.checked, false);

ud.handlers.sendToPropertyInspector({ payload: {
  type: 'monitors', ok: true, monitors: [
    { Index: 0, Name: 'Dell U2720Q', Capable: true },
    { index: 1, name: 'Internal panel', capable: false },
    { Index: 2, Description: 'Dock display', DdcCapable: 'false' }
  ]
} });
assert.equal(monitor.value, '7', 'an unavailable saved monitor remains visibly selected');
assert.equal(monitor.options.find(option => option.value === '1').disabled, true);
assert.equal(monitor.options.find(option => option.value === '2').disabled, true);
assert.equal(monitor.options.find(option => option.value === '2').textContent, 'Dock display (no DDC/CI)');
assert.match(monitor.options.find(option => option.value === '7').textContent, /not detected/);
assert.equal(status.className, 'status');
assert.match(status.textContent, /3 monitor/);
assert.deepEqual(JSON.parse(JSON.stringify(ud.sent.at(-1))), {
  op: 'getBrightness', monitor: '7'
});

monitor.value = '0';
monitor.listeners.change();
assert.deepEqual(JSON.parse(JSON.stringify(ud.sent.at(-1))), {
  op: 'getBrightness', monitor: '0'
});

step.value = '3';
icon.value = 'monitor';
showFeedback.checked = true;
form.listeners.input({ target: step });
step.value = '10';
form.listeners.input({ target: step });
await new Promise(resolve => setTimeout(resolve, 180));
assert.deepEqual(JSON.parse(JSON.stringify(ud.saved.at(-1))), {
  step: '10', monitor: '0', icon: 'monitor', showFeedback: true
});
assert.deepEqual(JSON.parse(JSON.stringify(ud.sent.at(-1))), {
  op: 'configure',
  settings: { step: '10', monitor: '0', icon: 'monitor', showFeedback: true }
});
assert.equal(ud.saved.length, 1, 'debounce persists only the latest rapid form edit');

ud.handlers.sendToPropertyInspector({ payload: {
  type: 'brightness', result: { ok: true, current: 64 }
} });
assert.equal(status.textContent, 'Current brightness: 64%');

ud.handlers.sendToPropertyInspector({ payload: {
  type: 'brightness', result: { ok: false, error: 'No matching monitor' }
} });
assert.equal(status.className, 'status error');
assert.equal(status.textContent, 'No matching monitor');

ud.handlers.sendToPropertyInspector({ payload: {
  type: 'monitors', ok: false, monitors: []
} });
assert.equal(status.className, 'status error');
assert.match(status.textContent, /backend unavailable/i);

refresh.listeners.click();
assert.equal(status.textContent, 'Detecting monitors…');
assert.deepEqual(JSON.parse(JSON.stringify(ud.sent.at(-1))), { op: 'listMonitors' });

console.log('property-inspector round-trip and monitor-state checks passed');
