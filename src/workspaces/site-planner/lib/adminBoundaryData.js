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

/* The INNER edges of the zoom band (the outer edge is `ADMIN_BOUNDARY_MAX_ZOOM` in
 * `adminBoundaryGate.js`, which is all the boot path needs).
 *  - State outlines join the countries only from zoom 5: below that the whole United States
 *    is a couple of hundred pixels across and fifty outlines read as mush.
 *  - Country outlines stop at COUNTRY_MAX_ZOOM (7): inside one country they add nothing.
 *  - From ADMIN1_DETAIL_MIN_ZOOM (8) the state lines come from the finer 1:10m asset
 *    (`public/geo/admin1-detail.json`) — the 1:110m one is only honest while a pixel spans
 *    more than a kilometre.
 * Pure, and deliberately on this side of the split so the rule costs the Site route nothing. */
export const ADMIN1_MIN_ZOOM = 5;
export const COUNTRY_MAX_ZOOM = 7;
export const ADMIN1_DETAIL_MIN_ZOOM = 8;

/* Which levels belong on screen at this zoom. `maxZoom` is the band's outer edge. A
 * non-number zoom (the map has not reported one yet) reads as nothing, never as zoom 0.
 * `detail` says the state lines should come from the fine asset rather than the coarse one. */
export function adminBoundaryLevels(zoom, maxZoom) {
  const inBand = typeof zoom === "number" && zoom <= maxZoom;
  const admin1 = inBand && zoom >= ADMIN1_MIN_ZOOM;
  return { country: inBand && zoom <= COUNTRY_MAX_ZOOM, admin1, detail: admin1 && zoom >= ADMIN1_DETAIL_MIN_ZOOM };
}

/* Line style per zoom. At the wide zooms the original casing+hairline is right. At the
 * closer zooms (a state line now shares the screen with roads, town names and, near the top
 * of the band, the edge of parcel work) it steps back further — thinner and fainter — so it
 * stays reference context, the same "reference recedes" rule as the Layers panel. Pure so
 * the ramp is unit-tested rather than eyeballed. */
export function admin1Style(zoom) {
  if (typeof zoom === "number" && zoom >= 10) {
    return { casing: { color: "#000", weight: 1.8, opacity: 0.12 }, line: { color: "#fff", weight: 0.8, opacity: 0.24 } };
  }
  if (typeof zoom === "number" && zoom >= ADMIN1_DETAIL_MIN_ZOOM) {
    return { casing: { color: "#000", weight: 2.0, opacity: 0.17 }, line: { color: "#fff", weight: 0.85, opacity: 0.32 } };
  }
  return { casing: { color: "#000", weight: 2.2, opacity: 0.22 }, line: { color: "#fff", weight: 0.9, opacity: 0.38 } };
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
