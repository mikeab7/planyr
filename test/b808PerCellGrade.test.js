// B808 — per-cell existing grade in the mitigation engine: the tilted-plane closed
// form, DEM-void honesty (excluded + counted, >5% LOUD), the AO per-cell decision,
// the grid-vs-median delta flag, cell retention (the B809 feed), the manual-grade
// override, and the combineMitigation rollups.
import { describe, it, expect } from "vitest";
import { computeMitigation, combineMitigation, gridIntersect } from "../src/workspaces/site-planner/lib/floodplainMitigation.js";
import { DEFAULT_FLOODPLAIN_RULES } from "../src/workspaces/site-planner/lib/floodplainRules.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const bboxOf = (rings) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < a) a = p.x; if (p.x > c) c = p.x;
    if (p.y < b) b = p.y; if (p.y > d) d = p.y;
  }
  return [a, b, c, d];
};
const mkZone = (cls, rings, extra = {}) => ({
  cls, zone: "AE", subtype: "", staticBfeFt: null, aoDepthFt: null, vdatum: null,
  unstudiedA: false, rings, bbox: bboxOf(rings), ...extra,
});
const harris = { ...DEFAULT_FLOODPLAIN_RULES.harris, verified: true }; // 1pct @ 1:1

// A 100×100 ft footprint fully inside a big AE zone with BFE 100.
const FP = { id: "b1", ring: rect(0, 0, 100, 100) };
const ZONE = mkZone("1pct", [rect(-50, -50, 400, 400)], { staticBfeFt: 100 });

// A tilted plane: grade rises west→east from 90 ft at x=0 to 96 ft at x=100
// (0.06 ft/ft). With pad 100 and WSE 100, depth(x) = 100 − grade(x) everywhere
// (pad ≥ WSE, all submerged): closed-form volume = ∫∫ (100 − 90 − 0.06x) dA
// = 100 ft × ∫0..100 (10 − 0.06x) dx = 100 × (1000 − 300) = 70,000 cf.
const tiltedGrade = (pt) => 90 + 0.06 * pt.x;
const ELEV_GRID = { padElevFt: 100, existGradeFt: 93, gradeAt: tiltedGrade, sources: { existGrade: "3dep" } };

describe("B808 — tilted-plane closed form", () => {
  it("per-cell volume matches the integral within 1%", () => {
    const r = computeMitigation({ footprints: [FP], zones: [ZONE], rule: harris, elev: ELEV_GRID });
    expect(r.gradeBasis).toBe("grid");
    expect(r.providers.existGrade).toBe("3dep-grid");
    expect(r.volumeCf).toBeGreaterThan(70000 * 0.99);
    expect(r.volumeCf).toBeLessThan(70000 * 1.01);
  });
  it("the flat-median comparison rides along and the >15% delta flags", () => {
    // median 93 → flat volume = (100−93)×10,000 = 70,000 cf — same as the integral
    // here (the median of a linear plane IS its mean), so NO delta flag…
    const r = computeMitigation({ footprints: [FP], zones: [ZONE], rule: harris, elev: ELEV_GRID });
    expect(r.volumeFlatCf).toBeGreaterThan(70000 * 0.99);
    expect(r.flags).not.toContain("grid-median-delta");
    // …but a BAD median (the centroid-line class this item retires) flags loudly:
    // median 97 → flat 30,000 cf vs grid ~70,000 cf → >15% apart.
    const r2 = computeMitigation({ footprints: [FP], zones: [ZONE], rule: harris, elev: { ...ELEV_GRID, existGradeFt: 97 } });
    expect(r2.flags).toContain("grid-median-delta");
    expect(r2.volumeCf).toBeGreaterThan(r2.volumeFlatCf);
  });
});

describe("B808 — DEM voids: excluded, counted, loud past 5%", () => {
  it("a void strip prices nothing there and >5% voids flag grid-voids", () => {
    // void for x < 20 (20% of the footprint)
    const holey = (pt) => (pt.x < 20 ? null : 95);
    const r = computeMitigation({ footprints: [FP], zones: [ZONE], rule: harris, elev: { ...ELEV_GRID, gradeAt: holey } });
    expect(r.flags).toContain("grid-voids");
    expect(r.voidCells).toBeGreaterThan(0);
    // valid cells price (100−95)=5 ft over ~80% of the area ≈ 40,000 cf
    expect(r.volumeCf).toBeGreaterThan(40000 * 0.95);
    expect(r.volumeCf).toBeLessThan(40000 * 1.05);
  });
  it("a few voids (<5%) stay quiet", () => {
    const fewVoids = (pt) => (pt.x < 2 ? null : 95);
    const r = computeMitigation({ footprints: [FP], zones: [ZONE], rule: harris, elev: { ...ELEV_GRID, gradeAt: fewVoids } });
    expect(r.flags).not.toContain("grid-voids");
  });
});

