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
import { createSiteModel, migrate, mergeSiteContent, contentCount, isBuilding, toMs, countJunkEntries,
  shareMirrorOf, withShareMirror } from "./siteModel.js";
import { cloudUpsert, cloudDelete, cloudHardDelete, cloudRestore, cloudDeletedRows, cloudList, clearSiteVersions, keepaliveCloudPush, fetchSiteForReconcile } from "./cloudSync.js";
import { reconcileGroupNames, resolveNameFor, groupKeyOf, maxStampOf } from "./projectName.js";
import { idbGet, idbPut, idbAvailable, idbDeleteByPrefix } from "./localDb.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";

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

// B757 — DURABLE, per-user record-delete tombstones ({ id: ts }). The in-memory `recentlyDeleted`
// set below (B372) is per-tab and cleared on reload, and it only guards `saveSite` — it does NOT
// stop `pullCloud` → `mergePulledSites` from RE-ADDING a cloud row whose delete never landed
// (offline / transient failure). So a deliberately-deleted PLAN resurrects on the next reload or
// sign-in. These tombstones survive reload; on every pull they (a) SUPPRESS an owned cloud row that
// is still pending removal, and (b) drive a delete RETRY until the cloud confirms it's gone. A row
// whose cloud copy is genuinely NEWER than our delete (updatedAt > ts) means it was legitimately
// edited on another device AFTER we deleted here — the delete is stale, so we drop the tombstone and
// keep the row (cross-device safety). Only used signed-in (logged-out has no cloud to resurrect from).
const tombKey = (uid) => "planarfit:sites:deltomb:v1:" + uid;
const MAX_SITE_TOMBS = 300; // bound the list; an old tombstone whose row is long gone is harmless to drop
// NEW-1 — how long a durable tombstone is KEPT after the cloud confirms the row is gone. The old
// code pruned it the instant the cloud stopped listing the row, which disarmed the deleting client
// at exactly the wrong moment: a second client's heal-the-split re-push lands moments later, and
// with the tombstone already gone this client happily adopted the resurrected row. The window
// matches the 30-day Recently-deleted retention, so a tombstone outlives every path that could
// re-offer the row and only expires once the server has permanently purged it anyway.
export const SITE_TOMB_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
function readSiteTombs(uid) {
  if (!uid) return {};
  try { return JSON.parse(localStorage.getItem(tombKey(uid))) || {}; } catch (_) { return {}; }
}
function writeSiteTombs(uid, obj) {
  if (!uid) return;
  try {
    let entries = Object.entries(obj || {});
    if (entries.length > MAX_SITE_TOMBS) entries = entries.sort((a, b) => toMs(b[1]) - toMs(a[1])).slice(0, MAX_SITE_TOMBS);
    localStorage.setItem(tombKey(uid), JSON.stringify(Object.fromEntries(entries)));
  } catch (_) {}
}
export function recordSiteTombstone(uid, id, ts) {
  if (!uid || !id) return;
  const t = readSiteTombs(uid); t[id] = ts || Date.now(); writeSiteTombs(uid, t);
}
export function clearSiteTombstone(uid, id) {
  if (!uid || !id) return;
  const t = readSiteTombs(uid);
  if (id in t) { delete t[id]; writeSiteTombs(uid, t); }
}
export const _readSiteTombs = readSiteTombs; // test seam

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
export function clearRecentlyDeleted(id) {
  if (id == null) recentlyDeleted.clear(); else recentlyDeleted.delete(id);
  // A deliberate re-create / re-import of a same-id record cancels the durable tombstone too (B757),
  // so the resurrected-by-the-user record isn't suppressed on the next pull.
  if (activeUser && id != null) clearSiteTombstone(activeUser, id);
}
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
// B672 — a cloud row marked `elementsInRows` is a SLIM HEADER: its element collections live as
// site_elements rows (per-element sync), so comparing/merging its (empty) element arrays against a
// full local model would misread "in rows" as "deleted" and perma-re-push. For a slim row both the
// signature and the boot re-push compare HEADER content only (overlays/drawings — the collections
// still riding the blob); a full pre-cutover row keeps the original full-content compare, so the
// first post-cutover push (full local vs full cloud sig mismatch is fine either way) writes the slim
// header exactly once and the comparison converges.
function contentSig(m, headerOnly) {
  return JSON.stringify([
    ...(headerOnly ? [] : [
      sigArr(m && m.els).slice().sort(sigById),
      sigArr(m && m.markups).slice().sort(sigById),
      sigArr(m && m.measures).slice().sort(sigById),
      sigArr(m && m.callouts).slice().sort(sigById),
      sigArr(m && m.parcels).slice().sort(sigById),
      sigArr(m && m.deletedIds).slice().sort(),
    ]),
    sigArr(m && m.sheetOverlays).slice().sort(sigById),
    sigArr(m && m.parcelDrawings).slice().sort(sigById),
  ]);
}
// NEW-1 — `opts` carries the server's view of deletion, which is what makes a delete stick across
// CLIENTS rather than just across reloads of the one browser that performed it:
//   serverDeleted — ids the cloud reports as soft-deleted (`sites.deleted_at`). These are dropped
//                   from the merged map and can never enter `toPush`, so "the cloud is missing this
//                   row" (heal it) stops being confused with "the cloud says this row is deleted"
//                   (honour it). Without this, client B — which never even opened the site — rebuilt
//                   the merged map from its LOCAL cache (the B124 never-drop-local-work guarantee),
//                   hit `!(id in cloudAt)`, and cloudUpsert'd the deleted row straight back.
//   healAbsent    — false when the deleted-id fetch FAILED. We then can't tell "never landed" from
//                   "deleted", so the cloud-absent half of heal-the-split is suspended for this pull
//                   (a fail-safe: nothing local is dropped, the heal just waits for the next pull).
//   now           — injectable clock for the tombstone grace window (tests).
export function mergePulledSites(existing, cloudModels, selfUid, tombstones, opts) {
  const { serverDeleted, healAbsent = true, now = Date.now() } = opts || {};
  const serverDead = new Set(serverDeleted || []);
  const tombs = tombstones || {};
  const map = {};
  for (const rec of Object.values(existing || {})) { const n = createSiteModel(rec); if (n.id) map[n.id] = n; }
  const cloudAt = {};
  const cloudSig = {};
  const cloudSlim = {};
  const cloudIds = new Set();
  for (const m of (cloudModels || [])) {
    const slim = !!(m && m.elementsInRows);
    const n = createSiteModel(m); if (!n.id) continue;
    cloudIds.add(n.id);
    cloudAt[n.id] = n.updatedAt || 0;
    cloudSlim[n.id] = slim;
    cloudSig[n.id] = contentSig(n, slim);
    const local = map[n.id];
    // Content-union — never drop drawn work. A slim row's empty element collections union to the
    // local side; its deletedIds are EXCLUDED from the union (element-deletion truth lives in the
    // site_elements tombstone rows now — a stale header tombstone must never drop an element the
    // rows have restored). A full pre-cutover row merges exactly as before.
    const forMerge = slim ? { ...n, deletedIds: [] } : n;
    /* NEW-2 — the SHARING POINTER IS RE-STAMPED FROM THE CLOUD COLUMN AFTER THE MERGE, because the
     * merge is exactly where it was being lost. `mergeSiteContent` resolves scalars by taking the
     * copy with the newer `updatedAt`, and B458's immediate mirror write makes the LOCAL copy newer
     * on any project that has been edited since its last push — so a stale local `teamId: null`
     * outvoted `sites.team_id` on every pull, and the share icon, the share menu's checked state and
     * TeamPanel's shared-projects count all went blank together. The column is the authority
     * (siteModel.js → SHARE_MIRROR_FIELDS), so it is copied, never voted on. A pre-migration row
     * reports no mirror and is left exactly as it was. */
    const merged = local ? mergeSiteContent(local, forMerge) : n;
    map[n.id] = withShareMirror(merged, shareMirrorOf(m));
  }
  // TEAM: only re-push rows THIS user owns. A teammate's shared row (ownerId set to someone else)
  // is read-through only — re-pushing it from your device would churn versions / risk a false
  // conflict on the real owner's edits. A row with no ownerId (legacy local-only) or no selfUid
  // (older callers / tests) is treated as ours, preserving the prior heal behavior.
  const mine = (m) => !selfUid || !m.ownerId || m.ownerId === selfUid;
  // B757 — honor durable record-delete tombstones so a deliberately-deleted PLAN can't resurrect via
  // the pull. For each pending-delete id:
  //   • cloud no longer has the row → the delete landed → prune the tombstone (tombClear).
  //   • cloud still has it, it's OURS, and it is NOT newer than our delete → the delete didn't land
  //     (offline / failed): SUPPRESS it (drop from the merge — never resurrect) and RETRY the delete.
  //   • cloud row is genuinely NEWER than our delete → a real later edit on another device: the delete
  //     is stale — keep the row and drop the tombstone (cross-device safety, mirrors the B18/B511 rule).
  //   • not ours (a teammate's shared row we can't delete) → let it show; drop the tombstone.
  // NEW-1 (hole 1) — the server's own tombstones outrank every local cache. A row the cloud reports
  // as soft-deleted is removed from the merge on EVERY client, whether or not that client has a
  // local tombstone for it, and a local tombstone is recorded (tombAdd) so this browser's `saveSite`
  // gate also refuses to re-create it from a still-mounted planner's late flush.
  const tombAdd = [];
  for (const id of serverDead) {
    if (id in map) { delete map[id]; if (!(id in tombs)) tombAdd.push(id); }
  }
  const deleteRetry = [];
  const tombClear = [];
  for (const id of Object.keys(tombs)) {
    if (cloudIds.has(id)) {
      const row = map[id];
      if (row && mine(row) && toMs(cloudAt[id]) <= toMs(tombs[id])) { delete map[id]; deleteRetry.push(id); }
      else tombClear.push(id); // a genuinely newer cross-device edit, or a teammate's row we can't delete
      continue;
    }
    // The cloud isn't listing it: it's server-tombstoned, hard-deleted (pre-migration DB), or was
    // never pushed. NEW-1 (hole 2): the old code cleared the tombstone right here — the instant the
    // cloud confirmed the removal — which is precisely when another client's re-push is still in
    // flight. Keep the tombstone through the grace window instead, and suppress our own stale cache
    // copy meanwhile, so even a pre-migration peer's resurrection gets re-killed rather than adopted.
    // (B124 is intact: a genuinely local-only, never-pushed site carries NO tombstone, so it isn't
    // in this loop at all and still heals.)
    delete map[id];
    if (now - toMs(tombs[id]) > SITE_TOMB_GRACE_MS) tombClear.push(id);
  }
  // B460 — re-push ONLY when the merge actually changed the cloud's CONTENT (an add/move/delete the
  // cloud lacks), or the row is cloud-absent. The old rule also re-pushed on a merely-newer updatedAt
  // — which B458's immediate mirror write makes routine (every edit advances the local timestamp while
  // the cloud push lags), so every reload re-pushed identical content, bumped `version`, and tripped a
  // SPURIOUS "changed in another session" conflict in any OTHER open tab. map[id] is the union (⊇ cloud),
  // so this can never push a thinner row; an identical re-open now pushes nothing (no version churn).
  const toPush = Object.keys(map).filter((id) =>
    mine(map[id]) && (!(id in cloudAt) ? healAbsent : contentSig(map[id], cloudSlim[id]) !== cloudSig[id]));
  return { map, toPush, deleteRetry, tombClear, tombAdd };
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
  // NEW-1 — ask the cloud which rows it considers DELETED, not just which rows it still has. The
  // merge needs both: absence alone was read as "a push that didn't land" and re-pushed (the
  // cross-client resurrection). A failed fetch here is LOUD and fail-safe — heal-the-split's
  // cloud-absent half is suspended for this pull rather than risking a resurrection.
  let dead = { ok: true, supported: false, rows: [] };
  try { dead = await cloudDeletedRows(uid); } catch (e) { dead = { ok: false, supported: true, rows: [], error: (e && e.message) || "" }; }
  if (!dead.ok) reportClientEvent("cloud-read-failed", "deleted-id fetch failed (sites) — suppressing absent-row heal this pull", { error: dead.error || "" });
  let existing = {};
  try { existing = JSON.parse(localStorage.getItem(cloudKey(uid))) || {}; } catch (_) {}
  const { map, toPush, deleteRetry, tombClear, tombAdd } = mergePulledSites(existing, models, uid, readSiteTombs(uid), {
    serverDeleted: dead.ok ? dead.rows.map((r) => r && r.id).filter(Boolean) : [],
    healAbsent: dead.ok,
  });
  try { localStorage.setItem(cloudKey(uid), JSON.stringify(map)); } catch (_) {}
  // A row the SERVER says is deleted gets a local tombstone too, so this browser's saveSite gate
  // (and a still-mounted planner's late flush) can't re-create it before the next pull.
  for (const id of (tombAdd || [])) recordSiteTombstone(uid, id, Date.now());
  pruneMigratedLegacy(map); // B473 — free the ~MB of dead logged-out duplicates now safely in the cloud
  // B757 — prune tombstones the cloud has already honored (or a not-ours / newer-edit row), then
  // RETRY the cloud delete for a plan whose removal never landed, so a deliberate delete STICKS
  // instead of resurrecting on the next pull. Clear the tombstone only on a confirmed removal.
  for (const id of (tombClear || [])) clearSiteTombstone(uid, id);
  // NEW-1 — a confirmed removal no longer clears the tombstone: it now expires on the grace window
  // in mergePulledSites, so this client stays armed against another client's late re-push.
  for (const id of (deleteRetry || [])) cloudDelete(uid, id).catch(() => {});
  // Heal the split: re-push anything the cloud is missing / older on, so a push that didn't
  // land doesn't strand work on this device (fire-and-forget; the next autosave would too).
  for (const id of toPush) cloudUpsert(uid, map[id]).catch(() => {});
  // NEW-3 — the pull is exactly when a group can arrive split (a plan this device has never seen
  // showing up still carrying a pre-rename name), so converge it here as well as at boot.
  // Idempotent: a coherent store writes and pushes nothing.
  try { repairSplitProjectNames(); } catch (_) {}
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
      if (cloudMap[id] && toMs(cloudMap[id].updatedAt) >= toMs(legacy[id] && legacy[id].updatedAt)) { delete legacy[id]; dropped++; } // B559: type-safe ts compare (ISO string vs ms)
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
    if (existing && toMs(existing.updatedAt) >= toMs(local.updatedAt)) { skipped++; continue; } // cloud already same/newer (B562: toMs so an ISO-string updatedAt can't NaN the compare and copy an older local over a newer cloud)
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
// B556 — re-export so the planner can tell the thin-clobber baseline "this deliberately-restored
// (possibly thinner) content is authoritative" after an undo/redo/version-restore, so the next push
// isn't falsely rejected as a cross-session conflict. Per-tab + cloud-independent (safe logged out).
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
  const raw = Object.values(readSites());
  // LOUD-FAILURE: migrate() silently drops malformed entries (nulls / points-less husk parcels —
  // the class that error-boundaried the planner on every load). Surface that a stored record
  // needed sanitizing as a telemetry event so corruption is a visible signal, not a quiet edit.
  // (reportClientEvent dedups/rate-caps, so the boot-frequency call path is safe.)
  try {
    const junk = raw.reduce((n, r) => n + countJunkEntries(r), 0);
    if (junk > 0) reportClientEvent("model-sanitized", "dropped malformed collection entries on load", { junk, records: raw.length });
  } catch (_) {}
  // NEW-2 — the list read normalizes every record too, and on a cold boot it is usually the FIRST
  // thing to run the bonded heal. Report from here as well, or the plan-open report below is
  // reached only after the repair has already happened somewhere else.
  const models = raw.map((r) => {
    const watch = bondedHealWatch(r && r.id);
    const m = migrate(r, { onHeal: watch.onHeal });
    watch.flush();
    return m;
  });
  // NEW-1 — a project's name is a DERIVED MIRROR of its group's one authoritative value, so the
  // list read resolves it. This is what stops a group that is split on disk (the Silvestri /
  // Sylvestri case) from ever REACHING the map list as two entries: even before the repair pass
  // has written anything back, every reader sees the group's real name. Pure + identity-preserving
  // on a coherent store, so a healthy list allocates nothing new. `repairSplitProjectNames()` is
  // the persisting half — a read must not write (this runs inside render paths).
  return applyNameAuthority(models).models.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/* Resolve every group's authoritative name across a set of models, reporting any group with no
 * honest winner instead of guessing at one (LOUD-FAILURE). Shared by the list read and the repair
 * pass so both run exactly one rule. Returns { models, changes }. */
function applyNameAuthority(models) {
  const { models: out, changes, ambiguous } = reconcileGroupNames(models);
  for (const a of ambiguous) {
    try {
      reportClientEvent("project-name-ambiguous", "a project's plans disagree on its name and there is no majority — left unchanged", {
        groupId: a.groupId, names: (a.names || []).join(" | "), plans: a.plans,
      });
    } catch (_) {}
  }
  return { models: out, changes };
}
// Every plan belonging to one site (group), newest first.
export function loadPlansOfGroup(groupId) {
  return loadSitesList().filter((s) => groupOf(s) === groupId);
}
// Rename a whole site (location) — updates `site` on every plan in the group. The id may arrive
// as the group id OR as any plan id within it: the map's site list passes a *representative*
// plan's id, which for a multi-plan site is often NOT the group's anchor plan. Resolve to the
// group first — otherwise loadPlansOfGroup(planId) matches nothing, no plan is saved, and the
// rename silently no-ops, reading as the name "reverting" to the old one. (rename-revert)
/* ⛔ NEW-1/NEW-2 — THE ONE RENAME. Every rename entry point (the map list's right-click, the
 * header project dropdown) goes through here, so there is one implementation and not a second to
 * drift.
 *
 * What changed, and why: this used to iterate `loadPlansOfGroup(groupId)` — the LOCAL store — and
 * write each hydrated plan. Any plan not in this browser's localStorage at rename time was never
 * touched, kept the old name in the cloud, and RE-PUBLISHED it the next time it saved. Now the
 * rename is TWO writes with completely different jobs:
 *   • LOCAL, synchronously — stamp `site` + `siteRenamedAt` on the hydrated plans so the UI updates
 *     in the same tick. `saveSite` mirrors the stamp across the rest of the group as they hydrate.
 *   • CLOUD, as ONE statement over the GROUP (`cloudRenameGroup`) — never an enumeration of what
 *     this browser happens to have cached, so it reaches plans this device has never loaded, and
 *     it cannot half-land.
 *
 * Returns a PROMISE of { ok, groupId, name, at, plans, cloud } so the caller can AWAIT the write
 * before refreshing its list and can surface an honest failure. The old function returned nothing
 * and failed silently — which is why the owner only found out by noticing the name had reverted. */
export function renameSiteGroup(idOrGroup, site) {
  const name = typeof site === "string" ? site.trim() : "";
  const rec = loadSite(idOrGroup);
  const groupId = rec ? groupOf(rec) : idOrGroup;
  if (!groupId || !name) return Promise.resolve({ ok: false, groupId, name, error: "A project needs a name." });
  // ONE stamp for the whole rename — every plan the local write and the cloud write touch carries
  // the SAME `siteRenamedAt`, so the group has a single unambiguous "when" and no reader has to
  // fall back to the legacy majority rule again. STRICTLY MONOTONIC rather than a bare Date.now():
  // a second rename inside the same millisecond, or a device whose clock runs slow, would otherwise
  // stamp a genuinely later rename with a number that doesn't beat the one already on the group.
  const localPlans = loadPlansOfGroup(groupId);
  const at = Math.max(Date.now(), maxStampOf(localPlans) + 1);
  localPlans.forEach((s) => saveSite({ id: s.id, site: name, siteRenamedAt: at }));
  if (!activeUser) return Promise.resolve({ ok: true, groupId, name, at, plans: localPlans.length, cloud: { skipped: true } });
  // LOADED ON DEMAND — see lib/cloudRename.js. A rename is rare and user-initiated, so its cloud
  // path (an RPC plus the whole un-migrated-DB degrade) stays off the chunk every page load pays for.
  return import("./cloudRename.js").then((m) => m.cloudRenameGroup(activeUser, groupId, name, at))
    .then((cloud) => ({ ok: !!(cloud && cloud.ok), groupId, name, at, plans: localPlans.length, cloud, error: cloud && cloud.error }))
    .catch((e) => ({ ok: false, groupId, name, at, plans: localPlans.length, error: (e && e.message) || "rename failed" }));
}

/* NEW-3 — REPAIR the projects already split by the old rename, and keep them repaired.
 *
 * Idempotent, same contract as the other repair passes here: it converges every group whose plans
 * disagree onto the group's authoritative name, writes the correction back to the on-device store,
 * and re-pushes the corrected plans so the CLOUD stops carrying the contradiction too (otherwise
 * the stale row is still there to re-publish on its next save). A group with no honest winner —
 * legacy, unstamped, and no majority — is reported and LEFT ALONE rather than guessed at.
 *
 * Runs at boot and after every successful pull. A second run changes nothing: after the first pass
 * every plan already matches its group's authority, so `reconcileGroupNames` produces no changes,
 * nothing is written and nothing is pushed. */
export function repairSplitProjectNames() {
  let raw;
  try { raw = Object.values(readSites()); } catch (_) { return { ok: false, changed: 0 }; }
  if (!raw.length) return { ok: true, changed: 0 };
  // Deliberately reasons over the RAW stored records, not migrated models: the name authority reads
  // only id / groupId / site / siteRenamedAt / updatedAt, all of which a stored record already has,
  // and running the full `migrate()` (which carries the bonded-assembly heal) on every record would
  // make a pass that fires at boot and after every pull needlessly expensive.
  const { models, changes } = applyNameAuthority(raw);
  if (!changes.length) return { ok: true, changed: 0 };
  const byId = new Map(models.map((m) => [m.id, m]));
  for (const c of changes) {
    const m = byId.get(c.id);
    if (!m) continue;
    // skipHistory — a name correction is not a content edit; it should not burn a version snapshot.
    saveSite({ id: m.id, site: m.site, siteRenamedAt: m.siteRenamedAt }, { skipHistory: true });
    reportClientEvent("project-name-reconciled", "a plan's project name disagreed with its project and was converged", {
      id: c.id, groupId: c.groupId, from: c.from, to: c.to, basis: c.basis,
    });
  }
  // Push the corrections so the cloud copy stops contradicting the group as well. Fire-and-forget:
  // the local repair already stands, and the next ordinary save would carry it up regardless.
  if (activeUser) for (const c of changes) pushSiteToCloud(c.id).catch(() => {});
  return { ok: true, changed: changes.length, groups: [...new Set(changes.map((c) => c.groupId))].length };
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
/* ── Recently deleted (NEW-1) ───────────────────────────────────────────────────────────────────
 * A deleted project now goes to a restorable bin for 30 days instead of being destroyed. Because
 * the delete is a soft delete, the `site_elements` cascade never fires — so a restore returns the
 * project WHOLE (every building back), not the gutted slim header the old resurrection produced.
 *
 * The unit here is the PROJECT (a site group), matching how delete is offered in the UI: deleting
 * a project bins every plan in its group, and restoring it brings the whole group back. */
export const DELETED_RETENTION_DAYS = 30;

// Group the cloud's soft-deleted rows into projects. Returns { ok, supported, projects }:
// supported:false = db/sites_soft_delete.sql hasn't run on this DB (there is no bin — deletes are
// still immediate + permanent there), so the caller hides the section rather than showing it empty.
export async function listDeletedProjects() {
  if (!activeUser) return { ok: true, supported: false, projects: [] };
  let r;
  try { r = await cloudDeletedRows(activeUser); } catch (e) { r = { ok: false, supported: true, rows: [], error: (e && e.message) || "" }; }
  if (!r.ok || !r.supported) return { ok: r.ok, supported: !!r.supported, projects: [], error: r.error };
  const by = new Map();
  for (const row of (r.rows || [])) {
    if (!row || !row.id) continue;
    const gid = row.group_id || row.id;
    const e = by.get(gid) || { id: gid, name: null, county: null, ids: [], deletedAt: 0 };
    e.ids.push(row.id);
    if (!e.name) e.name = row.site || row.name || null;
    if (!e.county) e.county = row.county || null;
    const ts = toMs(row.deleted_at);
    if (ts > e.deletedAt) e.deletedAt = ts; // the group's most recent binning drives its position + expiry
    by.set(gid, e);
  }
  const projects = [...by.values()]
    .map((p) => ({ ...p, name: p.name || "Untitled project", expiresAt: p.deletedAt + DELETED_RETENTION_DAYS * 86400000 }))
    .sort((a, b) => b.deletedAt - a.deletedAt);
  return { ok: true, supported: true, projects };
}

// Restore a binned project (every plan in its group). Lifts the local tombstones too — otherwise
// the very guards that keep a delete stuck would suppress the restored rows on the next pull — then
// re-pulls so the project reappears in the list/map immediately. Honest about a partial failure.
export async function restoreDeletedProject(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!activeUser || !list.length) return { ok: false, restored: 0, error: "not signed in" };
  const results = await Promise.all(list.map((id) => cloudRestore(activeUser, id).catch((e) => ({ ok: false, restored: 0, error: (e && e.message) || "restore threw" }))));
  const restored = results.reduce((n, r) => n + ((r && r.restored) || 0), 0);
  for (const id of list) clearRecentlyDeleted(id); // lifts BOTH the per-tab set and the durable tombstone
  await pullCloud(activeUser).catch(() => {});
  const failed = results.find((r) => r && r.ok === false);
  if (restored === 0) return { ok: false, restored: 0, error: (failed && failed.error) || "Nothing was restored — it may already have been permanently removed." };
  return { ok: !failed, restored, error: failed ? failed.error : null };
}

// "Delete forever" — the only user-facing HARD delete. The site_elements cascade firing here is
// correct: this is the point at which permanent destruction was actually asked for.
export async function purgeDeletedProject(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!activeUser || !list.length) return { ok: false, purged: 0, error: "not signed in" };
  const results = await Promise.all(list.map((id) => cloudHardDelete(activeUser, id).catch((e) => ({ ok: false, error: (e && e.message) || "purge threw" }))));
  const failed = results.find((r) => r && r.ok === false);
  const purged = results.filter((r) => r && r.ok !== false).length;
  return { ok: !failed, purged, error: failed ? failed.error : null };
}

