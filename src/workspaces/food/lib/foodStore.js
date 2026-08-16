/* foodStore — the ONE seam between the /food UI and Supabase. Two tables, two shapes:
 *   food_places — public reference data (Overture Maps snapshot, loaded once by
 *                 scripts/load-food-places.py). Read-only from the browser.
 *   food_visits — the signed-in owner's private log. Full CRUD, RLS-scoped to auth.uid().
 *
 * A "manual pin" is a food_visits row with place_id = null, custom_name/custom_lat/custom_lon
 * set (see db/food.sql). Logging a SECOND visit at an existing manual pin reuses the same
 * custom_name/lat/lon (grouped client-side in manualPinsFromVisits) rather than minting a new
 * row in food_places — that table is service-role-write-only by design.
 */
import { supabase, supabaseConfigured } from "./supabaseClient.js";

export { supabaseConfigured };

/** Places from the loaded snapshot inside a lat/lon box. Capped so an accidental
 *  whole-country zoom can't ask for the whole table. */
const PLACES_QUERY_CAP = 2000;

export async function fetchPlacesInBounds(bounds) {
  if (!supabase || !bounds) return { data: [], error: null };
  const { south, north, west, east } = bounds;
  const { data, error } = await supabase
    .from("food_places")
    .select("id,name,lat,lon,category,cuisine,address,brand,source,source_licence")
    .gte("lat", south).lte("lat", north)
    .gte("lon", west).lte("lon", east)
    .limit(PLACES_QUERY_CAP);
  return { data: data || [], error };
}

export async function fetchPlaceById(id) {
  if (!supabase || !id) return { data: null, error: null };
  const { data, error } = await supabase.from("food_places").select("*").eq("id", id).maybeSingle();
  return { data, error };
}

/** Batch name/location lookup for a set of place ids — used to label the visit LIST, which
 *  can reference places far outside whatever the map happens to have in view right now. */
export async function fetchPlacesByIds(ids) {
  if (!supabase || !ids || ids.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.from("food_places").select("id,name,lat,lon,category").in("id", ids);
  return { data: data || [], error };
}

/** Every visit the signed-in user has logged (owner-only RLS — this is always just
 *  their own rows). Small personal table; no pagination needed at any realistic scale. */
export async function fetchAllVisits() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase
    .from("food_visits")
    .select("*")
    .order("visited_on", { ascending: false, nullsFirst: false });
  return { data: data || [], error };
}

export async function insertVisit(visit) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { data: null, error: new Error("Sign in to log a visit") };
  const { data, error } = await supabase
    .from("food_visits")
    .insert({ ...visit, user_id: uid })
    .select()
    .single();
  return { data, error };
}

export async function updateVisit(id, patch) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { data, error } = await supabase.from("food_visits").update(patch).eq("id", id).select().single();
  return { data, error };
}

export async function deleteVisit(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error } = await supabase.from("food_visits").delete().eq("id", id);
  return { error };
}

/** Manual pins, derived from the visit log rather than stored separately: every distinct
 *  (custom_name, rounded custom_lat/lon) among the user's place_id-null visits is one pin,
 *  carrying the list of visit ids logged there so a second visit at the same spot is a
 *  click on the SAME pin, not a new one (rounding to 4dp is ~11m, tight enough that two
 *  presses a few feet apart still count as "the same taco truck"). */
export function manualPinsFromVisits(visits) {
  const groups = new Map();
  for (const v of visits) {
    if (v.place_id) continue;
    const key = `${v.custom_name}|${Number(v.custom_lat).toFixed(4)}|${Number(v.custom_lon).toFixed(4)}`;
    if (!groups.has(key)) {
      groups.set(key, { key, name: v.custom_name, lat: v.custom_lat, lon: v.custom_lon, visitIds: [] });
    }
    groups.get(key).visitIds.push(v.id);
  }
  return [...groups.values()];
}

/** Which food_places ids the user has already logged at least once — drives the
 *  "logged vs not logged" pin styling on the map. */
export function loggedPlaceIds(visits) {
  return new Set(visits.filter((v) => v.place_id).map((v) => v.place_id));
}
