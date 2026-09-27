// Property Inspector logic for the Dell Monitor Brightness actions.
//
// Icon picker: the curated quick picks are shown by default. The search box
// queries the full Material Design Icons catalogue that lives in the Node main
// service (sendToPlugin -> sendToPropertyInspector); this webview only ever
// receives a few dozen icon paths per reply and never loads the catalogue.

const DEFAULT_ICON_COLOR = '#facc15';
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const ICON_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9 ,.+\-eE]+$/;
const DISPLAY_DEFAULT_ICON = 'brightness-7';
const SEARCH_LIMIT = 40;
const SEARCH_DEBOUNCE_MS = 200;
const SVG_NS = 'http://www.w3.org/2000/svg';

let ACTION_SETTING = {};
let form = null;
let pendingMonitor = 'auto'; // selection to re-apply once the dropdown is filled
let isDisplayAction = false;
let searchSeq = 0;
let iconSeq = 0;
let pickSeq = -1;            // getIcon reply that should become the selection
let searchTimer = null;
const KNOWN_PATHS = new Map(); // icon name -> path, filled from backend replies
const REQUESTED_ICONS = new Set(); // preview lookups already sent (never repeated)
const UNKNOWN_ICONS = new Set();   // names the backend could not resolve

$UD.connect();

$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');
  document.querySelector('.uspi-wrapper').classList.remove('hidden');
  isDisplayAction = /\.display$/.test(String($UD.uuid || ''));
  if (isDisplayAction) {
    // The display tile always paints; an empty icon means brightness-7.
    const clear = document.querySelector('#iconClear');
    clear.dataset.localize = 'Default icon';
    clear.textContent = 'Default icon';
  }

  const saveDebounced = Utils.debounce(() => {
    saveSettings();
    requestBrightness();
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('input', (event) => {
    const target = event && event.target;
    if (target && target.id === 'iconSearch') return; // search text is not a setting
    if (target && target.id === 'iconColor') applyIconColor();
    saveDebounced();
  });

  document.querySelector('#refresh').addEventListener('click', requestMonitors);
  document.querySelector('#monitor').addEventListener('change', requestBrightness);
  const search = document.querySelector('#iconSearch');
  search.addEventListener('input', scheduleIconSearch);
  search.addEventListener('keydown', onSearchKeydown);
  document.querySelector('#iconClear').addEventListener('click', () => selectIcon(''));
  document.querySelector('#iconGrid').addEventListener('click', onIconGridClick);

  applyIconColor();
  applyIconState();
  requestMonitors();
  requestIcons('');
});

// Initial / restored settings.
$UD.onAdd((jsn) => { if (jsn && jsn.param) loadSettings(jsn.param); });
$UD.onParamFromApp((jsn) => { if (jsn && jsn.param) loadSettings(jsn.param); });

// Replies from the main service.
$UD.onSendToPropertyInspector((jsn) => {
  const payload = (jsn && jsn.payload) ? jsn.payload : {};
  if (payload.type === 'monitors') {
    buildMonitorOptions(payload.monitors || []);
  } else if (payload.type === 'brightness') {
    showReading(payload.result);
  } else if (payload.type === 'icons') {
    if (payload.seq !== searchSeq) return; // an older search finished late
    renderIconResults(payload);
  } else if (payload.type === 'icon') {
    handleIconReply(payload);
  }
});

// Localized text with an English fallback and {placeholder} substitution.
function t(key, fallback, vars) {
  const localized = $UD.t ? $UD.t(key) : key;
  let text = localized && localized !== key ? localized : (fallback || key);
  for (const [name, value] of Object.entries(vars || {})) text = text.split(`{${name}}`).join(String(value));
  return text;
}

function normalizeColor(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return COLOR_PATTERN.test(text) ? text.toLowerCase() : DEFAULT_ICON_COLOR;
}

function normalizeIconName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim().toLowerCase().replace(/^mdi:/, '');
  return name.length <= 64 && ICON_NAME_PATTERN.test(name) ? name : '';
}

function loadSettings(params) {
  ACTION_SETTING = Object.assign({}, params || {});
  ACTION_SETTING.icon = normalizeIconName(ACTION_SETTING.icon);
  ACTION_SETTING.iconColor = normalizeColor(ACTION_SETTING.iconColor);
  pendingMonitor = ACTION_SETTING.monitor || 'auto';
  if (form) Utils.setFormValue(ACTION_SETTING, form);
  document.querySelector('#icon').value = ACTION_SETTING.icon;
  document.querySelector('#iconColor').value = ACTION_SETTING.iconColor;
  applyMonitorSelection();
  applyIconColor();
  applyIconState();
  requestBrightness();
}

function currentSettings() {
  const values = form ? Utils.getFormValue(form) : {};
  values.icon = normalizeIconName(values.icon);
  values.iconColor = normalizeColor(values.iconColor);
  return values;
}

function saveSettings() {
  ACTION_SETTING = currentSettings();
  $UD.sendParamFromPlugin(ACTION_SETTING);
}

function requestMonitors() {
  $UD.sendToPlugin({ op: 'listMonitors' });
}

function requestBrightness() {
  const sel = document.querySelector('#monitor');
  $UD.sendToPlugin({ op: 'getBrightness', monitor: sel ? sel.value : 'auto' });
}

// --- icon picker --------------------------------------------------------------

function scheduleIconSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    requestIcons(document.querySelector('#iconSearch').value);
  }, SEARCH_DEBOUNCE_MS);
}

