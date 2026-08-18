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
 *  whole-country zoom can't ask for the whole table.
 *
 *  NEW-4 (owner report, 2026-08-17): a plain `.limit(PLACES_QUERY_CAP)` with no ORDER BY
 *  returns Postgres's unspecified scan order, which correlates with the Overture load's
 *  insertion order — so a metro-wide viewport with more than the cap's worth of places always
 *  returned the SAME arbitrary prefix, clustered wherever those rows happen to live in storage,
 *  no matter where the map was actually looking. `food_places_in_bounds_sampled` (db/food.sql)
 *  fixes this at the query, not by raising the number: it partitions the viewport into a grid
 *  and takes an even share from every cell, so the result is spread across the CURRENT VIEW
 *  instead of bunched in one corner — and it reports `total_matched` so the UI can say "capped"
 *  instead of silently showing a subset. */
const PLACES_QUERY_CAP = 2000;
const PLACES_QUERY_GRID = 8;

export async function fetchPlacesInBounds(bounds) {
  if (!supabase || !bounds) return { data: [], totalMatched: 0, capped: false, error: null };
  const { south, north, west, east } = bounds;
  const { data, error } = await supabase.rpc("food_places_in_bounds_sampled", {
    p_south: south, p_west: west, p_north: north, p_east: east,
    p_cap: PLACES_QUERY_CAP, p_grid: PLACES_QUERY_GRID,
  });
  const rows = data || [];
  const totalMatched = rows.length ? Number(rows[0].total_matched) : 0;
  return { data: rows, totalMatched, capped: totalMatched > rows.length, error };
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
 *  presses a few feet apart still count as "the same taco truck"). Also carries `avgRating` —
 *  the mean of that pin's own rated visits (undefined if none are rated yet) — so the map can
 *  colour a manual pin by rating exactly like a snapshot place (owner redesign, 2026-08-18:
 *  "his rated places coloured along the 1-10 scale"). */
export function manualPinsFromVisits(visits) {
  const groups = new Map();
  for (const v of visits) {
    if (v.place_id) continue;
    const key = `${v.custom_name}|${Number(v.custom_lat).toFixed(4)}|${Number(v.custom_lon).toFixed(4)}`;
    if (!groups.has(key)) {
      groups.set(key, { key, name: v.custom_name, lat: v.custom_lat, lon: v.custom_lon, visitIds: [], ratings: [] });
    }
    const g = groups.get(key);
    g.visitIds.push(v.id);
    // Number(): rating is a Postgres `numeric` column, which PostgREST returns as a JSON
    // STRING ("7.5") to avoid float-precision loss over the wire — same reason `cost` reads
    // are already coerced this way at their render sites.
    if (v.rating != null) g.ratings.push(Number(v.rating));
  }
  return [...groups.values()].map(({ ratings, ...pin }) => ({
    ...pin,
    avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : undefined,
  }));
}

/** Which food_places ids the user has already logged at least once — drives the
 *  "logged vs not logged" pin styling on the map. */
export function loggedPlaceIds(visits) {
  return new Set(visits.filter((v) => v.place_id).map((v) => v.place_id));
}

/** Mean rating per logged food_places id (undefined for a place with visits but none rated
 *  yet) — the map colours a rated place along the 1-10 ramp; an unrated-but-visited place
 *  falls back to the flat "logged" colour instead. */
export function avgRatingByPlaceId(visits) {
  const sums = new Map(); // id -> {sum, n}
  for (const v of visits) {
    if (!v.place_id || v.rating == null) continue;
    const cur = sums.get(v.place_id) || { sum: 0, n: 0 };
    cur.sum += Number(v.rating); cur.n += 1; // Number(): see manualPinsFromVisits above
    sums.set(v.place_id, cur);
  }
  const out = new Map();
  for (const [id, { sum, n }] of sums) out.set(id, sum / n);
  return out;
}
