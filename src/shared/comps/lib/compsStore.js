/* compsStore — the one seam between the Leasing Comps UI and Supabase's `public.comps` table.
 * Mirrors workspaces/food/lib/foodStore.js's shape: every function returns { data, error }
 * (or { error } for delete), nothing is swallowed, and the caller decides how to surface a
 * failure (LOUD-FAILURE). No CAS/optimistic-concurrency machinery here — comps don't have
 * cloudSync.js's multi-tab autosave race, so foodStore's simpler shape is the right precedent,
 * not the heavier one.
 */
import { supabase } from "../../../workspaces/site-planner/lib/supabase.js";
import { compToRow, rowToComp } from "./comps.js";

export { supabase };

const TABLE = "comps";
const SELECT_COLS =
  "id,user_id,team_id,project_id,comp_type,comp_date,title,notes,anchor_kind,lat,lon,county," +
  "parcel_apn,parcel_geom,land_price,land_size_value,land_size_unit,bldg_price,bldg_size_sf," +
  "lease_rate,lease_rate_period,lease_rate_expense,lease_ti,lease_term,created_at,updated_at";

/** Every comp the signed-in user can see (their own + their team's) — small personal/team
 * table, no pagination needed at any realistic scale (mirrors fetchAllVisits). */
export async function fetchAllComps() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from(TABLE).select(SELECT_COLS).order("comp_date", { ascending: false });
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

export async function updateComp(id, comp) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  // RLS scopes the write to the caller's own rows — a teammate's update affects 0 rows rather
  // than throwing, so a caller that doesn't check `data` would silently believe a no-op saved.
  const { data, error } = await supabase.from(TABLE).update(compToRow(comp)).eq("id", id).select(SELECT_COLS).maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Not saved — you can only edit comps you entered") };
  return { data: rowToComp(data), error: null };
}

export async function deleteComp(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error, count } = await supabase.from(TABLE).delete({ count: "exact" }).eq("id", id);
  if (error) return { error };
  if (!count) return { error: new Error("Not deleted — you can only remove comps you entered") };
  return { error: null };
}
