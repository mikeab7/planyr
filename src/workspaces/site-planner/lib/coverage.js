/* Layer coverage engine (NEW-1 / B283) — does each layer's DATA reach the view?
 *
 * Motivation: the City-of-Houston utility layers (water / wastewater / storm) and
 * HCFCD load "green" (HTTP 200) but paint a blank transparent image anywhere outside
 * their region, which reads to the user as "broken." It isn't — there simply is no
 * COH sewer in Dallas. This engine gives the Layers panel an honest, per-layer signal
 * of whether a layer's data actually covers the current map view, so the picker can
 * say "no data in this area" instead of leaving a silent blank.
 *
 * How it works:
 *  - Every layer is tagged national | statewide | regional (LAYER_SCOPE). National and
 *    statewide layers are ALWAYS in-coverage — their empty/painted state comes from the
 *    normal in-view query (a national layer just has nothing at this spot).
 *  - A regional layer carries a bounded data extent. We read that extent from the
 *    service's own `fullExtent` (already present in the ?f=json HEALTH probe — no extra
 *    request), reproject it to lat/lon (services publish it in EPSG:2278 State-Plane feet
 *    or Web Mercator), buffer it by the user's "nearby radius", and intersect it with the
 *    viewport.
 *
 * HARD RULE (NEW-1): coverage is a PICKER-ONLY signal. It must NEVER change a layer's
 * request bbox / where / extent. A turned-on layer always renders everything its source
 * returns for the view. Nothing in this module builds or mutates a map request — it only
 * classifies — and the request builder in layers.js (layerRequestSpec) takes no coverage
 * input, which test/coverage.test.js locks down.
 *
 * Fail open, always: an unknown scope, a missing/garbled extent, or an errored probe →
 * treated as available (never hidden, never dimmed). We would rather show a layer that
 * has no data here than hide one that does.
 */
import { gridToProject } from "../../../shared/coordinates/index.js";

// ---------------------------------------------------------------------------
// Per-layer geographic SCOPE.
//   national  — dataset spans the country (FEMA, NWI, HIFLD, USGS 3DEP, OSM, Mapillary)
//   statewide — spans Texas (TxRRC, county/city/MUD boundaries)
//   regional  — a bounded local extent that paints blank outside it (the blank-outside
//               -the-city layers this whole feature exists for)
// An id missing here defaults to "national" → always in-coverage (fail open).
// ---------------------------------------------------------------------------
export const LAYER_SCOPE = {
  // national
  fema: "national", wetlands: "national", hifld_tx: "national", elevation: "national",
  osm_power: "national", osm_hydrants: "national", mapillary: "national",
  // statewide
  txrrc_pipe: "statewide", txrrc_wells: "statewide",
  jur_county: "statewide", jur_city: "statewide", jur_mud: "statewide",
  // regional (bounded extent → can be "no data in this area")
  jur_etj: "regional",          // H-GAC ETJ — 13-county Houston-Galveston region only
  coh_hydrants: "regional",     // City of Houston
  hcfcd_row: "regional",        // Harris County Flood Control District
  coh_ww: "regional", coh_storm: "regional", coh_water: "regional", // City of Houston utilities
  fb_contours: "regional",      // Fort Bend Drainage District
};
export const layerScope = (id) => LAYER_SCOPE[id] || "national";
export const isRegional = (id) => layerScope(id) === "regional";

// ---------------------------------------------------------------------------
// Spatial-reference → lat/lon. ArcGIS extents come in whatever SR the service works
// in: WGS84 (4326), Web Mercator (3857 / 102100), or — for the City of Houston / HCFCD
// regional services — NAD83 Texas State Plane South Central in US feet (2278 / 102740).
// Anything else → null, and the caller fails open.
// ---------------------------------------------------------------------------
const WEBMERC = new Set([3857, 102100, 102113, 900913]);
// B515: 102739 is ESRI Texas CENTRAL (FIPS 4203, EPSG:2277) — a DIFFERENT projection from
// 2278/102740 (South Central). Aliasing it here ran a Central-zone extent through the 2278 math
// and produced a garbage bbox, marking the layer out-of-coverage across all of Texas (failing
// CLOSED, against this module's fail-open guarantee). Dropped — an unknown SR now returns null.
const STATEPLANE_2278 = new Set([2278, 102740]);
const WGS84 = new Set([4326]);
const MERC_R = 6378137;

const srWkid = (sr) => (sr && (sr.latestWkid || sr.wkid)) || null;

export function srPointToLatLon(x, y, wkid) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (WGS84.has(wkid)) return { lat: y, lon: x };
  if (WEBMERC.has(wkid)) {
    return {
      lon: (x / MERC_R) * (180 / Math.PI),
      lat: (2 * Math.atan(Math.exp(y / MERC_R)) - Math.PI / 2) * (180 / Math.PI),
    };
  }
  if (STATEPLANE_2278.has(wkid)) {
    const p = gridToProject({ x, y });
    return { lat: p.lat, lon: p.lon };
  }
  return null; // unknown SR → caller treats the layer as available (fail open)
}

