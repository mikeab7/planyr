/* Jurisdiction + road-authority identify (B93 / B94) — ONE generic, registry-driven
 * ArcGIS-REST connector that rides the browser-local SWR cache (B96).
 *
 * What it answers, on explicit request (a click or "check this parcel" — NEVER
 * auto-loaded on every parcel):
 *   B93 — which jurisdictions a point/parcel falls in: incorporated city (or
 *         "unincorporated"), ETJ, and county. The whole parcel is tested (a polygon
 *         intersect, not just the centroid), so a boundary straddle returns EVERY
 *         jurisdiction it touches rather than forcing one answer.
 *   B94 — who maintains the road fronting a clicked point: State (TxDOT) / county /
 *         city / federal — a nearest-segment query against the TxDOT roadway lines.
 *
 * Design rules (from the backlog):
 *  - ONE connector, parameterized per source. Adding a city/source = adding a
 *    registry ROW (endpoint URL, layer, field map, query kind), never new code.
 *  - Every source names its fields differently; the field map normalizes each into
 *    one internal shape so the UI is source-agnostic.
 *  - Reuse existing GIS infra: the same SWR cache (B96), the same honest status +
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
import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { fetchArcgisJson, gisErrorMessage } from "./gisFetch.js";

// ---------------------------------------------------------------------------
// Source registry — one row per layer. `kind` picks the query: "polygon" = a
// point/parcel intersect (city/ETJ/county); "line" = nearest-segment within a
// tolerance (roads). `fields` maps the source's column names to our internal keys.
// A row with `unavailable:true` (no public endpoint yet) degrades gracefully.
// ---------------------------------------------------------------------------
export const JURISDICTION_SOURCES = {
  county: {
    id: "county", role: "county", label: "County", kind: "polygon",
    url: GIS_SOURCES.county.serviceUrl, // endpoint from the registry (B369) — never inline
    fields: { name: "CNTY_NM", fips: "FIPS_ST_CNTY_CD" },
    ttl: 30 * 24 * 3600 * 1000,
    sourceName: "TxDOT TPP (statewide)",
    note: "Texas county boundary (TxDOT). Screening only — verify with the jurisdiction.",
  },
  city: {
    id: "city", role: "city", label: "City limits", kind: "polygon",
    url: GIS_SOURCES.city.serviceUrl,
    fields: { name: "city_name" },
    ttl: 7 * 24 * 3600 * 1000,
    sourceName: "TxGIO (statewide)",
    note: "Texas city limits (TxGIO). A point in no city reads as unincorporated. Screening only — verify with the city.",
  },
  // ETJ is fragmented — there is NO statewide ETJ layer, and unlike Houston (where
  // H-GAC publishes ONE regional layer) the Austin/DFW metros publish ETJ city-by-city.
  // So ETJ is a REGION-ROUTED LIST of sources (see ETJ_SOURCES below), not one row here:
  // a click only queries the metro(s) whose bbox contains it, so a Houston lookup never
  // touches the Austin/DFW servers (no added latency for the Houston use case).
  road: {
    id: "road", role: "road", label: "Road maintenance authority", kind: "line",
    url: GIS_SOURCES.road.serviceUrl,
    // route = inventory id; name = local-street name (STE_NAM); hwy = coded on-system route
    // (HWY, e.g. "SL0008"); toll = toll-facility name; system = HSYS; authority = maint code;
    // funcClass = FHWA functional class (B94 per-road rows: name + class for the row + tie-break).
    fields: { route: "RIA_RTE_ID", name: "STE_NAM", hwy: "HWY", toll: "TOLL_NM", system: "HSYS", authority: "RDWAY_MAINT_AGCY", funcClass: "F_SYSTEM" },
    tolMeters: 40,
    ttl: 30 * 24 * 3600 * 1000,
    sourceName: "TxDOT Roadway Inventory",
    note: "Maintenance authority from the TxDOT Roadway Inventory. Local-road coverage is patchy — an honest \"unknown\" beats a wrong guess. Screening only.",
  },
};

/* ETJ (extraterritorial jurisdiction) sources — fragmented by region, so this is a
 * LIST, each row scoped to a metro `bbox` [latMin, lonMin, latMax, lonMax]. A click is
 * routed to only the source(s) whose bbox covers it (`etjSourcesForPoint`), so:
 *   • Houston click → ONLY H-GAC (one query — identical cost to before; no slowdown)
 *   • Austin click  → ONLY the Austin layer
 *   • DFW click     → ONLY the Fort Worth layer
 * Adding a city/region = adding a row here (the registry design), never new code.
 * All are AGOL-hosted (services*.arcgis.com) → CORS-clean from the app origin; each was
 * verified live 2026-06-17. Coverage is the MAJOR cities (per the owner's call): Houston
 * gets the whole metro via H-GAC's regional layer; Austin = the City of Austin's 2-/5-mile
 * ETJ; DFW = the City of Fort Worth ETJ (Dallas itself is landlocked — ~no ETJ). Smaller
 * suburbs in Austin/DFW aren't covered yet (they publish per-city) → such a point reads
 * "not in a city ETJ". ETJ is volatile (SB2038 releases; annexations) — always screening-only. */
