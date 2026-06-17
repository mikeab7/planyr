// Pure parking-layout math (no React/DOM) — unit-tested in test/parking.test.js.
//
// A drive aisle is "double-loaded" when it has a stall row on BOTH sides, so a
// field of n stall rows stacks as depth(n) = n·stallDepth + ⌈n/2⌉·aisle (one
// aisle shared per pair of rows). The "+"/"−" stepping adds exactly one row at a
// time: a single-loaded bay (1 row + 1 aisle) becomes double-loaded (2 rows,
// sharing the same aisle) before a new aisle is inserted.

export function parkDepthForRows(n, sd, ai) {
  n = Math.max(1, Math.round(n));
  return n * sd + Math.ceil(n / 2) * ai;
}

export function parkRowsForDepth(h, sd, ai) {
  const mod = 2 * sd + ai;
  if (mod <= 0) return 1;                                     // a double-loaded module
  const m = Math.floor((h + 1e-6) / mod), rem = h - m * mod;  // full modules + leftover
  return Math.max(1, 2 * m + (rem >= sd - 1e-6 ? 1 : 0));     // a leftover row is single-loaded
}

// Split a parking field of total depth `h` into independent pieces, each a
// DOUBLE-LOADED module (two stall rows sharing one drive aisle, depth 2·sd+ai),
// plus at most ONE trailing single-loaded row for a remainder that can't pair
// (B130). Never one row + a full aisle per row. The returned depths always sum to
// `h`, so splitting preserves the field's pavement and stall count exactly.
// Returns fewer than 2 pieces when there's nothing meaningful to split (≤ one
// module), so callers can no-op.
export function splitParkingPieces(h, sd, ai) {
  const mod = 2 * sd + ai;                                    // a double-loaded module
  if (!(mod > 0) || !(h > 0)) return [];
  const nFull = Math.floor((h + 1e-6) / mod);
  if (nFull < 1) return [];                                   // not even one full module → don't split
  const pieces = [];
  for (let i = 0; i < nFull; i++) pieces.push(mod);
  const rem = h - nFull * mod;
  if (rem >= sd - 1e-6) pieces.push(rem);                     // leftover ≥ a stall row → a single-loaded row
  else if (rem > 1e-6) pieces[pieces.length - 1] += rem;      // tiny remainder folds into the last module (keep total depth)
  return pieces;
}

/* ----------------------- curb adjacency (B130) -------------------- */
// Paved element types whose presence against an edge means "pavement meets
// pavement" — a drive-aisle opening, or continuous paving / an internal seam
// between abutting pads — so NO curb belongs on that edge.
export const PAVED_NEIGHBOR_TYPES = ["parking", "paving", "road", "trailer"];

function rotPt(x, y, deg) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}
// Point inside a rectangle element (cx,cy,w,h,rot), small tolerance.
function pointInRectEl(px, py, el) {
  const d = rotPt(px - el.cx, py - el.cy, -(el.rot || 0));
  return Math.abs(d.x) <= el.w / 2 + 1e-6 && Math.abs(d.y) <= el.h / 2 + 1e-6;
}
// Does element A's LOCAL edge (axis 'x'|'y', sign ±1) sit flush against a paved
// neighbour? Samples a few points just OUTSIDE the edge and tests whether any land
// inside a paved rectangle. True ⇒ the edge meets pavement (opening / seam) ⇒ no
// curb. False ⇒ it meets non-paving (dirt, landscape, a dead-end) ⇒ curb it.
export function edgeAbutsPaving(A, axis, sign, neighbors, eps = 1.5) {
  const paved = (neighbors || []).filter(
    (b) => b && b.id !== A.id && !b.points && PAVED_NEIGHBOR_TYPES.includes(b.type),
  );
  if (!paved.length) return false;
  const pts = [];
  for (const t of [-0.35, 0, 0.35]) {
    const lx = axis === "y" ? t * A.w : sign * (A.w / 2 + eps);
    const ly = axis === "y" ? sign * (A.h / 2 + eps) : t * A.h;
    const wpt = rotPt(lx, ly, A.rot || 0);
    pts.push({ x: A.cx + wpt.x, y: A.cy + wpt.y });
  }
  return paved.some((b) => pts.some((p) => pointInRectEl(p.x, p.y, b)));
}