/* An ArcGIS extent ({xmin,ymin,xmax,ymax,spatialReference}) → a lat/lon bbox
 * {s,w,n,e}, or null if the SR is unrecognized or the numbers are junk. All four
 * corners are reprojected (a conic projection rotates slightly across a county) and
 * the min/max taken, so the bbox safely encloses the real footprint. Pure. */
export function esriExtentToBounds(ext) {
  if (!ext) return null;
  const wkid = srWkid(ext.spatialReference);
  const { xmin, ymin, xmax, ymax } = ext;
  if (![xmin, ymin, xmax, ymax].every(Number.isFinite)) return null;
  const corners = [
    srPointToLatLon(xmin, ymin, wkid), srPointToLatLon(xmax, ymin, wkid),
    srPointToLatLon(xmax, ymax, wkid), srPointToLatLon(xmin, ymax, wkid),
  ];
  if (corners.some((c) => !c)) return null;
  const lats = corners.map((c) => c.lat), lons = corners.map((c) => c.lon);
  const b = { s: Math.min(...lats), n: Math.max(...lats), w: Math.min(...lons), e: Math.max(...lons) };
  return [b.s, b.n, b.w, b.e].every(Number.isFinite) ? b : null;
}

// ---------------------------------------------------------------------------
// bbox geometry (lat/lon, {s,w,n,e}). Pure.
// ---------------------------------------------------------------------------
const MI_PER_DEG_LAT = 69.0; // statute miles per degree of latitude (good enough for screening)

/* Grow a bbox outward by `miles` on every side — the "nearby radius" so data just
 * off-screen or just past a boundary still counts as relevant (NEW-2). Pure. */
export function bufferBounds(b, miles) {
  if (!b) return b;
  const m = Math.max(0, +miles || 0);
  const dLat = m / MI_PER_DEG_LAT;
  const midLat = (b.s + b.n) / 2;
  const dLon = m / (MI_PER_DEG_LAT * Math.max(0.15, Math.cos((midLat * Math.PI) / 180)));
  return { s: b.s - dLat, n: b.n + dLat, w: b.w - dLon, e: b.e + dLon };
}

/* Do two lat/lon bboxes overlap (touching counts)? Pure. */
export function boundsIntersect(a, b) {
  return !!(a && b && a.w <= b.e && a.e >= b.w && a.s <= b.n && a.n >= b.s);
}

// ---------------------------------------------------------------------------
// The coverage classification (the heart of NEW-1). Pure + unit-tested.
// ---------------------------------------------------------------------------

/* Is a layer's data region present in (or near) the view?
 *   national | statewide       → "in"      (always — empty-here is decided by the query)
 *   regional, no extent known  → "unknown" (fail open — treated as available)
 *   regional, no viewport      → "unknown"
 *   regional, extent known     → "in" / "out" by buffered-extent ∩ viewport
 * Returns "in" | "out" | "unknown". */
export function regionCoverage({ scope, extentBounds, viewport, bufferMiles = 2.5 }) {
  if (scope === "national" || scope === "statewide") return "in";
  if (!extentBounds || !viewport) return "unknown";
  return boundsIntersect(bufferBounds(extentBounds, bufferMiles), viewport) ? "in" : "out";
}

// The three honest per-layer states NEW-1 asks for.
export const COVERAGE_STATE = {
  IN_VIEW: "data-in-view",                       // in coverage AND the query painted features
  REGION_EMPTY: "covers-region-but-empty-here",  // in coverage but nothing at this spot
  OUT: "out-of-coverage",                        // the view is outside the layer's data extent
};

/* Combine the region test with what the in-view query actually returned.
 *   region "out"                          → out-of-coverage
 *   region "in"/"unknown", painted false  → covers-region-but-empty-here
 *   otherwise                             → data-in-view
 * `painted` is true (features drawn) | false (query returned empty) | null (layer off /
 * not yet known). Pure. */
export function displayCoverage(region, painted) {
  if (region === "out") return COVERAGE_STATE.OUT;
  if (painted === false) return COVERAGE_STATE.REGION_EMPTY;
  return COVERAGE_STATE.IN_VIEW;
}

// ---------------------------------------------------------------------------
// Extent cache. Regional extents are STATIC GIS metadata, so once read from a probe
// they're cached in memory (and mirrored to localStorage so a reload needs no reprobe).
// The probe itself is injected (layers.js probeService) to keep this module
// dependency-light and unit-testable without network.
// ---------------------------------------------------------------------------
const EXTENT_KEY = "planarfit:layerExtent:v1";
const _extent = new Map();   // id -> {s,w,n,e} | null | "pending"
let _hydrated = false;