export const ETJ_SOURCES = [
  {
    id: "etj_hgac", role: "etj", label: "ETJ (extraterritorial jurisdiction)", kind: "polygon",
    region: "Houston–Galveston (H-GAC)", bbox: [28.3, -97.1, 31.0, -94.2],
    url: GIS_SOURCES.etj_hgac.serviceUrl,
    fields: { name: "CITY" }, titleCaseName: true,
    ttl: 7 * 24 * 3600 * 1000,
    sourceName: "H-GAC (Houston-Galveston Area Council)", coverage: "13-county Houston-Galveston region (all cities)",
    note: "City ETJ across the H-GAC 13-county region. Screening only; verify with the city.",
  },
  {
    id: "etj_austin", role: "etj", label: "ETJ (extraterritorial jurisdiction)", kind: "polygon",
    region: "Austin", bbox: [29.7, -98.4, 30.95, -97.0],
    url: GIS_SOURCES.etj_austin.serviceUrl,
    fields: { name: null }, nameConst: "Austin",
    ttl: 7 * 24 * 3600 * 1000,
    sourceName: "City of Austin GIS", coverage: "City of Austin 2-mile & 5-mile ETJ",
    note: "City of Austin ETJ (2-/5-mile). Other Austin-metro cities publish separately — add as rows. Screening only.",
  },
  {
    id: "etj_fortworth", role: "etj", label: "ETJ (extraterritorial jurisdiction)", kind: "polygon",
    region: "Dallas–Fort Worth", bbox: [32.2, -98.3, 33.7, -96.5],
    url: GIS_SOURCES.etj_fortworth.serviceUrl,
    fields: { name: null }, nameConst: "Fort Worth",
    ttl: 7 * 24 * 3600 * 1000,
    sourceName: "City of Fort Worth GIS", coverage: "City of Fort Worth ETJ",
    note: "City of Fort Worth ETJ. Dallas is landlocked (~no ETJ); other DFW cities publish separately — add as rows. Screening only.",
  },
];

// bbox = [latMin, lonMin, latMax, lonMax] (same convention as COUNTIES_MAP).
const bboxHas = (b, lat, lng) => b && lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3];

/* Region routing: the ETJ source(s) whose metro bbox covers a point. A point outside
 * every covered metro returns [] (honest "no ETJ layer here" rather than a wrong guess).
 * This is what keeps a Houston click at exactly one ETJ query. Pure. */
export function etjSourcesForPoint(lat, lng) {
  return ETJ_SOURCES.filter((s) => bboxHas(s.bbox, lat, lng));
}

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
// Road-authority MAP overlay palette + per-feature style (NEW-2 / B571).
// A NEW categorical palette, deliberately NOT drawn from the locked palettes
// (project-status coral/blue/amber/grays, module accents Site #1D9E75 /
// Schedule #7F77DD / Review #EF9F27 / brand #D85A30) — each maintainer gets a
// distinct hue. Unknown is a legible neutral gray, dashed (distinguished by
// pattern, never by fading — hierarchy via weight, not opacity). The style is
// keyed off roadAuthority() — the SAME decode the identify + the card use — so
// the colored line can never drift from the authority the card reports.
// ---------------------------------------------------------------------------
export const ROAD_AUTHORITY_COLORS = {
  "City": "#C2185B",                          // raspberry
  "County": "#6A1B9A",                        // purple
  "State (TxDOT)": "#00838F",                 // dark cyan
  "Toll / managed-lane authority": "#283593", // indigo
  "Federal": "#827717",                       // olive
  "Unknown": "#546E7A",                       // blue-gray (drawn dashed)
};

