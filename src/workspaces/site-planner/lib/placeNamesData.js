/* City-name data + selection rules — PURE, no Leaflet, no DOM (NEW-2, 2026-09-29).
 * Split from `placeNamesLayer.js` for the reason `adminBoundaryData.js` is split from its
 * layer: this half is plain numbers, so `test/placeNames.test.js` exercises it directly.
 *
 * Asset format (scripts/build-place-names.mjs): [name, lat*scale, lng*scale, minZoom*10],
 * sorted by minZoom then name. `minZoom` is the zoom at which the place earns a label —
 * Natural Earth's own cartographic value for its places (Houston 3, Baytown 7), 9/10 for the
 * US small-town tier. A place shows at every zoom >= its minZoom (until the layer's band ends).
 */

/* Small-town dataset (the ~870 KB tier) can only contribute at or above this zoom, so it is
 * not even fetched below it. The build script's tier-9 towns are the earliest. */
export const TOWNS_MIN_ZOOM = 9;

export function decodePlaces(doc) {
  const scale = doc && doc.scale ? doc.scale : 1000;
  return ((doc && doc.places) || []).map(([name, la, lo, mz]) => ({ name, lat: la / scale, lng: lo / scale, minZoom: mz / 10 }));
}

/* The places whose tier has been reached at this zoom. The label SET grows with zoom —
 * every place visible at z stays visible at z+1 — and big cities (low minZoom) come first.
 * Array order (importance) is preserved so the draw-time collision pass keeps the
 * important name and drops the smaller one. */
export function placesForZoom(places, zoom) {
  if (typeof zoom !== "number") return [];
  return places.filter((p) => p.minZoom <= zoom);
}

/* Opacity across the band: full through zoom 12, half at 13 (the last step before parcels
 * draw at 14 — the names recede as site work takes over), 0 outside the band. */
export function placeNamesOpacity(zoom) {
  if (typeof zoom !== "number" || zoom < 3 || zoom > 13) return 0;
  return zoom >= 13 ? 0.5 : 1;
}

/* Type size by tier: the biggest cities read as anchors, towns stay small. */
export function labelFont(minZoom) {
  if (minZoom <= 4) return { px: 14, weight: 700 };
  if (minZoom <= 7) return { px: 12.5, weight: 600 };
  return { px: 11.5, weight: 600 };
}

/* Greedy collision pass. `candidates` is in importance order and already projected:
 * [{ name, x, y, minZoom }]. `measure(name, font)` → text width in px (injected so this stays
 * DOM-free). A label is kept only if its box (with a small pad) overlaps no kept box; the
 * viewport [0,w]×[0,h] is the cull. Capped so a dense metro cannot turn into a wall of text. */
export function layoutLabels(candidates, measure, w, h, { pad = 3, max = 90 } = {}) {
  const kept = [];
  for (const c of candidates) {
    if (kept.length >= max) break;
    const font = labelFont(c.minZoom);
    const tw = measure(c.name, font);
    const box = { x0: c.x - tw / 2 - pad, x1: c.x + tw / 2 + pad, y0: c.y - font.px / 2 - pad, y1: c.y + font.px / 2 + pad };
    if (box.x1 < 0 || box.x0 > w || box.y1 < 0 || box.y0 > h) continue;
    if (kept.some((k) => box.x0 < k.box.x1 && box.x1 > k.box.x0 && box.y0 < k.box.y1 && box.y1 > k.box.y0)) continue;
    kept.push({ ...c, font, box });
  }
  return kept;
}
