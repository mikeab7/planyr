/* visitAggregates — pure aggregation over a place's already-loaded pastVisits array (NEW-2,
 * owner: "Make this a world class interface... right now it's lacking. No aggregates at all.
 * He cannot see his average food score, his ambiance average, how many times he has been, when
 * he last went, or what he typically spends - all of which are already in food_visits and cost
 * nothing to compute"). Every function here reads ONLY the visits already fetched for the
 * selected place (FoodApp's `visitsForSelected`) — no new round trip per place, no new query.
 *
 * rating/rating_ambiance/cost are Postgres `numeric` columns, which PostgREST returns as JSON
 * STRINGS ("7.5") to avoid float-precision loss over the wire — every mean here coerces through
 * Number() first, the same reason foodStore.js's avgRatingByPlaceId already does.
 */

const num = (v) => (v == null ? null : Number(v));

function mean(values) {
  const nums = values.map(num).filter((n) => n != null && Number.isFinite(n));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** visitCount counts EVERY visit, dated or not — "Visits with a null date are excluded from
 *  first/last but still counted in Visits" (NEW-2). lastVisitDate/firstVisitDate are the raw
 *  "YYYY-MM-DD" strings (or null if no visit at this place has ever been dated), for
 *  dateFormat.js to render — this module does no date FORMATTING, only picks the values. */
export function computeVisitAggregates(pastVisits) {
  const visits = pastVisits || [];
  const dated = visits.filter((v) => v.visited_on).map((v) => v.visited_on).sort();
  return {
    visitCount: visits.length,
    avgFood: mean(visits.map((v) => v.rating)),
    avgAmbiance: mean(visits.map((v) => v.rating_ambiance)),
    avgCost: mean(visits.map((v) => v.cost)),
    lastVisitDate: dated.length ? dated[dated.length - 1] : null,
    firstVisitDate: dated.length ? dated[0] : null,
  };
}

/** The "Order again" block's entries (NEW-2): every visit's what_was_good, newest-first,
 *  DEDUPED on identical text — never split on commas/parsed into dishes (that would reopen the
 *  "no dish taxonomy" decision this repo already made for what_was_good, see VisitPanel.jsx's
 *  header). Relies on pastVisits already arriving newest-first (foodStore.fetchAllVisits orders
 *  by visited_on desc, nullsFirst:false) — this function preserves that order, it doesn't re-sort. */
export function orderAgainEntries(pastVisits) {
  const seen = new Set();
  const out = [];
  for (const v of pastVisits || []) {
    const text = v.what_was_good;
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}
