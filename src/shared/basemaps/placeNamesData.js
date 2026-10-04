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

/* A place's identity across frames — name plus its exact coordinates (the same name can sit in
 * several states). Used to remember which labels are showing (hysteresis) and to fade them. */
export const placeKey = (p) => `${p.name}|${p.lat}|${p.lng}`;

/* Priority order for the collision pass — TOTAL and independent of input order (NEW-1 amend,
 * 2026-09-29). Tier first (lower minZoom = bigger place), then a label already showing beats a
 * newcomer of the same tier, then name and coordinates so ties never depend on array order. The
 * datasets carry no population, so tier is the importance signal and name is the tie-break. */
function byPriority(isHeld) {
  return (a, b) => {
    if (a.minZoom !== b.minZoom) return a.minZoom - b.minZoom;
    const ha = isHeld(a) ? 0 : 1, hb = isHeld(b) ? 0 : 1;
    if (ha !== hb) return ha - hb;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    const la = a.lat ?? 0, lb = b.lat ?? 0; if (la !== lb) return la - lb;
    const oa = a.lng ?? 0, ob = b.lng ?? 0; if (oa !== ob) return oa - ob;
    return (a.x - b.x) || (a.y - b.y) || 0;
  };
}

/* Greedy collision pass. `candidates` are projected: [{ name, x, y, minZoom, lat?, lng?, key? }] in
 * ANY order — the pass sorts them by importance itself. `measure(name, font)` → text width in px
 * (injected so this stays DOM-free). A label is kept only if its box overlaps no kept box; the
 * viewport [0,w]×[0,h] is the cull. Capped so a dense metro cannot turn into a wall of text.
 *
 * HYSTERESIS: `held` is the set of keys already on screen. A held label is boxed with a smaller
 * pad, so it survives the edge of a collision that a newcomer would lose — a name does not flicker
 * out because a neighbour drifted a pixel. Importance still wins: a held small town yields to a
 * bigger city, and among same-tier equals the held one is placed first. */
export function layoutLabels(candidates, measure, w, h, { pad = 3, max = 90, held = null } = {}) {
  const heldKey = (c) => !!held && held.has(c.key ?? placeKey(c));
  const kept = [];
  for (const c of candidates.slice().sort(byPriority(heldKey))) {
    if (kept.length >= max) break;
    const font = labelFont(c.minZoom);
    const tw = measure(c.name, font);
    const p = heldKey(c) ? Math.min(pad, 1) : pad;
    const box = { x0: c.x - tw / 2 - p, x1: c.x + tw / 2 + p, y0: c.y - font.px / 2 - p, y1: c.y + font.px / 2 + p };
    if (box.x1 < 0 || box.x0 > w || box.y1 < 0 || box.y0 > h) continue;
    if (kept.some((k) => box.x0 < k.box.x1 && box.x1 > k.box.x0 && box.y0 < k.box.y1 && box.y1 > k.box.y0)) continue;
    kept.push({ ...c, font, box });
  }
  return kept;
}

/* ── Zoom animation + fade (NEW-1 amend, 2026-09-29) ──────────────────────────────────────────
 * Leaflet animates the imagery with a CSS transition — 0.25 s, cubic-bezier(0,0,.25,1) — on a
 * translate+scale transform, then fires zoomend. CSS interpolates the transform's components
 * linearly in eased time, so any ground point's screen position is exactly
 * lerp(position-in-the-start-view, position-in-the-end-view, ease(t)). Drawing labels at that
 * lerp pins them to the ground for the whole animation while the text itself is never scaled. */
export const ZOOM_ANIM_MS = 250;
export const FADE_MS = 160;

export function zoomEase(u) {
  if (!(u > 0)) return 0;
  if (u >= 1) return 1;
  const X = (t) => 3 * (1 - t) * t * t * 0.25 + t * t * t;   // x(t) of cubic-bezier(0,0,.25,1)
  const Y = (t) => 3 * (1 - t) * t * t + t * t * t;          // y(t)
  let lo = 0, hi = 1;
  for (let i = 0; i < 32; i++) { const m = (lo + hi) / 2; if (X(m) < u) lo = m; else hi = m; }
  return Y((lo + hi) / 2);
}

export const lerpPoint = (a, b, p) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p });

/* Move `cur` toward `target` by dtMs at a fixed rate (full 0→1 in FADE_MS). */
export function stepScalar(cur, target, dtMs) {
  const d = Math.max(0, dtMs) / FADE_MS;
  return target > cur ? Math.min(target, cur + d) : Math.max(target, cur - d);
}

/* One fade tick over the tracked labels ({ a: 0..1 } per key): wanted ones rise, the rest fall and
 * are dropped once invisible. Returns true while anything is still mid-fade (keep animating). */
export function stepFade(tracked, wantedKeys, dtMs) {
  let busy = false;
  for (const [k, e] of tracked) {
    const target = wantedKeys.has(k) ? 1 : 0;
    e.a = stepScalar(e.a, target, dtMs);
    if (e.a <= 0 && target === 0) { tracked.delete(k); continue; }
    if (e.a !== target) busy = true;
  }
  return busy;
}
