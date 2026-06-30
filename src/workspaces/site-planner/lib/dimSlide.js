/* Footprint dimension-callout slide constraint (B590).
 *
 * The red footprint dimension (a building's depth, a road's travel width, a paving strip's short
 * side — rendered in renderElPx) is grab-and-drag to reposition (B146, stored as a local-feet
 * `dimOffset` on the element). Free 2-D dragging let it fly clean OFF the shape, which the owner
 * never wanted: the dimension should STAY ON the shape and only slide ALONG its long (length)
 * axis. And for a building it must never slide onto a corner bump-out ("dog-ear"), where the real
 * depth changes — so the printed value (e.g. "620′") would no longer be true at that position.
 *
 * This module is the pure geometry of that constraint: which local axis the line slides along,
 * which one is pinned to zero, and the [min,max] band the along-offset is clamped to. PURE +
 * framework-free so the canvas drag handler (startDimMove/dimMove) and the renderer (renderElPx)
 * share ONE source of truth and the math is unit-testable apart from React/SVG.
 *
 * Frame: element-LOCAL feet, measured from the box centre (the offset is already de-rotated by
 * the drag handler, so a rotated building is handled with no extra work). The slide axis is the
 * LONG axis — matching renderElPx's `horizLong = w >= h` exactly (the dock, and therefore every
 * bump-out, always rides the long walls, so the depth dimension always slides along the length).
 */

// Default fraction of the length the line sits at when its offset is zero. MUST match renderElPx:
// 0.18 for a building/paving strip (tucked toward one end, clear of the centred name label), 0.5
// for a road (centred on its run). Exported so the renderer and the tests can't drift from it.
export const DIM_POS_F_DEFAULT = 0.18;
export const DIM_POS_F_ROAD = 0.5;

// The slide constraint for one element's dimension callout.
//   el    — the element ({ w, h } in feet; rotation is irrelevant here, the offset is local).
//   bumps — its corner bump-outs as [{ sign:±1, along:ft }], each `along` already measured along
//           the length axis (dogEarSize().along). [] for roads/paving (no bump-outs).
//   posF  — the default-position fraction (see DIM_POS_F_* above).
// Returns { axis, lock, min, max, L, endNeg, endPos }:
//   axis  — local offset component that slides ("x" for a long-horizontal element, else "y").
//   lock  — the perpendicular component, which is pinned to 0 (keeps the line ON the shape).
//   min/max — clamp band for the along-offset, in local feet.
export function dimSlideRange(el, bumps = [], posF = DIM_POS_F_DEFAULT) {
  const w = Math.abs(el?.w ?? 0), h = Math.abs(el?.h ?? 0);
  const horizLong = w >= h;
  const axis = horizLong ? "x" : "y"; // slide along the LONG axis
  const lock = horizLong ? "y" : "x"; // depth axis — pinned to 0 so the line never leaves the shape
  const L = horizLong ? w : h;        // length (the long span), feet
  // A bump-out at a corner takes its along-span out of the valid band at that END of the length:
  // sign −1 hugs the −axis end, +1 the +axis end. Two bumps at one end overlap → the larger wins.
  let endNeg = 0, endPos = 0;
  for (const b of bumps) {
    const a = Math.max(0, b?.along || 0);
    if ((b?.sign ?? 0) < 0) endNeg = Math.max(endNeg, a);
    else endPos = Math.max(endPos, a);
  }
  // The rendered line's length-coordinate is L*(posF-0.5) + offset; keep that within the clear band
  // [-L/2 + endNeg, L/2 - endPos] (inside the footprint, off the bumps) → solve for the offset:
  let min = endNeg - L * posF;
  let max = L * (1 - posF) - endPos;
  if (min > max) {
    // Bumps eat the whole length (pathological — only with absurdly large bump-outs). No valid
    // band, so pin to the midpoint of what's left rather than invert the clamp.
    const mid = (min + max) / 2;
    min = mid;
    max = mid;
  }
  return { axis, lock, min, max, L, endNeg, endPos };
}

// Clamp a stored dimOffset to a slide range: the along-axis component into [min,max], the
// perpendicular component forced to 0. Returns a fresh { x, y } (feet). Safe on null/partial input.
export function clampDimOffset(off, range) {
  const raw = (off && typeof off[range.axis] === "number") ? off[range.axis] : 0;
  const along = Math.max(range.min, Math.min(range.max, raw));
  return range.axis === "x" ? { x: along, y: 0 } : { x: 0, y: along };
}
