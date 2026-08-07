/* B209502 — WHICH COUNTY IS THIS POINT IN, answered by GEOMETRY.
 *
 * ⛔ THE RULE THIS MODULE EXISTS TO ENFORCE: A BOUNDING BOX MAY NARROW THE CANDIDATES, IT MAY
 * NEVER DECIDE THE ANSWER.
 *
 * `counties.js` routed a click and a view by testing the point against each county's padded
 * bounding box. A rectangle is not a county. Measured on six new Houston-area sites, four of six
 * resolved wrong — and not as near-misses:
 *
 *   Pearland (-95.29, 29.55)   → reported WITHIN harris. It is BRAZORIA. Harris's rectangle
 *                                swallows it whole, so this was a confident, unambiguous match
 *                                with no fallback involved — the worst shape a wrong answer can
 *                                take, because nothing downstream had any reason to doubt it.
 *   Sugar Land (-95.60, 29.58) → harris ahead of fortbend (two boxes overlap, config order won).
 *   Conroe (-95.45, 30.28)     → no box at all → the harris-first fallback. It is MONTGOMERY.
 *   Texas City (-94.935, 29.40)→ same fallback. It is GALVESTON.
 *
 * A wrong county is not a cosmetic label: it selects the drainage authority, the detention
 * criteria, the setbacks and the review path. The Pearland case had already produced corroborating
 * evidence for its own wrong answer — HCFCD (Harris County Flood Control District) channel and
 * watershed layers returned features at a Brazoria site, because they were asked.
 *
 * WHY THE GEOMETRY IS BUNDLED RATHER THAN FETCHED FROM A SERVICE. There is a perfectly good live
 * authority for this question (`jurisdiction.countyAtPoint`, which queries the registry's `county` /
 * `countyCo` boundary layers) and it stays the authority for a real site. But a resolver that needs
 * a GIS endpoint cannot hold when that endpoint is down — and a site falling through to a default is
 * EXACTLY the moment everything is unreachable. That is the same reasoning `coloradoRegions.js` and
 * `siteRegion.js` already follow, and this is its county-level twin: a network-free floor that is
 * always right about which county, under the live identify that is additionally right about which
 * parcel.
 *
 * ⛔ THIS FILE IS THE GATE, NOT THE ENGINE — keep it small. `counties.js` is on the Site route's
 * boot path, so everything statically reachable from here is charged against that route's largest
 * chunk; shipping the decoder and the ray cast inline breached that ceiling in CI by 0.7 KB. The
 * working half lives in `countyPolygonsCore.js` and arrives by DYNAMIC import on the same step that
 * fetches the geometry. That costs nothing in behaviour, because a query before the geometry lands
 * was always going to return `pending` — the code and the data simply arrive together. This is the
 * `adminBoundaryGate.js` / `terrainGate.js` shape; do not "tidy" the core back into a static import.
 *
 * PRECISION, stated honestly. The asset is simplified and quantised (see
 * `scripts/build-county-polygons.mjs`), so a point within roughly a hundred metres of a county line
 * may resolve to either side. That is why `resolveCounty` reports `nearEdge` — a caller that needs
 * certainty at a boundary must defer to the live identify, and the ones that matter do. Everything
 * this feeds is screening-grade: a panel heading, a candidate ORDER, a "no parcel data" statement.
 */

/* The decoded index and the loaded engine, or null until `loadCountyPolygons()` resolves. Module
 * level on purpose: the asset is immutable reference data, so one fetch + one decode per session
 * serves every caller. */
let INDEX = null;
let CORE = null;
let loading = null;

/**
 * Which county contains (lat, lng), by geometry.
 *
 * Always returns an object — never null, never a bare string — because every honest outcome here
 * is a DIFFERENT outcome, and collapsing them is how the bbox answer passed for a real one:
 *
 *   { status: "ok",      name, state, fips, nearEdge }  — a polygon contains the point
 *   { status: "pending" }                               — geometry/engine not resident yet
 *   { status: "outside" }                               — loaded, and no county contains it
 *                                                         (out of state, offshore, in the Gulf)
 *
 * `nearEdge` true means the point is within ~150 m of the resolved county's line, so a caller that
 * needs certainty should defer to the live identify.
 *
 * Synchronous and pure once warm; before that it reports `pending` rather than guessing.
 */
export function resolveCounty(lat, lng) {
  if (!INDEX || !CORE) return { status: "pending" };
  return CORE.resolveIn(INDEX, lat, lng);
}

/* Whether the geometry is resident. Callers use this to decide whether to re-ask after the warm. */
export const countyPolygonsReady = () => !!(INDEX && CORE);

/**
 * Fetch the asset, load the engine, decode. Idempotent and cached: concurrent callers share one
 * request, and a failure is NOT latched (a later call retries) — a transient boot-time blip must
 * not leave the app permanently unable to name a county.
 */
export function loadCountyPolygons(fetchImpl) {
  if (INDEX && CORE) return Promise.resolve(INDEX);
  if (loading) return loading;
  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) return Promise.resolve(null);
  const base = typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL;
  const url = `${base || "/"}geo/county-polygons.json`.replace(/([^:])\/\/+/g, "$1/");
  loading = Promise.all([
    Promise.resolve(f(url)).then((r) => (r && r.ok ? r.json() : Promise.reject(new Error(`county-polygons ${r && r.status}`)))),
    import("./countyPolygonsCore.js"),
  ])
    .then(([payload, core]) => { CORE = core; INDEX = core.buildIndex(payload); return INDEX; })
    .catch((err) => {
      // LOUD-FAILURE: the app keeps working on the bbox pre-filter, but the fact that the
      // authoritative geometry is missing must never be silent — that is the whole class of bug
      // this module exists to close.
      if (typeof console !== "undefined") console.error("[countyPolygons] geometry unavailable — county answers fall back to the bbox pre-filter:", err);
      loading = null;
      return null;
    });
  return loading;
}

/* Inject geometry — the seam tests and the ui-audit harness use instead of a fetch. Accepts EITHER
 * a raw asset payload or an already-decoded index, because both are natural things for a caller to
 * hold and getting it wrong is silent: decoding a decoded index walks deltas over absolute
 * coordinates and produces geometry that contains nothing, so every point reads "outside" — a
 * plausible-looking verdict with no error anywhere. The two shapes are told apart by the FIRST
 * element of a ring: raw rings are flat arrays of NUMBERS, decoded rings are arrays of [x,y] PAIRS.
 * `Array.isArray` alone cannot separate them, which is exactly how this went wrong once.
 *
 * Async because the engine is lazily imported; tests await it. */
export async function setCountyPolygons(payload) {
  CORE = await import("./countyPolygonsCore.js");
  const ring = payload && payload.counties && payload.counties[0] && payload.counties[0].rings && payload.counties[0].rings[0];
  const isRaw = Array.isArray(ring) && typeof ring[0] === "number";
  INDEX = isRaw ? CORE.buildIndex(payload) : payload;
  return INDEX;
}

/* Test seam: forget everything. Never called by the app. */
export function __resetCountyPolygons() { INDEX = null; CORE = null; loading = null; }
