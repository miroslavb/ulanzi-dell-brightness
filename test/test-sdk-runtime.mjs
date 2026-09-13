import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const pluginRoot = new URL('../com.ulanzi.dellbrightnessencoder.ulanziPlugin/', import.meta.url);
const sdkRoot = new URL('../com.ulanzi.dellbrightness.ulanziPlugin/libs/js/', import.meta.url);
const hostMessages = [];
const bridgeMessages = [];
const nativeSetTimeout = setTimeout;
const nativeClearTimeout = clearTimeout;

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

class BrowserWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    BrowserWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = BrowserWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(raw) {
    this.sent.push(raw);
    const message = JSON.parse(raw);
    if (this.url.includes(':3906')) {
      hostMessages.push(message);
      return;
    }
    bridgeMessages.push(message);
    queueMicrotask(() => this.onmessage?.({
      data: JSON.stringify({ id: message.id, result: { ok: true, current: 55 } })
    }));
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const canvas = {
  getContext() {
    return {
      fillStyle: '', font: '', textAlign: '', textBaseline: '',
      fillRect() {}, fillText() {}, save() {}, restore() {}, translate() {}, scale() {}, fill() {}
    };
  },
  toDataURL() { return 'data:image/png;base64,ZmFrZQ=='; }
};

const sandbox = {
  console,
  URL,
  URLSearchParams,
  WebSocket: BrowserWebSocket,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  Worker: BrowserWorker,
  Blob,
  navigator: { language: 'en-US' },
  location: {
    search: '?address=127.0.0.1&port=3906&uuid=com.ulanzi.ulanzistudio.dellbrightnessencoder'
  },
  document: {
    documentElement: { style: {} },
    body: { style: {} },
    head: {
      appendChild(script) { queueMicrotask(() => script.onload?.()); }
    },
    querySelector() { return null; },
    createElement(kind) {
      if (kind === 'script') return { src: '', remove() {} };
      if (kind === 'canvas') return { ...canvas };
      throw new Error(`unexpected element: ${kind}`);
    }
  },
  DELL_BRIGHTNESS_ICONS: { 'brightness-7': 'M0 0' },
  DELL_BRIGHTNESS_BRIDGE: {
    url: 'ws://127.0.0.1:9236', token: 'a'.repeat(64)
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const file of ['constants.js', 'eventEmitter.js', 'timers.js', 'utils.js', 'ulanziApi.js']) {
  const source = fs.readFileSync(new URL(file, sdkRoot), 'utf8');
  new vm.Script(source, { filename: `libs/js/${file}` }).runInContext(sandbox);
}
const appSource = fs.readFileSync(new URL('plugin/app.js', pluginRoot), 'utf8');
assert.doesNotThrow(() => {
  new vm.Script(appSource, { filename: 'encoder/plugin/app.js' }).runInContext(sandbox);
}, 'the HTML main service must use the SDK-provided global $UD');

await new Promise(resolve => setTimeout(resolve, 0));
const host = BrowserWebSocket.instances.find(socket => socket.url.includes(':3906'));
assert.ok(host, 'the real HTML SDK opened its host connection');
assert.ok(hostMessages.some(message => message.cmd === 'connected'));

const actionEnvelope = {
  cmd: 'add',
  uuid: 'com.ulanzi.ulanzistudio.dellbrightnessencoder.adjust',
  key: '0',
  actionid: 'placed-action',
  param: { step: '5', monitor: '0', showFeedback: true }
};
host.receive(actionEnvelope);
host.receive({
  cmd: 'dialrotate',
  uuid: actionEnvelope.uuid,
  key: actionEnvelope.key,
  actionid: actionEnvelope.actionid,
  param: actionEnvelope.param,
  rotateEvent: 'right'
});
await new Promise(resolve => setTimeout(resolve, 10));
assert.ok(bridgeMessages.some(message =>
  message.op === 'adjust' && message.monitor === '0' && message.delta === 5
), 'an actual SDK dialrotate envelope reaches the DDC bridge');

console.log('real HTML SDK startup and dial envelope checks passed');
