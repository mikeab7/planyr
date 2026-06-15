/* Jurisdiction + road-authority identify (B72 / B73) — ONE generic, registry-driven
 * ArcGIS-REST connector that rides the browser-local SWR cache (B75).
 *
 * What it answers, on explicit request (a click or "check this parcel" — NEVER
 * auto-loaded on every parcel):
 *   B72 — which jurisdictions a point/parcel falls in: incorporated city (or
 *         "unincorporated"), ETJ, and county. The whole parcel is tested (a polygon
 *         intersect, not just the centroid), so a boundary straddle returns EVERY
 *         jurisdiction it touches rather than forcing one answer.
 *   B73 — who maintains the road fronting a clicked point: State (TxDOT) / county /
 *         city / federal — a nearest-segment query against the TxDOT roadway lines.
 *
 * Design rules (from the backlog):
 *  - ONE connector, parameterized per source. Adding a city/source = adding a
 *    registry ROW (endpoint URL, layer, field map, query kind), never new code.
 *  - Every source names its fields differently; the field map normalizes each into
 *    one internal shape so the UI is source-agnostic.
 *  - Reuse existing GIS infra: the same SWR cache (B75), the same honest status +
 *    visible data-age, the same EPSG:4326 lon/lat boundary as the parcel identify.
 *  - Screening-only: results always carry a source + age and a "verify with the
 *    jurisdiction" note; ETJ especially is volatile. Never a legal determination.
 *  - Honest unknown beats a wrong guess (road jurisdiction data is patchy).
 *
 * Endpoints below were verified live + calibrated against known ground 2026-06-15
 * (downtown Houston → city "Houston" / county "Harris"; IH=State, CR=County,
 * LS=City). The pure logic (param build, normalization, nearest-segment, agency
 * mapping) takes an injectable fetch + cache so it unit-tests in Node, no network.
 */

import { gisCache as defaultCache } from "./gisCache.js";

// ---------------------------------------------------------------------------
// Source registry — one row per layer. `kind` picks the query: "polygon" = a
// point/parcel intersect (city/ETJ/county); "line" = nearest-segment within a
// tolerance (roads). `fields` maps the source's column names to our internal keys.
// A row with `unavailable:true` (no public endpoint yet) degrades gracefully.
// ---------------------------------------------------------------------------
export const JURISDICTION_SOURCES = {
  county: {
    id: "county", role: "county", label: "County", kind: "polygon",
    url: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/Texas_County_Boundaries/FeatureServer/0",
    fields: { name: "CNTY_NM", fips: "FIPS_ST_CNTY_CD" },
    ttl: 30 * 24 * 3600 * 1000,
    sourceName: "TxDOT TPP (statewide)",
    note: "Texas county boundary (TxDOT). Screening only — verify with the jurisdiction.",
  },
  city: {
    id: "city", role: "city", label: "City limits", kind: "polygon",
    url: "https://feature.geographic.texas.gov/arcgis/rest/services/City_Boundaries/Texas_City_Boundaries/MapServer/0",
    fields: { name: "city_name" },
    ttl: 7 * 24 * 3600 * 1000,
    sourceName: "TxGIO (statewide)",
    note: "Texas city limits (TxGIO). A point in no city reads as unincorporated. Screening only — verify with the city.",
  },
  // ETJ is fragmented (no statewide layer): wired to the City of Houston's own GIS
  // (COHGIS) ETJ — the priority metro. It is Houston-only, so a point outside
  // Houston's ETJ reads "not in Houston ETJ" (it may still sit in another city's
  // ETJ — add those as rows). The layer carries no per-feature city name, so the
  // name is a constant. ETJ is volatile by law (SB2038 releases; annexations move
  // it), so it is ALWAYS screening-only. Verified + calibrated 2026-06-15 (Aldine /
  // Spring, unincorporated near Houston → in ETJ; downtown / in-city → not).
  etj: {
    id: "etj", role: "etj", label: "ETJ (extraterritorial jurisdiction)", kind: "polygon",
    url: "https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/COH_ETJ_view/FeatureServer/1",
    fields: { name: null }, nameConst: "Houston",
    ttl: 7 * 24 * 3600 * 1000,
    sourceName: "City of Houston GIS (COHGIS)",
    coverage: "City of Houston only",
    note: "City of Houston ETJ (COHGIS, reflects SB2038 releases). Houston metro only — add other cities' ETJ as registry rows. ETJ is volatile — screening only.",
  },
  road: {
    id: "road", role: "road", label: "Road maintenance authority", kind: "line",
    url: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Roadway_Inventory/FeatureServer/0",
    fields: { route: "RIA_RTE_ID", system: "HSYS", authority: "RDWAY_MAINT_AGCY", funcClass: "F_SYSTEM" },
    tolMeters: 40,
    ttl: 30 * 24 * 3600 * 1000,
    sourceName: "TxDOT Roadway Inventory",
    note: "Maintenance authority from the TxDOT Roadway Inventory. Local-road coverage is patchy — an honest \"unknown\" beats a wrong guess. Screening only.",
  },
};

