/* mapLock — the ONE projection that welds the planner's feet frame to the Web-Mercator
 * basemap. Pure math, no DOM, no Leaflet (so it unit-tests and can run in a worker).
 *
 * WHY THIS EXISTS (NEW-1). The planner draws in a local feet frame anchored at the site
 * origin; the basemap under it is Web Mercator. Those two only stay locked together if
 * BOTH the position conversion and the scale (zoom) conversion use the SAME latitude
 * model. They used to disagree:
 *   • position went through an EQUIRECTANGULAR frame pinned at the site origin
 *     (`y = -(lat - lat0) * FT_PER_DEG`, linear in latitude), while
 *   • the basemap zoom was re-derived at the CURRENT view-centre latitude.
 * Mercator's y is nonlinear in latitude and the linear frame's is not, so the two
 * round-tripped inconsistently: a long north–south pan out and back left the drawing a
 * few feet off the imagery, EVERY time, and it accumulated (measured 2026-07-28: -4.3 ft
 * residual per ~89,000 ft out-and-back, uniform across every element; east–west, where
 * both models agree, was exactly lossless at 0.0 ft).
 *
 * THE FIX — one model for both halves. The feet frame is now an exact UNIFORM SCALING of
 * spherical Web Mercator, anchored at the site origin:
 *
 *     x_ft = (lon - lon0)                     * FT_PER_DEG * cos(lat0)
 *     y_ft = -(mercDeg(lat) - mercDeg(lat0))  * FT_PER_DEG * cos(lat0)
 *
 * Because Mercator is conformal and this is a pure scale of it, feet↔screen is a rigid
 * affine map of Mercator↔screen: the round trip is exact at any pan distance, in any
 * direction, and nothing accumulates. The matching scale conversion (`ppfToZoom`) is
 * therefore anchored at the SAME `lat0` — never at the panned-to latitude.
 *
 * WHAT THIS DOES NOT CHANGE. At `lat0` the new frame is identical to the old one to first
 * order (dy/dlat = -FT_PER_DEG exactly at lat0), so drawn geometry, acreage and every
 * dimension are untouched: over a mile of site the linear-vs-Mercator difference is under
 * a ten-thousandth of a foot, and even ten miles out it is ~0.02 ft. Feet stay ground-true
 * at the site, which is the only place site math is done.
 */

// Feet per degree on the Web-Mercator sphere base (2πR/360). Both axes use it, so the
// frame is a linearisation of spherical Mercator rather than of the ellipsoid.
export const FT_PER_DEG = 365223;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// Spherical Mercator northing, expressed in DEGREES so it shares FT_PER_DEG with the
// longitude axis. mercDeg(lat) ≈ lat near the equator and diverges toward the poles.
export const mercDeg = (lat) => R2D * Math.log(Math.tan(Math.PI / 4 + clampLat(lat) * D2R / 2));

// Inverse of mercDeg.
export const invMercDeg = (m) => R2D * (2 * Math.atan(Math.exp(m * D2R)) - Math.PI / 2);

// Web Mercator is undefined at the poles; clamp to the standard ±85.051129° world edge so
// a wild input can never produce Infinity and poison a view transform.
const MAX_LAT = 85.05112878;
function clampLat(lat) {
  const v = Number(lat);
  if (!Number.isFinite(v)) return 0;
  return v > MAX_LAT ? MAX_LAT : v < -MAX_LAT ? -MAX_LAT : v;
}

// Feet per degree of Mercator (either axis) in a frame anchored at lat0. One constant for
// x and y — that uniformity is what makes the frame conformal with the basemap.
export const ftPerDeg = (lat0) => FT_PER_DEG * Math.cos(clampLat(lat0) * D2R);

/* [lon, lat] → planner feet {x east, y SOUTH} about the origin (lon0, lat0). */
export function lngLatToFeet(lon, lat, lon0, lat0) {
  const k = ftPerDeg(lat0);
  return { x: (lon - lon0) * k, y: -(mercDeg(lat) - mercDeg(lat0)) * k };
}

/* Planner feet {x, y} → [lat, lng]. Exact inverse of lngLatToFeet. */
export function feetToLatLngPair(pt, lat0, lon0) {
  const k = ftPerDeg(lat0);
  const x = Number(pt && pt.x) || 0;
  const y = Number(pt && pt.y) || 0;
  return [invMercDeg(mercDeg(lat0) - y / k), lon0 + x / k];
}

// ── scale ────────────────────────────────────────────────────────────────────────────
// Leaflet lays 256 px across every 360° of Mercator at zoom 0, so pixels per degree of
// Mercator is 256·2^z / 360. The feet frame above puts `ftPerDeg(lat0)` feet in that same
// degree — so the two constants must be THE SAME FT_PER_DEG, not one derived from the
// earth's circumference in metres and the other from a feet-per-degree constant. They used
// to be exactly that, differing by ~4 parts per million, which is small but not zero: it
// left a residual that grew with distance from the view centre. Deriving the zoom from
// FT_PER_DEG makes the SVG↔basemap lock exact by construction rather than approximate.
const PX_PER_WORLD_DEG_Z0 = 256 / 360;

