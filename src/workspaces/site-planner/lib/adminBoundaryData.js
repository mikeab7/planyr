/* The wide-zoom boundary asset's DECODER — pure, no Leaflet, no DOM (NEW-1).
 *
 * Split out of `adminBoundaryLayer.js` for the same reason `contourTrace.js` is split out
 * of `contours.js`: the moment a module imports Leaflet it needs a `window`, and then the
 * arithmetic inside it can only be tested through a browser. This half is plain numbers,
 * so `test/adminBoundaries.test.js` exercises it directly.
 *
 * Both functions are the exact inverse of `encodeRing` in
 * `scripts/build-admin-boundaries.mjs` — a flat array of delta integers in 1/`scale`
 * degrees, first point absolute. Change one and you change both.
 */

/* The INNER half of the zoom band (the outer edge is `ADMIN_BOUNDARY_MAX_ZOOM` in
 * `adminBoundaryGate.js`, which is all the boot path needs). State / province outlines
 * join the countries only from zoom 5: below that the whole United States is a couple of
 * hundred pixels across and fifty state outlines read as mush, so the coarser level
 * carries the view alone. Pure, and deliberately on this side of the split so the rule
 * costs the Site route nothing. */
export const ADMIN1_MIN_ZOOM = 5;

/* Which levels belong on screen at this zoom. A non-number zoom (the map has not reported
 * one yet) reads as nothing, never as zoom 0. */
export function adminBoundaryLevels(zoom, maxZoom) {
  const country = typeof zoom === "number" && zoom <= maxZoom;
  return { country, admin1: country && zoom >= ADMIN1_MIN_ZOOM };
}

/* [x0, y0, dx1, dy1, …] → [[lat, lng], …]. Note the swap: the asset stores lng/lat (the
 * GeoJSON axis order it was generated from), Leaflet wants lat/lng. */
export function decodeRing(flat, scale) {
  const out = [];
  let x = flat[0], y = flat[1];
  out.push([y / scale, x / scale]);
  for (let i = 2; i < flat.length; i += 2) {
    x += flat[i]; y += flat[i + 1];
    out.push([y / scale, x / scale]);
  }
  return out;
}

/* The whole asset → { country: [[latlng, …], …], admin1: [...] }. A document with no
 * declared scale falls back to the format's 1000, rather than producing NaN coordinates
 * that would draw nothing and say nothing. */
export function decodeAsset(doc) {
  const scale = doc && doc.scale ? doc.scale : 1000;
  const levels = (doc && doc.levels) || {};
  const out = {};
  for (const [level, rings] of Object.entries(levels)) out[level] = rings.map((r) => decodeRing(r, scale));
  return out;
}
