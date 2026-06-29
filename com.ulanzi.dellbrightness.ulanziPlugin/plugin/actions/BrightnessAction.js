// BrightnessAction — one instance per key placed on the deck.
//
// direction: +1 for the "Brighter" action, -1 for "Darker".
// Settings (from the Property Inspector):
//   step      : "1" | "3" | "5" | "10"   (percentage points per press, default 5)
//   monitor   : "auto" | "<index>"        (DDC/CI monitor target, default auto)
//   showValue : "on" | undefined          (briefly show the new % on the key, default on)

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const VALID_STEPS = [1, 3, 5, 10];
const DEFAULT_STEP = 5;
const VALUE_DISPLAY_MS = 1500;

// Bundled icons are embedded as base64 data URIs and pushed with setBaseDataIcon.
// This is the path-independent method used by the official demos; passing a
// plugin-relative path to setPathIcon does NOT resolve on the host and blanks the key.
function loadDataUri(relToThisFile) {
  try {
    const p = fileURLToPath(new URL(relToThisFile, import.meta.url));
    return 'data:image/png;base64,' + readFileSync(p).toString('base64');
  } catch {
    return null;
  }
}
const ICON_DATA = {
  brighter: loadDataUri('../../assets/icons/brighter.png'),
  darker: loadDataUri('../../assets/icons/darker.png'),
};

export default class BrightnessAction {
  constructor(context, $UD, controller, direction) {
    this.context = context;
    this.$UD = $UD;
    this.controller = controller;
    this.direction = direction >= 0 ? 1 : -1;
    this.iconData = this.direction > 0 ? ICON_DATA.brighter : ICON_DATA.darker;

    this.step = DEFAULT_STEP;
    this.monitor = 'auto';
    this.showValue = true;

    this.active = true;
    this.revertTimer = null;

    // Intentionally do NOT paint an icon on creation. The host already renders
    // the key's configured image — the manifest default state icon, or the
    // user's own custom icon if they set one. Painting here would overwrite a
    // user-chosen custom icon the moment the action is (re)added.
  }

  updateSettings(settings = {}) {
    const configured = settings && (('step' in settings) || ('monitor' in settings) || ('showValue' in settings));

    const step = parseInt(settings.step, 10);
    this.step = VALID_STEPS.includes(step) ? step : DEFAULT_STEP;

    this.monitor = (settings.monitor === undefined || settings.monitor === null || settings.monitor === '')
      ? 'auto' : String(settings.monitor);

    this.showValue = configured
      ? (settings.showValue === 'on' || settings.showValue === true)
      : true;
  }

  setActive(active) {
    // Track visibility only. We deliberately do NOT repaint the base icon when
    // the key's screen becomes active again: the host re-renders the key's
    // configured image (a custom icon included) by itself on every screen
    // switch. Repainting here is exactly what used to reset a user's custom
    // icon back to the plugin default on each switch.
    this.active = !!active;
  }

  async run() {
    const delta = this.direction * this.step;
    let res;
    try {
      res = await this.controller.requestAdjust(this.monitor, delta);
    } catch (e) {
      res = { ok: false, error: String(e && e.message || e) };
    }

    if (res && res.ok) {
      if (this.showValue) this._flashValue(res.current);
    } else {
      this.$UD.logMessage(`brightness adjust failed: ${res && res.error}`, 'error');
      this.$UD.showAlert(this.context);
    }
  }

  destroy() {
    if (this.revertTimer) clearTimeout(this.revertTimer);
    this.revertTimer = null;
  }

  // ---- icon helpers --------------------------------------------------------

  // Render our sun icon with optional overlay text. Prefer embedded base64
  // (reliable everywhere); fall back to the manifest state icon if the file
  // could not be read for some reason.
  _setIcon(text) {
    if (this.iconData) this.$UD.setBaseDataIcon(this.context, this.iconData, text);
    else this.$UD.setStateIcon(this.context, 0, text);
  }

  // Revert target after a value flash. This is the ONLY place that paints the
  // plugin's own icon, and it runs only after a key press (never on add or
  // screen switch). If the user set a custom icon, it is briefly replaced by
  // the default while the flash is showing and is restored by the host on the
  // next screen switch.
  _showBaseIcon() {
    if (this.revertTimer) { clearTimeout(this.revertTimer); this.revertTimer = null; }
    this._setIcon('');
  }

  _flashValue(current) {
    if (typeof current !== 'number' || current < 0) return;
    this._setIcon(`${current}%`);
    if (this.revertTimer) clearTimeout(this.revertTimer);
    this.revertTimer = setTimeout(() => this._showBaseIcon(), VALUE_DISPLAY_MS);
  }
}
