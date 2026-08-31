/* Pure georeferencing math for an uploaded site-plan overlay (B848496 NEW-2 — the owner
 * rejected the original 2-point control-point wizard: "just mimic the way it works on the
 * site planner module for references" — i.e. the Site Planner's own on-canvas reference-image
 * tool (SitePlanner.jsx `sheetOverlays` + its move/scale/rotate handles), which places an
 * image by DIRECT MANIPULATION rather than by fitting a transform from two clicked point
 * pairs.
 *
 * A placement is {centerLat, centerLon, ftPerPx, rotationDeg} — a real-world anchor point, a
 * uniform scale (feet per source-image pixel), and a rotation in degrees. This is built
 * DIRECTLY, never solved: the two-control-point least-squares fit this replaces was
 * under-constrained (a similarity transform fit from two point pairs cannot distinguish a
 * correct placement from its mirror image without a third point) and it shipped a real
 * production defect — a plan placed upside down, every letter of its title block inverted.
 * A direct rotation can never produce that: it is a proper rotation matrix applied to a known
 * center, not a fit that can flip.
 *
 * `projectToGrid`/`gridToProject` (shared/coordinates) is the app's one real-world coordinate
 * spine (EPSG:2278, Texas State Plane South Central, US survey feet).
 */
import { projectToGrid, gridToProject } from "../../coordinates/index.js";

/** True if `p` is a usable placement. */
export function validPlacement(p) {
  return !!p && Number.isFinite(p.centerLat) && Number.isFinite(p.centerLon) &&
    Number.isFinite(p.ftPerPx) && p.ftPerPx > 0;
}

// Image-pixel space is y-DOWN (raster/canvas/screen convention); the project grid (and
// lat/lon) is y-UP (north-positive). `at()` below takes an offset from center in that y-down
// "image-local" frame — the SAME frame a screen-pixel drag naturally lives in, which is what
// lets the interactive handles feed their raw screen-pixel deltas straight into this module
// with no sign-flip of their own (see lib/overlayPlacementDrag.js). A positive `rotationDeg`
// rotates CLOCKWISE as drawn on screen — exactly how the Site Planner's SVG `rotate(deg)` on
// its own reference-image handle already behaves, so a user familiar with that control feels
// the same rotation sense here.
function rotatedOffset(dx, dy, rotationDeg) {
  const rad = ((rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return { rx: dx * cos - dy * sin, ry: dx * sin + dy * cos };
}

/** The four image corners' real-world {lat,lon} under `placement` — what a map renderer needs
 * to place the rotated image. Null if the placement or the image size isn't usable. */
export function overlayCornersFromPlacement(placement, imgW, imgH) {
  if (!validPlacement(placement) || !(imgW > 0) || !(imgH > 0)) return null;
  const center = projectToGrid(placement.centerLat, placement.centerLon);
  const halfW = (imgW * placement.ftPerPx) / 2, halfH = (imgH * placement.ftPerPx) / 2;
  const at = (dx, dy) => {
    const { rx, ry } = rotatedOffset(dx, dy, placement.rotationDeg);
    // grid y is north-positive; a "down" (+y) image-local offset is south, so flip it going in.
    return gridToProject({ x: center.x + rx, y: center.y - ry });
  };
  return {
    topLeft: at(-halfW, -halfH), topRight: at(halfW, -halfH),
    bottomLeft: at(-halfW, halfH), bottomRight: at(halfW, halfH),
  };
}

/** Real-world {lat,lon} -> the image-pixel point it corresponds to under `placement` — the
 * inverse of the per-corner mapping `overlayCornersFromPlacement` uses. Used only to snapshot
 * a comp's position relative to the plan for display/provenance; a comp's authoritative
 * position is always its own stored lat/lon, never re-derived from this. Null if the
 * placement or image size isn't usable. */
export function latLonToImagePoint(placement, imgW, imgH, lat, lon) {
  if (!validPlacement(placement) || !(imgW > 0) || !(imgH > 0)) return null;
  const center = projectToGrid(placement.centerLat, placement.centerLon);
  const p = projectToGrid(lat, lon);
  const rx = p.x - center.x, ry = -(p.y - center.y); // grid offset -> image-local (y-down) rotated frame
  // Invert the rotation: [dx,dy] = R(-rotationDeg) * [rx,ry].
  const { rx: dx, ry: dy } = rotatedOffset(rx, ry, -(placement.rotationDeg || 0));
  const halfW = (imgW * placement.ftPerPx) / 2, halfH = (imgH * placement.ftPerPx) / 2;
  return { x: (dx + halfW) / placement.ftPerPx, y: (dy + halfH) / placement.ftPerPx };
}

/** A sensible starting size for a freshly placed overlay: `ftPerPx` so the image renders at
 * `fraction` (default 0.6, matching the Site Planner reference-image panel's own "Size to
 * view" button) of the given real-world view width. Pure sizing math only — the caller
 * supplies the current view width in feet (from the live map) and picks the center. */
export function suggestFtPerPx(viewWidthFt, imgW, fraction = 0.6) {
  if (!(viewWidthFt > 0) || !(imgW > 0)) return 1;
  return Math.max(0.0001, (viewWidthFt * fraction) / imgW);
}

/** Corner-handle drag: uniform scale about the FIXED center. `ratio` is (current pointer
 * distance from center) / (distance at grab) — unitless, so it's correct whether measured in
 * screen pixels or feet, as long as both used the SAME units and the map zoom didn't change
 * mid-drag. Mirrors the Site Planner's own `ovScale` handler exactly. */
export function scalePlacement(placement, ratio) {
  return { ...placement, ftPerPx: Math.max(0.0001, placement.ftPerPx * ratio) };
}

/** Rotate-handle drag: `rot0` is rotationDeg at grab, `deltaDeg` is the change in screen-pixel
 * angle (atan2, degrees) from grab to now. Mirrors the Site Planner's own `ovRotate` handler
 * exactly. */
export function rotatePlacement(placement, rot0, deltaDeg) {
  return { ...placement, rotationDeg: (((rot0 + deltaDeg) % 360) + 360) % 360 };
}