function hydrate() {
  if (_hydrated) return;
  _hydrated = true;
  try {
    const raw = JSON.parse(localStorage.getItem(EXTENT_KEY) || "{}");
    for (const [id, b] of Object.entries(raw || {})) if (b && Number.isFinite(b.s)) _extent.set(id, b);
  } catch (_) { /* no localStorage (tests/SSR) — in-memory only */ }
}
function persist() {
  try {
    const obj = {};
    for (const [id, b] of _extent) if (b && b !== "pending") obj[id] = b;
    localStorage.setItem(EXTENT_KEY, JSON.stringify(obj));
  } catch (_) { /* ignore */ }
}

/* The cached lat/lon bounds for a regional layer, or null/undefined if not yet known. */
export function getCachedExtent(id) { hydrate(); return _extent.get(id); }

/* Seed an extent directly (used by tests, and when a probe result is on hand). */
export function setLayerExtent(id, bounds) { hydrate(); _extent.set(id, bounds || null); persist(); }

export function _resetCoverageCache() { _extent.clear(); _hydrated = false; } // tests only

/* Ensure every REGIONAL layer in `layers` has had its extent read from its health
 * probe. `probe(url)` is layers.js probeService (cached + deduped), whose result now
 * carries `fullExtent`/`extent`. One tiny ?f=json per regional layer, ever (then it's
 * cached across reloads) — this is the "no extra request" the brief calls for: the
 * extent rides the same health probe, just captured. Returns a promise. */
export async function prefetchExtents(layers, probe) {
  hydrate();
  const jobs = Object.entries(layers || {})
    .filter(([id, cfg]) => isRegional(id) && cfg && cfg.url && !_extent.has(id))
    .map(async ([id, cfg]) => {
      _extent.set(id, "pending"); // dedupe concurrent callers
      try {
        const r = await probe(cfg.url);
        const raw = r && (r.fullExtent || r.extent);
        _extent.set(id, esriExtentToBounds(raw));
      } catch (_) {
        _extent.set(id, null); // probe failed → unknown → fail open
      }
    });
  if (jobs.length) { await Promise.all(jobs); persist(); }
}

/* Compute coverage for every layer in `overlays` against the current viewport.
 * Returns { id: "in" | "out" | "unknown" }. Regional layers read their cached extent;
 * everything else is "in". `viewport` is {s,w,n,e} (see boundsFromLeaflet). Pure given
 * the cache. */
export function computeCoverage(viewport, overlays, bufferMiles = 2.5) {
  hydrate();
  const out = {};
  for (const id of Object.keys(overlays || {})) {
    const scope = layerScope(id);
    out[id] = scope === "regional"
      ? regionCoverage({ scope, extentBounds: _extent.get(id), viewport, bufferMiles })
      : "in";
  }
  return out;
}

/* A Leaflet map → a plain {s,w,n,e} viewport bbox (or null). */
export function boundsFromLeaflet(map) {
  try {
    if (!map || !map.getBounds) return null;
    const b = map.getBounds();
    return { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
  } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// Relevance preferences (NEW-2) — the picker's "Relevance" mode + "nearby radius".
// Shared across the map-finder and planner Layers panels (one source of truth) and
// persisted, like the existing planarfit:* UI prefs. localStorage is guarded so the
// module imports cleanly in the node test environment.
// ---------------------------------------------------------------------------
export const RELEVANCE_MODES = ["all", "dim", "hide"];
export const DEFAULT_RELEVANCE = "dim";
export const DEFAULT_RADIUS_MI = 2.5;
const RADIUS_MIN = 0.5, RADIUS_MAX = 25;
const PREF_KEY = "planarfit:relevance:v1";

export const normalizeMode = (m) => (RELEVANCE_MODES.includes(m) ? m : DEFAULT_RELEVANCE);
export const normalizeRadius = (r) => {
  const n = +r;
  if (!Number.isFinite(n)) return DEFAULT_RADIUS_MI;
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, n));
};

let _prefs = null;
const _prefSubs = new Set();
function loadPrefs() {
  if (_prefs) return _prefs;
  _prefs = { mode: DEFAULT_RELEVANCE, radius: DEFAULT_RADIUS_MI };
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    _prefs = { mode: normalizeMode(raw.mode), radius: normalizeRadius(raw.radius) };
  } catch (_) { /* defaults */ }
  return _prefs;
}
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(_prefs)); } catch (_) { /* ignore */ }
  _prefSubs.forEach((cb) => { try { cb(_prefs); } catch (_) {} });
}
export const getRelevanceMode = () => loadPrefs().mode;
export const getNearbyRadiusMiles = () => loadPrefs().radius;
export function setRelevanceMode(mode) { loadPrefs(); _prefs = { ..._prefs, mode: normalizeMode(mode) }; savePrefs(); }
export function setNearbyRadiusMiles(r) { loadPrefs(); _prefs = { ..._prefs, radius: normalizeRadius(r) }; savePrefs(); }
/* Subscribe to prefs changes (both panels + the parent's recompute stay in sync). */
export function subscribeRelevance(cb) { _prefSubs.add(cb); return () => _prefSubs.delete(cb); }
export function _resetRelevancePrefs() { _prefs = null; } // tests only
