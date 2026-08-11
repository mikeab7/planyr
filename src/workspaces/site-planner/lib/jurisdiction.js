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
import { proxyServiceUrl } from "../../../shared/gis/gisProxyCore.js";
/* B209502 — the network-free county floor beneath the live boundary identify. Pure; answers only
 * once its asset is resident, and returns a `pending` verdict rather than a guess before that. */
import { resolveCounty } from "./countyPolygons.js";
/* NEW-1 (B367296) — the ONE canonical label formatter. Read its header before changing any badge
 * wording: it owns the four shapes and the three-level separator grammar that keeps a governing
 * authority from being joined to a merely-adjacent city by the same mark. */
import { formatJurisdictionLabel } from "./jurisdictionLabel.js";

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
  /* NEW-5 — Colorado's county boundaries. Same `role: "county"` so every downstream consumer
   * (authorityForJurisdiction, the badge, the flood-group scoping) reads it identically; only the
   * endpoint and field names differ. Routed to by `countySourcesForPoint`, never by default. */
  countyCo: {
    id: "countyCo", role: "county", label: "County", kind: "polygon",
    url: GIS_SOURCES.countyCo.serviceUrl,
    fields: { name: "NAME20", fips: "GEOID20" },
    ttl: 30 * 24 * 3600 * 1000,
    sourceName: "Colorado statewide county boundaries",
    note: "Colorado county boundary. Screening only — verify with the jurisdiction.",
  },
  city: {
    id: "city", role: "city", label: "City limits", kind: "polygon",
    url: GIS_SOURCES.city.serviceUrl,
    fields: { name: "city_name" },
    ttl: 7 * 24 * 3600 * 1000,
    sourceName: "TxGIO (statewide)",
    note: "Texas city limits (TxGIO). A point in no city reads as unincorporated. Screening only — verify with the city.",
  },
  isd: {
    id: "isd", role: "isd", label: "School district", kind: "polygon",
    url: GIS_SOURCES.isd.serviceUrl, // TEA statewide school-district boundaries (B764) — from the registry
    fields: { name: "NAME", number: "DISTRICT_N" },
    ttl: 30 * 24 * 3600 * 1000, // districts change rarely; a month keeps the cached copy fresh
    sourceName: "Texas Education Agency (TEA)",
    note: "School district (ISD) — a taxing / attendance boundary, not a service network. Screening only; verify with the district.",
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
    /* NEW-1a — the roster is the HONEST bound on what this layer can answer, read from the registry
     * so there is one source of truth. The old `coverage` string claimed "all cities" and was wrong
     * by about seventy of them. */
    roster: GIS_SOURCES.etj_hgac.roster,
    sourceName: "H-GAC (Houston-Galveston Area Council)", coverage: "34 named cities in the H-GAC region — NOT all of them (see `roster`)",
    note: "City ETJ across the H-GAC 13-county region. Screening only; verify with the city.",
  },
  /* ⛔ NEW-1a — BAYTOWN, because H-GAC's "regional" mosaic does not carry it. The owner reported
   * that part of Goose Creek is in Baytown's city limits and part in its ETJ; the app showed
   * neither, because the one ETJ source it asks omits Baytown entirely (see `roster` on the H-GAC
   * row). Measured on his site `sms69x8rb2qk`: 6 of 14 tested parcels inside Baytown's limits, the
   * other 8 inside Baytown's ETJ, none unincorporated. This layer carries a single jurisdiction, so
   * it takes `nameConst` exactly like the Austin and Fort Worth rows. */
  {
    id: "etj_baytown", role: "etj", label: "ETJ (extraterritorial jurisdiction)", kind: "polygon",
    region: "Baytown", bbox: [29.6, -95.15, 30.0, -94.75],
    url: GIS_SOURCES.etj_baytown.serviceUrl,
    fields: { name: null }, nameConst: "Baytown",
    ttl: 7 * 24 * 3600 * 1000,
    sourceName: "City of Baytown GIS", coverage: "City of Baytown ETJ",
    note: "City of Baytown ETJ, from the city's own layer (the H-GAC regional ETJ mosaic does not include Baytown). Screening only; verify with the city.",
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

/* ⛔ NEW-1a — DOES ANY ROUTED ETJ SOURCE ACTUALLY CARRY THIS CITY?
 *
 * An ETJ query that succeeds and returns nothing has been read as "this site is in no ETJ". For a
 * city the layer does not carry, that is a fabrication: the correct answer is "we don't publish an
 * ETJ for that city." H-GAC's mosaic is described in its own registry row as covering the whole
 * 13-county region and in fact carries **34** cities — Baytown, Katy, Humble, La Porte, Deer Park,
 * Friendswood, League City, Galveston and Tomball are not among them. The owner's Goose Creek is
 * the case in point: 8 of its 14 tested parcels are inside Baytown's ETJ and the app saw nothing.
 *
 * A source declares what it covers: an explicit `roster` (H-GAC), or a `nameConst` (a single-city
 * layer). A source that declares NEITHER is assumed to cover everything in its bbox — the honest
 * default, because an undeclared roster is unknown, not empty. Pure. */
export function etjSourceCovers(source, cityName) {
  if (!source) return false;
  if (source.nameConst) return samePlace(source.nameConst, cityName);
  if (Array.isArray(source.roster)) return source.roster.some((n) => samePlace(n, cityName));
  return true;
}
export function etjCoverageFor(cityName, lat, lng) {
  const srcs = etjSourcesForPoint(lat, lng);
  if (!srcs.length) return "no-layer";                                    // outside every covered metro
  return srcs.some((s) => etjSourceCovers(s, cityName)) ? "covered" : "not-mapped";
}

/* NEW-5 — the COUNTY role becomes region-routed too, exactly the way ETJ already is.
 *
 * The default county source is TxDOT's Texas layer, which of course answers nothing in Colorado —
 * and "nothing" is the dangerous outcome, because an empty county list is what lets a Colorado
 * site fall through to a Texas default further down the chain. So a Colorado point resolves
 * against Colorado's own statewide county layer instead.
 *
 * ⛔ TEXAS IS UNTOUCHED, BY CONSTRUCTION: this returns the SAME `JURISDICTION_SOURCES.county`
 * object for every Texas point AND for every point outside Colorado's envelope. Only a point
 * inside Colorado sees a different source. (`test/coloradoRegistry.test.js` asserts identity, not
 * equality — the very same object reference.) */
const CO_ENVELOPE = { latMin: 36.9, latMax: 41.1, lonMin: -109.2, lonMax: -101.9 };
export function countySourcesForPoint(lat, lng) {
  const inCo = Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= CO_ENVELOPE.latMin && lat <= CO_ENVELOPE.latMax && lng >= CO_ENVELOPE.lonMin && lng <= CO_ENVELOPE.lonMax;
  return [inCo ? JURISDICTION_SOURCES.countyCo : JURISDICTION_SOURCES.county];
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

/* ⛔ NEW-4 — THE QUERY URL HAS A HARD CEILING AND CROSSING IT IS A SILENT 404, NOT AN ERROR.
 *
 * `simplifyRing` bounds the VERTEX COUNT, which is the wrong quantity: 80 lon/lat pairs at full
 * double precision is ~2.5 KB of query string, and `services.arcgis.com` (IIS) answers a request
 * over roughly 2 KB of query with a plain HTML **404**. Measured on the owner's own parcels — Will
 * Clayton's county query at 2325 characters 404s while Bain's at 1512 succeeds, on the same service,
 * seconds apart. A 404 parses as "no such layer", so the county and the ETJ came back EMPTY on any
 * site with a finely digitised boundary, and empty is exactly what the app reads as "no ETJ here".
 * That is the flaky-ETJ symptom behind sixteen of his sites, and it is deterministic, not flaky: it
 * is a property of how many vertices the surveyor drew.
 *
 * Two bounds now, and the URL one is the one that matters:
 *   • coordinates are rounded to 6 decimal places — about 4 inches, far finer than any boundary
 *     layer's own precision, and it nearly halves the string.
 *   • the vertex count is then reduced until the built URL fits `MAX_QUERY_URL`, never below a
 *     triangle. Fewer vertices is a slightly coarser INTERSECT test; a 404 is no test at all.
 * (POST would remove the ceiling outright, but the B445 same-origin cache proxy is GET-addressed,
 * so a POST body would silently bypass the cache. Bounded GET keeps both.) */
export const MAX_QUERY_URL = 1900;
export const VERTEX_LADDER = [80, 56, 40, 28, 20, 14, 10, 6, 4];
export const round6 = (ring) => ring.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);

/* Build the params for a source, walking the vertex ladder down until the resulting URL fits the
 * ceiling. `buildUrl` is injected so this stays pure and unit-testable. Returns the params it
 * settled on plus the rung it reached, so a caller can report a coarsened test rather than hide it. */
export function fitIdentifyParams(source, geom, buildUrl, max = MAX_QUERY_URL) {
  let last = null;
  for (const verts of (geom.ring ? VERTEX_LADDER : [null])) {
    const params = buildIdentifyParams(source, verts == null ? geom : { ...geom, maxVerts: verts });
    const url = buildUrl(params);
    last = { params, url, verts, reduced: verts != null && verts < VERTEX_LADDER[0] };
    if (url.length <= max) return last;
  }
  return last; // the shortest rung we have; better a coarse test than a 404
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
  /* NEW-1 — a MULTIPOINT geometry: "which cities contain ANY of these points". One query answers
   * the whole-assemblage containment question that a single point cannot (see the parcel-coverage
   * block in `identifyJurisdiction`). Verified live against all three agency services 2026-08-08 —
   * TxGIO city limits, H-GAC ETJ and TxDOT counties all accept it. */
  if (geom.points && geom.points.length) {
    p.geometry = JSON.stringify({ points: geom.points.map(([x, y]) => [x, y]), spatialReference: { wkid: 4326 } });
    p.geometryType = "esriGeometryMultipoint";
    p.resultRecordCount = 16;
    return p;
  }
  if (geom.ring && geom.ring.length >= 3) {
    /* NEW-4 — the ring is fitted to the URL ceiling, not merely to a vertex count. `geom.maxVerts`
     * lets `identifySource` walk the ladder down until the built URL fits; absent, this is the
     * historic 80 (now with 6-dp coordinates, which is itself most of the saving). */
    p.geometry = JSON.stringify({ rings: [closeRing(round6(simplifyRing(geom.ring, geom.maxVerts || 80)))], spatialReference: { wkid: 4326 } });
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

/* The same /query, addressed through the same-origin B445 cache proxy (B1079). Returns
 * null when there's no page origin to anchor the same-origin path to (the Node test env),
 * so the caller simply queries the agency directly — the proxy is an optimisation, never
 * a dependency. Exported for the unit test that locks the round-trip. */
export function proxiedQueryUrl(serviceUrl, params, origin = null) {
  const o = origin || (typeof location !== "undefined" && location && location.origin) || null;
  if (!o) return null;
  return buildQueryUrl(proxyServiceUrl(serviceUrl, `${o}/api/gis-cache`), params);
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
  /* The cache signature must distinguish every geometry SHAPE this connector accepts. A multipoint
   * carries neither a ring nor a lng/lat, so without its own branch it keyed as "NaN,NaN" and every
   * multipoint query on earth collided on one entry — the first site's answer served to all of them. */
  const where = geom.points ? "mpt:" + ringKey(geom.points)
    : geom.ring ? "poly:" + ringKey(geom.ring)
    : Number(geom.lng).toFixed(4) + "," + Number(geom.lat).toFixed(4);
  const key = "juris:" + source.id + ":" + where;
  const fetcher = async () => {
    // NEW-4 — fit the request to the URL ceiling before anything is sent. A ring that overflows it
    // comes back as an HTML 404 that parses as "this layer has nothing here".
    const fitted = fitIdentifyParams(source, geom, (pp) => buildQueryUrl(source.url, pp));
    const params = fitted.params;
    // B1079 — per-source abort cap. The shared default is 9 s (GIS_FETCH_TIMEOUT_MS),
    // which is correct for a warm agency service and FATAL for a cold one: BKDD's first
    // call to a sleeping ArcGIS Server instance measured 16.5–18.3 s (every call after it,
    // under a tenth of a second). At 9 s the very first identify against any BKDD source
    // aborts on EVERY site, forever — the source would read as dead while being perfectly
    // healthy. A row that declares `timeoutMs` gets it; everything else is unchanged.
    const fetchOpts = source.timeoutMs ? { timeoutMs: source.timeoutMs } : undefined;
    // …and pay that cold start ONCE, SERVER-SIDE, not in every user's browser: a row
    // flagged `viaProxy` goes through the same-origin B445 Drive-backed cache proxy
    // (which bounds its own upstream at 25 s and keeps a durable copy). Proxy-FIRST for
    // exactly that reason, with a direct-to-agency retry so a dev environment without the
    // Function deployed — or a proxy hiccup — can never break the identify.
    const direct = buildQueryUrl(source.url, params);
    const proxied = source.viaProxy ? proxiedQueryUrl(source.url, params) : null;
    let j;
    if (proxied) {
      try { j = await fetchJson(proxied, fetchOpts); }
      catch (_) { j = await fetchJson(direct, fetchOpts); }
    } else {
      j = await fetchJson(direct, fetchOpts);
    }
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
/* NEW-1 — signed area + centroid of one lon/lat ring (shoelace). Pure. */
function ringAreaCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  a /= 2;
  if (!a) return null;
  return { area: Math.abs(a), c: [cx / (6 * a), cy / (6 * a)] };
}

/* ⛔ NEW-1 — THE POINTS THE CONTAINMENT QUESTION IS ASKED AT, and why there is more than one.
 *
 * A site is an ASSEMBLAGE. Twelve of the owner's twenty-eight Texas sites are drawn from more than
 * one parcel (Goose Creek 16, 8 South 19, Martini 14, Tsakiris 9, Schiel 9…), and the header badge
 * reduced all of them to `representativeRing` — the single LARGEST lot — and then asked which city
 * that one lot's centroid was in. On a one-parcel site that is right. On an assemblage it is a coin
 * flip weighted by lot size, and it is what makes the labels "hit or miss": at Tsakiris two of the
 * nine parcels sit inside Katy city limits, the biggest happens to be one of them, and the badge
 * printed a bare "City of Katy · Waller County" for a site that is mostly NOT in Katy.
 *
 * So containment is asked of EVERY active parcel, largest first, until the tested parcels account
 * for `COVER_TARGET` of the drawn site area (hard cap `MAX_TESTED`, because the query cost is real
 * and a 40-lot assemblage must not fire 40 lookups).
 *
 * ⚠ `sampled` and `truncated` are DIFFERENT and only the second is a hole. Stopping because the
 * tested parcels already cover 98% of the drawn area is a whole-site answer for a screening tool,
 * and treating it as incomplete would have printed "part in City of Pearland · part unincorporated"
 * across 8 South — nineteen lots, every one of them inside Pearland. Hitting the hard cap BEFORE
 * reaching that coverage is genuinely incomplete, and then no whole-site claim is allowed. */
const COVER_TARGET = 0.98;
const MAX_TESTED = 16;
export function parcelProbePoints(rings) {
  const parts = (rings || [])
    .filter((r) => r && r.length >= 3)
    .map(ringAreaCentroid)
    .filter(Boolean)
    .sort((a, b) => b.area - a.area);
  const total = parts.reduce((s, p) => s + p.area, 0);
  if (!total) return { points: [], total: 0, tested: 0, sampled: false, truncated: false, areaShare: 0 };
  const points = [];
  let acc = 0;
  for (const p of parts) {
    if (points.length >= MAX_TESTED) break;
    points.push(p.c);
    acc += p.area;
    if (acc / total >= COVER_TARGET) break;
  }
  const areaShare = acc / total;
  return {
    points, total: parts.length, tested: points.length,
    sampled: points.length < parts.length,
    truncated: points.length < parts.length && areaShare < COVER_TARGET,
    areaShare,
  };
}

export async function identifyJurisdiction(lng, lat, opts = {}) {
  const geom = opts.ring && opts.ring.length >= 3 ? { ring: opts.ring } : { lng, lat };
  const roles = opts.roles || ["county", "city", "etj", "isd"]; // B764: ISD joins the default identify
  // NEW-1 — every ACTIVE parcel ring, when the caller has them. Falls back to the single ring it was
  // always given, so a caller that has not been updated behaves exactly as before.
  const probe = parcelProbePoints(opts.rings && opts.rings.length ? opts.rings : (opts.ring ? [opts.ring] : []));
  const out = {
    point: { lng, lat }, city: [], county: [], etj: [], isd: [],
    // B793 — when a ring is queried, cityCentroid holds the CITY names at the centroid
    // point (null = not tested / outage). A ring-hit city absent here is a frontage
    // sliver the badge demotes to "· edge only".
    cityCentroid: null,
    unincorporated: false, straddle: false, ages: {}, sources: [],
    note: "Screening only — verify with the jurisdiction. Boundaries (especially ETJ) change.",
  };
  // Each role resolves to ONE source (county/city/isd) or a region-routed LIST (etj).
  const sourcesForRole = (role) =>
    role === "etj" ? etjSourcesForPoint(lat, lng)
    : role === "county" ? countySourcesForPoint(lat, lng)   // NEW-5 — Texas-identical outside Colorado
    : (JURISDICTION_SOURCES[role] ? [JURISDICTION_SOURCES[role]] : []);
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
    /* B793 — a ring query unions EVERY touching city, so a frontage sliver reads exactly
     * like real membership. Test the CENTROID point too (same SWR cache) so the badge can
     * demote edge-only hits. An outage leaves cityCentroid null — never claim "edge only"
     * off a failed lookup.
     *
     * ⛔ B209506 — `cityCentroid === null` USED TO MEAN TWO OPPOSITE THINGS, and that ambiguity is
     * what made the flag below disagree with the badge. It was left null both when the centroid
     * could not be tested AND on every POINT query — where the answer already IS a containment
     * test, because a point has no edge to sliver against. A caller could not tell "we don't know"
     * from "we know, and it's this". Every branch now sets it explicitly, so null means UNKNOWN and
     * nothing else. */
    if (role === "city") {
      if (state === "failed") {
        out.cityCentroid = null;                 // genuinely unknown — never claim edge-only or unincorporated off this
        out.cityAll = null; out.citySome = [];
      } else if (!geom.ring) {
        out.cityCentroid = names;                // POINT query: the answer already is the containment answer
        out.cityAll = names; out.citySome = [];
      } else if (!probe.points.length) {
        out.cityCentroid = names.length ? names : [];
        out.cityAll = out.cityCentroid; out.citySome = [];
      } else {
        /* NEW-1 — separate THREE facts the old single-centroid test collapsed into one:
         *   ALL   — a city containing every tested parcel: it governs the site, and leads.
         *   SOME  — a city containing some parcels but not all: the site is SPLIT. Real membership,
         *           so it is never demoted to a footnote, but it may never lead unqualified either.
         *   TOUCH — a city the boundary merely brushes: the frontage sliver, a footnote (B793).
         * Two queries buy all three: one MULTIPOINT ("which cities hold any parcel") and, only when
         * that comes back non-empty, one point per tested parcel to attribute them. The empty case
         * is 20 of the owner's 28 sites, and it costs exactly what the old single centroid did.
         *
         * ⛔ THIS RUNS EVEN WHEN THE RING QUERY FOUND NOTHING, and that is not defensive coding —
         * it is the Goose Creek case. `opts.ring` is ONE parcel (the biggest), so a ring answer of
         * "no city" only ever meant "the biggest lot is in no city": at Goose Creek that lot is
         * outside Baytown while SIX of the sixteen drawn parcels are inside it. Gating the probe on
         * the ring result would have kept the app blind to exactly the site the owner flagged. */
        try {
          const anyRes = probe.points.length === 1
            // One parcel: the multipoint IS the point query, so ask it the cheap way and share the
            // cache entry the per-parcel pass below is about to want.
            ? await identifySource(srcs[0], { lng: probe.points[0][0], lat: probe.points[0][1] }, opts).fresh
            : await identifySource(srcs[0], { points: probe.points }, opts).fresh;
          if (anyRes.error) { out.cityCentroid = null; out.cityAll = null; out.citySome = []; }
          else {
            const anyNames = uniq(anyRes.items.map((it) => normalizeFeature(srcs[0], it.attrs).name).filter((v) => v != null && v !== "").map(String));
            if (!anyNames.length) { out.cityCentroid = []; out.cityAll = []; out.citySome = []; }
            else {
              const per = await Promise.all(probe.points.map(async ([px, py]) => {
                const r = await identifySource(srcs[0], { lng: px, lat: py }, opts).fresh;
                if (r.error) return null;
                return uniq(r.items.map((it) => normalizeFeature(srcs[0], it.attrs).name).filter((v) => v != null && v !== "").map(String));
              }));
              if (per.some((p) => p === null)) {
                // A parcel we could not test cannot be counted as inside OR outside. Fall back to
                // the multipoint fact, which is honest but weaker: these cities hold PART of the site.
                out.cityAll = []; out.citySome = anyNames; out.cityCentroid = anyNames;
              } else {
                // NEW-1a — keep the PER-PARCEL answer, not just the roll-up. "Part in Baytown" is
                // not actionable; "6 of the 14 lots" is, and it is the same data.
                out.cityPerParcel = per;
                const all = anyNames.filter((n) => per.every((p) => p.some((k) => samePlace(k, n))));
                const some = anyNames.filter((n) => !all.some((k) => samePlace(k, n)));
                // A TRUNCATED probe (the hard cap hit before the coverage target) never claims a
                // whole-site answer it did not test. A merely SAMPLED one has covered 98% of the
                // drawn area and is allowed to.
                out.cityAll = probe.truncated ? [] : all;
                out.citySome = probe.truncated ? uniq([...all, ...some]) : some;
                out.cityCentroid = uniq([...(out.cityAll || []), ...out.citySome]);
              }
            }
          }
        } catch (_) { out.cityCentroid = null; out.cityAll = null; out.citySome = []; }
      }
      /* The city LIST is the union of everything we found: the boundary touch AND every city that
       * holds a parcel. At Goose Creek the ring answer was empty and Baytown was found only by the
       * parcel probe — left out of this union, Baytown would have been discovered and then silently
       * dropped, which is a worse failure than never looking. */
      out.city = uniq([...out.city, ...(out.cityAll || []), ...out.citySome]);
    }
  }));
  /* ⛔ B209506 — ONE DEFINITION OF "WHAT CITY IS THIS IN", AND IT IS CONTAINMENT.
   *
   * `unincorporated` was `out.city.length === 0` — the RING union, i.e. every city that so much as
   * touches the parcel edge. The very same function computes a CENTROID answer a few lines above to
   * demote edge-only slivers, so the app carried two contradictory notions of membership and this is
   * the site where they disagreed: at Bain the ring touches Katy, the centroid is in no city at all,
   * and `unincorporated` therefore read FALSE on genuinely unincorporated land.
   *
   * Containment wins. The ring result is kept, but only as the "also touches" set. */
  /* NEW-1 — FOUR containment states, not two. `in` means a city holds the WHOLE site; `partial`
   * means it holds part of it and the rest is unincorporated (or another city's); `none` is the
   * unincorporated majority this app was structurally bad at saying; `unknown` is a lookup we could
   * not make, which is never any of the other three. */
  out.cityAll = out.cityAll === undefined ? (out.cityCentroid === null ? null : out.cityCentroid) : out.cityAll;
  out.citySome = out.citySome || [];
  out.cityContainment = out.cityAll === null ? "unknown"
    : out.cityAll.length ? "in"
    : out.citySome.length ? "partial"
    : "none";
  out.cityCoverage = {
    tested: probe.tested, total: probe.total,
    sampled: probe.sampled, truncated: probe.truncated, areaShare: probe.areaShare,
    // NEW-1a — HOW MANY of the tested parcels each city holds. A straddle is not a yes/no; the
    // reader needs to know whether it is one lot of fourteen or thirteen.
    inCity: out.cityPerParcel ? out.cityPerParcel.filter((p) => p && p.length).length : null,
    outsideCity: out.cityPerParcel ? out.cityPerParcel.filter((p) => p && !p.length).length : null,
  };
  /* ⛔ NEW-1a — CITIES WHOSE ETJ THIS APP CANNOT SEE. A city that holds or touches the site and is
   * carried by NO routed ETJ source is reported as "ETJ not mapped", never folded into the silence
   * that means "no ETJ here". Those are opposite facts and they imply different floodplain rules. */
  out.etjUnmappedCities = uniq(out.city.filter((c) => etjCoverageFor(c, lat, lng) === "not-mapped"
    && !out.etj.some((e) => samePlace(e, c))));
  // Back-compat boolean. It can only ever be TRUE on a positive containment answer — an unknown
  // reads false here, and callers that need to tell the two apart read `cityContainment`.
  out.unincorporated = out.cityContainment === "none";
  // Cities the ring touches that hold NO part of the site — the footnote set, never the headline.
  const held = [...(out.cityAll || []), ...out.citySome];
  out.edgeOnlyCities = out.cityAll === null ? [] : out.city.filter((c) => !held.some((k) => samePlace(k, c)));
  /* `out.straddle` stays the RING fact — "this boundary touches more than one jurisdiction" — which
   * is a different and equally legitimate question from the badge's "more than one jurisdiction
   * GOVERNS here". Do not merge them: the badge already demotes a frontage sliver to a qualifier
   * (B793), and consumers of this field want the geometric answer. NEW-1 only adds the split case,
   * where the site genuinely lies in a city AND outside it. */
  out.straddle = out.city.length > 1 || out.county.length > 1 || out.isd.length > 1
    || out.cityContainment === "partial";
  return out;
}

/* ═══ B209506 — ONE CANONICAL FORM FOR A PLACE NAME ═══════════════════════════════════════════
 *
 * The sources disagree about case and prefix, and every module downstream invented its own compare:
 *   • H-GAC's ETJ layer publishes `CITY = "HOUSTON"` (all caps)
 *   • TxGIO's city-limits layer publishes title case ("Houston")
 *   • `formatJurisdictionBadge` deduped with `etjs.filter((e) => !cities.includes(e))` — a
 *     case-SENSITIVE compare, so a site inside Houston's limits AND its ETJ rendered
 *     "City of Houston / City of Houston · ETJ"
 *   • `floodAdministrator.js` separately lowercases via its own `cityKey`
 *
 * Three private notions of "same place" is two too many. `placeKey` is the one comparison form
 * (lowercased, "City of " stripped, punctuation and inner whitespace collapsed) and `samePlace` is
 * the one predicate. DISPLAY strings are deliberately left alone — the H-GAC row already
 * title-cases via `titleCaseName`, and rewriting a source's display name is a different decision
 * from making two names compare equal. Pure. */
export const placeKey = (name) =>
  String(name == null ? "" : name)
    .trim().toLowerCase()
    .replace(/^(the\s+)?(city|town|village)\s+of\s+/, "")
    .replace(/[.,']/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const samePlace = (a, b) => placeKey(a) === placeKey(b) && placeKey(a) !== "";

/* B763 — compact jurisdiction badge for the ACTIVE parcel/site. Turns an
 * `identifyJurisdiction` result into ONE screening line a developer reads without toggling any
 * boundary layer.
 *
 * ⛔ NEW-1 (B367296) — THE STRINGS THEMSELVES LIVE IN `jurisdictionLabel.js`, WHICH IS THE ONE
 * CANONICAL FORMATTER. Read that module's header before touching any wording here: it owns the
 * four shapes, the three-level separator grammar (`·` governing slots · `+` co-equal peers ·
 * `—` the non-governing tail), and the rule that once an ETJ is named "Unincorporated" is implied
 * and is not printed. THIS function's job is the DERIVATION — turning the identify result into the
 * structured model that formatter consumes. Keeping those apart is what stopped the old code from
 * joining "Houston governs platting here" and "Katy is next door" with the same slash.
 *
 * Everything about the MODEL is unchanged: an ETJ site is still `cityContainment: "none"` and
 * still `unincorporated: true`, because in Texas an ETJ IS unincorporated land. Only the label
 * stopped saying both. Once B764 lands, an ISD name appends via `opts.isd`.
 * Pure → unit-tested; null when there's nothing to show. */
export function formatJurisdictionBadge(j, opts = {}) {
  if (!j) return null;
  const cities = uniq((j.city || []).filter((v) => v != null && v !== "").map(String));
  // B209506 — dedupe an ETJ against the city limits by PLACE, not by string. "HOUSTON" from H-GAC and
  // "Houston" from TxGIO are the same city, and a case-sensitive compare rendered both.
  const etjsRaw = uniq((j.etj || []).filter((v) => v != null && v !== "").map(String));
  const counties = uniq((j.county || []).filter((v) => v != null && v !== "").map(String));
  // B793 — with a POSITIVE centroid answer, a ring-hit city the centroid is not inside is
  // a frontage sliver: it demotes to the tail with an "edge only" qualifier so the badge
  // leads with the dominant jurisdiction. No centroid data (outage) → no demotion claims.
  const centroid = Array.isArray(j.cityCentroid) ? j.cityCentroid : null;
  /* ⛔ NEW-1 — WHETHER THIS RESULT CAN SPEAK TO CONTAINMENT AT ALL, asked before anything is read
   * from it. A result that CARRIES containment metadata and reports `null` is saying "we could not
   * find out"; a bare legacy object (`{city:[…]}` from an older caller or a hand-written fixture)
   * is saying nothing at all, and the pre-B793 reading of its city list still applies. Collapsing
   * those two is how the Goose Creek pill came to read a flat "City of Baytown · Harris County" on
   * land that is in no city: the centroid lookup had failed, and a failed lookup was being rendered
   * as a positive containment answer. */
  const hasContainmentMeta = ("cityCentroid" in j) || ("cityAll" in j) || Array.isArray(j.sources);
  const allCities = Array.isArray(j.cityAll) ? j.cityAll : (centroid === null ? null : centroid);
  const someCities = Array.isArray(j.citySome) ? j.citySome : [];
  const containmentUnknown = hasContainmentMeta && allCities === null;
  // Cities holding the WHOLE site lead. Cities holding PART of it are named but never lead alone.
  // With containment unknown NOTHING leads from the ring union — that is the defect above.
  const coreCities = containmentUnknown ? []
    : allCities === null ? cities
    : cities.filter((c) => allCities.some((k) => samePlace(k, c)));
  const partCities = containmentUnknown ? []
    : cities.filter((c) => someCities.some((k) => samePlace(k, c)) && !coreCities.some((k) => samePlace(k, c)));
  const edgeCities = containmentUnknown ? []
    : allCities === null ? []
    : cities.filter((c) => !coreCities.some((k) => samePlace(k, c)) && !partCities.some((k) => samePlace(k, c)));
  // Ring cities we cannot classify because containment is unknown: named as a TOUCH, never as the
  // site's jurisdiction (the owner's rule), and never silently dropped either.
  const touchCities = containmentUnknown ? cities : [];

  /* ⛔ NEW-2 — AN ETJ IS DEDUPED AGAINST THE CITY LIMITS THE SITE IS ACTUALLY IN, NEVER AGAINST THE
   * RING UNION. This dropped the governing fact on four of the owner's sites.
   *
   * The rule the dedupe exists for is real: a site inside Houston's limits should read "City of
   * Houston", not "City of Houston / City of Houston · ETJ". But it was filtering against `cities`
   * — every city the boundary so much as TOUCHES. At Kennedy Greens, JFK, Katz and Pinnacle a
   * Houston sliver clips the parcel edge while the site itself is unincorporated land inside the
   * Houston ETJ, so the sliver suppressed its own ETJ and the pill read "City of Houston · edge
   * only": a jurisdiction the tooltip calls "unlikely to govern" shown INSTEAD of the Ch. 19
   * authority that sets the finished-floor elevation. Suppress an ETJ only where the city limits
   * genuinely hold the site. */
  const inCityLimits = [...coreCities, ...partCities];
  const etjsAll = etjsRaw.filter((e) => !inCityLimits.some((c) => samePlace(c, e)));

  /* NEW-1a — the two pieces the split lead needs. `splitCount` is the share of the drawn site the
   * city actually holds, taken from the SAME per-parcel probe the split was derived from (so the
   * words and the number can never disagree); it is omitted when the probe did not record one.
   * `remainderLabel` names what the REST of the site is, and it is the fact that the first cut of
   * this got wrong by assuming. */
  const cov = j.cityCoverage || null;
  const splitCount = cov && Number.isFinite(cov.inCity) && Number.isFinite(cov.tested) && cov.tested > 0
    ? ` (${cov.inCity} of ${cov.tested} lot${cov.tested === 1 ? "" : "s"})`
    : "";

  /* ⛔ B209506/B209507 — THE LEAD IS WHAT GOVERNS, AND SILENCE IS NEVER AN ANSWER.
   *
   * Two defects, one line of code. `parts` was built as coreCities → etjs → edgeCities and the badge
   * only fell back to "Unincorporated" when parts came out EMPTY. An edge-only sliver is a part, so
   * a genuinely unincorporated site was never called unincorporated as long as any city polygon
   * touched the parcel edge anywhere — the demoted sliver SUPPRESSED the true answer. At Bain that
   * printed "City of Katy · edge only · Fort Bend County": leading with a jurisdiction the badge's
   * own tooltip calls "unlikely to govern the site as a whole", while omitting the City of Houston
   * ETJ that actually reaches the site.
   *
   * And a role that FAILED to load rendered exactly like a role that returned nothing, because the
   * per-role state `identifyJurisdiction` already records in `j.sources` was never read here. For a
   * jurisdiction those are opposite facts — "no ETJ here" and "we could not check" imply DIFFERENT
   * floodplain rules — so collapsing them is how a wrong number reaches the reader as a settled one.
   * The ETJ source is measurably flaky (0 at three of six points in the owner's Houston sweep), so
   * this path is common, not rare.
   *
   * Order is now: GOVERNING (city limits, or Unincorporated) → ETJ → edge-only footnote, with any
   * role that could not be checked SAYING SO in its own slot. */
  const srcState = (role) => {
    const s = (j.sources || []).find((x) => x && x.id === role);
    return s ? s.state : null;
  };
  const cityState = srcState("city");
  const etjState = srcState("etj");
  const countyState = srcState("county");
  /* NEW-2 — a role is UNRESOLVED whenever we could not establish the fact the panel depends on, not
   * only when the source reported an error. The city role has TWO lookups behind it — the boundary
   * touch and the containment probe — and the second failing on its own leaves the badge unable to
   * say whether the site is in a city at all. That has to reach `assessAdministrator`, or the
   * floodplain rule settles on the county's laxer standard with nothing anywhere saying it guessed. */
  const unresolvedRoles = ["city", "etj", "county"].filter((r) => srcState(r) === "failed");
  if (containmentUnknown && !unresolvedRoles.includes("city")) unresolvedRoles.push("city");

  /* The governing slot. Containment decides it; a failed lookup admits it rather than guessing.
   *
   * ⚠ "couldn't check" is keyed on the source state REPORTING failure — never merely on a missing
   * centroid. A caller that hands us no `cityCentroid` and no `sources` (a bare point result, an
   * older caller, a fixture) is not telling us the lookup failed; it is telling us nothing, and the
   * pre-B793 reading of its city list still applies. Treating absent metadata as failure would have
   * printed "City limits · couldn't check" on every one of those, which is its own false alarm — the
   * same collapse in the opposite direction. */
  /* NEW-1a — WHAT THE REST OF A SPLIT SITE IS. Never assume "unincorporated": at Goose Creek the
   * other 8 of 14 lots are inside Baytown's own ETJ, and calling that unincorporated would drop the
   * city's floodplain standard from the comparison entirely. Order of truth: a named ETJ that
   * reaches the site · an ETJ we could not check · an ETJ nobody publishes for that city ·
   * genuinely unincorporated. */
  /* ⛔ AND THE DEDUPE THAT IS RIGHT FOR A WHOLE SITE IS WRONG FOR A SPLIT ONE. `etjsAll` drops an
   * ETJ whose city already holds the site — correct when the city holds ALL of it (you do not say
   * "City of Houston / City of Houston · ETJ"). On a SPLIT site the same city's ETJ is exactly what
   * governs the part its limits do NOT cover, so dropping it re-created the very silence this item
   * is about: Goose Creek read "part unincorporated" while all 8 of those lots sit in Baytown's own
   * ETJ. The remainder therefore reads the RAW ETJ names. */
  /* ⛔ NEW-1 — the remainder's own wording carries NO governing separator. It is one slot in the
   * governing chain, so an inner " · " would read as a second slot; a parenthetical does not. */
  const ownEtj = etjsRaw.find((e) => partCities.some((c) => samePlace(c, e)));
  const remainderLabel = ownEtj
    ? "rest in its ETJ"
    : etjsAll.length
    ? `rest in ${etjsAll[0]} ETJ`
    : etjState === "failed"
      ? "rest (couldn't check ETJ)"
      : (j.etjUnmappedCities || []).length
        ? `rest outside it (no ETJ published for City of ${j.etjUnmappedCities[0]})`
        : "rest unincorporated";

  /* ⛔ NEW-1a — the SPLIT site, and BOTH halves have to be named correctly.
   *
   * Goose Creek is the case that corrected this: 6 of its 14 tested lots are inside Baytown's
   * city limits and the other 8 are inside Baytown's ETJ — NOT ONE is plain unincorporated. The
   * first cut of this line said "part unincorporated" unconditionally, which was a guess about
   * the remainder dressed as a finding. The remainder is now described by what was actually
   * found out there: an ETJ if one reaches it, "unincorporated" only when nothing does, and an
   * honest "not checked" when the ETJ lookup could not answer.
   *
   * The COUNT rides the lead because "part in" is not actionable on its own — one lot of
   * fourteen and thirteen of fourteen are different sites, and the reader cannot tell them apart
   * from the word "part". (The lead itself is assembled by the formatter from the model below.) */

  // The ETJ slot. `unavailable` means there is genuinely no ETJ layer for this area — an honest
  // "not applicable", distinct from a failure, so it stays quiet.
  const etjs = etjsAll;
  // …and once a city is named as the ETJ, its edge sliver is not a second fact worth a slot.
  const edgeParts = edgeCities.filter((c) => !etjs.some((e) => samePlace(e, c)));
  const isds = uniq((j.isd || []).filter((v) => v != null && v !== "").map(String));

  /* ⛔ NEW-1 — THE STRUCTURED MODEL, AND THE HANDOFF. Everything above is DERIVATION (what the
   * agencies said and what it means); everything below the handoff is PRESENTATION, and it lives
   * in `jurisdictionLabel.js` so there is exactly one place that decides how a governing authority
   * and a next-door city are told apart. Nothing reads back out of the strings — the structured
   * fields are returned alongside them for that (NEW-2). */
  const label = formatJurisdictionLabel({
    governingCities: coreCities,
    partialCities: partCities,
    splitNote: splitCount,
    remainderLabel,
    etjCities: etjs,
    counties,
    isds,
    isdOverride: opts.isd || null,
    adjacentCities: edgeParts,
    unclassifiedCities: touchCities,
    cityUnresolved: containmentUnknown || cityState === "failed",
    etjUnresolved: etjState === "failed",
    countyUnresolved: countyState === "failed",
  });
  const { text, jur, county, isd, tail, shape } = label;
  // B793 — a mere edge-only sliver is qualified in-line, not flagged: the ⚑ straddle mark
  // stays for real multi-jurisdiction membership (2+ core cities, counties, or ISDs — or
  // 2+ cities with no centroid answer to arbitrate).
  const straddle = counties.length > 1 || isds.length > 1 || coreCities.length > 1
    // NEW-1 — a genuinely SPLIT site is the straddle this mark was made for.
    || partCities.length > 0
    || (allCities === null && !containmentUnknown && cities.length > 1);
  return {
    text, jur, county, isd, straddle,
    // NEW-1 — the non-governing tail as its own field, and WHICH of the six shapes this is. A
    // consumer that wants one of them never has to take the label apart to get it.
    tail, shape,
    /* ⛔ NEW-2 — THE CITY THAT GOVERNS, AS DATA. `SitePlanner.jsx` used to recover this by parsing
     * `jur`, and that parse fed the floodplain administrator's `cityLabel` — the signal deciding
     * whether a city's ordinance is even a candidate for the finished-floor elevation. See
     * `jurisdictionLabel.governingCityOf`. */
    governingCities: coreCities,
    edgeOnlyCities: edgeCities,
    // NEW-1 — cities holding PART of the site, and ring cities left unclassified by a failed lookup.
    partialCities: partCities,
    touchesCities: touchCities,
    // NEW-1a — the split, in numbers, and the cities whose ETJ nobody publishes.
    cityCoverage: cov,
    etjUnmappedCities: j.etjUnmappedCities || [],
    // B209507 — what the badge could NOT establish, carried explicitly so a consumer (the floodplain
    // administrator especially) can refuse to settle rather than reading silence as absence.
    unresolvedRoles,
    unresolved: unresolvedRoles.length > 0,
    cityContainment: j.cityContainment
      || (containmentUnknown ? "unknown" : coreCities.length ? "in" : partCities.length ? "partial" : centroid === null ? "unknown" : "none"),
    etjLabels: etjs,
  };
}

// Configured CAD county keys (those with a wired parcel service) — maps a TxDOT
// county name back onto the app's routing keys for the B36(a) label correction.
const COUNTY_NAME_TO_KEY = { harris: "harris", "fort bend": "fortbend", chambers: "chambers" };

/* NEW-5 — the Colorado name→key map. SEPARATE from the Texas one on purpose: both states have a
 * Jefferson County and an El Paso County, so one merged map would silently mis-key them. The
 * routed source tells us which state answered, so the right map is never in doubt. */
const CO_COUNTY_NAME_TO_KEY = {
  adams: "co_adams", denver: "co_denver", arapahoe: "co_arapahoe", larimer: "co_larimer",
  weld: "co_weld", jefferson: "co_jefferson", "el paso": "co_elpaso", boulder: "co_boulder",
  broomfield: "co_broomfield",
};

/* The true county at a point, via the verified TxDOT county-boundary layer (cached).
 * Returns { name, key } — `key` is the app's configured CAD key when recognized,
 * else null (county known but not a wired CAD). This is the point-in-county
 * primitive B13-pt1 / B36(a) were waiting on: a parcel that the statewide TxGIO
 * fallback labelled "Chambers" can be checked and relabelled to its real county.
 * (Deliberately NOT used to REPLACE the bbox routing pre-filter — the existing
 * parallel "query candidates, answerer wins" identify is faster + more resilient
 * than a blocking county lookup; this only corrects a label after the fact.) */
export async function countyAtPoint(lng, lat, opts = {}) {
  // NEW-5 — the same region routing the identify uses, so a Colorado point is answered by
  // Colorado's boundary layer. Outside Colorado this is the exact TxDOT source it always was.
  const src = countySourcesForPoint(lat, lng)[0];
  const isCo = src === JURISDICTION_SOURCES.countyCo;
  const r = await identifySource(src, { lng, lat }, opts).fresh;
  const feat = r.items.map((it) => normalizeFeature(src, it.attrs)).find((f) => f.name) || null;
  if (!feat) {
    /* B209502 — THE OFFLINE FLOOR. The live boundary layer is still the authority, but when it
     * cannot answer this used to return a bare null, and null is where the caller falls back to
     * a default — which in this app has always meant Harris. A county whose GIS is unreachable
     * getting Harris County's drainage authority and detention criteria is the same wrong-but-
     * plausible answer as Pearland's, arrived at from the other direction.
     *
     * The bundled polygons answer with no network at all, so an outage now degrades to the right
     * county rather than to a default one. It is reported as its own `source: "offline-geometry"`
     * (never silently passed off as a live identify) and carries `nearEdge` so a caller near a
     * county line knows the answer is the simplified geometry's, not the state's. */
    const off = resolveCounty(lat, lng);
    if (off && off.status === "ok") {
      const offMap = off.state === "CO" ? CO_COUNTY_NAME_TO_KEY : COUNTY_NAME_TO_KEY;
      return {
        name: off.name, key: offMap[off.name.toLowerCase()] || null,
        fips: off.fips || null, state: off.state,
        source: "offline-geometry", nearEdge: !!off.nearEdge,
        ageMs: r.ageMs, error: r.error ? humanize(r.error) : null,
      };
    }
    return { name: null, key: null, fips: null, state: isCo ? "CO" : "TX", ageMs: r.ageMs, error: r.error ? humanize(r.error) : null };
  }
  // B792 — fips rides along (48157 = Fort Bend, …) so persistence-side callers can
  // cross-check parcel attributes against the boundary answer. (Colorado's GEOID20 is the
  // same 5-digit state+county FIPS, so the field means the same thing on both sources.)
  const nameMap = isCo ? CO_COUNTY_NAME_TO_KEY : COUNTY_NAME_TO_KEY;
  return {
    name: String(feat.name),
    key: nameMap[String(feat.name).toLowerCase()] || null,
    fips: feat.fips ? String(feat.fips) : null,
    state: isCo ? "CO" : "TX",
    ageMs: r.ageMs, ts: r.ts,
  };
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
