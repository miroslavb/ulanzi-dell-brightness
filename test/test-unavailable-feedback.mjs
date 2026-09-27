import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { brightnessIconDataUri } from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/icons.js';

for (const missing of [null, undefined, '', NaN]) {
  const svg = Buffer.from(brightnessIconDataUri('monitor', missing, { showValue: true }).split(',')[1], 'base64').toString();
  assert.doesNotMatch(svg, />0%<\/text>/, 'missing DDC readings must not become zero percent');
  assert.match(svg, />--<\/text>/, 'the read-only tile must show an explicit unavailable value');
}
const zero = Buffer.from(brightnessIconDataUri('monitor', 0, { showValue: true }).split(',')[1], 'base64').toString();
assert.match(zero, />0%<\/text>/, 'a genuine zero reading must still be displayed');

const texts = [];
const drawing = new Proxy({}, { get: (_, name) => name === 'fillText' ? text => texts.push(text) : () => {}, set: () => true });
const sandbox = {
  window: { DELL_BRIGHTNESS_ICONS: {} },
  document: { createElement: () => ({ getContext: () => drawing, toDataURL: () => 'data:image/png;base64,AA==' }) },
  $UD: new Proxy({}, { get: () => () => {} }),
  URL, setTimeout, clearTimeout
};
vm.runInNewContext(fs.readFileSync(new URL('../com.ulanzi.dellbrightnessencoder.ulanziPlugin/plugin/app.js', import.meta.url), 'utf8'), sandbox);
for (const missing of [null, undefined, '', NaN]) {
  texts.length = 0;
  sandbox.window.DellBrightnessEncoder.renderFeedback({ showFeedback: true }, missing, true);
  assert.ok(texts.includes('--'), 'encoder feedback must show unavailable rather than invented zero');
  assert.ok(!texts.includes('0%'));
}
texts.length = 0;
sandbox.window.DellBrightnessEncoder.renderFeedback({ showFeedback: true }, 0, false);
assert.ok(texts.includes('0%'));
console.log('unavailable/zero reading regressions passed for keypad and encoder');
