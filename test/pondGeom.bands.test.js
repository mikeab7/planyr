// B708 — elevation-anchored banded pond storage: volumeBetween prisms, the
// WSE/pool/usable split (exclusive bands), the shared usablePondVolume precedence,
// the excavation integral, drawdown + berm screens. Pure — no browser.
import { describe, it, expect } from "vitest";
import {
  detentionStorage,
  volumeBetween,
  bandedStorage,
  usablePondVolume,
  excavationVolume,
  drawdownWarning,
  bermAsFillHeight,
  bermFillCells,
  pointInRing,
} from "../src/workspaces/site-planner/lib/pondGeom.js";

// 100×100 ft square at the origin. With slope 3, the stage area at `down` ft below
// the top of bank is (100 − 6·down)² — inward offsets of a convex square are exact.
const SQ = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const DET = { depth: 4, freeboard: 1, slope: 3, tobElev: 100 }; // water surf 99, floor 96
const GROSS = detentionStorage(SQ, 4, 1, 3).vol; // hand calc: 8290 + 7234 + 6250 = 21774

describe("volumeBetween — anchored stage prisms", () => {
  it("matches the hand-computed prism for the top two feet", () => {
    // down 0→2: (10000+8836)/2 + (8836+7744)/2 = 17708
    expect(volumeBetween(SQ, DET, 98, 100)).toBeCloseTo(17708, -2);
  });
  it("the full water column equals detentionStorage.vol exactly (same integrator)", () => {
    expect(volumeBetween(SQ, DET, 96, 99)).toBeCloseTo(GROSS, 6);
  });
  it("clamps to what exists: nothing above the bank, nothing below the floor", () => {
    expect(volumeBetween(SQ, DET, 101, 105)).toBe(0);
    expect(volumeBetween(SQ, DET, 80, 96)).toBe(0);
    expect(volumeBetween(SQ, DET, 80, 105)).toBeCloseTo(volumeBetween(SQ, DET, 96, 100), 6);
  });
  it("an unanchored pond returns null — never a silent zero", () => {
    expect(volumeBetween(SQ, { depth: 4, freeboard: 1, slope: 3 }, 90, 100)).toBeNull();
  });
});

