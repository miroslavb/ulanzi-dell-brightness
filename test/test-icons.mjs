// Icon renderer, colour/intensity encoding, Display layout, MDI catalogue
// search, and the rule that the full catalogue never reaches a webview.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRIGHTNESS_ICONS,
  DEFAULT_BRIGHTNESS_ICON,
  DEFAULT_ICON_COLOR,
  DISPLAY_LAYOUT,
  ICON_ONLY_LAYOUT,
  INTENSITY_FLOOR,
  QUICK_PICK_ICONS,
  TILE_BACKGROUND,
  UNKNOWN_ICON_COLOR,
  brightnessIconDataUri,
  brightnessIconSvg,
  iconIntensity,
  intensityColor,
  mixHex,
  normalizeIconColor,
  resolveIconPath
} from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/icons.js';
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  MdiCatalog,
  mdiCatalog,
  normalizeIconName,
  normalizeSearchQuery
} from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/mdiCatalog.js';
import BrightnessAction from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/actions/BrightnessAction.js';
import BrightnessDisplayAction from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/actions/BrightnessDisplayAction.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BACKEND = path.join(ROOT, 'com.ulanzi.dellbrightness.ulanziPlugin');
const ENCODER = path.join(ROOT, 'com.ulanzi.dellbrightnessencoder.ulanziPlugin');
const CATALOG_FILE = path.join(BACKEND, 'plugin', 'data', 'mdi-icons.json');
const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}\n    ${error.stack || error.message}`); process.exitCode = 1; }
}

const svgOf = uri => Buffer.from(uri.split(',')[1], 'base64').toString();
const glyphFill = svg => svg.match(/<path d="[^"]+" fill="(#[0-9a-f]{6})"\/>/)[1];
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

console.log('intensity encoding:');

await test('intensity is linear from the 30% floor at 0% to full at 100%', () => {
  assert.equal(INTENSITY_FLOOR, 0.3);
  assert.equal(iconIntensity(0), 0.3);
  assert.ok(Math.abs(iconIntensity(50) - 0.65) < 1e-9);
  assert.equal(iconIntensity(100), 1);
  assert.ok(Math.abs(iconIntensity(25) - 0.475) < 1e-9);
  assert.equal(iconIntensity(-20), 0.3, 'below-range readings clamp to the floor');
  assert.equal(iconIntensity(250), 1, 'above-range readings clamp to full');
  assert.equal(iconIntensity('40'), 0.3 + 0.7 * 0.4);
});

await test('unknown brightness has no intensity and renders neutral grey', () => {
  for (const unknown of [null, undefined, '', '  ', NaN, 'abc', {}, [], true]) {
    assert.equal(iconIntensity(unknown), null, `intensity for ${String(unknown)}`);
    assert.equal(intensityColor('#facc15', unknown), UNKNOWN_ICON_COLOR);
  }
  assert.notEqual(UNKNOWN_ICON_COLOR, intensityColor('#facc15', 0), 'unknown is not dim-as-zero');
});

await test('colour mixes toward the tile background channel by channel', () => {
  assert.equal(intensityColor('#facc15', 100), '#facc15');
  assert.equal(intensityColor('#facc15', 0), mixHex('#facc15', TILE_BACKGROUND, 0.3));
  assert.equal(mixHex('#ffffff', '#000000', 0.5), '#808080');
  assert.equal(mixHex('#ff0000', '#000000', 0), '#000000');
  assert.equal(mixHex('#38bdf8', TILE_BACKGROUND, 1), '#38bdf8');
  // 0% keeps a clearly visible glyph: well above the background luminance.
  const zero = intensityColor('#facc15', 0);
  assert.ok(luminance(zero) - luminance(TILE_BACKGROUND) > 40, `0% colour ${zero} is visible`);
});

await test('Display tile fill at 0/50/100/unknown follows the intensity mapping', () => {
  const fills = [0, 50, 100].map(level =>
    glyphFill(brightnessIconSvg('monitor', level, { showValue: true, color: '#38BDF8' })));
  assert.equal(fills[0], mixHex('#38bdf8', TILE_BACKGROUND, 0.3));
  assert.equal(fills[1], mixHex('#38bdf8', TILE_BACKGROUND, 0.65));
  assert.equal(fills[2], '#38bdf8');
  assert.ok(luminance(fills[0]) < luminance(fills[1]) && luminance(fills[1]) < luminance(fills[2]));
  const unknown = brightnessIconSvg('monitor', null, { showValue: true, color: '#38bdf8' });
  assert.equal(glyphFill(unknown), UNKNOWN_ICON_COLOR);
  assert.match(unknown, />--<\/text>/);
});

console.log('colour validation:');

await test('only #rrggbb colours are accepted, normalized to lowercase', () => {
  assert.equal(DEFAULT_ICON_COLOR, '#facc15');
  assert.equal(normalizeIconColor('#ABCDEF'), '#abcdef');
  assert.equal(normalizeIconColor(' #38bdf8 '), '#38bdf8');
  for (const bad of [undefined, null, '', 'facc15', '#fff', '#abcdeg', '#abcdef0', 'red',
    'rgb(1,2,3)', '#abcdef" onload="x', 123, {}, ['#abcdef']]) {
    assert.equal(normalizeIconColor(bad), DEFAULT_ICON_COLOR, `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal(normalizeIconColor('nope', '#000000'), '#000000');
});