// Legend rows for the Layers panel (shown when the overlay is on). `dash` flags the
// neutral Unknown stroke. Pure data — LayerPanel renders the swatches.
export const ROAD_AUTHORITY_LEGEND = [
  { label: "City", color: ROAD_AUTHORITY_COLORS["City"] },
  { label: "County", color: ROAD_AUTHORITY_COLORS["County"] },
  { label: "State (TxDOT)", color: ROAD_AUTHORITY_COLORS["State (TxDOT)"] },
  { label: "Toll / managed-lane authority", color: ROAD_AUTHORITY_COLORS["Toll / managed-lane authority"] },
  { label: "Federal", color: ROAD_AUTHORITY_COLORS["Federal"] },
  { label: "Unknown", color: ROAD_AUTHORITY_COLORS["Unknown"], dash: true },
];

/* Leaflet path style for one roadway-inventory feature, colored by maintainer.
 * `props` is the feature's attributes (RDWAY_MAINT_AGCY + HSYS). Pure — returns a
 * plain style object; layers.js wires it onto the esri-leaflet featureLayer. */
export function roadAuthorityStyle(props, opacity = 0.95) {
  const a = roadAuthority(props && props.RDWAY_MAINT_AGCY, props && props.HSYS);
  const color = ROAD_AUTHORITY_COLORS[a.label] || ROAD_AUTHORITY_COLORS.Unknown;
  const isUnknown = a.label === "Unknown";
  const style = { color, weight: isUnknown ? 2.5 : 3, opacity, fillOpacity: 0 };
  if (isUnknown) style.dashArray = "5,5"; // neutral Unknown distinguished by pattern, not by fading
  return style;
}

// Friendly road name from a roadway-inventory row's normalized fields. Local streets
// carry STE_NAM ("ATRIUM DR" → "Atrium Dr"); on-system highways carry a coded HWY
// ("SL0008" → "SL 8"); toll facilities may carry a TOLL_NM. Returns null when nothing
// names it — a bare numeric RIA_RTE_ID is an internal inventory id, never shown as a
// name (so an unnamed road merges/labels by id instead of a meaningless number). Pure.
export function formatHighway(hwy) {
  const s = String(hwy == null ? "" : hwy).trim().toUpperCase();
  if (!s) return null;
  const m = s.match(/^([A-Z]{1,3})0*(\d+)([A-Z].*)?$/);
  if (!m) return s;
  return `${m[1]} ${m[2]}${m[3] ? " " + m[3].trim() : ""}`;
}
export function roadDisplayName(n) {
  const ste = n && n.name != null ? String(n.name).trim().replace(/\s+/g, " ") : "";
  if (ste) return titleCase(ste);
  if (n && n.hwy) { const h = formatHighway(n.hwy); if (h) return h; }
  if (n && n.toll) { const t = String(n.toll).trim(); if (t) return titleCase(t); }
  return null;
}

// ---------------------------------------------------------------------------
// Generic connector
// ---------------------------------------------------------------------------
const trimUrl = (s) => String(s).replace(/\/+$/, "");

// Default browser fetch → parsed ArcGIS JSON. The shared resilient fetch (B366):
// AbortController timeout + jittered-backoff retry on a transient 5xx/network blip, so a
// burst-load 503 self-heals instead of freezing the identify at "failed". Throws a typed
// GisFetchError on a real failure.
const defaultFetchJson = (url, opts) => fetchArcgisJson(url, opts);

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
    p.resultRecordCount = source.kind === "line" ? 40 : 30;
    // A line source against a parcel = its FRONTAGE: buffer the parcel by the tolerance
    // so a road centreline in the ROW just outside the lot line still intersects.
    if (source.kind === "line") { p.distance = source.tolMeters || 40; p.units = "esriSRUnit_Meter"; }
  } else {
    p.geometry = JSON.stringify({ x: geom.lng, y: geom.lat, spatialReference: { wkid: 4326 } });
    p.geometryType = "esriGeometryPoint";
    if (source.kind === "line") { p.distance = source.tolMeters || 40; p.units = "esriSRUnit_Meter"; p.resultRecordCount = 12; }
    else p.resultRecordCount = 8;
  }
  return p;
}

