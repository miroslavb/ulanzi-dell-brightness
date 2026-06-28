// Mock of brightness.ps1 — speaks the exact same JSON-line / CLI protocol so the
// Node DdcController can be tested on any platform (no dxva2 / no real monitor).
import readline from 'readline';

const argv = process.argv.slice(2);
function flag(name) { return argv.includes(name); }
function opt(name, def) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; }

// In-memory monitor model. Index 0 = capable Dell, index 1 = non-DDC/CI panel.
const monitors = [
  { name: 'DELL U2720Q', capable: true, cur: 50, min: 0, max: 100 },
  { name: 'Generic PnP Monitor', capable: false, cur: -1, min: -1, max: -1 },
];
let adjustCalls = 0; // lets the test prove coalescing reduced worker round-trips

function resolveIndex(index) {
  if (index >= 0) return index < monitors.length ? index : -1;
  for (let i = 0; i < monitors.length; i++) if (monitors[i].capable) return i;
  return -1;
}
function ok(idx) {
  const m = monitors[idx];
  return { ok: true, index: idx, name: m.name, current: m.cur, min: m.min, max: m.max };
}
function fail(idx, error) { return { ok: false, error, index: idx, current: -1, min: -1, max: -1 }; }

function doOp(op, index, value, delta) {
  if (op === 'list') {
    return {
      ok: true,
      monitors: monitors.map((m, i) => ({
        index: i, name: m.name, capable: m.capable,
        current: m.capable ? m.cur : -1, min: m.capable ? m.min : -1, max: m.capable ? m.max : -1,
      })),
    };
  }
  const idx = resolveIndex(index);
  if (idx < 0) return fail(index, 'No matching DDC/CI-capable monitor');
  const m = monitors[idx];
  if (!m.capable) return fail(idx, 'GetMonitorBrightness failed (monitor may not support DDC/CI)');
  if (op === 'get') return ok(idx);
  if (op === 'set') { let v = value; if (v < m.min) v = m.min; if (v > m.max) v = m.max; m.cur = v; return ok(idx); }
  if (op === 'adjust') { adjustCalls++; let v = m.cur + delta; if (v < m.min) v = m.min; if (v > m.max) v = m.max; m.cur = v; const r = ok(idx); r.calls = adjustCalls; return r; }
  return { ok: false, error: `unknown op: ${op}` };
}

if (flag('-Serve')) {
  process.stdout.write('{"ready":true}\n');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    let res, id;
    try {
      const req = JSON.parse(line);
      id = req.id;
      res = doOp(String(req.op), req.index ?? -1, req.value ?? 0, req.delta ?? 0);
    } catch (e) { res = { ok: false, error: e.message }; }
    if (id !== undefined) res.id = id;
    process.stdout.write(JSON.stringify(res) + '\n');
  });
} else {
  const op = opt('-Op', 'list');
  const res = doOp(op, parseInt(opt('-Index', '-1'), 10), parseInt(opt('-Value', '0'), 10), parseInt(opt('-Delta', '0'), 10));
  process.stdout.write(JSON.stringify(res) + '\n');
}
