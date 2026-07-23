// PR-L — the developer-readable pond SECTION model. The hard rule: NO label overlaps another
// label, at the card width AND the panel width, for the Tsakiris values AND the extreme fixtures.
// Plus a content check (grade, berm, depth, flood, usable band, outlet + receiving, earthwork) and
// a guard that the old broken layout is gone. Pure, fixture-driven.
import { describe, it, expect } from "vitest";
import { pondSectionModel, labelBBox, boxesIntersect, placeColumn } from "../src/workspaces/site-planner/lib/pondSectionModel.js";

// The pond's real story the diagram must tell at a glance (owner's PR-L note).
const TSAKIRIS = {
  gradeFt: 153.1, rimFt: 157.1, floorFt: 145.1, freeboardFt: 1, slopeRatio: 3,
  wseFt: 153.1, wseEst: true, outletInvertFt: 145.1,
  tailwaterFt: 153.1, tailwaterEst: true, groundwaterFt: 148.1, groundwaterEst: true,
  deadAcFt: 6.2, usableAcFt: 15.3, bermFillCy: 2063, cutCy: 4200, purpose: "detention",
};

// Extreme fixtures (L2): 0 berm shallow · 20 ft berm w/ gravity problem · outlet above tailwater ·
// tight elevations · a mitigation pond (band wording) · unknowns.
const EXTREMES = {
  zeroBermShallow: { gradeFt: 100, rimFt: 100, floorFt: 96, freeboardFt: 1, slopeRatio: 3, wseFt: null, outletInvertFt: 96, tailwaterFt: null, groundwaterFt: 95, groundwaterEst: true, deadAcFt: null, usableAcFt: 0.6, bermFillCy: 0, cutCy: 900, purpose: "detention" },
  bigBermGravityProblem: { gradeFt: 100, rimFt: 120, floorFt: 110, freeboardFt: 2, slopeRatio: 4, wseFt: 105, wseEst: false, outletInvertFt: 110, tailwaterFt: 118, tailwaterEst: true, groundwaterFt: 112, groundwaterEst: true, deadAcFt: 1.1, usableAcFt: 22.4, bermFillCy: 18000, cutCy: 500, purpose: "detention" },
  outletAboveTailwater: { gradeFt: 200, rimFt: 206, floorFt: 194, freeboardFt: 1.5, slopeRatio: 3, wseFt: 198, wseEst: true, outletInvertFt: 197, tailwaterFt: 195, tailwaterEst: true, groundwaterFt: 190, groundwaterEst: true, deadAcFt: 3, usableAcFt: 8, bermFillCy: 400, cutCy: 3000, purpose: "detention" },
  tight: { gradeFt: 50.0, rimFt: 50.6, floorFt: 47.5, freeboardFt: 0.5, slopeRatio: 3, wseFt: 49.9, wseEst: true, outletInvertFt: 47.5, tailwaterFt: 49.9, tailwaterEst: true, groundwaterFt: 48.2, groundwaterEst: true, deadAcFt: 4, usableAcFt: 0.7, bermFillCy: 120, cutCy: 2200, purpose: "detention" },
  mitigation: { gradeFt: 90, rimFt: 92, floorFt: 80, freeboardFt: 1, slopeRatio: 3, wseFt: 88, wseEst: true, outletInvertFt: 80, tailwaterFt: 88, tailwaterEst: true, groundwaterFt: 84, groundwaterEst: true, deadAcFt: 9, usableAcFt: 5.5, bermFillCy: 300, cutCy: 6000, purpose: "mitigation" },
};

// The two real render sizes: the ⚡ Optimize card (~wide) and the pond inspector column (~narrow).
const SIZES = [{ w: 520, h: 260 }, { w: 360, h: 240 }];

const noLabelOverlaps = (m) => {
  for (let i = 0; i < m.labels.length; i++) {
    for (let j = i + 1; j < m.labels.length; j++) {
      const a = labelBBox(m.labels[i]), b = labelBBox(m.labels[j]);
      if (boxesIntersect(a, b)) {
        return `"${m.labels[i].s}" overlaps "${m.labels[j].s}"`;
      }
    }
  }
  return null;
};

describe("L2 — NO label ever overlaps another label (Tsakiris + extremes, card + panel widths)", () => {
  const cases = { TSAKIRIS, ...EXTREMES };
  for (const [name, facts] of Object.entries(cases)) {
    for (const size of SIZES) {
      it(`${name} @ ${size.w}x${size.h}: every label bbox is disjoint`, () => {
        const m = pondSectionModel(facts, size);
        expect(m.ok).toBe(true);
        const clash = noLabelOverlaps(m);
        expect(clash, clash || "no overlap").toBeNull();
        // no NaN leaked into any label position
        for (const l of m.labels) { expect(Number.isFinite(l.x)).toBe(true); expect(Number.isFinite(l.y)).toBe(true); }
      });
    }
  }
});