await test('an invalid colour never reaches the SVG', () => {
  const svg = brightnessIconSvg('monitor', 100, { showValue: true, color: '"/><script>' });
  assert.equal(glyphFill(svg), DEFAULT_ICON_COLOR);
  assert.doesNotMatch(svg, /script/);
});

console.log('Display tile layout:');

await test('value text is smaller and clearly separated from the icon', () => {
  const { iconSize, iconY, valueFontSize, valueBaseline } = DISPLAY_LAYOUT;
  assert.ok(valueFontSize >= 15 && valueFontSize <= 16, 'value is ~15-16px (1.2.1 used 22px)');
  assert.ok(iconSize < 68 && iconY < 12, 'icon is smaller and higher than 1.2.1 (68px at y=12)');
  const iconBottom = iconY + iconSize;
  // Digits and "%" have a cap height below 0.75em in Segoe UI/Arial.
  const valueTop = valueBaseline - valueFontSize * 0.75;
  assert.ok(valueTop - iconBottom >= 8, `gap ${valueTop - iconBottom}px between icon box and value`);
  assert.ok(valueBaseline - iconBottom >= 20, 'baseline sits well below the icon box');
  assert.ok(iconY >= 6 && 100 - valueBaseline >= 10, 'balanced top and bottom margins');

  const svg = brightnessIconSvg('monitor', 64, { showValue: true });
  const text = svg.match(/<text x="50" y="([\d.]+)"[^>]* font-size="([\d.]+)"[^>]*>64%<\/text>/);
  assert.ok(text, 'value text rendered centred');
  assert.equal(Number(text[1]), valueBaseline);
  assert.equal(Number(text[2]), valueFontSize);
  const [, tx, ty, scale] = svg.match(/translate\(([\d.]+),([\d.]+)\) scale\(([\d.]+)\)/).map(Number);
  assert.equal(ty, iconY);
  assert.ok(Math.abs(tx * 2 + scale * 24 - 100) < 0.01, 'glyph is horizontally centred');
  assert.ok(Math.abs(scale * 24 - iconSize) < 0.01);
});

await test('icon-only keys centre the glyph inside the tile', () => {
  const { iconSize, iconY } = ICON_ONLY_LAYOUT;
  assert.equal(iconY * 2 + iconSize, 100);
  const svg = brightnessIconSvg('brightness-7', 50, { showValue: false });
  assert.doesNotMatch(svg, /<text/);
  const [, tx, ty] = svg.match(/translate\(([\d.]+),([\d.]+)\)/).map(Number);
  assert.equal(tx, iconY);
  assert.equal(ty, iconY);
});

