import { BRIGHTNESS_ICONS, DEFAULT_BRIGHTNESS_ICON, brightnessIconDataUri } from '../icons.js';

const DEFAULT_POLL_INTERVAL_MS = 2000;

export default class BrightnessDisplayAction {
  constructor(context, $UD, controller, {
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
  } = {}) {
    this.context = context;
    this.$UD = $UD;
    this.controller = controller;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.pollIntervalMs = pollIntervalMs;
    this.monitor = 'auto';
    this.icon = DEFAULT_BRIGHTNESS_ICON;
    this.active = true;
    this.pollTimer = null;
    this.renderSequence = 0;
  }

  updateSettings(settings = {}) {
    this.monitor = settings.monitor === undefined || settings.monitor === null || settings.monitor === ''
      ? 'auto' : String(settings.monitor);
    const requestedIcon = String(settings.icon || '').replace(/^mdi:/, '');
    this.icon = BRIGHTNESS_ICONS[requestedIcon] ? requestedIcon : DEFAULT_BRIGHTNESS_ICON;
    this.startPolling();
    void this.refresh();
  }

  run() {
    return this.refresh();
  }

  setActive(active) {
    this.active = !!active;
    if (!this.active) {
      this.stopPolling();
      this.renderSequence++;
      return;
    }
    this.startPolling();
    void this.refresh();
  }

  startPolling() {
    if (!this.active || this.pollTimer !== null) return;
    this.pollTimer = this.setIntervalFn(() => this.refresh(), this.pollIntervalMs);
  }

  stopPolling() {
    if (this.pollTimer === null) return;
    this.clearIntervalFn(this.pollTimer);
    this.pollTimer = null;
  }

  async refresh() {
    const sequence = ++this.renderSequence;
    let result;
    try {
      result = await this.controller.get(this.monitor);
    } catch (error) {
      result = { ok: false, error: String(error?.message || error) };
    }
    if (sequence !== this.renderSequence || !this.active) return result;
    const current = result && result.ok ? result.current : null;
    this.$UD.setBaseDataIcon(
      this.context,
      brightnessIconDataUri(this.icon, current, { showValue: true }),
      ''
    );
    return result;
  }

  destroy() {
    this.stopPolling();
    this.active = false;
    this.renderSequence++;
  }
}
