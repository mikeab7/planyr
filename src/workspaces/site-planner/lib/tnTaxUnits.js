/* tnTaxUnits.js — Tennessee taxing units + certified rates for the parcel page's "Tax rates" table
 * (Rutherford County and Nashville / Davidson County). PURE: no network, no DOM.
 *
 * WHY IT IS ATTRIBUTE-DRIVEN (not a /api/taxunits call like Harris): both counties publish each lot's taxing
 * district ON the parcel layer itself, so the stored lot already carries the membership —
 *   Rutherford  ParcelsCAMA1/FeatureServer/0   DistrictGroup ("515 - Murfreesboro")  AccountType ("09 - Industrial")
 *                                              TotalAssessedValue  TAXYEAR
 *               DistrictGroup is the TAXING district (000 county only · 227 Eagleville · 400 La Vergne · 515 Murfreesboro ·
 *               674 Smyrna = county + that city). NEVER CITY/CITYCODE — those are the postal city.
 *   Davidson    Parcels_view/FeatureServer/0    TaxDist, published WITH A TRAILING SPACE ("USD ", "GSD ") — always trimmed.
 *               USD / GSD = Metro's two service districts; BM / GO / RT / OH = satellite cities (GSD + the city's own levy);
 *               BH / FH = satellite cities; CBID / GBID / MBID / SNDG / SNDU = business-improvement districts.
 *
 * COMPLETE-OR-HIDDEN (owner rule, taxRates.js header; B2158065): a lot is shown only when every unit that taxes it is
 * known with a sourced rate. A code this file does not know, a code whose extra levy is not sourced (a BID, Berry Hill),
 * a null / UNASSIGNED district → `null` (hidden). Never a partial total, never an average, never a Texas number (owner
 * constraint #3: nothing here reads harrisTaxRates / comptroller Texas files, and a Tennessee county that is not in
 * TN_TAX_COUNTIES never gets a table from this file).
 *
 * RULE RECORD (owner constraint #4): every rate below is the TN Comptroller's certified 2025 figure, read from the
 * "2025 Tax Aggregate Report", Table VI "Actual Tax Rates" (county + city/SSD columns, "2025 ACTUAL TAX RATES"),
 * downloaded 2026-11-15: https://comptroller.tn.gov/content/dam/cot/pa/documents/tax-aggregate-reports/2025TaxAggregateReport.pdf
 *   RUTHERFORD 1.8762 · EAGLEVILLE 0.4051 · LAVERGNE 0.5363 · MURFREESBORO 0.9526 · SMYRNA 0.5257
 *   DAVIDSON (GSD) 2.7820 · NASHVILLE (the USD add-on) 0.0320 → USD 2.8140 · BELLE MEADE 0.3011 · GOODLETTSVILLE 0.5068
 *   · RIDGETOP 0.3490. Cross-checked against the MTIDA 2026 community profiles (Murfreesboro / Smyrna / La Vergne) which
 *   print the same three city rates and the county's 1.8762 as "Property Taxes (2025)".
 * ⚠ The dispatch said Eagleville 0.41 (a secondary site's rounding); the Comptroller's table says 0.4051 — the table wins.
 * Oak Hill and Forest Hills are NOT in the Comptroller's table (it lists a municipality only if it levies a property
 * tax; its own introduction says so), and Oak Hill's own site and Forest Hills' own About page say they levy none — so
 * they are the county's GSD alone, stated on the page. Berry Hill is absent from the table too, but no statement from
 * the city itself was reachable, so it stays HIDDEN until one is (B-NEW-3: confirm from the city's FY2026 budget).
 *
 * TAX YEAR: the layers' assessed values are TAXYEAR 2026; the 2026 rates are not certified in the Comptroller's table yet,
 * so the table is captioned "2025 rates" and any dollar estimate says plainly that it multiplies the 2026 assessed value
 * by 2025 rates (Rutherford is mid-reappraisal — the real 2026 bill can differ a lot; the estimate is a screen, not a bill).
 *
 * ASSESSMENT RATIOS (Tenn. Const. art. II §28; TCA 67-5-801), Rutherford only because it is the one county whose layer
 * carries a class: industrial & commercial 40% · residential & farm 25% · personal 30% · public utility 55%. Davidson's
 * layer has no class field (LUCode / LUDesc is the only basis) → rate table, NO dollar estimate. */
