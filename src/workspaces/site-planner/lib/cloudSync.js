/* Cloud sync (Phase 4) — read/write the user's sites in Supabase, RLS-scoped to
 * the signed-in user (each user only ever touches their own rows). The serialized
 * Site Model lives in the `data` jsonb column; a few columns are duplicated for
 * querying. No migration of legacy localStorage sites — cloud is the home for a
 * logged-in user's data; localStorage remains the store when logged out.
 */
import { supabase, supabaseRest, currentAccessToken } from "./supabase.js";
import { casUpsert, keepaliveCasPush, isMissingVersionColumn, isMissingColumn } from "../../../shared/cloud/optimisticUpsert.js";
import { makeWriteSerializer } from "../../../shared/cloud/serializeWrites.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { stableStringify } from "./elementSync.js";
import { normCountyKey } from "../../../shared/gis/countyKeys.js";
import { normalizeRenameStampForWrite } from "./projectName.js";
import { fetchParcelSummaries, fetchElementRecency } from "./elementApi.js";

// Per-tab memory of the `version` we last synced for each site, so a save can be a
// compare-and-swap that REJECTS a stale write instead of silently clobbering (B314).
// Populated by cloudList; advanced on every successful write; cleared on delete / user
// switch. Module-scope = naturally per-tab. Until the `version` column is migrated in,
// every write degrades to a plain upsert (today's behaviour) and this stays empty.
const siteVersions = {};
// B672 recurrence (Observation A) — per-tab memory of the slim-header CONTENT last synced per site,
// so the autosave's header push becomes a no-op when nothing header-side changed. Under element-level
// sync the autosave effect re-runs on EVERY element edit, but the slim header it pushes is byte-
// identical except `updatedAt` — yet each push bumped `sites.version`, invalidating every other open
// tab's CAS token and triggering a silent refetch+re-push heal PER EDIT (the cross-tab version
// ping-pong the Cowork run logged). Skipping content-identical pushes removes the header write from
// the element-edit path entirely. Trade-off (documented in the B-item): `sites.updated_at` now only
// advances on a REAL header change (meta/settings/overlays), not on element edits — element recency
// lives on the site_elements rows.
const lastHeaderSig = {};
export function clearSiteVersions() {
  for (const k of Object.keys(siteVersions)) delete siteVersions[k];
  for (const k of Object.keys(lastHeaderSig)) delete lastHeaderSig[k];
}
export const _siteVersions = siteVersions; // test seam (read/seed in unit tests)
export const _lastHeaderSig = lastHeaderSig; // test seam
// The signature: the slim header exactly as a push would store it, minus the volatile updatedAt.
// Exported for tests and for cloudList's seeding (sig of the row the cloud already has).
export function headerSig(model) {
  const m = slimForCloud(model);
  if (!m) return "";
  const { updatedAt, ...rest } = m;
  return stableStringify(rest);
}
// B672 — the B459 thin-clobber guard (wouldThinClobber + the siteContent/siteTombs baselines +
// noteLocalContent) is RETIRED. It existed to stop a stale tab's whole-doc push from silently
// dropping elements the cloud still had — but under element-level sync the cloud row is a SLIM
// HEADER that deliberately carries NO elements (see slimForCloud below), so every header push would
// read as a "thinning clobber". Element safety now lives where the elements live: per-row rev
// guards in commit_elements (a stale element write is rejected per element, and deletions are
// explicit tombstone rows, never an absence). The 8 South bug class this guarded against cannot
// recur through the header path because the header no longer carries the elements at all.

