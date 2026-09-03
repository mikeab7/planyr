/* comptrollerRates.js — pure row-extraction over the Texas Comptroller's published annual
 * "Rates and Levies" workbooks (comptroller.texas.gov/taxes/property-tax/docs/<year>-<type>-
 * rates-levies.xlsx). No XLSX parsing here and no network — this operates on plain JS row
 * arrays (as `XLSX.utils.sheet_to_json(ws, { header: 1 })` returns them), so it is testable
 * with hand-built fixtures and has no dependency on the `xlsx` package. `functions/api/
 * taxrates.js` is the one place that turns real workbook bytes into rows and calls in here.
 *
 * WHY THIS EXISTS (NEW-1) — Harris County's total tax rate never rendered for anyone:
 * `TAX_RATE_SOURCES.harris` was `null` from the day the feature shipped (see
 * `src/workspaces/site-planner/lib/counties.js`). Texas has no live per-parcel combined-rate
 * API; the Comptroller instead publishes one workbook per taxing-unit TYPE (county / city /
 * school district / special district), each a full statewide roll, updated a handful of times
 * a year. This module reads the ONE fact each workbook carries that a screening tool needs:
 * the taxing unit's name, its adopted TOTAL rate per $100 of valuation, and the report's own
 * version date — never anything computed or interpolated.
 *
 * The four workbook types do NOT share one column layout (measured 2026-09-02, tax year 2025):
 *   county  — no per-unit NAME column (the row IS the county); the rate column is literally
 *             named "TOTAL COUNTY TAX RATE".
 *   city / special — 17 columns; a single "TAXABLE VALUE" column; rate column "TOTAL TAX RATE".
 *   school  — 18 columns; "TAXABLE VALUE" is split M&O / I&S; same "TOTAL TAX RATE" name.
 * Column INDICES therefore differ across the four workbook types and could easily shift again
 * next year — resolving every column by its HEADER TEXT (found once, from the header row
 * itself) rather than a hardcoded position is what keeps this from silently reading the wrong
 * column if the Comptroller reorders or adds one.
 */

const HEADER_HINTS = {
  countyName: /^county name$/i,
  taxingUnitName: /^taxing unit name$/i,
  versionDate: /^version date$/i,
  rate: /^total (county )?tax rate$/i,
  split: /^split$/i,
};

/** Find the header row (the first row carrying "COUNTY NAME") and a name→index map. Pure. */
export function findHeader(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const idx = row.findIndex((c) => typeof c === "string" && HEADER_HINTS.countyName.test(c.trim()));
    if (idx === -1) continue;
    const cols = {};
    row.forEach((c, j) => {
      if (typeof c !== "string") return;
      const t = c.trim();
      for (const [key, re] of Object.entries(HEADER_HINTS)) if (re.test(t)) cols[key] = j;
    });
    if (cols.countyName == null || cols.rate == null) continue; // not the real header row
    return { headerRow: i, cols };
  }
  return null;
}

const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const asRate = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/**
 * Extract every row for `countyName` (case-insensitive) from a parsed workbook's row array.
 * Returns { versionDate, rows: [{ name, rate, split }] } — `name` is the county's own name for
 * the county-file shape (no per-unit name column to read), else the taxing-unit name. `split`
 * is true when the Comptroller's own SPLIT flag says this unit's territory crosses a CAD
 * boundary (Harris only sees ITS OWN CAD's share of that unit's roll, so a split taxing unit's
 * rate is still the unit's one adopted rate — the flag is informational, not a filter). Returns
 * null if `rows` doesn't look like a rates-and-levies workbook at all (LOUD-FAILURE: the caller
 * must treat that as "source shape changed", never as "zero taxing units this year").
 */
export function extractCountyRows(rows, countyName) {
  const header = findHeader(rows);
  if (!header) return null;
  const { headerRow, cols } = header;
  const want = clean(countyName).toLowerCase();
  const out = [];
  let versionDate = null;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const cn = clean(row[cols.countyName]).toLowerCase();
    if (cn !== want) continue;
    const rate = asRate(row[cols.rate]);
    if (rate == null) continue;
    const name = cols.taxingUnitName != null ? clean(row[cols.taxingUnitName]) : clean(row[cols.countyName]);
    if (!name) continue;
    out.push({ name, rate, split: cols.split != null ? clean(row[cols.split]).toUpperCase() === "X" : false });
    if (!versionDate && cols.versionDate != null) versionDate = clean(row[cols.versionDate]) || null;
  }
  return { versionDate, rows: out };
}

/** Case/whitespace/punctuation-insensitive match — "Houston" vs "City of Houston", "Waller ISD"
 * vs "WALLER ISD". Pure. Not fuzzy beyond that: a near-miss stays unmatched rather than guessed. */
export function normalizeUnitName(s) {
  return clean(s).toLowerCase().replace(/^city of\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Find `name`'s rate in an extracted rows array (from `extractCountyRows`), or null. Pure. */
export function findRateByName(rows, name) {
  const want = normalizeUnitName(name);
  if (!want) return null;
  const hit = (rows || []).find((r) => normalizeUnitName(r.name) === want);
  return hit ? hit.rate : null;
}
