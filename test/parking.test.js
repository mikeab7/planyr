import { describe, it, expect } from "vitest";
import { parkDepthForRows, parkRowsForDepth, parkFlipIsNoOp, splitParkingPieces, explodeParkingBands, edgeAbutsPaving, freeParkStack, relayoutFreeStack } from "../src/workspaces/site-planner/lib/parking.js";
import { carStalls } from "../src/workspaces/site-planner/lib/siteGeometry.js";

const SD = 18, AI = 24, MOD = 2 * SD + AI; // 60' double-loaded module (18 + 24 + 18)

describe("parkFlipIsNoOp — B1790017 NEW-2: does flipDepth actually move any band? (proof against carStalls)", () => {
  const bandSet = (h, flipDepth) => carStalls(1000, h, { stallW: 9, parkAngle: 90, stallDepth: SD, aisle: AI, flipDepth })
    .bands.map((b) => `${b.y.toFixed(4)}:${b.depth.toFixed(4)}`).sort();

  it("is true for a whole number of modules (2, 4, 6 rows) — and the bands are PROVABLY identical either way", () => {
    for (const mods of [1, 2, 3]) {
      const h = mods * MOD;
      expect(parkFlipIsNoOp(h, SD, AI)).toBe(true);
      expect(bandSet(h, false)).toEqual(bandSet(h, true));
    }
  });
  it("is false for an odd leftover row (2m+1 rows) — and the bands DO move", () => {
    for (const mods of [1, 2, 3]) {
      const h = mods * MOD + SD; // one extra single-loaded row
      expect(parkFlipIsNoOp(h, SD, AI)).toBe(false);
      expect(bandSet(h, false)).not.toEqual(bandSet(h, true));
    }
  });
  it("is false when there's dead space short of a full leftover row", () => {
    const h = MOD + SD * 0.3; // more than one module, not enough for another row
    expect(parkFlipIsNoOp(h, SD, AI)).toBe(false);
    expect(bandSet(h, false)).not.toEqual(bandSet(h, true));
  });
  it("guards degenerate config without throwing", () => {
    expect(parkFlipIsNoOp(0, SD, AI)).toBe(false);
    expect(parkFlipIsNoOp(100, 0, 0)).toBe(false);
  });
});

describe("parkDepthForRows / parkRowsForDepth — double-loaded stepping (B69)", () => {
  it("steps one row at a time, double-loading an aisle before adding a new one", () => {
    // rows -> depth: 1:42, 2:60, 3:102, 4:120, 5:162, 6:180 (+18 / +42 / +18 / +42 …)
    expect([1, 2, 3, 4, 5, 6].map((n) => parkDepthForRows(n, SD, AI)))
      .toEqual([42, 60, 102, 120, 162, 180]);
  });
  it("is the inverse of parkRowsForDepth for n = 1..10", () => {
    for (let n = 1; n <= 10; n++)
      expect(parkRowsForDepth(parkDepthForRows(n, SD, AI), SD, AI)).toBe(n);
  });
  it("never returns fewer than one row", () => {
    expect(parkRowsForDepth(0, SD, AI)).toBe(1);
    expect(parkRowsForDepth(5, SD, AI)).toBe(1);
  });
});

