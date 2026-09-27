// Full Material Design Icons catalogue for the Node main service.
//
// Data: plugin/data/mdi-icons.json, generated from @mdi/js 7.4.47
// (Apache-2.0, Pictogrammers): icon name (without "mdi:") -> SVG path "d" for a
// 24x24 viewBox, about 7,400 icons and 2.7 MB.
//
// The file is read lazily and at most once, by this Node process only. It must
// never be loaded by a webview (the Property Inspector or an HTML main
// service): a multi-megabyte synchronous <script> in the Property Inspector
// previously stopped icons from rendering on the device. The Property
// Inspector searches the catalogue through sendToPlugin/sendToPropertyInspector
// messages and receives at most MAX_SEARCH_LIMIT paths per reply.

import fs from 'node:fs';

export const DEFAULT_CATALOG_URL = new URL('./data/mdi-icons.json', import.meta.url);
export const ICON_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Path data is interpolated into an SVG attribute, so accept only SVG path
// commands, digits, separators and exponents.
export const SAFE_PATH_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9 ,.+\-eE]+$/;
export const MAX_QUERY_LENGTH = 64;
export const DEFAULT_SEARCH_LIMIT = 40;
export const MAX_SEARCH_LIMIT = 60;

// "mdi:Weather-Sunny " -> "weather-sunny"; anything that is not a plausible
// MDI name becomes "" so callers can fall back safely.
export function normalizeIconName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim().toLowerCase().replace(/^mdi:/, '');
  return name.length <= MAX_QUERY_LENGTH && ICON_NAME_PATTERN.test(name) ? name : '';
}

// Free-text search input -> hyphenated lowercase query ("weather sunny" ->
// "weather-sunny"). Characters that cannot occur in MDI names are dropped.
export function normalizeSearchQuery(value) {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, MAX_QUERY_LENGTH)
    .trim()
    .toLowerCase()
    .replace(/^mdi:/, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function clampSearchLimit(value) {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_SEARCH_LIMIT;
  return Math.min(limit, MAX_SEARCH_LIMIT);
}

// Lower rank = better match: prefix, word prefix, substring, all words. Ties
// sort shortest first, so an exact name is always the first prefix match.
function matchRank(name, query, tokens) {
  if (name.startsWith(query)) return 1;
  if (name.includes(`-${query}`)) return 2;
  if (name.includes(query)) return 3;
  if (tokens.length > 1 && tokens.every(token => name.includes(token))) return 4;
  return -1;
}

export class MdiCatalog {
  constructor({ url = DEFAULT_CATALOG_URL, readFile = fs.readFileSync, log = () => {} } = {}) {
    this.url = url;
    this.readFile = readFile;
    this.log = log;
    this.icons = null;
    this.names = null;
    this.loadCount = 0;
    this.loadError = null;
  }

  get loaded() { return this.icons !== null; }

  load() {
    if (this.icons) return this.icons;
    this.loadCount++;
    let icons = new Map();
    try {
      const data = JSON.parse(this.readFile(this.url, 'utf8'));
      const source = data && typeof data.icons === 'object' && data.icons !== null ? data.icons : {};
      for (const [name, path] of Object.entries(source)) {
        if (ICON_NAME_PATTERN.test(name) && typeof path === 'string' && SAFE_PATH_PATTERN.test(path)) {
          icons.set(name, path);
        }
      }
    } catch (error) {
      // A missing or corrupt data file degrades to the curated quick picks; it
      // must never break rendering or the plugin process.
      this.loadError = error;
      icons = new Map();
      this.log(`MDI catalogue unavailable: ${error && error.message ? error.message : error}`);
    }
    this.icons = icons;
    this.names = [...icons.keys()].sort();
    return this.icons;
  }

  get size() { return this.load().size; }

  has(name) {
    const key = normalizeIconName(name);
    return !!key && this.load().has(key);
  }

  get(name) {
    const key = normalizeIconName(name);
    return key ? (this.load().get(key) || null) : null;
  }

  search(query, { limit } = {}) {
    const normalized = normalizeSearchQuery(query);
    const max = clampSearchLimit(limit);
    if (!normalized) return { query: normalized, total: 0, results: [] };
    const icons = this.load();
    const tokens = normalized.split('-').filter(Boolean);
    const matches = [];
    for (const name of this.names) {
      const rank = matchRank(name, normalized, tokens);
      if (rank >= 0) matches.push({ name, rank });
    }
    matches.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || (a.name < b.name ? -1 : 1));
    return {
      query: normalized,
      total: matches.length,
      results: matches.slice(0, max).map(({ name }) => ({ name, path: icons.get(name) }))
    };
  }
}

export const mdiCatalog = new MdiCatalog();
