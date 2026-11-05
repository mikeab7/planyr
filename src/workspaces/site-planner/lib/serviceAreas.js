/* SERVICE AREAS — where a source actually serves (B2436066, Imagery & Layers NEW-3).
 *
 * A registry row declares `regions: ["harris"]` / `["houston"]` / `["bkdd"]`; this leaf answers "is this point inside that area?".
 * The areas are real boundaries (serviceAreaData.js, built by scripts/build-service-areas.mjs): Harris County, the City of Houston
 * limits + ETJ, and the Brookshire–Katy Drainage District — NOT the 65-mile circle the old `houston` region used, which swallowed
 * Chambers, Galveston and Brazoria counties whose rows never answer there.
 *
 * ⛔ ONE ANSWER FOR BOTH SURFACES. The planner passes the plan origin and the finder the view centre; both go through
 * `layerPanelModel.layerAvailableHere` → `inRegion` → here, and the map's draw filter (`drawnOverlaysOf`) asks the same, so the panel
 * and the map can never disagree about a point. Nothing here reads a county the host has identified (that was the planner/finder
 * split: the planner's county input is null on a plan whose identify has not resolved, and a null county fails open).
 *
 * FAILS OPEN, always: an area whose geometry has not loaded (or failed to) answers null ("cannot tell") and null never hides a row;
 * so does a point with no location. The simplified polygons are approximate, so a point is "inside" when ANY of five probes (the
 * point and four ≈0.3 mi offsets) is — an approximation may only err towards SHOWING a layer.
 *
 * Boot-safe: this file is tiny and the data arrives by DYNAMIC import (its own chunk), the terrainGate / countyPolygons shape. */
let DATA = null;
let loading = null;
const subs = new Set();

export const PROBE_DEG = 0.005;
export const serviceAreasReady = () => !!DATA;
export const subscribeServiceAreas = (cb) => { subs.add(cb); return () => subs.delete(cb); };
const notify = () => subs.forEach((cb) => { try { cb(); } catch (_) { /* a subscriber never breaks the loader */ } });

export function ensureServiceAreas() {
  if (DATA) return Promise.resolve(DATA);
  if (loading) return loading;
  loading = import("./serviceAreaData.js")
    .then((m) => { DATA = m.SERVICE_AREAS; notify(); return DATA; })
    .catch((err) => {
      // LOUD-FAILURE: rows stay listed (fail open), but the missing geometry is never silent.
      if (typeof console !== "undefined") console.error("[serviceAreas] geometry unavailable — Houston-area rows stay listed everywhere:", err);
      loading = null;
      return null;
    });
  return loading;
}
/* tests / harness seam */
export function _setServiceAreas(data) { DATA = data; loading = data ? Promise.resolve(data) : null; }

export const hasServiceArea = (key) => !!(DATA && DATA[key]);

function inRing(ring, x, y) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const inPolygon = (poly, x, y) => inRing(poly[0], x, y) && !poly.slice(1).some((h) => inRing(h, x, y));

/* true / false, or null when it cannot be told (no location, or the area is unknown / not loaded). */
export function areaContains(key, loc) {
  const area = DATA && DATA[key];
  if (!area || !loc) return null;
  const lat = Number(loc.lat), lng = Number(loc.lng != null ? loc.lng : loc.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const probes = [[lng, lat], [lng + PROBE_DEG, lat], [lng - PROBE_DEG, lat], [lng, lat + PROBE_DEG], [lng, lat - PROBE_DEG]];
  return probes.some(([x, y]) => area.polys.some((p) => inPolygon(p, x, y)));
}
