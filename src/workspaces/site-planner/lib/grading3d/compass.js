/* The 3D viewer's CARDINAL DIRECTIONS (owner-only grading layer; B2671226, NEW-1 2026-11-11, amends B2671220). PURE — no three.js, so the heading is a test on numbers.
 *
 * WHICH WAY IS NORTH. The viewer's world is the plan's own frame: X east, Z = plan y, which runs SOUTH (the SVG convention the planner keeps), Y up. The
 * 2D planner never rotates its sheet — `sheetFurniture.northArrowPlate` is always handed `bearingDeg = 0` — so plan "up" IS true north and world −Z is north
 * here. No rotation is applied, because the map itself is never rotated.
 *
 * THE HEADING. `orbit.js` puts the camera at azimuth `az` around the target: az 0 = standing south of the site looking north, and positive az swings the
 * camera toward the east (x = sin az, z = cos az). The camera's screen-right on the ground is (cos az, −sin az) and its screen-up on the ground is
 * (−sin az, −cos az), so the north vector (0, −1) lands at screen-right = sin az, screen-up = cos az — i.e. north is drawn `az` CLOCKWISE from the top of the
 * screen. East is a quarter turn further on, and so on round the rose. Tilt (elevation) is not part of it: like every map compass, the rose reports the
 * heading you are facing, and the "N" standing on the ground beside the model (below) shows the tilted truth on the model itself. */

const DEG = 180 / Math.PI;
const wrap360 = (d) => { const m = d % 360; return m < 0 ? m + 360 : m; };

/* Degrees clockwise from the top of the screen at which NORTH is drawn, for a camera azimuth in radians. 0 = north is straight up. */
export function northHeadingDeg(az) { return wrap360((Number.isFinite(az) ? az : 0) * DEG); }

/* The four letters' headings, same convention. N at the north heading, E a quarter turn clockwise of it, S opposite, W three quarters. */
export function cardinalHeadings(az) {
  const n = northHeadingDeg(az);
  return { N: n, E: wrap360(n + 90), S: wrap360(n + 180), W: wrap360(n + 270) };
}

/* A heading → the offset of a point on a circle of radius r around the rose's centre, in screen pixels (y grows downward). 0° = straight up, 90° = right. */
export function headingToOffset(headingDeg, r) {
  const a = headingDeg / DEG;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}

/* Where the "N" stands. `bounds` is `orbit.boundsOf(...)` (world units, Y already stretched): the sign sits just OFF the model's north edge (min Z), centred
 * east-west, at the level of the model's TOP (max Y) — not on the base plane. On the base plane the block is between the camera and the sign, so at the opening
 * angle the sign painted OVER the cut / fill (seen on the owner's Chehaw ground); at the top level it stands in the void beyond the edge and covers nothing.
 * Its size follows the model, never the Height stretch's vertical inflation, so it is the same legible size at 1× and at 5×.
 *   sprite: the standing "N" (centre) · arrow: a flat triangle at that level pointing north (tip first) · reach / reachUp: how far past the north edge / above the top it reaches. */
export const MARKER_SIZE_K = 0.13;     // sign size as a share of the model's bounding radius
export function northMarkerSpec(bounds) {
  const size = Math.max(8, bounds.radius * MARKER_SIZE_K);
  const y = bounds.maxY;
  const edge = bounds.minZ;
  const arrow = {
    tip: { x: bounds.cx, y, z: edge - size * 0.85 },
    left: { x: bounds.cx - size * 0.4, y, z: edge - size * 0.15 },
    right: { x: bounds.cx + size * 0.4, y, z: edge - size * 0.15 },
  };
  const sprite = { x: bounds.cx, y: y + size * 0.6, z: edge - size * 1.35, size };
  return { size, arrow, sprite, reach: size * 1.9, reachUp: size * 1.15 };
}

/* FRAMING. Reset view and the first view are framed on the MODEL exactly as before (same target, same angle — the sign must not shift the picture), and the
 * camera is only pulled back, if at all, when the sign would fall outside the bounding sphere the framing already fits. 1 = the sign is inside it (the usual
 * case: the sphere is the model's half-diagonal, well past its north edge); > 1 = multiply the camera distance by this. Pure. */
export function markerFramingFactor(bounds, spec) {
  const dz = bounds.cz - (bounds.minZ - spec.reach);                 // from the model's centre to the far (north) end of the sign
  const dy = bounds.maxY + spec.reachUp - bounds.cy;                  // …and up to the top of the standing N
  const dx = spec.size * 0.5;
  const need = Math.hypot(dx, dy, dz);
  return need > bounds.radius ? need / bounds.radius : 1;
}
