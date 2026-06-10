/* localStorage-backed key/value store.
 *
 * The original prototype was written for Claude's artifact `window.storage`
 * sandbox API (async list/get/set/delete). This shim keeps the exact same
 * surface so the component code is unchanged, but persists to the browser's
 * localStorage instead — so scenarios survive reloads on your own machine.
 */
// Single-slot autosave of the live working canvas (separate from named scenarios).
export const AUTOSAVE_KEY = "planarfit:autosave:v1";

export function loadAutosave() {
  try {
    const v = localStorage.getItem(AUTOSAVE_KEY);
    return v ? JSON.parse(v) : null;
  } catch (_) {
    return null;
  }
}

// Persist the working state. If it's too big for localStorage (usually a large
// pasted screenshot dataURL), retry without that image so everything else saves.
export function saveAutosave(state) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state));
    return true;
  } catch (_) {
    try {
      const u = state.underlay;
      const slim = u && String(u.src || "").startsWith("data:") ? { ...state, underlay: null } : state;
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(slim));
      return true;
    } catch (_2) {
      return false;
    }
  }
}

export const storage = {
  async list(prefix = "") {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    return { keys };
  },
  async get(key) {
    const value = localStorage.getItem(key);
    return value == null ? null : { value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { ok: true };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { ok: true };
  },
};

/* -------------------------------------------------------------------------
 * Multi-site store. Every planned site is kept as its own record so opening
 * or starting another site never clobbers the one you're on. Each record is
 * the planner state plus a geographic `origin` (so the map can show it).
 *   site = { id, name, origin:{lat,lon}|null, updatedAt,
 *            parcels, els, measures, settings, underlay }
 * ----------------------------------------------------------------------- */
const SITES_KEY = "planarfit:sites:v1";
const CURRENT_KEY = "planarfit:currentSite:v1";

function readSites() {
  try { return JSON.parse(localStorage.getItem(SITES_KEY)) || {}; } catch (_) { return {}; }
}
function writeSites(obj) {
  try { localStorage.setItem(SITES_KEY, JSON.stringify(obj)); return true; }
  catch (_) {
    // Over quota — usually a pasted screenshot dataURL. Drop those and retry so
    // the (much smaller) geometry of every site still persists.
    try {
      const slim = {};
      for (const [id, s] of Object.entries(obj)) {
        const u = s.underlay;
        slim[id] = u && String(u.src || "").startsWith("data:") ? { ...s, underlay: null } : s;
      }
      localStorage.setItem(SITES_KEY, JSON.stringify(slim));
      return true;
    } catch (_2) { return false; }
  }
}

// One-time migration of the legacy single-slot autosave into a site record.
export function migrateOldAutosave() {
  if (Object.keys(readSites()).length) return;
  const old = loadAutosave();
  if (old && ((old.parcels && old.parcels.length) || (old.els && old.els.length) || old.underlay)) {
    const id = "s" + Date.now().toString(36);
    const sites = { [id]: { id, name: "My site", origin: old.origin || null, parcels: old.parcels || [], els: old.els || [], measures: old.measures || [], settings: old.settings || {}, underlay: old.underlay || null, updatedAt: Date.now() } };
    if (writeSites(sites)) { setCurrentSiteId(id); try { localStorage.removeItem(AUTOSAVE_KEY); } catch (_) {} }
  }
}

export function loadSitesList() {
  return Object.values(readSites()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export function loadSite(id) { return id ? readSites()[id] || null : null; }
export function saveSite(partial) {
  if (!partial || !partial.id) return false;
  const sites = readSites();
  sites[partial.id] = { ...(sites[partial.id] || {}), ...partial, updatedAt: Date.now() };
  return writeSites(sites);
}
export function deleteSite(id) {
  const sites = readSites();
  delete sites[id];
  writeSites(sites);
  if (getCurrentSiteId() === id) setCurrentSiteId(null);
}
export function getCurrentSiteId() { try { return localStorage.getItem(CURRENT_KEY) || null; } catch (_) { return null; } }
export function setCurrentSiteId(id) { try { id ? localStorage.setItem(CURRENT_KEY, id) : localStorage.removeItem(CURRENT_KEY); } catch (_) {} }
