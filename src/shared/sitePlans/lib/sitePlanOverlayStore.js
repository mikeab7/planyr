/* sitePlanOverlayStore — the seam between the site-plan-overlay UI and Supabase's
 * `public.site_plan_overlays` table. Mirrors comps/lib/compsStore.js's shape exactly: every
 * function returns { data, error } (or { error } for delete), nothing swallowed, caller
 * decides how to surface a failure (LOUD-FAILURE).
 */
import { supabase } from "../../../workspaces/site-planner/lib/supabase.js";
import { overlayToRow, rowToOverlay } from "./sitePlanOverlays.js";
import { casUpsert } from "../../cloud/optimisticUpsert.js";
import { deleteOverlayRaster } from "./overlayRasterStorage.js";

const TABLE = "site_plan_overlays";
const SELECT_COLS =
  "id,user_id,team_id,project_id,review_id,page,doc_title,doc_date,source_file_name," +
  "img_w,img_h,raster_key,thumb_data_url,center_lat,center_lon,ft_per_px,rotation_deg," +
  "opacity,visible,locked,version,created_at,updated_at";
const TRASH_SELECT_COLS = "id,doc_title,page,source_file_name,deleted_at";

/** Every LIVE overlay the signed-in user can see (their own + their team's) — small table, no
 * pagination needed at any realistic scale (mirrors fetchAllComps). Soft-deleted rows
 * (B972512-HARDENING item 6) are excluded — see fetchDeletedOverlays for the trash list. */
export async function fetchAllOverlays() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from(TABLE).select(SELECT_COLS).is("deleted_at", null).order("created_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data || []).map(rowToOverlay), error: null };
}

/** Soft-deleted overlays the signed-in user can see — the "Recently deleted" trash list
 * (B972512-HARDENING item 6, mirrors sites/doc_reviews' own soft-delete + restore pattern).
 * Deliberately minimal columns — a trash row only needs enough to identify and restore it. */
export async function fetchDeletedOverlays() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from(TABLE).select(TRASH_SELECT_COLS).not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: data || [], error: null };
}

export async function insertOverlay(overlay) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { data: null, error: new Error("Sign in to add a site plan") };
  const { data, error } = await supabase.from(TABLE).insert(overlayToRow(overlay)).select(SELECT_COLS).single();
  if (error) return { data: null, error };
  return { data: rowToOverlay(data), error: null };
}

/** B972512-HARDENING item 7 — version-guarded (optimistic concurrency, the same primitive
 * `sites`/`doc_reviews` use): `overlay.version` must be the version this client last saw, or
 * the write is refused as a CONFLICT rather than silently clobbering a concurrent edit — multiple
 * live sessions on the same overlay are the owner's own stated common case. On conflict, returns
 * `{ conflict: true }` alongside a friendly error; the caller's existing reload() then shows
 * whatever actually landed. Degrades to a plain update if `version` isn't in `overlay` (shouldn't
 * happen post-migration, but matches the sites/doc_reviews graceful-degrade convention). */
export async function updateOverlay(id, overlay) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const row = overlayToRow(overlay);
  const expected = Number.isFinite(overlay.version) ? overlay.version : null;
  if (expected == null) {
    const { data, error } = await supabase.from(TABLE).update(row).eq("id", id).select(SELECT_COLS).maybeSingle();
    if (error) return { data: null, error };
    if (!data) return { data: null, error: new Error("Not saved — you can only edit site plans you uploaded") };
    return { data: rowToOverlay(data), error: null };
  }
  const result = await casUpsert(supabase, TABLE, { id, row, expected });
  if (result.degrade) {
    const { data, error } = await supabase.from(TABLE).update(row).eq("id", id).select(SELECT_COLS).maybeSingle();
    if (error) return { data: null, error };
    if (!data) return { data: null, error: new Error("Not saved — you can only edit site plans you uploaded") };
    return { data: rowToOverlay(data), error: null };
  }
  if (result.conflict) {
    return { data: null, conflict: true, error: new Error("Someone else changed this site plan — showing the latest version instead.") };
  }
  if (!result.ok) return { data: null, error: new Error(result.error || "Not saved") };
  return { data: { ...overlay, ...row, version: result.version }, error: null };
}

/** The plan-space point ({x,y} on the overlay's own raster) for every comp pinned to this
 * overlay, REGARDLESS of who owns that comp — comps.select is owner/team RLS, so a teammate's
 * un-shared comp would otherwise be invisible even to the overlay's own owner. Read-only, and
 * deliberately returns nothing else about the comp (see site_plan_overlays_comp_sync.sql's
 * header) — this exists only to let a placement-move recompute where each pin should now sit. */