// Lazy 30-day purge — runs when the bin is listed. Anything that has sat past the retention window
// is hard-deleted for real. Returns { ok, purged, failed } so the caller can surface a failure.
export async function purgeExpiredDeletedProjects({ days = DELETED_RETENTION_DAYS } = {}) {
  if (!activeUser) return { ok: true, purged: 0, failed: 0 };
  let r;
  try { r = await cloudDeletedRows(activeUser); } catch (_) { return { ok: false, purged: 0, failed: 0 }; }
  if (!r.ok) return { ok: false, purged: 0, failed: 0, error: r.error };
  if (!r.supported) return { ok: true, purged: 0, failed: 0 };
  const cutoff = Date.now() - days * 86400000;
  const expired = (r.rows || []).filter((row) => row && row.id && toMs(row.deleted_at) < cutoff);
  let purged = 0, failed = 0;
  for (const row of expired) {
    const out = await cloudHardDelete(activeUser, row.id).catch(() => ({ ok: false }));
    if (out && out.ok) purged += 1; else failed += 1;
  }
  return { ok: failed === 0, purged, failed };
}

// loadSite returns the canonical Site Model (migrated/normalized); saveSite merges
// the partial onto the existing record and normalizes it back through the schema,
// so storage is a thin persistence layer over the model.
// Per-TAB memory of the updatedAt this tab last loaded/wrote per site. Lets saveSite tell
// "I'm the current writer" (replace — so deletes stick) from "another tab advanced the store
// since I last synced" (fold my change in — so a stale tab can't thin it, B127). Each browser
// tab is its own JS module instance, so this map is naturally per-tab.
const lastSeenAt = {};
/* ---- The LOAD seam of the bonded-assembly invariant, made LOUD (NEW-2) ---------------------
 * `createSiteModel` has re-derived torn bonded children on EVERY read since B1097, and it has done
 * it in SILENCE. That silence is a named cause of this bug family shipping as fixed eight times:
 * the tear happened, the owner saw it, the next open quietly repaired it, and any check that
 * reloaded before it measured saw a clean plan ("looks like it just fixed itself somehow again").
 *
 * So listen to the repair that already runs, rather than re-deriving to look for one — no extra
 * work, and no chance of a detector that disagrees with the healer. It lives HERE, in the storage
 * layer, deliberately: a read at the ROUTE level (the plan list, a group lookup) normalizes the
 * record before the planner ever mounts, so a detector inside the planner can be — and was,
 * measured — outrun by the very repair it exists to report. */