await test('SVG stays D200H-safe', () => {
  const samples = [
    brightnessIconSvg('monitor', 40, { showValue: true, color: '#f472b6' }),
    brightnessIconSvg('lightbulb-on', null, { showValue: true }),
    brightnessIconSvg('weather-night', 70, { showValue: false, encodeIntensity: false })
  ];
  for (const svg of samples) {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100" height="100" viewBox="0 0 100 100">/);
    assert.doesNotMatch(svg, /clip-?path|stroke-dasharray|gradient|<filter|<mask|<use|<image|xlink|opacity/i);
    const tags = [...svg.matchAll(/<([a-zA-Z]+)/g)].map(m => m[1]);
    assert.ok(tags.every(tag => ['svg', 'rect', 'g', 'path', 'text'].includes(tag)), tags.join(','));
  }
});

console.log('icon resolution and actions:');

await test('curated, catalogue and malformed names resolve safely', () => {
  assert.equal(resolveIconPath('brightness-7'), BRIGHTNESS_ICONS['brightness-7']);
  assert.equal(resolveIconPath('mdi:Monitor'), BRIGHTNESS_ICONS.monitor);
  assert.match(resolveIconPath('mdi:lightbulb-on'), /^M/);
  for (const bad of ['', 'constructor', '__proto__', 'toString', 'no-such-icon-xyz', '../x', 'a b', null, 42]) {
    assert.equal(resolveIconPath(bad), null, `resolves ${String(bad)} to null`);
  }
  // Unknown names fall back to the default glyph on the Display tile.
  const svg = brightnessIconSvg('constructor', 50, { showValue: true });
  assert.ok(svg.includes(BRIGHTNESS_ICONS[DEFAULT_BRIGHTNESS_ICON]));
});

await test('Display action uses any library icon and the chosen colour', async () => {
  const icons = [];
  const ud = { setBaseDataIcon(context, data) { icons.push(data); }, showAlert() {}, logMessage() {} };
  const action = new BrightnessDisplayAction('display', ud, { async get() { return { ok: true, current: 100 }; } }, {
    setIntervalFn: () => 1, clearIntervalFn() {}
  });
  action.updateSettings({ icon: 'mdi:lightbulb-on', iconColor: '#22C55E' });
  await sleep();
  const svg = svgOf(icons.at(-1));
  assert.ok(svg.includes(resolveIconPath('lightbulb-on')));
  assert.equal(glyphFill(svg), '#22c55e');
  assert.match(svg, />100%<\/text>/);

  action.updateSettings({ icon: '__proto__', iconColor: 'not-a-colour' });
  await sleep();
  const fallback = svgOf(icons.at(-1));
  assert.equal(action.icon, DEFAULT_BRIGHTNESS_ICON);
  assert.equal(glyphFill(fallback), DEFAULT_ICON_COLOR);
  action.destroy();
});

await test('Brighter/Darker paint library icons in full colour; empty/unknown never paint', async () => {
  const icons = [];
  const ud = { setBaseDataIcon(context, data) { icons.push(data); }, showAlert() {}, logMessage() {} };
  const controller = {
    async get() { return { ok: true, current: 10 }; },
    async requestAdjust() { return { ok: true, current: 5 }; }
  };
  const quiet = new BrightnessAction('c___k___a.darker', ud, controller, -1);
  for (const icon of ['', 'mdi:no-such-icon-xyz', 'constructor', undefined]) {
    quiet.updateSettings({ icon, iconColor: '#22c55e' });
    await quiet.run();
  }
  quiet.setActive(false); quiet.setActive(true);
  await sleep();
  assert.equal(icons.length, 0, 'Keep Studio icon semantics hold for empty and unknown icons');

  const painted = new BrightnessAction('c___k___a.darker', ud, controller, -1);
  painted.updateSettings({ icon: 'mdi:weather-night', iconColor: '#22C55E' });
  await sleep();
  await painted.run();
  assert.equal(icons.length, 2);
  for (const uri of icons) {
    const svg = svgOf(uri);
    assert.ok(svg.includes(resolveIconPath('weather-night')));
    assert.equal(glyphFill(svg), '#22c55e', 'no stale intensity on non-polling control keys');
    assert.doesNotMatch(svg, /<text/);
  }
});

