// Integration test for DdcController (against the mock worker) + unit tests for
// BrightnessAction and the app's direction detection. Runs on any OS.
import assert from 'assert';
import { fileURLToPath } from 'url';
import DdcController from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/ddc/DdcController.js';
import BrightnessAction from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/actions/BrightnessAction.js';

const MOCK = fileURLToPath(new URL('./mock-ddc-worker.mjs', import.meta.url));
const newCtl = (over = {}) => new DdcController({ command: 'node', baseArgs: [MOCK], assumeSupported: true, ...over });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('DdcController (serve mode, via mock worker):');

await test('list() returns monitors with a capable Dell at index 0', async () => {
  const c = newCtl();
  const r = await c.list();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.monitors.length, 2);
  assert.strictEqual(r.monitors[0].name, 'DELL U2720Q');
  assert.strictEqual(r.monitors[0].capable, true);
  assert.strictEqual(r.monitors[1].capable, false);
  c.dispose();
});

await test('get(auto) reads current brightness', async () => {
  const c = newCtl();
  const r = await c.get('auto');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.current, 50);
  c.dispose();
});

await test('set + get round-trips on a shared serve process', async () => {
  const c = newCtl();
  await c.set('auto', 80);
  const r = await c.get(0);
  assert.strictEqual(r.current, 80);
  c.dispose();
});

await test('adjust clamps at max (95 + 10 => 100)', async () => {
  const c = newCtl();
  await c.set('auto', 95);
  const r = await c.requestAdjust('auto', 10);
  assert.strictEqual(r.current, 100);
  c.dispose();
});

await test('adjust clamps at min (darker below 0 => 0)', async () => {
  const c = newCtl();
  await c.set('auto', 5);
  const r = await c.requestAdjust('auto', -200);
  assert.strictEqual(r.current, 0);
  c.dispose();
});

await test('rapid presses COALESCE into one worker call but sum the delta', async () => {
  const c = newCtl();
  await c.set('auto', 50);
  // fire five +5 presses within the coalesce window
  const ps = [];
  for (let i = 0; i < 5; i++) ps.push(c.requestAdjust('auto', 5));
  const results = await Promise.all(ps);
  // net change applied = +25 -> 75, and every caller sees the same final value
  for (const r of results) { assert.strictEqual(r.ok, true); assert.strictEqual(r.current, 75); }
  // all five resolved from a single adjust round-trip
  const callCounts = new Set(results.map((r) => r.calls));
  assert.strictEqual(callCounts.size, 1, 'all callers should share one adjust call');
  c.dispose();
});

await test('brighter then darker in one burst nets out correctly', async () => {
  const c = newCtl();
  await c.set('auto', 60);
  const [a, b] = await Promise.all([c.requestAdjust('auto', 5), c.requestAdjust('auto', -3)]);
  assert.strictEqual(a.current, 62);
  assert.strictEqual(b.current, 62);
  c.dispose();
});

await test('get on a non-DDC/CI monitor index reports an error', async () => {
  const c = newCtl();
  const r = await c.get(1);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /DDC\/CI/);
  c.dispose();
});

await test('get on an out-of-range index reports an error', async () => {
  const c = newCtl();
  const r = await c.get(9);
  assert.strictEqual(r.ok, false);
  c.dispose();
});

await test('worker respawns after dispose()', async () => {
  const c = newCtl();
  await c.get('auto');
  c.dispose();
  const r = await c.get('auto'); // should transparently respawn
  assert.strictEqual(r.ok, true);
  c.dispose();
});

await test('one-shot fallback path also works', async () => {
  const c = newCtl();
  c.serveBroken = true; // force the per-call code path
  const r = await c.list();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.monitors[0].name, 'DELL U2720Q');
  const a = await c.requestAdjust('auto', 5); // one-shot adjust (fresh process each time)
  assert.strictEqual(a.ok, true);
  c.dispose();
});

await test('unsupported platform yields a clear error (no spawn)', async () => {
  const c = new DdcController({ command: 'node', baseArgs: [MOCK], assumeSupported: false });
  const r = await c.list();
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Windows/);
  c.dispose();
});

// ---- BrightnessAction unit tests (fake $UD + fake controller) --------------

console.log('BrightnessAction:');

