/* NEW-1 (owner 2026-11-09) — Academy › Concept A, Parcels › Setbacks: "the west section runs up the west side AND turns
 * the top-left corner to include the short piece across the top before the curve starts … that northwest corner
 * shouldn't be part of the rest of the western boundary."
 *
 * The parcel is the OTHER half of the 2026-11-06 split (B2671195), the live 36-vertex lot e1455728kcnnhx, copied READ-ONLY
 * from production into test/fixtures/academyNwStubParcel.json. Its stored setbacks are 25 ft, 30 ft on edges 26-35.
 *
 * MEASURED (not inferred): the corner detector keeps BOTH ends of that piece (vertices 24 and 26 are 569 ft apart, farther
 * than the smoothing window, so the "a chamfer is one corner" rule never fires) — it is a 570 ft candidate section (edges
 * 24-25: the 270 ft diagonal across the corner + the 300 ft run before the curve, facing NNW). It was folded into the WEST
 * only by the count-driven pass that pulls a parcel down to TARGET_SECTIONS, which chose west because it was the less
 * wrong side (63° off west, 87° off the curve). Fix: that pass no longer folds a piece that rounds a corner (turns one way
 * for 80°+) AND faces neither neighbour (50°+ off both) — a cap on a hairpin corner, not a chamfer and not a jog.
 * Silvestri's SCHIEL has pieces with the same facing gaps that zig-zag (jogs) and must still fold; a symmetric chamfer
 * must still fold; those are asserted here and in boundarySectionsReal. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  boundarySections, CORNER_PIECE_MIN_TURN_DEG, CORNER_PIECE_MIN_GAP_DEG, TARGET_SECTIONS,
} from "../src/workspaces/site-planner/lib/boundarySections.js";

const fx = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const NW = fx("academyNwStubParcel.json");
const FIRST_HALF = fx("academySplitParcel.json");
const ring = (pts) => pts.map(([x, y]) => ({ x, y }));
const secOf = (sections, edge) => sections.find((s) => s.edges.includes(edge));
const tiles = (s, n) => expect(s.flatMap((x) => x.edges).sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));

/* the 8 symmetries of the plane: the same shape with the corner at NW, NE, SE, SW and mirrored. Vertex order is kept, so
 * the stub is still edges 24-25 (a mirror flips the winding — the module never assumes one). */
const SYMS = [
  ["as drawn (NW)", ([x, y]) => [x, y]],
  ["mirrored east-west (NE)", ([x, y]) => [-x, y]],
  ["mirrored north-south (SW)", ([x, y]) => [x, -y]],
  ["turned 180° (SE)", ([x, y]) => [-x, -y]],
  ["turned 90°", ([x, y]) => [-y, x]],
  ["turned 270°", ([x, y]) => [y, -x]],
  ["turned 90° + mirrored", ([x, y]) => [y, x]],
  ["turned 270° + mirrored", ([x, y]) => [-y, -x]],
];