describe("bandedStorage — the exclusive WSE/pool split", () => {
  it("flood WSE below the basin floor → the whole column stays usable", () => {
    const b = bandedStorage(SQ, DET, { wseFt: 90 });
    expect(b.usableCf).toBeCloseTo(GROSS, 6);
    expect(b.mitigationCandidateCf).toBe(0);
    expect(b.poolDeadCf).toBe(0);
    expect(b.fullyInundated).toBe(false);
  });
  // R1 — by DEFAULT (non-coincident storms) the pond recovers to normal tailwater between storms, so
  // the 100-yr flood WSE is NOT a permanent dead floor: the whole column above the floor is usable
  // detention, and the below-WSE band is a SEPARATE (overlapping) mitigation-candidate measure.
  it("R1 default (non-coincident): a mid-basin flood WSE does NOT floor usable; the below-WSE band is still the mitigation candidate", () => {
    const b = bandedStorage(SQ, DET, { wseFt: 97.5 });
    expect(b.usableCf).toBeCloseTo(GROSS, 6);                                    // recovers to normal tailwater → whole column usable
    expect(b.mitigationCandidateCf).toBeCloseTo(volumeBetween(SQ, DET, 96, 97.5), 6); // still the below-WSE displaced band
    expect(b.fullyInundated).toBe(false);
  });
  it("coincidentStorm:true reproduces the exclusive split (usable above WSE, candidate below); bands sum to gross", () => {
    const b = bandedStorage(SQ, DET, { wseFt: 97.5, coincidentStorm: true });
    expect(b.usableCf).toBeGreaterThan(0);
    expect(b.mitigationCandidateCf).toBeGreaterThan(0);
    expect(b.usableCf + b.mitigationCandidateCf).toBeCloseTo(GROSS, -3); // split-slab tolerance
    expect(b.usableCf).toBeCloseTo(volumeBetween(SQ, DET, 97.5, 99), 6);
    expect(b.mitigationCandidateCf).toBeCloseTo(volumeBetween(SQ, DET, 96, 97.5), 6);
  });
  it("R1 — a flood WSE above the rim does NOT permanently inundate by default (recovers to normal tailwater)", () => {
    const b = bandedStorage(SQ, DET, { wseFt: 100.5 });
    expect(b.fullyInundated).toBe(false);
    expect(b.usableCf).toBeCloseTo(GROSS, 6);
  });
  it("coincidentStorm:true — WSE above the top of bank → fully inundated, usable 0 (the coincident case)", () => {
    const b = bandedStorage(SQ, DET, { wseFt: 100.5, coincidentStorm: true });
    expect(b.fullyInundated).toBe(true);
    expect(b.usableCf).toBe(0);
  });
  it("R1 — a NORMAL-tailwater dead floor DOES floor usable, independent of the coincident policy", () => {
    // deadFloorFt (dry-weather receiving level) at 97 → usable is only above it; below it is dead.
    const b = bandedStorage(SQ, DET, { wseFt: 90, deadFloorFt: 97 });
    expect(b.usableCf).toBeCloseTo(volumeBetween(SQ, DET, 97, 99), 6);
  });
  it("permanent pool without a flood WSE still earns no credit below the outlet", () => {
    const b = bandedStorage(SQ, { ...DET, poolElev: 97 }, {});
    expect(b.poolDeadCf).toBeCloseTo(volumeBetween(SQ, DET, 96, 97), 6);
    expect(b.usableCf).toBeCloseTo(volumeBetween(SQ, DET, 97, 99), 6);
    expect(b.mitigationCandidateCf).toBe(0);
  });
  it("pool below the WSE (coincidentStorm): dead → candidate → usable, exclusive and summing to gross", () => {
    // The exclusive three-band partition only holds when the flood WSE floors usable — i.e. under the
    // coincident-storm policy (R1). By default the candidate band overlaps the recovered usable column.
    const b = bandedStorage(SQ, { ...DET, poolElev: 96.5 }, { wseFt: 98, coincidentStorm: true });
    expect(b.poolDeadCf).toBeGreaterThan(0);
    expect(b.mitigationCandidateCf).toBeGreaterThan(0);
    expect(b.usableCf).toBeGreaterThan(0);
    expect(b.poolDeadCf + b.mitigationCandidateCf + b.usableCf).toBeCloseTo(GROSS, -3);
  });
  it("pool ABOVE the WSE: the pool governs and the candidate band vanishes", () => {
    const b = bandedStorage(SQ, { ...DET, poolElev: 98.5 }, { wseFt: 97 });
    expect(b.mitigationCandidateCf).toBe(0);
    expect(b.usableCf).toBeCloseTo(volumeBetween(SQ, DET, 98.5, 99), 6);
    expect(b.poolDeadCf + b.usableCf).toBeCloseTo(GROSS, -3);
  });
  it("unanchored → null (the caller must fall back to the estimate, never gross-silently)", () => {
    expect(bandedStorage(SQ, { depth: 4, freeboard: 1, slope: 3 }, { wseFt: 97 })).toBeNull();
  });
});

describe("usablePondVolume — the ONE shared precedence helper", () => {
  it("anchored + WSE → the banded split", () => {
    const u = usablePondVolume(SQ, DET, { wseFt: 97.5, estimatePoolDepthFt: 3 });
    expect(u.mode).toBe("anchored"); // the anchor wins over the site-level estimate
    expect(u.usableCf).toBeCloseTo(bandedStorage(SQ, DET, { wseFt: 97.5 }).usableCf, 6);
    expect(u.usableCf + u.deadCf).toBeCloseTo(u.grossCf, 6);
  });
  it("anchored but ctx elevations missing → falls back to the estimate, NEVER silently zero-dead", () => {
    const u = usablePondVolume(SQ, DET, { wseFt: null, estimatePoolDepthFt: 2 });
    expect(u.mode).toBe("estimate");
    // dead = the column below a 2-ft pool = detentionStorage with freeboard depth−pool
    const dead = detentionStorage(SQ, 4, 2, 3).vol;
    expect(u.deadCf).toBeCloseTo(dead, 6);
    expect(u.usableCf).toBeCloseTo(GROSS - dead, 6);
  });
  it("no flood/pool information at all → gross (Regime A)", () => {
    const u = usablePondVolume(SQ, { depth: 4, freeboard: 1, slope: 3 }, {});
    expect(u.mode).toBe("gross");
    expect(u.usableCf).toBeCloseTo(GROSS, 6);
    expect(u.deadCf).toBe(0);
  });
  it("figures aggregate across ponds by plain summation", () => {
    // R1 — a bare flood WSE no longer floors usable, so use a NORMAL-tailwater dead floor to make the
    // usable partial (below the flowline is dead); the two ponds still sum by plain addition.
    const a = usablePondVolume(SQ, DET, { wseFt: 90, deadFloorFt: 97 });
    const b = usablePondVolume(SQ, DET, { wseFt: 90, deadFloorFt: 98 });
    expect(a.usableCf + b.usableCf).toBeGreaterThan(0);
    expect(a.usableCf + b.usableCf).toBeLessThan(2 * GROSS); // both floored above the basin floor → each < gross
  });
});

