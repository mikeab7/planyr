/* sitePlanOverlayStore — the seam between the site-plan-overlay UI and Supabase's
 * `public.site_plan_overlays` table. Mirrors comps/lib/compsStore.js's shape exactly: every
 * function returns { data, error } (or { error } for delete), nothing swallowed, caller
 * decides how to surface a failure (LOUD-FAILURE).
 */
import { supabase } from "../../../workspaces/site-planner/lib/supabase.js";
import { overlayToRow, rowToOverlay } from "./sitePlanOverlays.js";

const TABLE = "site_plan_overlays";
const SELECT_COLS =
  "id,user_id,team_id,project_id,review_id,page,doc_title,doc_date,source_file_name," +
  "img_w,img_h,raster_key,thumb_data_url,center_lat,center_lon,ft_per_px,rotation_deg," +
  "opacity,visible,locked,created_at,updated_at";

/** Every overlay the signed-in user can see (their own + their team's) — small table, no
 * pagination needed at any realistic scale (mirrors fetchAllComps). */
export async function fetchAllOverlays() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from(TABLE).select(SELECT_COLS).order("created_at", { ascending: false });
  if (error) return { data: [], error };
  return { data: (data || []).map(rowToOverlay), error: null };
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

export async function updateOverlay(id, overlay) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { data, error } = await supabase.from(TABLE).update(overlayToRow(overlay)).eq("id", id).select(SELECT_COLS).maybeSingle();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Not saved — you can only edit site plans you uploaded") };
  return { data: rowToOverlay(data), error: null };
}

export async function deleteOverlay(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error, count } = await supabase.from(TABLE).delete({ count: "exact" }).eq("id", id);
  if (error) return { error };
  if (!count) return { error: new Error("Not deleted — you can only remove site plans you uploaded") };
  return { error: null };
}
