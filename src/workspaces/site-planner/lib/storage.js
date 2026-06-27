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
import { createSiteModel, migrate, mergeSiteContent, contentCount, isBuilding } from "./siteModel.js";
import { cloudUpsert, cloudDelete, cloudList, clearSiteVersions, keepaliveCloudPush, fetchSiteForReconcile } from "./cloudSync.js";
import { idbGet, idbPut, idbAvailable, idbDeleteByPrefix } from "./localDb.js";

/* Cloud backend (Phase 4). When a user is signed in, `activeUser` holds their id:
 * the working store switches to a per-user local cache (pulled from Supabase on
 * login) and writes mirror to Supabase (RLS-scoped to them). Logged out,
 * activeUser is null and everything stays 100% localStorage (the legacy store). */
let activeUser = null;
export function setActiveUser(uid) {
  const next = uid || null;
  if (next !== activeUser) clearSiteVersions(); // don't carry one user's optimistic-version tokens into another's session (B314)
  activeUser = next;
}
export const isCloudActive = () => !!activeUser;
export const activeUid = () => activeUser; // signed-in user's id, or null (B475 — warm the project cache)
const cloudKey = (uid) => "planarfit:sites:cloud:" + uid;

// Session tombstone (per-tab): ids deleted in THIS tab. The bug it kills (B372): when you delete
// a site from the map, the planner that's still MOUNTED (hidden) for that site unmounts, and its
// persist-on-leave / beforeunload / debounced-autosave flush fires AFTER the delete — re-writing
// the row we just removed (it "reappears", and then pullCloud's heal-the-split re-pushes it to the
// cloud, so it survives a reload too). Every one of those resurrection paths funnels through
// saveSite, so we block at that single chokepoint: saveSite refuses to RE-CREATE a deleted,
// now-absent row. A normal edit-save (the record still exists) and a brand-new site (its id was
// never deleted) are unaffected. Module scope = naturally per-tab; cleared on reload (by then the
// delete has settled), or explicitly when a same-id record is deliberately re-created (re-import).
const recentlyDeleted = new Set();
export const _recentlyDeleted = recentlyDeleted; // test seam
export function clearRecentlyDeleted(id) { if (id == null) recentlyDeleted.clear(); else recentlyDeleted.delete(id); }
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
// B460 — a stable content signature: the drawn collections (each sorted by id) + tombstones, as JSON.
// Two models with the SAME drawn work hash-equal even if their updatedAt differs, so the boot re-push
// (toPush) can fire on a real content change but NOT on a no-op re-open whose only difference is a
// fresher timestamp. Both sides are createSiteModel-normalized, so identical content → identical JSON.
const sigArr = (x) => (Array.isArray(x) ? x : []);
const sigById = (a, b) => String(a && a.id).localeCompare(String(b && b.id));
function contentSig(m) {
  return JSON.stringify([
    sigArr(m && m.els).slice().sort(sigById),
    sigArr(m && m.markups).slice().sort(sigById),
    sigArr(m && m.measures).slice().sort(sigById),
    sigArr(m && m.callouts).slice().sort(sigById),
    sigArr(m && m.parcels).slice().sort(sigById),
    sigArr(m && m.sheetOverlays).slice().sort(sigById),
    sigArr(m && m.parcelDrawings).slice().sort(sigById),
    sigArr(m && m.deletedIds).slice().sort(),
  ]);
}
export function mergePulledSites(existing, cloudModels, selfUid) {
  const map = {};
  for (const rec of Object.values(existing || {})) { const n = createSiteModel(rec); if (n.id) map[n.id] = n; }
  const cloudAt = {};
  const cloudSig = {};
  for (const m of (cloudModels || [])) {
    const n = createSiteModel(m); if (!n.id) continue;
    cloudAt[n.id] = n.updatedAt || 0;
    cloudSig[n.id] = contentSig(n);
    const local = map[n.id];
    map[n.id] = local ? mergeSiteContent(local, n) : n; // content-union — never drop drawn work
  }
  // TEAM: only re-push rows THIS user owns. A teammate's shared row (ownerId set to someone else)
  // is read-through only — re-pushing it from your device would churn versions / risk a false
  // conflict on the real owner's edits. A row with no ownerId (legacy local-only) or no selfUid
  // (older callers / tests) is treated as ours, preserving the prior heal behavior.
  const mine = (m) => !selfUid || !m.ownerId || m.ownerId === selfUid;
  // B460 — re-push ONLY when the merge actually changed the cloud's CONTENT (an add/move/delete the
  // cloud lacks), or the row is cloud-absent. The old rule also re-pushed on a merely-newer updatedAt
  // — which B458's immediate mirror write makes routine (every edit advances the local timestamp while
  // the cloud push lags), so every reload re-pushed identical content, bumped `version`, and tripped a
  // SPURIOUS "changed in another session" conflict in any OTHER open tab. map[id] is the union (⊇ cloud),
  // so this can never push a thinner row; an identical re-open now pushes nothing (no version churn).
  const toPush = Object.keys(map).filter((id) =>
    mine(map[id]) && (!(id in cloudAt) || contentSig(map[id]) !== cloudSig[id]));
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
  const { map, toPush } = mergePulledSites(existing, models, uid);
  try { localStorage.setItem(cloudKey(uid), JSON.stringify(map)); } catch (_) {}
  pruneMigratedLegacy(map); // B473 — free the ~MB of dead logged-out duplicates now safely in the cloud
  // Heal the split: re-push anything the cloud is missing / older on, so a push that didn't
  // land doesn't strand work on this device (fire-and-forget; the next autosave would too).
  for (const id of toPush) cloudUpsert(uid, map[id]).catch(() => {});
  return { ok: true, count: models.length };
}
export function clearCloudCache(uid) { try { if (uid) localStorage.removeItem(cloudKey(uid)); } catch (_) {} }
// B473 — the logged-out store (planarfit:sites:v1) is dead weight once signed in: every id there that
// is ALSO in the signed-in cloud cache is a pure duplicate crowding the ~5MB localStorage cap (the very
// pressure that made writeSites fail → new-site data loss). Drop ONLY ids confirmed present in the cloud
// map; an un-migrated legacy site (not in the cloud) is KEPT untouched. Runs after a SUCCESSFUL pullCloud
// (the cloud copy is authoritative). Never throws.
export function pruneMigratedLegacy(cloudMap) {
  try {
    const raw = localStorage.getItem(SITES_KEY);
    if (!raw || !cloudMap) return;
    const legacy = JSON.parse(raw) || {};
    let dropped = 0;
    // B511: prune a migrated legacy site ONLY when the cloud copy is same-or-newer than the
    // on-device copy. Pruning by id-exists alone silently dropped a NEWER logged-out edit
    // (edit while signed out → sign back in → the older cloud row exists → the newer local
    // work was deleted before the migration modal could ever surface it). Mirror the inverse
    // of pendingLegacyCount's predicate so reclaimed duplicates still get cleaned up.
    for (const id of Object.keys(legacy)) {
      if (cloudMap[id] && (cloudMap[id].updatedAt || 0) >= ((legacy[id] && legacy[id].updatedAt) || 0)) { delete legacy[id]; dropped++; }
    }
    if (dropped) localStorage.setItem(SITES_KEY, JSON.stringify(legacy));
  } catch (_) {}
}

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
  // B552: delegate to pendingLegacySites so the COUNT can't disagree with the LIST or with what
  // importLegacyIntoCloud actually copies. The old raw-key loop counted records with a missing/
  // falsy normalized id (which import skips), so the badge could read "3 pending" while only 2
  // imported (the B128 symptom). pendingLegacySites already normalizes (migrate) + drops !id.
  return pendingLegacySites(uid).length;
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
  recentlyDeleted.delete(local.id); // a deliberate re-create lifts the delete tombstone (B372)
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
  recentlyDeleted.delete(local.id); // a deliberate re-create lifts the delete tombstone (B372)
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
// B473 — push a LIVE in-memory model to the cloud, NOT by id. Used when the on-device write FAILED
// (full localStorage): pushSiteToCloud→loadSite would re-read the failed store and ship a stale,
// pre-edit copy — losing the very edit in the cloud too. The cloud has no ~5MB cap, so pushing the
// live payload keeps the work safe in the account and a reload restores it. No-op logged out.
export async function pushModelToCloud(model) {
  if (!activeUser) return { ok: true, skipped: true };
  if (!model || !model.id) return { ok: false, error: "missing" };
  return cloudUpsert(activeUser, createSiteModel(model));
}
// B480 — refresh THIS site's cloud version token + fetch the latest copy so "Take over editing here" can
// reconcile a conflict IN PLACE (union the other session's content, then push at the fresh version) instead
// of reloading (which bounced to the map + re-entered the version race → the take-over loop). No-op (null)
// when logged out. Returns the cloud's stored model, or null.
export async function reconcileSiteFromCloud(id) {
  if (!activeUser || !id) return null;
  return fetchSiteForReconcile(activeUser, id);
}
// Synchronous best-effort cloud push for a forced reload (B452): a guarded keepalive
// write that survives the navigation. Reads the freshly-saved local copy so the cloud
// gets the very latest. No-op when logged out. Returns true if a request was dispatched.
export function keepaliveFlushSite(id) {
  if (!activeUser || !id) return false;
  const m = loadSite(id);
  if (!m) return false;
  return keepaliveCloudPush(activeUser, m);
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
// Drop big inline image rasters from a record (keep placement + every bit of geometry); the rasters
// re-hydrate from cloud/Storage on load (strippedForCloud). Shared by the version ring AND the
// over-quota retry in writeSites (B473) — both must shed the SAME three raster homes (underlay /
// sheetOverlays / parcelDrawings) or a raster-bloated record fails to persist outright instead of
// degrading to "geometry survives on-device, rasters re-fetch".
function stripDataUrls(m) {
  let s = m;
  if (s.underlay && isDataUrl(s.underlay.src)) s = { ...s, underlay: { ...s.underlay, src: null, strippedForCloud: true } };
  if (Array.isArray(s.sheetOverlays) && s.sheetOverlays.some((o) => o && isDataUrl(o.src)))
    s = { ...s, sheetOverlays: s.sheetOverlays.map((o) => (o && isDataUrl(o.src) ? { ...o, src: null, strippedForCloud: true } : o)) };
  if (Array.isArray(s.parcelDrawings) && s.parcelDrawings.some((d) => d && isDataUrl(d.src)))
    s = { ...s, parcelDrawings: s.parcelDrawings.map((d) => (d && isDataUrl(d.src) ? { ...d, src: null, strippedForCloud: true } : d)) };
  return s;
}
// B474 — the version ring lives in an in-memory cache `historyMem` backed by IndexedDB (gigabytes, no
// ~5MB localStorage cap → undo depth is no longer byte-throttled and survives in a store that can't fill).
// `historyAll` is the synchronous source of truth: it seeds from localStorage on first access (so the very
// first snapshot is never empty — race-safe before async IndexedDB hydration), then initHistoryStore()
// merges in the fuller IndexedDB copy. It re-seeds if the localStorage instance itself changes (test
// isolation — beforeEach swaps the mock; in the real app the reference is stable so the ring persists for
// the session). All reads/writes stay synchronous; the IndexedDB write is fire-and-forget.
let historyMem = null;
let historyHydrated = false;
let historyLS = null; // the localStorage instance historyMem was seeded from (detects a test swap)
const historyAll = () => {
  const ls = (typeof localStorage !== "undefined") ? localStorage : null;
  if (!historyMem || historyLS !== ls) {
    historyLS = ls; historyHydrated = false;
    try { historyMem = JSON.parse(localStorage.getItem(HISTORY_KEY)) || {}; } catch (_) { historyMem = {}; }
  }
  return historyMem;
};
// Reset hook for tests that drive the IndexedDB path (mirrors `_recentlyDeleted`). Not used by the app.
export function _resetHistoryForTest() { historyMem = null; historyHydrated = false; historyLS = null; }
// B473 — bound the version ring by BYTES, not just HISTORY_PER_SITE, so it can't creep back to ~MB
// and crowd the ~5MB localStorage cap (the pressure that made saves fail). Thins uniformly (newest
// kept) by halving the per-site keep count until under budget; at most ~log2(15) re-serializes, and
// only when actually over budget.
const HISTORY_BYTE_BUDGET = 700 * 1024;
function capHistoryBytes(h) {
  let keep = HISTORY_PER_SITE, out = h;
  while (keep > 1 && JSON.stringify(out).length > HISTORY_BYTE_BUDGET) {
    keep = Math.floor(keep / 2);
    out = {}; for (const [id, list] of Object.entries(h)) out[id] = (list || []).slice(0, keep);
  }
  return out;
}
function writeHistoryAll(h) {
  historyMem = h;                                   // in-memory ring = the synchronous source of truth (uncapped depth)
  let lsOk = false;
  const capped = capHistoryBytes(h);                // localStorage keeps a BYTE-CAPPED mirror (the no-IndexedDB fallback)
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(capped)); lsOk = true; }
  catch (_) { // over quota — keep only the newest few per site and retry
    try { const t = {}; for (const [id, list] of Object.entries(capped)) t[id] = (list || []).slice(0, 4); localStorage.setItem(HISTORY_KEY, JSON.stringify(t)); lsOk = true; } catch (_2) {}
  }
  // Durable, UNCAPPED copy in IndexedDB — gated until hydration so a pre-hydration partial ring can't
  // clobber the fuller stored one (initHistoryStore merges, then persists). Fire-and-forget.
  if (historyHydrated && idbAvailable()) idbPut(HISTORY_KEY, JSON.stringify(h));
  // Return ONLY the synchronously-VERIFIED localStorage result (B474 review #14). The idb write above is
  // fire-and-forget — idbAvailable() means "the API exists", not "the write committed" — so counting it
  // here let backupNow() (the Restore safety gate) report a backup that may not exist when localStorage is
  // full AND the idb put silently fails, and Restore would then wipe the canvas with no real backup. In
  // the normal case the byte-capped localStorage write succeeds, so backupNow stays true; only a 100%-full
  // localStorage now returns false → Restore is blocked honestly rather than destroying work. (Durability
  // of the deep history is unchanged — it still lands in IndexedDB; this only governs what we CLAIM.)
  return lsOk;
}
// Union two history maps per site by snapshot timestamp (`at`), newest-first, keep HISTORY_PER_SITE.
function mergeHistory(a, b) {
  const out = {};
  const ids = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const id of ids) {
    const seen = new Set(), list = [];
    for (const v of [...((a && a[id]) || []), ...((b && b[id]) || [])]) {
      if (!v || seen.has(v.at)) continue; seen.add(v.at); list.push(v);
    }
    list.sort((x, y) => (y.at || 0) - (x.at || 0));
    out[id] = list.slice(0, HISTORY_PER_SITE);
  }
  return out;
}
// B474 — hydrate the version ring from IndexedDB at boot (called once from SitePlannerApp). Merges the
// synchronous localStorage seed with the fuller IndexedDB copy, marks hydrated (so writes now persist to
// IndexedDB), and persists the merge — one-time migrating the localStorage ring into IndexedDB. Resolves
// even when IndexedDB is unavailable (then the ring just stays localStorage-backed = current behavior).
export async function initHistoryStore() {
  if (historyHydrated) return;
  historyAll(); // ensure mem is seeded from localStorage (sync)
  if (!idbAvailable()) { historyHydrated = true; return; }
  try {
    const raw = await idbGet(HISTORY_KEY);
    let fromIdb = {};
    if (raw) { try { fromIdb = JSON.parse(raw) || {}; } catch (_) {} }
    historyMem = mergeHistory(historyMem || {}, fromIdb);
    historyHydrated = true;
    idbPut(HISTORY_KEY, JSON.stringify(historyMem)); // persist merge + migrate localStorage → IndexedDB
  } catch (_) { historyHydrated = true; }
}
// Shape signature — counts of each drawn collection. A content DROP always changes it
// (fewer items), so the pre-drop version is always captured; an identical-shape save
// (e.g. a pure move) is de-duped so the ring stays meaningful.
const sigOf = (m) => [m.els, m.markups, m.measures, m.callouts, m.parcels, m.sheetOverlays, m.parcelDrawings]
  .map((a) => (a && a.length) || 0).join("/");
