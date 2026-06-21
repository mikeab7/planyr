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
import { createSiteModel, migrate, mergeSiteContent, contentCount } from "./siteModel.js";
import { cloudUpsert, cloudDelete, cloudList, clearSiteVersions } from "./cloudSync.js";

/* Cloud backend (Phase 4). When a user is signed in, `activeUser` holds their id:
 * the working store switches to a per-user local cache (pulled from Supabase on
 * login) and writes mirror to Supabase (RLS-scoped to them). Logged out,
 * activeUser is null and everything stays 100% localStorage (the legacy store). */
let activeUser = null;
export function setActiveUser(uid) {
  const next = uid || null;
  if (next !== activeUser) clearSiteVersions(); // don't carry one user's optimistic-version tokens into another's session (B312)
  activeUser = next;
}
export const isCloudActive = () => !!activeUser;
const cloudKey = (uid) => "planarfit:sites:cloud:" + uid;
// Pure merge of the local cache with the cloud's records (exported for tests).
// CRITICAL (B124/B126 data-loss fix): build from the LOCAL cache first (so a site the
// cloud didn't return is PRESERVED, never dropped — B124), and reconcile a site present
// in BOTH copies with a CONTENT MERGE (mergeSiteContent), not whole-record newer-wins.
// The old newer-wins let a thinner copy silently erase a fuller one — a building added
// in one copy vanished when a copy with fewer buildings happened to be saved last (a
// stale tab, a second device, a hiccup mid-load). The union keeps every building present
// in EITHER copy; scalar/meta come from the newer side. (B126)
// `toPush` = ids the cloud is missing, has an OLDER copy of, or now has LESS content than
// the merged result — re-push so a building kept from the local side actually reaches the
// cloud instead of being stranded on one device.
// (Delete handling: mergeSiteContent now honors per-item tombstones (`deletedIds`, B276), so a
// deliberate delete that recorded a tombstone — e.g. removing a placed overlay — stays deleted
// across this merge instead of being resurrected. Collections not yet wired to record a tombstone
// keep the old recoverable "a delete can reappear once" trade-off; never silent data loss, and
// the local version history makes any surprise recoverable meanwhile — see BACKLOG B126/B276.)
export function mergePulledSites(existing, cloudModels) {
  const map = {};
  for (const rec of Object.values(existing || {})) { const n = createSiteModel(rec); if (n.id) map[n.id] = n; }
  const cloudAt = {};
  const cloudCount = {};
  for (const m of (cloudModels || [])) {
    const n = createSiteModel(m); if (!n.id) continue;
    cloudAt[n.id] = n.updatedAt || 0;
    cloudCount[n.id] = contentCount(n);
    const local = map[n.id];
    map[n.id] = local ? mergeSiteContent(local, n) : n; // content-union — never drop drawn work
  }
  const toPush = Object.keys(map).filter((id) =>
    !(id in cloudAt) ||
    (map[id].updatedAt || 0) > cloudAt[id] ||
    contentCount(map[id]) > (cloudCount[id] || 0));
  return { map, toPush };
}

// Pull the signed-in user's sites from the cloud into their local cache. Returns
// { ok, count, error }; on a failed fetch it returns { ok:false } WITHOUT touching the
// cache, so a transient/offline error can't wipe the user's last-known sites (B54). On
// success it MERGES (see mergePulledSites): local-only work is kept + re-pushed, never
// dropped (B124); cloud edits overlay newer-wins.
export async function pullCloud(uid) {
  let models;
  try {
    models = await cloudList(uid);
  } catch (e) {
    return { ok: false, count: 0, error: (e && e.message) || "couldn't reach the cloud" };
  }
  let existing = {};
  try { existing = JSON.parse(localStorage.getItem(cloudKey(uid))) || {}; } catch (_) {}
  const { map, toPush } = mergePulledSites(existing, models);
  try { localStorage.setItem(cloudKey(uid), JSON.stringify(map)); } catch (_) {}
  // Heal the split: re-push anything the cloud is missing / older on, so a push that didn't
  // land doesn't strand work on this device (fire-and-forget; the next autosave would too).
  for (const id of toPush) cloudUpsert(uid, map[id]).catch(() => {});
  return { ok: true, count: models.length };
}
export function clearCloudCache(uid) { try { if (uid) localStorage.removeItem(cloudKey(uid)); } catch (_) {} }

