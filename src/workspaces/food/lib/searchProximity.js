/* searchProximity — orders the Food search dropdown nearest-to-the-map-view first (B2051664).
 *
 * Owner: "the search should default to the locations closest to where the map screen is currently
 * hovering, in order." A LOCATION BIAS, never a filter: nothing is dropped, far matches simply
 * sort after near ones.
 *
 * WHAT THE PLACE-SEARCH PROVIDER SUPPORTS (read from the code, as asked): the only provider is
 * `food_places_search_by_name` (db/food.sql), a name-only trigram lookup. It has no viewport /
 * bounds parameter, only an optional centre point it uses as a TIEBREAK after similarity (and only
 * inside its own top-`p_cap` cut). So the bias is applied CLIENT SIDE, over a larger candidate pool
 * (`foodStore.searchPlacesByName` now asks for more rows), across every source at once — saved
 * pins, snapshot rows and live (Overpass) rows — which is also what lets a saved place and a
 * place-search row at a similar distance be compared on one scale.
 *
 * THE ORDER, most significant first:
 *   1. TEXT BAND. A strong text match outranks proximity. Every candidate gets a text score
 *      (`textScore`); an EXACT hit (name equals the query, or the address contains the whole typed
 *      address) sits above all non-exact matches, so a far-away exact name/address is never buried
 *      by a weak nearby fuzzy one. Remaining scores are grouped into bands (a band ends when the
 *      score falls `BAND_WIDTH` below the band's best) — "comparable matches".
 *   2. IN VIEW first, then 3. distance from the map centre, outward. Inside a band only.
 *   0. (Above all of the above.) His SAVED places that genuinely match the text lead, wherever the
 *      map is looking — logged first, then want-to-try. The 2026-10 report ("you can't search for
 *      restaurants I've saved") reversed the earlier demotion of this rule to a distance head start.
 *   4. `MINE_HEAD_START_KM` stays as a tiebreak for his places that do not clear the lead bar.
 *
 * Pure — no Supabase, no React. */

export const BAND_WIDTH = 0.15; // two scores this close are "comparable matches"
export const EXACT_SCORE = 1.5; // above any non-exact score (max 1.0)
export const REGISTRY_PENALTY = 0.2; // LLC/Inc-style registry names sit a band below clean names
export const MINE_HEAD_START_KM = 0.2;
export const SAVED_LEAD_MIN_SCORE = 0.5; // a saved place must really match to jump the queue
export const MIN_ADDRESS_QUERY_LEN = 8; // "a full street address" — short fragments never count as exact

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function centerOf(bounds) {
  if (!bounds) return null;
  return { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2 };
}

export function inBounds(bounds, p) {
  if (!bounds || p.lat == null || p.lon == null) return false;
  return p.lat >= bounds.south && p.lat <= bounds.north && p.lon >= bounds.west && p.lon <= bounds.east;
}

/** 0–1 text score, or EXACT_SCORE for an exact name / full-address hit. `sim` (the RPC's
 *  word_similarity) is trusted when the row carries one; saved/live rows have none, so a name that
 *  contains the whole query scores 1.0 (the same value word_similarity gives that case) and
 *  otherwise the share of query words the name+address cover. */
export function textScore(query, item) {
  const q = norm(query);
  if (!q) return 0;
  const name = norm(item.name);
  if (name === q) return EXACT_SCORE;
  if (q.length >= MIN_ADDRESS_QUERY_LEN && /\d/.test(q) && norm(item.address).includes(q)) return EXACT_SCORE;
  // Punctuation-blind: "daon" is in "DAO'N Korean…" (norm() splits it into "dao n" and misses).
  const cq = q.replace(/ /g, ""), cn = name.replace(/ /g, "");
  if (cq.length >= 2 && cn === cq) return EXACT_SCORE;
  let s;
  if (typeof item.sim === "number") s = item.sim;
  else if (name.includes(q) || (cq.length >= 2 && cn.includes(cq))) s = 1;
  else {
    const hay = `${name} ${norm(item.address)}`;
    const words = q.split(" ").filter((w) => w.length >= 2);
    s = words.length ? words.filter((w) => hay.includes(w)).length / words.length : 0;
  }
  return item.isRegistryName ? s - REGISTRY_PENALTY : s;
}

/** Sort `items` (each {lat, lon, name, address?, sim?, mine?, isRegistryName?}) nearest-first for
 *  the current `bounds`. Returns a new array; with no bounds the input order is kept. Nothing is
 *  removed. Stable: ties keep their incoming order. */
export function rankByProximity(query, items, bounds) {
  const center = centerOf(bounds);
  const rows = (items || []).map((item, idx) => ({
    item, idx,
    score: textScore(query, item),
    inView: inBounds(bounds, item),
    km: center && item.lat != null && item.lon != null ? haversineKm(center, item) : Infinity,
  }));
  if (!center) return rows.map((r) => r.item);

  // band by walking scores high → low; chained from each band's best so it stays transitive
  const byScore = [...rows].sort((a, b) => b.score - a.score);
  let bandStart = Infinity, band = -1;
  for (const r of byScore) {
    if (r.score >= EXACT_SCORE) { r.band = 0; bandStart = Infinity; band = 0; continue; }
    if (band < 1 || r.score < bandStart - BAND_WIDTH) { band = Math.max(1, band + 1); bandStart = r.score; }
    r.band = band;
  }
  // His saved places (logged first, then want-to-try) lead whenever they genuinely match the text —
  // wherever the map is looking (owner 2026-10-04). Everything else keeps the nearest-first order.
  const lead = (r) => (r.score < SAVED_LEAD_MIN_SCORE ? 2 : r.item.mine ? 0 : r.item.wishlisted ? 1 : 2);
  const eff = (r) => r.km - (r.item.mine ? MINE_HEAD_START_KM : 0);
  rows.sort((a, b) =>
    (lead(a) - lead(b)) ||
    (a.band - b.band) ||
    (Number(b.inView) - Number(a.inView)) ||
    (eff(a) - eff(b) || 0) ||
    (a.idx - b.idx));
  return rows.map((r) => r.item);
}
