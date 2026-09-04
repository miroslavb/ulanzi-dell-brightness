// Main service for the "Dell Monitor Brightness" Ulanzi plugin (Node.js entry).
//
// One long-lived process for the whole plugin. It owns a single DdcController
// (the DDC/CI bridge) and a registry of per-key BrightnessAction instances.

import { UlanziApi } from './common-node/index.js';
import DdcController from './ddc/DdcController.js';
import DdcBridgeServer from './ddc/DdcBridgeServer.js';
import BrightnessAction from './actions/BrightnessAction.js';

const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.dellbrightness';

const $UD = new UlanziApi();
const ACTIONS = {};                       // context -> BrightnessAction
const controller = new DdcController({
  log: (m) => $UD.logMessage(`[ddc] ${m}`, 'debug'),
});
const bridge = new DdcBridgeServer(controller, {
  log: (m) => $UD.logMessage(`[ddc-bridge] ${m}`, 'debug'),
});

$UD.connect(PLUGIN_UUID);
$UD.onConnected(() => $UD.logMessage('Dell Monitor Brightness plugin connected', 'info'));
bridge.start()
  .then(address => $UD.logMessage(`Dell encoder bridge listening on 127.0.0.1:${address.port}`, 'info'))
  .catch(error => $UD.logMessage(`Dell encoder bridge failed: ${error.message}`, 'error'));

// Derive direction from the keypad action UUID embedded in the context.
function directionFor(jsn) {
  return jsn && jsn.context && jsn.context.includes('.darker') ? -1 : 1;
}

function ensureAction(jsn) {
  let inst = ACTIONS[jsn.context];
  if (!inst) {
    inst = new BrightnessAction(jsn.context, $UD, controller, directionFor(jsn));
    ACTIONS[jsn.context] = inst;
  }
  return inst;
}

function applySettings(jsn) {
  const inst = ACTIONS[jsn.context];
  if (inst && jsn.param && typeof jsn.param === 'object') inst.updateSettings(jsn.param);
}

// --- lifecycle events --------------------------------------------------------

$UD.onAdd((jsn) => {
  ensureAction(jsn);
  applySettings(jsn);
});

$UD.onRun((jsn) => {
  ensureAction(jsn).run();
});

$UD.onSetActive((jsn) => {
  const inst = ACTIONS[jsn.context];
  if (inst) inst.setActive(jsn.active);
});

// Settings changed (from the Property Inspector or restored by the app).
$UD.onParamFromPlugin((jsn) => applySettings(jsn));
$UD.onParamFromApp((jsn) => applySettings(jsn));

$UD.onClear((jsn) => {
  if (!jsn.param) return;
  for (const item of jsn.param) {
    const ctx = item.context;
    if (ACTIONS[ctx]) { ACTIONS[ctx].destroy(); delete ACTIONS[ctx]; }
  }
});

// --- Property Inspector <-> main service messaging ---------------------------
// The PI asks for the monitor list to populate its dropdown.

$UD.onSendToPlugin(async (jsn) => {
  const payload = jsn && jsn.payload ? jsn.payload : {};
  const ctx = jsn.context;

  if (payload.op === 'listMonitors') {
    const res = await controller.list();
    $UD.sendToPropertyInspector({ type: 'monitors', monitors: normalizeMonitors(res), ok: !!res.ok }, ctx);
  } else if (payload.op === 'getBrightness') {
    const res = await controller.get(payload.monitor);
    $UD.sendToPropertyInspector({ type: 'brightness', result: res }, ctx);
  }
});

// PowerShell's ConvertTo-Json collapses a single-element array into one object;
// make the monitor list a real array on the JS side.
function normalizeMonitors(res) {
  if (!res || !res.monitors) return [];
  return Array.isArray(res.monitors) ? res.monitors : [res.monitors];
}

// --- clean shutdown ----------------------------------------------------------

async function shutdown() {
  try { await bridge.close(); } catch {}
  try { controller.dispose(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('exit', () => { try { controller.dispose(); } catch {} });