// Don't push a huge embedded screenshot dataURL into a DB row — keep the underlay
// placement but drop the inline image (map-sourced underlays use a URL, not a
// dataURL, so those are preserved). Geometry/metrics are unaffected.
const isDataUrl = (s) => typeof s === "string" && s.startsWith("data:");
// B672 — the cloud `sites.data` row is now a SLIM HEADER: the 5 vector element collections live
// as individual `site_elements` rows (the element write path, B671) and are STRIPPED here, so the
// header write can't fight the per-element commits. `elementsInRows: true` marks the row as slim —
// the load/merge side (mergePulledSites) uses it to know "no elements here" means "they're in rows",
// never "they were deleted". `deletedIds` rides along untouched (it still serves the header-side
// collections — sheetOverlays/parcelDrawings/crossSections — and the signed-out store).
// Exported for tests.
export function slimForCloud(model) {
  if (!model) return model;
  let m = model;
  const u = m.underlay;
  if (u && isDataUrl(u.src)) m = { ...m, underlay: { ...u, src: null, strippedForCloud: true } };
  // Site-plan overlays (B72) carry a big PNG dataURL raster — keep the placement /
  // transform but drop the inline image for the cloud row (re-add it on another device).
  if (Array.isArray(m.sheetOverlays) && m.sheetOverlays.some((o) => o && isDataUrl(o.src)))
    m = { ...m, sheetOverlays: m.sheetOverlays.map((o) => (o && isDataUrl(o.src) ? { ...o, src: null, strippedForCloud: true } : o)) };
  // Parcel-attached drawings (B67) — same deal: the backdrop raster is a regenerable
  // local cache, so keep the markups + intrinsic dims but drop the inline image for the
  // cloud row (re-attach on another device until Storage-backing lands).
  if (Array.isArray(m.parcelDrawings) && m.parcelDrawings.some((d) => d && isDataUrl(d.src)))
    m = { ...m, parcelDrawings: m.parcelDrawings.map((d) => (d && isDataUrl(d.src) ? { ...d, src: null, strippedForCloud: true } : d)) };
  // Element collections → site_elements rows (B672 read cutover). The header keeps empty arrays
  // (not missing fields) so createSiteModel-normalization of a loaded header stays shape-identical.
  m = { ...m, els: [], markups: [], measures: [], callouts: [], parcels: [], elementsInRows: true };
  // B714 — the sharing pointer never rides the stored jsonb: the `team_id` COLUMN is the single
  // source of truth (set only by the explicit share/unshare flow; overlaid back onto the model by
  // cloudList on every read). A model held in a tab's memory since before a share carries a STALE
  // teamId — embedding it here (and worse, in the row's team_id column, fixed in cloudUpsertCore)
  // is how one ordinary autosave silently un-shared a just-shared project. ownerId is likewise a
  // read-time overlay of the user_id column. Stripping both also keeps headerSig share-neutral.
  // shareLocked joins them (B326417): it is a COLUMN the owner sets through set_plan_lock, and a
  // read-time overlay on the way back. Letting it ride the jsonb would put a second, staler copy of
  // an access decision in the payload — the exact shape of the B714 bug.
  const { teamId: _team, ownerId: _owner, shareLocked: _locked, ...noShare } = m;
  /* ⛔ NEW-1 — THE RENAME MARKER IS NEVER SENT EMPTY, AND THIS IS THE LAST GATE BEFORE THE COLUMN.
   *
   * `siteRowFor` sends this document as `data`, and a cloud write REPLACES the row's whole jsonb.
   * `createSiteModel` normalises an unknown `siteRenamedAt` to an explicit `null` — correct for a
   * model held in memory, catastrophic on the wire: it turns "this device does not know when the
   * project was renamed" into the row-level CLAIM "this project has never been renamed", written
   * straight over the real stamp `rename_site_group()` put there. Measured on production
   * 2026-09-10: 64 of 116 rows carried a present-but-empty marker, and the Silvestri group's plan
   * `sms9c5oc7jnt` had the group's own 2026-07-31 stamp erased by a document write five days
   * later while its four siblings kept it — so `nameAuthority` lost the only fact that lets a
   * rename win a conflict and dropped back to the legacy majority rule.
   *
   * A known stamp still rides (the pre-migration rename fallback in `cloudRename.js` writes one
   * through this same document shape); an unknown one is OMITTED. Omitting is the honest move:
   * the server-side guard (`db/sites_rename_stamp_guard.sql`) can then tell "I have nothing to
   * say about this" apart from "I am telling you it is empty", and keeps what the row already
   * holds. `normalizeRenameStampForWrite` is identity-preserving when there is nothing to change,
   * so `headerSig` (which hashes this same document) does not churn. */
  return normalizeRenameStampForWrite(noShare);
}

// B714 — the column payload an ordinary content push sends (pure; exported for tests). The
// sharing pointer `team_id` is DELIBERATELY absent from updates: a content save must never be
// able to change who a project is shared with (an open tab's in-memory model predates any share
// made after it loaded — pushing its stale teamId is exactly how a fresh share got silently
// reverted to private, locking the collaborator out). team_id changes ONLY through the explicit
// share/unshare flow (lib/sharing.js updates the column directly; the DB rehome-guard trigger
// enforces owner-only). The single exception: a brand-new row (isNew) stamps the model's teamId
// so a new plan created inside a shared project is born shared, not private.
export function siteRowFor(m, { isNew = false, teamId = null } = {}) {
  const row = {
    id: m.id,
    // NEW-4 — the `county` COLUMN is normalised on the way out too, not just the model field.
    // `createSiteModel` already normalises what the app holds, but a row can also be written from
    // a header-only path that never round-tripped the model; this is the last gate before the
    // column, so no new mixed-case row can be created from this client whatever route it took.
    group_id: m.groupId || null, site: m.site || null, name: m.name || null, county: normCountyKey(m.county),
    updated_at: new Date(m.updatedAt || Date.now()).toISOString(),
    data: m,
  };
  if (isNew) row.team_id = teamId || null;
  return row;
}

// B529: serialize cloud writes per site id so a tab can't race ITSELF (debounced autosave + a
// visibility/unmount/manual flush firing together) into a false self-conflict. A second write
// for an id waits for the in-flight one, so it reads the version that write threaded back into
// `siteVersions` (and the content baseline rememberContent() set) → the CAS + thin-clobber guard
// both see fresh state. The genuine cross-device guard in casUpsert is untouched.
const serializeSiteWrite = makeWriteSerializer();
export function cloudUpsert(uid, model) {
  if (!model || !model.id) return cloudUpsertCore(uid, model); // no id → nothing to serialize on; core returns the error
  return serializeSiteWrite(model.id, () => cloudUpsertCore(uid, model));
}

