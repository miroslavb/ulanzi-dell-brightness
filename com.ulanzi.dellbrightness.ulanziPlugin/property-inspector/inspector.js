// Property Inspector logic for the Dell Monitor Brightness actions.

let ACTION_SETTING = {};
let form = null;
let pendingMonitor = 'auto'; // selection to re-apply once the dropdown is filled

$UD.connect();

$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');
  document.querySelector('.uspi-wrapper').classList.remove('hidden');

  // Persist settings to the main service on any change.
  form.addEventListener('input', Utils.debounce(() => {
    ACTION_SETTING = Utils.getFormValue(form);
    $UD.sendParamFromPlugin(ACTION_SETTING);
    requestBrightness();
  }));

  document.querySelector('#refresh').addEventListener('click', requestMonitors);
  document.querySelector('#monitor').addEventListener('change', requestBrightness);

  requestMonitors();
});

// Initial / restored settings.
$UD.onAdd((jsn) => { if (jsn && jsn.param) loadSettings(jsn.param); });
$UD.onParamFromApp((jsn) => { if (jsn && jsn.param) loadSettings(jsn.param); });

// Replies from the main service (monitor list / current brightness).
$UD.onSendToPropertyInspector((jsn) => {
  const payload = (jsn && jsn.payload) ? jsn.payload : {};
  if (payload.type === 'monitors') {
    buildMonitorOptions(payload.monitors || []);
  } else if (payload.type === 'brightness') {
    showReading(payload.result);
  }
});

function loadSettings(params) {
  ACTION_SETTING = params || {};
  pendingMonitor = ACTION_SETTING.monitor || 'auto';
  if (form) Utils.setFormValue(ACTION_SETTING, form);
  applyMonitorSelection();
  requestBrightness();
}

function requestMonitors() {
  $UD.sendToPlugin({ op: 'listMonitors' });
}

function requestBrightness() {
  const sel = document.querySelector('#monitor');
  $UD.sendToPlugin({ op: 'getBrightness', monitor: sel ? sel.value : 'auto' });
}

function buildMonitorOptions(monitors) {
  const sel = document.querySelector('#monitor');
  if (!sel) return;
  const previous = ACTION_SETTING.monitor || pendingMonitor || sel.value || 'auto';

  // Keep the first "Auto" option, drop the rest, then rebuild.
  while (sel.options.length > 1) sel.remove(1);

  monitors.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = String(m.index);
    const name = (m.name && m.name.trim()) || `Monitor ${m.index}`;
    opt.textContent = m.capable
      ? `#${m.index} · ${name} (${m.current}%)`
      : `#${m.index} · ${name} — no DDC/CI`;
    sel.appendChild(opt);
  });

  pendingMonitor = previous;
  applyMonitorSelection();
}

function applyMonitorSelection() {
  const sel = document.querySelector('#monitor');
  if (!sel) return;
  const want = String(pendingMonitor || 'auto');
  const exists = Array.from(sel.options).some((o) => o.value === want);
  sel.value = exists ? want : 'auto';
}

function showReading(result) {
  const el = document.querySelector('#reading');
  if (!el) return;
  if (result && result.ok) {
    const label = $UD.t ? $UD.t('Current') : 'Current';
    el.textContent = `${label}: ${result.current}% (${result.min}–${result.max})`;
  } else if (result && result.error) {
    el.textContent = result.error;
  } else {
    el.textContent = '';
  }
}