const HEAL_TEAR_TOL_FT = 1;   // mirrors assemblyIntegrity.ASSEMBLY_TEAR_TOL_FT (kept local: this
                              // module must not import a consumer of itself)
/* How far a single repair moved a child, in feet — POSITION or SPAN, whichever is larger (NEW-2).
 * The span half matters because the run repairs (`host-run-side-parking`, `zone-along-len`) report
 * a `run`, not a centre, so a field re-derived from 205 ft to the 260 ft wall it hugs would
 * otherwise be a repair the load seam could not see and therefore could not report. */
const healMoveFt = (h) => {
  const f = h && h.from, t = h && h.to;
  if (!f || !t) return 0;
  const moved = Number.isFinite(f.cx) && Number.isFinite(t.cx)
    ? Math.hypot(t.cx - f.cx, (Number(t.cy) || 0) - (Number(f.cy) || 0)) : 0;
  const ran = Number.isFinite(f.run) && Number.isFinite(t.run) ? Math.abs(t.run - f.run) : 0;
  return Math.max(moved, ran);
};
/* NEW-3 — REPAIRS THAT MOVE NOTHING STILL HAVE TO BE WRITTEN BACK, and the distance test above
 * cannot see them. It was built for a child in the wrong PLACE, where "how far" is both the
 * severity and the proof. The orphaned-wall-pad repair is the other kind: restoring a bonded pad's
 * `sideParkSide` changes its IDENTITY and not one coordinate, and minting the deleted 5 ft sidewalk
 * back into the void ADDS an element that has no previous position to be measured against. Both
 * scored 0 ft, so `wasTorn` came back false and `saveSite` was never called — the repair rendered
 * correctly on the canvas and the stored record kept its wreckage, which is the exact failure mode
 * the comment in `loadSite` below was written about. Measured in a headless check before it shipped,
 * not guessed. So severity here is STRUCTURAL, not metric: these kinds always persist. */
