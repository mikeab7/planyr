/* cropChrome — pure screen-space geometry for the crop tool's own drawing (ImageCropTool.jsx).
 *
 * WHY THIS EXISTS (B2448816, owner 2026-10-29: "if I zoomed in too much, then the crop expanded outside of the box to
 * where I couldn't even hit the polygon button"). The crop outline, its move surface and its grips are positioned from
 * the picture's current view, so zoomed in on a near-full-sheet crop they land far outside the drawing area. The chrome
 * layer was deliberately unclipped (a grip on the crop's edge must not lose half its grab area), so that oversized move
 * surface painted over — and took the clicks of — the Rectangle | Polygon switch, Cancel / Done and the floating
 * toolbar.
 *
 * THE RULE: nothing the crop draws may EXIST outside the drawing area, not merely be hidden there. Clipping with
 * `overflow: hidden` alone is not enough — it stops the paint and the clicks, but the element's own box still reaches
 * past the canvas (and a check that reads boxes sees a ghost). So every piece of chrome is computed here already
 * restricted to the drawing area [0, w] × [0, h], and a grip whose point is on screen is kept fully INSIDE it so it
 * never loses half its grab area at the edge — the reason the layer used to be left unclipped.
 *
 * All functions are pure, take screen px, and return null when the thing is not on screen. */

/** The part of a screen rect that lies inside the drawing area, plus which of its four sides are really on screen
 *  (a side that was clipped away is not drawn — the outline simply runs off the edge). Null when none of it shows. */
export function visibleRect(x, y, w, h, viewW, viewH) {
  const x0 = Math.max(x, 0), y0 = Math.max(y, 0), x1 = Math.min(x + w, viewW), y1 = Math.min(y + h, viewH);
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return {
    x: x0, y: y0, w: x1 - x0, h: y1 - y0,
    left: x >= 0 && x <= viewW, right: x + w >= 0 && x + w <= viewW,
    top: y >= 0 && y <= viewH, bottom: y + h >= 0 && y + h <= viewH,
  };
}

/** Where a grip (a box of gw × gh centred on a screen point) is drawn. Null when the point itself is off screen — an
 *  off-screen corner or edge shows no grip until it is panned to. When the point is on screen but within half a grip of
 *  the drawing area's edge, the box slides inward so it is wholly visible and fully grabbable. */
export function gripBox(cx, cy, gw, gh, viewW, viewH) {
  if (!(cx >= 0 && cx <= viewW && cy >= 0 && cy <= viewH)) return null;
  const left = Math.min(Math.max(cx - gw / 2, 0), Math.max(0, viewW - gw));
  const top = Math.min(Math.max(cy - gh / 2, 0), Math.max(0, viewH - gh));
  return { left, top };
}

/** Same rule for a round handle (a polygon vertex): the centre, slid inward by the radius. Null when off screen. */
export function dotCenter(cx, cy, r, viewW, viewH) {
  if (!(cx >= 0 && cx <= viewW && cy >= 0 && cy <= viewH)) return null;
  return { x: Math.min(Math.max(cx, r), Math.max(r, viewW - r)), y: Math.min(Math.max(cy, r), Math.max(r, viewH - r)) };
}

/** A segment clipped to the drawing area (Liang–Barsky). Null when no part of it is on screen. */
export function clipSegment(x1, y1, x2, y2, viewW, viewH) {
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1, viewW - x1, y1, viewH - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return { x1: x1 + t0 * dx, y1: y1 + t0 * dy, x2: x1 + t1 * dx, y2: y1 + t1 * dy };
}