const mainBuildingCount = (m) =>
  (Array.isArray(m.els) ? m.els : []).filter((e) => e && e.type === "building" && !e.attachedTo && !e.dogEar).length;
// Snapshot a version (the record about to be overwritten) into the ring buffer. Returns TRUE iff a
// snapshot was actually written to localStorage — so a caller (Restore, B467/NEW-4) can VERIFY the
// backup persisted instead of assuming it. `force` bypasses the same-shape dedup: a Restore can
// replace a state that shares its shape (collection counts) with the newest snapshot but differs in
// content, so the pre-restore backup must be taken even when sigOf matches.
export function snapshotVersion(model, { force = false } = {}) {
  if (!model || !model.id) return false;
  const m = createSiteModel(model);
  if (!contentCount(m) && !m.underlay) return false; // never snapshot an empty record
  const all = historyAll();
  const list = all[m.id] || [];
  const sig = sigOf(m);
  if (!force && list[0] && list[0].sig === sig) return false; // same shape as the newest snapshot → skip churn
  list.unshift({ at: m.updatedAt || Date.now(), sig, buildings: mainBuildingCount(m), name: m.name || null, site: m.site || null, model: stripDataUrls(m) });
  all[m.id] = list.slice(0, HISTORY_PER_SITE);
  return writeHistoryAll(all); // false only on a hard quota failure even after slimming
}
// B467/NEW-4 — force a backup of a site's CURRENT stored state and report whether it's safe to
// proceed with a Restore. Returns TRUE when there's nothing at risk (no record, or an empty one) OR
// when a backup snapshot actually persisted; FALSE only when real content exists AND the snapshot
// could NOT be written. Restore calls this BEFORE replacing the canvas so the dialog's "your current
// version is backed up too, so a restore can be undone" promise is verified, never silently broken.
export function backupNow(id) {
  if (!id) return false;
  const cur = loadSite(id);
  if (!cur) return true;                                  // nothing stored to overwrite
  if (!contentCount(cur) && !cur.underlay) return true;   // current state is empty → nothing to protect
  return snapshotVersion(cur, { force: true }) === true;  // real content → require a persisted backup
}
// Human content summary of a snapshot for the version-history list (B456/NEW-8). Computed
// from the stored full model so it's correct even for OLD snapshots, and counts REAL
// buildings (isBuilding excludes only dog-ear sub-pieces) — the old label used
// mainBuildingCount, which ALSO excludes attached additions and so read a misleading
// "0 buildings" on plans whose buildings were all attached. Lists the other drawn
// collections too, so rows saved seconds apart are distinguishable. Pure; unit-tested.
export function summarizeVersion(model) {
  const m = createSiteModel(model || {});
  const buildings = (m.els || []).filter(isBuilding).length;
  const roads = (m.els || []).filter((e) => e && e.type === "road").length;
  const parts = [];
  if ((m.parcels || []).length) parts.push(`${m.parcels.length} parcel${m.parcels.length === 1 ? "" : "s"}`);
  if (roads) parts.push(`${roads} road${roads === 1 ? "" : "s"}`);
  parts.push(`${buildings} building${buildings === 1 ? "" : "s"}`);
  const notes = (m.measures || []).length + (m.markups || []).length + (m.callouts || []).length;
  if (notes) parts.push(`${notes} markup${notes === 1 ? "" : "s"}`);
  return { buildings, summary: parts.join(" · ") };
}
// Versions available to restore for a site (newest first). Each row carries a real content
// summary + true building count (B456/NEW-8), and adjacent rows that collapse to the same
// second AND the same shape are de-duped so the list isn't a wall of identical-looking rows.
export function listVersions(id) {
  const out = [];
  let lastKey = null;
  for (const v of (historyAll()[id] || [])) {
    const sec = Math.floor((v.at || 0) / 1000);
    const key = `${sec}|${v.sig}`;
    if (key === lastKey) continue; // same second + same shape as the row just above → drop the dupe
    lastKey = key;
    const { buildings, summary } = summarizeVersion(v.model);
    out.push({ at: v.at, buildings, summary, sig: v.sig });
  }
  return out;
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
// B474 — drop ONLY the rasters that are safely stashed in IndexedDB (have an `idbKey`), so the PERSISTED
// record shrinks off the ~5MB cap while staying recoverable (a reload re-hydrates from IndexedDB). A
// raster with no idbKey keeps its src (safe fallback). Mirrors stripDataUrls' three raster homes. NO-OP
// for records without idbKey (e.g. every existing test) → behavior unchanged there.
function dropIdbBackedSrc(m) {
  let s = m;
  if (s.underlay && s.underlay.idbKey && isDataUrl(s.underlay.src)) s = { ...s, underlay: { ...s.underlay, src: null } };
  if (Array.isArray(s.sheetOverlays) && s.sheetOverlays.some((o) => o && o.idbKey && isDataUrl(o.src)))
    s = { ...s, sheetOverlays: s.sheetOverlays.map((o) => (o && o.idbKey && isDataUrl(o.src) ? { ...o, src: null } : o)) };
  if (Array.isArray(s.parcelDrawings) && s.parcelDrawings.some((d) => d && d.idbKey && isDataUrl(d.src)))
    s = { ...s, parcelDrawings: s.parcelDrawings.map((d) => (d && d.idbKey && isDataUrl(d.src) ? { ...d, src: null } : d)) };
  return s;
}
function writeSites(obj) {
  // B474 — proactively shed IndexedDB-backed raster src so the persisted record stays small (off cap).
  const persist = {};
  for (const [id, s] of Object.entries(obj)) persist[id] = dropIdbBackedSrc(s);
  try { localStorage.setItem(sitesKey(), JSON.stringify(persist)); return true; }
  catch (_) {
    // Over quota anyway — shed ALL inline rasters (geometry still persists; rasters re-hydrate). B473.
    try {
      const slim = {};
      for (const [id, s] of Object.entries(persist)) slim[id] = stripDataUrls(s);
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
// Mirror the cross-module schedule link onto a site group (schema v9). The canonical pairing
// lives on the Schedule record (its `linkedSiteId`); this writes the lightweight HINT
// (scheduleProjectId/Name) onto every plan in the group so the Site Planner can show "has a
// schedule" without booting the Schedule iframe. Pass `{ scheduleProjectId: null }` to clear it.
// Goes through saveSite, so it persists locally + syncs to the cloud like any other edit.
export function setScheduleLink(groupId, { scheduleProjectId = null, name = null } = {}) {
  if (!groupId) return;
  const id = scheduleProjectId != null ? scheduleProjectId : null;
  loadPlansOfGroup(groupId).forEach((s) => {
    // No-op if the hint already matches — avoids a needless save + cloud write on every visit.
    if ((s.scheduleProjectId ?? null) === id && (s.scheduleProjectName ?? null) === (name ?? null)) return;
    saveSite({ id: s.id, scheduleProjectId: id, scheduleProjectName: id != null ? name : null });
  });
}
// The schedule link recorded on a site group (reads the first plan; the hint is mirrored
// identically across every plan in the group). Returns { scheduleProjectId, name } | null.
export function scheduleLinkOf(groupId) {
  const plans = loadPlansOfGroup(groupId);
  for (const s of plans) {
    if (s.scheduleProjectId != null) return { scheduleProjectId: s.scheduleProjectId, name: s.scheduleProjectName || null };
  }
  return null;
}
// Delete a whole site (group) — every plan in it, locally (instant/optimistic) AND from the
// cloud when signed in. Returns a promise resolving { ok, removed, error? } aggregated across
// the group's plans, so a caller can AWAIT it and surface a LOUD error if any cloud removal
// actually failed or matched zero rows (B439 honesty rule: a silent survivor reappears on the
// next pull — never report a false "deleted"). Logged out, every plan resolves ok (nothing
// server-side to remove). An empty/unknown group is a no-op success.
export function deleteSiteGroup(groupId) {
  const plans = loadPlansOfGroup(groupId);
  if (!plans.length) return Promise.resolve({ ok: true, removed: 0 });
  // deleteSite removes locally right away and returns the cloud-delete promise; run them all.
  return Promise.all(plans.map((s) => deleteSite(s.id))).then((results) => {
    const failed = results.find((r) => r && r.ok === false);
    // signed-in delete that matched zero rows = an ownership/RLS mismatch the row survived (the
    // cloud call "succeeded" but removed nothing) — treat it as a real failure, not a clean delete.
    const zeroMatch = results.find((r) => r && r.ok && !r.skipped && r.removed === 0);
    const removed = results.filter((r) => r && r.ok !== false).length;
    if (failed) return { ok: false, error: failed.error || "Cloud delete failed", removed };
    if (zeroMatch) return { ok: false, error: "The cloud copy could not be removed (it may belong to another account). It may reappear when you reload.", removed };
    return { ok: true, removed: plans.length };
  });
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
// `skipHistory` writes the local mirror WITHOUT taking a version-history snapshot. Used by the
// immediate per-edit local write (B458): the device mirror must be current within ~50ms so a reload
// can never lose the edit, but snapshotting on every drag frame would spam the ring — the debounced
// settle-tick save (no flag) is the single, natural history-snapshot point. (doc-review already
// splits immediate-mirror from debounced-cloud this way; this brings the Site Planner to parity.)
export function saveSite(partial, { skipHistory = false } = {}) {
  if (!partial || !partial.id) return false;
  const sites = readSites();
  const existing = sites[partial.id];
  // Resurrection guard (B372): once a site is deleted in this tab, a late flush from the
  // unmounting planner (persist-on-leave / beforeunload) or an already-queued debounced autosave
  // must NOT re-insert it. Block ONLY a re-create of a deleted, currently-absent row — a normal
  // edit-save (existing present) and a brand-new site (id never deleted) both pass through.
  if (!existing && recentlyDeleted.has(partial.id)) return false;
  let merged = { ...(existing || {}), ...partial };
  // Cross-tab guard (B127): if the stored record is NEWER than what THIS tab last saw, another
  // tab wrote in between — fold our change ON TOP of the store's content (union) instead of a
  // blind overwrite, so a stale tab can't drop the other tab's work. A single-tab writer always
  // matches (no fold → plain replace → deletes still stick).
  if (existing && (existing.updatedAt || 0) > (lastSeenAt[partial.id] || 0)) {
    merged = mergeSiteContent(createSiteModel(merged), existing); // our scalars + union of content
  }
  if (existing && !skipHistory) snapshotVersion(existing); // back up the prior version before overwriting (rollback safety net, B126); the immediate per-edit write skips this (B458)
  const model = { ...createSiteModel(merged), updatedAt: Date.now() };
  sites[partial.id] = model;
  lastSeenAt[partial.id] = model.updatedAt;
  return writeSites(sites);
}
// Remove a site locally (instant/optimistic) AND from the cloud when signed in. Returns the
// cloud-delete promise ({ ok, error?, removed? }) so the caller can AWAIT it and surface a loud
// error if the cloud removal actually failed (the row would otherwise silently survive and
// reappear on reload — B372). Logged out, it resolves ok (nothing to remove server-side).
export function deleteSite(id) {
  const sites = readSites();
  delete sites[id];
  writeSites(sites);
  if (id) idbDeleteByPrefix(`raster:${id}:`); // B474 review — evict this site's cached underlay/overlay/drawing rasters from IndexedDB so they don't orphan forever (#13/#24); no-op when idb is absent
  recentlyDeleted.add(id); // tombstone so no in-flight flush can resurrect it (B372)
  if (getCurrentSiteId() === id) setCurrentSiteId(null);
  // Return the cloud-removal result so the caller can report an honest failure / no-op (B372).
  // TEAM: cloudDelete scopes by id and lets RLS decide (owner or team-admin) — a regular member
  // can't delete a teammate's shared project; that surfaces as removed:0, and the row re-appears
  // on the next pull rather than being lost.
  return activeUser ? cloudDelete(activeUser, id) : Promise.resolve({ ok: true, skipped: true });
}
export function getCurrentSiteId() { try { return localStorage.getItem(CURRENT_KEY) || null; } catch (_) { return null; } }
export function setCurrentSiteId(id) { try { id ? localStorage.setItem(CURRENT_KEY, id) : localStorage.removeItem(CURRENT_KEY); } catch (_) {} }
