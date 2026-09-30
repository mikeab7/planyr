/* activateFraming — what the view does when a Site Analysis layer is ACTIVATED (NEW-1).
 *
 * The owner's rule: turning a layer on must never zoom him OUT and never move a view that
 * already shows his site. It used to fit the parcels + a 60% margin on every enable, which on a
 * site he was already looking at always landed wider than where he was.
 *
 *   1. site already on screen          → the SAME view object (identity), nothing moves
 *   2. site entirely off screen        → pan only, centre it, scale untouched
 *   3. view too far out for the layer  → zoom IN just past its gate, about the visible centre
 *   scale never decreases, in any case.
 *
 * Pure: feet + view + size in, view out. No React, no Leaflet, so it is unit-testable.
 */

/* `box` = { minX, minY, maxX, maxY } in feet. `view` = { ppf, offX, offY } (screen = feet*ppf + off).
 * `size` = the VISIBLE canvas { w, h } (what is actually uncovered).
 * `minPpf` = optional ppf at which a scale-gated layer starts to draw (null = ungated). */
export function activateLayerView({ view, size, box, minPpf = null, maxPpf = 8 }) {
  if (!view || !size || !box || !(size.w > 1) || !(size.h > 1)) return view;
  const { ppf, offX, offY } = view;
  const sx0 = box.minX * ppf + offX, sx1 = box.maxX * ppf + offX;
  const sy0 = box.minY * ppf + offY, sy1 = box.maxY * ppf + offY;
  const intersects = sx1 > 0 && sx0 < size.w && sy1 > 0 && sy0 < size.h;

  // Zoom IN only, and only when the layer cannot draw at the current scale.
  let nextPpf = ppf;
  if (typeof minPpf === "number" && minPpf > ppf) nextPpf = Math.max(ppf, Math.min(minPpf, maxPpf));
  if (nextPpf === ppf && intersects) return view;                       // (1) do nothing

  const cxF = (box.minX + box.maxX) / 2, cyF = (box.minY + box.maxY) / 2;
  if (nextPpf === ppf) {                                                // (2) pan only
    return { ppf, offX: size.w / 2 - cxF * ppf, offY: size.h / 2 - cyF * ppf };
  }
  // (3) zoom in about the canvas centre so the ground under the owner's eye stays put; if the
  // site was off screen it is brought to the centre instead.
  if (!intersects) return { ppf: nextPpf, offX: size.w / 2 - cxF * nextPpf, offY: size.h / 2 - cyF * nextPpf };
  const k = nextPpf / ppf, cx = size.w / 2, cy = size.h / 2;
  return { ppf: nextPpf, offX: cx - (cx - offX) * k, offY: cy - (cy - offY) * k };
}

/* Bounding box (feet) of the active parcels' rings, or null. */
export function activeParcelBox(parcels) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
  (parcels || []).forEach((pc) => {
    if (pc.active === false || (pc.points?.length || 0) < 3) return;
    pc.points.forEach((p) => { n++; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
  });
  return n ? { minX, minY, maxX, maxY } : null;
}