// Read the on-device (logged-out / "legacy") store DIRECTLY, regardless of who's
// signed in. Read-only. Used to surface "you have sites saved on this device that
// aren't in your account yet" and to copy them up. Normalized Site Models, newest
// first. (The signed-in store is the per-user cloud cache; these two never auto-merge,
// which is why local-only work can look "missing" once you sign in.)
export function legacySitesList() {
  let obj = {};
  try { obj = JSON.parse(localStorage.getItem(SITES_KEY)) || {}; } catch (_) {}
  return Object.values(obj).map(migrate).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// One-time, NON-DESTRUCTIVE consolidation: copy every on-device (legacy) site into the
// signed-in user's cloud store (local cache + Supabase). The originals are KEPT in the
// legacy store — nothing is moved or deleted — so a partial failure can never lose work.
// A site already in the cloud is overwritten only when the local copy is strictly newer
// (the same newer-wins rule pullCloud uses). Each site is staged into the cloud cache so
// it shows immediately; a failed push is reported (count) and re-pushes on the next edit.
// Returns { copied, skipped, failed }.
export async function importLegacyIntoCloud(uid) {
  if (!uid) return { copied: 0, skipped: 0, failed: 0, error: "not signed in" };
  let legacy = {};
  try { legacy = JSON.parse(localStorage.getItem(SITES_KEY)) || {}; } catch (_) {}
  const ids = Object.keys(legacy);
  if (!ids.length) return { copied: 0, skipped: 0, failed: 0 };
  let cloud = {};
  try { cloud = JSON.parse(localStorage.getItem(cloudKey(uid))) || {}; } catch (_) {}
  let copied = 0, skipped = 0, failed = 0;
  for (const id of ids) {
    const local = createSiteModel(legacy[id]);
    if (!local.id) { skipped++; continue; }
    const existing = cloud[local.id];
    if (existing && (existing.updatedAt || 0) >= (local.updatedAt || 0)) { skipped++; continue; } // cloud already same/newer
    cloud[local.id] = local;                  // stage into the cloud cache so it's visible right away
    const r = await cloudUpsert(uid, local);  // and persist to Supabase
    if (r && r.ok) copied++; else failed++;   // failed pushes stay cached and re-push on the next edit
  }
  try { localStorage.setItem(cloudKey(uid), JSON.stringify(cloud)); } catch (_) {}
  return { copied, skipped, failed };
}

// How many on-device (legacy) sites are NOT yet represented in the signed-in user's
// cloud cache — i.e. would be brought in by importLegacyIntoCloud. 0 when logged out.
export function pendingLegacyCount(uid) {
  if (!uid) return 0;
  let legacy = {}, cloud = {};
  try { legacy = JSON.parse(localStorage.getItem(SITES_KEY)) || {}; } catch (_) {}
  try { cloud = JSON.parse(localStorage.getItem(cloudKey(uid))) || {}; } catch (_) {}
  let n = 0;
  for (const [id, rec] of Object.entries(legacy)) {
    const cur = cloud[id];
    const lAt = (rec && rec.updatedAt) || 0;
    if (!cur || (cur.updatedAt || 0) < lAt) n++;
  }
  return n;
}

// Returns the list of on-device (legacy) sites that are not yet in (or are newer than)
// the signed-in user's cloud cache — the set pendingLegacyCount counts.
export function pendingLegacySites(uid) {
  if (!uid) return legacySitesList();
  let legacy = {}, cloud = {};
  try { legacy = JSON.parse(localStorage.getItem(SITES_KEY)) || {}; } catch (_) {}
  try { cloud = JSON.parse(localStorage.getItem(cloudKey(uid))) || {}; } catch (_) {}
  return Object.values(legacy)
    .map(migrate)
    .filter((rec) => {
      if (!rec.id) return false;
      const cur = cloud[rec.id];
      return !cur || (cur.updatedAt || 0) < (rec.updatedAt || 0);
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// localStorage is the INTENTIONAL PRIMARY store. When signed in, active store =
// planarfit:sites:cloud:<uid> (local cache pulled from Supabase on login). Supabase is
// a fire-and-forget mirror — not a fallback, not a gate. Writing always succeeds locally
// first; the cloud write follows asynchronously. The "legacy" store (planarfit:sites:v1)
// is the pre-login store; the migration flow bridges it to the cloud cache.

// Stage a legacy site into the signed-in user's cloud cache WITHOUT pushing to Supabase.
// Used when the user clicks "Open" in the migration modal so the planner can load the
// site normally. The user then decides (Save = push; Discard = remove from both stores).
// Non-destructive: the original legacy copy is kept.
export function stageLegacySite(uid, siteId) {
  if (!uid || !siteId) return null;
  let legacy = {};
  try { legacy = JSON.parse(localStorage.getItem(SITES_KEY)) || {}; } catch (_) {}
  const rec = legacy[siteId];
  if (!rec) return null;
  const local = createSiteModel(rec);
  if (!local.id) return null;
  let cloud = {};
  try { cloud = JSON.parse(localStorage.getItem(cloudKey(uid))) || {}; } catch (_) {}
  cloud[local.id] = local;
  try { localStorage.setItem(cloudKey(uid), JSON.stringify(cloud)); } catch (_) {}
  return local;
}

// Remove a site from both the legacy store and the signed-in user's cloud cache.
// Used for an explicit Discard in the migration flow — the user wants to erase this
// on-device copy entirely, not save it to their account.
export function discardLegacySite(uid, siteId) {
  let legacy = {};
  try { legacy = JSON.parse(localStorage.getItem(SITES_KEY)) || {}; } catch (_) {}
  delete legacy[siteId];
  try { localStorage.setItem(SITES_KEY, JSON.stringify(legacy)); } catch (_) {}
  if (uid) {
    let cloud = {};
    try { cloud = JSON.parse(localStorage.getItem(cloudKey(uid))) || {}; } catch (_) {}
    delete cloud[siteId];
    try { localStorage.setItem(cloudKey(uid), JSON.stringify(cloud)); } catch (_) {}
  }
}

// True when a site has no meaningful content — nothing drawn, no parcels, no underlay.
// Used to decide whether to offer Save (nothing to keep) vs. only Discard.
export function isEmptySite(model) {
  if (!model) return true;
  return !(
    (model.parcels || []).length ||
    (model.els || []).length ||
    (model.markups || []).length ||
    (model.measures || []).length ||
    model.underlay
  );
}

// Import a SINGLE legacy site into the cloud for uid. Non-destructive — original stays
// in the legacy store. Returns { ok } (same shape as cloudUpsert).
export async function importOneSiteToCloud(uid, siteId) {
  if (!uid || !siteId) return { ok: false, error: "missing args" };
  let legacy = {};
  try { legacy = JSON.parse(localStorage.getItem(SITES_KEY)) || {}; } catch (_) {}
  const rec = legacy[siteId];
  if (!rec) return { ok: false, error: "not found" };
  const local = createSiteModel(rec);
  if (!local.id) return { ok: false, error: "invalid record" };
  let cloud = {};
  try { cloud = JSON.parse(localStorage.getItem(cloudKey(uid))) || {}; } catch (_) {}
  cloud[local.id] = local; // stage in cache so it shows immediately
  try { localStorage.setItem(cloudKey(uid), JSON.stringify(cloud)); } catch (_) {}
  return cloudUpsert(uid, local);
}

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

/* ---- Local version history (automatic backups) ---------------------------
 * Every save snapshots the PRIOR stored version of a site into a small, local-only ring
 * buffer, so a bad/thin overwrite is always recoverable — the data-loss safety net
 * (B126). Snapshots are slimmed (big inline rasters dropped — geometry is what we
 * protect; images re-drop) and capped per site. Never pushed to the cloud. */
const HISTORY_KEY = "planarfit:sites:history:v1";
const HISTORY_PER_SITE = 15;
const isDataUrl = (s) => typeof s === "string" && s.startsWith("data:");
// Drop big inline image rasters from a snapshot (keep placement + every bit of geometry).
function slimForHistory(m) {
  let s = m;
  if (s.underlay && isDataUrl(s.underlay.src)) s = { ...s, underlay: { ...s.underlay, src: null, strippedForCloud: true } };
  if (Array.isArray(s.sheetOverlays) && s.sheetOverlays.some((o) => o && isDataUrl(o.src)))
    s = { ...s, sheetOverlays: s.sheetOverlays.map((o) => (o && isDataUrl(o.src) ? { ...o, src: null, strippedForCloud: true } : o)) };
  if (Array.isArray(s.parcelDrawings) && s.parcelDrawings.some((d) => d && isDataUrl(d.src)))
    s = { ...s, parcelDrawings: s.parcelDrawings.map((d) => (d && isDataUrl(d.src) ? { ...d, src: null, strippedForCloud: true } : d)) };
  return s;
}
const historyAll = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || {}; } catch (_) { return {}; } };
function writeHistoryAll(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); return true; }
  catch (_) { // over quota — keep only the newest few per site and retry
    try { const t = {}; for (const [id, list] of Object.entries(h)) t[id] = (list || []).slice(0, 4); localStorage.setItem(HISTORY_KEY, JSON.stringify(t)); return true; }
    catch (_2) { return false; }
  }
}
// Shape signature — counts of each drawn collection. A content DROP always changes it
// (fewer items), so the pre-drop version is always captured; an identical-shape save
// (e.g. a pure move) is de-duped so the ring stays meaningful.
const sigOf = (m) => [m.els, m.markups, m.measures, m.callouts, m.parcels, m.sheetOverlays, m.parcelDrawings]
  .map((a) => (a && a.length) || 0).join("/");
