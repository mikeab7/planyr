/* hatchAnchor — pin every canvas hatch to the GROUND, never to the canvas's own corner (NEW-1).
 *
 * Owner report, 2026-10-08, dragging the docked left panel on Goose Creek / Phase II: "you can tell that
 * the hatches change as you pull the screen over. I don't really think there's a real need for that."
 *
 * WHY THEY MOVED. Every planner hatch is an SVG `<pattern patternUnits="userSpaceOnUse">`, so its tile
 * lattice starts at (0,0) of the user space of the element that REFERENCES it — the planner's anchor
 * group, whose origin is the canvas's own top-left corner. Dragging the panel moves that corner by the
 * drag, and the pan compensation (B837) moves the drawing back by exactly the same amount, so every
 * edge stays put on screen — but the stripe lattice, tied to the corner, slid by the drag (mod one
 * tile). Measured in pixels at 100% scaling: the hatched trailer strips and sidewalk dots were the
 * ONLY pixels in the drawing layer that changed on a drag step. The same lattice also re-phased on the
 * commit after every pan (the corner does not move, but the ground under it does).
 *
 * THE RULE. Translate the pattern so its lattice passes through the screen position of the site's
 * own feet origin, i.e. the render view's offset. That point is a fixed piece of ground, so the
 * stripes travel with the ground under every view change that keeps the scale: a panel drag, a panel
 * open/close, a window resize, a pan. A zoom still re-lays them (the tile is a constant screen size by
 * design — shared/style/hatchPatterns.js — so a zoom cannot keep both the spacing and the phase); it
 * re-lays them around that same ground point, consistently.
 *
 * Composition order is translate → rotate → scale: the rotation and the export-sheet `labelK` scale
 * (B794960) both act about the anchored lattice origin, which is what keeps the sheet's physical tile
 * size unchanged. A non-finite anchor is ignored (the old behaviour) rather than poisoning the
 * attribute with NaN — a hatch at the wrong phase is cosmetic, an invalid transform drops the fill.
 */

/** The `patternTransform` for a hatch tile anchored at `anchor` (screen px in the referencing user
 *  space), rotated `rotate` degrees and scaled `scale`. `undefined` when it would be the identity. */
export function hatchPatternTransform({ rotate = 0, scale = 1, anchor = null } = {}) {
  const parts = [];
  const ax = anchor && Number.isFinite(anchor.x) ? anchor.x : 0;
  const ay = anchor && Number.isFinite(anchor.y) ? anchor.y : 0;
  if (ax || ay) parts.push(`translate(${ax} ${ay})`);
  if (rotate) parts.push(`rotate(${rotate})`);
  if (Number.isFinite(scale) && scale !== 1) parts.push(`scale(${scale})`);
  return parts.length ? parts.join(" ") : undefined;
}

/** Where the site's feet origin lands in the render frame — the ground point every hatch is pinned to.
 *  `renderView` is the `{ ppf, offX, offY }` the geometry is emitted at (`worldToScreen` of (0,0)). */
export function hatchAnchorFor(renderView, dpr = 1) {
  if (!renderView) return null;
  const x = renderView.offX, y = renderView.offY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // Rounded to whole DEVICE px (≤ half a device pixel off the true ground point — invisible): a pattern placed at a
  // fractional device offset is re-sampled, and on a scaled display that re-sample differed by a shade or two from
  // one drag step to the next. Whole device px keep the tile on the grid, so the stripes are byte-identical.
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return { x: Math.round(x * d) / d, y: Math.round(y * d) / d };
}
