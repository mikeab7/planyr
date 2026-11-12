/* taxRates.js — per-account taxing-unit rate table ("Taxing unit | Rate per $100" + Total).
 *
 * OWNER RULE: show the table only from a REAL per-account source (the CAD account's taxing
 * units + each unit's ADOPTED rate for a stated tax year). Partial unit lists understate the
 * total (a false number), so: complete per the source, or HIDDEN. Never a guess/average.
 *
 * FINDING (researched 2026-10-06 from the Claude Code sandbox) — NO COUNTY IS COVERED YET.
 *   Reachable: comptroller.texas.gov/taxes/property-tax/docs/<year>-{county,city,school-district,
 *   special-district}-rates-levies.xlsx (200; adopted rates BY UNIT NAME, not per account — already
 *   used by harrisTaxRates.js via /api/taxrates), and the ArcGIS Online parcel layers in counties.js.
 *   Blocked by egress policy (403 CONNECT): hcad.org, pdata/download.hcad.org, hctax.net,
 *   gis.hctx.net, fbcad.org, search.fbcad.org, mcad-tx.org — i.e. every CAD/tax-office site that
 *   publishes the account->unit legend and per-code rates.
 *   Per-account membership IS in three parcel services, as CAD unit CODES (complete per the CAD):
 *     Fort Bend  FBCAD_Public_Data  TAXUNITS  e.g. "D01,G01,M243,R50,S07,CAD"
 *     Galveston  GCAD parcels       ENTITIES   e.g. "C31, CAD, D02, GGA, J05, RFL, S18"
 *     Montgomery Tax_Parcel_view    taxingUnits e.g. "CAD,F06,GMO,HM1,JNH,MKM,SNC" (pYear reads 2027 — suspect)
 *   But a code is only a CAD-internal label. Nothing reachable maps code -> unit name -> adopted
 *   rate, and inferring it (D01 = "Drainage District 1"?) would be invention. So: hidden.
 *   Harris (HCAD GIS has no unit fields), Brazoria/Liberty/Austin (school/city/county fields exist
 *   but are null in sampled rows; no ESD/MUD/college), Chambers/Waller (service gave no fields /
 *   none known): incomplete or absent membership -> hidden.
 *   NOTE harrisTaxRates.js (existing ParcelTaxes panel) is a point-in-polygon estimate that states
 *   its own incompleteness; it is NOT a complete per-account list and is not used here.
 *
 * NEXT STEPS: Fort Bend / Galveston / Montgomery — from a network that can reach the CAD sites,
 *   download the entity legend (code, name) and the tax office's adopted-rate sheet, build
 *   lib/data/taxRates-<county>-<year>.json in the shape below, and register it in DATA_LOADERS.
 *   Harris — HCAD's yearly "Real_acct_owner"/jurisdiction code downloads (pdata.hcad.org) + the
 *   Harris County Tax Office rate sheet. Others — request the CAD's entity export.
 *
 * DATA FILE SHAPE: { county, year, source, sourceUrl, codeField,
 *   units: { "<CAD code>": { unit: "<name>", rate: <per $100> } } }
 * An account's codes come from parcel attrs[codeField] (comma separated). Any code missing from
 * `units` => the list is incomplete => null (hide).
 */
import { millageTableFor } from "./georgiaMillage.js";
import bartowMillage from "./data/gaMillage-ga_bartow-2025.json";

export const r6 = (n) => Math.round(n * 1e6) / 1e6; // rates carry up to 6 decimals (0.004798) — 5 would corrupt the total