describe("excavationVolume — the cut integral (NOT detentionStorage.vol)", () => {
  it("integrates the WHOLE basin from top of bank, not just the water column", () => {
    // depth 2, slope 3: down 0→2 = 9418 + 8290 = 17708 — vs .vol (fb 1) = 8290 only.
    expect(excavationVolume(SQ, { depth: 2, freeboard: 1, slope: 3 })).toBeCloseTo(17708, -2);
    expect(detentionStorage(SQ, 2, 1, 3).vol).toBeCloseTo(8290, -2);
  });
  it("respects pinch-off: an infeasible depth cuts only to the achievable floor", () => {
    const vol = excavationVolume(SQ, { depth: 30, slope: 3 }); // maxDepth = 50/3 ≈ 16.7
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeLessThan(10000 * 17); // far less than a 30-ft vertical-wall box
  });
});

describe("drawdown + berm screens", () => {
  it("pond bottom below the receiving flowline → pump warning + a gravity depth cap", () => {
    const w = drawdownWarning({ tobElev: 100, depth: 8, receivingFlowlineElev: 94 });
    expect(w.belowByFt).toBeCloseTo(2, 6);
    expect(w.suggestedMaxDepthFt).toBeCloseTo(6, 6);
  });
  it("bottom at/above the flowline, or missing inputs → no warning", () => {
    expect(drawdownWarning({ tobElev: 100, depth: 8, receivingFlowlineElev: 90 })).toBeNull();
    expect(drawdownWarning({ tobElev: 100, depth: 8 })).toBeNull();
    expect(drawdownWarning({ depth: 8, receivingFlowlineElev: 94 })).toBeNull();
  });
  it("top of bank above existing grade → the berm height (fill); noise-tolerant", () => {
    expect(bermAsFillHeight({ tobElev: 100 }, 97)).toBeCloseTo(3, 6);
    expect(bermAsFillHeight({ tobElev: 100 }, 99.9)).toBeNull();
    expect(bermAsFillHeight({ tobElev: 100 }, null)).toBeNull();
    expect(bermAsFillHeight({}, 97)).toBeNull();
  });
});

