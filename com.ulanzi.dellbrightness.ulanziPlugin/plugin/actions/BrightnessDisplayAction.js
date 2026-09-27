// Read-only Brightness Display tile. Settings:
//   monitor   : "auto" | "<index>"
//   icon      : any MDI name (with or without "mdi:"); "" or unknown -> brightness-7
//   iconColor : "#rrggbb" (default #facc15); brightness is encoded as the
//               glyph's colour intensity (see icons.js), unknown -> grey.

import {
  DEFAULT_BRIGHTNESS_ICON,
  brightnessIconDataUri,
  normalizeIconColor,
  resolveIconPath
} from '../icons.js';
import { normalizeIconName } from '../mdiCatalog.js';

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
    this.iconColor = normalizeIconColor();
    this.active = true;
    this.pollTimer = null;
    this.renderSequence = 0;
  }

  updateSettings(settings = {}) {
    this.monitor = settings.monitor === undefined || settings.monitor === null || settings.monitor === ''
      ? 'auto' : String(settings.monitor);
    const requestedIcon = normalizeIconName(settings.icon);
    this.icon = requestedIcon && resolveIconPath(requestedIcon) ? requestedIcon : DEFAULT_BRIGHTNESS_ICON;
    this.iconColor = normalizeIconColor(settings.iconColor);
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
      brightnessIconDataUri(this.icon, current, { showValue: true, color: this.iconColor }),
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
