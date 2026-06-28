// DdcController — talks to brightness.ps1 to read/adjust monitor brightness over DDC/CI.
//
// Responsibilities:
//   * keep a single long-lived PowerShell "serve" process (P/Invoke compiled once),
//   * serialize commands (DDC/CI does not like concurrent VCP writes),
//   * coalesce rapid button presses into one adjust call (snappy + kind to the monitor),
//   * recover from a crashed worker, and fall back to one-shot invocations if serve mode
//     can't start.
//
// All public methods resolve to a plain object: for list() -> { ok, monitors:[...] },
// for get/set/adjust -> { ok, current, min, max, index, name, error }.

import { spawn } from 'child_process';
import readline from 'readline';
import { fileURLToPath } from 'url';
import path from 'path';

const PS1 = fileURLToPath(new URL('./brightness.ps1', import.meta.url));
const PWSH = 'powershell.exe';
const PWSH_ARGS = ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1];

const REQUEST_TIMEOUT_MS = 8000;
const COALESCE_MS = 80;

export default class DdcController {
  constructor({ log, command, baseArgs, assumeSupported } = {}) {
    this.log = log || (() => {});
    this.isWindows = process.platform === 'win32';
    this.supported = assumeSupported || this.isWindows;

    // Launcher is injectable so the protocol can be exercised without a real device.
    this.command = command || PWSH;
    this.baseArgs = baseArgs || PWSH_ARGS;

    this.proc = null;
    this.ready = false;
    this.readyPromise = null;
    this.serveBroken = false;       // once true, route everything through one-shot calls

    this.nextId = 1;
    this.pending = new Map();        // id -> { resolve, reject, timer }
    this.queueTail = Promise.resolve(); // serialization chain

    this.coalesce = new Map();       // monitorIndex -> { delta, waiters:[], timer }
  }

  // ---- public API ----------------------------------------------------------

  list() {
    return this._enqueue({ op: 'list' });
  }

  get(monitor) {
    return this._enqueue({ op: 'get', index: this._idx(monitor) });
  }

  set(monitor, value) {
    return this._enqueue({ op: 'set', index: this._idx(monitor), value });
  }

  /**
   * Coalesced relative change. Many quick presses within COALESCE_MS collapse into a
   * single adjust(sumOfDeltas). Every caller resolves with the final applied result.
   */
  requestAdjust(monitor, delta) {
    const index = this._idx(monitor);
    return new Promise((resolve) => {
      let slot = this.coalesce.get(index);
      if (!slot) {
        slot = { delta: 0, waiters: [], timer: null };
        this.coalesce.set(index, slot);
      }
      slot.delta += delta;
      slot.waiters.push(resolve);
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = setTimeout(() => {
        this.coalesce.delete(index);
        const total = slot.delta;
        const waiters = slot.waiters;
        this._enqueue({ op: 'adjust', index, delta: total })
          .then((res) => waiters.forEach((w) => w(res)))
          .catch((err) => waiters.forEach((w) => w({ ok: false, error: String(err && err.message || err) })));
      }, COALESCE_MS);
    });
  }

  dispose() {
    this._killWorker();
  }

  // ---- internals -----------------------------------------------------------

  _idx(monitor) {
    if (monitor === undefined || monitor === null || monitor === 'auto' || monitor === '') return -1;
    const n = parseInt(monitor, 10);
    return Number.isFinite(n) ? n : -1;
  }

  // Run requests one at a time.
  _enqueue(req) {
    const run = () => this._dispatch(req);
    const result = this.queueTail.then(run, run);
    // keep the chain alive regardless of individual failures
    this.queueTail = result.then(() => {}, () => {});
    return result;
  }

  async _dispatch(req) {
    if (!this.supported) {
      return { ok: false, error: 'Monitor brightness control is only supported on Windows in this build.' };
    }
    if (this.serveBroken) return this._oneShot(req);
    try {
      await this._ensureWorker();
      return await this._sendToWorker(req);
    } catch (err) {
      this.log(`serve-mode failed (${err && err.message || err}); falling back to one-shot`);
      this._killWorker();
      this.serveBroken = true;
      return this._oneShot(req);
    }
  }

