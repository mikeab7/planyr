/* Site Analysis — the FETCH half of the trusted verdicts (NEW-1, 2026-10-05). See siteChecks.js for the
 * rules; this file asks the sources and turns each answer into a MEASUREMENT, then a row.
 *
 * Failure is a first-class outcome here, and it is never silent and never green:
 *   · a request that errors or times out            → a `failed` row ("Couldn't check") with a retry
 *   · a 200 whose body is an ArcGIS {error}          → the shared fetcher already throws it
 *   · a 200 with NO `features` array (a bad query)   → thrown HERE as a failure, not read as "0 features"
 *   · features that carry no geometry                → thrown: an area cannot be measured off nothing
 *   · a result still truncated after the page cap    → thrown: a partial area would understate the site
 * The cache holds MEASUREMENTS (plain numbers), never verdicts, under a versioned key — so an old stored
 * answer can neither paint an old severity nor survive a corrected rule.
 */

import { gisCache as defaultCache } from "./gisCache.js";
import { fetchArcgisJson, gisErrorMessage, classifyGisError, pLimit, GIS_MAX_GET_URL, clearCoalesced } from "./gisFetch.js";
import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { normalizeAttrs, buildQueryUrl } from "./siteAnalysis.js";
import {
  TRUSTED_CHECKS, CHECK_THRESHOLDS, siteRegions, isTrustedFor, measureFlood, measureWetlands, measureWells,
  measurePipelines, rowFromMeasurement,
} from "./siteChecks.js";

const DAY = 24 * 3600 * 1000;
export const VERDICT_CACHE_VERSION = "v2"; // bump to discard every stored measurement (a rule changed)
const TTL = { flood: 7 * DAY, wetlands: 7 * DAY, pipelines: 30 * DAY, wells: 30 * DAY };

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const closeRing = (r) => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);
const polyJson = (rings) => JSON.stringify({
  rings: rings.map((r) => closeRing(r).map(([x, y]) => [r6(x), r6(y)])),
  spatialReference: { wkid: 4326 },
});

/* A short stable fingerprint of EVERY coordinate (not just the bbox — two different sites can share one),
 * so a measurement is only ever reused for the exact ground it was taken on. FNV-1a over 6-dp text. */
export function ringsHash(rings, holes = []) {
  let h = 0x811c9dc5;
  const feed = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  for (const set of [rings || [], ["|holes|"], holes || []]) {
    if (set[0] === "|holes|") { feed("|holes|"); continue; }
    for (const ring of set) { feed("#"); for (const [x, y] of ring || []) feed(`${r6(x)},${r6(y)};`); }
  }
  return h.toString(16);
}

/* One /query as JSON, GET unless the URL is long enough to need POST (the same rule queryLayer uses). */
function queryJson(src, layer, params, fetchJson) {
  const t = src.timeoutMs ? { timeoutMs: src.timeoutMs } : { timeoutMs: 15000 };
  const getUrl = buildQueryUrl(src.url, layer, params);
  if (getUrl.length > GIS_MAX_GET_URL) return Promise.resolve(fetchJson(buildQueryUrl(src.url, layer, {}), { body: params, ...t }));
  return Promise.resolve(fetchJson(getUrl, t));
}
function srcOf(key) {
  const s = GIS_SOURCES[key];
  return { url: s.serviceUrl, layers: Array.isArray(s.layerId) ? s.layerId : [s.layerId], fields: s.fields || {}, outFields: s.outFields, timeoutMs: s.timeoutMs, provider: s.provider };
}
/* A response with no `features` array is a bad query that the server answered politely — never "0 features". */
function featuresOf(j, what) {
  if (!j || typeof j !== "object") throw new Error(`${what}: the source returned nothing readable.`);
  if (j.error) throw new Error(`${what}: ${j.error.message || "the source reported an error"}.`);
  if (!Array.isArray(j.features)) throw new Error(`${what}: the source answered without a feature list.`);
  return j;
}

