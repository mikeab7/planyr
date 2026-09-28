/* dishAggregates — pure aggregation over already-loaded food_dishes rows (B1873008, 2026-09-27).
 * No new round trip, no Supabase import — every function here reads only what FoodApp already
 * fetched, mirroring visitAggregates.js's own shape for food_visits.
 *
 * ⛔ THE ONE RULE THIS FILE EXISTS TO ENFORCE: a dish's score is its OWN, and food_visits.rating
 * is NEVER derived from it. Nothing here writes to a visit — every function is a pure read over
 * dish rows, returning numbers for the CALLER to display next to (never instead of) the visit's
 * own rating.
 *
 * `score`/`price_cents` are plain JS numbers already by the time they reach here (PostgREST hands
 * back `score` as a numeric STRING like every other numeric column in this module — callers
 * coerce with Number() at the read site, matching ratingColor.js's own convention — this file
 * accepts already-coerced numbers so it stays reusable from both live rows and test fixtures).
 */

const norm = (s) => (s || "").trim().toLowerCase();

/** Attaches each dish's own visit's `visited_on` (for "latest wins" ordering) — dishes don't
 *  carry their own visit date, so the caller passes a Map(visitId -> visit) it already has. */
export function withVisitDate(dishes, visitsById) {
  return dishes.map((d) => ({ ...d, visited_on: visitsById.get(d.visit_id)?.visited_on ?? null }));
}

function dishSortKey(d) {
  // Prefer the visit's own date (when a dish was actually eaten); fall back to the dish row's
  // own updated/created timestamp so an undated visit still orders sensibly against others.
  return d.visited_on || d.updated_at || d.created_at || "";
}

/** Every dish row belonging to any of `visitIds` — the one filter both a snapshot place (whose
 *  visits share a real place_id) and a manual pin (whose visits share no place_id at all, only a
 *  common (name, lat, lon) key) can use identically: both already resolve to a visitIds list
 *  before this is called (FoodApp's own `visitsForSelected`), so this never needs place_id at
 *  all for "what did I have HERE" — place_id (on the dish row) exists purely so a FUTURE
 *  cross-place query never needs a join, per the schema's own header. */
export function dishesForVisitIds(dishes, visitIds) {
  const ids = new Set(visitIds);
  return dishes.filter((d) => ids.has(d.visit_id));
}

/** Groups dishes by case/whitespace-insensitive name, each group's rows sorted NEWEST FIRST. */
export function groupDishesByName(dishesWithDate) {
  const groups = new Map();
  for (const d of dishesWithDate) {
    const key = norm(d.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  for (const rows of groups.values()) rows.sort((a, b) => (dishSortKey(b) < dishSortKey(a) ? -1 : dishSortKey(b) > dishSortKey(a) ? 1 : 0));
  return groups;
}

/** One row per distinct dish name — the place-detail Dishes table's own row shape. The LATEST
 *  instance's own score/course/price/order_again/note win (a dish had twice shows its latest
 *  score); every earlier instance rides along as `history` (oldest last), never discarded. */
export function dishRowsForTable(dishesWithDate) {
  const groups = groupDishesByName(dishesWithDate);
  return [...groups.entries()].map(([key, rows]) => {
    const [latest, ...history] = rows;
    return { key, ...latest, latestScore: latest.score, history, timesHad: rows.length };
  });
}

/** The place's own "best dish here" — the highest LATEST score among its deduped dish rows.
 *  null when nothing here has ever been scored. */
export function bestDishRow(dishRowsForPlace) {
  let best = null;
  for (const r of dishRowsForPlace) {
    if (r.latestScore == null) continue;
    if (best == null || Number(r.latestScore) > Number(best.latestScore)) best = r;
  }
  return best;
}

/** "The order" — every dish whose LATEST order_again is 'yes'. Never reads history: a dish
 *  marked "no" on its most recent visit drops out even if an earlier visit said "yes". */
export function theOrderEntries(dishRowsForPlace) {
  return dishRowsForPlace.filter((r) => r.order_again === "yes");
}

export function theOrderTotalCents(entries) {
  return entries.reduce((sum, r) => sum + (r.price_cents != null ? Number(r.price_cents) : 0), 0);
}

/** Cents -> "$12.50", formatted at the display edge only (the brief: "money in cents, formatted
 *  at the edge") — every stored/transmitted value stays an integer number of cents. */
export function formatCents(cents) {
  if (cents == null) return null;
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

/** THE ORDER's own "copy as plain text" button — one line per dish (with its price, when
 *  known), a trailing total line only when at least one entry actually has a price. */
export function theOrderAsText(entries) {
  const lines = entries.map((r) => (r.price_cents != null ? `${r.name} — ${formatCents(r.price_cents)}` : r.name));
  const hasPrice = entries.some((r) => r.price_cents != null);
  return hasPrice ? [...lines, `Total: ${formatCents(theOrderTotalCents(entries))}`].join("\n") : lines.join("\n");
}

/** The mean of a VISIT's own dish scores — shown next to (never instead of) that visit's own
 *  `rating`, read-only, so the owner can see the two diverge rather than one silently
 *  overwriting the other (the brief's own explicit rule). null when this visit has no scored
 *  dishes yet. */
export function meanDishScoreForVisit(dishes, visitId) {
  const scores = dishes.filter((d) => d.visit_id === visitId && d.score != null).map((d) => Number(d.score));
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Finds the open (not-done) food_dish_wishlist row a just-saved dish name satisfies, at the
 *  same place/manual-pin identity — the match that marks it done on save. `manualKeyOf` is
 *  injected (rather than importing manualGroupKey directly) purely to keep this file dependency-
 *  free of foodStore.js's Supabase-adjacent module; callers pass foodStore's own manualGroupKey. */
export function matchingOpenDishWishlist(wishlistRows, identity, dishName, manualKeyOf) {
  const name = norm(dishName);
  if (!name) return null;
  return (
    wishlistRows.find((w) => {
      if (w.done) return false;
      if (norm(w.dish_name) !== name) return false;
      if (identity.placeId) return w.place_id === identity.placeId;
      if (w.place_id) return false;
      return manualKeyOf(w.custom_name, w.custom_lat, w.custom_lon) === manualKeyOf(identity.customName, identity.customLat, identity.customLon);
    }) || null
  );
}