const mainBuildingCount = (m) =>
  (Array.isArray(m.els) ? m.els : []).filter((e) => e && e.type === "building" && !e.attachedTo && !e.dogEar).length;
// Snapshot a version (the record about to be overwritten) into the ring buffer.
export function snapshotVersion(model) {
  if (!model || !model.id) return;
  const m = createSiteModel(model);
  if (!contentCount(m) && !m.underlay) return; // never snapshot an empty record
  const all = historyAll();
  const list = all[m.id] || [];
  const sig = sigOf(m);
  if (list[0] && list[0].sig === sig) return; // same shape as the newest snapshot → skip churn
  list.unshift({ at: m.updatedAt || Date.now(), sig, buildings: mainBuildingCount(m), name: m.name || null, site: m.site || null, model: slimForHistory(m) });
  all[m.id] = list.slice(0, HISTORY_PER_SITE);
  writeHistoryAll(all);
}
// Versions available to restore for a site (newest first; lightweight metadata only).
export function listVersions(id) {
  return (historyAll()[id] || []).map((v) => ({ at: v.at, buildings: v.buildings, sig: v.sig }));
}
// The full saved snapshot for one version (normalized Site Model), or null.
export function getVersion(id, at) {
  const v = (historyAll()[id] || []).find((x) => x.at === at);
  return v ? createSiteModel(v.model) : null;
}
export function clearHistory(id) { const all = historyAll(); if (id && id in all) { delete all[id]; writeHistoryAll(all); } }

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
const SITES_KEY = "planarfit:sites:v1"; // legacy / logged-out store
const CURRENT_KEY = "planarfit:currentSite:v1";
// Active store key: the per-user cloud cache when signed in, else the legacy store.
const sitesKey = () => (activeUser ? cloudKey(activeUser) : SITES_KEY);

