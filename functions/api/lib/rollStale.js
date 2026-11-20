/* rollStale.js — is the INDEXED Harris answer behind a newer roll? (NEW-3, 2026-11-12; per-account rule 2026-11-15)
 *
 * `/api/taxunits` answers Harris from the Supabase shard index (cad_taxunit_shards), built once per roll year by hand
 * (B2158065 "Yearly refresh") and never refreshed by itself: when HCAD posts the next year's `Real_jur_exempt.zip` the index
 * keeps serving the old year, and nothing said so. This module decides — PURELY, from facts the handler reads — which of three
 * things is true so the caption can say it and ops can see it:
 *   current          the answer's roll year is this calendar year (or later)
 *   not-adopted      a newer roll file is absent, or THIS ACCOUNT'S units have not all posted a rate in it → serving the older year
 *                    is CORRECT ("2025 rates — 2026 not yet adopted")
 *   refresh-pending  a newer roll is published AND every unit on this account has adopted in it → the older answer is stale;
 *                    rebuild the index
 * THE TEST IS PER ACCOUNT, NOT PER ROLL. The first cut asked for 95 % of ALL Harris units to have a positive current rate;
 * measured live 2026-11-15 it said "not yet adopted" for an account whose units had ALL adopted 2026 (the live scan answered
 * it complete at 2026) because hundreds of small districts lag the big ones. "Adopted for this account" = exactly what
 * hcadUnits.buildUnits needs to answer it: each of the account's unit codes shows a positive current rate, or never levied
 * (prior = 0 and current = 0). A unit missing from the newer file is NOT adopted (never an alarm on a guess).
 */

/** Rate table (Map code → { prop, curr }) → a small JSON-able summary { adopted:[codes], zero:[codes] }. Pure. */
export function summariseRates(rates) {
  const adopted = [], zero = [];
  for (const [code, r] of (rates && typeof rates.entries === "function" ? rates.entries() : [])) {
    if (r.curr > 0) adopted.push(code);
    else if (!(r.prop > 0)) zero.push(code);
  }
  return { adopted, zero };
}

/** Has every one of `codes` adopted in this summary? Returns { ok, missing }. Pure. */
export function accountAdopted(summary, codes) {
  if (!summary) return { ok: false, missing: [...(codes || [])] };
  const have = new Set([...(summary.adopted || []), ...(summary.zero || [])]);
  const missing = (codes || []).filter((c) => !have.has(c));
  return { ok: !!(codes && codes.length) && !missing.length, missing };
}

/**
 * @param rollYear  the year of the indexed answer
 * @param nowYear   the calendar year
 * @param codes     the account's unit codes (from the indexed answer)
 * @param newer     [{ year, summary }] for each year in (rollYear, nowYear]; `summary` from summariseRates, or null when that
 *                  year's file is not published
 * @returns { state, stale, rollYear, newerYear?, missing? }
 */
export function decideStaleness({ rollYear, nowYear, codes = [], newer = [] }) {
  if (!(rollYear > 0) || rollYear >= nowYear) return { state: "current", stale: false, rollYear };
  const byYear = [...newer].sort((a, b) => b.year - a.year);
  let seen = null;
  for (const n of byYear) {
    if (!n.summary) continue;
    const a = accountAdopted(n.summary, codes);
    if (a.ok) return { state: "refresh-pending", stale: true, rollYear, newerYear: n.year };
    if (!seen) seen = { year: n.year, missing: a.missing };
  }
  return { state: "not-adopted", stale: false, rollYear, newerYear: seen ? seen.year : nowYear, ...(seen ? { missing: seen.missing } : {}) };
}

/** The caption suffix for a verdict, or null (nothing to add). Pure. */
export function staleCaption(v) {
  if (!v || v.state === "current" || !v.rollYear) return null;
  const y = v.newerYear || v.rollYear + 1;
  if (v.state === "refresh-pending") return `${v.rollYear} rates — newer roll published, refresh pending`;
  return `${v.rollYear} rates — ${y} not yet adopted`;
}