await test('data URI wraps the same SVG', () => {
  const uri = brightnessIconDataUri('monitor', 42, { showValue: true });
  assert.match(uri, /^data:image\/svg\+xml;base64,/);
  assert.equal(svgOf(uri), brightnessIconSvg('monitor', 42, { showValue: true }));
});

console.log('MDI catalogue:');

await test('the full @mdi/js 7.4.47 catalogue is bundled and consistent', () => {
  const data = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  assert.equal(data.source, '@mdi/js 7.4.47');
  assert.equal(data.license, 'Apache-2.0');
  const names = Object.keys(data.icons);
  assert.equal(names.length, data.count);
  assert.ok(names.length >= 7000, `${names.length} icons`);
  assert.equal(mdiCatalog.size, names.length, 'every bundled entry passes name/path validation');
  for (const name of QUICK_PICK_ICONS) {
    assert.equal(data.icons[name], BRIGHTNESS_ICONS[name], `quick pick ${name} matches the catalogue`);
  }
});

await test('the catalogue loads lazily, once, and curated icons never load it', () => {
  let reads = 0;
  const catalog = new MdiCatalog({
    readFile(url, encoding) { reads++; return fs.readFileSync(url, encoding); }
  });
  assert.equal(catalog.loaded, false);
  assert.equal(resolveIconPath('monitor', catalog), BRIGHTNESS_ICONS.monitor);
  assert.equal(reads, 0, 'curated names resolve without reading the data file');
  assert.match(resolveIconPath('lightbulb-on', catalog), /^M/);
  catalog.search('sun');
  catalog.get('weather-night');
  assert.equal(reads, 1);
  assert.equal(catalog.loadCount, 1);
});

await test('a missing or tampered data file degrades safely', () => {
  const logs = [];
  const missing = new MdiCatalog({ url: new URL('file:///nonexistent/mdi-icons.json'), log: m => logs.push(m) });
  assert.equal(missing.get('lightbulb-on'), null);
  assert.deepEqual(missing.search('sun').results, []);
  assert.equal(resolveIconPath('monitor', missing), BRIGHTNESS_ICONS.monitor);
  assert.equal(logs.length, 1);

  const tampered = new MdiCatalog({
    readFile: () => JSON.stringify({ icons: {
      good: 'M0 0H24V24Z',
      evil: 'M0 0"/><script>alert(1)</script>',
      'Bad Name': 'M0 0Z',
      numeric: 42
    } })
  });
  assert.equal(tampered.size, 1);
  assert.equal(tampered.get('good'), 'M0 0H24V24Z');
  assert.equal(tampered.get('evil'), null);
});

console.log('icon search:');

await test('exact names rank first, with or without the mdi: prefix', () => {
  for (const query of ['monitor', 'mdi:monitor', ' MDI:Monitor ']) {
    const { results, total } = mdiCatalog.search(query);
    assert.equal(results[0].name, 'monitor', query);
    assert.equal(results[0].path, BRIGHTNESS_ICONS.monitor);
    assert.ok(total > 1);
  }
});

await test('prefix matches rank before word-prefix and substring matches', () => {
  const { results } = mdiCatalog.search('lightbulb', { limit: 60 });
  assert.equal(results[0].name, 'lightbulb');
  const firstNonPrefix = results.findIndex(r => !r.name.startsWith('lightbulb'));
  assert.ok(firstNonPrefix === -1 || results.slice(firstNonPrefix).every(r => !r.name.startsWith('lightbulb')));

  const word = mdiCatalog.search('dashboard', { limit: 60 }).results.map(r => r.name);
  assert.ok(word.includes('monitor-dashboard'), 'word-prefix match inside a name');
  const prefixCount = word.filter(n => n.startsWith('dashboard')).length;
  assert.ok(word.slice(0, prefixCount).every(n => n.startsWith('dashboard')));
});

