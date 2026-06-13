/* localStorage-backed key/value store.
 *
 * The original prototype was written for Claude's artifact `window.storage`
 * sandbox API (async list/get/set/delete). This shim keeps the exact same
 * surface so the component code is unchanged, but persists to the browser's
 * localStorage instead — so scenarios survive reloads on your own machine.
 *
 * Site records are persisted as the canonical Site Model (see lib/siteModel.js):
 * loadSite migrates on read, saveSite normalizes on write.
 */
import { createSiteModel, migrate } from "./siteModel.js";
import { cloudUpsert, cloudDelete } from "./cloudSync.js";

/* Cloud backend (Phase 4). When a user is signed in, `activeUser` holds their id
 * and writes are mirrored to Supabase (RLS-scoped to them). Logged out, activeUser
 * is null and everything stays 100% localStorage (unchanged). */
let activeUser = null;
export function setActiveUser(uid) { activeUser = uid || null; }
export const isCloudActive = () => !!activeUser;
// Push one site (by id) to the cloud; resolves { ok }. No-op (ok:true) when logged
// out, so the save badge can await it unconditionally.
export async function pushSiteToCloud(id) {
  if (!activeUser) return { ok: true, skipped: true };
  const m = loadSite(id);
  if (!m) return { ok: false, error: "missing" };
  return cloudUpsert(activeUser, m);
}
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
 * Multi-site store. Every record is one PLAN (a layout). Plans that share the
 * same physical location (parcel) are grouped into a SITE via `groupId`:
 *   - `site`    = the location name (shared across every plan in the group)
 *   - `name`    = the plan name (e.g. "Cross-dock + pond", "Single-load")
 *   - `groupId` = links every plan of one site together
 * Each record also carries a geographic `origin` (so the map can show it).
 *   plan = { id, groupId, site, name, origin:{lat,lon}|null, updatedAt,
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

// One-time migration: give every legacy record a site group. A pre-grouping
// record's `name` was the location, so it becomes the `site` and its layout is
// re-labelled "Plan 1". Idempotent — runs harmlessly once everything's grouped.
export function migrateSiteGroups() {
  const sites = readSites();
  let changed = false;
  for (const [id, s] of Object.entries(sites)) {
    if (!s.groupId) {
      s.groupId = id;
      s.site = s.site || s.name || "Untitled site";
      s.name = "Plan 1";
      changed = true;
    }
  }
  if (changed) writeSites(sites);
}

// One-time: fold any legacy named scenarios (scenario:NAME keys) into Plans under
// a single "Imported scenarios" site, then clear the old keys.
export function migrateScenarios() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("scenario:")) keys.push(k); }
  if (!keys.length) return;
  const group = "simport" + Date.now().toString(36);
  keys.forEach((k, i) => {
    let d; try { d = JSON.parse(localStorage.getItem(k)); } catch (_) { d = null; }
    if (d) {
      const id = "s" + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 5);
      saveSite({ id, groupId: group, site: "Imported scenarios", name: k.slice("scenario:".length) || `Scenario ${i + 1}`,
        origin: d.origin || null, parcels: d.parcels || [], els: d.els || [], measures: d.measures || [], callouts: d.callouts || [], markups: d.markups || [], settings: d.settings || {}, underlay: d.underlay || null });
    }
    localStorage.removeItem(k);
  });
}

// The site (location) a record belongs to, falling back to its own id/name for
// any record that predates grouping.
export const groupOf = (s) => (s && (s.groupId || s.id)) || null;
export const siteNameOf = (s) => (s && (s.site || s.name)) || "Untitled site";

export function loadSitesList() {
  // Normalize every record to the Site Model so the whole app (site list, map
  // markers, plan switcher) reads consistent model objects from one source.
  return Object.values(readSites()).map(migrate).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
// Every plan belonging to one site (group), newest first.
export function loadPlansOfGroup(groupId) {
  return loadSitesList().filter((s) => groupOf(s) === groupId);
}
// Rename a whole site (location) — updates `site` on every plan in the group.
export function renameSiteGroup(groupId, site) {
  loadPlansOfGroup(groupId).forEach((s) => saveSite({ id: s.id, site }));
}
// loadSite returns the canonical Site Model (migrated/normalized); saveSite merges
// the partial onto the existing record and normalizes it back through the schema,
// so storage is a thin persistence layer over the model.
export function loadSite(id) { const rec = id ? readSites()[id] : null; return rec ? migrate(rec) : null; }
export function saveSite(partial) {
  if (!partial || !partial.id) return false;
  const sites = readSites();
  const merged = { ...(sites[partial.id] || {}), ...partial };
  sites[partial.id] = { ...createSiteModel(merged), updatedAt: Date.now() };
  return writeSites(sites);
}
export function deleteSite(id) {
  const sites = readSites();
  delete sites[id];
  writeSites(sites);
  if (getCurrentSiteId() === id) setCurrentSiteId(null);
  if (activeUser) cloudDelete(activeUser, id); // fire-and-forget cloud removal
}
export function getCurrentSiteId() { try { return localStorage.getItem(CURRENT_KEY) || null; } catch (_) { return null; } }
export function setCurrentSiteId(id) { try { id ? localStorage.setItem(CURRENT_KEY, id) : localStorage.removeItem(CURRENT_KEY); } catch (_) {} }