function requestIcons(query) {
  const text = String(query || '').slice(0, 64);
  searchSeq += 1;
  setIconStatus(text.trim() ? t('IconSearching', 'Searching…') : '');
  $UD.sendToPlugin({ op: 'searchIcons', query: text, seq: searchSeq, limit: SEARCH_LIMIT });
}

function requestIcon(name, pick) {
  iconSeq += 1;
  if (pick) pickSeq = iconSeq;
  $UD.sendToPlugin({ op: 'getIcon', name, seq: iconSeq });
}

// Enter uses the typed name exactly ("mdi:monitor" or "monitor").
function onSearchKeydown(event) {
  if (!event || event.key !== 'Enter') return;
  event.preventDefault();
  clearTimeout(searchTimer);
  const typed = document.querySelector('#iconSearch').value.trim();
  if (!typed) return;
  const name = normalizeIconName(typed);
  if (!name) {
    setIconStatus(t('IconNotFound', 'No icon named {name}', { name: typed }));
    return;
  }
  requestIcon(name, true);
}

function handleIconReply(payload) {
  const name = normalizeIconName(payload.name);
  const path = typeof payload.path === 'string' && SAFE_PATH_PATTERN.test(payload.path) ? payload.path : null;
  if (name && path) {
    KNOWN_PATHS.set(name, path);
    UNKNOWN_ICONS.delete(name);
  } else if (name) {
    UNKNOWN_ICONS.add(name);
  }
  if (payload.seq === pickSeq) {
    pickSeq = -1;
    if (name && path) selectIcon(name);
    else setIconStatus(t('IconNotFound', 'No icon named {name}', { name: `mdi:${name || ''}` }));
    return;
  }
  applyIconState();
}

function onIconGridClick(event) {
  const cell = event && event.target && event.target.closest ? event.target.closest('.icon-cell') : null;
  if (cell && cell.dataset.name) selectIcon(cell.dataset.name);
}

function selectIcon(name) {
  document.querySelector('#icon').value = normalizeIconName(name);
  saveSettings();
  applyIconState();
}

function glyph(path) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('class', 'glyph');
  svg.appendChild(shape);
  return svg;
}

function renderIconResults(payload) {
  const grid = document.querySelector('#iconGrid');
  const results = Array.isArray(payload.results) ? payload.results : [];
  grid.textContent = '';
  let shown = 0;
  for (const item of results) {
    const name = normalizeIconName(item && item.name);
    const path = item && typeof item.path === 'string' && SAFE_PATH_PATTERN.test(item.path) ? item.path : '';
    if (!name || !path) continue;
    KNOWN_PATHS.set(name, path);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'icon-cell';
    cell.dataset.name = name;
    cell.title = `mdi:${name}`;
    cell.setAttribute('role', 'option');
    cell.appendChild(glyph(path));
    const label = document.createElement('span');
    label.textContent = name;
    cell.appendChild(label);
    grid.appendChild(cell);
    shown++;
  }
  const total = Number.isFinite(payload.total) ? payload.total : shown;
  if (payload.quickPicks) setIconStatus(t('IconQuickPicks', 'Quick picks. Search for more icons.'));
  else if (!shown) setIconStatus(t('IconNoMatches', 'No icons match "{query}"', { query: payload.query || '' }));
  else if (total > shown) setIconStatus(t('IconSomeMatches', '{shown} of {total} matches. Refine the search.', { shown, total }));
  else setIconStatus(t('IconAllMatches', '{shown} matches', { shown }));
  applyIconState();
}

function setIconStatus(text) {
  const el = document.querySelector('#iconStatus');
  if (el) el.textContent = text;
}

function applyIconColor() {
  const color = normalizeColor(document.querySelector('#iconColor').value);
  document.querySelector('#iconGrid').style.setProperty('--icon-color', color);
  document.querySelector('#iconSwatch').style.setProperty('--icon-color', color);
}

// Shows the selected icon (or the no-paint / default state) and highlights it.
function applyIconState() {
  const name = normalizeIconName(document.querySelector('#icon').value);
  const shownName = name || (isDisplayAction ? DISPLAY_DEFAULT_ICON : '');
  const label = document.querySelector('#iconName');
  label.textContent = name
    ? (UNKNOWN_ICONS.has(name) ? t('IconUnknown', 'mdi:{name} (not found)', { name }) : `mdi:${name}`)
    : (isDisplayAction
      ? t('IconDefault', 'Default (mdi:{name})', { name: DISPLAY_DEFAULT_ICON })
      : t('Keep Studio icon', 'Keep Studio icon'));

  const swatch = document.querySelector('#iconSwatch');
  swatch.textContent = '';
  const path = shownName ? KNOWN_PATHS.get(shownName) : null;
  if (path) {
    swatch.classList.remove('empty');
    swatch.appendChild(glyph(path));
  } else {
    swatch.classList.add('empty');
    if (shownName && !REQUESTED_ICONS.has(shownName)) {
      REQUESTED_ICONS.add(shownName);
      requestIcon(shownName, false);
    }
  }

  const grid = document.querySelector('#iconGrid');
  for (const cell of Array.from(grid.children)) {
    cell.classList.toggle('selected', !!name && cell.dataset.name === name);
  }
}

// --- monitors -----------------------------------------------------------------

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
    el.textContent = `${t('Current', 'Current')}: ${result.current}% (${result.min}–${result.max})`;
  } else if (result && result.error) {
    el.textContent = result.error;
  } else {
    el.textContent = '';
  }
}