export async function fetchOverlayCompPoints(overlayId) {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.rpc("site_plan_overlay_comp_points", { p_overlay_id: overlayId });
  if (error) return { data: [], error };
  return { data: (data || []).map((r) => ({ id: r.id, sitePlanPoint: r.site_plan_point })), error: null };
}

/** Commit a finished drag/scale/rotate: writes the overlay's new placement AND every dependent
 * comp's recomputed lat/lon in ONE transaction (site_plan_overlays_comp_sync.sql) — so a plan's
 * new position and its pins' new positions land together or not at all, and a teammate's pin
 * moves too even though `comps` update is normally owner-only RLS. `compPositions` is
 * `[{id, lat, lon}, ...]`, already computed client-side (the projection math lives in
 * overlayGeoref.js, not duplicated here). `expectedVersion` is the version-guard (item 7) — the
 * version this client last saw for the overlay; the RPC refuses (40001) if it's stale. Returns
 * `{ movedCount, version, conflict, error }` — on conflict, `version` is absent and the caller
 * should reload to pick up whatever actually landed. */
export async function commitOverlayPlacementWithComps(overlayId, placement, compPositions, expectedVersion) {
  if (!supabase) return { movedCount: 0, error: new Error("Supabase not configured") };
  const { data, error } = await supabase.rpc("commit_site_plan_overlay_placement", {
    p_overlay_id: overlayId,
    p_center_lat: placement.centerLat ?? null, p_center_lon: placement.centerLon ?? null,
    p_ft_per_px: placement.ftPerPx ?? null, p_rotation_deg: placement.rotationDeg ?? 0,
    p_comp_positions: compPositions || [],
    p_expected_version: Number.isFinite(expectedVersion) ? expectedVersion : 1,
  });
  if (error) {
    if (String(error.code || "") === "40001") {
      return { movedCount: 0, conflict: true, error: new Error("This site plan changed elsewhere — showing the latest version instead.") };
    }
    return { movedCount: 0, error };
  }
  return { movedCount: (data && data.moved) ?? 0, version: data && data.version, error: null };
}

/** Soft-delete (B972512-HARDENING item 6, mirrors sites/doc_reviews' `deleted_at` pattern) — the
 * ordinary "Delete site plan…" action never permanently destroys the row; it stamps `deleted_at`
 * so it drops out of fetchAllOverlays() but stays recoverable via restoreOverlay(). Still subject
 * to the caller's own proactive comp-reference check (item 5) — soft-deleting an overlay while
 * comps still point at it would leave those comps' "pinned to a plan" state pointing at something
 * hidden, so SitePlansSection.jsx's `remove()` blocks BEFORE calling this, same as it did for the
 * old hard delete. */
export async function deleteOverlay(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { data, error } = await supabase.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return { error };
  if (!Array.isArray(data) || !data.length) return { error: new Error("Not deleted — you can only remove site plans you uploaded") };
  return { error: null };
}

/** Bring a soft-deleted overlay back — the "Recently deleted" trash view's Restore action. */
export async function restoreOverlay(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { data, error } = await supabase.from(TABLE).update({ deleted_at: null }).eq("id", id).select("id");
  if (error) return { error };
  if (!Array.isArray(data) || !data.length) return { error: new Error("Not restored — you can only restore site plans you uploaded") };
  return { error: null };
}

/** Permanent delete out of the trash view — the real DELETE, still subject to the SAME
 * comp-reference guard as the soft delete (comps_parcel_anchor_has_identity — see
 * overlayErrors.js) since the underlying constraint doesn't care which path reached it.
 *
 * B972512-HARDENING item 16 — `deleteOverlayRaster` existed but was never actually CALLED
 * anywhere in the app, so every permanently-deleted overlay left its cached raster JPEG behind
 * in Storage forever (an orphaned file with no row, growing without bound). Cleaned up here,
 * AFTER the row delete succeeds, using the raster_key the delete itself returns — never at soft
 * delete, which must stay recoverable (restoreOverlay brings the row back; its raster needs to
 * still exist for that to mean anything). Best-effort: a cleanup failure never blocks or
 * unwinds the row delete, mirroring reviewStore.purgeReview's own precedent for exactly this
 * (Storage/Drive byte cleanup is separate from, and never gates, the row's own removal). */
export async function permanentlyDeleteOverlay(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { data, error, count } = await supabase.from(TABLE).delete({ count: "exact" }).eq("id", id).select("raster_key");
  if (error) return { error };
  if (!count) return { error: new Error("Not deleted — you can only remove site plans you uploaded") };
  const rasterKey = data && data[0] && data[0].raster_key;
  if (rasterKey) { try { await deleteOverlayRaster(rasterKey); } catch (_) { /* best-effort — the row is already gone */ } }
  return { error: null };
}
