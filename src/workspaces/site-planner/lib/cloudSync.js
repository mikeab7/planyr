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
  const { teamId: _team, ownerId: _owner, ...noShare } = m;
  return noShare;
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
    group_id: m.groupId || null, site: m.site || null, name: m.name || null, county: m.county || null,
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

export async function cloudDelete(uid, id) {
  // Nothing to remove server-side (logged out / unconfigured) is success, not a failure to alarm on.
  if (!supabase || !uid || !id) return { ok: true, removed: 0, skipped: true };
  delete siteVersions[id]; // stop tracking a removed row's version
  delete lastHeaderSig[id];
  // Scope by id only and let RLS decide who may delete (own row, OR team-admin on a shared row).
  // A user_id filter would block an admin from deleting a teammate's shared project, which the
  // policy permits — RLS is the security boundary here, not the client filter (team feature).
  // `.select()` returns the rows actually removed, so a 0-row no-op (RLS mismatch, or an
  // already-deleted row) is DISTINGUISHABLE from a real removal — a bare `.delete()` reports
  // success on both (B372).
  try {
    const { data, error } = await supabase.from("sites").delete().eq("id", id).select("id");
    const out = interpretDelete(data, error);
    // B468/NEW-5 — a delete that errored, or matched ZERO rows (RLS/ownership mismatch → the row
    // survives and reappears on reload), is exactly the kind of silent failure we want traceable.
    if (out.ok === false) reportClientEvent("cloud-write-failed", "delete failed (sites)", { id, error: out.error });
    else if (!out.skipped && out.removed === 0) reportClientEvent("delete-zero-rows", "delete matched no rows (sites)", { id });
    return out;
  } catch (e) {
    reportClientEvent("cloud-write-failed", "delete threw (sites)", { id, error: (e && e.message) || "" });
    return { ok: false, error: (e && e.message) || "delete threw" };
  }
}

// Every site row the signed-in user can see — their own PLUS any shared with a team they're
// in (RLS decides). Returns the array of serialized Site Models (the `data` column), records
// each row's `version` for the next compare-and-swap (B314), and overlays the authoritative
// team_id / owner (user_id) columns onto each model so the UI can show "shared / owned by".
export async function cloudList(uid) {
  if (!supabase || !uid) return [];
  let { data, error } = await supabase.from("sites").select("data, version, team_id, user_id").order("updated_at", { ascending: false });
  // Pre-migration fallbacks: team_id (db/team_sharing.sql) then version (db/optimistic_concurrency.sql)
  // may not exist yet → re-select with fewer columns so loading never breaks before they're run.
  if (error && isMissingColumn(error, "team_id"))
    ({ data, error } = await supabase.from("sites").select("data, version").order("updated_at", { ascending: false }));
  if (error && isMissingVersionColumn(error))
    ({ data, error } = await supabase.from("sites").select("data").order("updated_at", { ascending: false }));
  // THROW on a real fetch error so callers can tell it apart from a genuinely-empty
  // result. Returning [] here let `pullCloud` wipe the local cache to empty on a
  // transient/offline error, showing a scary "no sites" state (B54).
  if (error) throw new Error(error.message || "cloud list failed");
  const rows = data || [];
  for (const r of rows) if (r && r.data && r.data.id != null) {
    if (r.version != null) siteVersions[r.data.id] = r.version;
  }
  return rows.map((r) => {
    const m = r && r.data;
    if (!m) return null;
    if (r && "team_id" in r) m.teamId = r.team_id || null;   // DB column is the source of truth for sharing
    if (r && "user_id" in r) m.ownerId = r.user_id || null;  // who created/owns it (for "owned by teammate")
    // Seed the header-content baseline from what the cloud ALREADY has (post-overlay, so it matches
    // the shape a local push would send). If the local copy turns out identical, even the boot
    // re-push skips — no per-load version churn. Any real local difference still pushes.
    if (r.version != null && m.id != null) { try { lastHeaderSig[m.id] = headerSig(m); } catch (_) {} }
    return m;
  }).filter(Boolean);
}