  _ensureWorker() {
    if (this.proc && this.ready) return Promise.resolve();
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      let settled = false;
      // Clear the gate at settle time so a later crash can re-arm it. Resetting
      // inside the executor (rather than via .finally) avoids an unobserved branch.
      const succeed = () => { if (settled) return; settled = true; clearTimeout(startTimer); this.readyPromise = null; resolve(); };
      const failWith = (e) => { if (settled) return; settled = true; clearTimeout(startTimer); this.readyPromise = null; reject(e); };

      const startTimer = setTimeout(() => failWith(new Error('worker did not become ready in time')), REQUEST_TIMEOUT_MS);

      let child;
      try {
        child = spawn(this.command, [...this.baseArgs, '-Serve'], { windowsHide: true });
      } catch (e) {
        return failWith(e);
      }
      this.proc = child;

      child.on('error', (e) => {
        this.log(`worker spawn error: ${e.message}`);
        failWith(e);
        this._onWorkerGone(child);
      });

      child.on('exit', (code) => {
        this.log(`worker exited (code ${code})`);
        this._onWorkerGone(child);
      });

      child.stderr.on('data', (d) => this.log(`[ps stderr] ${String(d).trim()}`));

      const rl = readline.createInterface({ input: child.stdout });
      this.rl = rl;
      rl.on('line', (line) => {
        if (this.proc !== child) return; // stale line from a replaced worker
        line = line.trim();
        if (!line) return;
        let msg;
        try { msg = JSON.parse(line); } catch { this.log(`unparseable line: ${line}`); return; }

        if (msg.ready) { this.ready = true; succeed(); return; }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve: res, timer } = this.pending.get(msg.id);
          clearTimeout(timer);
          this.pending.delete(msg.id);
          res(msg);
        }
      });
    });

    return this.readyPromise;
  }

  _sendToWorker(req) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request ${id} (${req.op}) timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });

      const payload = JSON.stringify({ id, ...req }) + '\n';
      try {
        this.proc.stdin.write(payload);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  // `child` guards against a stale event from a process we've already replaced.
  _onWorkerGone(child) {
    if (child && this.proc && this.proc !== child) return;
    this.ready = false;
    if (this.rl) { try { this.rl.close(); } catch {} this.rl = null; }
    this.proc = null;
    // fail any in-flight requests so callers don't hang
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('worker terminated'));
      this.pending.delete(id);
    }
  }

  _killWorker() {
    const child = this.proc;
    if (child) {
      try { child.stdin.end(); } catch {}
      try { child.kill(); } catch {}
    }
    this._onWorkerGone(child);
  }

  // Fallback: spawn a fresh powershell per request and read the single JSON line.
  _oneShot(req) {
    return new Promise((resolve) => {
      const args = [...this.baseArgs];
      if (req.op === 'list') args.push('-Op', 'list');
      else if (req.op === 'get') args.push('-Op', 'get', '-Index', String(req.index));
      else if (req.op === 'set') args.push('-Op', 'set', '-Index', String(req.index), '-Value', String(req.value));
      else if (req.op === 'adjust') args.push('-Op', 'adjust', '-Index', String(req.index), '-Delta', String(req.delta));

      let out = '';
      let proc;
      try {
        proc = spawn(this.command, args, { windowsHide: true });
      } catch (e) {
        return resolve({ ok: false, error: e.message });
      }
      const killer = setTimeout(() => { try { proc.kill(); } catch {} }, REQUEST_TIMEOUT_MS);
      proc.stdout.on('data', (d) => (out += d));
      proc.stderr.on('data', (d) => this.log(`[ps stderr] ${String(d).trim()}`));
      proc.on('error', (e) => { clearTimeout(killer); resolve({ ok: false, error: e.message }); });
      proc.on('close', () => {
        clearTimeout(killer);
        const line = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop();
        if (!line) return resolve({ ok: false, error: 'no output from brightness.ps1' });
        try { resolve(JSON.parse(line)); }
        catch { resolve({ ok: false, error: `bad output: ${line}` }); }
      });
    });
  }
}