describe("Academy › Concept A · Parcel 1 · B (the owner's real outline with the northwest corner piece)", () => {
  it("known-good arm: the fixture is the real 36-vertex outline with its stored 25 / 30 ft setbacks", () => {
    expect(NW.points).toHaveLength(36);
    expect(NW.setbacksAsStored).toHaveLength(36);
    expect(NW.setbacksAsStored.slice(0, 26).every((v) => v === 25)).toBe(true);
    expect(NW.setbacksAsStored.slice(26).every((v) => v === 30)).toBe(true);
    // true on the untouched code too: the east, south, west-side, curve and north breaks were never the problem
    const s = boundarySections(ring(NW.points), { defaultSetback: 25 });
    for (const start of [0, 3, 15, 26, 30]) expect(s.some((x) => x.startVertex === start)).toBe(true);
  });

  for (const [name, extra] of [["a flat 25 ft", { defaultSetback: 25 }], ["as stored (25, 30 on the curve and north)", { setbacks: NW.setbacksAsStored, defaultSetback: 25 }]]) {
    describe(name, () => {
      const R = ring(NW.points);
      const s = boundarySections(R, extra);

      it("tiles the ring exactly once and stays a handful of sections (3-6)", () => {
        tiles(s, R.length);
        expect(s.length).toBeGreaterThanOrEqual(3);
        expect(s.length).toBeLessThanOrEqual(TARGET_SECTIONS);
      });

      it("the northwest corner piece (edges 24-25) is NOT part of the west section", () => {
        const west = secOf(s, 20);
        expect(west.edges).not.toContain(24);
        expect(west.edges).not.toContain(25);
        expect(west.edges[west.edges.length - 1]).toBe(23); // the west side ends where the corner turns
        expect(west.startVertex).toBe(15);                  // …and starts at the real south-west corner
        expect(west.side).toBe("west");
      });

      it("it stands as its own small section (it faces neither the west nor the curve)", () => {
        const piece = secOf(s, 24);
        expect(piece.edges).toEqual([24, 25]);
        expect(secOf(s, 25)).toBe(piece);
        expect(piece).not.toBe(secOf(s, 20));
        expect(piece).not.toBe(secOf(s, 27));
      });

      it("the rest of the picture the owner saw is unchanged: east, south and the curve / north sections", () => {
        expect(secOf(s, 1).edges).toEqual([0, 1, 2]);
        expect(secOf(s, 10).startVertex).toBe(3);
        expect(secOf(s, 27).startVertex).toBe(26);
        expect(secOf(s, 32).edges).toContain(34);
      });

      it("setting the west value moves ONLY west edges (the corner piece keeps its own value)", () => {
        const west = secOf(s, 20);
        const out = R.map((_, i) => (west.edges.includes(i) ? 40 : (extra.setbacks ? extra.setbacks[i] : 25)));
        const after = boundarySections(R, { setbacks: out, defaultSetback: 25 });
        const w = secOf(after, 20);
        expect(w.value).toBe(40);
        expect(w.mixed).toBe(false);
        for (const e of [24, 25]) expect(out[e]).not.toBe(40);
        expect(secOf(after, 24).edges).toEqual([24, 25]);
      });
    });
  }

  it("the same stub sits in the earlier half of the split (Parcel 1 · A) and is not part of ITS west section either", () => {
    const R = ring(FIRST_HALF.points);
    const s = boundarySections(R, { defaultSetback: 25 });
    tiles(s, R.length);
    expect(s.length).toBeLessThanOrEqual(TARGET_SECTIONS);
    const west = secOf(s, 35);
    expect(west.edges).not.toContain(40);
    expect(west.edges).not.toContain(41);
    expect(west.startVertex).toBe(27); // B2671195's own pin: the west side starts at the real south-west corner
    expect(secOf(s, 40).edges).toEqual([40, 41]);
  });

  describe("the same corner on every corner of the lot (the shape turned and mirrored)", () => {
    for (const [name, f] of SYMS) {
      it(name, () => {
        const R = ring(NW.points.map(f));
        const s = boundarySections(R, { defaultSetback: 25 });
        tiles(s, R.length);
        expect(s.length).toBeGreaterThanOrEqual(3);
        expect(s.length).toBeLessThanOrEqual(TARGET_SECTIONS);
        const piece = secOf(s, 24);
        expect(piece.edges).toEqual([24, 25]);
        // the long side it used to be swallowed by is exactly edges 15-23 — whichever compass side that is in this view
        expect(secOf(s, 20).edges).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23]);
        expect(secOf(s, 26)).not.toBe(piece);
      });
    }
  });
});

describe("what the rule must NOT touch (the chamfer and jog rules the owner already settled)", () => {
  /* a 4000 × 3000 rectangle with a three-point 45° cut at chosen corners; the cut is ~426 ft */
  const W = 4000, H = 3000, c = 300;
  function rect(corners) {
    const pts = [];
    const add = (...p) => p.forEach((q) => pts.push(q));
    if (corners.has("NW")) add([0, c], [c * 0.55, c * 0.35], [c, 0]); else add([0, 0]);
    add([W / 2, 0]);
    if (corners.has("NE")) add([W - c, 0], [W - c * 0.35, c * 0.55], [W, c]); else add([W, 0]);
    add([W, H / 2]);
    if (corners.has("SE")) add([W, H - c], [W - c * 0.55, H - c * 0.35], [W - c, H]); else add([W, H]);
    add([W / 2, H]);
    if (corners.has("SW")) add([c, H], [c * 0.35, H - c * 0.55], [0, H - c]); else add([0, H]);
    add([0, H / 2]);
    return ring(pts);
  }

  it("a rectangle with one cut corner is five sections, a rectangle with all four clipped is still four (a chamfer sits equally between its sides)", () => {
    for (const k of ["NW", "NE", "SE", "SW"]) {
      const R = rect(new Set([k]));
      const s = boundarySections(R, { defaultSetback: 25 });
      tiles(s, R.length);
      expect(s).toHaveLength(5);
    }
    const four = rect(new Set(["NW", "NE", "SE", "SW"]));
    const s = boundarySections(four, { defaultSetback: 25 });
    tiles(s, four.length);
    expect(s).toHaveLength(4);
  });

  it("the thresholds are the documented ones, so the two halves of the rule cannot drift apart silently", () => {
    expect(CORNER_PIECE_MIN_TURN_DEG).toBe(80);
    expect(CORNER_PIECE_MIN_GAP_DEG).toBe(50);
    expect(CORNER_PIECE_MIN_GAP_DEG).toBeGreaterThan(45); // a 45° chamfer faces each side at 45°: it must stay under the line
  });

  it("Silvestri's SCHIEL (pieces with the same facing gaps that ZIG-ZAG) still folds to 6 or fewer", () => {
    const J = fx("silvestriParcels.json");
    const s = boundarySections(ring(J.schiel), { defaultSetback: 25 });
    expect(s.length).toBeLessThanOrEqual(TARGET_SECTIONS);
    tiles(s, J.schiel.length);
  });
});