// Title-case an ALL-CAPS source value for display ("MISSOURI CITY" → "Missouri City").
const titleCase = (s) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Map a feature's raw attributes onto the source's internal keys (field map). Pure.
export function normalizeFeature(source, attrs) {
  const out = { role: source.role };
  for (const [key, col] of Object.entries(source.fields)) out[key] = col ? (attrs?.[col] ?? null) : null;
  // A single-jurisdiction layer (one with no per-feature name column) carries no name;
  // every matched feature IS that jurisdiction, so fall back to the source constant.
  if ((out.name == null || out.name === "") && source.nameConst) out.name = source.nameConst;
  // Some sources publish the name ALL-CAPS (e.g. H-GAC ETJ `CITY`) → title-case it.
  if (out.name != null && out.name !== "" && source.titleCaseName) out.name = titleCase(out.name);
  return out;
}

// Short, point-independent cache signature for a parcel ring (count + rounded bbox).
function ringKey(ring) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of ring) { if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; }
  return ring.length + "_" + [minx, miny, maxx, maxy].map((n) => n.toFixed(4)).join(",");
}

/* Identify one source against a point or ring, riding the SWR cache (B96). Returns
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

// ---- nearest-segment distance (B94) ----
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

/* Total length (metres) of an ArcGIS polyline's paths, via the same local
 * equirectangular projection about a reference latitude. Used to order fronting
 * roads by abutment (longest first). Pure; 0 for missing geometry. */
export function polylineLengthMeters(geometry, lat = 0) {
  const paths = geometry && geometry.paths;
  if (!paths || !paths.length) return 0;
  const mx = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  let total = 0;
  for (const path of paths) {
    for (let i = 0; i + 1 < path.length; i++) {
      const [ax, ay] = path[i], [bx, by] = path[i + 1];
      total += Math.hypot((bx - ax) * mx, (by - ay) * M_PER_DEG_LAT);
    }
  }
  return total;
}

const uniq = (a) => Array.from(new Set(a));
// Honest, taxonomy-based error text (B366) — a transient 503 reads "temporarily
// unavailable," never the misleading blanket "network or CORS."
const humanize = (e) => gisErrorMessage(e);

// ---------------------------------------------------------------------------
// B93 — jurisdiction identify (city / ETJ / county) at a point or across a parcel.
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
  // Each role resolves to ONE source (county/city) or a region-routed LIST (etj).
  const sourcesForRole = (role) =>
    role === "etj" ? etjSourcesForPoint(lat, lng) : (JURISDICTION_SOURCES[role] ? [JURISDICTION_SOURCES[role]] : []);
  await Promise.all(roles.map(async (role) => {
    const srcs = sourcesForRole(role).filter((s) => s && !s.unavailable && s.url);
    if (!srcs.length) {
      // no source for this role/area — e.g. ETJ outside the covered metros (honest, not a guess)
      out[role] = []; out.ages[role] = null;
      out.sources.push({ id: role, state: "unavailable", ageMs: null, msg: role === "etj" ? "No ETJ layer for this area yet." : null });
      return;
    }
    opts.onStatus && opts.onStatus(role, "loading");
    // Query every source for the role in parallel and UNION the names (a point can sit
    // in two cities' ETJ at a metro seam; a parcel can straddle two cities).
    const parts = await Promise.all(srcs.map(async (src) => {
      const q = identifySource(src, geom, opts);
      const r = await q.fresh;
      const names = uniq(r.items.map((it) => normalizeFeature(src, it.attrs).name).filter((v) => v != null && v !== "").map(String));
      return { names, error: r.error || null, ageMs: r.ageMs, ts: r.ts, stale: q.stale };
    }));
    const names = uniq(parts.flatMap((p) => p.names));
    const ages = parts.map((p) => p.ageMs).filter((a) => a != null);
    out[role] = names;
    out.ages[role] = ages.length ? Math.min(...ages) : null;
    const errPart = parts.find((p) => p.error);
    const state = names.length ? "loaded" : errPart ? "failed" : "empty";
    out.sources.push({ id: role, state, ageMs: out.ages[role], msg: errPart ? humanize(errPart.error) : null });
    opts.onStatus && opts.onStatus(role, state, errPart ? humanize(errPart.error) : null, { ts: parts[0]?.ts ?? null, stale: parts.some((p) => p.stale) });
  }));
  out.unincorporated = out.city.length === 0;
  out.straddle = out.city.length > 1 || out.county.length > 1;
  return out;
}

