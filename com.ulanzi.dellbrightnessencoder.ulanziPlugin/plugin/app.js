(function () {
  'use strict';

  const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.dellbrightnessencoder';
  const BRIDGE_URL = 'ws://127.0.0.1:9236';
  const BLANK_FEEDBACK = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
  const VALID_STEPS = [1, 3, 5, 10];
  const ACTIONS = new Map();

  class BridgeClient {
    constructor(url) {
      this.url = url;
      this.socket = null;
      this.connectPromise = null;
      this.nextId = 1;
      this.pending = new Map();
    }

    connect() {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
      if (this.connectPromise) return this.connectPromise;
      this.connectPromise = new Promise((resolve, reject) => {
        const socket = new WebSocket(this.url);
        this.socket = socket;
        const timer = setTimeout(() => {
          try { socket.close(); } catch (e) {}
          reject(new Error('DDC backend connection timed out'));
        }, 2000);
        socket.onopen = () => {
          clearTimeout(timer);
          this.connectPromise = null;
          resolve();
        };
        socket.onerror = () => {
          clearTimeout(timer);
          this.connectPromise = null;
          reject(new Error('DDC backend is unavailable'));
        };
        socket.onclose = () => {
          clearTimeout(timer);
          if (this.socket === socket) this.socket = null;
          this.connectPromise = null;
          this.rejectPending(new Error('DDC backend disconnected'));
        };
        socket.onmessage = event => this.onMessage(event.data);
      });
      return this.connectPromise;
    }

    async request(op, data) {
      await this.connect();
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('DDC backend request timed out'));
        }, 5000);
        this.pending.set(id, { resolve, reject, timer });
        this.socket.send(JSON.stringify({ id, op, ...(data || {}) }));
      });
    }

    onMessage(raw) {
      let message;
      try { message = JSON.parse(raw); } catch (e) { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      pending.resolve(message.result || { ok: false, error: 'empty_response' });
    }

    rejectPending(error) {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    }
  }

  function parseSettings(value) {
    const settings = value && typeof value === 'object' ? value : {};
    const step = Number.parseInt(settings.step, 10);
    const monitor = settings.monitor === undefined || settings.monitor === null || settings.monitor === ''
      ? 'auto' : String(settings.monitor);
    const requestedIcon = String(settings.icon || 'brightness-7').replace(/^mdi:/, '');
    const icon = window.DELL_BRIGHTNESS_ICONS[requestedIcon] ? requestedIcon : 'brightness-7';
    const showFeedback = !(
      settings.showFeedback === false || settings.showFeedback === 'false' || settings.showFeedback === 'off'
    );
    return {
      step: VALID_STEPS.includes(step) ? step : 5,
      monitor,
      icon,
      showFeedback
    };
  }

  function renderFeedback(settings, current, failed) {
    if (!settings.showFeedback) return BLANK_FEEDBACK;
    const canvas = document.createElement('canvas');
    canvas.width = 144;
    canvas.height = 144;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = failed ? '#35161b' : '#101820';
    ctx.fillRect(0, 0, 144, 144);

    const pathData = window.DELL_BRIGHTNESS_ICONS[settings.icon];
    if (pathData && typeof Path2D !== 'undefined') {
      try {
        const path = new Path2D(pathData);
        ctx.save();
        ctx.fillStyle = failed ? '#fb7185' : '#fbbf24';
        ctx.translate(48, 16);
        ctx.scale(2, 2);
        ctx.fill(path);
        ctx.restore();
      } catch (e) {}
    }

    ctx.fillStyle = failed ? '#fecdd3' : '#f8fafc';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Number.isFinite(Number(current)) ? `${Math.round(Number(current))}%` : '--', 72, 103);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(failed ? 'BACKEND' : 'BRIGHTNESS', 72, 130);
    return canvas.toDataURL('image/png').split(',')[1];
  }

  class BrightnessEncoderAction {
    constructor(context, bridge) {
      this.context = context;
      this.bridge = bridge;
      this.settings = parseSettings();
      this.sequence = 0;
    }

    configure(settings) {
      this.settings = parseSettings({ ...this.settings, ...(settings || {}) });
      void this.refresh();
    }

    paint(current, failed) {
      $UD.setBaseDataIcon(this.context, renderFeedback(this.settings, current, failed), '');
    }

    async refresh() {
      const sequence = ++this.sequence;
      try {
        const result = await this.bridge.request('get', { monitor: this.settings.monitor });
        if (sequence !== this.sequence) return result;
        this.paint(result && result.ok ? result.current : null, !result || !result.ok);
        return result;
      } catch (error) {
        if (sequence === this.sequence) this.paint(null, true);
        return { ok: false, error: error.message };
      }
    }

    async adjust(direction) {
      try {
        const result = await this.bridge.request('adjust', {
          monitor: this.settings.monitor,
          delta: direction * this.settings.step
        });
        this.paint(result && result.ok ? result.current : null, !result || !result.ok);
        if (!result || !result.ok) $UD.showAlert(this.context);
        return result;
      } catch (error) {
        this.paint(null, true);
        $UD.showAlert(this.context);
        return { ok: false, error: error.message };
      }
    }

    destroy() { this.sequence++; }
  }

  const bridge = new BridgeClient(BRIDGE_URL);
  const $UD = new UlanziApi();
  $UD.connect(PLUGIN_UUID);
  $UD.onConnected(() => $UD.logMessage('Dell brightness encoder connected', 'info'));

  function ensureAction(message) {
    let action = ACTIONS.get(message.context);
    if (!action) {
      action = new BrightnessEncoderAction(message.context, bridge);
      ACTIONS.set(message.context, action);
    }
    return action;
  }

  function applySettings(message) {
    const action = ensureAction(message);
    action.configure(message.param || {});
    return action;
  }

  $UD.onAdd(message => applySettings(message));
  $UD.onParamFromPlugin(message => applySettings(message));
  $UD.onParamFromApp(message => applySettings(message));
  $UD.onSetActive(message => {
    if (message.active !== false) void ensureAction(message).refresh();
  });
  $UD.onDialRotateLeft(message => { void ensureAction(message).adjust(-1); });
  $UD.onDialRotateRight(message => { void ensureAction(message).adjust(1); });
  $UD.onDialDown(message => { void ensureAction(message).refresh(); });

  $UD.onSendToPlugin(async message => {
    const payload = message.payload || message.param || {};
    const context = message.context;
    if (payload.op === 'configure') {
      const settings = parseSettings(payload.settings);
      ensureAction(message).configure(settings);
      $UD.setSettings(settings, context);
      return;
    }
    if (payload.op === 'listMonitors') {
      let result;
      try { result = await bridge.request('list'); }
      catch (error) { result = { ok: false, error: error.message, monitors: [] }; }
      const monitors = !result || !result.monitors ? []
        : (Array.isArray(result.monitors) ? result.monitors : [result.monitors]);
      $UD.sendToPropertyInspector({ type: 'monitors', ok: !!result.ok, monitors }, context);
      return;
    }
    if (payload.op === 'getBrightness') {
      let result;
      try { result = await bridge.request('get', { monitor: payload.monitor }); }
      catch (error) { result = { ok: false, error: error.message }; }
      $UD.sendToPropertyInspector({ type: 'brightness', result }, context);
    }
  });

  $UD.onClear(message => {
    if (!Array.isArray(message.param)) return;
    for (const item of message.param) {
      const context = item.context || $UD.encodeContext(item);
      const action = ACTIONS.get(context);
      if (action) action.destroy();
      ACTIONS.delete(context);
    }
  });

  window.DellBrightnessEncoder = {
    BridgeClient,
    BrightnessEncoderAction,
    parseSettings,
    renderFeedback,
    BLANK_FEEDBACK
  };
})();
