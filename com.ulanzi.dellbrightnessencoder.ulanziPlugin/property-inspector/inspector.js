(function () {
  'use strict';

  const $UD = new UlanziApi();
  const form = document.getElementById('settings');
  const monitorSelect = form.elements.monitor;
  const status = document.getElementById('status');
  let saveTimer = null;

  function settingsFromUi() {
    return {
      step: form.elements.step.value,
      monitor: monitorSelect.value || 'auto',
      icon: form.elements.icon.value || 'brightness-7',
      showFeedback: !!form.elements.showFeedback.checked
    };
  }

  function save() {
    const settings = settingsFromUi();
    $UD.setSettings(settings);
    $UD.sendToPlugin({ op: 'configure', settings });
  }

  function saveDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 150);
  }

  function applySettings(settings) {
    const value = settings && typeof settings === 'object' ? settings : {};
    form.elements.step.value = ['1', '3', '5', '10'].includes(String(value.step))
      ? String(value.step) : '5';
    const hasIcon = Array.from(form.elements.icon.options).some(option => option.value === value.icon);
    form.elements.icon.value = value.icon && hasIcon
      ? value.icon : 'brightness-7';
    form.elements.showFeedback.checked = !(
      value.showFeedback === false || value.showFeedback === 'false' || value.showFeedback === 'off'
    );
    const requestedMonitor = value.monitor === undefined || value.monitor === null || value.monitor === ''
      ? 'auto' : String(value.monitor);
    const hasMonitor = Array.from(monitorSelect.options).some(option => option.value === requestedMonitor);
    if (!hasMonitor) {
      const option = document.createElement('option');
      option.value = requestedMonitor;
      option.textContent = `Monitor ${requestedMonitor}`;
      monitorSelect.appendChild(option);
    }
    monitorSelect.value = requestedMonitor;
  }

  function monitorValue(monitor, fallback) {
    const raw = monitor.index ?? monitor.Index ?? fallback;
    return String(raw);
  }

  function monitorName(monitor, fallback) {
    return monitor.name || monitor.Name || monitor.description || monitor.Description || `Monitor ${fallback + 1}`;
  }

  function monitorCapable(monitor) {
    const value = monitor.capable ?? monitor.Capable ?? monitor.ddcCapable ?? monitor.DdcCapable;
    return value === undefined ? true : value === true || String(value).toLowerCase() === 'true';
  }

  function renderMonitors(monitors) {
    const selected = monitorSelect.value || 'auto';
    monitorSelect.innerHTML = '<option value="auto">Auto (first responsive monitor)</option>';
    monitors.forEach((monitor, index) => {
      const option = document.createElement('option');
      option.value = monitorValue(monitor, index);
      const capable = monitorCapable(monitor);
      option.textContent = `${monitorName(monitor, index)}${capable ? '' : ' (no DDC/CI)'}`;
      option.disabled = !capable;
      monitorSelect.appendChild(option);
    });
    if (!Array.from(monitorSelect.options).some(option => option.value === selected) && selected !== 'auto') {
      const missing = document.createElement('option');
      missing.value = selected;
      missing.textContent = `Monitor ${selected} (not detected)`;
      missing.disabled = true;
      monitorSelect.appendChild(missing);
    }
    monitorSelect.value = selected;
  }

  function requestMonitors() {
    status.className = 'status';
    status.textContent = 'Detecting monitors…';
    $UD.sendToPlugin({ op: 'listMonitors' });
  }

  function requestBrightness() {
    $UD.sendToPlugin({ op: 'getBrightness', monitor: monitorSelect.value || 'auto' });
  }

  $UD.connect();
  $UD.onConnected(() => {
    form.addEventListener('input', saveDebounced);
    form.addEventListener('change', saveDebounced);
    monitorSelect.addEventListener('change', requestBrightness);
    document.getElementById('refresh').addEventListener('click', requestMonitors);
    $UD.getSettings();
    requestMonitors();
  });

  $UD.onAdd(message => applySettings(message.param || {}));
  $UD.onDidReceiveSettings(message => applySettings(message.param || message.payload || {}));
  $UD.onSendToPropertyInspector(message => {
    const data = message.payload || message.param || message;
    if (data.type === 'monitors') {
      renderMonitors(Array.isArray(data.monitors) ? data.monitors : []);
      requestBrightness();
      status.className = data.ok ? 'status' : 'status error';
      status.textContent = data.ok
        ? `${data.monitors.length} monitor(s) detected`
        : 'DDC backend unavailable. Install both plugins and restart Studio.';
    } else if (data.type === 'brightness') {
      const result = data.result || {};
      status.className = result.ok ? 'status' : 'status error';
      status.textContent = result.ok ? `Current brightness: ${result.current}%` : (result.error || 'Brightness read failed');
    }
  });
})();