describe("NEW-6 — bermFillCells: materialize an above-grade berm as modeled fill cells", () => {
  // A 200×200 ft square pond (world feet); TOB at 100 over a flat grade at 96 → a 4-ft berm.
  const ring = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
  const flat96 = () => 96;

  it("TOB above grade → cells, a positive fill volume, the drawn ring as toe, and NO land take (B982 inward)", () => {
    const bc = bermFillCells(ring, { tobElev: 100 }, { gradeAt: flat96, ratio: 3 });
    expect(bc).toBeTruthy();
    expect(bc.maxHeightFt).toBeCloseTo(4, 6);
    expect(bc.crestElevFt).toBe(100);
    expect(bc.volCf).toBeGreaterThan(0);
    expect(bc.cells.length).toBeGreaterThan(0);
    // B982 (NEW-17) INWARD model: the drawn ring IS the outer toe and the berm adds NO land.
    expect(bc.toeRing).toBe(ring);
    expect(bc.landTakeSf).toBe(0);
    // The screening embankment volume is in the ballpark of perimeter × h²·ratio/2 (same
    // triangular cross-section as the old outward prism, just placed inside the footprint).
    const perim = 800, approx = perim * 16 * 3 / 2; // 19,200 cf
    expect(bc.volCf).toBeGreaterThan(approx * 0.4);
    expect(bc.volCf).toBeLessThan(approx * 1.8);
  });

  it("B982 (NEW-17) — every berm cell sits INSIDE the drawn footprint (nothing outside the toe)", () => {
    const bc = bermFillCells(ring, { tobElev: 100 }, { gradeAt: flat96, wseFt: 99, ratio: 3, triggerClassAt: () => "1pct", fpId: "berm:p1" });
    expect(bc.cells.length).toBeGreaterThan(0);
    expect(bc.cells.every((c) => pointInRing({ x: c.x, y: c.y }, ring))).toBe(true);
    // the below-WSE heat cells (which drive the mitigation requirement) are inside the zone-covered
    // footprint too — the exact fix for a floodplain pond reading ~0 berm fill on the old outward model.
    expect(bc.heatCells.length).toBeGreaterThan(0);
    expect(bc.heatCells.every((c) => pointInRing({ x: c.x, y: c.y }, ring))).toBe(true);
  });

  it("TOB at/below grade → no berm (dormant), never a zero-height ring polluting ledgers", () => {
    const bc = bermFillCells(ring, { tobElev: 96 }, { gradeAt: flat96, ratio: 3 });
    expect(bc.volCf).toBe(0);
    expect(bc.cells).toEqual([]);
    expect(bc.heatCells).toEqual([]);
    expect(bc.landTakeSf).toBe(0);
  });

  it("below-WSE cells in a trigger zone become heat cells whose sum ties to the flood contribution", () => {
    // Flood WSE at 99 → below-WSE slice of the berm (grade 96 → 99). triggerClassAt = everywhere "1pct".
    const bc = bermFillCells(ring, { tobElev: 100 }, { gradeAt: flat96, wseFt: 99, ratio: 3, triggerClassAt: () => "1pct", fpId: "berm:p1" });
    expect(bc.heatCells.length).toBeGreaterThan(0);
    expect(bc.heatCells.every((c) => c.cls === "1pct" && c.fpId === "berm:p1" && c.depthFt > 0)).toBe(true);
    // Engine-truth tie-out: Σ (heat cell area × depthFt) === floodCf.
    const sum = bc.heatCells.reduce((s, c) => s + c.wFt * c.hFt * c.depthFt, 0);
    expect(sum).toBeCloseTo(bc.floodCf, 3);
    expect(bc.floodCf).toBeGreaterThan(0);
    expect(bc.floodCf).toBeLessThanOrEqual(bc.volCf + 1e-6); // below-WSE ≤ total fill
  });

  it("no trigger sampler → no floodplain fill priced (upland berm is earthwork-only)", () => {
    const bc = bermFillCells(ring, { tobElev: 100 }, { gradeAt: flat96, wseFt: 99, ratio: 3, triggerClassAt: null });
    expect(bc.floodCf).toBe(0);
    expect(bc.heatCells).toEqual([]);
    expect(bc.volCf).toBeGreaterThan(0); // still real earthwork
  });

  it("a per-cell grade that already clears the TOB on one side yields no berm there (height varies)", () => {
    // Grade ramps 92 → 104 across x; the berm exists only where grade < TOB (100).
    const ramp = (pt) => 92 + (pt.x / 200) * 12;
    const bc = bermFillCells(ring, { tobElev: 100 }, { gradeAt: ramp, ratio: 3 });
    expect(bc.volCf).toBeGreaterThan(0);
    // No berm cell should sit where local grade already meets/clears the crest.
    expect(bc.cells.every((c) => ramp(c) < 100 + 1e-6)).toBe(true);
  });

  it("degenerate input → null (no ring / no grade sampler / no TOB)", () => {
    expect(bermFillCells(null, { tobElev: 100 }, { gradeAt: flat96 })).toBeNull();
    expect(bermFillCells(ring, {}, { gradeAt: flat96 })).toBeNull();
    expect(bermFillCells(ring, { tobElev: 100 }, { gradeAt: null })).toBeNull();
  });
});
