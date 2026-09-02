/* compsStore — the one seam between the Leasing Comps UI and Supabase's `public.comps` table.
 * Mirrors workspaces/food/lib/foodStore.js's shape: every function returns { data, error }
 * (or { error } for delete), nothing is swallowed, and the caller decides how to surface a
 * failure (LOUD-FAILURE). No CAS/optimistic-concurrency machinery here — comps don't have
 * cloudSync.js's multi-tab autosave race, so foodStore's simpler shape is the right precedent,
 * not the heavier one.
 *
 * Delete is SOFT (B1066368, deleted_at, comps_soft_delete.sql) — mirrors sitePlanOverlayStore.js's own
 * deleteOverlay/restoreOverlay/permanentlyDeleteOverlay trio exactly, which itself mirrors sites/
 * doc_reviews. A comp used to be hard-deleted with no way back; deleteComp() now stamps
 * deleted_at, fetchAllComps() excludes it, and fetchDeletedComps()/restoreComp()/
 * permanentlyDeleteComp() are the "Recently deleted" trash list's three actions.
 */
import { supabase } from "../../../workspaces/site-planner/lib/supabase.js";
import { compToRow, rowToComp } from "./comps.js";

export { supabase };

const TABLE = "comps";
const SELECT_COLS =
  "id,user_id,team_id,project_id,comp_type,comp_date,lease_commencement_date,title,notes,anchor_kind,lat,lon,county," +
  "parcel_apn,parcel_geom,site_plan_overlay_id,site_plan_point,land_price,land_size_value," +
  "land_size_unit,bldg_price,bldg_size_sf,bldg_noi,bldg_cap_rate," +
  "lease_rate,lease_rate_period,lease_rate_expense,lease_ti,lease_term,lease_size_sf," +
  "lease_free_rent_months,lease_escalation_pct,comp_party_provider,comp_party_acquirer,created_at,updated_at";
// Trash-view select — the same shape as SELECT_COLS plus `deleted_at`, so a "Recently deleted"
// row can reuse every existing display helper (compHeadline, useCompLocationText) rather than a
// second, narrower row shape (comps.sql's TABLE is small — no pagination cost either way).
// `rowToComp` ignores the extra column; deleted_at is read straight off the raw row where needed.
const TRASH_SELECT_COLS = `${SELECT_COLS},deleted_at`;

/** Every LIVE comp the signed-in user can see (their own + their team's) — small personal/team
 * table, no pagination needed at any realistic scale (mirrors fetchAllVisits). Soft-deleted rows
 * (deleted_at set) are excluded — see fetchDeletedComps for the "Recently deleted" trash list. */
export async function fetchAllComps() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from(TABLE).select(SELECT_COLS).is("deleted_at", null).order("comp_date", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data || []).map(rowToComp), error: null };
}

/** Soft-deleted comps the signed-in user can see — the "Recently deleted" trash list, mirroring
 * sitePlanOverlayStore.js's fetchDeletedOverlays. Only the owner can actually Restore or purge one
 * (comps.sql's UPDATE/DELETE policies are owner-only), but a team member who could see the comp
 * before deletion can still see it land here — same visibility shape the overlay trash already
 * ships with. */
export async function fetchDeletedComps() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from(TABLE).select(TRASH_SELECT_COLS).not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data || []).map(rowToComp), error: null };
}

export async function insertComp(comp) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { data: null, error: new Error("Sign in to add a comp") };
  const { data, error } = await supabase.from(TABLE).insert(compToRow(comp)).select(SELECT_COLS).single();
  if (error) return { data: null, error };
  return { data: rowToComp(data), error: null };
}

/** Bulk insert for the paste-grid (B849232/NEW-1) — ONE round trip for a whole batch rather
 * than N sequential `insertComp` calls. Postgres inserts a multi-row VALUES list atomically, so
 * either every row lands or (on any constraint violation) none do — the caller never has to
 * reconcile a partial batch. */
export async function insertComps(comps) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  if (!comps?.length) return { data: [], error: null };
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { data: null, error: new Error("Sign in to add comps") };
  const { data, error } = await supabase.from(TABLE).insert(comps.map(compToRow)).select(SELECT_COLS);
  if (error) return { data: null, error };
  return { data: (data || []).map(rowToComp), error: null };
}

export async function updateComp(id, comp) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  // RLS scopes the write to the caller's own rows — a teammate's update affects 0 rows rather
  // than throwing, so a caller that doesn't check `data` would silently believe a no-op saved.
  const { data, error } = await supabase.from(TABLE).update(compToRow(comp)).eq("id", id).select(SELECT_COLS).maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Not saved — you can only edit comps you entered") };
  return { data: rowToComp(data), error: null };
}

/** Soft-delete (mirrors sitePlanOverlayStore.js's deleteOverlay / sites' / doc_reviews' own
 * `deleted_at` pattern) — "Delete" on a comp never permanently destroys the row any more; it
 * stamps `deleted_at` so the comp drops out of fetchAllComps() but stays recoverable via
 * restoreComp() from the "Recently deleted" trash list until someone explicitly purges it. */
export async function deleteComp(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { data, error } = await supabase.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return { error };
  if (!Array.isArray(data) || !data.length) return { error: new Error("Not deleted — you can only remove comps you entered") };
  return { error: null };
}

/** Bring a soft-deleted comp back — the "Recently deleted" trash list's Restore action. */
export async function restoreComp(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { data, error } = await supabase.from(TABLE).update({ deleted_at: null }).eq("id", id).select("id");
  if (error) return { error };
  if (!Array.isArray(data) || !data.length) return { error: new Error("Not restored — you can only restore comps you entered") };
  return { error: null };
}

/** Permanent delete out of the trash view — the real DELETE. A comp has no associated Storage/
 * Drive file (unlike a site-plan overlay's cached raster), so there's nothing else to clean up. */
export async function permanentlyDeleteComp(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error, count } = await supabase.from(TABLE).delete({ count: "exact" }).eq("id", id);
  if (error) return { error };
  if (!count) return { error: new Error("Not deleted — you can only remove comps you entered") };
  return { error: null };
}
