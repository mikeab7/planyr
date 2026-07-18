/* NEW-B2 — USDA NRCS SSURGO soils via Soil Data Access (SDA), for the pond/detention screen:
 *   • HYDROLOGIC SOIL GROUP (A/B/C/D) → the Curve-Number runoff method (curveNumber.js), and
 *   • SEASONAL HIGH WATER TABLE depth → the wet-vs-dry-pond feasibility screen (groundwater.js).
 *
 * SDA answers a SQL query over the national SSURGO tabular data. This module holds the pure
 * query builder + response parser (Node-testable, no network) and a bounded-fetch client. The
 * `muaggatt` (map-unit aggregated attributes) table carries both facts at the dominant-condition
 * level: `hydgrpdcd` (hydrologic group) and `wtdepannmin` (annual-minimum water-table depth, cm).
 *
 * ENDPOINT NOTE (2026-07-18): SDA (sdmdataaccess.sc.egov.usda.gov) is BLOCKED by this sandbox's
 * egress proxy (403 CONNECT). So the client rides the bounded-fetch interface (injectable fetch,
 * timeout, abort) and production routes it through a same-origin proxy; the live check is a
 * VERIFICATION.md V### item. Screening only — a desktop soils read, NOT a geotechnical
 * investigation; confirm HSG + groundwater with a boring/soils report before design.
 * LOUD-FAILURE: no coverage / a bad response → honest null, never a fabricated soil group. */
import { normalizeHsg } from "./curveNumber.js";

export const SDA_ENDPOINT = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";
// Same-origin proxy production uses (the browser can't reach SDA cross-origin; SDA has no CORS).
export const SDA_PROXY_PATH = "/api/soils";
const CM_PER_FT = 30.48;

/* The SDA SQL for HSG + seasonal-high water table at a WGS84 point. Resolves the map unit(s)
 * intersecting the point, then reads the dominant-condition hydrologic group + the annual and
 * April–June minimum water-table depths from muaggatt. Pure string builder. */
export function buildSoilQuery(lng, lat) {
  const pt = `point(${Number(lng)} ${Number(lat)})`;
  return (
    "SELECT mu.mukey, mu.muname, muagg.hydgrpdcd, muagg.wtdepannmin, muagg.wtdepaprjunmin, muagg.drclassdcd " +
    "FROM mapunit mu " +
    "INNER JOIN muaggatt muagg ON muagg.mukey = mu.mukey " +
    `WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${pt}'))`
  );
}

/* The POST request (url + JSON body) for a point soils query. `format` "JSON+COLUMNNAME" puts
 * the column names in Table[0] so the parser is order-independent. Pure. */
export function buildSdaRequest(lng, lat, { proxy = false } = {}) {
  return {
    url: proxy ? SDA_PROXY_PATH : SDA_ENDPOINT,
    body: { format: "JSON+COLUMNNAME", query: buildSoilQuery(lng, lat) },
  };
}

/* Parse an SDA JSON+COLUMNNAME response ({ Table: [[colNames…],[row…],…] }) into a soils
 * summary. Picks the map unit with the SHALLOWEST water table (the conservative wet case) and
 * the coarsest/most-restrictive HSG present. Returns { hsg, hsgRaw, waterTableFt, waterTableCm,
 * aprJunWaterTableFt, drainageClass, muname, mukey, units:[…] } or null when there are no rows
 * (out of coverage) — never a fabricated group. Pure. */
export function parseSoilResponse(json) {
  const table = json && (json.Table || json.table);
  if (!Array.isArray(table) || table.length < 2) return null;
  const cols = table[0].map((c) => String(c).toLowerCase());
  const idx = (name) => cols.indexOf(name);
  const iHsg = idx("hydgrpdcd"), iWt = idx("wtdepannmin"), iWtAj = idx("wtdepaprjunmin"), iDr = idx("drclassdcd"), iName = idx("muname"), iKey = idx("mukey");
  const units = [];
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const hsgRaw = iHsg >= 0 ? row[iHsg] : null;
    const wtCm = iWt >= 0 ? toNum(row[iWt]) : null;
    units.push({
      mukey: iKey >= 0 ? row[iKey] : null,
      muname: iName >= 0 ? row[iName] : null,
      hsgRaw: hsgRaw || null,
      hsg: normalizeHsg(hsgRaw),
      waterTableCm: wtCm,
      waterTableFt: wtCm == null ? null : Math.round((wtCm / CM_PER_FT) * 100) / 100,
      aprJunWaterTableFt: iWtAj >= 0 && toNum(row[iWtAj]) != null ? Math.round((toNum(row[iWtAj]) / CM_PER_FT) * 100) / 100 : null,
      drainageClass: iDr >= 0 ? row[iDr] : null,
    });
  }
  if (!units.length) return null;
  // Conservative pick: the shallowest water table (worst wet-pond case); ties → the most
  // restrictive HSG (D > C > B > A). A unit with no water-table number can't win the wet pick.
  const withWt = units.filter((u) => u.waterTableFt != null);
  const wettest = withWt.length ? withWt.reduce((a, u) => (u.waterTableFt < a.waterTableFt ? u : a), withWt[0]) : null;
  const hsgRank = { A: 0, B: 1, C: 2, D: 3 };
  const worstHsg = units.filter((u) => u.hsg).reduce((a, u) => (hsgRank[u.hsg] > hsgRank[a.hsg] ? u : a), units.find((u) => u.hsg) || units[0]);
  const primary = wettest || worstHsg || units[0];
  return {
    hsg: worstHsg?.hsg ?? primary.hsg ?? null,
    hsgRaw: worstHsg?.hsgRaw ?? primary.hsgRaw ?? null,
    waterTableFt: wettest?.waterTableFt ?? null,
    waterTableCm: wettest?.waterTableCm ?? null,
    aprJunWaterTableFt: wettest?.aprJunWaterTableFt ?? null,
    drainageClass: primary.drainageClass ?? null,
    muname: primary.muname ?? null,
    mukey: primary.mukey ?? null,
    units,
  };
}

const toNum = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* Bounded-fetch client for a point soils query. Returns { ok, soils, source } or
 * { ok:false, reason }. `fetchImpl` is injectable (tests / the production proxy); `proxy:true`
 * routes to the same-origin proxy path. A timeout / HTTP error / empty coverage is an honest
 * failure, never a fabricated soil. */
export async function resolveSoils({ lng, lat } = {}, { fetchImpl, timeoutMs = 12000, signal, proxy = true } = {}) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { ok: false, reason: "no point" };
  const { url, body } = buildSdaRequest(lng, lat, { proxy });
  const ctrl = !signal && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let r;
  try {
    r = await (fetchImpl || fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal || (ctrl && ctrl.signal) || undefined,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    return { ok: false, reason: `soils fetch failed: ${e && e.message ? e.message : e}` };
  }
  if (timer) clearTimeout(timer);
  if (!r.ok) return { ok: false, reason: `soils HTTP ${r.status}` };
  let json;
  try { json = await r.json(); } catch (_) { return { ok: false, reason: "soils response not JSON" }; }
  const soils = parseSoilResponse(json);
  if (!soils) return { ok: false, reason: "no SSURGO coverage at this point" };
  return { ok: true, soils, source: "USDA NRCS SSURGO (Soil Data Access)" };
}