// ---------------------------------------------------------------------------
// Road maintenance authority — RDWAY_MAINT_AGCY → who maintains the segment.
// Calibrated from the live TxDOT Roadway Inventory distinct HSYS×agency cross-tab
// (2026-06-15): code 1 rides the state systems (IH/US/SH/FM/RM/SL/SS/BU/BI/PR…);
// 2 rides county roads (CR); 4 rides local streets (LS); codes 7–15 ride ONLY
// federal-land roads (HSYS=FD); 5/6/16 ride toll/managed lanes (HSYS=TL). Anything
// unrecognized degrades to honest "unknown" rather than a fabricated answer.
// ---------------------------------------------------------------------------
export const ROAD_MAINT_AGENCY = {
  1:  { label: "State (TxDOT)", onSystem: true },
  2:  { label: "County", onSystem: false },
  4:  { label: "City", onSystem: false },
  5:  { label: "Toll / managed-lane authority", onSystem: true },
  6:  { label: "Toll / managed-lane authority", onSystem: true },
  16: { label: "Toll / managed-lane authority", onSystem: true },
};
// HSYS fallback when the agency code is missing/unrecognized (a few segments lack it).
const HSYS_AUTHORITY = {
  CR: { label: "County", onSystem: false },
  LS: { label: "City", onSystem: false },
  FD: { label: "Federal", onSystem: false },
};
// On-system (state-maintained) highway-system prefixes, for the HSYS fallback only.
const ON_SYSTEM_HSYS = new Set(["IH","US","SH","SA","FM","RM","PR","SL","SS","BI","BU","BS","BF","UA","UP","RR","RE","RS","FS","PA","TL"]);

/* Resolve a maintenance authority from the coded agency + highway system. The
 * agency code wins; HSYS is the fallback; everything else is an honest "Unknown".
 * Returns { code, label, onSystem|null, basis }. Pure. */
export function roadAuthority(maintCode, hsys) {
  const code = maintCode == null || maintCode === "" ? null : Number(maintCode);
  const direct = code != null ? ROAD_MAINT_AGENCY[code] : null;
  const federal = code != null && code >= 7 && code <= 15 ? { label: "Federal", onSystem: false } : null;
  const a = direct || federal;
  if (a) return { code, label: a.label, onSystem: a.onSystem, basis: "maint_agcy" };
  const h = hsys && HSYS_AUTHORITY[hsys];
  if (h) return { code, label: h.label, onSystem: h.onSystem, basis: "hsys" };
  if (hsys && ON_SYSTEM_HSYS.has(hsys)) return { code, label: "State (TxDOT)", onSystem: true, basis: "hsys" };
  return { code, label: "Unknown", onSystem: null, basis: "unknown" };
}

// ---------------------------------------------------------------------------
// Generic connector
// ---------------------------------------------------------------------------
const trimUrl = (s) => String(s).replace(/\/+$/, "");

