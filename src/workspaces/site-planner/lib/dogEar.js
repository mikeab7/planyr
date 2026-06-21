/* Corner bump-out ("dog-ear") geometry (B357).
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
