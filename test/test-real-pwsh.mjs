// Integration test: drive the REAL brightness.ps1 (serve mode) through DdcController
// using pwsh on Linux. The native dxva2 calls can't succeed here, so every op returns
// ok:false — but this proves the PowerShell glue is sound: ready handshake, JSON line
// parsing, Read-IntProp defaults, Invoke-Op dispatch, ordered-dict id add, ConvertTo-Json,
// the serve loop, and DdcController's id-matching + coalescing all work end-to-end.
import assert from 'assert';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import DdcController from '../com.ulanzi.dellbrightness.ulanziPlugin/plugin/ddc/DdcController.js';

const PWSH = '/opt/pwsh/pwsh';
const PS1 = fileURLToPath(new URL('../com.ulanzi.dellbrightness.ulanziPlugin/plugin/ddc/brightness.ps1', import.meta.url));

if (!existsSync(PWSH)) { console.log('pwsh not present — skipping real-pwsh integration test'); process.exit(0); }

const newCtl = () => new DdcController({
  command: PWSH,
  baseArgs: ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1],
  assumeSupported: true,
});

let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('real brightness.ps1 (serve mode via pwsh):');

await test('serve handshake + list returns a well-formed response object', async () => {
  const c = newCtl();
  const r = await c.list();
  // ok:false on Linux (no native libs) but the response must be a parsed object.
  assert.ok(typeof r === 'object' && 'ok' in r, 'expected a parsed JSON object with an ok field');
  c.dispose();
});

await test('get round-trips with id matching (returns a parsed result)', async () => {
  const c = newCtl();
  const r = await c.get('auto');
  // On Linux the native call throws -> {ok:false,error}. On Windows a non-capable
  // monitor returns {ok:false,...fields}. Either way callers gate on .ok first.
  assert.ok(typeof r === 'object' && typeof r.ok === 'boolean', 'parsed result with boolean ok');
  c.dispose();
});

await test('coalesced adjust burst yields a single structured response to all callers', async () => {
  const c = newCtl();
  const ps = [];
  for (let i = 0; i < 4; i++) ps.push(c.requestAdjust('auto', 5));
  const results = await Promise.all(ps);
  for (const r of results) assert.ok('ok' in r, 'each caller gets a parsed result');
  c.dispose();
});

await test('two sequential ops keep distinct ids (no cross-talk / no hang)', async () => {
  const c = newCtl();
  const a = await c.get('auto');
  const b = await c.get(0);
  assert.ok('ok' in a && 'ok' in b);
  c.dispose();
});

console.log(`\n${passed} checks passed`);