// Default browser fetch → parsed ArcGIS JSON (throws on HTTP / ArcGIS error).
async function defaultFetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server returned HTTP ${res.status}.`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "ArcGIS query error.");
  return j;
}

function buildQueryUrl(base, params) {
  const u = new URL(trimUrl(base) + "/query");
  u.searchParams.set("f", "json");
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  return u.toString();
}

// Cap a ring's vertex count so the GET query URL stays well within length limits;
// a parcel boundary is normally tiny, but a heavily-digitized one is decimated by
// even sampling (endpoints always kept). Pure.
export function simplifyRing(ring, max = 80) {
  if (!ring || ring.length <= max) return ring || [];
  const step = (ring.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(ring[Math.round(i * step)]);
  return out;
}

const closeRing = (r) => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);

/* Build the /query params for a source against either a point {lng,lat} or a
 * lon/lat parcel ring {ring}. Polygon sources test for intersection (the whole
 * parcel when a ring is given → straddle); line sources buffer the point by the
 * source tolerance and return geometry so the caller can pick the nearest. Pure. */
export function buildIdentifyParams(source, geom) {
  const outFields = Object.values(source.fields).filter(Boolean).join(",") || "*";
  const p = {
    outFields,
    inSR: 4326, outSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    returnGeometry: source.kind === "line" ? "true" : "false",
  };
  if (geom.ring && geom.ring.length >= 3) {
    p.geometry = JSON.stringify({ rings: [closeRing(simplifyRing(geom.ring))], spatialReference: { wkid: 4326 } });
    p.geometryType = "esriGeometryPolygon";
    p.resultRecordCount = 30;
  } else {
    p.geometry = JSON.stringify({ x: geom.lng, y: geom.lat, spatialReference: { wkid: 4326 } });
    p.geometryType = "esriGeometryPoint";
    if (source.kind === "line") { p.distance = source.tolMeters || 40; p.units = "esriSRUnit_Meter"; p.resultRecordCount = 12; }
    else p.resultRecordCount = 8;
  }
  return p;
}

// Map a feature's raw attributes onto the source's internal keys (field map). Pure.
export function normalizeFeature(source, attrs) {
  const out = { role: source.role };
  for (const [key, col] of Object.entries(source.fields)) out[key] = col ? (attrs?.[col] ?? null) : null;
  // A single-jurisdiction layer (e.g. the Houston-only ETJ) carries no name column;
  // every matched feature IS that jurisdiction, so fall back to the source constant.
  if ((out.name == null || out.name === "") && source.nameConst) out.name = source.nameConst;
  return out;
}

// Short, point-independent cache signature for a parcel ring (count + rounded bbox).
function ringKey(ring) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of ring) { if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; }
  return ring.length + "_" + [minx, miny, maxx, maxy].map((n) => n.toFixed(4)).join(",");
}

/* Identify one source against a point or ring, riding the SWR cache (B75). Returns
 * { cached, stale, fresh } like the cache itself: `cached` is the last-good copy to
 * show NOW (may be stale; its age is carried), `fresh` resolves to the revalidated
 * copy (or keeps last-good on a failed refresh, error surfaced not thrown). The
 * cached payload is the raw feature list [{attrs, geometry}] — small JSON, so it
 * persists in localStorage across reloads. */
export function identifySource(source, geom, opts = {}) {
  if (source.unavailable || !source.url) {
    return { cached: null, stale: false, unavailable: true, fresh: Promise.resolve({ items: [], ageMs: null, ts: null, unavailable: true }) };
  }
  const cache = opts.cache || defaultCache;
  const fetchJson = opts.fetchJson || defaultFetchJson;
  const where = geom.ring ? "poly:" + ringKey(geom.ring) : Number(geom.lng).toFixed(4) + "," + Number(geom.lat).toFixed(4);
  const key = "juris:" + source.id + ":" + where;
  const fetcher = async () => {
    const j = await fetchJson(buildQueryUrl(source.url, buildIdentifyParams(source, geom)));
    return (j.features || []).map((f) => ({ attrs: f.attributes || {}, geometry: f.geometry || null }));
  };
  const { cached, stale, fresh } = cache.swr(key, fetcher, { ttl: source.ttl || 0 });
  const shape = (e) => (e ? { items: e.data || e.items || [], ageMs: e.ageMs, ts: e.ts } : null);
  return {
    cached: shape(cached),
    stale,
    fresh: fresh.then((r) => ({ items: r.data || [], ageMs: r.ageMs, ts: r.ts, error: r.error || null, updated: !!r.updated })),
  };
}

// ---- nearest-segment distance (B73) ----
const M_PER_DEG_LAT = 111320;
function segDistM(ax, ay, bx, by) {
  // distance from origin (0,0) to segment AB, all in metres
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? -(ax * dx + ay * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(cx, cy);
}
/* Minimum distance (metres) from a click to an ArcGIS polyline, via a local
 * equirectangular projection about the click. Pure. */
export function polylineDistMeters(geometry, lng, lat) {
  const paths = geometry && geometry.paths;
  if (!paths || !paths.length) return Infinity;
  const mx = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const toM = ([lo, la]) => [(lo - lng) * mx, (la - lat) * M_PER_DEG_LAT];
  let best = Infinity;
  for (const path of paths) {
    if (path.length === 1) { const [ax, ay] = toM(path[0]); best = Math.min(best, Math.hypot(ax, ay)); continue; }
    for (let i = 0; i + 1 < path.length; i++) {
      const [ax, ay] = toM(path[i]), [bx, by] = toM(path[i + 1]);
      const d = segDistM(ax, ay, bx, by);
      if (d < best) best = d;
    }
  }
  return best;
}

const uniq = (a) => Array.from(new Set(a));
function humanize(e) {
  const m = String(e?.message || e || "");
  if (/failed to fetch|networkerror|load failed|cors/i.test(m)) return "Couldn't reach the GIS server (network or CORS).";
  return m || "Request failed.";
}

// ---------------------------------------------------------------------------
// B72 — jurisdiction identify (city / ETJ / county) at a point or across a parcel.
// Pass `ring` (the parcel's lon/lat outer ring) to test the WHOLE parcel so a
// boundary straddle lists every jurisdiction it touches. Awaits fresh data (the
// cache makes a repeat/just-reloaded lookup instant and survives a source outage).
// `onStatus(role, state, msg, {ts, stale})` mirrors the evidence-layer channel.
// ---------------------------------------------------------------------------
export async function identifyJurisdiction(lng, lat, opts = {}) {
  const geom = opts.ring && opts.ring.length >= 3 ? { ring: opts.ring } : { lng, lat };
  const roles = opts.roles || ["county", "city", "etj"];
  const out = {
    point: { lng, lat }, city: [], county: [], etj: [],
    unincorporated: false, straddle: false, ages: {}, sources: [],
    note: "Screening only — verify with the jurisdiction. Boundaries (especially ETJ) change.",
  };
  await Promise.all(roles.map(async (role) => {
    const src = JURISDICTION_SOURCES[role];
    if (!src) return;
    if (src.unavailable) { out.sources.push({ id: role, state: "unavailable", ageMs: null, msg: src.note }); return; }
    opts.onStatus && opts.onStatus(role, "loading");
    const q = identifySource(src, geom, opts);
    const r = await q.fresh;
    const names = uniq(r.items.map((it) => normalizeFeature(src, it.attrs).name).filter((v) => v != null && v !== "").map(String));
    out.ages[role] = r.ageMs;
    out[role] = names;
    const state = r.error && !r.items.length ? "failed" : names.length ? "loaded" : "empty";
    out.sources.push({ id: role, state, ageMs: r.ageMs, msg: r.error ? humanize(r.error) : null });
    opts.onStatus && opts.onStatus(role, state, r.error ? humanize(r.error) : null, { ts: r.ts, stale: q.stale });
  }));
  out.unincorporated = out.city.length === 0;
  out.straddle = out.city.length > 1 || out.county.length > 1;
  return out;
}

// ---------------------------------------------------------------------------
// B73 — road maintenance authority near a clicked point. Buffers the point by the
// source tolerance, then returns the NEAREST segment's authority (State / county /
// city / federal), or an honest null when nothing mapped is within tolerance.
// ---------------------------------------------------------------------------
export async function identifyRoadAuthority(lng, lat, opts = {}) {
  const src = JURISDICTION_SOURCES.road;
  opts.onStatus && opts.onStatus("road", "loading");
  const q = identifySource(src, { lng, lat }, opts);
  const r = await q.fresh;
  let best = null, bestD = Infinity;
  for (const it of r.items) {
    const d = polylineDistMeters(it.geometry, lng, lat);
    if (d < bestD) { bestD = d; best = it; }
  }
  if (!best) {
    const state = r.error ? "failed" : "empty";
    opts.onStatus && opts.onStatus("road", state, r.error ? humanize(r.error) : null, { ts: r.ts, stale: q.stale });
    return { road: null, ageMs: r.ageMs, ts: r.ts, error: r.error ? humanize(r.error) : null,
      note: r.error ? humanize(r.error) : `No mapped road within ${src.tolMeters} m — maintenance authority unknown.` };
  }
  const n = normalizeFeature(src, best.attrs);
  opts.onStatus && opts.onStatus("road", "loaded", null, { ts: r.ts, stale: q.stale });
  return {
    road: { route: n.route, system: n.system, funcClass: n.funcClass, authority: roadAuthority(n.authority, n.system), distMeters: Math.round(bestD) },
    ageMs: r.ageMs, ts: r.ts, note: src.note,
  };
}
