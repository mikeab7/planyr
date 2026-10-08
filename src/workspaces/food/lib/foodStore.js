/* global __BUILD_ID__ */
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
import { manualGroupKey, manualPinKey } from "./pinKeys.js";

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

/** The browse call failing used to be INVISIBLE — the map just drew no pins and the banner kept
 *  saying "Search live for more here" (B<PENDING>, 2026-10-04: a search_path pin broke the RPC for
 *  every viewport and nobody could tell). LOUD-FAILURE: FoodApp shows BROWSE_ERROR_MESSAGE with a
 *  Retry, and this records the failure to public.client_errors (INSERT-only anon RLS) through
 *  food's OWN client — never shared/telemetry/clientErrors.js, which imports site-planner's
 *  Supabase client and would break this module's BUNDLE ISOLATION. Fire-and-forget, never throws,
 *  and the same message is sent at most once a minute so a retry loop can't flood the table. */
export const BROWSE_ERROR_MESSAGE = "Couldn't load restaurants here";
let _lastBrowseReport = { msg: "", at: 0 };
export function reportBrowseError(error, now = Date.now()) {
  try {
    const message = `food_places_in_bounds_sampled: ${(error && (error.message || error.code)) || "unknown error"}` +
      (error && error.code ? ` (${error.code})` : "");
    if (message === _lastBrowseReport.msg && now - _lastBrowseReport.at < 60000) return Promise.resolve(false);
    _lastBrowseReport = { msg: message, at: now };
    if (!supabase) return Promise.resolve(false);
    const row = {
      build: typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev",
      module: "food", source: "food:browse-rpc", message: message.slice(0, 500),
      url: typeof location !== "undefined" ? location.href : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    };
    return Promise.resolve(supabase.from("client_errors").insert(row)).then((r) => !(r && r.error), () => false);
  } catch (_) { return Promise.resolve(false); }
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
const SEARCH_RESULT_CAP = 60; // a pool well past the ~10 shown: the client re-ranks it nearest-the-map-first (lib/searchProximity.js), so the nearby comparable matches must be IN it

/** Name rows first (their order is the RPC's relevance order), then any address-only rows not
 *  already present. Pure — the id is the dedupe key, so a place found both ways is listed once. */
export function mergeNameAndAddressRows(nameRows, addressRows) {
  const seen = new Set((nameRows || []).map((r) => r.id));
  const extra = (addressRows || []).filter((r) => r && !seen.has(r.id) && (seen.add(r.id), true));
  return [...(nameRows || []), ...extra];
}

let _lastAddressReport = { msg: "", at: 0 };
/** The address half failing must not hide the name results — but it must not be silent either
 *  (LOUD-FAILURE): record it to client_errors through this module's own client, at most once a
 *  minute per message, exactly like reportBrowseError. */
export function reportAddressSearchError(error, now = Date.now()) {
  try {
    const message = `food_places_search_by_address: ${(error && (error.message || error.code)) || "unknown error"}`;
    if (message === _lastAddressReport.msg && now - _lastAddressReport.at < 60000) return Promise.resolve(false);
    _lastAddressReport = { msg: message, at: now };
    if (!supabase) return Promise.resolve(false);
    const row = {
      build: typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev",
      module: "food", source: "food:address-search-rpc", message: message.slice(0, 500),
      url: typeof location !== "undefined" ? location.href : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    };
    return Promise.resolve(supabase.from("client_errors").insert(row)).then((r) => !(r && r.error), () => false);
  } catch (_) { return Promise.resolve(false); }
}

export async function searchPlacesByName(query, center, signal) {
  if (!supabase || !query || !query.trim()) return { data: [], error: null };
  const args = {
    p_query: query.trim(), p_cap: SEARCH_RESULT_CAP,
    p_center_lat: center?.lat ?? null, p_center_lon: center?.lon ?? null,
  };
  let nameCall = supabase.rpc("food_places_search_by_name", args);
  // B2051665: the name search only ever matches a restaurant's NAME, so a typed city or street
  // address found nothing. `food_places_search_by_address` (db/food.sql) matches every typed word
  // against the address; it runs in parallel and its rows are merged in (cap 30: enough to hold
  // the nearest matches without drowning the name results).
  let addrCall = supabase.rpc("food_places_search_by_address", { ...args, p_cap: 30 });
  if (signal) { nameCall = nameCall.abortSignal(signal); addrCall = addrCall.abortSignal(signal); } // NEW-1: a newer keystroke cancels these (lib/searchSession.js)
  const [nameRes, addrRes] = await Promise.all([nameCall, addrCall]);
  if (addrRes.error && !(signal && signal.aborted)) reportAddressSearchError(addrRes.error);
  const data = mergeNameAndAddressRows(nameRes.data || [], addrRes.error ? [] : (addrRes.data || []));
  return { data, error: nameRes.error };
}

/** Batch name/location lookup for a set of place ids — used to label the visit LIST, which
 *  can reference places far outside whatever the map happens to have in view right now. */
export async function fetchPlacesByIds(ids) {
  if (!supabase || !ids || ids.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.from("food_places").select("id,name,lat,lon,category,address").in("id", ids);
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

// The manual-pin identity keys live in lib/pinKeys.js (pure, no Supabase) so the restaurant-lists logic
// shares the same functions; re-exported here so every existing import is unchanged.
export { manualGroupKey, manualPinKey };

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

/** ── Per-dish ratings (B1873008, 2026-09-27) ──────────────────────────────────────────────────
 *  food_dishes: a dish actually HAD at a visit, with its own score/course/price/order-again/note
 *  — the opposite of food_dish_wishlist above (a dish NOT YET had). `place_id` is DENORMALISED
 *  FROM THE VISIT by a database trigger (db/food.sql's food_dishes_before_write) — never sent
 *  from here even when the caller already has it handy, so a client bug can never write a
 *  mismatched place_id. Fetched in full per signed-in user, the same small-personal-table
 *  pattern as every other table in this module. */

export async function fetchAllDishes() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from("food_dishes").select("*").order("created_at", { ascending: false });
  return { data: data || [], error };
}

export async function insertDish(dish) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { data: null, error: new Error("Sign in to add a dish") };
  const { place_id: _ignored, ...rest } = dish; // place_id is DB-derived, never client-supplied — see header
  const { data, error } = await supabase
    .from("food_dishes")
    .insert({ ...rest, user_id: uid })
    .select()
    .single();
  return { data, error };
}

export async function updateDish(id, patch) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { place_id: _ignoredPlace, visit_id: _ignoredVisit, ...rest } = patch; // both DB-derived/fixed — never re-sent
  const { data, error } = await supabase.from("food_dishes").update(rest).eq("id", id).select().single();
  return { data, error };
}