async function cloudUpsertCore(uid, model, isRetry) {
  if (!supabase || !uid || !model || !model.id) return { ok: false, error: "not ready" };
  const m = slimForCloud(model);
  // B672 recurrence (Observation A) — identical header content already synced → skip the write
  // entirely (see lastHeaderSig above). Only when a version token exists (a prior sync happened
  // and CAS is live); pre-migration/degrade DBs keep today's always-push behavior.
  const sig = headerSig(model);
  if (!isRetry && lastHeaderSig[m.id] === sig && siteVersions[m.id] != null) return { ok: true, skipped: true };
  // Row carries NO user_id — casUpsert stamps the creator only on INSERT, so a teammate editing
  // a shared row never re-stamps the original owner (team feature).
  const row = siteRowFor(m, { isNew: siteVersions[m.id] == null, teamId: model.teamId });
  // Optimistic concurrency (B314): a conditional write guarded by the version we last synced.
  let r = await casUpsert(supabase, "sites", { uid, id: m.id, row, expected: siteVersions[m.id] });
  // Graceful degrade if the team_id column isn't migrated in yet (db/team_sharing.sql not run):
  // retry the SAME guarded write without it, so saving never regresses before sharing is enabled.
  if (r && r.ok === false && r.error && isMissingColumn(r.error, "team_id")) {
    const { team_id, ...noTeam } = row;
    r = await casUpsert(supabase, "sites", { uid, id: m.id, row: noTeam, expected: siteVersions[m.id] });
  }
  if (r.ok) { siteVersions[m.id] = r.version; lastHeaderSig[m.id] = sig; return { ok: true }; }
  if (r.conflict) {
    // B672 — a stale header write self-heals SILENTLY: refresh the CAS token from the live row and
    // re-push ONCE (whole-header last-write-wins — the header is rarely-contended meta/settings/
    // overlays; the elements it used to carry are per-row rev-guarded in site_elements now). The
    // old loud "changed in another session → Take over editing" banner class (B455/B460/B558/B596)
    // is retired BY ARCHITECTURE — there is no whole-doc payload left to fight over. If the retry
    // ALSO conflicts (a live write race), report + bail; the next autosave push heals it.
    if (!isRetry) {
      const fresh = await fetchSiteForReconcile(uid, m.id); // refreshes siteVersions[m.id]
      if (fresh !== null || siteVersions[m.id] != null) {
        reportClientEvent("cloud-conflict-healed", "stale header CAS → refetched version, re-pushing (sites)", { id: m.id });
        return cloudUpsertCore(uid, model, true);
      }
    }
    reportClientEvent("cloud-conflict", "stale write rejected twice (sites CAS)", { id: m.id, reason: "cas-409", expected: siteVersions[m.id] });
    return { ok: false, conflict: true };
  }
  if (r.degrade) {
    // The `version` column isn't migrated in yet → fall back to a plain upsert (today's
    // last-write-wins). Target the live single-column PK "id" (post db/team_sharing.sql);
    // only if THAT 42P10s on a genuinely pre-migration DB (still composite (user_id, id))
    // do we retry the old target. Mirrors upsertFileFacts' id-first→composite fallback so a
    // version-less DB never breaks saving regardless of which PK it's on. team_id is dropped
    // (the column may be un-migrated too). Saving is never blocked by an un-migrated feature.
    const { team_id, ...noTeam } = row;
    let { error } = await supabase.from("sites").upsert(noTeam, { onConflict: "id" });
    if (error && /on conflict|no unique|constraint|exclusion/i.test(error.message || "")) // pre-PK-change DB: target is (user_id,id)
      ({ error } = await supabase.from("sites").upsert({ ...noTeam, user_id: uid }, { onConflict: "user_id,id" }));
    if (!error) lastHeaderSig[m.id] = sig;
    return { ok: !error, error: error ? error.message : null };
  }
  reportClientEvent("cloud-write-failed", (r.error || "cloud write failed") + " (sites)", { id: m.id });
  return { ok: false, error: r.error || "cloud write failed" };
}

// Keepalive cloud push for a forced reload (B452): a guarded, fire-and-forget write that
// survives the navigation, so the last edits don't sit only in memory + the local mirror
// until the next load. Version-guarded (keepaliveCasPush) so it can never clobber a newer
// row; skips a brand-new site (no synced version) — the local save + boot merge cover that.
// Returns true if a request was dispatched.
export function keepaliveCloudPush(uid, model) {
  if (!supabase || !uid || !model || !model.id) return false;
  // Header content unchanged since the last synced push → nothing to save on unload (the element
  // keepalive handles element edits). Same skip rule as cloudUpsertCore (Observation A).
  if (lastHeaderSig[model.id] === headerSig(model) && siteVersions[model.id] != null) return false;
  const { url, anon } = supabaseRest();
  const token = currentAccessToken();
  const m = slimForCloud(model); // slim header (B672) — elements ride the element keepalive instead
  // No user_id in the PATCH body (a guarded UPDATE must not re-stamp the creator) and no team_id
  // (B714 — the keepalive is always an update; a stale teamId here could silently unshare).
  const row = siteRowFor(m);
  return keepaliveCasPush({ url, anon, token, table: "sites", id: m.id, row, expected: siteVersions[m.id] });
}

// B480 — reconcile ONE site from the cloud for "Take over editing here": fetch its current row + version
// and refresh the per-tab optimistic-version token (`siteVersions[id]`) so the caller's next push lands at
// the right version instead of a stale-version conflict, then return the cloud's stored model so the caller
// can UNION it into the live canvas (nothing lost from either side). Deliberately a single-row fetch —
// unlike pullCloud it has NO toPush side effect, so it can't race the caller's own push and re-trigger the
// very conflict take-over is resolving. Returns the stored model, or null on any failure (offline / absent).
export async function fetchSiteForReconcile(uid, id) {
  if (!supabase || !uid || !id) return null;
  let r = await supabase.from("sites").select("data, version").eq("id", id).maybeSingle();
  if (r.error && isMissingVersionColumn(r.error)) r = await supabase.from("sites").select("data").eq("id", id).maybeSingle();
  if (r.error || !r.data || !r.data.data) return null;
  if (r.data.version != null) siteVersions[id] = r.data.version; // refresh the CAS token → the next push isn't a false stale-version conflict
  return r.data.data;
}