/* The (fractional) Leaflet zoom whose pixels-per-foot equals the planner's `ppf` in a feet
 * frame anchored at `lat0`. ALWAYS pass the SITE ORIGIN latitude — passing the panned-to
 * centre latitude is precisely the NEW-1 bug: it makes the basemap rescale while the
 * drawing does not. */
export const ppfToZoom = (ppf, lat0) =>
  Math.log2((ppf * ftPerDeg(lat0)) / PX_PER_WORLD_DEG_Z0);

/* Inverse of ppfToZoom — pixels per foot at a given Leaflet zoom. */
export const zoomToPpf = (zoom, lat0) =>
  (Math.pow(2, zoom) * PX_PER_WORLD_DEG_Z0) / ftPerDeg(lat0);

/* ── the basemap's whole-pixel floor ──────────────────────────────────────────────────
 * Leaflet can only place the basemap on WHOLE screen pixels: `_getNewPixelOrigin` ends in
 * `.round()`, the map pane's position is set in integer pixels, and `panBy` rounds the
 * offset it is given. The drawing has no such constraint — its offsets are arbitrary
 * floats — so drawing-vs-imagery registration is quantised at half a pixel per axis, and
 * two different moments can differ by a whole pixel. That floor is Leaflet's, not ours,
 * and it is bounded and non-cumulative (see NEW-1 in ui-audit/diagnose-map-lock.mjs).
 * MEASURED, so nobody has to re-chase it: a pure PAN never changes the registration at all
 * (mouse drags move by whole pixels, so the pan the basemap needs is a whole number and
 * rounds to itself — an out-and-back pan returns to 0.000 ft, twice over, exactly as the
 * live V478 pass found). A ZOOM commit re-snaps the basemap onto a fresh whole-pixel grid,
 * so the registration hops to a new sub-pixel remainder each time — bounded, never growing.
 *
 * What IS ours is a second, avoidable rounding: Leaflet's public
 * `latLngToContainerPoint` rounds the projection (`latLngToLayerPoint` calls `_round()`),
 * so aiming a pan with it rounds once there and again inside `panBy`.
 * `exactContainerPoint` is the same conversion with the snap left out: project exactly, and
 * let the ONE unavoidable snap happen where Leaflet actually needs it. Also used for the
 * live gesture transform, which is fractional by nature and never wanted a rounded target.
 * Honest scope: on an EVEN-sized map container this is provably a no-op
 * (`round(round(w) - k) === round(w) - k` for integer k, and half-the-size is then an
 * integer), and it measured as one. It removes the odd-dimension case, where the two
 * roundings can disagree by a pixel. It does not, and cannot, reach the zoom-commit snap.
 *
 * `worldPx` = map.project(latlng, zoom) · `pixelOrigin` = map.getPixelOrigin() ·
 * `panePos` = map.layerPointToContainerPoint([0, 0]).
 */
export const exactContainerPoint = (worldPx, pixelOrigin, panePos) => ({
  x: worldPx.x - pixelOrigin.x + panePos.x,
  y: worldPx.y - pixelOrigin.y + panePos.y,
});

/* ── closing the whole-pixel floor: the registration shift (NEW-2) ────────────────────
 * MEASURED LIVE 2026-07-29 on a real tract, against an INDEPENDENT ground truth (each Esri
 * basemap tile carries its z/x/y in its URL and its screen rect is readable, so the exact
 * lat/lng of any screen pixel is computable without trusting Leaflet or us): the app's
 * answer for a screen pixel sat about ONE CSS PIXEL away from the imagery's own answer for
 * that same pixel — 3.7 ft at z18, 4.6 ft at z17, repeatable to a hundredth of a foot, and
 * pointing a different way at each zoom. A clean offset, not noise and not a scale error.
 * One pixel is 3.6 ft at z18 and 10–15 ft at the overview zoom real layout is done at, so
 * "sub-pixel" is the wrong frame: this is the "my measurement lands ten feet from where I
 * clicked" report, and it is the SAME defect in both directions (what the readout says,
 * and where a placed point goes) because both run through one conversion.
 *
 * TWO CONTRIBUTORS, one of them ours:
 *   1. LEAFLET'S SNAP (theirs, ±0.5 px/axis, twice over). `_getNewPixelOrigin` ends in
 *      `._round()` and `panBy` rounds the offset it is handed, so every commit re-seats the
 *      basemap on a fresh whole-pixel grid with a new sub-pixel remainder.
 *   2. THE CONTAINER-CENTRE MISMATCH (ours, ±0.25 px/axis). We ask Leaflet to centre on the
 *      feet point under the DRAWING's centre — `size.w / 2`, a float straight off
 *      `getBoundingClientRect` — while `commit` (and Leaflet itself) lands that centre at
 *      the MAP's own half-size, which comes from `clientWidth`, an integer. On a container
 *      whose CSS width is fractional the two halves differ, and at a fractional device
 *      pixel ratio (the reporting machine runs 2.15) fractional widths are the norm.
 * Together those bound the error at roughly one pixel per axis — exactly what was measured.
 *
 * THE FIX — weld the DRAWING to wherever the basemap actually landed, and do it in the
 * render only. `registrationShift` returns the residual between the two frames; the planner
 * applies it as a CSS translate on the SVG canvas, which self-corrects the pointer path for
 * free (`p2f` reads `getBoundingClientRect`, so the same translate that moves the drawing
 * moves the coordinate the cursor reports). `view.offX/offY` are NOT touched: the exactly
 * reversible pan V478 proved is preserved, nothing accumulates, and the aerial is never
 * resampled (B1049/V483) because the aerial never moves. The drawing frame is welded to
 * what the user is actually looking at, which is the only frame their click can mean.
 *
 * Deliberately NOT mirrored into the export (PDF-PARITY, stated rather than skipped): the
 * shift compensates a LIVE-DOM artefact of Leaflet's integer map pane. The sheet composes
 * its own tile mosaic from `view` with no such quantisation, so copying the shift there
 * would ADD the very error it removes on screen.
 */

