// BrightnessAction — one instance per key placed on the deck.
//
// direction: +1 for the "Brighter" action, -1 for "Darker".
// Settings (from the Property Inspector):
//   step    : "1" | "3" | "5" | "10"   (percentage points per press, default 5)
//   monitor : "auto" | "<index>"        (DDC/CI monitor target, default auto)
//
// The action NEVER paints the key icon. The manifest defines the default state
// image, and the host renders the key's configured image — the default, or a
// custom icon the user picked in Ulanzi Studio. Painting from the plugin (on
// add, on screen activation, or to flash the new %) overwrites that custom
// icon, and the SDK provides no way to read the configured image back to
// restore it afterwards. So the key's appearance is left entirely to the host;
// we only react to presses. The brightness change is visible on the monitor
// itself, so no on-key value readout is shown.

const VALID_STEPS = [1, 3, 5, 10];
const DEFAULT_STEP = 5;

export default class BrightnessAction {
  constructor(context, $UD, controller, direction) {
    this.context = context;
    this.$UD = $UD;
    this.controller = controller;
    this.direction = direction >= 0 ? 1 : -1;

    this.step = DEFAULT_STEP;
    this.monitor = 'auto';
    this.active = true;

    // Deliberately no icon paint here — see the file header.
  }

  updateSettings(settings = {}) {
    const step = parseInt(settings.step, 10);
    this.step = VALID_STEPS.includes(step) ? step : DEFAULT_STEP;

    this.monitor = (settings.monitor === undefined || settings.monitor === null || settings.monitor === '')
      ? 'auto' : String(settings.monitor);
  }

  // Track visibility only. We never repaint when the key's screen becomes
  // active again: the host re-renders the key's configured image (a custom
  // icon included) by itself. Repainting here was what reset custom icons on
  // every screen switch.
  setActive(active) {
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

    if (!res || !res.ok) {
      this.$UD.logMessage(`brightness adjust failed: ${res && res.error}`, 'error');
      this.$UD.showAlert(this.context);
    }
    // On success: no on-key feedback on purpose. Drawing the new % would wipe
    // the user's custom key icon, and the brightness change is already visible
    // on the monitor.
  }

  destroy() {}
}
