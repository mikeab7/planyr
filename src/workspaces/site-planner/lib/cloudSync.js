/* Cloud sync (Phase 4) — read/write the user's sites in Supabase, RLS-scoped to
 * the signed-in user (each user only ever touches their own rows). The serialized
 * Site Model lives in the `data` jsonb column; a few columns are duplicated for
 * querying. No migration of legacy localStorage sites — cloud is the home for a
 * logged-in user's data; localStorage remains the store when logged out.
 */
import { supabase, supabaseRest, currentAccessToken } from "./supabase.js";
import { casUpsert, keepaliveCasPush, isMissingVersionColumn, isMissingColumn } from "../../../shared/cloud/optimisticUpsert.js";
import { contentCount } from "./siteModel.js";

// Per-tab memory of the `version` we last synced for each site, so a save can be a
// compare-and-swap that REJECTS a stale write instead of silently clobbering (B314).
// Populated by cloudList; advanced on every successful write; cleared on delete / user
// switch. Module-scope = naturally per-tab. Until the `version` column is migrated in,
// every write degrades to a plain upsert (today's behaviour) and this stays empty.
const siteVersions = {};
// B459 — the CAS above guards the version NUMBER only, NEVER the content. So a tab holding a
// stale/thin model at a MATCHING version would still silently overwrite a fuller cloud row (the
// 8 South 5-building loss: a road-only model clobbered 5 saved buildings while the version matched).
// Alongside the version we therefore remember the CONTENT we last synced — item count + tombstone
// count — so a write can ALSO reject a "thinning clobber": a push that would drop ≥2 items the cloud
// still has, with no delete-tombstone to explain the drop, is treated as a stale-tab clobber and
// blocked LOUD (reload then union-merges the fuller cloud back). Legit incremental undo (≤1 unexplained
// drop per push) and any tombstoned delete pass through untouched.
const siteContent = {};   // id -> contentCount last synced
const siteTombs = {};     // id -> deletedIds length last synced
const arr = (x) => (Array.isArray(x) ? x : []);
export function clearSiteVersions() {
  for (const m of [siteVersions, siteContent, siteTombs]) for (const k of Object.keys(m)) delete m[k];
}
export const _siteVersions = siteVersions; // test seam (read/seed in unit tests)
export const _siteContent = siteContent;   // test seam (B459)
export const _siteTombs = siteTombs;       // test seam (B459)

// Pure (exported for unit tests): would pushing `m` thin the cloud row below the last-synced
// content by more than a real delete explains? baseCount/baseTombs are the last-synced counts
// for this id (null baseCount = no baseline yet → never block a first sync).
export function wouldThinClobber(m, baseCount, baseTombs) {
  if (baseCount == null) return false;
  const deliberate = Math.max(0, arr(m && m.deletedIds).length - (baseTombs || 0)); // items a delete accounts for
  const lost = (baseCount - deliberate) - contentCount(m);                          // items vanished with no delete
  return lost >= 2;                                                                 // ≥2 unexplained = stale-tab clobber
}
// Record the content we just synced for `id`, so the next push's thin-clobber guard has a baseline.
function rememberContent(model) {
  if (!model || model.id == null) return;
  siteContent[model.id] = contentCount(model);
  siteTombs[model.id] = arr(model.deletedIds).length;
}

// Don't push a huge embedded screenshot dataURL into a DB row — keep the underlay
// placement but drop the inline image (map-sourced underlays use a URL, not a
// dataURL, so those are preserved). Geometry/metrics are unaffected.
const isDataUrl = (s) => typeof s === "string" && s.startsWith("data:");
function slimForCloud(model) {
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
  return m;
}