describe("placeColumn — de-collides a vertical stack and records the anchor for a leader", () => {
  it("pushes overlapping items apart by at least a line, preserving input order", () => {
    const placed = placeColumn([
      { key: "a", anchorY: 100 }, { key: "b", anchorY: 102 }, { key: "c", anchorY: 103 },
    ], { top: 10, bottom: 250 });
    expect(placed.map((p) => p.key)).toEqual(["a", "b", "c"]); // order preserved
    const ys = placed.map((p) => p.y).sort((x, y) => x - y);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(12);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(12);
  });
});

describe("L1 — the section shows what a developer needs", () => {
  const m = pondSectionModel(TSAKIRIS, { w: 520, h: 260 });
  const has = (pred) => m.labels.some(pred);

  it("has an existing-grade datum line and a floor, labeled with elevations", () => {
    expect(m.lines.some((l) => l.role === "grade")).toBe(true);
    expect(has((l) => l.s === "grade 153.1'")).toBe(true);
    expect(has((l) => l.s === "floor 145.1'")).toBe(true);
  });
  it("draws the berm as fill above grade and labels the rim with +berm", () => {
    expect(m.berms.length).toBe(2);
    expect(has((l) => l.s === "rim 157.1' (+4.0 ft)")).toBe(true);
  });
  it("M2 — a two-segment depth dimension: +berm above grade, cut below grade", () => {
    expect(m.depthDim).toBeTruthy();
    expect(m.depthDim.twoSeg).toBe(true);
    expect(has((l) => l.s === "+4.0 ft berm")).toBe(true); // rim 157.1 − grade 153.1
    expect(has((l) => l.s === "8.0 ft cut")).toBe(true);   // grade 153.1 − floor 145.1
  });
  it("has a dashed flood line + EST label", () => {
    expect(m.lines.some((l) => l.role === "flood")).toBe(true);
    expect(has((l) => l.s === "flood 153.1' EST")).toBe(true);
  });
  it("shades a usable-detention band that SPANS the pond interior", () => {
    const usable = m.bands.find((b) => b.kind === "usable");
    expect(usable).toBeTruthy();
    const xs = usable.pts.map((p) => p.x);
    // band lives between the left and right faces (inside the section, not a floating box)
    expect(Math.min(...xs)).toBeGreaterThan(80);
    expect(Math.max(...xs)).toBeLessThan(520 - 80);
    expect(has((l) => l.s === "usable 15.3 ac-ft")).toBe(true);
  });
  it("shows the outlet + receiving water, with the receiving level ABOVE the outlet (the gravity problem)", () => {
    expect(m.outlet).toBeTruthy();
    expect(m.receiving).toBeTruthy();
    // higher elevation renders at a SMALLER y — receiving 153.1 sits above outlet 145.1
    expect(m.receiving.y).toBeLessThan(m.outlet.y);
    expect(has((l) => l.s === "outlet 145.1'")).toBe(true);
    expect(has((l) => l.s === "receiving 153.1' EST")).toBe(true);
  });
  it("has a groundwater line (dashed, distinct) with an EST label when it intersects the section", () => {
    expect(m.lines.some((l) => l.role === "groundwater")).toBe(true);
    expect(has((l) => l.s === "groundwater 148.1' EST")).toBe(true);
  });
  it("labels the side slope once", () => {
    expect(has((l) => l.s === "3:1")).toBe(true);
  });
  it("keeps the not-to-scale note in its own corner, with NO em dash", () => {
    expect(m.note.s).toBe("schematic, not to scale");
    expect(m.note.s.includes("—")).toBe(false);
  });
});

