// Main service for the "Dell Monitor Brightness" Ulanzi plugin (Node.js entry).
//
// One long-lived process for the whole plugin. It owns a single DdcController
// (the DDC/CI bridge) and a registry of per-key BrightnessAction instances.

import { UlanziApi } from './common-node/index.js';
import { randomBytes } from 'node:crypto';
import DdcController from './ddc/DdcController.js';
import DdcBridgeServer, { DDC_BRIDGE_PORT } from './ddc/DdcBridgeServer.js';
import { publishBridgeConfig } from './ddc/BridgeAuth.js';
import BrightnessAction from './actions/BrightnessAction.js';
import BrightnessDisplayAction from './actions/BrightnessDisplayAction.js';
import { handleInspectorMessage } from './inspectorMessages.js';
import { mdiCatalog } from './mdiCatalog.js';

const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.dellbrightness';
const DISPLAY_ACTION_UUID = `${PLUGIN_UUID}.display`;

const $UD = new UlanziApi();
const ACTIONS = {};                       // context -> BrightnessAction
const bridgeToken = randomBytes(32).toString('hex');
const controller = new DdcController({
  log: (m) => $UD.logMessage(`[ddc] ${m}`, 'debug'),
});
// The full MDI catalogue is loaded lazily on the first search or non-curated icon.
mdiCatalog.log = (m) => $UD.logMessage(`[mdi] ${m}`, 'error');
const bridge = new DdcBridgeServer(controller, {
  token: bridgeToken,
  log: (m) => $UD.logMessage(`[ddc-bridge] ${m}`, 'debug'),
});

$UD.connect(PLUGIN_UUID);
$UD.onConnected(() => $UD.logMessage('Dell Monitor Brightness plugin connected', 'info'));
let bridgeConfigPublished = false;
try {
  publishBridgeConfig({
    mainServiceUrl: import.meta.url,
    port: DDC_BRIDGE_PORT,
    token: bridgeToken
  });
  bridgeConfigPublished = true;
} catch (error) {
  $UD.logMessage(`Dell encoder bridge token could not be published: ${error.message}`, 'error');
}
if (bridgeConfigPublished) {
  bridge.start()
    .then(address => $UD.logMessage(`Dell encoder bridge listening on 127.0.0.1:${address.port}`, 'info'))
    .catch(error => $UD.logMessage(`Dell encoder bridge failed: ${error.message}`, 'error'));
}

// Derive direction from the keypad action UUID embedded in the context.
function directionFor(jsn) {
  return jsn && jsn.context && jsn.context.includes('.darker') ? -1 : 1;
}

function isDisplayAction(jsn) {
  return !!(jsn?.context && jsn.context.startsWith(`${DISPLAY_ACTION_UUID}___`));
}

function ensureAction(jsn) {
  let inst = ACTIONS[jsn.context];
  if (!inst) {
    inst = isDisplayAction(jsn)
      ? new BrightnessDisplayAction(jsn.context, $UD, controller)
      : new BrightnessAction(jsn.context, $UD, controller, directionFor(jsn));
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
// The PI asks for the monitor list, the current reading and MDI icon search
// results (the full catalogue stays in this Node process; see
// inspectorMessages.js for the message contract).

$UD.onSendToPlugin(async (jsn) => {
  try {
    const reply = await handleInspectorMessage(jsn && jsn.payload, { controller });
    if (reply) $UD.sendToPropertyInspector(reply, jsn.context);
  } catch (error) {
    $UD.logMessage(`Property Inspector request failed: ${error && error.message ? error.message : error}`, 'error');
  }
});

// --- clean shutdown ----------------------------------------------------------

async function shutdown() {
  try { await bridge.close(); } catch {}
  try { controller.dispose(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('exit', () => { try { controller.dispose(); } catch {} });
