/* aerialSnapshot — WHERE the stored map snapshot ("Aerial backdrop", `fromMap: true`) is drawn on a LOCATED plan (NEW-1, 2026-11-05, owner: "Zoning and Future Land Use
 * fills are cut out around the site on the site plan view").
 *
 * THE BUG. A plan captured from the Map keeps a picture of the aerial (the pinned `fromMap` overlay). With the live basemap on it stands down (the live tiles ARE the aerial).
 * With the Map Base set to Off, it was drawn as an SVG <image> INSIDE the planner canvas — which sits ABOVE the backdrop map, so every GIS AREA fill (Zoning, Future Land Use,
 * flood zones, districts …) was painted over by an opaque rectangle the size of the capture (about 1.8× the parcel on every side on the owner's Academy plan): the fills
 * "cut out around the site". The printed sheet was never wrong — `exportSheet.js` lays the snapshot BELOW the GIS overlay images (the model's order: basemap → GIS area fills →
 * references → plan); only the screen drifted (PDF-PARITY).
 *
 * THE RULE. The snapshot IS the aerial backdrop, so it belongs at the bottom of the stack, under the GIS area fills: on a located plan it is hosted in the backdrop MAP, in its own
 * pane below every GIS pane (`mapStack.PANE_SNAPSHOT`), and is never an SVG image. An unlocated plan has no backdrop map and no GIS layers, so it keeps drawing the snapshot in the canvas.
 *
 * Pure — no Leaflet, no React — unit-tested in test/aerialSnapshot.test.js. */
import { feetExtentToBbox } from "./arcgis.js";

/* Is this overlay a pinned map snapshot that the BACKDROP MAP (not the SVG canvas) must draw right now? Located plan, live basemap off, aerial not hidden. */
export function snapshotHostedInMap(o, { origin, basemapOn, showAerial } = {}) {
  return !!(o && o.fromMap === true && o.visible !== false && origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lon) && showAerial !== false && !basemapOn && typeof o.src === "string" && o.src);
}

/* Should the planner's SVG canvas draw this overlay? The pinned snapshot is never an SVG image on a located plan (the backdrop map draws it, or the live tiles replace it, or the aerial
 * is hidden); on an unlocated plan it is the only aerial there is, so the canvas draws it unless the aerial is hidden. A hand-dropped reference is not this module's business (true). */
export function snapshotDrawnInCanvas(o, { origin, showAerial } = {}) {
  if (!o || o.fromMap !== true) return true;
  if (showAerial === false) return false;
  return !origin;
}

/* Leaflet [[south, west], [north, east]] for the snapshot — the same feet → lat/lon round trip the tiles, the parcels and the print's aerial placement use, so it lands exactly where the
 * SVG image used to. A snapshot never rotates (`fromMap` is pinned), and its vertical scale may differ from its horizontal one (a Web Mercator capture: `ftPerPxY`). null when it has no usable size. */
export function snapshotBounds(o, origin) {
  if (!o || !origin) return null;
  const sy = Number.isFinite(o.ftPerPxY) && o.ftPerPxY > 0 ? o.ftPerPxY : o.ftPerPx;
  if (![o.x, o.y, o.imgW, o.imgH, o.ftPerPx, sy].every(Number.isFinite) || !(o.imgW > 0) || !(o.imgH > 0) || !(o.ftPerPx > 0) || !(sy > 0)) return null;
  const b = feetExtentToBbox({ minX: o.x, minY: o.y, maxX: o.x + o.imgW * o.ftPerPx, maxY: o.y + o.imgH * sy }, origin.lat, origin.lon);
  return [[b.latMin, b.lonMin], [b.latMax, b.lonMax]];
}