// Pure: turn a DELETE … .select() result into a typed outcome (exported for unit tests).
//   { ok:false, error }    → the delete errored (network / permission) — the caller surfaces it
//                            LOUDLY because the row may survive server-side and reappear on reload.
//   { ok:true, removed:0 } → no row matched: it was already gone, OR an ownership/RLS mismatch
//                            blocked it. The goal (the row's absence) still holds, so this is NOT
//                            an error — but we report removed:0 so a caller can tell "actually
//                            removed a row" from "there was nothing to remove" (a plain `.delete()`
//                            reports success either way, which is the silent no-op this fixes).
//   { ok:true, removed:N } → N rows removed.
export function interpretDelete(rows, error) {
  if (error) return { ok: false, error: error.message || "delete failed" };
  return { ok: true, removed: Array.isArray(rows) ? rows.length : 0 };
}

/* NEW-1 — deleting a site is a SOFT delete: stamp `deleted_at` instead of hard-DELETEing the row.
 *
 * Two things this buys, both of which the old hard delete got wrong:
 *   1. The delete becomes a FACT EVERY CLIENT CAN READ. A client-local tombstone lives in one
 *      browser's localStorage, so a second signed-in client saw only "the cloud doesn't have this
 *      row", read that as "a push that didn't land", and heal-the-split re-pushed it (the
 *      resurrection bug). `cloudDeletedRows` below hands the merge the server's deleted ids, so
 *      absence and deletion stop being the same signal.
 *   2. The ELEMENTS SURVIVE. `site_elements_site_id_fkey` is ON DELETE CASCADE — a hard delete
 *      destroyed every element row, so the resurrected project came back GUTTED (slim header,
 *      zero buildings). No cascade fires on an UPDATE, so a restore returns the site whole.
 *
 * Honesty semantics are unchanged (B372): `.select("id")` means a 0-row no-op (RLS/ownership
 * mismatch — the row survives) stays DISTINGUISHABLE from a real removal, and both the error and
 * the zero-row cases stay loud. Scope by id only and let RLS decide who may act (own row, or a
 * team member on a shared row) — a user_id filter would block a permitted team delete.
 *
 * Pre-migration DBs (db/sites_soft_delete.sql not run) degrade to the old immediate hard delete,
 * so deleting never regresses before the migration lands. */
/* B1303824 — the GROUP-level counterpart to cloudDelete above, used ONLY when this device's local
 * cache holds NO plan at all for a project it is being asked to delete (storage.js's
 * deleteSiteGroup falls back to this the moment `loadPlansOfGroup` comes back empty).
 *
 * A project can be VISIBLE in the switcher — the light summary reader, or the `withCurrentProject`
 * synthesized "the project you're standing in" row — while this browser's local cache has never
 * actually cached a single plan for it: created on another device/session, or a cloud pull that
 * hasn't landed here yet. The old deleteSiteGroup took an empty local plan list as proof there was
 * nothing to delete and returned a clean `{ok:true, removed:0}` with ZERO network traffic — a real,
 * live cloud project read as "deleted" in the UI and never actually moved (owner report: two
 * projects, `deleted_at` never touched, only GET traffic on the wire across three attempts).
 *
 * Mirrors cloudCheckDeleted's two-query shape — `id = groupId` catches the anchor plan (or a
 * legacy pre-groupId row), `group_id = groupId` catches every sibling — rather than a single
 * `.or()` filter expression built from opaque id values. */
export async function cloudDeleteGroup(uid, groupId) {
  if (!supabase || !uid || !groupId) return { ok: true, removed: 0, skipped: true };
  const stamp = new Date().toISOString();
  try {
    const [byId, byGroup] = await Promise.all([
      supabase.from("sites").update({ deleted_at: stamp }).eq("id", groupId).select("id"),
      supabase.from("sites").update({ deleted_at: stamp }).eq("group_id", groupId).select("id"),
    ]);
    const error = byId.error || byGroup.error;
    if (error) {
      if (isMissingColumn(error, "deleted_at")) return { ok: true, exists: true, deleted: false, removed: 0 }; // pre-migration DB — nothing this fallback can safely do
      reportClientEvent("cloud-write-failed", "group soft delete failed (sites)", { groupId, error: error.message || "" });
      return { ok: false, error: error.message || "delete failed" };
    }
    const ids = new Set();
    for (const r of [...(byId.data || []), ...(byGroup.data || [])]) if (r && r.id) ids.add(r.id);
    if (!ids.size) {
      reportClientEvent("delete-zero-rows", "group soft delete matched no rows (sites)", { groupId });
      return { ok: true, removed: 0 };
    }
    for (const id of ids) { delete siteVersions[id]; delete lastHeaderSig[id]; }
    return { ok: true, removed: ids.size };
  } catch (e) {
    reportClientEvent("cloud-write-failed", "group delete threw (sites)", { groupId, error: (e && e.message) || "" });
    return { ok: false, error: (e && e.message) || "delete threw" };
  }
}

