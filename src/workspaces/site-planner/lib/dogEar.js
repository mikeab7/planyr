/* Corner bump-out ("dog-ear") geometry (B362).
 *
 * A dog-ear is a building element flush at the END of a dock wall that projects out into the
 * truck court, taking that span out of dock use. It stores its corner (`side` = top/bottom/
 * left/right, `sign` = ±1 along the wall) and — once the user has resized it — its span ALONG
 * the dock wall plus its PROJECTION out from the dock face (`along`/`proj`). Absent → the
 * 55′×60′ default.
 *
 * Kept pure + framework-free (its own rot2 / SIDE_N, matching dockZones.js) so the
 * resize-survives-a-host-refit contract is unit-testable; SitePlanner wires it in.
 */
export const DOGEAR_W = 55; // default span along the dock wall
export const DOGEAR_D = 60; // default projection out from the dock face

const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const rot2 = (x, y, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};

// Box geometry (centre, w/h, rot) of dog-ear `de` on building box `bx` ({cx,cy,w,h,rot}).
// The outer edge sits flush with the building corner (inset half its along-span) and it
// projects `proj` out past the dock face. The along-span is CLAMPED to the wall — never reset
// (so a host that shrinks past the corner pulls the bump in, but its stored size is preserved
// and springs back when the host grows again).
export function dogEarGeom(bx, de) {
  const { side, sign } = de;
  const [nx, ny] = SIDE_N[side];
  const alongIsX = ny !== 0; // horizontal (top/bottom) dock wall → corners spread along X
  const wallLen = alongIsX ? bx.w : bx.h;
  const along = Math.max(1, Math.min(de.along ?? DOGEAR_W, wallLen));
  const proj = Math.max(1, de.proj ?? DOGEAR_D);
  const w = alongIsX ? along : proj;
  const h = alongIsX ? proj : along;
  const lx = alongIsX ? sign * (bx.w / 2 - along / 2) : nx * (bx.w / 2 + proj / 2);
  const ly = alongIsX ? ny * (bx.h / 2 + proj / 2) : sign * (bx.h / 2 - along / 2);
  const off = rot2(lx, ly, bx.rot || 0);
  return { cx: bx.cx + off.x, cy: bx.cy + off.y, w, h, rot: ((((bx.rot || 0) % 360) + 360) % 360) };
}

// The along-wall span + outward projection of a dog-ear's BOX (w/h), resolved by which wall it
// hugs — the inverse of the w/h packing in dogEarGeom. Used to remember a user resize.
export const dogEarSize = (de, w, h) => (SIDE_N[de.side][1] !== 0 ? { along: w, proj: h } : { along: h, proj: w });

// Which perpendicular wall a corner bump-out lengthens (B492). A bump at the END of a dock wall
// projects out past the dock face, so it extends the building's PERPENDICULAR wall by its
// projection — and a sidewalk on that wall should span the full extended side. Shared with
// SitePlanner so the canvas + the geometry never disagree.
export function bumpSidewalkSide(side, sign) {
  const horiz = side === "top" || side === "bottom"; // dock wall runs along X
  return horiz ? (sign < 0 ? "left" : "right") : (sign < 0 ? "top" : "bottom");
}

// The full run (length along the wall) + along-axis centre shift of a sidewalk on `swSide` of
// building box `b`, once the corner bump-outs that lengthen that wall are folded in (B492). `bumps`
// is the building's dog-ears as [{side, sign, proj}] (proj = the bump's projection out from its dock
// face). Returns {run, alongShift} in building-LOCAL feet: alongShift is +X for a top/bottom strip,
// +Y for a left/right strip. PURE so the full-side span is unit-testable apart from the canvas.
export function sidewalkSpanForBumps(b, swSide, bumps = []) {
  const isVert = swSide === "left" || swSide === "right"; // run is along local Y
  const base = isVert ? b.h : b.w;
  let extNeg = 0, extPos = 0;                              // extension at the −axis / +axis ends
  bumps.forEach((bp) => {
    if (bumpSidewalkSide(bp.side, bp.sign) !== swSide) return;
    const endSign = SIDE_N[bp.side][isVert ? 1 : 0];       // bump dock-side normal along the run axis
    if (endSign < 0) extNeg += Math.max(0, bp.proj || 0);
    else extPos += Math.max(0, bp.proj || 0);
  });
  return { run: base + extNeg + extPos, alongShift: (extPos - extNeg) / 2 };
}