import { usdWhole } from "../../../shared/units/numberFormat.js";

const r6 = (n) => Math.round(n * 1e6) / 1e6; // (taxRates.js owns the same helper; not imported to keep this file import-free and cycle-free)

export const TN_RATE_YEAR = 2025;
export const TN_SOURCE = "Tennessee Comptroller — 2025 Tax Aggregate Report, Table VI (actual tax rates)";
export const TN_SOURCE_URL = "https://comptroller.tn.gov/content/dam/cot/pa/documents/tax-aggregate-reports/2025TaxAggregateReport.pdf";

/** County keys (counties.js registry) this module serves. */
export const TN_TAX_COUNTIES = ["tn_rutherford", "tn_davidson"];
export const isTnTaxCounty = (county) => TN_TAX_COUNTIES.includes(county);

/** The dated, cited rate table. rate = per $100 of ASSESSED value, 2025. */
export const TN_RATES = {
  rutherford: { name: "Rutherford County", rate: 1.8762 },
  eagleville: { name: "Town of Eagleville", rate: 0.4051 },
  laVergne: { name: "City of La Vergne", rate: 0.5363 },
  murfreesboro: { name: "City of Murfreesboro", rate: 0.9526 },
  smyrna: { name: "Town of Smyrna", rate: 0.5257 },
  davidsonGsd: { name: "Metro Nashville · General Services District", rate: 2.782 },
  davidsonUsdAddOn: { name: "Metro Nashville · Urban Services District", rate: 0.032 },
  belleMeade: { name: "City of Belle Meade", rate: 0.3011 },
  goodlettsville: { name: "City of Goodlettsville", rate: 0.5068 },
  ridgetop: { name: "Town of Ridgetop", rate: 0.349 },
};
const U = (k) => ({ unit: TN_RATES[k].name, rate: TN_RATES[k].rate });

/* ───────────────────────────── Rutherford ───────────────────────────── */

/** DistrictGroup code → the units that tax a lot in it (county, then its city). */
const RUTHERFORD_DISTRICTS = {
  "000": ["rutherford"],
  "227": ["rutherford", "eagleville"],
  "400": ["rutherford", "laVergne"],
  "515": ["rutherford", "murfreesboro"],
  "674": ["rutherford", "smyrna"],
};

/** AccountType code → assessment ratio. `frozen`: a tax-freeze account is billed at a frozen base, so no estimate. */
const RUTHERFORD_RATIO = {
  "09": { ratio: 0.4, label: "industrial" }, "08": { ratio: 0.4, label: "commercial" }, COMM: { ratio: 0.4, label: "commercial" },
  "00": { ratio: 0.25, label: "residential" }, "10": { ratio: 0.25, label: "farm" }, "11": { ratio: 0.25, label: "farm" }, "12": { ratio: 0.25, label: "farm" },
  "0": { ratio: 0.25, label: "residential", frozen: true },
};
const IDB_CODES = new Set(["IDB", "EXIDB"]);

const PILOT_NOTE = "Held by the Industrial Development Board (PILOT — a negotiated payment in lieu of the normal tax bill). Ask the IDB; no rate table applies.";

/** "515 - Murfreesboro" → "515" ; "09 - Industrial" → "09" ; "Comm - Commercial - STR" → "COMM" ; null → null. */
export function leadCode(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^([A-Za-z0-9]+)\s*(?:-|$)/.exec(s);
  return m ? m[1].toUpperCase() : null;
}

const money = usdWhole;

