import assert from 'node:assert/strict';
import fs from 'node:fs';
import BrightnessDisplayAction from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/actions/BrightnessDisplayAction.js';

const manifest = JSON.parse(fs.readFileSync(new URL(
  '../com.ulanzi.dellbrightness.ulanziPlugin/manifest.json', import.meta.url
), 'utf8'));
const ids = manifest.Actions.map(action => action.UUID);
assert.deepEqual(ids.slice(0, 2), [
  'com.ulanzi.ulanzistudio.dellbrightness.brighter',
  'com.ulanzi.ulanzistudio.dellbrightness.darker'
], 'legacy Brighter/Darker UUIDs and ordering remain stable');
const displayManifest = manifest.Actions.find(action =>
  action.UUID === 'com.ulanzi.ulanzistudio.dellbrightness.display'
);
assert.ok(displayManifest, 'a dedicated current-brightness keypad action exists');
assert.deepEqual(displayManifest.Controllers, ['Keypad']);
assert.equal(manifest.Version, '1.2.1');

const appSource = fs.readFileSync(new URL(
  '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/app.js', import.meta.url
), 'utf8');
assert.match(appSource, /import BrightnessDisplayAction/);
assert.match(appSource, /new BrightnessDisplayAction\(jsn\.context, \$UD, controller\)/,
  'the Node event router constructs the read-only action for its dedicated UUID');

const timerCallbacks = new Map();
let nextTimer = 1;
const timers = {
  setIntervalFn(fn, ms) {
    const id = nextTimer++;
    timerCallbacks.set(id, { fn, ms });
    return id;
  },
  clearIntervalFn(id) { timerCallbacks.delete(id); }
};
const ud = {
  icons: [], alerts: [],
  setBaseDataIcon(context, data, text) { this.icons.push({ context, data, text }); },
  showAlert(context) { this.alerts.push(context); },
  logMessage() {}
};
const controller = {
  gets: [],
  adjustments: 0,
  async get(monitor) {
    this.gets.push(monitor);
    return { ok: true, current: 64 };
  },
  async requestAdjust() {
    this.adjustments++;
    throw new Error('display action must never adjust brightness');
  }
};

const action = new BrightnessDisplayAction('display-context', ud, controller, {
  ...timers,
  pollIntervalMs: 2000
});
action.updateSettings({ monitor: '2', icon: 'monitor' });
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(controller.gets, ['2'], 'placement/configuration reads brightness immediately');
assert.equal(timerCallbacks.size, 1, 'an active display polls continuously');
assert.equal([...timerCallbacks.values()][0].ms, 2000);
assert.equal(ud.icons.length, 1);
assert.match(ud.icons[0].data, /^data:image\/svg\+xml;base64,/);
assert.match(Buffer.from(ud.icons[0].data.split(',')[1], 'base64').toString(), />64%<\/text>/);

await action.run();
assert.equal(controller.adjustments, 0, 'pressing the display tile never changes the monitor');
assert.deepEqual(controller.gets, ['2', '2'], 'pressing only refreshes the reading');

const poll = [...timerCallbacks.values()][0];
await poll.fn();
assert.deepEqual(controller.gets, ['2', '2', '2']);

action.setActive(false);
assert.equal(timerCallbacks.size, 0, 'hidden display tiles stop polling');
action.setActive(true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(timerCallbacks.size, 1);
assert.equal(controller.gets.length, 4, 'visible display tiles refresh immediately');
action.destroy();
assert.equal(timerCallbacks.size, 0);

const failedUd = { ...ud, icons: [], alerts: [], setBaseDataIcon: ud.setBaseDataIcon, showAlert: ud.showAlert };
const failed = new BrightnessDisplayAction('failed-display', failedUd, {
  async get() { return { ok: false, error: 'no monitor' }; }
}, { ...timers, pollIntervalMs: 2000 });
await failed.refresh();
assert.equal(failedUd.icons.length, 1, 'a failed read still renders an explicit unavailable tile');
assert.equal(failedUd.alerts.length, 0, 'background polling does not flash repeated host alerts');
failed.destroy();

console.log('live current-brightness display action checks passed');