describe("splitParkingPieces — split into double-loaded modules, not single rows (B130)", () => {
  it("splits an even field into 60' double-loaded modules", () => {
    expect(splitParkingPieces(120, SD, AI)).toEqual([60, 60]);       // 4 rows -> two modules
    expect(splitParkingPieces(180, SD, AI)).toEqual([60, 60, 60]);   // 6 rows -> three modules
  });
  it("adds at most one trailing single-loaded row for an odd remainder", () => {
    expect(splitParkingPieces(102, SD, AI)).toEqual([60, 42]);       // 3 rows -> module + one single-loaded row
    expect(splitParkingPieces(162, SD, AI)).toEqual([60, 60, 42]);   // 5 rows -> two modules + one single row
  });
  it("never makes one row + a full aisle per row (the old bug): only the lone leftover is single-loaded", () => {
    const pieces = splitParkingPieces(162, SD, AI);
    expect(pieces.filter((p) => p === MOD)).toHaveLength(2);         // full double-loaded modules
    expect(pieces.filter((p) => p !== MOD)).toHaveLength(1);         // at most one single-loaded leftover
  });
  it("preserves total depth exactly (no pavement gained or lost on split)", () => {
    for (const h of [102, 120, 150, 162, 180, 240, 137.5])
      expect(splitParkingPieces(h, SD, AI).reduce((a, b) => a + b, 0)).toBeCloseTo(h, 6);
  });
  it("folds a sub-row remainder into the last module rather than dropping depth", () => {
    expect(splitParkingPieces(130, SD, AI)).toEqual([60, 70]);       // 120 + 10' (< one 18' row) folded
  });
  it("returns < 2 pieces (caller no-ops) when the field is one module or less", () => {
    expect(splitParkingPieces(60, SD, AI)).toEqual([60]);            // exactly one module
    expect(splitParkingPieces(42, SD, AI)).toEqual([]);              // single bay, less than a module
    expect(splitParkingPieces(0, SD, AI)).toEqual([]);
  });
  it("guards a degenerate (zero) module without looping", () => {
    expect(splitParkingPieces(100, 0, 0)).toEqual([]);
  });
});

describe("explodeParkingBands — explode a field into individual rows + aisles (B472)", () => {
  const kinds = (h) => explodeParkingBands(h, SD, AI).map((p) => p.kind);
  const sum = (h) => explodeParkingBands(h, SD, AI).reduce((a, p) => a + p.depth, 0);

  it("explodes ONE double-loaded module into THREE elements (row, aisle, row) — not a 2-element module", () => {
    expect(kinds(60)).toEqual(["row", "aisle", "row"]);             // n=2 → 3 pieces
    const pieces = explodeParkingBands(60, SD, AI);
    expect(pieces).toEqual([
      { kind: "row", depth: SD }, { kind: "aisle", depth: AI }, { kind: "row", depth: SD },
    ]);
  });

  it("explodes a single-loaded bay (1 row + 1 aisle) into TWO elements", () => {
    expect(kinds(42)).toEqual(["row", "aisle"]);                    // n=1 → 2 pieces
  });

  it("explodes an 8-row field into all individual rows plus the aisles between them (12 elements)", () => {
    const pieces = explodeParkingBands(parkDepthForRows(8, SD, AI), SD, AI); // h=240, n=8
    expect(pieces).toHaveLength(12);
    expect(pieces.filter((p) => p.kind === "row")).toHaveLength(8); // every stall row
    expect(pieces.filter((p) => p.kind === "aisle")).toHaveLength(4); // one aisle per pair (⌈8/2⌉)
  });

  it("scales the element count correctly for N rows (rows = n, aisles = ⌈n/2⌉)", () => {
    for (let n = 1; n <= 10; n++) {
      const pieces = explodeParkingBands(parkDepthForRows(n, SD, AI), SD, AI);
      expect(pieces.filter((p) => p.kind === "row")).toHaveLength(n);
      expect(pieces.filter((p) => p.kind === "aisle")).toHaveLength(Math.ceil(n / 2));
    }
  });

  it("preserves total depth exactly (no pavement gained or lost on explode)", () => {
    for (const h of [42, 60, 102, 120, 162, 180, 240, 137.5])
      expect(sum(h)).toBeCloseTo(h, 6);
  });

  it("folds a sub-row free-draw remainder into the last piece rather than dropping depth", () => {
    expect(sum(130)).toBeCloseTo(130, 6);                          // 120 (n=4) + 10' folded
    expect(explodeParkingBands(130, SD, AI)).toHaveLength(6);      // still 4 rows + 2 aisles
  });

  it("guards a degenerate (zero) config without looping, returning < 2 pieces so the caller no-ops", () => {
    expect(explodeParkingBands(100, 0, 0)).toEqual([]);
    expect(explodeParkingBands(0, SD, AI)).toEqual([]);
    expect(explodeParkingBands(-50, SD, AI)).toEqual([]);
  });

  it("no-ops on a BARE single stall row (already an explode result) — never a row + a zero-depth aisle", () => {
    expect(explodeParkingBands(SD, SD, AI)).toEqual([]);          // depth == one stall row: nothing to separate
    expect(explodeParkingBands(SD - 2, SD, AI)).toEqual([]);      // a sub-row sliver: nothing to separate
  });
});