export async function cloudDelete(uid, id) {
  // Nothing to remove server-side (logged out / unconfigured) is success, not a failure to alarm on.
  if (!supabase || !uid || !id) return { ok: true, removed: 0, skipped: true };
  delete siteVersions[id]; // stop tracking a removed row's version
  delete lastHeaderSig[id];
  try {
    // Deliberately does NOT touch `version` or `team_id`: the soft delete must not invalidate
    // another tab's CAS token (an ordinary content push carries no `deleted_at` key, so it can't
    // un-bin the row either) and must not trip the `guard_team_rehome` BEFORE UPDATE trigger.
    const { data, error } = await supabase.from("sites")
      .update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error && isMissingColumn(error, "deleted_at")) return cloudHardDelete(uid, id); // un-migrated DB → old behavior
    const out = interpretDelete(data, error);
    // B468/NEW-5 — a delete that errored, or matched ZERO rows (RLS/ownership mismatch → the row
    // survives and reappears on reload), is exactly the kind of silent failure we want traceable.
    if (out.ok === false) reportClientEvent("cloud-write-failed", "soft delete failed (sites)", { id, error: out.error });
    else if (out.removed === 0) reportClientEvent("delete-zero-rows", "soft delete matched no rows (sites)", { id });
    return out;
  } catch (e) {
    reportClientEvent("cloud-write-failed", "delete threw (sites)", { id, error: (e && e.message) || "" });
    return { ok: false, error: (e && e.message) || "delete threw" };
  }
}

/* The REAL row removal. Only two callers: the pre-migration degrade above, and the 30-day purge /
 * "Delete forever" out of Recently deleted. The `site_elements` cascade firing here is correct —
 * at this point the user (or the expiry) has asked for permanent destruction.
 *
 * ⛔ NEW-1 (B843792 adversarial review) — `comps_project_id_fkey` is `ON DELETE SET NULL`, so this
 * DELETE can silently sever a Leasing Comp's link to its owning site with nothing recording that
 * it happened — a bare FK side effect, which is exactly what LOUD-FAILURE (root CLAUDE.md) exists
 * to close. This is NOT prevented (a purge is genuinely permanent, and the link genuinely cannot
 * survive it — see storage.js's own header on why binning alone must NOT touch project_id) — it is
 * RECORDED: a best-effort count of live comps still pointing at this row is taken BEFORE the
 * delete and reported via telemetry after a successful one, so a severed link is a discoverable
 * fact (client_errors) rather than invisible. The count is RLS-scoped to whatever this caller can
 * already see (comps' own SELECT policy — own rows + shared-team rows), so a comp outside that
 * visibility can undercount here; the DETACH ITSELF is unaffected either way, since the FK acts on
 * the row regardless of who is watching. */
export async function cloudHardDelete(uid, id) {
  if (!supabase || !uid || !id) return { ok: true, removed: 0, skipped: true };
  delete siteVersions[id];
  delete lastHeaderSig[id];
  let linkedComps = 0;
  try {
    const { count } = await supabase.from("comps").select("id", { count: "exact", head: true }).eq("project_id", id).is("deleted_at", null);
    linkedComps = count || 0;
  } catch (_) { /* best-effort — never blocks the delete itself */ }
  try {
    const { data, error } = await supabase.from("sites").delete().eq("id", id).select("id");
    // B1517888 — `db/sites_block_delete_live_group.sql`'s BEFORE DELETE trigger refuses this
    // (errcode 'PLYR1') when the row's project group still has a live sibling, or when the row
    // was never soft-deleted. That refusal is EXPECTED to fire from a stale/unfixed tab (the
    // whole point of the server-side guard is that it can't be skipped) — surface it as its own
    // named, human-readable reason rather than a generic "delete failed", so the caller's
    // existing failure toast (`"…couldn't be permanently deleted"`) tells the truth about why.
    if (error && error.code === "PLYR1") {
      reportClientEvent("purge-blocked-live-group", "hard delete refused server-side — project group still has a live plan", { id, error: error.message || "" });
      return { ok: false, removed: 0, error: "This plan's project still has another active plan — it can't be permanently deleted while any of them are live." };
    }
    const out = interpretDelete(data, error);
    if (out.ok === false) reportClientEvent("cloud-write-failed", "delete failed (sites)", { id, error: out.error });
    else if (out.removed === 0) reportClientEvent("delete-zero-rows", "delete matched no rows (sites)", { id });
    else if (linkedComps > 0) reportClientEvent("comp-project-detached-by-purge", `${linkedComps} comp(s) lost their site link — the site they pointed to was permanently deleted`, { id, count: linkedComps });
    return out;
  } catch (e) {
    reportClientEvent("cloud-write-failed", "delete threw (sites)", { id, error: (e && e.message) || "" });
    return { ok: false, error: (e && e.message) || "delete threw" };
  }
}

/* Lift a site out of Recently deleted. Rides the same UPDATE policy the soft delete does. Returns
 * { ok, restored } — restored:0 means nothing matched (already purged, or an RLS mismatch), which
 * the caller surfaces rather than reporting a phantom success. */
export async function cloudRestore(uid, id) {
  if (!supabase || !uid || !id) return { ok: false, restored: 0, error: "not signed in" };
  const { data, error } = await supabase.from("sites")
    .update({ deleted_at: null }).eq("id", id).select("id");
  const restored = Array.isArray(data) ? data.length : 0;
  if (error) reportClientEvent("cloud-write-failed", "restore failed (sites)", { id, error: error.message });
  return { ok: !error && restored > 0, restored, error: error ? error.message : null };
}

