/* searchQuality — turns the raw candidates `food_places_search_by_name` (db/food.sql) returns
 * into what the search dropdown actually shows: real matches only, cleanest record first, one
 * pin per real-world location. Three defects, one file, because all three showed up in the SAME
 * repro (B709697 — owner searched "fadis", the panel showed a corrupted concatenated-address row
 * ahead of two clean 0.99-confidence records for the same brand) and share the same fix shape:
 * filter/rank the CANDIDATE LIST the RPC already returned — never touch food_places rows.
 *
 * ⛔ WHY "STRONG MATCH" IS WORD COVERAGE, NOT A SIMILARITY-SCORE CUTOFF (B709696 — owner searched
 * "Cowboy Japanese BBQ&Sushi", a real Westheimer restaurant absent from the snapshot; the app
 * returned ten unrelated Japanese places with no indication nothing matched). Measured directly
 * against production (82,310 rows, 2026-08-23) before choosing a design:
 *   - The RPC's word_similarity() score for that query topped out at 0.615 (best: "Kansha
 *     Japanese Sushi Bistro") — every one of those ten results shares "japanese"/"sushi" with the
 *     query, but NONE of them contain "cowboy" anywhere.
 *   - A single raw threshold cannot separate that from a genuine match: real typo'd matches score
 *     LOWER than that garbage in real cases ("chiptle" -> "Chipotle" scores 0.545) while OTHER
 *     garbage scores HIGHER ("chilis restaurant" -> "El Viejo Solis Restaurant Corporation"
 *     scores 0.777, because "restaurant" alone is enough to win on trigram overlap — 3,225 of the
 *     snapshot's names contain that one word). word_similarity() rewards the best-matching SPAN,
 *     so a query with one absent, distinguishing word ("cowboy", "chilis", "wendys") can still
 *     score high against a name that only shares its generic descriptor words.
 *   - What actually separates them: does the candidate's name (or its address, for a query that
 *     adds a place/street qualifier like "fadis westheimer") contain something close to EVERY
 *     distinguishing word the owner typed? "cowboy" appears in zero candidates' name or address.
 *     "chilis"/"wendys"/"bell" (the brand word once "restaurant"/"drive"/"thru" are stripped as
 *     generic) likewise appear in none of the garbage candidates that were fooling a raw
 *     similarity cutoff. So STRONG MATCH here is defined as word-coverage against the query's own
 *     significant words, not a magic number on the RPC's own ranking score.
 *
 * ⛔ WHY CONFIDENCE IS A DE-RANK SIGNAL, NOT A HARD FLOOR (B709697). Sampled food_places directly
 * across confidence bands 0.50-0.60 (the very bottom — nothing scores lower) through 0.75-0.90:
 * every band is dominated by completely ordinary, real restaurants (Starbucks, Waffle House,
 * Subway, Taco Bueno, Whataburger …) — there is no confidence cut where "below this = bad" holds
 * up under inspection. A hard floor at 0.80 (the number the report proposed) would silently
 * remove 11,343 real rows (13.8% of the snapshot) for no measured quality gain. What confidence
 * DOES do reliably: break a tie between near-identical records for the SAME brand/location — the
 * repro's own "fadis" search had three exact-name-match candidates (sim 1.0) and confidence was
 * the signal that told the clean meta/BrightQuery records (0.95-0.99) apart from the corrupted
 * Foursquare one (0.77) — so it's used here purely as a sort tiebreaker, never a filter.
 */

// ── "strong match": word coverage ─────────────────────────────────────────────────────────────
export const SIGNIFICANT_WORD_MIN_LEN = 3; // drop "a", "of" — too short to carry any meaning

// Generic restaurant-domain words, stripped before judging distinctiveness — measured against
// production (82,310 rows, 2026-08-23): "restaurant" appears in 3,225 names, "grill" in 3,533,
// "bar" in 3,802, "kitchen" in 1,847, "cafe" in 3,131, "house" in 1,452. A query built from one of
// these plus a single brand word ("chilis restaurant", "wendys drive thru") must not be satisfied
// by ANY candidate carrying the generic word alone — only the brand word counts as "distinguishing".
export const GENERIC_NAME_WORDS = new Set([
  "restaurant", "grill", "bar", "house", "kitchen", "cafe", "shop", "eatery", "diner", "place",
  "drive", "thru", "and", "the", "of", "a", "an",
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= SIGNIFICANT_WORD_MIN_LEN);
}

function significantWords(query) {
  const all = tokenize(query);
  const stripped = all.filter((w) => !GENERIC_NAME_WORDS.has(w));
  // A query that's ENTIRELY generic words ("the kitchen") has nothing to strip down to — fall
  // back to the unstripped list rather than requiring coverage of zero words (which would let
  // everything through).
  return stripped.length ? stripped : all;
}

// Small, dependency-free Levenshtein — words here are short (typically 3-15 chars), so the O(n*m)
// DP table is trivial cost per candidate.
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

// Typo tolerance scales with word length — measured against real typo'd searches ("gardn"->
// "garden", "expres"->"express", "whataburgr"->"whataburger" all differ by exactly one edit).
// Short words (<=4 chars) get NO tolerance: at that length a 1-edit allowance starts matching
// unrelated words ("taco" ~ "taro").
function editToleranceFor(len) {
  if (len <= 4) return 0;
  if (len <= 9) return 1;
  return 2;
}