describe("edgeAbutsPaving — curb suppression where pavement meets pavement (B130)", () => {
  const A = { id: "a", type: "parking", cx: 0, cy: 0, w: 100, h: 60, rot: 0 };

  it("no neighbours → no edge abuts (an isolated pad gets a full-perimeter curb)", () => {
    for (const [ax, sg] of [["y", 1], ["y", -1], ["x", 1], ["x", -1]])
      expect(edgeAbutsPaving(A, ax, sg, [])).toBe(false);
  });

  it("detects a paved pad flush against one edge (opening / continuous paving)", () => {
    const below = { id: "b", type: "paving", cx: 0, cy: 60, w: 100, h: 60, rot: 0 };
    expect(edgeAbutsPaving(A, "y", 1, [below])).toBe(true);   // shared edge → no curb
    expect(edgeAbutsPaving(A, "y", -1, [below])).toBe(false);
    expect(edgeAbutsPaving(A, "x", 1, [below])).toBe(false);
    expect(edgeAbutsPaving(A, "x", -1, [below])).toBe(false);
  });

  it("detects the seam between two stacked split modules (both sides suppress)", () => {
    const top = { id: "t", type: "parking", cx: 0, cy: -30, w: 100, h: 60, rot: 0 };
    const bot = { id: "b", type: "parking", cx: 0, cy: 30, w: 100, h: 60, rot: 0 };
    expect(edgeAbutsPaving(top, "y", 1, [top, bot])).toBe(true);   // top's inner edge meets bot
    expect(edgeAbutsPaving(bot, "y", -1, [top, bot])).toBe(true);  // bot's inner edge meets top
    expect(edgeAbutsPaving(top, "y", -1, [top, bot])).toBe(false); // outer perimeter keeps its curb
    expect(edgeAbutsPaving(bot, "y", 1, [top, bot])).toBe(false);
  });

  it("detects the seam between stacked modules under rotation (rot=90, the item-2 case)", () => {
    const p1 = { id: "p1", type: "parking", cx: 0, cy: 0, w: 100, h: 60, rot: 90 };
    const p2 = { id: "p2", type: "parking", cx: -60, cy: 0, w: 100, h: 60, rot: 90 };
    expect(edgeAbutsPaving(p1, "y", 1, [p1, p2])).toBe(true);
    expect(edgeAbutsPaving(p1, "y", -1, [p1, p2])).toBe(false);
  });

  it("ignores non-paved neighbours (landscape) and polygon pads", () => {
    const land = { id: "l", type: "landscape", cx: 0, cy: 60, w: 100, h: 60, rot: 0 };
    const poly = { id: "p", type: "paving", cx: 0, cy: 60, points: [{ x: -50, y: 30 }, { x: 50, y: 30 }, { x: 0, y: 90 }] };
    expect(edgeAbutsPaving(A, "y", 1, [land])).toBe(false);
    expect(edgeAbutsPaving(A, "y", 1, [poly])).toBe(false);
  });

  it("treats a clear gap as non-abutting (curb stays)", () => {
    const gap = { id: "g", type: "paving", cx: 0, cy: 95, w: 100, h: 60, rot: 0 }; // ~35' below A's edge
    expect(edgeAbutsPaving(A, "y", 1, [gap])).toBe(false);
  });
});