/* Every soft-deleted row this user can see — the "Recently deleted" bin AND, critically, the
 * server-deleted id set `mergePulledSites` needs so a cloud-absent row can be told apart from a
 * cloud-DELETED one. Slim projection (no `data` jsonb) so this stays cheap on every pull.
 *
 * Returns { ok, supported, rows }:
 *   ok:false            → the fetch genuinely failed. The caller must NOT heal cloud-absent rows
 *                         this pull (it can't tell "never landed" from "deleted") — fail safe.
 *   supported:false     → db/sites_soft_delete.sql hasn't run. Nothing is ever soft-deleted on
 *                         this DB, so healing stays safe (the durable local tombstones + their
 *                         grace window are the guard there).                                    */
export async function cloudDeletedRows(uid) {
  if (!supabase || !uid) return { ok: true, supported: false, rows: [] };
  const { data, error } = await supabase.from("sites")
    .select("id, group_id, site, name, county, updated_at, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) {
    if (isMissingColumn(error, "deleted_at")) return { ok: true, supported: false, rows: [] };
    return { ok: false, supported: true, rows: [], error: error.message || "deleted list failed" };
  }
  return { ok: true, supported: true, rows: data || [] };
}

/* NEW-2 (soft-deleted project stays open) — the one question a deep link into a project route
 * needs answered before it mounts a workspace: is THIS PROJECT soft-deleted, and does it exist at
 * all. A Planyr "project" is every plan row sharing a `group_id` (`groupProjects` in
 * projectModel.js), never the single row whose `id` happens to equal the group id — that row is
 * merely the ANCHOR, the plan the project was originally created from, and `id` is used as the
 * `groupId` fallback (`storage.js`'s `groupId: p.groupId || p.id`).
 *
 * ⛔ B1164192 (owner report 2026-09-07, "Richfield" reads as deleted) — this used to be a
 * SINGLE-ROW `.eq("id", id).maybeSingle()` lookup, so soft-deleting the anchor alone (e.g. after a
 * "duplicate and rename" — the original is deleted once its copy exists) made the WHOLE PROJECT
 * read as deleted at the route gate, even with every sibling plan live and unaffected. Measured
 * live on production: exactly two of the owner's projects carry this shape (an anchor row
 * soft-deleted with live siblings still in its group) — "Richfield" (group `smsdrvzr9gzx`, 3 live
 * plans) and "Woods Road" (group `smsrpaiqu5sv`, 6 live plans, a shared TEAM project) — and no
 * other account in the whole `sites` table does. Both are pre-existing data, not new damage; this
 * function's single-row design is what mis-READ them as deleted, not a write that deleted anything.
 *
 * Fixed by asking about the whole GROUP: a project is deleted only when EVERY plan row it has is
 * soft-deleted. Two queries rather than one `.or()` string (id/group_id values are opaque —
 * building a filter EXPRESSION out of them is unnecessary risk for a check that isn't hot):
 * `id = id` catches the anchor itself (including a legacy pre-groupId row whose `group_id` column
 * is still null) and a caller that names one specific plan directly; `group_id = id` catches every
 * sibling, including when the anchor row has been HARD-deleted and no row named `id` exists at all
 * any more. Deliberately still not `cloudDeletedRows` (the whole-account bin scan) — this stays two
 * indexed lookups scoped to one group, not an unbounded account-wide read on every navigation.
 *
 * Returns { ok, exists, deleted, deletedAt, name, groupId }:
 *   ok:false   → the check itself failed (offline, signed out, RLS, a thrown error) — the caller
 *                MUST fail OPEN (never block a route on an inconclusive answer; STANDING RULE —
 *                a hard gate needs a POSITIVE fact, not the absence of one).
 *   exists:false → no row matched this id (as its own id OR as a sibling's group_id) for this user
 *                  at all — a DIFFERENT state from `deleted:true`, so a caller can tell "there's
 *                  nothing here" from "this was here and got removed".
 *   deleted:true → EVERY plan row found is soft-deleted; `deletedAt` is the most recent deletion in
 *                  the group, `name`/`groupId` come from that same row, so a caller can offer a
 *                  restore without a second round trip. A single LIVE row anywhere in the group is
 *                  enough to answer `deleted:false` — that is the whole fix. */
export async function cloudCheckDeleted(uid, id) {
  if (!supabase || !uid || !id) return { ok: false, exists: false, deleted: false };
  try {
    const cols = "id, group_id, site, name, deleted_at";
    const [byId, byGroup] = await Promise.all([
      supabase.from("sites").select(cols).eq("id", id),
      supabase.from("sites").select(cols).eq("group_id", id),
    ]);
    const error = byId.error || byGroup.error;
    if (error) {
      if (isMissingColumn(error, "deleted_at")) return { ok: true, exists: true, deleted: false };
      return { ok: false, exists: false, deleted: false, error: error.message || "deletion check failed" };
    }
    const rows = new Map();
    for (const r of [...(byId.data || []), ...(byGroup.data || [])]) if (r && r.id) rows.set(r.id, r);
    const all = [...rows.values()];
    if (!all.length) return { ok: true, exists: false, deleted: false };
    const live = all.find((r) => !r.deleted_at);
    if (live) {
      return { ok: true, exists: true, deleted: false, deletedAt: null, name: live.site || live.name || null, groupId: live.group_id || live.id };
    }
    // Every plan row THIS QUERY found is soft-deleted — surface the most recently deleted one (the
    // one whose facts a "restore" offer would want). `name` stays the PROJECT name (`site`) here —
    // this branch is reached when `id` IS the group's anchor (or the row's own id, for a
    // single-plan project), so `byGroup` above already gathered every sibling and "every plan row
    // found" really does mean the whole project. `planName` is carried separately (the row's own
    // `name` column) for a caller that needs to tell the two apart — see `checkProjectDeletionStatus`
    // in storage.js, which asks a SECOND question when `id` instead named one non-anchor plan
    // inside an otherwise-live project (B1482000, follow-on to B1469872).
    const newest = all.reduce((a, b) => ((Date.parse(b.deleted_at) || 0) > (Date.parse(a.deleted_at) || 0) ? b : a));
    return {
      ok: true, exists: true, deleted: true,
      deletedAt: newest.deleted_at || null, name: newest.site || newest.name || null,
      planName: newest.name || null, groupId: newest.group_id || newest.id,
    };
  } catch (e) {
    return { ok: false, exists: false, deleted: false, error: (e && e.message) || "deletion check threw" };
  }
}