function wordsRoughlyMatch(a, b) {
  if (a === b) return true;
  // Prefix match handles partial/abbreviated typing ("mcdon" -> "mcdonald's") that a small edit-
  // distance budget can't reach (three characters short, not three typos).
  if (a.length >= 3 && b.length >= 3 && (b.startsWith(a) || a.startsWith(b))) return true;
  const tolerance = editToleranceFor(Math.max(a.length, b.length));
  return tolerance > 0 && editDistance(a, b) <= tolerance;
}

/** Does `name`/`address` contain something close to every distinguishing word in `query`? See
 *  the file header for why this — not a raw similarity score — is what "strong match" means
 *  here. `address` is included so a query that adds a location qualifier ("fadis westheimer",
 *  "pho saigon houston") still resolves against the candidate's own street/city text. */
export function isStrongMatch(query, name, address) {
  const words = significantWords(query);
  if (!words.length) return true; // nothing distinguishing was typed — don't gate on it
  const haystack = tokenize(`${name || ""} ${address || ""}`);
  const covered = words.filter((w) => haystack.some((h) => wordsRoughlyMatch(w, h)));
  // <=3 distinguishing words: ALL must be present (a 2-word "chilis restaurant" query still
  // requires "chilis" itself). 4+: allow one miss, since a longer query is more likely to carry
  // an incidental extra descriptor that a real match's name/address just doesn't happen to echo.
  const required = words.length <= 3 ? words.length : Math.ceil(words.length * 0.75);
  return covered.length >= required;
}

// ── registry-style names ──────────────────────────────────────────────────────────────────────
// The report's own regex (translated from Postgres's `\y` word-boundary to JS's `\b` — same
// meaning, different engine syntax), reused verbatim otherwise — measured 3,371 matching rows in
// production (the report's manual count was 3,403; both counts move as the snapshot is
// periodically reloaded per the module's CLAUDE.md, so this isn't drift — see BACKLOG for the note).
export const REGISTRY_NAME_PATTERN = /\b(llc|inc|corp|holdings|management)\b/i;

export function isRegistryName(name) {
  return REGISTRY_NAME_PATTERN.test(name || "");
}

// ── concatenated (corrupted) addresses ────────────────────────────────────────────────────────
// Matches "<street>, <city>, <ST> <zip> and <street2>, ..." — two full addresses smashed into one
// field by the upstream source. Deliberately narrow: it must find a second, digit-led street
// segment straight after a real zip code, so it does NOT fire on a Texas place name that happens
// to contain "and" ("Cut and Shoot, TX", "Town and Country Way") — verified against production,
// where those account for the large majority of addresses containing the literal word "and".
export const CONCAT_ADDRESS_PATTERN = /\d{5}(?:-\d{4})?\s+and\s+\d+\s+\S/i;

export function hasConcatenatedAddress(address) {
  return CONCAT_ADDRESS_PATTERN.test(address || "");
}

// ── near-duplicate collapse ───────────────────────────────────────────────────────────────────
// Radius chosen from measured production pairs: the snapshot's two known same-location, multiple-
// source duplicates for the same brand sit 25.8m and 38.9m apart (a Foursquare/BrightQuery record
// and a meta record for the identical storefront); the CLOSEST pair of genuinely distinct
// same-brand locations (two different Fadi's) sits ~3,540m apart. 150m sits in the gap — well
// clear of geocoding jitter, nowhere near normal inter-tenant spacing.
export const DEDUPE_RADIUS_METERS = 150;

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The full pipeline: exclude known-corrupted rows, exclude weak matches (see isStrongMatch),
 *  rank clean/high-confidence/non-registry records first, then collapse near-duplicate records
 *  of the same real-world spot down to one. `protectedIds` (his own logged visits + "want to
 *  try" flags) is exempted from the strong-match filter — a place he's already vetted stays
 *  findable even if its name fuzzy-matches the query oddly — and is NEVER dropped by dedup, so a
 *  search can never stop resolving to the specific place-id an existing visit or flag points at.
 *  Chain locations that are genuinely far apart (km-scale, not the ~30m of a real duplicate) are
 *  untouched — each stays independently selectable. */
export function rankSearchCandidates(query, rawResults, protectedIds = new Set()) {
  const isProtected = (r) => protectedIds.has(r.id);

  const survivors = (rawResults || []).filter((r) => {
    if (isProtected(r)) return true;
    if (hasConcatenatedAddress(r.address)) return false;
    return isStrongMatch(query, r.name, r.address);
  });

  const ranked = survivors
    .map((r) => ({ ...r, isRegistryName: isRegistryName(r.name) }))
    .sort((a, b) => {
      const aMine = isProtected(a) ? 0 : 1, bMine = isProtected(b) ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      const aReg = a.isRegistryName ? 1 : 0, bReg = b.isRegistryName ? 1 : 0;
      if (aReg !== bReg) return aReg - bReg; // non-registry names always outrank registry ones
      const simDiff = (b.sim ?? 0) - (a.sim ?? 0);
      if (simDiff) return simDiff;
      const confDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
      if (confDiff) return confDiff;
      const distA = a.distance_km ?? Infinity, distB = b.distance_km ?? Infinity;
      if (distA !== distB) return distA - distB;
      return (a.name || "").localeCompare(b.name || "");
    });

  const kept = [];
  for (const r of ranked) {
    if (!isProtected(r) && kept.some((k) => haversineMeters(k, r) < DEDUPE_RADIUS_METERS)) continue;
    kept.push(r);
  }
  return kept;
}