// NEW-1 (deliberate remainder of B1625728) — a FREESTANDING split stack has no host/side to group
// siblings by, so `freeParkStack` finds them from geometry: same width + rotation, touching along
// one local depth axis, walked outward from whichever piece was passed in.
describe("freeParkStack — freestanding split-stack membership by geometry (NEW-1)", () => {
  // The exact stack `explodeParkingBands` + splitParkingRows lay down for a 2-row (60' = 18+24+18)
  // freestanding field, un-attached, rot 0, walking +y from -30: row @ -21 (h18), aisle @ 0 (h24),
  // row @ +21 (h18).
  const row0 = { id: "r0", type: "parking", cx: 0, cy: -21, w: 100, h: 18, rot: 0, sideParkPiece: 0 };
  const aisle = { id: "a0", type: "paving", cx: 0, cy: 0, w: 100, h: 24, rot: 0, sideParkPiece: 1 };
  const row1 = { id: "r1", type: "parking", cx: 0, cy: 21, w: 100, h: 18, rot: 0, sideParkPiece: 2 };
  const stack = [row0, aisle, row1];

  it("finds the whole contiguous stack regardless of which piece is passed in", () => {
    for (const seed of stack) {
      const found = freeParkStack(seed, stack);
      expect(found.map((e) => e.id)).toEqual(["r0", "a0", "r1"]);
    }
  });

  it("a lone, un-split field returns just itself", () => {
    const lone = { id: "f", type: "parking", cx: 0, cy: 0, w: 100, h: 60, rot: 0 };
    expect(freeParkStack(lone, [lone]).map((e) => e.id)).toEqual(["f"]);
  });

  it("never groups a wall-bonded element (attachedTo short-circuits to itself)", () => {
    const bonded = { id: "b", type: "parking", cx: 0, cy: -21, w: 100, h: 18, rot: 0, attachedTo: "host1", sideParkSide: "top", sideParkPiece: 0 };
    expect(freeParkStack(bonded, [bonded, aisle, row1]).map((e) => e.id)).toEqual(["b"]);
  });

  it("does not bridge a real gap between two otherwise-matching fields", () => {
    const far = { id: "far", type: "parking", cx: 0, cy: 21 + 50, w: 100, h: 18, rot: 0 }; // 50' clear of row1
    expect(freeParkStack(row0, [...stack, far]).map((e) => e.id)).toEqual(["r0", "a0", "r1"]);
  });

  it("does not group a DIFFERENT freestanding field of a different width, even if adjacent", () => {
    const other = { id: "o", type: "parking", cx: 0, cy: 21 + 9, w: 60, h: 18, rot: 0 }; // touches r1, narrower
    expect(freeParkStack(row0, [...stack, other]).map((e) => e.id)).toEqual(["r0", "a0", "r1"]);
  });

  it("does not group a field offset to the side (same width/rotation, not on the same line)", () => {
    const beside = { id: "beside", type: "parking", cx: 150, cy: -21, w: 100, h: 18, rot: 0 };
    expect(freeParkStack(row0, [...stack, beside]).map((e) => e.id)).toEqual(["r0", "a0", "r1"]);
  });

  it("holds under rotation (a stack turned 37°)", () => {
    const rot = 37;
    const rad = (rot * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
    const world = (lx, ly) => ({ x: lx * c - ly * s, y: lx * s + ly * c });
    const mk = (id, ly, h, sideParkPiece) => { const p = world(0, ly); return { id, type: "parking", cx: p.x, cy: p.y, w: 100, h, rot, sideParkPiece }; };
    const r0 = mk("r0", -21, 18, 0);
    const a0 = { ...mk("a0", 0, 24, 1), type: "paving" };
    const r1 = mk("r1", 21, 18, 2);
    const rotated = [r0, a0, r1];
    for (const seed of rotated) expect(freeParkStack(seed, rotated).map((e) => e.id)).toEqual(["r0", "a0", "r1"]);
  });

  it("orders by geometry even when sideParkPiece is entirely absent (legacy/untagged data)", () => {
    const untagged = stack.map((e) => { const { sideParkPiece, ...rest } = e; return rest; });
    expect(freeParkStack(untagged[1], untagged).map((e) => e.id)).toEqual(["r0", "a0", "r1"]);
  });
});

// NEW-1 (dispatch: "parking snaps back once split") — a direct canvas resize of one piece of a
// FREESTANDING split stack never moved its siblings, so growing/shrinking one row/aisle overlapped
// the next piece instead of pushing it out of the way; the untouched, opaque sibling then paints
// over the grown region (array/z order), which is what reads on screen as "it snapped back to its
// old size" on release. `relayoutFreeStack` is the freestanding twin of `relayoutWallKids` this
// fixes with: it PROPAGATES the gap/overlap that opens on whichever side of the resized piece
// (`resizedId`) actually moved, leaving the untouched side's chain exactly where it was — correct
// regardless of which edge (or corner) of the resized piece the drag actually grabbed.
describe("relayoutFreeStack — re-lay a freestanding split stack after one piece's resize (NEW-1)", () => {
  // Same 2-row (18+24+18) stack as freeParkStack's own fixture above, rot 0, contiguous:
  // r0 spans [-30,-12], a0 spans [-12,12], r1 spans [12,30].
  const mk = () => ([
    { id: "r0", type: "parking", cx: 0, cy: -21, w: 100, h: 18, rot: 0, sideParkPiece: 0 },
    { id: "a0", type: "paving", cx: 0, cy: 0, w: 100, h: 24, rot: 0, sideParkPiece: 1 },
    { id: "r1", type: "parking", cx: 0, cy: 21, w: 100, h: 18, rot: 0, sideParkPiece: 2 },
  ]);
  const nearFar = (p) => [p.cy - p.h / 2, p.cy + p.h / 2].sort((a, b) => a - b);

  it("is a no-op (returns the SAME array) on an already-contiguous stack", () => {
    const stack = mk();
    expect(relayoutFreeStack(stack, "r0")).toBe(stack);
  });

  it("growing piece 0's depth from its FAR edge (near edge fixed at -30) pushes only the pieces beyond it", () => {
    const stack = mk();
    stack[0] = { ...stack[0], h: 68, cy: -30 + 68 / 2 };        // near edge (-30) stays fixed, as an edge drag would leave it
    const laid = relayoutFreeStack(stack, "r0");
    const [r0Near, r0Far] = nearFar(laid[0]);
    const [a0Near, a0Far] = nearFar(laid[1]);
    const [r1Near, r1Far] = nearFar(laid[2]);
    expect(r0Near).toBeCloseTo(-30, 6);                         // the fixed (near) end never moves
    expect(r0Far).toBeCloseTo(r0Near + 68, 6);
    expect(a0Near).toBeCloseTo(r0Far, 6);                       // contiguous: no gap, no overlap
    expect(a0Far).toBeCloseTo(a0Near + 24, 6);
    expect(r1Near).toBeCloseTo(a0Far, 6);
    expect(r1Far).toBeCloseTo(r1Near + 18, 6);
  });

  it("shrinking piece 0's depth from its FAR edge pulls the pieces beyond it inward, same invariant", () => {
    const stack = mk();
    stack[0] = { ...stack[0], h: 6, cy: -30 + 6 / 2 };
    const laid = relayoutFreeStack(stack, "r0");
    const [r0Near, r0Far] = nearFar(laid[0]);
    const [a0Near] = nearFar(laid[1]);
    expect(r0Near).toBeCloseTo(-30, 6);
    expect(a0Near).toBeCloseTo(r0Far, 6);
  });

  it("growing piece 0's depth from its NEAR edge (far edge fixed at -12) is equally correct", () => {
    const stack = mk();
    stack[0] = { ...stack[0], h: 40, cy: -12 - 40 / 2 };        // far edge (-12) stays fixed this time
    const laid = relayoutFreeStack(stack, "r0");
    const [r0Near, r0Far] = nearFar(laid[0]);
    const [a0Near] = nearFar(laid[1]);
    expect(r0Far).toBeCloseTo(-12, 6);                          // the fixed (far) end never moves
    expect(a0Near).toBeCloseTo(r0Far, 6);                       // aisle didn't need to move — already touching
    expect(laid[1]).toBe(stack[1]);                             // identity-preserved: nothing on the far side moved
  });

  it("growing the MIDDLE piece (the aisle) from its far edge leaves piece 0 untouched and only pushes the outer row", () => {
    const stack = mk();
    const before0 = { ...stack[0] };
    stack[1] = { ...stack[1], h: 60, cy: -12 + 60 / 2 };        // near edge (-12) fixed, far edge extends
    const laid = relayoutFreeStack(stack, "a0");
    expect(laid[0]).toBe(stack[0]);                              // identity-preserved: piece 0 didn't move
    expect(laid[0].cx).toBeCloseTo(before0.cx, 6);
    expect(laid[0].cy).toBeCloseTo(before0.cy, 6);
    const [, r0Far] = nearFar(laid[0]);
    const [a0Near, a0Far] = nearFar(laid[1]);
    const [r1Near] = nearFar(laid[2]);
    expect(a0Near).toBeCloseTo(r0Far, 6);
    expect(r1Near).toBeCloseTo(a0Far, 6);
  });

  it("growing the OUTERMOST piece leaves the two inner pieces completely untouched", () => {
    const stack = mk();
    const before0 = { ...stack[0] }, before1 = { ...stack[1] };
    stack[2] = { ...stack[2], h: 56, cy: 12 + 56 / 2 };         // near edge (12) fixed, far edge extends outward
    const laid = relayoutFreeStack(stack, "r1");
    expect(laid[0]).toBe(stack[0]);
    expect(laid[1]).toBe(stack[1]);
    expect(laid[0].cy).toBeCloseTo(before0.cy, 6);
    expect(laid[1].cy).toBeCloseTo(before1.cy, 6);
    const [, a0Far] = nearFar(laid[1]);
    const [r1Near, r1Far] = nearFar(laid[2]);
    expect(r1Near).toBeCloseTo(a0Far, 6);
    expect(r1Far).toBeCloseTo(r1Near + 56, 6);
  });

  it("defaults the pivot to stack[0] when no resizedId is given", () => {
    const stack = mk();
    stack[0] = { ...stack[0], h: 68, cy: -30 + 68 / 2 };
    const laid = relayoutFreeStack(stack);
    const [, r0Far] = nearFar(laid[0]);
    const [a0Near] = nearFar(laid[1]);
    expect(a0Near).toBeCloseTo(r0Far, 6);
  });

  it("holds under rotation (a stack turned 37°) — the shared axis is derived from the pivot's own rot", () => {
    const rot = 37;
    const rad = (rot * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
    const world = (lx, ly) => ({ x: lx * c - ly * s, y: lx * s + ly * c });
    const mkAt = (id, ly, h, sideParkPiece, type = "parking") => { const p = world(0, ly); return { id, type, cx: p.x, cy: p.y, w: 100, h, rot, sideParkPiece }; };
    const stack = [mkAt("r0", -21, 18, 0), mkAt("a0", 0, 24, 1, "paving"), mkAt("r1", 21, 18, 2)];
    // grow r0 from its far edge: near edge (world) stays fixed at ly=-30 in local terms.
    const grown = world(0, -30 + 68 / 2);
    stack[0] = { ...stack[0], h: 68, cx: grown.x, cy: grown.y };
    const laid = relayoutFreeStack(stack, "r0");
    const u = { x: -s, y: c };
    const nearEdge = (p) => ({ x: p.cx - u.x * p.h / 2, y: p.cy - u.y * p.h / 2 });
    const nearWorld0 = world(0, -30);
    const n0After = nearEdge(laid[0]);
    expect(n0After.x).toBeCloseTo(nearWorld0.x, 6);
    expect(n0After.y).toBeCloseTo(nearWorld0.y, 6);
    // contiguity: piece 1's near edge meets piece 0's far edge.
    const farEdge = (p) => ({ x: p.cx + u.x * p.h / 2, y: p.cy + u.y * p.h / 2 });
    const f0 = farEdge(laid[0]), n1 = nearEdge(laid[1]);
    expect(n1.x).toBeCloseTo(f0.x, 6);
    expect(n1.y).toBeCloseTo(f0.y, 6);
  });

  it("degrades to a no-op for a lone piece or an empty/invalid stack", () => {
    const lone = [{ id: "f", type: "parking", cx: 0, cy: 0, w: 100, h: 60, rot: 0 }];
    expect(relayoutFreeStack(lone)).toBe(lone);
    expect(relayoutFreeStack([])).toEqual([]);
    expect(relayoutFreeStack(null)).toBe(null);
  });
});