/* NEW-1/NEW-2 — the project-rename cloud write lives in `cloudRename.js` and is reached ONLY by a
 * dynamic import from `storage.renameSiteGroup`.
 *
 * A rename is a rare, deliberate, user-initiated action, so its code has no business on the boot
 * path — the same reason `exportSheet.js` and `rasterIdentifyLazy.js` are split out. It needs the
 * per-tab CAS bookkeeping below, which is why those two maps are exported as `_siteVersions` /
 * `_lastHeaderSig` rather than being duplicated: after a group-wide rename the server has bumped
 * `version` on every row it touched, so a tab holding the pre-rename token would take a needless
 * conflict on its next ordinary content push. */

// Every site row the signed-in user can see — their own PLUS any shared with a team they're
// in (RLS decides). Returns the array of serialized Site Models (the `data` column), records
// each row's `version` for the next compare-and-swap (B314), and overlays the authoritative
// team_id / owner (user_id) columns onto each model so the UI can show "shared / owned by".
export async function cloudList(uid) {
  if (!supabase || !uid) return [];
  // NEW-1 — soft-deleted rows are NOT live projects: filter them out here so a binned site never
  // reaches the merge, the list, or the map. The filter is dropped on a pre-migration DB (no
  // deleted_at column), where nothing can be soft-deleted anyway.
  const live = (q) => q.is("deleted_at", null);
  // NEW-1 — `id` (the row's real PostgREST primary key) is selected alongside `data` at every
  // tier below, so the read side can tell a healthy row from one whose jsonb `id` has drifted
  // from its own identity — see the correction loop after the fallback ladder. `id` has been a
  // real column since day one (unlike team_id/version/share_locked, which are migrations that
  // may not have run yet), so it needs no fallback rung of its own.
  let { data, error } = await live(supabase.from("sites").select("id, data, version, team_id, user_id, share_locked")).order("updated_at", { ascending: false });
  if (error && isMissingColumn(error, "deleted_at"))
    ({ data, error } = await supabase.from("sites").select("id, data, version, team_id, user_id, share_locked").order("updated_at", { ascending: false }));
  // Pre-migration fallbacks: team_id (db/team_sharing.sql) then version (db/optimistic_concurrency.sql)
  // may not exist yet → re-select with fewer columns so loading never breaks before they're run.
  // Each tier re-applies the deleted_at filter (and drops it the same way if that column is absent).
  // B326417 — share_locked (db/team_share_default.sql) is the newest column, so it gets the first
  // fallback rung: drop only it and keep the sharing columns, which are an older migration.
  if (error && isMissingColumn(error, "share_locked")) {
    ({ data, error } = await live(supabase.from("sites").select("id, data, version, team_id, user_id")).order("updated_at", { ascending: false }));
    if (error && isMissingColumn(error, "deleted_at"))
      ({ data, error } = await supabase.from("sites").select("id, data, version, team_id, user_id").order("updated_at", { ascending: false }));
  }
  if (error && isMissingColumn(error, "team_id")) {
    ({ data, error } = await live(supabase.from("sites").select("id, data, version")).order("updated_at", { ascending: false }));
    if (error && isMissingColumn(error, "deleted_at"))
      ({ data, error } = await supabase.from("sites").select("id, data, version").order("updated_at", { ascending: false }));
  }
  if (error && isMissingVersionColumn(error)) {
    ({ data, error } = await live(supabase.from("sites").select("id, data")).order("updated_at", { ascending: false }));
    if (error && isMissingColumn(error, "deleted_at"))
      ({ data, error } = await supabase.from("sites").select("id, data").order("updated_at", { ascending: false }));
  }
  // THROW on a real fetch error so callers can tell it apart from a genuinely-empty
  // result. Returning [] here let `pullCloud` wipe the local cache to empty on a
  // transient/offline error, showing a scary "no sites" state (B54).
  if (error) throw new Error(error.message || "cloud list failed");
  const rows = data || [];
  /* NEW-1 — THE ROW'S REAL PRIMARY KEY IS AUTHORITATIVE OVER WHATEVER ID IS EMBEDDED IN ITS
   * JSONB `data`. Under every normal write path (siteRowFor: `row = { id: m.id, ... }`) the two
   * are kept in lockstep, so this is a no-op for a healthy row. But `mergePulledSites` keys its
   * ENTIRE merge map on the jsonb-embedded id (`map[n.id] = ...`) — before this fix that field
   * was never checked against anything, so two DIFFERENT physical rows whose jsonb happened to
   * carry the same `id` (a stale duplicate, a hand-edited row, a migration slip — cloudList
   * never even fetched the row's own PK to catch it) silently collapsed to ONE surviving plan
   * in the map, with no error anywhere: exactly the shape of "the database has 5 rows, the app
   * shows fewer." Correct it here, at the read boundary — the same pattern B714 already uses to
   * overlay DB-column truth (team_id/user_id/share_locked) onto the jsonb rather than trusting
   * it wholesale — and report it loudly (LOUD-FAILURE): a jsonb id drifting from its row is a
   * genuine data anomaly worth surfacing even though this heals it in place. */
  for (const r of rows) {
    if (r && r.data && r.id != null && r.data.id !== r.id) {
      reportClientEvent("cloud-id-mismatch", "a site row's jsonb id disagreed with its own primary key — corrected to the row's id", { rowId: r.id, jsonId: r.data.id });
      r.data.id = r.id;
    }
  }
  for (const r of rows) if (r && r.data && r.data.id != null) {
    if (r.version != null) siteVersions[r.data.id] = r.version;
  }
  return rows.map((r) => {
    const m = r && r.data;
    if (!m) return null;
    if (r && "team_id" in r) m.teamId = r.team_id || null;   // DB column is the source of truth for sharing
    if (r && "user_id" in r) m.ownerId = r.user_id || null;  // who created/owns it (for "owned by teammate")
    if (r && "share_locked" in r) m.shareLocked = !!r.share_locked; // B326417 — owner's view-only lock
    /* NEW-2 — stamp the mirror EXPLICITLY, so the merge can tell "the cloud says private" (team_id
     * present and null) from "the cloud did not say" (pre-migration DB, no such column). Overlaying
     * the three fields above is not enough on its own: `mergePulledSites` folds this row against the
     * local cache with `mergeSiteContent`, which picks scalars from whichever copy has the newer
     * `updatedAt` — and the local copy is routinely newer (B458's mirror write), so the authority
     * read here was being thrown away again one function later. `shareMirror` is NOT a Site Model
     * field: createSiteModel drops it, so it can never be persisted or pushed back as a second copy
     * of an access decision (B714). */
    if (r && "team_id" in r) m.shareMirror = { teamId: r.team_id || null, ownerId: r.user_id || null, shareLocked: !!r.share_locked };
    // Seed the header-content baseline from what the cloud ALREADY has (post-overlay, so it matches
    // the shape a local push would send). If the local copy turns out identical, even the boot
    // re-push skips — no per-load version churn. Any real local difference still pushes.
    if (r.version != null && m.id != null) { try { lastHeaderSig[m.id] = headerSig(m); } catch (_) {} }
    return m;
  }).filter(Boolean);
}

