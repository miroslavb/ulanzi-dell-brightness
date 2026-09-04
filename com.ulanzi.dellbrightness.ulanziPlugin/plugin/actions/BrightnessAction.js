// BrightnessAction — one instance per key placed on the deck.
//
// direction: +1 for the "Brighter" action, -1 for "Darker".
// Settings (from the Property Inspector):
//   step    : "1" | "3" | "5" | "10"   (percentage points per press, default 5)
//   monitor : "auto" | "<index>"        (DDC/CI monitor target, default auto)
//
// Keypad actions keep the old non-painting behaviour unless the user explicitly
// selects an MDI icon. D200X feedback is owned by the separate HTML companion.

import { BRIGHTNESS_ICONS, brightnessIconDataUri } from '../icons.js';

const VALID_STEPS = [1, 3, 5, 10];
const DEFAULT_STEP = 5;

export default class BrightnessAction {
  constructor(context, $UD, controller, direction) {
    this.context = context;
    this.$UD = $UD;
    this.controller = controller;
    this.direction = direction > 0 ? 1 : -1;

    this.step = DEFAULT_STEP;
    this.monitor = 'auto';
    this.icon = '';
    this.active = true;
    this.renderSequence = 0;
  }

  updateSettings(settings = {}) {
    const step = parseInt(settings.step, 10);
    this.step = VALID_STEPS.includes(step) ? step : DEFAULT_STEP;

    this.monitor = (settings.monitor === undefined || settings.monitor === null || settings.monitor === '')
      ? 'auto' : String(settings.monitor);

    const icon = String(settings.icon || '').replace(/^mdi:/, '');
    this.icon = BRIGHTNESS_ICONS[icon] ? icon : '';
    if (this.icon) void this.refreshIcon();
  }

  // With the default empty icon we only track visibility and let Studio restore
  // its own configured image. An explicitly selected MDI icon is intentionally
  // repainted when its page becomes active.
  setActive(active) {
    this.active = !!active;
    if (this.active && this.icon) void this.refreshIcon();
  }

  async run() {
    await this.adjust(this.direction);
  }

  async adjust(direction) {
    const delta = (direction < 0 ? -1 : 1) * this.step;
    let res;
    try {
      res = await this.controller.requestAdjust(this.monitor, delta);
    } catch (e) {
      res = { ok: false, error: String(e && e.message || e) };
    }

    if (!res || !res.ok) {
      this.$UD.logMessage(`brightness adjust failed: ${res && res.error}`, 'error');
      this.$UD.showAlert(this.context);
      return res;
    }
    if (this.icon) this.paintIcon(res.current);
    return res;
  }

  async refreshIcon() {
    if (!this.icon) return;
    const sequence = ++this.renderSequence;
    let res;
    try {
      res = await this.controller.get(this.monitor);
    } catch (e) {
      res = null;
    }
    if (sequence !== this.renderSequence || !this.active) return;
    this.paintIcon(res && res.ok ? res.current : null);
  }

  paintIcon(current) {
    const data = brightnessIconDataUri(this.icon, current, { showValue: false });
    this.$UD.setBaseDataIcon(this.context, data, '');
  }

  destroy() { this.renderSequence++; }
}