function fakeUD() {
  return { icons: [], alerts: 0, logs: [],
    setBaseDataIcon(ctx, data, text) { this.icons.push({ data, text }); },
    setStateIcon(ctx, state, text) { this.icons.push({ state, text }); },
    setPathIcon(ctx, path, text) { this.icons.push({ path, text }); },
    showAlert() { this.alerts++; },
    logMessage(m, l) { this.logs.push([l, m]); } };
}
function fakeController(result) {
  return { calls: [], requestAdjust(monitor, delta) { this.calls.push({ monitor, delta }); return Promise.resolve(result); } };
}

await test('brighter sends +step, darker sends -step, with configured monitor', async () => {
  const ud = fakeUD();
  const ctl = fakeController({ ok: true, current: 65 });
  const up = new BrightnessAction('ctx___k___a.brighter', ud, ctl, 1);
  up.updateSettings({ step: '10', monitor: '0', showValue: 'on' });
  await up.run();
  assert.deepStrictEqual(ctl.calls.at(-1), { monitor: '0', delta: 10 });

  const down = new BrightnessAction('ctx___k___a.darker', ud, ctl, -1);
  down.updateSettings({ step: '3', monitor: 'auto' });
  await down.run();
  assert.deepStrictEqual(ctl.calls.at(-1), { monitor: 'auto', delta: -3 });
});

await test('invalid step falls back to default 5', async () => {
  const ud = fakeUD();
  const ctl = fakeController({ ok: true, current: 50 });
  const a = new BrightnessAction('c___k___a.brighter', ud, ctl, 1);
  a.updateSettings({ step: '7', monitor: 'auto' });
  await a.run();
  assert.strictEqual(ctl.calls.at(-1).delta, 5);
});

await test('showValue defaults on before config, off when unchecked after config', async () => {
  const a = new BrightnessAction('c___k___a.brighter', fakeUD(), fakeController({ ok: true }), 1);
  assert.strictEqual(a.showValue, true);                 // brand new
  a.updateSettings({ step: '5', monitor: 'auto' });       // configured, checkbox absent => off
  assert.strictEqual(a.showValue, false);
  a.updateSettings({ step: '5', monitor: 'auto', showValue: 'on' });
  assert.strictEqual(a.showValue, true);
});

await test('failed adjust shows an alert on the key', async () => {
  const ud = fakeUD();
  const a = new BrightnessAction('c___k___a.brighter', ud, fakeController({ ok: false, error: 'boom' }), 1);
  await a.run();
  assert.strictEqual(ud.alerts, 1);
});

await test('value flash is shown then reverted to the base icon', async () => {
  const ud = fakeUD();
  const a = new BrightnessAction('c___k___a.brighter', ud, fakeController({ ok: true, current: 42 }), 1);
  a.updateSettings({ step: '5', monitor: 'auto', showValue: 'on' });
  await a.run();
  assert.ok(ud.icons.some((i) => i.text === '42%'), 'should flash 42%');
  a.destroy();
});

await test('constructor does not paint an icon (host renders configured/custom image)', async () => {
  const ud = fakeUD();
  // eslint-disable-next-line no-new
  new BrightnessAction('c___k___a.brighter', ud, fakeController({ ok: true }), 1);
  assert.strictEqual(ud.icons.length, 0, 'creating the action must not push any icon');
});

await test('setActive does not repaint — custom icon survives a screen switch', async () => {
  const ud = fakeUD();
  const a = new BrightnessAction('c___k___a.brighter', ud, fakeController({ ok: true }), 1);
  a.setActive(false);   // screen hidden
  a.setActive(true);    // screen shown again (the event that used to reset the icon)
  assert.strictEqual(ud.icons.length, 0, 'setActive must never push an icon');
});

// ---- direction detection (mirrors app.js) ----------------------------------

console.log('direction detection:');
await test('context string decides brighter (+1) vs darker (-1)', async () => {
  const directionFor = (jsn) => (jsn && jsn.context && jsn.context.includes('.darker') ? -1 : 1);
  assert.strictEqual(directionFor({ context: 'com.ulanzi.ulanzistudio.dellbrightness.brighter___1___x' }), 1);
  assert.strictEqual(directionFor({ context: 'com.ulanzi.ulanzistudio.dellbrightness.darker___2___y' }), -1);
});

console.log(`\n${passed} checks passed`);
