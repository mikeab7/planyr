/* Pure DXF geometry primitives (B747) — browser-free + DOM-free so the math is
 * unit-tested and safe to run inside the DXF Web Worker. NO imports, NO globals.
 *
 * Everything here is model-space math: bulge-arc flattening, arc/circle/ellipse
 * flattening, 2×3 affine composition for INSERT block references, and the
 * $INSUNITS → feet-per-unit table that powers the true-units auto-scale. The
 * renderer (dxfRender.js) turns the flattened point lists into SVG. */

// ---- $INSUNITS (header code 70 under $INSUNITS) → feet per drawing unit ----------------
// Only the units that actually turn up in civil/architectural CAD are given an exact
// factor; anything else (or 0 = unitless) is treated as feet but flagged `known:false`
// so the caller can surface "Units assumed: feet — verify" (never a silent guess).
const FT_PER_UNIT = {
  1: 1 / 12,              // inches
  2: 1,                   // feet
  3: 5280,                // miles
  4: 1 / 304.8,           // millimeters
  5: 1 / 30.48,           // centimeters
  6: 3.280839895,         // meters
  7: 3280.839895,         // kilometers
  8: 1 / 12 / 1e6,        // microinches
  9: 1 / 12 / 1000,       // mils
  10: 3,                  // yards
  14: 1 / 3.048,          // decimeters (0.1 m)
  15: 32.80839895,        // decameters (10 m)
  16: 328.0839895,        // hectometers (100 m)
  21: 1,                  // US survey feet (≈ 1.000002 ft — 2 ppm, immaterial for a backdrop)
};
const UNIT_LABEL = {
  0: "unitless", 1: "inches", 2: "feet", 3: "miles", 4: "millimeters", 5: "centimeters",
  6: "meters", 7: "kilometers", 8: "microinches", 9: "mils", 10: "yards",
  14: "decimeters", 15: "decameters", 16: "hectometers", 21: "US survey feet",
};

/* Map a $INSUNITS code to { ftPerUnit, known, label }. `known:false` means the drawing
 * declared no usable unit (0/absent/exotic) → assume feet but flag it. */
export function insunitsToFeet(code) {
  const c = Number.isFinite(code) ? code : 0;
  const known = c !== 0 && FT_PER_UNIT[c] != null;
  return { ftPerUnit: known ? FT_PER_UNIT[c] : 1, known, label: UNIT_LABEL[c] || "unknown" };
}

// ---- 2×3 affine transforms [a,b,c,d,e,f]  (x' = a·x + c·y + e ; y' = b·x + d·y + f) ----
// Same component order as an SVG matrix(a b c d e f), so a composed INSERT stack can be
// emitted verbatim or applied to points here.
export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function matMul(m, n) {
  // returns m ∘ n  (apply n first, then m)
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function matApply(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/* Compose the affine for one INSERT: translate(position) · rotate(deg, CCW) · scale(sx,sy).
 * xScale/yScale default to 1 and may be negative (mirror); rotation is in DEGREES (DXF
 * stores INSERT/TEXT rotation as degrees, unlike ARC which is radians). */
export function insertMatrix({ position = { x: 0, y: 0 }, xScale = 1, yScale = 1, rotation = 0 } = {}) {
  const r = (rotation || 0) * Math.PI / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const sx = xScale || 1, sy = yScale || 1;
  // translate · rotate · scale, flattened:
  return [
    cos * sx, sin * sx,
    -sin * sy, cos * sy,
    position.x || 0, position.y || 0,
  ];
}

// ---- flattening ----------------------------------------------------------------------
const clampSeg = (n) => Math.max(2, Math.min(256, Math.ceil(n)));
const STEP = Math.PI / 24; // ≈7.5° per segment — smooth at raster scale, cheap

/* Points along a circular arc, CCW from a0 to a1 by the SIGNED sweep. Includes both
 * endpoints. `cx,cy,r` centre + radius; angles in radians. */
export function arcPoints(cx, cy, r, a0, a1) {
  const sweep = a1 - a0;
  const n = clampSeg(Math.abs(sweep) / STEP);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/* A DXF ARC is ALWAYS drawn CCW from startAngle to endAngle (radians). Normalises the
 * sweep to be positive so a stored end<start wraps correctly. */
export function dxfArcPoints(cx, cy, r, startRad, endRad) {
  let sweep = endRad - startRad;
  while (sweep <= 0) sweep += 2 * Math.PI;
  return arcPoints(cx, cy, r, startRad, startRad + sweep);
}

/* Bulge arc between two LWPOLYLINE/POLYLINE vertices. bulge = tan(θ/4), signed (+ = CCW).
 * Returns the intermediate + end points (NOT p0 — the caller already has it), so callers
 * append the result to build a continuous path. A zero/degenerate bulge yields just [p1]. */
export function bulgeArcPoints(p0, p1, bulge) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const d = Math.hypot(dx, dy);
  if (!bulge || !(d > 0)) return [{ x: p1.x, y: p1.y }];
  const theta = 4 * Math.atan(bulge);        // signed included angle
  const half = theta / 2;
  const sinHalf = Math.sin(half);
  if (Math.abs(sinHalf) < 1e-12) return [{ x: p1.x, y: p1.y }];
  const R = d / (2 * sinHalf);               // signed radius
  // centre = midpoint + leftNormal · (R·cos(half)); leftNormal of chord dir = (-uy, ux)
  const ux = dx / d, uy = dy / d;
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
  const off = R * Math.cos(half);
  const cx = mx + -uy * off, cy = my + ux * off;
  const a0 = Math.atan2(p0.y - cy, p0.x - cx);
  const n = clampSeg(Math.abs(theta) / STEP);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const a = a0 + (theta * i) / n;
    const rad = Math.abs(R);
    out.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
  }
  // snap the last point exactly onto p1 (kills accumulated float drift at the join)
  out[out.length - 1] = { x: p1.x, y: p1.y };
  return out;
}

/* Points along an ELLIPSE. `center` + `majorAxisEndPoint` (a vector FROM centre to the
 * major-axis endpoint), `axisRatio` = minor/major, `start`/`end` = parametric angles in
 * radians (a full ellipse is 0 → 2π). CCW. Includes both endpoints. */
export function ellipsePoints(center, major, axisRatio, start = 0, end = 2 * Math.PI) {
  const majLen = Math.hypot(major.x, major.y) || 1e-9;
  const minLen = majLen * (axisRatio || 0);
  const rot = Math.atan2(major.y, major.x);
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  let sweep = end - start;
  if (sweep <= 0) sweep += 2 * Math.PI;
  const n = clampSeg(Math.abs(sweep) / STEP);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = start + (sweep * i) / n;
    const ex = majLen * Math.cos(t), ey = minLen * Math.sin(t);
    out.push({ x: center.x + ex * cosR - ey * sinR, y: center.y + ex * sinR + ey * cosR });
  }
  return out;
}

// Round to a compact fixed precision for SVG output (3 dp is < 1e-3 model units).
export const r3 = (n) => Math.round(n * 1000) / 1000;
