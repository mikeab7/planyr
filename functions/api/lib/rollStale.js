/* rollStale.js — is the INDEXED Harris answer behind a newer roll? (NEW-3, 2026-11-12)
 *
 * `/api/taxunits` answers Harris from the Supabase shard index (cad_taxunit_shards), which is built once per roll year
 * by hand (B2158065 "Yearly refresh") and never refreshes itself: when HCAD posts the next year's `Real_jur_exempt.zip` the
 * index keeps serving the old year, and nothing said so. This module decides — PURELY, from facts the handler reads —
 * which of three things is true so the caption can say it and ops can see it:
 *   current          the answer's roll year is this calendar year (or later)
 *   not-adopted      a newer roll exists, or does not, but its rates are still placeholders (curr = 0 where last year's was
 *                    positive) → serving the older year is CORRECT ("2025 rates — 2026 not yet adopted")
 *   refresh-pending  a newer roll is published AND adopted (non-zero rates) → the older answer is stale; rebuild the index
 * "Adopted" = at least ADOPTED_SHARE of the units that levied last year show a positive current rate. A share, not "all":
 * one dormant district that never posts a rate must not hold the verdict at "not adopted" forever, and the verdict is only a
 * caption and an ops signal — each account's own answer is still complete-or-hidden (hcadUnits.buildUnits).
 */
export const ADOPTED_SHARE = 0.95;

/** Rate table (Map code → { prop, curr }) → { levied, adopted, share }. Pure. */
export function adoptionOf(rates) {
  let levied = 0, adopted = 0;
  for (const r of (rates && typeof rates.values === "function" ? rates.values() : [])) {
    if (!(r.prop > 0)) continue;
    levied++;
    if (r.curr > 0) adopted++;
  }
  return { levied, adopted, share: levied ? adopted / levied : 0 };
}

/**
 * @param rollYear  the year of the indexed answer
 * @param nowYear   the calendar year
 * @param newer     [{ year, rates }] for each year in (rollYear, nowYear] — `rates` a Map from parseRateTable, or null when
 *                  that year's file is not published
 * @returns { state, stale, rollYear, newerYear?, share? }
 */
export function decideStaleness({ rollYear, nowYear, newer = [] }) {
  if (!(rollYear > 0) || rollYear >= nowYear) return { state: "current", stale: false, rollYear };
  const byYear = [...newer].sort((a, b) => b.year - a.year);
  let seen = null;
  for (const n of byYear) {
    if (!n.rates || !n.rates.size) continue;
    const a = adoptionOf(n.rates);
    if (a.levied && a.share >= ADOPTED_SHARE) return { state: "refresh-pending", stale: true, rollYear, newerYear: n.year, share: a.share };
    if (!seen) seen = { year: n.year, share: a.share };
  }
  return { state: "not-adopted", stale: false, rollYear, newerYear: seen ? seen.year : nowYear, ...(seen ? { share: seen.share } : {}) };
}

/** The caption suffix for a verdict, or null (nothing to add). Pure. */
export function staleCaption(v) {
  if (!v || v.state === "current" || !v.rollYear) return null;
  const y = v.newerYear || v.rollYear + 1;
  if (v.state === "refresh-pending") return `${v.rollYear} rates — newer roll published, refresh pending`;
  return `${v.rollYear} rates — ${y} not yet adopted`;
}
