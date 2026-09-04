// Loopback-only bridge for the HTML encoder companion plugin.
// Windows Ulanzi Studio 3.3.6 parses Node-backed Encoder layouts but omits
// those actions from its Knob tree. The companion HTML action is discoverable
// and delegates only the narrow DDC operations below to this Node backend.

import { WebSocketServer } from 'ws';

export const DDC_BRIDGE_PORT = 9236;

export default class DdcBridgeServer {
  constructor(controller, { host = '127.0.0.1', port = DDC_BRIDGE_PORT, log } = {}) {
    this.controller = controller;
    this.host = host;
    this.port = port;
    this.log = log || (() => {});
    this.server = null;
  }

  start() {
    if (this.server) return Promise.resolve(this.address());
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: this.host,
        port: this.port,
        verifyClient: info => this._originAllowed(info.origin)
      });
      this.server = server;
      const startupError = (error) => {
        if (this.server === server) this.server = null;
        reject(error);
      };
      server.once('error', startupError);
      server.once('listening', () => {
        server.off('error', startupError);
        server.on('error', error => this.log(`bridge server error: ${error.message}`));
        server.on('connection', socket => this._onConnection(socket));
        resolve(this.address());
      });
    });
  }

  address() {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address : null;
  }

  _onConnection(socket) {
    socket.on('message', data => {
      if (data.length > 4096) {
        socket.close(1009, 'message too large');
        return;
      }
      void this._handle(socket, data);
    });
  }

  async _handle(socket, raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      this._reply(socket, null, { ok: false, error: 'invalid_json' });
      return;
    }
    const id = Number.isInteger(message?.id) ? message.id : null;
    const monitor = this._monitor(message?.monitor);
    let result;
    try {
      if (message?.op === 'list') {
        result = await this.controller.list();
      } else if (message?.op === 'get') {
        result = await this.controller.get(monitor);
      } else if (message?.op === 'adjust') {
        const delta = Number(message.delta);
        if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 25) {
          result = { ok: false, error: 'invalid_delta' };
        } else {
          result = await this.controller.requestAdjust(monitor, delta);
        }
      } else {
        result = { ok: false, error: 'unsupported_operation' };
      }
    } catch (error) {
      result = { ok: false, error: String(error?.message || error) };
    }
    this._reply(socket, id, result);
  }

  _monitor(value) {
    if (value === undefined || value === null || value === '' || value === 'auto') return 'auto';
    const index = Number.parseInt(value, 10);
    return Number.isInteger(index) && index >= 0 && index <= 63 ? String(index) : 'auto';
  }

  _originAllowed(origin) {
    if (!origin || origin === 'null' || origin === 'file://') return true;
    try {
      const url = new URL(origin);
      return ['http:', 'https:'].includes(url.protocol)
        && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    } catch {
      return false;
    }
  }

  _reply(socket, id, result) {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify({ id, result }));
  }

  close() {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    for (const client of server.clients) client.close();
    return new Promise(resolve => server.close(() => resolve()));
  }
}