const STRUCTURAL_HEAL_KINDS = new Set(["orphan-pad-retagged", "orphan-pad-strip-restored"]);
const isStructuralHeal = (h) => !!(h && STRUCTURAL_HEAL_KINDS.has(h.kind));
function bondedHealWatch(id) {
  const heals = [];
  return {
    onHeal: (h) => { if (h) heals.push(h); },
    /* Reports what was repaired and RETURNS whether it was a real tear, so the caller can decide to
     * persist the repair. */
    flush() {
      try {
        if (!heals.length) return false;
        const torn = heals.filter((h) => healMoveFt(h) > HEAL_TEAR_TOL_FT);
        // NEW-3 — reported SEPARATELY from the displaced ones, because "N children up to X ft off
        // their host" is simply untrue of a repair that moved nothing, and a message that overstates
        // what happened is how a real signal stops being read.
        const structural = heals.filter(isStructuralHeal);
        if (!torn.length && !structural.length) return false;   // sub-foot drift is housekeeping
        if (torn.length) {
          const items = torn.slice(0, 20).map((h) => ({ id: h.id, host: h.host, type: h.type, kind: h.kind, dist: Math.round(healMoveFt(h) * 1000) / 1000 }));
          const worst = torn.reduce((m, h) => Math.max(m, healMoveFt(h)), 0);
          reportClientEvent("assembly-tear-detected",
            `the stored plan opened with ${torn.length} bonded child(ren) up to ${Math.round(worst)} ft off their host (load)`,
            { id, seam: "load", count: torn.length, worstFt: Math.round(worst * 1000) / 1000, items });
        }
        if (structural.length) {
          const restored = structural.filter((h) => h.kind === "orphan-pad-strip-restored").length;
          reportClientEvent("assembly-orphan-pad-repaired",
            `the stored plan opened with ${structural.length - restored} bonded pad(s) carrying no wall role`
            + (restored ? `; ${restored} deleted sidewalk(s) restored into the void left behind` : "") + " (load)",
            { id, seam: "load", count: structural.length, restored,
              items: structural.slice(0, 20).map((h) => ({ id: h.id, host: h.host, type: h.type, kind: h.kind, side: h.side })) });
        }
        return true;
      } catch (_) { return false; /* telemetry never blocks a read */ }
    },
  };
}
export function loadSite(id, { persistHeal = false } = {}) {
  const all = id ? readSites() : null;
  const rec = all ? all[id] : null;
  if (!rec) return null;
  const watch = bondedHealWatch(id);
  let m = migrate(rec, { onHeal: watch.onHeal });
  const wasTorn = watch.flush();
  // NEW-1 — the single-record read resolves the group's authoritative name too. `pushSiteToCloud`
  // reads through here, so this is what stops a stale on-disk copy being shipped to the cloud with
  // the old name even before the repair pass has written the correction back.
  const authority = resolveNameFor(m, Object.values(all).filter((s) => s && s.id !== id && groupKeyOf(s) === groupKeyOf(m)));
  if (authority) m = { ...m, ...authority };
  lastSeenAt[id] = m.updatedAt || 0; // we are now in sync with the stored copy
  /* NEW-2 — PERSIST the repair when the plan is actually being OPENED.
   * A heal that lives only in memory is precisely why the owner's plan kept "fixing itself" on
   * screen while the STORED copy stayed torn: the canvas is initialised from the already-repaired
   * model, so from React's point of view nothing changed, no autosave fires, and the next reader —
   * another device, the export path, the yield math, the cloud push — reads the wreckage again.
   * Measured in the headless repro: a planted tear rendered correctly and was still on disk, byte
   * for byte, four seconds later.
   * Opt-in, because `loadSite` is also the cheap existence probe behind a dozen route lookups and
   * none of those may write; and gated on a real TEAR, so a healthy plan's `updatedAt` never churns. */
  if (persistHeal && wasTorn) {
    try { saveSite(m); reportClientEvent("assembly-tear-persisted", "the repaired plan was written back to storage", { id }); } catch (_) { /* the in-memory repair still stands */ }
  }
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
  // NEW-1 (hole 3) — the guard also consults the DURABLE tombstone, not just this tab's in-memory
  // set. `recentlyDeleted` is per-tab and cleared on reload, so a SECOND tab in the same browser —
  // or the same tab after a reload — could re-create a deleted row locally, which the next pull
  // then healed straight back into the cloud. A deliberate re-create / re-import still works:
  // clearRecentlyDeleted() lifts both tombstones together.
  if (!existing && (recentlyDeleted.has(partial.id) || (activeUser && partial.id in readSiteTombs(activeUser)))) return false;
  let merged = { ...(existing || {}), ...partial };
  // Cross-tab guard (B127): if the stored record is NEWER than what THIS tab last saw, another
  // tab wrote in between — fold our change ON TOP of the store's content (union) instead of a
  // blind overwrite, so a stale tab can't drop the other tab's work. A single-tab writer always
  // matches (no fold → plain replace → deletes still stick).
  if (existing && (existing.updatedAt || 0) > (lastSeenAt[partial.id] || 0)) {
    merged = mergeSiteContent(createSiteModel(merged), existing); // our scalars + union of content
  }
  if (existing && !skipHistory) snapshotVersion(existing); // back up the prior version before overwriting (rollback safety net, B126); the immediate per-edit write skips this (B458)
  let model = { ...createSiteModel(merged), updatedAt: Date.now() };
  /* ⛔ NEW-1 — THE WRITE CHOKE POINT. A plan may never be written carrying a name that contradicts
   * its own project. Every local write lands here, so enforcing the group's authority at this one
   * spot is what makes "a stale plan hydrating later READS the project name, never re-publishes its
   * own copy over it" true at the STORE — not merely at the reader. It matters because
   * `pushSiteToCloud` reads straight back out of this store: without it, a tab holding a pre-rename
   * model (a CAS conflict self-heal, a late autosave, a second device catching up) writes the old
   * name locally and then ships it to the cloud, undoing a completed rename. That is the exact move
   * that split the owner's project.
   *
   * The record being written VOTES: a genuine rename stamps `siteRenamedAt: Date.now()`, the newest
   * stamp in the group, so it wins and applies. Anything without a newer stamp is corrected. */
  const authority = resolveNameFor(model, Object.values(sites).filter((s) => s && s.id !== model.id && groupKeyOf(s) === groupKeyOf(model)));
  if (authority) model = { ...model, ...authority };
  /* NEW-2 — A CONTENT SAVE MAY NEVER MOVE THE SHARING POINTER, and this is the local half of the
   * rule `siteRowFor` already enforces on the wire (B714). Same reasoning, same failure: the planner
   * holds a model loaded BEFORE a share happened, so its `partial` carries `teamId: null` EXPLICITLY
   * — and an explicit key wins a spread, so an ordinary autosave (or a keepalive flush, or a late
   * debounced write) blanked the mirror the pull had just stamped, putting the indicator back to
   * private seconds after it appeared. So for a record that ALREADY EXISTS the share fields come
   * from the store, never from the caller.
   *
   * A BRAND-NEW record is the deliberate exception, and it is the one legitimate local writer: a new
   * plan is born carrying its team (SitePlannerApp's `defaultShareTeam` / `resolveNewPlanTeam`,
   * B326416), mirroring the INSERT path the Postgres guard leaves open on purpose. Nothing else may
   * set it: the explicit share path writes the COLUMN and the value comes back on the next pull. */
  if (existing) {
    model = withShareMirror(model, {
      teamId: existing.teamId === undefined ? model.teamId : existing.teamId,
      ownerId: existing.ownerId === undefined ? model.ownerId : existing.ownerId,
      shareLocked: existing.shareLocked === undefined ? model.shareLocked : existing.shareLocked,
    });
  }
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
  recentlyDeleted.add(id); // in-tab tombstone so no in-flight flush can resurrect it this session (B372)
  if (activeUser && id) recordSiteTombstone(activeUser, id, Date.now()); // B757 — DURABLE tombstone: survives reload so a failed/offline cloud delete can't resurrect the plan on the next pull
  if (getCurrentSiteId() === id) setCurrentSiteId(null);
  // Return the cloud-removal result so the caller can report an honest failure / no-op (B372).
  // TEAM: cloudDelete scopes by id and lets RLS decide (owner or team-admin) — a regular member
  // can't delete a teammate's shared project; that surfaces as removed:0, and the row re-appears
  // on the next pull rather than being lost.
  return activeUser ? cloudDelete(activeUser, id) : Promise.resolve({ ok: true, skipped: true });
}
export function getCurrentSiteId() { try { return localStorage.getItem(CURRENT_KEY) || null; } catch (_) { return null; } }
export function setCurrentSiteId(id) { try { id ? localStorage.setItem(CURRENT_KEY, id) : localStorage.removeItem(CURRENT_KEY); } catch (_) {} }
