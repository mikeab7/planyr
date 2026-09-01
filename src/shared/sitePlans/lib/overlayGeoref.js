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
 *
 * ⛔ B972512-HARDENING NEW-3 — THE PROJECTION IS ZONE-AWARE, NOT HARDCODED TO ONE ZONE. A site
 * plan is never placed in a Web Mercator pixel frame (that would be latitude-dependent in the
 * way the owner suspected); it is placed in real State Plane feet the whole way through — but
 * State Plane itself is only exact INSIDE the zone it was defined for, and `index.js` is
 * hardcoded to ONE zone (South Central, correct for Houston/Katy). Measured on a synthetic
 * Dallas placement (outside South Central, ~32.8°N — Dallas sits in a Texas North Central zone
 * this app has never modeled anywhere): the grid scale factor at that latitude, evaluated in
 * the South Central cone, is 1.00168 rather than 1 — a 500 ft distance draws as 498.67 ft, a
 * real but SMALL (~0.27%) distortion, not the owner's own worse "~4%, Mercator" estimate (the
 * placement math never touches Mercator at all). `resolveZone` below picks the CORRECT zone for
 * a placement's own anchor point when this app has one modeled — Texas South Central (unchanged,
 * proven bit-identical to `index.js`, `test/statePlane.test.js`) and Colorado North/Central
 * (correct, but never wired into this feature until now) — and falls back to the legacy
 * hardcoded projection, UNCHANGED from today, for anywhere neither zone covers (Dallas
 * included) rather than inventing an unverified new zone's survey constants from memory.
 */
import { projectToGrid, gridToProject } from "../../coordinates/index.js";
import { resolveZone, projectToZone, zoneToProject } from "../../coordinates/statePlane.js";

/** The projector pair to use for a placement anchored at (lat, lon): the resolved State Plane
 * zone's own math when this app has one modeled for that point, else the legacy hardcoded
 * (South Central) projection — UNCHANGED behavior for anywhere outside every modeled zone. */
function projectorsFor(lat, lon) {
  const zone = resolveZone({ lat, lon });
  if (!zone) return { toGrid: projectToGrid, toProject: gridToProject, zoneId: null };
  return { toGrid: (la, lo) => projectToZone(zone, la, lo), toProject: (xy) => zoneToProject(zone, xy), zoneId: zone.id };
}

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
  const { toGrid, toProject } = projectorsFor(placement.centerLat, placement.centerLon);
  const center = toGrid(placement.centerLat, placement.centerLon);
  const halfW = (imgW * placement.ftPerPx) / 2, halfH = (imgH * placement.ftPerPx) / 2;
  const at = (dx, dy) => {
    const { rx, ry } = rotatedOffset(dx, dy, placement.rotationDeg);
    // grid y is north-positive; a "down" (+y) image-local offset is south, so flip it going in.
    return toProject({ x: center.x + rx, y: center.y - ry });
  };
  return {
    topLeft: at(-halfW, -halfH), topRight: at(halfW, -halfH),
    bottomLeft: at(-halfW, halfH), bottomRight: at(halfW, halfH),
  };
}

/** Real-world {lat,lon} -> the image-pixel point it corresponds to under `placement` — the
 * inverse of the per-corner mapping `overlayCornersFromPlacement` uses. Used once, at PIN
 * CREATION time, to snapshot where on the plan the user actually clicked (`site_plan_point`) —
 * that snapshot, not the comp's lat/lon, is the SOURCE OF TRUTH from then on (see comps.js
 * `validAnchor`'s B972512-HARDENING item 2 writeup); lat/lon is a derived cache that
 * `imagePointToLatLon` below (this function's own inverse) re-derives from it every time the
 * placement changes. Null if the placement or image size isn't usable. */
export function latLonToImagePoint(placement, imgW, imgH, lat, lon) {
  if (!validPlacement(placement) || !(imgW > 0) || !(imgH > 0)) return null;
  const { toGrid } = projectorsFor(placement.centerLat, placement.centerLon);
  const center = toGrid(placement.centerLat, placement.centerLon);
  const p = toGrid(lat, lon);
  const rx = p.x - center.x, ry = -(p.y - center.y); // grid offset -> image-local (y-down) rotated frame
  // Invert the rotation: [dx,dy] = R(-rotationDeg) * [rx,ry].
  const { rx: dx, ry: dy } = rotatedOffset(rx, ry, -(placement.rotationDeg || 0));
  const halfW = (imgW * placement.ftPerPx) / 2, halfH = (imgH * placement.ftPerPx) / 2;
  return { x: (dx + halfW) / placement.ftPerPx, y: (dy + halfH) / placement.ftPerPx };
}

/** The image-pixel point (x, y) -> its real-world {lat,lon} under `placement` — the true
 * inverse of `latLonToImagePoint`, and the forward direction `overlayCornersFromPlacement`
 * uses internally for a corner. Exists so a comp's `lat`/`lon` (the authoritative, derived
 * cache — see B972512-HARDENING NEW-1/NEW-2) can be RECOMPUTED from its stored `site_plan_point`
 * (the plan-space source of truth) whenever the placement transform itself changes — dragging,
 * scaling, rotating, or Re-anchoring an overlay must never leave a pinned comp's map position
 * stale. Null if the placement or image size isn't usable. */
export function imagePointToLatLon(placement, imgW, imgH, x, y) {
  if (!validPlacement(placement) || !(imgW > 0) || !(imgH > 0)) return null;
  const { toGrid, toProject } = projectorsFor(placement.centerLat, placement.centerLon);
  const center = toGrid(placement.centerLat, placement.centerLon);
  const halfW = (imgW * placement.ftPerPx) / 2, halfH = (imgH * placement.ftPerPx) / 2;
  const dx = x * placement.ftPerPx - halfW, dy = y * placement.ftPerPx - halfH;
  const { rx, ry } = rotatedOffset(dx, dy, placement.rotationDeg);
  return toProject({ x: center.x + rx, y: center.y - ry });
}

/** Ground distance in feet between two lat/lon points, through the zone resolved for the FIRST
 * point (matches how a placement's own anchor picks its zone elsewhere in this file) — falls
 * back to the legacy hardcoded projection outside every modeled zone, same as everything else
 * here. Lets a caller (e.g. sizing a freshly placed overlay to the current map view) reuse the
 * same zone-aware math instead of duplicating a raw `projectToGrid` call. */
export function feetBetween(lat1, lon1, lat2, lon2) {
  const { toGrid } = projectorsFor(lat1, lon1);
  const a = toGrid(lat1, lon1), b = toGrid(lat2, lon2);
  return Math.hypot(b.x - a.x, b.y - a.y);
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