/* Where the basemap paints `worldPx` in CANVAS-WRAPPER pixels, at settle (the wrap's CSS
 * transform has been cleared). `overscan` is the wrap's negative inset. */
export const basemapWrapPoint = (worldPx, pixelOrigin, panePos, overscan = 0) => {
  const p = exactContainerPoint(worldPx, pixelOrigin, panePos);
  return { x: p.x - overscan, y: p.y - overscan };
};

/* Same, DURING a live gesture, when the wrap carries `translate(tx,ty) scale(s)` about its
 * own top-left. Kept separate (rather than reading the DOM back) so the gesture branch is
 * unit-testable and so the two branches can't silently diverge. */
export const basemapWrapPointTransformed = (worldPx, pixelOrigin, panePos, overscan, { tx = 0, ty = 0, scale = 1 } = {}) => {
  const p = exactContainerPoint(worldPx, pixelOrigin, panePos);
  return { x: tx + p.x * scale - overscan, y: ty + p.y * scale - overscan };
};

/* How far the drawing must move to sit exactly on the imagery. `imgPt` and `drawPt` are
 * both in canvas-wrapper pixels. */
export const registrationShift = (imgPt, drawPt) => ({
  dx: (Number(imgPt && imgPt.x) || 0) - (Number(drawPt && drawPt.x) || 0),
  dy: (Number(imgPt && imgPt.y) || 0) - (Number(drawPt && drawPt.y) || 0),
});

/* The compensation is a sub-pixel correction for a quantisation whose whole range is about
 * one pixel per axis. Anything larger is a MODEL disagreement — a scale mismatch, a stale
 * container size, a half-applied gesture transform — and nudging the drawing would hide it
 * instead of fixing it. `sanitizeShift` refuses those loudly (the caller reports and applies
 * nothing) rather than quietly shoving the drawing across the screen. */
export const REGISTRATION_SANITY_PX = 2.5;
export function sanitizeShift(shift, limit = REGISTRATION_SANITY_PX) {
  const dx = Number(shift && shift.dx), dy = Number(shift && shift.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { ok: false, reason: "non-finite", shift: { dx: 0, dy: 0 } };
  if (Math.abs(dx) > limit || Math.abs(dy) > limit) return { ok: false, reason: "out-of-range", shift: { dx: 0, dy: 0 } };
  return { ok: true, reason: null, shift: { dx, dy } };
}

/* ── the lock invariant ───────────────────────────────────────────────────────────────
 * Where a feet point lands on screen, computed TWO independent ways:
 *   • the planner's own SVG transform (feet × ppf + offset), and
 *   • the basemap's, by projecting the point to lat/lng, then to Web-Mercator world
 *     pixels at the derived zoom, relative to the map centre.
 * They must agree — that agreement IS "the drawing is locked to the imagery". Exported so
 * the regression test can assert it directly instead of eyeballing a screenshot.
 */
export function lockOffsetPx(pt, view, size, origin) {
  const svg = { x: pt.x * view.ppf + view.offX, y: pt.y * view.ppf + view.offY };
  // The map centre, exactly as SitePlanner derives it: the feet point under the canvas centre.
  const centerFt = { x: (size.w / 2 - view.offX) / view.ppf, y: (size.h / 2 - view.offY) / view.ppf };
  const [cLat, cLon] = feetToLatLngPair(centerFt, origin.lat, origin.lon);
  const zoom = ppfToZoom(view.ppf, origin.lat);
  const [pLat, pLon] = feetToLatLngPair(pt, origin.lat, origin.lon);
  const scale = (256 * Math.pow(2, zoom)) / 360; // world pixels per degree of Mercator
  const map = {
    x: size.w / 2 + (pLon - cLon) * scale,
    y: size.h / 2 - (mercDeg(pLat) - mercDeg(cLat)) * scale,
  };
  return { dx: map.x - svg.x, dy: map.y - svg.y };
}