await test('substring and multi-word queries match', () => {
  const substring = mdiCatalog.search('ulb').results.map(r => r.name);
  assert.ok(substring.some(name => name.startsWith('lightbulb')), 'plain substring');
  const words = mdiCatalog.search('weather sunny').results.map(r => r.name);
  assert.equal(words[0], 'weather-sunny');
  const anyOrder = mdiCatalog.search('sunny weather').results.map(r => r.name);
  assert.ok(anyOrder.includes('weather-sunny'), 'all words in any order');
});

await test('results are limited (default 40, max 60) and totals reported', () => {
  const all = mdiCatalog.search('a');
  assert.equal(DEFAULT_SEARCH_LIMIT, 40);
  assert.equal(all.results.length, 40);
  assert.ok(all.total > 1000);
  assert.equal(mdiCatalog.search('a', { limit: 5 }).results.length, 5);
  assert.equal(mdiCatalog.search('a', { limit: 5000 }).results.length, MAX_SEARCH_LIMIT);
  assert.equal(mdiCatalog.search('a', { limit: 'x' }).results.length, 40);
  assert.deepEqual(mdiCatalog.search('').results, []);
  assert.deepEqual(mdiCatalog.search('zzzz-nothing-matches').results, []);
});

await test('queries and names are normalized defensively', () => {
  assert.equal(normalizeSearchQuery('  Weather_Sunny  '), 'weather-sunny');
  assert.equal(normalizeSearchQuery('<script>'), 'script');
  assert.equal(normalizeSearchQuery('x'.repeat(500)).length, 64);
  assert.equal(normalizeSearchQuery(42), '');
  assert.equal(normalizeIconName('mdi:weather-night'), 'weather-night');
  assert.equal(normalizeIconName('../../etc/passwd'), '');
  assert.equal(normalizeIconName('a'.repeat(65)), '');
});

console.log('webview isolation:');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

await test('no webview HTML/JS references or embeds the full catalogue', () => {
  // Webviews: the keypad Property Inspector + its SDK, and the entire HTML
  // encoder companion (main service, PI, and the libs pack.sh copies in).
  const webviewFiles = [
    ...walk(path.join(BACKEND, 'property-inspector')),
    ...walk(path.join(BACKEND, 'libs')),
    ...walk(ENCODER)
  ].filter(file => /\.(html?|js|mjs|json)$/.test(file));
  assert.ok(webviewFiles.some(file => file.endsWith('inspector.html')));
  for (const file of webviewFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    assert.doesNotMatch(text, /mdi-icons|mdiCatalog|plugin\/data\/|MDI_ICONS/, `${rel} references the catalogue`);
    assert.ok(Buffer.byteLength(text) < 100 * 1024, `${rel} is small enough for a webview`);
    if (/\.html?$/.test(file)) {
      for (const [, src] of text.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
        assert.doesNotMatch(src, /\.json|data\/|\.\.\/plugin\//, `${rel} loads ${src}`);
      }
    }
  }
  // Only the Node main service imports the catalogue module.
  const nodeImporters = walk(path.join(BACKEND, 'plugin'))
    .filter(file => file.endsWith('.js') && fs.readFileSync(file, 'utf8').includes("mdiCatalog.js'"))
    .map(file => path.relative(BACKEND, file).split(path.sep).join('/'))
    .sort();
  assert.deepEqual(nodeImporters, [
    'plugin/actions/BrightnessAction.js',
    'plugin/actions/BrightnessDisplayAction.js',
    'plugin/app.js',
    'plugin/icons.js',
    'plugin/inspectorMessages.js'
  ]);
  assert.ok(fs.existsSync(CATALOG_FILE));
  assert.ok(!CATALOG_FILE.includes(`${path.sep}libs${path.sep}`), 'pack.sh copies libs into the HTML companion');
});

console.log(`\n${passed} icon checks passed`);