function readSites() {
  try { return JSON.parse(localStorage.getItem(sitesKey())) || {}; } catch (_) { return {}; }
}
function writeSites(obj) {
  try { localStorage.setItem(sitesKey(), JSON.stringify(obj)); return true; }
  catch (_) {
    // Over quota — usually a pasted screenshot dataURL. Drop those and retry so
    // the (much smaller) geometry of every site still persists.
    try {
      const slim = {};
      for (const [id, s] of Object.entries(obj)) {
        const u = s.underlay;
        slim[id] = u && String(u.src || "").startsWith("data:") ? { ...s, underlay: null } : s;
      }
      localStorage.setItem(sitesKey(), JSON.stringify(slim));
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
// Per-TAB memory of the updatedAt this tab last loaded/wrote per site. Lets saveSite tell
// "I'm the current writer" (replace — so deletes stick) from "another tab advanced the store
// since I last synced" (fold my change in — so a stale tab can't thin it, B127). Each browser
// tab is its own JS module instance, so this map is naturally per-tab.
const lastSeenAt = {};
export function loadSite(id) {
  const rec = id ? readSites()[id] : null;
  if (!rec) return null;
  const m = migrate(rec);
  lastSeenAt[id] = m.updatedAt || 0; // we are now in sync with the stored copy
  return m;
}
export function saveSite(partial) {
  if (!partial || !partial.id) return false;
  const sites = readSites();
  const existing = sites[partial.id];
  let merged = { ...(existing || {}), ...partial };
  // Cross-tab guard (B127): if the stored record is NEWER than what THIS tab last saw, another
  // tab wrote in between — fold our change ON TOP of the store's content (union) instead of a
  // blind overwrite, so a stale tab can't drop the other tab's work. A single-tab writer always
  // matches (no fold → plain replace → deletes still stick).
  if (existing && (existing.updatedAt || 0) > (lastSeenAt[partial.id] || 0)) {
    merged = mergeSiteContent(createSiteModel(merged), existing); // our scalars + union of content
  }
  if (existing) snapshotVersion(existing); // back up the prior version before overwriting (rollback safety net, B126)
  const model = { ...createSiteModel(merged), updatedAt: Date.now() };
  sites[partial.id] = model;
  lastSeenAt[partial.id] = model.updatedAt;
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