function rutherfordTable(attrs) {
  const group = leadCode(attrs.DistrictGroup);
  const cls = leadCode(attrs.AccountType);
  if (!group || !RUTHERFORD_DISTRICTS[group]) return null; // unknown / null district → incomplete → hide
  const base = { year: TN_RATE_YEAR, source: TN_SOURCE, sourceUrl: TN_SOURCE_URL, caption: `${TN_RATE_YEAR} rates`, notes: [], estimate: null };
  if (cls && IDB_CODES.has(cls)) return { ...base, rows: [], total: null, pilot: true, notes: [PILOT_NOTE] };
  const rows = RUTHERFORD_DISTRICTS[group].map(U);
  const total = r6(rows.reduce((s, r) => s + r.rate, 0));
  const out = { ...base, rows, total };
  const cfg = cls ? RUTHERFORD_RATIO[cls] : null;
  const assessed = Number(attrs.TotalAssessedValue);
  if (cfg && cfg.frozen) {
    out.notes.push("Tax-freeze account — the bill is held at a frozen base, so no estimate is shown. Ask the County Trustee.");
  } else if (cfg && Number.isFinite(assessed) && assessed > 0) {
    const yr = /^\d{4}$/.test(String(attrs.TAXYEAR ?? "").trim()) ? String(attrs.TAXYEAR).trim() : null;
    out.estimate = {
      assessed, ratio: cfg.ratio, total, dollars: Math.round((assessed * total) / 100), cls: cfg.label,
      text: `Estimate ${money((assessed * total) / 100)} a year — ${yr ? `${yr} ` : ""}assessed value ${money(assessed)} (${cfg.ratio * 100}% ${cfg.label} ratio) × ${total.toFixed(4)} per $100. Uses ${TN_RATE_YEAR} rates; ${yr && Number(yr) > TN_RATE_YEAR ? `${yr} rates are not certified yet. ` : ""}A screen, not a bill.`,
    };
  }
  return out;
}

/* ───────────────────────────── Davidson ───────────────────────────── */

/** TaxDist (trimmed, upper-cased) → { units, note? } or null. A code absent here is hidden. */
const DAVIDSON_DISTRICTS = {
  GSD: { units: ["davidsonGsd"] },
  USD: { units: ["davidsonGsd", "davidsonUsdAddOn"] },
  BM: { units: ["davidsonGsd", "belleMeade"] },
  GO: { units: ["davidsonGsd", "goodlettsville"] },
  RT: { units: ["davidsonGsd", "ridgetop"] },
  OH: { units: ["davidsonGsd"], note: "Oak Hill levies no city property tax — Metro's General Services rate only." },
  FH: { units: ["davidsonGsd"], note: "Forest Hills levies no city property tax — Metro's General Services rate only." },
  // BH (Berry Hill): hidden until the city's own FY2026 statement is on file (see header). BID / null / UNASSIGNED: the
  // improvement-district levy is on top of the table and unsourced → hidden.
};

function davidsonTable(attrs) {
  const code = attrs.TaxDist == null ? "" : String(attrs.TaxDist).trim().toUpperCase(); // the layer publishes "USD " / "GSD " with a trailing space
  const d = DAVIDSON_DISTRICTS[code];
  if (!d) return null;
  const rows = d.units.map(U);
  return {
    year: TN_RATE_YEAR, source: TN_SOURCE, sourceUrl: TN_SOURCE_URL, caption: `${TN_RATE_YEAR} rates`,
    rows, total: r6(rows.reduce((s, r) => s + r.rate, 0)), notes: d.note ? [d.note] : [], estimate: null,
  };
}

/** The table for ONE stored county lot (`parcel.attrs` = the layer's raw attribute bag), or null = hide. Pure. */
export function tnTaxTableFor(parcel, county) {
  const attrs = parcel && parcel.attrs;
  if (!attrs || typeof attrs !== "object") return null;
  if (county === "tn_rutherford") return rutherfordTable(attrs);
  if (county === "tn_davidson") return davidsonTable(attrs);
  return null;
}