/* Every polygon touching the site, WITH geometry, paged until the server says it is done. */
async function fetchPolygons(key, rings, fetchJson, { pageSize = 1000, maxPages = CHECK_THRESHOLDS.maxPages } = {}) {
  const src = srcOf(key);
  const outFields = (src.outFields && src.outFields.join(",")) || Object.values(src.fields).filter(Boolean).join(",") || "*";
  const out = [];
  for (const layer of src.layers) {
    let offset = 0, done = false;
    for (let page = 0; page < maxPages && !done; page++) {
      const params = {
        f: "json", where: "1=1", geometry: polyJson(rings), geometryType: "esriGeometryPolygon", spatialRel: "esriSpatialRelIntersects",
        inSR: 4326, outSR: 4326, outFields, returnGeometry: "true", geometryPrecision: 6, resultRecordCount: pageSize,
        ...(page > 0 ? { resultOffset: offset, orderByFields: "OBJECTID" } : {}),
      };
      const j = featuresOf(await queryJson(src, layer, params, fetchJson), `${key} layer ${layer}`);
      for (const f of j.features) {
        const g = f && f.geometry;
        if (!g || !Array.isArray(g.rings)) throw new Error(`${key}: a returned polygon carried no geometry, so its area can't be measured.`);
        out.push({ attrs: normalizeAttrs(f.attributes), rings: g.rings });
      }
      offset += j.features.length;
      done = !j.exceededTransferLimit;
      if (!done && page === maxPages - 1) throw new Error(`${key}: too many polygons on this site to measure honestly.`);
    }
  }
  return out;
}

/* Lines / points near the site, WITH geometry. A crowded answer (cap reached) is followed by an
 * unbuffered query for what is ON the site, so a crossing can't be hidden behind 200 near-misses. */
async function fetchNear(key, rings, radiusMi, fetchJson, cap = CHECK_THRESHOLDS.proxCap) {
  const src = srcOf(key);
  const layer = src.layers[0];
  const outFields = Object.values(src.fields).filter(Boolean).join(",") || "*";
  const radiusFt = Math.round(radiusMi * 5280) + CHECK_THRESHOLDS.queryPadFt;
  const base = {
    f: "json", where: "1=1", geometry: polyJson(rings), geometryType: "esriGeometryPolygon", spatialRel: "esriSpatialRelIntersects",
    inSR: 4326, outSR: 4326, outFields, returnGeometry: "true", resultRecordCount: cap,
  };
  const toRecs = (j) => j.features.map((f) => {
    const g = f.geometry || {};
    const rec = { attrs: normalizeAttrs(f.attributes) };
    if (Array.isArray(g.paths)) rec.paths = g.paths;
    else if (Number.isFinite(g.x) && Number.isFinite(g.y)) rec.lngLat = [g.x, g.y];
    else throw new Error(`${key}: a returned feature carried no usable geometry.`);
    return rec;
  });
  const j = featuresOf(await queryJson(src, layer, { ...base, distance: radiusFt, units: "esriSRUnit_Foot" }, fetchJson), key);
  let recs = toRecs(j);
  const capped = !!j.exceededTransferLimit || recs.length >= cap;
  if (capped) {
    const jOn = featuresOf(await queryJson(src, layer, base, fetchJson), `${key} (on-site pass)`);
    const seen = new Set(recs.map((r) => JSON.stringify(r.paths || r.lngLat)));
    for (const r of toRecs(jOn)) { const k = JSON.stringify(r.paths || r.lngLat); if (!seen.has(k)) { seen.add(k); recs.push(r); } }
  }
  return { recs, capped };
}

/* group → the measurement for the whole group (flood100 + flood500 are ONE fetch). */
const GROUPS = {
  flood: async (rings, holes, o) => {
    const feats = await fetchPolygons("flood", rings, o.fetchJson);
    return measureFlood(rings, holes, feats.map((f) => ({ rings: f.rings, zone: f.attrs.FLD_ZONE, subtype: f.attrs.ZONE_SUBTY })), o.thresholds);
  },
  wetlands: async (rings, holes, o) => {
    const feats = await fetchPolygons("wetlands", rings, o.fetchJson);
    return measureWetlands(rings, holes, feats.map((f) => ({ rings: f.rings, type: f.attrs.WETLAND_TYPE })), o.thresholds);
  },
  pipelines: async (rings, holes, o) => {
    const { recs } = await fetchNear("pipelines", rings, o.thresholds.nearRadiusMi, o.fetchJson);
    return measurePipelines(rings, recs);
  },
  wells: async (rings, holes, o) => {
    const { recs, capped } = await fetchNear("oilgas", rings, o.thresholds.nearRadiusMi, o.fetchJson);
    return measureWells(rings, recs, { capped, thresholds: o.thresholds });
  },
};

