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

/** Search the WHOLE 100,000+-place, three-metro snapshot by name — deliberately NOT scoped to
 *  the current viewport (owner, 2026-08-18: "the entire point of search is finding a place you
 *  cannot see"). Backed by `food_places_search_by_name` (db/food.sql): a trigram word-similarity
 *  match on a GIN index, so "taco" finds "Bandito's Taco Grill" and "mcdon" fuzzy-matches
 *  "McDonald's" — a plain ILIKE prefix search would miss both. Returns [] for a query with no
 *  reasonable match (never throws, mirrors fetchPlacesInBounds' error-shape).
 *
 *  `center` (optional {lat, lon}, the current map view's midpoint) breaks similarity TIES by
 *  distance — owner, 2026-08-18, once the snapshot spanned three metros: "Searching Torchy's
 *  must not return fifteen indistinguishable rows... results in or near the current map view
 *  should rank above far-away ones." Every location of a searched chain scores an identical
 *  trigram similarity (the name text is the same), so without a centre they'd fall back to
 *  alphabetical — passing the map's centre reorders those ties by real distance instead. Name
 *  relevance still comes first: a worse name match never outranks a better one just for being
 *  closer (see the RPC's `order by sim desc, distance_km asc` — distance is the TIEBREAK). */
const SEARCH_RESULT_CAP = 15; // more than the ~10 shown, so client-side "his places first" reordering never runs dry

export async function searchPlacesByName(query, center) {
  if (!supabase || !query || !query.trim()) return { data: [], error: null };
  const { data, error } = await supabase.rpc("food_places_search_by_name", {
    p_query: query.trim(), p_cap: SEARCH_RESULT_CAP,
    p_center_lat: center?.lat ?? null, p_center_lon: center?.lon ?? null,
  });
  return { data: data || [], error };
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

/** The identity key a manual pin (place_id null) groups under — (name, rounded lat/lon), 4dp
 *  (~11m) so two presses a few feet apart still count as "the same taco truck." Shared between
 *  manualPinsFromVisits (visits) and manualWishlistFromRows (want-to-try flags, B669312) so a
 *  manual pin resolves to the SAME key regardless of which table it came from — that's what lets
 *  FoodApp tell a flagged-but-unvisited manual pin apart from an already-visited one. */
export function manualGroupKey(name, lat, lon) {
  return `${name}|${Number(lat).toFixed(4)}|${Number(lon).toFixed(4)}`;
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
    const key = manualGroupKey(v.custom_name, v.custom_lat, v.custom_lon);
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

/** ── "Want to try" (B669312) ──────────────────────────────────────────────────────────────
 *  food_wishlist is a THIRD table, deliberately: food_places has no user_id (a personal flag
 *  can't live on the shared reference snapshot), and a want-to-try place has zero visits by
 *  definition, so it can't be a food_visits row either — that would corrupt every visit count/
 *  average that reads that table. Same owner-only RLS shape as food_visits, fetched in full the
 *  same way (a small personal table — no pagination needed), so the "flagged" state is a plain
 *  client-side Set/lookup everywhere, exactly like `loggedPlaceIds` already is for visits: no
 *  RPC join, no second round trip per row, works identically against both the viewport-bounds
 *  RPC's rows and the whole-snapshot search RPC's rows since neither is touched at all. */

export async function fetchAllWishlist() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from("food_wishlist").select("*").order("created_at", { ascending: false });
  return { data: data || [], error };
}

export async function addWishlist(entry) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { data: null, error: new Error("Sign in to flag a place") };
  const { data, error } = await supabase
    .from("food_wishlist")
    .insert({ ...entry, user_id: uid })
    .select()
    .single();
  return { data, error };
}

export async function removeWishlist(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error } = await supabase.from("food_wishlist").delete().eq("id", id);
  return { error };
}

/** Which food_places ids the user has flagged — same shape as loggedPlaceIds. */
export function wishlistedPlaceIds(wishlist) {
  return new Set(wishlist.filter((w) => w.place_id).map((w) => w.place_id));
}

/** Flagged manual/dropped pins, one row per pin (the unique index already guarantees at most
 *  one food_wishlist row per (user, manual key), so — unlike manualPinsFromVisits — no grouping
 *  is needed). `visitIds: []` so a wishlist-only pin slots into the exact same selection/panel
 *  shape a visited manual pin uses (VisitPanel already renders correctly with zero past visits). */
export function manualWishlistFromRows(wishlist) {
  return wishlist
    .filter((w) => !w.place_id)
    .map((w) => ({
      key: manualGroupKey(w.custom_name, w.custom_lat, w.custom_lon),
      id: w.id, name: w.custom_name, lat: w.custom_lat, lon: w.custom_lon, visitIds: [],
    }));
}

/** ── DISH-level "want to try" (NEW-3, 2026-08-23) ─────────────────────────────────────────────
 *  Deliberately its OWN table (food_dish_wishlist), not a food_wishlist row: food_wishlist is
 *  PLACE-level (one flag per place, cleared the moment a visit lands) and this is the opposite
 *  shape — it only starts mattering ONCE a place has a visit, is MANY rows per place, and
 *  survives across every future visit rather than belonging to any one of them. Fetched in full
 *  (a small personal table, same as food_wishlist — no pagination). db/food.sql for the schema
 *  and RLS proof. */

export async function fetchAllDishWishlist() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from("food_dish_wishlist").select("*").order("created_at", { ascending: false });
  return { data: data || [], error };
}

export async function addDishWishlist(entry) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { data: null, error: new Error("Sign in to add a dish") };
  const { data, error } = await supabase
    .from("food_dish_wishlist")
    .insert({ ...entry, user_id: uid })
    .select()
    .single();
  return { data, error };
}

/** A single tap, no confirmation (the brief: "removing one should be a single tap. No
 *  confirmation dialog for removing a dish") — a hard delete, distinct from markDishDone below. */
export async function removeDishWishlist(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error } = await supabase.from("food_dish_wishlist").delete().eq("id", id);
  return { error };
}

/** Struck off once he's had it — an UPDATE in place (the row, and its created_at history,
 *  survives), never a delete+reinsert. `done` toggles both ways so a mis-tap is reversible. */
export async function markDishDone(id, done) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error } = await supabase.from("food_dish_wishlist").update({ done }).eq("id", id);
  return { error };
}

/** food_places-id -> its NOT-YET-HAD dish rows (VisitPanel's "Order again" neighbour, and the
 *  visit-log form's suggestion list — done dishes are excluded from both by construction, so
 *  nothing extra has to filter them out at the call site). */
export function dishWishlistByPlaceId(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.place_id || r.done) continue;
    if (!groups.has(r.place_id)) groups.set(r.place_id, []);
    groups.get(r.place_id).push(r);
  }
  return groups;
}

/** The manual-pin equivalent of dishWishlistByPlaceId, keyed by the SAME manualGroupKey every
 *  other manual-pin table already groups by, so a dish list resolves to the same pin regardless
 *  of which table it's read from. */
export function dishWishlistByManualKey(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.place_id || r.done) continue;
    const key = manualGroupKey(r.custom_name, r.custom_lat, r.custom_lon);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return groups;
}
