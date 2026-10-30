/* browseReuse — when does a map move NOT need another trip to the database? (B2559168)
 *
 * The browse call (`food_places_in_bounds_sampled`) used to run on every 'moveend'. If the last
 * answer came back UNCAPPED — every place in that box was returned, nothing sampled away — then
 * any later box that sits entirely inside it has already been answered in full: the pins for it
 * are in `places` right now, and the extra ones outside the new view are simply off-screen.
 * A CAPPED answer is a sample spread over its box, so a smaller box needs its own (denser)
 * sample and is never reused. A failed answer is never recorded as `last`, and a Retry press
 * (a new `retry` value) always goes to the database.
 *
 * Pure — no Supabase, no React — so the rule is unit-tested (test/foodBrowseReuse.test.js).
 */

const finite = (n) => typeof n === "number" && Number.isFinite(n);

/** True when box `inner` lies entirely within box `outer` (both {south, north, west, east}). */
export function boundsContain(outer, inner) {
  if (!outer || !inner) return false;
  const { south: os, north: on, west: ow, east: oe } = outer;
  const { south: is, north: inn, west: iw, east: ie } = inner;
  if (![os, on, ow, oe, is, inn, iw, ie].every(finite)) return false;
  return is >= os && inn <= on && iw >= ow && ie <= oe;
}

/** `last` = { bounds, capped, retry } of the most recent SUCCESSFUL browse (or null/undefined).
 *  Returns true when the new view can be served from what is already on the map. */
export function canReuseBrowse(last, nextBounds, retry) {
  if (!last || last.capped) return false;
  if (last.retry !== retry) return false;
  return boundsContain(last.bounds, nextBounds);
}