function failedRow(check, message) {
  return {
    id: check.id, label: check.label, layer: check.layer, severity: "failed", figure: "Couldn't check",
    line: message, sentences: [], source: null, caveat: null, ageMs: null, ts: null, retry: true,
  };
}
function logFailure(group, err) {
  try {
    if (typeof console !== "undefined" && console.warn) console.warn(`[siteChecks] "${group}" failed: ${err && err.message}`);
    const diag = err && err.diag;
    reportClientEvent("gis-query-failed", `"${group}" site check failed: ${(err && err.message) || ""}`, {
      source: group, httpStatus: diag && diag.httpStatus, arcgisCode: diag && diag.arcgisCode, url: diag && diag.url,
    });
  } catch (_) { /* telemetry must never throw into the panel */ }
}

/* Run the trusted checks for a site.
 *   rings   — active-parcel outer rings [[ [lng,lat] … ]]
 *   opts    — holes (save-and-except rings) · only (check ids — a Retry) · force (bypass the stored
 *             measurement) · cache / fetchJson / thresholds / now (injectable for tests)
 * Resolves { regions, rows, untrusted, generatedAt }. NEVER rejects: a failure is a row. */
export async function runTrustedChecks(rings, opts = {}) {
  const cache = opts.cache || defaultCache;
  const thresholds = { ...CHECK_THRESHOLDS, ...(opts.thresholds || {}) };
  const holes = opts.holes || [];
  const reg = siteRegions(rings);
  const limit = pLimit(opts.poolSize || 3);
  const baseFetch = opts.fetchJson || ((url, o) => fetchArcgisJson(url, o));
  const fetchJson = (url, o) => limit(() => baseFetch(url, o));
  const only = Array.isArray(opts.only) ? new Set(opts.only) : null;

  const trusted = TRUSTED_CHECKS.filter((c) => isTrustedFor(c, reg.regions));
  const untrusted = TRUSTED_CHECKS.filter((c) => !isTrustedFor(c, reg.regions)).map((c) => c.id);
  const wanted = trusted.filter((c) => !only || only.has(c.id));
  if (opts.force) clearCoalesced();

  const hash = ringsHash(rings, holes);
  const byGroup = new Map();
  for (const c of wanted) { if (!byGroup.has(c.group)) byGroup.set(c.group, []); byGroup.get(c.group).push(c); }

  const results = await Promise.all([...byGroup.entries()].map(async ([group, checks]) => {
    const key = `siteverdict:${VERDICT_CACHE_VERSION}:${group}:${thresholds.nearRadiusMi}:${hash}`;
    try {
      if (opts.force) cache.remove(key);
      const { fresh } = cache.swr(key, () => GROUPS[group](rings, holes, { fetchJson, thresholds }), { ttl: TTL[group] || DAY });
      const r = await fresh;
      // STRICT: any error — even with an older stored copy behind it — is a failure, never a stale verdict.
      if (r.error) throw r.error;
      if (r.data == null || typeof r.data !== "object") throw new Error(`${group}: the stored answer was unreadable.`);
      return checks.map((c) => {
        const row = rowFromMeasurement(c.id, r.data, thresholds);
        if (!row) return failedRow(c, "No result.");
        return { ...row, id: c.id, label: c.label, layer: c.layer, ageMs: r.ageMs ?? null, ts: r.ts ?? null };
      });
    } catch (e) {
      logFailure(group, e);
      // A transport failure keeps its plain wording ("didn't respond in time…"); an internal complaint about the
      // answer's shape is not for the reader — the telemetry row above has the detail.
      const plain = classifyGisError(e).kind === "error" ? "The map source gave an answer Planyr couldn't use." : gisErrorMessage(e);
      return checks.map((c) => failedRow(c, plain));
    }
  }));
  const rowsById = new Map(results.flat().map((r) => [r.id, r]));
  const rows = TRUSTED_CHECKS.map((c) => rowsById.get(c.id)).filter(Boolean);
  return { regions: reg.regions, rows, untrusted, generatedAt: (opts.now || Date.now)() };
}
