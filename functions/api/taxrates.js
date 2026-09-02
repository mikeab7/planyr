/* /api/taxrates — same-origin proxy + parser for the Texas Comptroller's published annual
 * "Rates and Levies" workbooks (comptroller.texas.gov/taxes/property-tax/docs/*.xlsx).
 *
 *   GET /api/taxrates?county=Harris
 *     → { year, versionDate, source, county:{name,rate}, cities:[{name,rate}],
 *         isds:[{name,rate,split}], special:[{name,rate,split}] }
 *
 * WHY (NEW-1) — `TAX_RATE_SOURCES.harris` in src/workspaces/site-planner/lib/counties.js was
 * `null` from the day the tax panel shipped: no Texas county publishes a live per-parcel
 * combined-rate API. The Comptroller instead publishes one statewide workbook per taxing-unit
 * TYPE (county / city / school district / special district) a few times a year — real, adopted,
 * dated numbers, just not queryable per point. This Function fetches and parses those workbooks
 * server-side (the client bundle never carries an XLSX parser, and comptroller.texas.gov sends
 * no CORS headers so a browser fetch can't read them directly) and hands back the ONE county's
 * rows. `functions/api/lib/comptrollerRates.js` is the pure row-extraction half — unit-tested
 * with hand-built fixtures, no xlsx import, no network — this file is the thin fetch/cache/parse
 * shell around it. `lib/harrisTaxRates.js` (client) is the one caller for now.
 *
 * The upstream files have no year in a directory listing to probe — the URL itself names the
 * year (`<year>-<type>-rates-levies.xlsx`). "Most recent" is found by HEAD-probing backward from
 * the current calendar year (Texas taxing units adopt a year's rates that autumn; the Comptroller
 * certifies and republishes the workbook the following winter/spring, so the CURRENT calendar
 * year's own workbook often doesn't exist yet — this is normal, not a fetch failure, and the
 * response's `year`/`versionDate` say exactly which roll the client is looking at).
 *
 * LOUD-FAILURE: an upstream miss (every probed year 404s, or a fetched file doesn't parse as a
 * rates-and-levies workbook) returns a 502 naming what happened — never an empty 200 that would
 * read as "no taxing units this year".
 */
import * as XLSX from "xlsx";
import { extractCountyRows } from "./lib/comptrollerRates.js";

const DOCS_BASE = "https://comptroller.texas.gov/taxes/property-tax/docs";
const TYPES = { county: "county", cities: "city", isds: "school-district", special: "special-district" };
const PROBE_YEARS_BACK = 3; // this year, then up to 3 prior — well past any normal publication lag
const CACHE_TTL_S = 24 * 3600;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });

function sameOriginOk(origin, host) {
  if (!origin) return true;
  try { return new URL(origin).host === host; } catch (_) { return false; }
}

async function fetchWorkbookRows(year, type) {
  const url = `${DOCS_BASE}/${year}-${type}-rates-levies.xlsx`;
  const res = await fetch(url, { headers: { "user-agent": "planyr-taxrates-proxy" } });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
}

/** Find the most recent year (>= currentYear - PROBE_YEARS_BACK) whose county-type workbook
 * exists, by probing backward. County is the smallest of the four files and is fetched by every
 * request anyway, so probing on it costs nothing extra. */
async function latestYear() {
  const now = new Date().getUTCFullYear();
  for (let y = now; y >= now - PROBE_YEARS_BACK; y--) {
    const res = await fetch(`${DOCS_BASE}/${y}-county-rates-levies.xlsx`, { method: "HEAD" });
    if (res.ok) return y;
  }
  return null;
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  if (!sameOriginOk(request.headers.get("Origin"), url.host)) return json({ error: "forbidden" }, 403);

  const county = (url.searchParams.get("county") || "").trim();
  if (!county) return json({ error: "missing county" }, 400);

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let year;
  try {
    year = await latestYear();
  } catch (e) {
    return json({ error: `Comptroller upstream unreachable: ${e && e.message ? e.message : e}` }, 502);
  }
  if (!year) return json({ error: "No Comptroller rates-and-levies workbook found for the last few years" }, 502);

  let versionDate = null;
  const out = { county: null, cities: [], isds: [], special: [] };
  try {
    for (const [key, type] of Object.entries(TYPES)) {
      const rows = await fetchWorkbookRows(year, type);
      if (!rows) return json({ error: `Comptroller ${type} workbook missing for ${year}` }, 502);
      const extracted = extractCountyRows(rows, county);
      if (!extracted) return json({ error: `Comptroller ${type} workbook for ${year} did not parse as rates-and-levies (source shape may have changed)` }, 502);
      if (extracted.versionDate) versionDate = versionDate || extracted.versionDate;
      if (key === "county") {
        out.county = extracted.rows[0] ? { name: extracted.rows[0].name, rate: extracted.rows[0].rate } : null;
      } else {
        out[key] = extracted.rows.map((r) => ({ name: r.name, rate: r.rate, split: r.split }));
      }
    }
  } catch (e) {
    return json({ error: `Comptroller workbook fetch/parse failed: ${e && e.message ? e.message : e}` }, 502);
  }
  if (!out.county) return json({ error: `No "${county}" row in the ${year} county workbook — check the county name` }, 404);

  const payload = {
    year, versionDate,
    source: "Texas Comptroller of Public Accounts — Rates and Levies",
    sourceUrl: `${DOCS_BASE}/${year}-total-rates-levies.xlsx`,
    ...out,
  };
  const res = json(payload, 200, { "cache-control": `public, max-age=${CACHE_TTL_S}` });
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