/* B763 — compact jurisdiction badge for the ACTIVE parcel/site. Turns an
 * `identifyJurisdiction` result into ONE screening-line string a developer reads
 * without toggling any boundary layer:
 *   • in a city            → "City of Houston · Harris County"
 *   • in an ETJ, no city    → "City of Baytown — ETJ · Harris County"
 *   • neither               → "Unincorporated · Waller County"
 *   • straddle              → both listed ("City of Houston / City of Katy · …"),
 *                             `straddle:true` so the badge can mark it (⚑).
 * ETJ names already covered by a matched city are dropped (a limit straddle reads
 * "City of Houston", not "… / City of Houston — ETJ"). Once B764 lands, an ISD name
 * appends via `opts.isd`. Pure → unit-tested; null when there's nothing to show. */
export function formatJurisdictionBadge(j, opts = {}) {
  if (!j) return null;
  const cities = uniq((j.city || []).filter((v) => v != null && v !== "").map(String));
  const etjs = uniq((j.etj || []).filter((v) => v != null && v !== "").map(String)).filter((e) => !cities.includes(e));
  const counties = uniq((j.county || []).filter((v) => v != null && v !== "").map(String));
  const parts = [...cities.map((c) => `City of ${c}`), ...etjs.map((c) => `City of ${c} — ETJ`)];
  const jur = parts.length ? parts.join(" / ") : "Unincorporated";
  const county = counties.length ? counties.map((c) => `${c} County`).join(" / ") : null;
  const isd = opts.isd ? String(opts.isd) : null; // B764: appended when the ISD layer lands
  const text = [jur, county, isd].filter(Boolean).join(" · ");
  return { text, jur, county, isd, straddle: !!j.straddle };
}

// Configured CAD county keys (those with a wired parcel service) — maps a TxDOT
// county name back onto the app's routing keys for the B36(a) label correction.
const COUNTY_NAME_TO_KEY = { harris: "harris", "fort bend": "fortbend", chambers: "chambers" };

/* The true county at a point, via the verified TxDOT county-boundary layer (cached).
 * Returns { name, key } — `key` is the app's configured CAD key when recognized,
 * else null (county known but not a wired CAD). This is the point-in-county
 * primitive B13-pt1 / B36(a) were waiting on: a parcel that the statewide TxGIO
 * fallback labelled "Chambers" can be checked and relabelled to its real county.
 * (Deliberately NOT used to REPLACE the bbox routing pre-filter — the existing
 * parallel "query candidates, answerer wins" identify is faster + more resilient
 * than a blocking county lookup; this only corrects a label after the fact.) */
export async function countyAtPoint(lng, lat, opts = {}) {
  const src = JURISDICTION_SOURCES.county;
  const r = await identifySource(src, { lng, lat }, opts).fresh;
  const name = r.items.map((it) => normalizeFeature(src, it.attrs).name).find(Boolean) || null;
  if (!name) return { name: null, key: null, ageMs: r.ageMs, error: r.error ? humanize(r.error) : null };
  return { name: String(name), key: COUNTY_NAME_TO_KEY[String(name).toLowerCase()] || null, ageMs: r.ageMs, ts: r.ts };
}