describe("B808 — AO zones price the published depth riding the ground per cell", () => {
  it("depth = min(aoDepth, pad − grade(pt)); a high pad prices the full AO depth", () => {
    const ao = mkZone("1pct", [rect(-50, -50, 400, 400)], { zone: "AO", aoDepthFt: 2 });
    const r = computeMitigation({ footprints: [FP], zones: [ao], rule: harris, elev: { ...ELEV_GRID, padElevFt: 200 } });
    // pad far above ground: every cell prices the full 2 ft → 20,000 cf
    expect(r.providers.wse1pct).toBe("ao-depth");
    expect(r.volumeCf).toBeGreaterThan(20000 * 0.99);
    expect(r.volumeCf).toBeLessThan(20000 * 1.01);
  });
  it("a pad below ground caps the AO depth at zero (no negative fill)", () => {
    const ao = mkZone("1pct", [rect(-50, -50, 400, 400)], { zone: "AO", aoDepthFt: 2 });
    const r = computeMitigation({ footprints: [FP], zones: [ao], rule: harris, elev: { ...ELEV_GRID, padElevFt: 80 } });
    expect(r.volumeCf).toBe(0);
  });
});

describe("B808 — precedence + retention + rollups", () => {
  it("a MANUAL grade wins: flat mode, grid ignored, basis 'manual'", () => {
    const r = computeMitigation({
      footprints: [FP], zones: [ZONE], rule: harris,
      elev: { padElevFt: 100, existGradeFt: 93, gradeAt: tiltedGrade, sources: { existGrade: "manual" } },
    });
    expect(r.gradeBasis).toBe("manual");
    expect(r.providers.existGrade).toBe("manual");
    expect(r.volumeCf).toBeGreaterThan(70000 * 0.99); // flat (100−93)×area
    expect(r.volumeFlatCf).toBeNull(); // no comparison in flat mode
  });
  it("no gradeAt → the labeled median fallback (basis 'median', provider from sources)", () => {
    const r = computeMitigation({ footprints: [FP], zones: [ZONE], rule: harris, elev: { padElevFt: 100, existGradeFt: 93, sources: { existGrade: "3dep" } } });
    expect(r.gradeBasis).toBe("median");
    expect(r.providers.existGrade).toBe("3dep");
  });
  it("retainCells keeps the SAME cells that summed (tie-out by construction)", () => {
    const r = computeMitigation({ footprints: [FP], zones: [ZONE], rule: harris, elev: ELEV_GRID, opts: { retainCells: true } });
    expect(Array.isArray(r.cells)).toBe(true);
    expect(r.cells.length).toBeGreaterThan(0);
    const sum = r.cells.reduce((acc, c) => acc + c.wFt * c.hFt * c.depthFt, 0) * r.ratio;
    expect(Math.abs(sum - r.volumeCf)).toBeLessThan(1e-6 * Math.max(1, r.volumeCf));
    for (const c of r.cells) expect(c.cls).toBe("1pct");
  });
  it("floodway cells retain as area-only geography (depthFt null)", () => {
    const fw = mkZone("floodway", [rect(0, 0, 30, 100)]);
    const r = computeMitigation({ footprints: [FP], zones: [ZONE, fw], rule: harris, elev: ELEV_GRID, opts: { retainCells: true } });
    const fwCells = r.cells.filter((c) => c.cls === "floodway");
    expect(fwCells.length).toBeGreaterThan(0);
    for (const c of fwCells) expect(c.depthFt).toBeNull();
  });
  it("combineMitigation concats cells outside the copy and re-judges the site-wide flags", () => {
    const fpB = { id: "b2", ring: rect(200, 0, 100, 100) };
    const zoneB = mkZone("1pct", [rect(150, -50, 300, 400)], { staticBfeFt: 100 });
    const rA = computeMitigation({ footprints: [FP], zones: [ZONE], rule: harris, elev: ELEV_GRID, opts: { retainCells: true } });
    const rB = computeMitigation({ footprints: [fpB], zones: [zoneB], rule: harris, elev: { ...ELEV_GRID, gradeAt: () => 95 }, opts: { retainCells: true } });
    const out = combineMitigation([rA, rB]);
    expect(out.cells.length).toBe(rA.cells.length + rB.cells.length);
    expect(out.volumeCf).toBeCloseTo(rA.volumeCf + rB.volumeCf, 6);
    expect(out.gradeBasis).toBe("grid");
    expect(out.pricedCells).toBe(rA.pricedCells + rB.pricedCells);
  });
  it("gridIntersect stays back-compatible for area-only callers", () => {
    const r = gridIntersect(FP.ring, ZONE, null, {});
    expect(r.areaSf).toBeGreaterThan(0);
    expect(r.sumDepthArea).toBe(0);
    expect(r.cells).toBeUndefined();
  });
});
