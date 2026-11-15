/* Ag-use valuation (Texas "1-d-1") — the rollback-tax line on a county parcel page (NEW-1, sweep 2026-11-12).
 *
 * A Texas lot appraised on its agricultural PRODUCTIVITY value instead of its market value (state class 1D1 on
 * Harris/HCAD, Land_State_Code D1 on Fort Bend/FBCAD) owes an ADDITIONAL "rollback" tax if its use changes —
 * exactly what a developer buying it for a building does. The parcel page says so, in one muted line.
 *
 * DESIGN RULES (the gradingRules.js / detentionRules.js house discipline; owner constraint #4):
 *   • The rule is a DATA RECORD with provenance, never a bare constant in a sentence. The line is composed FROM the
 *     record (the look-back years, the section), and a malformed record shows NOTHING (and logs) — never a naked number.
 *   • TEXAS ONLY (owner constraint #3): `agUseOf` answers for a Texas county and nothing else. A `state_class`-named
 *     column on a non-Texas service is not a Texas ag valuation.
 *   • The county's own money figures are shown only when both are real and the productivity value is below market
 *     (otherwise the lot is not actually getting a break and the class line stands alone).
 *   • Fort Bend publishes the class (Land_State_Code D1) but no productivity value — measured 2026-11-12 — so its
 *     line carries the class and the rule, no dollar figures.
 *
 * Pure, no DOM. */

export const AG_USE_RULES = {
  txRollback: {
    id: "txRollback",
    label: "Texas ag-use rollback tax",
    appliesTo: "land appraised as qualified open-space (1-d-1) agricultural land in Texas",
    lookbackYears: 3,
    interestOnAdditionalTax: false,
    verified: true,
    basis: "published",
    source: {
      name: "Texas Tax Code §23.55 (change of use of land); Texas Comptroller, rollback tax guidance",
      section: "§23.55",
      url: "https://comptroller.texas.gov/taxes/property-tax/bills/landuse-bills.php",
      shortCite: "Tax Code §23.55",
    },
    sourceDate: "2026-11-12",
    note: "Three prior years' tax difference (market vs productivity) when the use changes; HB 1743 (2019) cut the look-back from five years to three and HB 3833 (2021) removed the interest on the additional tax. Unpaid rollback bills still draw ordinary delinquency penalties and interest. Exceptions (right-of-way sale, condemnation, transfer to a public body) are in §23.55(f). Screening only — the chief appraiser's bill governs.",
  },
};

/** The record behind the Texas line, or null when it is malformed (LOUD: logged once per call site, shows nothing). */
export function validAgUseRule(rule) {
  const r = rule;
  const ok = !!r && r.id === "txRollback"
    && Number.isInteger(r.lookbackYears) && r.lookbackYears > 0 && r.lookbackYears <= 10
    && r.source && typeof r.source.shortCite === "string" && r.source.shortCite.length > 0
    && typeof r.sourceDate === "string" && r.basis === "published";
  return ok ? r : null;
}

/** A county class code for land taxed on its ag-use value: 1D1 (HCAD), 1D / D1 (state category D1). */
export const AG_USE_CLASS = /^(1D1?|D1)$/i;

const leaf = (k) => String(k).split(".").pop();
const find = (attrs, re) => { const k = Object.keys(attrs || {}).find((key) => re.test(leaf(key))); return k == null ? undefined : attrs[k]; };
const num = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };

/**
 * The ag-use facts of a county record, or null.
 * @param attrs the county's attribute bag
 * @param opts.state the county's state ("TX" is the only one this answers for)
 * @returns { classCode, market, productivity, ruleId } | null — market / productivity are null when the county does not publish both.
 */
export function agUseOf(attrs, { state = null } = {}) {
  if (!attrs || state !== "TX") return null;
  // Harris/HCAD: state_class ("1D1") beside productivity_value / total_market_val.
  const hcad = find(attrs, /^state_class$/i);
  // Fort Bend/FBCAD: Land_State_Code ("D1"), no productivity value published.
  const fbcad = find(attrs, /^land_state_code$/i);
  const raw = [hcad, fbcad].map((v) => (v == null ? "" : String(v).trim())).find((v) => AG_USE_CLASS.test(v));
  if (!raw) return null;
  const productivity = num(find(attrs, /^productivity_value$/i));
  const market = num(find(attrs, /^total_market_val$/i));
  const both = productivity != null && market != null && productivity >= 0 && market > 0 && productivity < market;
  return { classCode: raw.toUpperCase(), market: both ? market : null, productivity: both ? productivity : null, ruleId: "txRollback" };
}

/** $1.95M above a million, else the whole-dollar figure with thousands separators ($10,078). */
export function agMoney(n) {
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * The one muted line for the parcel page, composed FROM the rule record; null when there is no ag use, or the record is malformed.
 * "Ag-use valuation (1D1) — a change of use triggers rollback taxes (3 prior years, Tax Code §23.55); market $1.95M vs productivity $10,078"
 */
export function agUseLine(agUse, rules = AG_USE_RULES) {
  if (!agUse) return null;
  const rule = validAgUseRule(rules[agUse.ruleId]);
  if (!rule) {
    if (typeof console !== "undefined") console.error("[agUse] rule record missing or malformed — ag-use line suppressed", agUse.ruleId);
    return null;
  }
  const years = rule.lookbackYears === 1 ? "1 prior year" : `${rule.lookbackYears} prior years`;
  const figures = agUse.market != null && agUse.productivity != null ? `; market ${agMoney(agUse.market)} vs productivity ${agMoney(agUse.productivity)}` : "";
  return `Ag-use valuation (${agUse.classCode}) — a change of use triggers rollback taxes (${years}, ${rule.source.shortCite})${figures}`;
}