export async function cloudUpsert(uid, model) {
  if (!supabase || !uid || !model || !model.id) return { ok: false, error: "not ready" };
  const m = slimForCloud(model);
  // B459 — refuse to silently overwrite a fuller cloud row with a stale/thin model (the CAS below
  // only checks the version number). Block LOUD as a conflict; the cloud is left intact, so a reload
  // union-merges the fuller copy back instead of losing it.
  if (wouldThinClobber(m, siteContent[m.id], siteTombs[m.id])) return { ok: false, conflict: true, thinned: true };
  // Row carries NO user_id — casUpsert stamps the creator only on INSERT, so a teammate editing
  // a shared row never re-stamps the original owner (team feature). team_id rides along (null =
  // private); when set, RLS lets the project's team read/edit it.
  const row = {
    id: m.id,
    group_id: m.groupId || null, site: m.site || null, name: m.name || null, county: m.county || null,
    team_id: m.teamId || null,
    updated_at: new Date(m.updatedAt || Date.now()).toISOString(),
    data: m,
  };
  // Optimistic concurrency (B314): a conditional write guarded by the version we last synced.
  // A stale write (another session advanced the row) is REJECTED as a conflict, not applied —
  // the caller surfaces a loud "reload before saving" prompt instead of a silent overwrite.
  let r = await casUpsert(supabase, "sites", { uid, id: m.id, row, expected: siteVersions[m.id] });
  // Graceful degrade if the team_id column isn't migrated in yet (db/team_sharing.sql not run):
  // retry the SAME guarded write without it, so saving never regresses before sharing is enabled.
  if (r && r.ok === false && r.error && isMissingColumn(r.error, "team_id")) {
    const { team_id, ...noTeam } = row;
    r = await casUpsert(supabase, "sites", { uid, id: m.id, row: noTeam, expected: siteVersions[m.id] });
  }
  if (r.ok) { siteVersions[m.id] = r.version; rememberContent(m); return { ok: true }; }
  if (r.conflict) return { ok: false, conflict: true };
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
    if (!error) rememberContent(m); // B459 — keep the content baseline current even on the version-less degrade path
    return { ok: !error, error: error ? error.message : null };
  }
  return { ok: false, error: r.error || "cloud write failed" };
}

// Keepalive cloud push for a forced reload (B452): a guarded, fire-and-forget write that
// survives the navigation, so the last edits don't sit only in memory + the local mirror
// until the next load. Version-guarded (keepaliveCasPush) so it can never clobber a newer
// row; skips a brand-new site (no synced version) — the local save + boot merge cover that.
// Returns true if a request was dispatched.
export function keepaliveCloudPush(uid, model) {
  if (!supabase || !uid || !model || !model.id) return false;
  const { url, anon } = supabaseRest();
  const token = currentAccessToken();
  const m = slimForCloud(model);
  // B459 — a forced-reload keepalive must NOT clobber a fuller cloud row with a thin model either.
  if (wouldThinClobber(m, siteContent[m.id], siteTombs[m.id])) return false;
  // No user_id in the PATCH body — a guarded UPDATE must not re-stamp the row's creator.
  const row = {
    id: m.id,
    group_id: m.groupId || null, site: m.site || null, name: m.name || null, county: m.county || null,
    team_id: m.teamId || null,
    updated_at: new Date(m.updatedAt || Date.now()).toISOString(),
    data: m,
  };
  return keepaliveCasPush({ url, anon, token, table: "sites", id: m.id, row, expected: siteVersions[m.id] });
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
  // Scope by id only and let RLS decide who may delete (own row, OR team-admin on a shared row).
  // A user_id filter would block an admin from deleting a teammate's shared project, which the
  // policy permits — RLS is the security boundary here, not the client filter (team feature).
  // `.select()` returns the rows actually removed, so a 0-row no-op (RLS mismatch, or an
  // already-deleted row) is DISTINGUISHABLE from a real removal — a bare `.delete()` reports
  // success on both (B372).
  try {
    const { data, error } = await supabase.from("sites").delete().eq("id", id).select("id");
    return interpretDelete(data, error);
  } catch (e) {
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
    rememberContent(r.data); // B459 — baseline the cloud's content so a later thin push is caught
  }
  return rows.map((r) => {
    const m = r && r.data;
    if (!m) return null;
    if (r && "team_id" in r) m.teamId = r.team_id || null;   // DB column is the source of truth for sharing
    if (r && "user_id" in r) m.ownerId = r.user_id || null;  // who created/owns it (for "owned by teammate")
    return m;
  }).filter(Boolean);
}