// NEW-1 (first-time landing, src/app/firstLanding.js) — "does this account have ANY live
// project ANYWHERE it can see" for the boot-time Map/Dashboard decision. Deliberately NOT
// `(await cloudList(uid)).length > 0`: that fetches every row's full jsonb `data` payload and
// normalizes it into a Site Model, none of which this needs — a head-only count costs nothing
// on the wire and RLS still scopes it to the user's own rows PLUS anything shared with a team
// they're in, exactly like cloudList. Throws on a real fetch error (never swallows it to
// `false`) so a transient/offline failure can't misread a real returning account as a
// first-timer — see firstLanding.js's own safe-default catch.
export async function hasAnyLiveSites(uid) {
  if (!supabase || !uid) return false;
  let { count, error } = await supabase.from("sites").select("id", { count: "exact", head: true }).is("deleted_at", null);
  if (error && isMissingColumn(error, "deleted_at"))
    ({ count, error } = await supabase.from("sites").select("id", { count: "exact", head: true }));
  if (error) throw new Error(error.message || "cloud existence check failed");
  return !!count;
}

// B849344 — the network half of "does this site have a boundary, and how big is it" (the Sites
// panel + the map pin — see MapFinder.jsx's siteBoundaryInfo). `cloudList` above returns each
// site's SLIM HEADER, whose `parcels` field has been empty since the B672 element-sync cutover;
// the real geometry lives in `site_elements` rows, fetched here in one request. Returns
// { ok, rows, error } — the caller (SitePlannerApp.jsx) dissolves per site via
// parcelSummary.summarizeParcelRows. Deliberately NOT done here: this module is reachable from
// the app SHELL's eager import graph (Shell.jsx/projects.js → storage.js → here, for every
// route, not just Site Planner), and summarizeParcelRows pulls in polyClip.js's clipper-lib —
// one of vite.config.js's MAP_VENDOR packages. Importing it from here once dragged the whole
// map-vendor chunk into every route's shared bundle (measured: the Notes route's JS jumped
// +323 KB, tripping its bundle budget) — exactly the merge trap vite.config.js's own header
// comment warns about. Keep the geometry math on the Site Planner side of the lazy-chunk
// boundary, where MapFinder.jsx already needs clipper-lib and pays for it once.
export async function cloudParcelRows(uid) {
  if (!supabase || !uid) return { ok: false, rows: [] };
  return fetchParcelSummaries(supabase);
}

// B845089 (NEW-2) — the network half of "when was this project last actually edited" (see
// MapFinder.jsx's Sites-panel column + lib/siteRecency.js). Same reasoning as cloudParcelRows
// above for staying a thin pass-through: this module is on the app shell's eager import graph, so
// the aggregation (summarizeElementRecency/groupRecencyMs) stays on the Site Planner side of the
// lazy-chunk boundary, where MapFinder.jsx already pays for it.
export async function cloudElementRecency(uid) {
  if (!supabase || !uid) return { ok: false, rows: [] };
  return fetchElementRecency(supabase);
}
