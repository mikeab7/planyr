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

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

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

/* TYPO TOLERANCE (NEW-1, 2026-10-10). The RPC's word_similarity is literal-text, so a misspelled query
 * ("Carabas") scores 1.0 against a far-away row whose dirty stored name contains the same typo and only
 * ~0.5-0.8 against the correctly named nearby chain — and distance only breaks ties INSIDE a band. So the
 * client also scores a typo-tolerant name match: both sides are squashed (punctuation, spaces and doubled
 * letters dropped — "Carrabba's" → "carabas") and the query is compared, by edit distance with
 * transpositions, with the name's word-start windows. Zero edits scores 1.0, one edit 0.8, two (long
 * queries only) 0.6 — so the correctly named nearby row lands in the same band as the literal-typo rows and
 * distance then decides. It only ever RAISES a score (max with the RPC's), never lowers one. */
const squash = (s) => norm(s).replace(/ /g, "").replace(/(.)\1+/g, "$1");

/** Optimal-string-alignment distance (insert / delete / substitute / adjacent swap). */
export function editDistance(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  let pp = null, p = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const c = [i];
    for (let j = 1; j <= m; j++) {
      let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
      c[j] = v;
    }
    pp = p; p = c;
  }
  return p[m];
}

export const FUZZY_MIN_LEN = 4; // shorter queries are too ambiguous to tolerate an edit
export const FUZZY_TWO_EDIT_MIN_LEN = 6;

/** 0–1 typo-tolerant name score (0 = no near match). */
export function fuzzyNameScore(query, name) {
  const q = squash(query);
  if (q.length < FUZZY_MIN_LEN) return 0;
  const words = norm(name).split(" ").filter(Boolean);
  const maxD = q.length >= FUZZY_TWO_EDIT_MIN_LEN ? 2 : 1;
  let best = Infinity;
  // windows are whole-word runs of the name ("carabas", "carabasitalian", …), so a query is never
  // matched against the front half of a longer word
  for (let i = 0; i < words.length && i < 3; i++) {
    for (let k = i + 1; k <= Math.min(words.length, i + 3); k++) {
      const win = squash(words.slice(i, k).join(" "));
      if (win !== q && (win.startsWith(q) || q.startsWith(win))) continue; // a plain prefix either way: the RPC score covers it
      best = Math.min(best, editDistance(q, win));
    }
  }
  return best > maxD ? 0 : 1 - 0.2 * best; // 1.0 / 0.8 / 0.6: an edit always drops a full band below a clean hit
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
  s = Math.max(s, fuzzyNameScore(query, item.name));
  return item.isRegistryName ? s - REGISTRY_PENALTY : s;
}

export const GROUP_ONE_EDIT_MIN_LEN = 7; // below this a single edit is too ambiguous ("carrab" ~ "crab")

/** True when the row's WHOLE name is the query up to a typo: equal once punctuation, spaces and doubled
 *  letters are dropped ("Chik Fila", "Chik-fil-a", "Fadi's" for "Fadis"), or — for queries of
 *  GROUP_ONE_EDIT_MIN_LEN+ squashed letters — one edit away ("Whataburger" for "Whataburgr"). NEW-1
 *  (2026-10-11): such rows are ONE comparable group — a far-away stray spelled exactly like the typo must
 *  not out-rank the correctly named place next door, so in-view / distance decide inside the group (owner:
 *  "misspell something slightly and still pull up the right thing"). Deliberately WHOLE-name only: a longer
 *  name that merely starts with the query ("Pho Saigon Express Kitchen Bar", unless the row carries a `brand`
 *  — a chain location such as "Fadi's Mediterranean Grill" for "Fadis") or a two-edit lookalike
 *  ("Caramba Street Food") is not the same place, so a far exact name still beats those. Address-only exact
 *  hits are not name-equivalent. */
export function nameEquivalent(query, item) {
  const q = squash(query);
  if (q.length < 2) return false;
  const d = editDistance(q, squash(item.name));
  if (d === 0 || (d === 1 && q.length >= GROUP_ONE_EDIT_MIN_LEN)) return true;
  // a CHAIN location ("Fadi's Mediterranean Grill", brand set) whose name starts with the typed name
  if (!item.brand) return false;
  const words = norm(item.name).split(" ").filter(Boolean);
  for (let k = 1; k < Math.min(words.length, 3); k++) if (squash(words.slice(0, k).join(" ")) === q) return true;
  return false;
}

/** A group member that should sort after clean, street-addressed ones: a registry (LLC/Inc) name, or an
 *  address with no street number ("Plano, TX") — the REGISTRY_PENALTY idea, applied inside the group. */
const weakGroupRow = (item) => Boolean(item.isRegistryName) || (Boolean(item.address) && !/\d/.test(item.address));

/** Sort `items` (each {lat, lon, name, address?, sim?, mine?, isRegistryName?}) nearest-first for
 *  the current `bounds`. Returns a new array; with no bounds the input order is kept. Nothing is
 *  removed. Stable: ties keep their incoming order. */
export function rankByProximity(query, items, bounds) {
  const center = centerOf(bounds);
  const rows = (items || []).map((item, idx) => ({
    item, idx,
    score: textScore(query, item),
    group: nameEquivalent(query, item),
    inView: inBounds(bounds, item),
    km: center && item.lat != null && item.lon != null ? haversineKm(center, item) : Infinity,
  }));
  if (!center) return rows.map((r) => r.item);
  // typo-equivalent names form one top group (see nameEquivalent); a real match, so never below the lead bar
  for (const r of rows) if (r.group && r.score >= SAVED_LEAD_MIN_SCORE - 0.2) r.score = Math.max(r.score, EXACT_SCORE);

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
    (a.band === 0 ? Number(weakGroupRow(a.item)) - Number(weakGroupRow(b.item)) : 0) ||
    (Number(b.inView) - Number(a.inView)) ||
    (eff(a) - eff(b) || 0) ||
    (a.idx - b.idx));
  return rows.map((r) => r.item);
}