export const TAX_COVERAGE = {
  harris: { covered: false, reason: "HCAD GIS has no taxing-unit fields; hcad.org / hctax.net blocked from sandbox. Existing Comptroller+polygon panel is an incomplete estimate." },
  fortbend: { covered: false, reason: "Parcels carry TAXUNITS codes (complete) but no reachable code->name->rate legend (fbcad.org blocked); mapping codes would be a guess." },
  chambers: { covered: false, reason: "No taxing-unit field known/readable; service returned no field list from sandbox." },
  waller: { covered: false, reason: "No taxing-unit field in the wired source." },
  montgomery: { covered: false, reason: "Parcels carry taxingUnits codes but no reachable code legend/rates (mcad-tx.org blocked); layer's pYear reads 2027, so it needs a currency check." },
  brazoria: { covered: false, reason: "Only school/city/county fields (null in sampled rows); no ESD/MUD/college membership, so the list would be incomplete." },
  galveston: { covered: false, reason: "Parcels carry ENTITIES codes but no reachable code legend/rates." },
  liberty: { covered: false, reason: "Only school/city/county fields; incomplete membership." },
  austintx: { covered: false, reason: "Only school/city/county fields; incomplete membership." },
  /* NEW-1 (Bartow GA): the table is BUILT and tested (georgiaMillage.js + lib/data/gaMillage-ga_bartow-2025.json — mills on the
   * 40% assessed value, one Tax_District code → a list of levies) but the county stays HIDDEN until EVERY code's 2025 rates
   * are transcribed. Sourced for 2025: county incorporated / unincorporated, Bartow County Schools, Cartersville M&O + BID +
   * City Schools, Adairsville. NOT yet found: Emerson, Euharlee, Kingston, Taylorsville, White, the Cartersville parks bond,
   * Red Top Mtn CID — they are in GA DOR's 2025 millage PDF (dor.georgia.gov is blocked from the build sandbox; read it with
   * pdfplumber from a network that reaches it). District 12 (E Main Street TAD #1) also needs its base jurisdiction named.
   * Flip `covered` to true only when `pendingDistricts(bartowMillage)` is empty (test/georgiaMillage.test.js enforces it). */
  ga_bartow: { covered: false, reason: "Bartow tax-district table built; 2025 millage not yet transcribed for Emerson, Euharlee, Kingston, Taylorsville, White, the Cartersville parks bond and Red Top Mtn CID (GA DOR 2025 digest PDF), and district 12's base jurisdiction is unnamed — hidden until complete." },
};

// Georgia counties whose table is a tax-DISTRICT code → levy list in MILLS (georgiaMillage.js), not the per-$100 CAD-unit shape.
export const MILLAGE_DATA = { ga_bartow: bartowMillage };

// county key -> () => import("./data/taxRates-<county>-<year>.json"). Empty until real data lands.
export const DATA_LOADERS = {};

const loaded = {};
export async function loadTaxTable(parcel, ctx = {}) {
  const county = ctx.county || parcel?.county || null;
  const ld = county && DATA_LOADERS[county];
  if (!ld) return null;
  if (!loaded[county]) loaded[county] = (await ld()).default;
  return taxTableFor(parcel, { county, data: loaded[county] });
}

/** Sync; `ctx.data` is a loaded data file. Null = hide. */
export function taxTableFor(parcel, ctx = {}) {
  const county = ctx.county || parcel?.county || null;
  if (county && MILLAGE_DATA[county]) return millageTableFor(parcel, ctx.data || MILLAGE_DATA[county], { covered: ctx.covered ?? !!(TAX_COVERAGE[county] && TAX_COVERAGE[county].covered) });
  const data = ctx.data || loaded[county];
  if (!county || !data || !data.units || !data.codeField || !data.year || !data.source) return null;
  const raw = parcel?.attrs?.[data.codeField];
  if (raw == null || String(raw).trim() === "") return null;
  const codes = String(raw).split(",").map((c) => c.trim()).filter(Boolean);
  const rows = [];
  for (const c of codes) {
    if (c === "CAD") continue; // appraisal district itself levies nothing
    const u = data.units[c];
    if (!u || typeof u.rate !== "number" || !u.unit) return null; // incomplete list -> hide
    rows.push({ unit: u.unit, rate: u.rate });
  }
  if (!rows.length) return null;
  return { year: data.year, source: data.source, sourceUrl: data.sourceUrl || "", rows, total: r6(rows.reduce((s, r) => s + r.rate, 0)) };
}

export function taxTableForCombined(parcels, ctx = {}) {
  const tableOf = ctx.tableOf || ((p) => taxTableFor(p, ctx)); // B2158065: async per-account tables plug in here
  const per = (parcels || []).map((p) => { const t = tableOf(p); return { name: p?.label || p?.name || p?.acct || "Lot", t: t && t.held ? null : t }; }); // a PILOT-held lot has no total, so a combine that includes one hides
  if (!per.length || per.some((x) => !x.t)) return null;
  const totals = per.map((x) => x.t.total);
  const allShare = totals.every((t) => t === totals[0]);
  return { allShare, total: allShare ? totals[0] : null, perLot: per.map((x) => ({ name: x.name, total: x.t.total })) };
}
