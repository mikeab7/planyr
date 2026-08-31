/* Pure georeferencing math for an uploaded site-plan overlay (B848848 — comp pinning on an
 * uploaded site plan). Reuses the EXISTING machinery rather than inventing a second
 * image-anchoring system: `solveSimilarityLSQ` (shared/geometry) is the same 2-point/N-point
 * rigid-fit solver the Site Planner's own reference-overlay "align" mode already uses
 * (site-planner/lib/overlayAlign.js), and `projectToGrid`/`gridToProject` (shared/coordinates)
 * is the app's one real-world coordinate spine (EPSG:2278, Texas State Plane South Central,
 * US survey feet) — the same grid the layer-coverage engine already reprojects onto.
 *
 * The georeference is a SIMILARITY transform (uniform scale + rotation + translation) from
 * image-pixel space to the project grid (state-plane feet), solved from >=2 control-point
 * pairs {px, py, lat, lon} — a pixel on the uploaded raster paired with the real-world point
 * it corresponds to. Control points are the source of truth (persisted on the overlay row);
 * the transform itself is cheap to resolve and is NEVER persisted as a separate serialized
 * closure — recomputing it from the control points on every read means the transform can
 * never drift out of sync with the points that define it.
 */
import { solveSimilarityLSQ } from "../../geometry/similarityTransform.js";
import { projectToGrid, gridToProject } from "../../coordinates/index.js";

// Image-pixel space is y-DOWN (standard raster/canvas convention: py=0 at the top); the
// project grid (and lat/lon) is y-UP (north-positive). A similarity transform is a rigid
// rotation and cannot represent that axis flip on its own — fitting raw (px,py) against
// (x,y) feet gets the handedness wrong for any real (non-degenerate) control-point pair, so
// every image point is mirrored into a y-up "math" space before fitting or applying the
// transform, and mirrored back on the way out. Purely an internal convention; every
// exported function still takes/returns raw image px/py.
const toMathSpace = (px, py) => ({ x: px, y: -py });
const fromMathSpace = (pt) => ({ x: pt.x, y: -pt.y });

/** >=2 control points {px, py, lat, lon} -> a similarity transform (image px, y-down) ->
 * state-plane feet, or null (fewer than 2 points, or every image point coincides).
 * `t.apply({x,y})` expects a MATH-SPACE point (use `imagePointToLatLon` for a raw pixel);
 * `t.scale` is feet per image pixel; `t.rotDeg` is the image's rotation relative to true
 * north/east; `t.residual` is the RMS fit error in feet (0 for exactly 2 points, a real
 * number for 3+ — a high residual means the control points don't agree on one rigid
 * placement, i.e. the page isn't printed to a single consistent scale). */
export function solveOverlayTransform(controlPoints) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) return null;
  const pairs = [];
  for (const cp of controlPoints) {
    if (!cp || typeof cp.px !== "number" || typeof cp.py !== "number") return null;
    if (typeof cp.lat !== "number" || typeof cp.lon !== "number") return null;
    pairs.push({ from: toMathSpace(cp.px, cp.py), to: projectToGrid(cp.lat, cp.lon) });
  }
  return solveSimilarityLSQ(pairs);
}

/** The inverse of a solved transform (state-plane feet -> image math-space), built by
 * sampling the forward transform at three well-spread synthetic points and re-solving — a
 * similarity's inverse is itself a similarity, so this reuses the SAME solver rather than
 * hand-deriving a second closed form. Returns null if `t` is null. */
export function invertOverlayTransform(t) {
  if (!t) return null;
  const samples = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }];
  return solveSimilarityLSQ(samples.map((s) => ({ from: t.apply(s), to: s })));
}

/** An image-pixel point on the overlay -> real-world {lat, lon}, or null if the control
 * points can't resolve a transform. */
export function imagePointToLatLon(controlPoints, px, py) {
  const t = solveOverlayTransform(controlPoints);
  if (!t) return null;
  return gridToProject(t.apply(toMathSpace(px, py)));
}

/** Real-world {lat, lon} -> the image-pixel point on the overlay it corresponds to, or null.
 * Used only to snapshot a comp's position relative to the overlay for display/provenance —
 * the comp's authoritative position is always its own stored lat/lon. */
export function latLonToImagePoint(controlPoints, lat, lon) {
  const t = solveOverlayTransform(controlPoints);
  const inv = invertOverlayTransform(t);
  if (!inv) return null;
  return fromMathSpace(inv.apply(projectToGrid(lat, lon)));
}

/** The four corner lat/lons of an imgW x imgH raster under the given control points — what a
 * map renderer needs to place the rotated image. Null if the control points can't resolve. */
export function overlayCornersLatLon(controlPoints, imgW, imgH) {
  const t = solveOverlayTransform(controlPoints);
  if (!t) return null;
  const at = (px, py) => gridToProject(t.apply(toMathSpace(px, py)));
  return { topLeft: at(0, 0), topRight: at(imgW, 0), bottomLeft: at(0, imgH), bottomRight: at(imgW, imgH) };
}

/** Straight-line real-world distance between two {lat,lon} points, in feet — via the same
 * state-plane projection used everywhere else, NOT a haversine (this app's whole coordinate
 * spine is the project grid). This is the independent "does this match a distance I know"
 * scale check: it measures whatever two points the user clicks on the real map, with no
 * reference back to the overlay's own transform, so a badly-fit georeference can't hide
 * behind a self-confirming number. */
export function measureLatLonFeet(a, b) {
  const pa = projectToGrid(a.lat, a.lon), pb = projectToGrid(b.lat, b.lon);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}