describe("M1 — correct outside-in berm geometry (colinear inner face, fill above grade)", () => {
  const cases = { TSAKIRIS, big: EXTREMES.bigBermGravityProblem, outletHigh: EXTREMES.outletAboveTailwater };
  for (const [name, facts] of Object.entries(cases)) {
    const m = pondSectionModel(facts, { w: 520, h: 260 });
    const gradeY = m.lines.find((l) => l.role === "grade").y;
    it(`${name}: the inner face above grade is COLINEAR with the side slope below grade (one line)`, () => {
      for (const side of [0, 1]) {
        const face = m.faces[side];          // [crestInner, floor] — the whole dark side slope
        const quad = m.berms[side];          // [toe, crestOut, crestInner, innerAtGrade]
        // the berm's crest-inner point IS the top of the face
        expect(quad[2].x).toBeCloseTo(face[0].x, 3);
        expect(quad[2].y).toBeCloseTo(face[0].y, 3);
        // the berm's inner-at-grade point lies ON the face line → no kink at grade, no line through fill
        const inGrade = quad[3];
        const cross = (face[1].x - face[0].x) * (inGrade.y - face[0].y) - (face[1].y - face[0].y) * (inGrade.x - face[0].x);
        expect(Math.abs(cross)).toBeLessThan(1); // px^2 — colinear within epsilon
      }
    });
    it(`${name}: the berm fill polygon sits strictly ABOVE grade, bounded by the faces + crest`, () => {
      for (const quad of m.berms) {
        // every fill vertex is at or above grade (smaller y = higher on screen)
        for (const p of quad) expect(p.y).toBeLessThanOrEqual(gradeY + 0.5);
        // the crest (points 1,2) sits at rim; the toe + inner-at-grade (points 0,3) sit at grade
        expect(quad[0].y).toBeCloseTo(gradeY, 1);
        expect(quad[3].y).toBeCloseTo(gradeY, 1);
        expect(quad[1].y).toBeCloseTo(m.depthDim.yRim, 1);
        // the crest has a flat top of real width (not a knife point)
        expect(Math.abs(quad[2].x - quad[1].x)).toBeGreaterThan(2);
        // the outer toe sits OUTSIDE the crest (the outer face slopes out and down to grade)
      }
      // outer toe is outside the crest on each bank
      expect(m.berms[0][0].x).toBeLessThan(m.berms[0][1].x);
      expect(m.berms[1][0].x).toBeGreaterThan(m.berms[1][1].x);
    });
  }
});

describe("M2 — the dimension ticks/extension lines land on the measured levels", () => {
  const m = pondSectionModel(TSAKIRIS, { w: 520, h: 260 });
  it("rim highest, floor lowest, grade between (on screen)", () => {
    expect(m.depthDim.yRim).toBeLessThan(m.depthDim.yGrade);
    expect(m.depthDim.yGrade).toBeLessThan(m.depthDim.yFloor);
  });
  it("extension lines touch the rim (crest inner), the floor, and the grade plane", () => {
    expect(m.depthDim.extRim.y).toBe(m.depthDim.yRim);
    expect(m.depthDim.extRim.x1).toBeCloseTo(m.faces[0][0].x, 3);   // touches the rim/crest
    expect(m.depthDim.extFloor.y).toBe(m.depthDim.yFloor);
    expect(m.depthDim.extFloor.x1).toBeCloseTo(m.floor.x1, 3);       // touches the floor
    expect(m.depthDim.extGrade.y).toBe(m.depthDim.yGrade);
    expect(m.depthDim.extGrade.x1).toBeCloseTo(m.berms[0][3].x, 3);  // touches the grade plane
  });
});

describe("M3 — NO earthwork CY numbers on the drawing", () => {
  it("no label contains 'CY' for any fixture", () => {
    for (const facts of [TSAKIRIS, ...Object.values(EXTREMES)]) {
      const m = pondSectionModel(facts, { w: 520, h: 260 });
      expect(m.labels.some((l) => /CY/.test(l.s)), JSON.stringify(m.labels.map((l) => l.s))).toBe(false);
    }
  });
});

describe("L1 — purpose-correct + graceful degradation", () => {
  it("a mitigation pond labels the working band 'mitigation', not 'usable'", () => {
    const m = pondSectionModel(EXTREMES.mitigation, { w: 520, h: 260 });
    expect(m.labels.some((l) => l.s.startsWith("mitigation "))).toBe(true);
    expect(m.labels.some((l) => l.s.startsWith("usable "))).toBe(false);
  });
  it("a zero-berm pond draws NO berm shape and NO berm-fill label", () => {
    const m = pondSectionModel(EXTREMES.zeroBermShallow, { w: 520, h: 260 });
    expect(m.berms.length).toBe(0);
    expect(m.labels.some((l) => /CY fill/.test(l.s))).toBe(false);
    expect(m.labels.some((l) => l.s.startsWith("rim ") && /\+/.test(l.s))).toBe(false);
  });
  it("not enough to draw → ok:false, never a throw", () => {
    expect(pondSectionModel({}).ok).toBe(false);
    expect(pondSectionModel({ rimFt: 100, floorFt: 100 }).ok).toBe(false); // zero depth
    expect(pondSectionModel({ rimFt: 100, floorFt: 105 }).ok).toBe(false); // inverted
  });
});

describe("L4(c) — the old broken cross-section is gone", () => {
  it("no em-dash in any produced label", () => {
    for (const facts of [TSAKIRIS, ...Object.values(EXTREMES)]) {
      const m = pondSectionModel(facts, { w: 520, h: 260 });
      for (const l of m.labels) expect(l.s.includes("—"), l.s).toBe(false);
    }
  });
});