// ---------------------------------------------------------------------------
// B94 — road maintenance authority. Two modes:
//   • click (lng,lat)      → the NEAREST segment within tolerance.
//   • parcel frontage (ring)→ EVERY distinct road fronting the parcel (a lot can
//     front a state highway + a county road + a city street, each a different
//     permitting desk).
// A site usually fronts SEVERAL roads, and each can have a different maintainer, so
// the result is a per-road list: multiple inventory segments of the SAME road merge
// into one row (no "Greens Rd" listed three times), ordered by frontage length
// (longest abutment first), tie-broken by road class (arterial before local). Each
// row carries name + route + authority + class. Returns { roads[], nearest|null,
// authorities[] (distinct labels), ... } — or an honest empty/unknown when nothing
// mapped is within tolerance (never a guess; the honest-unknown rule applies per road).
// ---------------------------------------------------------------------------
export async function identifyRoadAuthority(lng, lat, opts = {}) {
  const src = JURISDICTION_SOURCES.road;
  const ring = opts.ring && opts.ring.length >= 3 ? opts.ring : null;
  opts.onStatus && opts.onStatus("road", "loading");
  const q = identifySource(src, ring ? { ring } : { lng, lat }, opts);
  const r = await q.fresh;
  // Normalize each segment → its name + authority + frontage length. Point mode also
  // measures distance to the click (nearest wins); frontage mode measures abutment length.
  const rows = r.items.map((it) => {
    const n = normalizeFeature(src, it.attrs);
    return {
      route: n.route, name: roadDisplayName(n), system: n.system, funcClass: n.funcClass,
      authority: roadAuthority(n.authority, n.system),
      distMeters: ring ? null : Math.round(polylineDistMeters(it.geometry, lng, lat)),
      lengthM: polylineLengthMeters(it.geometry, lat),
    };
  });
  if (!ring) rows.sort((a, b) => (a.distMeters ?? Infinity) - (b.distMeters ?? Infinity));
  // Merge segments of the SAME road into one row. Key = the road's name when known (so
  // a multi-segment "Greens Rd" collapses to one), else its route id. When a segment has
  // NEITHER (rare — both STE_NAM/HWY/TOLL and RIA_RTE_ID absent), it keys per-segment
  // (seg:<idx>) so two physically distinct unnamed roads sharing a maintainer stay
  // SEPARATE rows rather than collapsing into one (which would undercount fronting roads).
  // Frontage length sums across merged segments; the highest road class (lowest F_SYSTEM)
  // wins; name/route/authority follow the LONGEST contributing segment (strict > so a
  // later equal/zero-length segment never displaces the first — the nearest, in point mode).
  const byKey = new Map();
  rows.forEach((row, idx) => {
    const key = (row.name && row.name.toLowerCase()) || row.route || ("seg:" + idx);
    const cur = byKey.get(key);
    if (!cur) { byKey.set(key, { ...row, _maxSeg: row.lengthM }); return; }
    cur.lengthM += row.lengthM;
    if (row.funcClass != null && (cur.funcClass == null || Number(row.funcClass) < Number(cur.funcClass))) cur.funcClass = row.funcClass;
    if (row.lengthM > (cur._maxSeg || 0)) { cur._maxSeg = row.lengthM; cur.authority = row.authority; if (row.route != null) cur.route = row.route; if (row.name) cur.name = row.name; }
    if (row.distMeters != null && (cur.distMeters == null || row.distMeters < cur.distMeters)) cur.distMeters = row.distMeters;
  });
  const roads = Array.from(byKey.values()).map((x) => { delete x._maxSeg; return x; });
  // Frontage mode: order by abutment length desc, then by road class (arterial before local).
  if (ring) roads.sort((a, b) => (b.lengthM - a.lengthM) || ((Number(a.funcClass) || 99) - (Number(b.funcClass) || 99)));
  const nearest = !ring && roads.length ? roads[0] : null;
  const authorities = uniq(roads.map((x) => x.authority.label));
  const state = roads.length ? "loaded" : r.error ? "failed" : "empty";
  opts.onStatus && opts.onStatus("road", state, r.error ? humanize(r.error) : null, { ts: r.ts, stale: q.stale });
  return {
    roads, nearest, authorities, ageMs: r.ageMs, ts: r.ts, tolMeters: src.tolMeters,
    error: r.error ? humanize(r.error) : null,
    note: roads.length ? src.note : r.error ? humanize(r.error) : `No roads matched within ${src.tolMeters} m — screening only.`,
  };
}