export async function deleteDish(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error } = await supabase.from("food_dishes").delete().eq("id", id);
  return { error };
}

/** ── Named restaurant lists (NEW-1 / B2088288) ───────────────────────────────────────────
 *  food_lists + food_list_items (db/food_lists.sql): a user-named GROUPING of places ("Lunch @ Work"),
 *  orthogonal to status — "been" is still food_visits, "want to try" is still food_wishlist, and
 *  nothing here is a status. A small personal pair of tables fetched in full, exactly like the
 *  wishlist; the membership logic itself (identity collapse, name uniqueness, status derivation) is
 *  the pure lib/foodLists.js, which has no Supabase import. Every write returns { data, error } so
 *  the UI can say so out loud (LOUD-FAILURE). Deleting a list cascades to ITS item rows only (the FK
 *  is on list_id) — never a visit, dish, rating or wishlist row. */

export async function fetchAllLists() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from("food_lists").select("*").order("position", { ascending: true }).order("created_at", { ascending: true });
  return { data: data || [], error };
}

export async function fetchAllListItems() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from("food_list_items").select("*").order("created_at", { ascending: true });
  return { data: data || [], error };
}

async function signedInUserId(message) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  return uid ? { uid } : { error: new Error(message) };
}

export async function createList({ name, color, position }) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { uid, error: authErr } = await signedInUserId("Sign in to make a list");
  if (authErr) return { data: null, error: authErr };
  const { data, error } = await supabase.from("food_lists").insert({ user_id: uid, name, color, position: position ?? 0 }).select().single();
  return { data, error };
}

/** Rename and/or recolour in place — `patch` is { name } and/or { color }. */
export async function updateList(id, patch) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error } = await supabase.from("food_lists").update(patch).eq("id", id);
  return { error };
}

/** Removes the list and (by the list_id cascade) its item rows — nothing else. */
export async function deleteList(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error } = await supabase.from("food_lists").delete().eq("id", id);
  return { error };
}

/** `identity` is { place_id } or { custom_name, custom_lat, custom_lon } — the same two shapes
 *  canonicalIdentity returns and food_wishlist stores. */
export async function addListItem(listId, identity, position = 0) {
  if (!supabase) return { data: null, error: new Error("Supabase not configured") };
  const { uid, error: authErr } = await signedInUserId("Sign in to use lists");
  if (authErr) return { data: null, error: authErr };
  const { data, error } = await supabase.from("food_list_items").insert({ ...identity, list_id: listId, user_id: uid, position }).select().single();
  return { data, error };
}

/** Deletes exactly one membership row — never the place, its visits, or its wishlist flag. */
export async function removeListItem(id) {
  if (!supabase) return { error: new Error("Supabase not configured") };
  const { error } = await supabase.from("food_list_items").delete().eq("id", id);
  return { error };
}
