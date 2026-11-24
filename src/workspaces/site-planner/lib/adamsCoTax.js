/* adamsCoTax.js — Adams County, Colorado: a lot's taxing authorities + mill levy, from the COUNTY'S OWN tables (NEW-1, 2026-11-24).
 *
 * Colorado is MILLS (dollars per $1,000 of ASSESSED value), not Texas's per-$100: the table renders through the same
 * "Mills" shape the Georgia table uses. A Colorado lot never reads a Texas number (owner constraint #3) — nothing here
 * imports a Texas file, and the table is hidden, never guessed, when the county's own tables do not reconcile.
 *
 * SOURCE (Adams County ArcGIS Online org 4PNQOtAivErR7nbT, CORS-open, no key; measured 2026-11-22):
 *   Property_Values  (table; ~3 rows per PIN)  PIN · AREAID (= the tax district) · MILLLEVY · ALTMILLLEVY …
 *   Tax_Districts_(public) (table)             TAXYEAR · TAXDISTRICT · TAXAUTHORITYCODE · TAXAUTHORITYNAME · TOTALLEVY · ALTTOTALLEVY
 *   PIN → AREAID + MILLLEVY → every authority row whose TAXDISTRICT == AREAID. COMPLETE-OR-HIDDEN (B2158065): the table
 *   shows only when Σ TOTALLEVY over the district's authorities == the account's MILLLEVY exactly (to 4 decimals).
 *
 * Deliberately NOT used: contact columns (never read or printed); ALTTOTALLEVY / ALTMILLLEVY (the county's own field
 * description is unconfirmed — likely Colorado's residential vs non-residential assessment split — so only the primary
 * levy is shown and the caption says so); no dollar estimate (the assessed value's basis is unconfirmed).
 * TAXYEAR 2026 is the county's own label and is shown as such; whether it is the levy year or the collection year is
 * NOT confirmed against the Treasurer, so the caption does not claim either.
 * Pure — the fetch is injectable so tests need no network. */

const ORG = "https://services3.arcgis.com/4PNQOtAivErR7nbT/arcgis/rest/services";
export const ADAMS_VALUES_URL = `${ORG}/Property_Values/FeatureServer/0`;
export const ADAMS_DISTRICTS_URL = `${ORG}/Tax_Districts_(public)/FeatureServer/0`;
export const ADAMS_TAX_SOURCE = "Adams County, CO — Tax_Districts (public) + Property_Values, county GIS";
export const ADAMS_TAX_SOURCE_URL = ADAMS_DISTRICTS_URL;
export const ADAMS_TAX_CAPTION = "county tax year 2026 · primary mill levy only · no bill estimated";

const r4 = (n) => Math.round(n * 1e4) / 1e4;
const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const attrsOf = (f) => (f && f.attributes ? f.attributes : f) || {};

/** Property_Values rows for ONE PIN → `{ area, mill }` or `{ gap }`. Dedupes the ~3× repeats; rows that DISAGREE hide. Pure. */
export function dedupeValues(rows) {
  const seen = new Set();
  for (const r of rows || []) {
    const a = attrsOf(r);
    const area = a.AREAID == null ? "" : String(a.AREAID).trim();
    const mill = num(a.MILLLEVY);
    if (!area || !Number.isFinite(mill)) return { gap: "account has no tax district or mill levy" };
    seen.add(`${area}|${r4(mill)}`);
  }
  if (!seen.size) return { gap: "no account row for this PIN" };
  if (seen.size > 1) return { gap: "the county's rows for this PIN disagree on tax district / levy" };
  const [area, mill] = [...seen][0].split("|");
  return { area, mill: Number(mill) };
}

/** Normalised district code so "0001" and "1" match. */
const codeKey = (v) => { const s = String(v == null ? "" : v).trim(); return /^\d+$/.test(s) ? String(Number(s)) : s; };

/**
 * (Property_Values rows for the PIN, Tax_Districts rows) → the table, or `{ hidden: "<reason>" }`. Pure.
 * Output shape = ParcelPage's TaxTable: `{ year, source, sourceUrl, unit:"mills", caption, rows:[{unit, rate}], total }`.
 */
export function adamsTableFrom(valueRows, districtRows) {
  const v = dedupeValues(valueRows);
  if (v.gap) return { hidden: v.gap };
  const want = codeKey(v.area);
  const byAuth = new Map(); // dedupe an authority repeated within the district
  const years = new Set();
  for (const r of districtRows || []) {
    const a = attrsOf(r);
    if (codeKey(a.TAXDISTRICT) !== want) continue;
    const name = String(a.TAXAUTHORITYNAME || "").trim();
    const lev = num(a.TOTALLEVY);
    if (!name || !Number.isFinite(lev)) return { hidden: "an authority in this district has no name or levy" };
    const key = String(a.TAXAUTHORITYCODE == null ? name : a.TAXAUTHORITYCODE).trim();
    if (byAuth.has(key) && byAuth.get(key).rate !== lev) return { hidden: "the county lists one authority twice with different levies" };
    byAuth.set(key, { unit: name, rate: lev });
    if (a.TAXYEAR != null) years.add(String(a.TAXYEAR).trim());
  }
  if (!byAuth.size) return { hidden: "no authorities found for this tax district" };
  if (years.size !== 1) return { hidden: "tax year missing or mixed" };
  const rows = [...byAuth.values()].sort((x, y) => y.rate - x.rate || x.unit.localeCompare(y.unit));
  const total = r4(rows.reduce((s, r) => s + r.rate, 0));
  if (Math.abs(total - v.mill) > 0.00005) return { hidden: `authorities add to ${total} but the account's levy is ${v.mill}` };
  return { year: [...years][0], source: ADAMS_TAX_SOURCE, sourceUrl: ADAMS_TAX_SOURCE_URL, unit: "mills", caption: ADAMS_TAX_CAPTION, rows, total };
}

const esc = (s) => String(s).replace(/'/g, "''");
async function query(fetchImpl, base, where, fields) {
  const u = `${base}/query?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(fields)}&returnGeometry=false&resultRecordCount=2000&f=json`;
  const r = await fetchImpl(u);
  if (!r.ok) throw new Error("http " + r.status);
  const j = await r.json();
  if (j.error) throw new Error("service error");
  return j.features || [];
}

const cache = new Map();
/** PIN → table | `{ hidden }` | null (network failure: hidden, retried next open). Never reads contact columns. */
export function fetchAdamsTable(pin, fetchImpl = (typeof fetch === "function" ? fetch : null)) {
  const p = String(pin == null ? "" : pin).replace(/\D/g, "");
  if (!p || !fetchImpl) return Promise.resolve(null);
  if (cache.has(p)) return cache.get(p);
  const run = (async () => {
    const vf = "PIN,AREAID,MILLLEVY";
    let vals;
    try { vals = await query(fetchImpl, ADAMS_VALUES_URL, `PIN='${esc(p)}'`, vf); }
    catch { vals = await query(fetchImpl, ADAMS_VALUES_URL, `PIN=${p}`, vf); } // PIN published as a number
    const area = dedupeValues(vals).area;
    if (!area) return adamsTableFrom(vals, []);
    const dists = await query(fetchImpl, ADAMS_DISTRICTS_URL, `TAXDISTRICT='${esc(area)}'`, "TAXYEAR,TAXDISTRICT,TAXAUTHORITYCODE,TAXAUTHORITYNAME,TOTALLEVY");
    return adamsTableFrom(vals, dists);
  })().catch(() => { cache.delete(p); return null; });
  cache.set(p, run);
  return run;
}
export function _resetAdamsCache() { cache.clear(); }
