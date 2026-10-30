/* Where a pad-corner spot tag ("fill 22.1" / "cut 9.1") sits — owner 2026-10-30 (B2571041, then NEW-5 the same day).
 *
 * THE RULE, by construction: a corner tag lies ENTIRELY INSIDE the building's footprint, as near its corner as it fits, with a thin leader + dot
 * tying it to the exact corner point when it has had to move off it. Every edit button lies OUTSIDE the footprint (lib/buildingButtons.js: one row
 * along each wall, offset into the court). A tag inside every wall's half-plane and a button outside one of them cannot intersect, at any zoom, in
 * any state (selected, hovered, nothing selected) — so nothing here depends on which buttons are drawn, and no tag ever has to dodge one.
 *
 * (The first cut of B2571041 slid the tag along the wall clear of buttons that sat INSIDE the footprint; the owner's live check then found the new
 * grey ramp buttons on the very spot the tags moved to — "the overlap moved, it didn't go away". Dodging is the wrong shape; separating the two
 * sides of the wall is the right one.)
 *
 * Pure, screen px. The tag layer is `pointer-events: none` (GradingCanvas's root), so a tag never takes a press from anything underneath it.
 */
export const CORNER_TAG_PILL_H = 17;
const TAG_MARGIN_PX = 2;            // air kept between the tag's box and the wall line
const STEP_PX = 2;
const LEADER_MIN_PX = 8;            // a tag whose box is within this of its corner needs no leader
const USUAL_INSET_PX = 26;          // the long-standing spot: a little way in from the corner, toward the centre

/** Pill width for a tag's text — the ONE formula the canvas pill (`Pill2`) draws with. */
export const pillWidth = (text, size = 11) => Math.max(22, String(text).length * (size * 0.6) + 10);

const centroid = (quad) => ({ x: quad.reduce((s, p) => s + p.x, 0) / quad.length, y: quad.reduce((s, p) => s + p.y, 0) / quad.length });

/** Is the whole box {x,y,w,h} (x,y = centre) inside the convex quad, with `margin` px to spare from every wall line? */
export function boxInsideQuad(box, quad, margin = 0) {
  const c = centroid(quad);
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({ x: box.x + (sx * box.w) / 2, y: box.y + (sy * box.h) / 2 }));
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i], b = quad[(i + 1) % quad.length], ex = b.x - a.x, ey = b.y - a.y, L = Math.hypot(ex, ey) || 1;
    let nx = -ey / L, ny = ex / L;
    if (nx * (c.x - a.x) + ny * (c.y - a.y) < 0) { nx = -nx; ny = -ny; }          // inward normal
    for (const p of pts) if (nx * (p.x - a.x) + ny * (p.y - a.y) < margin) return false;
  }
  return true;
}

/**
 * @param {{x:number,y:number}[]} quad the pad's four corners in screen px (ring order)
 * @param {number} idx which corner this tag is for
 * @param {string} text the tag's words
 * @returns {{x:number,y:number,leader:null|{x1:number,y1:number,x2:number,y2:number}, w:number, h:number, inside:boolean}} the tag's centre and
 *   box size, the leader tying a tag that sits away from its corner to the EXACT corner point (null where the tag is at the corner), and whether the
 *   box lies wholly inside the footprint (false only for a building too small on screen to hold the tag at all — which is not labelled that small)
 */
export function placeCornerTag(quad, idx, text) {
  const P = quad[idx], w = pillWidth(text), h = CORNER_TAG_PILL_H;
  const C = centroid(quad);
  const toC = { x: C.x - P.x, y: C.y - P.y }, d = Math.hypot(toC.x, toC.y) || 1, u = { x: toC.x / d, y: toC.y / d };
  const lead = (c) => {
    const nx = Math.max(c.x - w / 2, Math.min(P.x, c.x + w / 2)), ny = Math.max(c.y - h / 2, Math.min(P.y, c.y + h / 2));
    return Math.hypot(P.x - nx, P.y - ny) > LEADER_MIN_PX ? { x1: P.x, y1: P.y, x2: c.x, y2: c.y } : null;
  };
  // from the long-standing spot, walk toward the centre until the whole box is inside; the first spot that fits is the nearest the corner it can be
  for (let s = Math.min(USUAL_INSET_PX, d * 0.3); s <= d; s += STEP_PX) {
    const c = { x: P.x + u.x * s, y: P.y + u.y * s };
    if (boxInsideQuad({ x: c.x, y: c.y, w, h }, quad, TAG_MARGIN_PX)) return { x: c.x, y: c.y, leader: lead(c), w, h, inside: true };
  }
  // too small to hold it: the building's centre, the one place that is as far from every wall as it gets
  return { x: C.x, y: C.y, leader: lead(C), w, h, inside: boxInsideQuad({ x: C.x, y: C.y, w, h }, quad, 0) };
}
