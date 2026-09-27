// Property Inspector -> main service request handling (sendToPlugin payloads).
//
// Every reply is sent back with sendToPropertyInspector. Icon requests are
// answered from the Node-only MDI catalogue so the Property Inspector never
// loads the multi-megabyte data file itself.
//
//   { op: 'listMonitors' }                  -> { type: 'monitors', ok, monitors }
//   { op: 'getBrightness', monitor }        -> { type: 'brightness', result }
//   { op: 'searchIcons', query, seq, limit } -> { type: 'icons', seq, query,
//                                               quickPicks, total, results: [{ name, path }] }
//       an empty query returns the curated quick picks; otherwise up to
//       `limit` (default 40, max 60) catalogue matches ranked exact > prefix >
//       word prefix > substring > all words (shorter names first).
//   { op: 'getIcon', name, seq }            -> { type: 'icon', seq, name, path|null }
//
// Unknown ops return null (no reply).

import { BRIGHTNESS_ICONS, QUICK_PICK_ICONS, resolveIconPath } from './icons.js';
import { mdiCatalog, normalizeIconName } from './mdiCatalog.js';

// PowerShell's ConvertTo-Json collapses a single-element array into one object;
// make the monitor list a real array on the JS side.
export function normalizeMonitors(res) {
  if (!res || !res.monitors) return [];
  return Array.isArray(res.monitors) ? res.monitors : [res.monitors];
}

function sequence(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function errorText(error) {
  return String(error && error.message ? error.message : error);
}

export function searchIconsReply(payload, catalog = mdiCatalog) {
  const seq = sequence(payload.seq);
  const rawQuery = typeof payload.query === 'string' ? payload.query : '';
  const search = catalog.search(rawQuery, { limit: payload.limit });
  if (!search.query) {
    return {
      type: 'icons', seq, query: '', quickPicks: true,
      total: QUICK_PICK_ICONS.length,
      results: QUICK_PICK_ICONS.map(name => ({ name, path: BRIGHTNESS_ICONS[name] }))
    };
  }
  return {
    type: 'icons', seq, query: search.query, quickPicks: false,
    total: search.total, results: search.results
  };
}

export function getIconReply(payload, catalog = mdiCatalog) {
  const name = normalizeIconName(payload.name);
  return {
    type: 'icon',
    seq: sequence(payload.seq),
    name,
    path: name ? resolveIconPath(name, catalog) : null
  };
}

export async function handleInspectorMessage(payload, { controller, catalog = mdiCatalog } = {}) {
  if (!payload || typeof payload !== 'object') return null;
  switch (payload.op) {
    case 'listMonitors': {
      let res;
      try { res = await controller.list(); }
      catch (error) { res = { ok: false, error: errorText(error) }; }
      return { type: 'monitors', monitors: normalizeMonitors(res), ok: !!(res && res.ok) };
    }
    case 'getBrightness': {
      let result;
      try { result = await controller.get(payload.monitor); }
      catch (error) { result = { ok: false, error: errorText(error) }; }
      return { type: 'brightness', result };
    }
    case 'searchIcons':
      return searchIconsReply(payload, catalog);
    case 'getIcon':
      return getIconReply(payload, catalog);
    default:
      return null;
  }
}
