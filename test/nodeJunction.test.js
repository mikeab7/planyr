/* B1011 — a junction is a NODE with N ARMS, not a "through road" plus a branch.
 *
 * The bug this locks in: `teeGeometry` takes a SINGLE `throughDir`, so when the tee node is also a
 * BEND the caller could only hand over the bisector of the through road's two tangents — and both curb
 * returns were then built against a line the pavement never follows. One return sat proud of the real
 * edge (a thin dart), the other fell shy of it (a notch). That is the artifact the owner reported at
 * his pond-west junction. Measuring each corner against the arm's OWN tangent removes it by
 * construction, and the same rule covers the tee, the Y, the bend-with-branch and a 4-way. */
import { describe, it, expect } from "vitest";
import { nodeJunction } from "../src/workspaces/site-planner/lib/roadGeometry.js";

const deg = (d) => ({ x: Math.cos((d * Math.PI) / 180), y: Math.sin((d * Math.PI) / 180) });
const arm = (d, half = 20, extra = {}) => ({ dir: deg(d), half, avail: 400, road: "G", ...extra });
const N = { x: 0, y: 0 };

describe("nodeJunction — corners come from adjacent arm PAIRS", () => {
  it("a straight tee rounds exactly the two armpits and leaves the run-through alone", () => {
    const r = nodeJunction({ node: N, arms: [arm(180), arm(0), arm(90, 12, { road: "S" })], R: 50 });
    expect(r.gaps).toHaveLength(2);              // the 180° gap through the straight road adds nothing
    expect(r.wedges).toHaveLength(2);
    for (const g of r.gaps) expect(g.R).toBeCloseTo(50, 6);
  });

  it("a tee landing ON A BEND still rounds both armpits — each against its OWN tangent", () => {
    // The through road bends 10° at the node: arms at 170° and −20°, side road due north.
    const r = nodeJunction({ node: N, arms: [arm(170), arm(-20), arm(90, 18, { road: "S" })], R: 50 });
    expect(r.gaps).toHaveLength(2);
    expect(r.wedges).toHaveLength(2);
    // The two armpits are NOT the same size here — that asymmetry is the whole point. A bisector
    // model gave them one shared geometry, which is what produced the dart on one side and the
    // notch on the other.
    const [a, b] = r.gaps.map((g) => Math.hypot(g.corner.x, g.corner.y));
    expect(Math.abs(a - b)).toBeGreaterThan(0.5);
  });

  it("the two arms of ONE road's own bend are not a junction corner", () => {
    // Same bend, no branch: its polyline buffer already joins it, so nothing is added.
    const r = nodeJunction({ node: N, arms: [arm(170), arm(-20)], R: 50 });
    expect(r.wedges).toHaveLength(0);
  });

  it("a four-way rounds all four armpits", () => {
    const r = nodeJunction({
      node: N, R: 30,
      arms: [arm(0), arm(180), arm(90, 12, { road: "S" }), arm(270, 12, { road: "T" })],
    });
    expect(r.gaps).toHaveLength(4);
    expect(r.wedges).toHaveLength(4);
  });

  it("a Y with three distinct roads rounds all three armpits", () => {
    const r = nodeJunction({
      node: N, R: 25,
      arms: [arm(90, 15, { road: "A" }), arm(210, 15, { road: "B" }), arm(330, 15, { road: "C" })],
    });
    expect(r.wedges).toHaveLength(3);
  });
});

describe("nodeJunction — the return is clamped by what each arm actually has", () => {
  it("a short arm shrinks the return rather than sweeping past its end", () => {
    const long = nodeJunction({ node: N, arms: [arm(180), arm(0), arm(90, 12, { road: "S" })], R: 50 });
    // The corner itself sits ~23 ft out from the node here (half-widths 20 and 12), so "short" means
    // short BEYOND the corner — 30 ft of side road leaves only ~7 ft of tangent run, not 50.
    const short = nodeJunction({ node: N, arms: [arm(180), arm(0), { ...arm(90, 12, { road: "S" }), avail: 30 }], R: 50 });
    expect(short.R).toBeLessThan(long.R);
    expect(short.R).toBeGreaterThan(0);
  });

  it("no room at all degrades to an honest sharp corner, never a full-size return", () => {
    // A side road that ends BEFORE the junction corner it would need (corner ~23 ft out).
    const r = nodeJunction({ node: N, arms: [arm(180), arm(0), { ...arm(90, 12, { road: "S" }), avail: 0 }], R: 50 });
    expect(r.R).toBe(0);
    expect(r.wedges).toHaveLength(0);
    expect(r.gaps.every((g) => g.arc.length === 1)).toBe(true);   // corner point only
  });

  it("a requested radius of zero adds no pavement", () => {
    const r = nodeJunction({ node: N, arms: [arm(180), arm(0), arm(90, 12, { road: "S" })], R: 0 });
    expect(r.wedges).toHaveLength(0);
  });
});

describe("nodeJunction — shape invariants the union depends on", () => {
  const r = nodeJunction({ node: N, arms: [arm(180), arm(0), arm(90, 12, { road: "S" })], R: 50 });

  it("each wedge is a simple closed polygon with a real arc in it", () => {
    for (const w of r.wedges) {
      expect(w.length).toBeGreaterThanOrEqual(6);
      for (const p of w) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); }
    }
  });

  it("every wedge encloses real area (a degenerate sliver would dissolve to nothing)", () => {
    const area = (poly) => Math.abs(poly.reduce((s, p, i) => {
      const q = poly[(i + 1) % poly.length];
      return s + (p.x * q.y - q.x * p.y);
    }, 0) / 2);
    for (const w of r.wedges) expect(area(w)).toBeGreaterThan(10);
  });

  it("each gap names the two arm indices it joins, so a caller can find its own road's throat", () => {
    for (const g of r.gaps) {
      expect([0, 1, 2]).toContain(g.a);
      expect([0, 1, 2]).toContain(g.b);
      expect(g.a).not.toBe(g.b);
    }
    expect(r.gaps.every((g) => g.a === 2 || g.b === 2)).toBe(true);  // both armpits involve the side arm
  });

  it("degenerate input is refused rather than guessed at", () => {
    expect(nodeJunction(null)).toBeNull();
    expect(nodeJunction({ node: N, arms: [arm(0)] })).toBeNull();
    expect(nodeJunction({ node: N, arms: [{ dir: { x: 0, y: 0 }, half: 10 }, arm(0)] })).toBeNull();
  });
});
