// B826 — the proposed-surface engine: per-element plane math (closed forms), the
// composite cut/fill lattice (voids honest, ponds excluded, PL checks), violation
// classing (ADA legal vs screening, judged vs the BASE rule so an override never
// launders a breach), the balance assist's convergence + honest clamps, and the
// mitigation engine's surface basis (fp.surfaceAt replaces the flat pad, labeled).
import { describe, it, expect } from "vitest";
import {
  classifyGradeElement, slopeBand, buildPlanes, surfaceGrid, surfaceViolations,
  buildProposedSurface, balanceAssist, netImportCy, nearestOnRing, distToRingEdges,
  TIE_DROP_FT, DOCK_BREAK_FT,
} from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { computeMitigation, combineMitigation } from "../src/workspaces/site-planner/lib/floodplainMitigation.js";
import { DEFAULT_FLOODPLAIN_RULES } from "../src/workspaces/site-planner/lib/floodplainRules.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const FFE = 100;

describe("classing + bands", () => {
  it("maps element types to B825 surface classes (dock stack wins its type)", () => {
    expect(classifyGradeElement({ type: "building" })).toBe("buildingPad");
    expect(classifyGradeElement({ type: "paving", dockStack: { x: 0, y: 0 } })).toBe("dockApron");
    expect(classifyGradeElement({ type: "trailer", dockStack: { x: 0, y: 0 } })).toBe("dockApron");
    expect(classifyGradeElement({ type: "trailer" })).toBe("trailerParking");
    expect(classifyGradeElement({ type: "parking" })).toBe("carParkingGeneral");
    expect(classifyGradeElement({ type: "parking", accessible: true })).toBe("carParkingAccessible");
    expect(classifyGradeElement({ type: "paving" })).toBe("driveAisles");
    expect(classifyGradeElement({ type: "landscape" })).toBeNull();
    expect(classifyGradeElement({ type: "pond" })).toBeNull();
  });
  it("a class without a published min inherits the 1% paved drainage floor", () => {
    // carParkingAccessible publishes only the 2% legal cap
    expect(slopeBand("carParkingAccessible", { maxSlopePct: 2 })).toEqual({ min: 1, max: 2 });
    expect(slopeBand("buildingPad", { minSlopePct: 0, maxSlopePct: 0 })).toEqual({ min: 0, max: 0 });
  });
});

describe("plane math — closed forms", () => {
  it("building pad is flat at FFE; a per-element padElevFt override wins", () => {
    const { planes } = buildPlanes({ els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }], ffeFt: FFE });
    const p = planes.get("b");
    expect(p.slopePct).toBe(0);
    expect(p.zAt({ x: 3, y: 97 })).toBe(FFE);
    const o = buildPlanes({ els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100), padElevFt: 96.5 }], ffeFt: FFE });
    expect(o.planes.get("b").zAt({ x: 50, y: 50 })).toBe(96.5);
  });
  it("dock court: anchor at the dock FACE (edge projection), FFE − drop, falling away at the band floor", () => {
    // building centered (−50,50): court to its east, x∈[0,60] — the face is x=0, mid (0,50)
    const els = [
      { id: "b", type: "building", ring: rect(-100, 0, 100, 100) },
      { id: "c", type: "paving", ring: rect(0, 0, 60, 100), dockStack: { x: -50, y: 50 } },
    ];
    const { planes } = buildPlanes({ els, ffeFt: FFE, dockDropFt: 4 });
    const p = planes.get("c");
    expect(p.baseElevFt).toBe(96);
    expect(p.slopePct).toBe(1); // dockApron band floor — courts don't ride the balance sweep
    expect(p.zAt({ x: 0, y: 50 })).toBeCloseTo(96, 9);
    expect(p.zAt({ x: 30, y: 50 })).toBeCloseTo(96 - 0.3, 9); // 1% over 30 ft, away from the building
  });
  it("paving ties at FFE − 0.15′ at the nearest building edge and falls toward the drain target", () => {
    const els = [
      { id: "b", type: "building", ring: rect(-100, 0, 100, 100) },
      { id: "p", type: "paving", ring: rect(0, 0, 100, 100) },
    ];
    const { planes } = buildPlanes({ els, ffeFt: FFE, drainTarget: { x: 300, y: 50 } });
    const p = planes.get("p");
    expect(p.baseElevFt).toBeCloseTo(FFE - TIE_DROP_FT, 9);
    expect(p.anchor.x).toBeCloseTo(0, 6); // the shared edge, not a corner
    expect(p.zAt({ x: 0, y: 50 })).toBeCloseTo(99.85, 9);
    expect(p.zAt({ x: 100, y: 50 })).toBeCloseTo(99.85 - 1, 9); // driveAisles floor 1% toward +x
  });
  it("fieldT sweeps the floating band floor→cap; overrides pin the slope; docks/pads don't float", () => {
    const els = [
      { id: "b", type: "building", ring: rect(-100, 0, 100, 100) },
      { id: "p", type: "paving", ring: rect(0, 0, 100, 100) },
      { id: "c", type: "paving", ring: rect(0, -110, 60, 100), dockStack: { x: -50, y: 50 } },
      { id: "q", type: "parking", ring: rect(120, 0, 50, 100), slopeOverridePct: 2.5 },
    ];
    const t1 = buildPlanes({ els, ffeFt: FFE, drainTarget: { x: 300, y: 50 }, fieldT: 1 });
    expect(t1.planes.get("p").slopePct).toBe(5);   // driveAisles cap
    expect(t1.planes.get("c").slopePct).toBe(1);   // dock court stays at its floor
    expect(t1.planes.get("q").slopePct).toBe(2.5); // override pins regardless of t
    expect(t1.planes.get("b").slopePct).toBe(0);
  });
  it("nearestOnRing projects onto edges; distToRingEdges takes the min across rings", () => {
    const q = nearestOnRing({ x: -10, y: 50 }, rect(0, 0, 100, 100));
    expect(q.x).toBeCloseTo(0, 9);
    expect(q.y).toBeCloseTo(50, 9);
    expect(distToRingEdges({ x: 50, y: 50 }, [rect(0, 0, 100, 100)])).toBeCloseTo(50, 9);
  });
});

describe("composite grid — engine truth", () => {
  const flatExist = (v) => () => v;
  it("flat pad over flat ground: fill = depth × area within lattice tolerance", () => {
    const s = buildProposedSurface({
      els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flatExist(96),
    });
    expect(s.grid.fillCf).toBeGreaterThan(40000 * 0.98);
    expect(s.grid.fillCf).toBeLessThan(40000 * 1.02);
    expect(s.grid.cutCf).toBe(0);
    expect(s.grid.cells.length).toBeGreaterThan(0);
    // tie-out by construction: Σ retained cells === the totals
    const sum = s.grid.cells.reduce((a, c) => a + (c.dzFt > 0 ? c.wFt * c.hFt * c.dzFt : 0), 0);
    expect(Math.abs(sum - s.grid.fillCf)).toBeLessThan(1e-6 * s.grid.fillCf);
  });
  it("a tilted paving plane splits cut and fill at the closed-form line", () => {
    // tie 99.85 at x=0 falling 1% toward +x over flat ground 99.4 → dz = 0.45 − 0.01x:
    // fill = 100·∫0..45 = 1012.5 cf, cut = 100·∫45..100 = 1512.5 cf
    const s = buildProposedSurface({
      els: [
        { id: "b", type: "building", ring: rect(-100, 0, 100, 100), padElevFt: 99.4 }, // pad on grade — contributes 0
        { id: "p", type: "paving", ring: rect(0, 0, 100, 100) },
      ],
      ffeFt: FFE, drainTarget: { x: 300, y: 50 }, existAt: flatExist(99.4),
      opts: { maxCells: 8000, minCellFt: 1 },
    });
    expect(s.grid.fillCf).toBeGreaterThan(1012.5 * 0.93);
    expect(s.grid.fillCf).toBeLessThan(1012.5 * 1.07);
    expect(s.grid.cutCf).toBeGreaterThan(1512.5 * 0.93);
    expect(s.grid.cutCf).toBeLessThan(1512.5 * 1.07);
  });
  it("DEM voids are excluded + counted; NO ground at all → honest UNKNOWN (null CY), never 0", () => {
    const holey = (pt) => (pt.x < 20 ? null : 96);
    const s = buildProposedSurface({ els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }], ffeFt: FFE, existAt: holey });
    expect(s.grid.voidCells).toBeGreaterThan(0);
    expect(s.grid.fillCf).toBeGreaterThan(32000 * 0.95); // 4 ft × ~80%
    const blind = buildProposedSurface({ els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }], ffeFt: FFE, existAt: null });
    expect(blind.grid.fillCy).toBeNull();
    expect(blind.grid.cutCy).toBeNull();
    expect(blind.grid.cells.every((c) => c.dzFt === null)).toBe(true);
  });
  it("pond interiors are excluded — pond dirt is the excavation ledger's, never double-priced", () => {
    const full = buildProposedSurface({ els: [{ id: "p", type: "paving", ring: rect(0, 0, 100, 100) }], ffeFt: FFE, existAt: flatExist(96) });
    const half = buildProposedSurface({
      els: [{ id: "p", type: "paving", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flatExist(96), pondRings: [rect(50, 0, 50, 100)],
    });
    expect(half.grid.gradedSf).toBeLessThan(full.grid.gradedSf * 0.55);
  });
  it("no FFE anywhere → null (nothing fabricated)", () => {
    expect(buildProposedSurface({ els: [{ id: "p", type: "paving", ring: rect(0, 0, 100, 100) }], ffeFt: null, existAt: flatExist(96) })).toBeNull();
  });
});

describe("violations — legal vs screening, judged vs the BASE rule", () => {
  const flatExist = (v) => () => v;
  it("a 3% override on ACCESSIBLE parking trips the ADA legal flag (the override never moves the law)", () => {
    const s = buildProposedSurface({
      els: [{ id: "q", type: "parking", ring: rect(0, 0, 50, 100), accessible: true, slopeOverridePct: 3 }],
      ffeFt: FFE, existAt: flatExist(96),
    });
    const ada = s.violations.find((v) => v.kind === "ada");
    expect(ada).toBeTruthy();
    expect(ada.legal).toBe(true);
    expect(ada.short).toMatch(/ADA\/TAS/);
    // the same 3% on GENERAL parking (band 1–3%) is fine
    const g = buildProposedSurface({
      els: [{ id: "q", type: "parking", ring: rect(0, 0, 50, 100), slopeOverridePct: 3 }],
      ffeFt: FFE, existAt: flatExist(96),
    });
    expect(g.violations.find((v) => v.kind === "ada" || v.kind === "over-max")).toBeUndefined();
  });
  it("under the drainage floor → screening 'ponding' flag; over the class cap → screening flag", () => {
    const under = buildProposedSurface({ els: [{ id: "p", type: "paving", ring: rect(0, 0, 100, 100), slopeOverridePct: 0.5 }], ffeFt: FFE, existAt: flatExist(96) });
    expect(under.violations.find((v) => v.kind === "under-min")).toBeTruthy();
    const over = buildProposedSurface({ els: [{ id: "p", type: "paving", ring: rect(0, 0, 100, 100), slopeOverridePct: 7 }], ffeFt: FFE, existAt: flatExist(96) });
    const om = over.violations.find((v) => v.kind === "over-max");
    expect(om).toBeTruthy();
    expect(om.legal).toBe(false);
  });
  it("fill outside the parcel → pl-fill; tall fill flush to the PL → tie-short (3:1 doesn't fit)", () => {
    // paving x∈[0,100] but the parcel ends at x=80 → 20 ft strip of offsite fill
    const out = buildProposedSurface({
      els: [{ id: "p", type: "paving", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flatExist(96), parcelRings: [rect(-200, -200, 280, 400)],
    });
    expect(out.violations.find((v) => v.kind === "pl-fill")).toBeTruthy();
    // ~3.85 ft of fill flush to a parcel edge at x=100 needs ~11.6 ft of tie run
    const tight = buildProposedSurface({
      els: [{ id: "p", type: "paving", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flatExist(96), parcelRings: [rect(-200, -200, 300, 400)],
    });
    expect(tight.violations.find((v) => v.kind === "tie-short")).toBeTruthy();
    // plenty of parcel beyond the paving → neither flag
    const roomy = buildProposedSurface({
      els: [{ id: "p", type: "paving", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flatExist(99.5), parcelRings: [rect(-200, -200, 500, 400)],
    });
    expect(roomy.violations.find((v) => v.kind === "pl-fill" || v.kind === "tie-short")).toBeUndefined();
  });
  it("adjoining pavement stepping at a court edge → dock-break; the dock WALL itself is exempt", () => {
    const els = [
      { id: "b", type: "building", ring: rect(-100, 0, 100, 100) },
      { id: "c", type: "paving", ring: rect(0, 0, 60, 100), dockStack: { x: -50, y: 50 } }, // ~96 at the face
      { id: "p", type: "paving", ring: rect(60, 0, 60, 100) },                              // ties at 99.85 → ~4′ step at x=60
    ];
    const s = buildProposedSurface({ els, ffeFt: FFE, drainTarget: { x: 400, y: 50 }, existAt: flatExist(96) });
    const brk = s.violations.find((v) => v.kind === "dock-break");
    expect(brk).toBeTruthy();
    expect(s.grid.dockBreaks.maxFt).toBeGreaterThan(DOCK_BREAK_FT);
    // building↔court (the 4′ dock wall) alone must NOT flag
    const wallOnly = buildProposedSurface({ els: els.slice(0, 2), ffeFt: FFE, existAt: flatExist(96) });
    expect(wallOnly.violations.find((v) => v.kind === "dock-break")).toBeUndefined();
  });
  it("every violation one-liner respects the B823 ≤110-char cap", () => {
    const s = buildProposedSurface({
      els: [
        { id: "q", type: "parking", ring: rect(0, 0, 50, 100), accessible: true, slopeOverridePct: 3 },
        { id: "p", type: "paving", ring: rect(60, 0, 100, 100), slopeOverridePct: 0.25 },
      ],
      ffeFt: FFE, existAt: () => 96, parcelRings: [rect(0, 0, 80, 100)],
    });
    expect(s.violations.length).toBeGreaterThan(0);
    for (const v of s.violations) expect(v.short.length).toBeLessThanOrEqual(110);
  });
});

describe("balance assist + net dirt", () => {
  const els = [
    { id: "b", type: "building", ring: rect(-100, 0, 100, 100), padElevFt: 99.85 },
    { id: "p", type: "paving", ring: rect(0, 0, 100, 100) },
  ];
  // Ground sits AT the pad under the building (x<0 → 99.85, zero pad dirt) so the
  // closed form below is purely the paving field's fill.
  const mk = (existFt, borrowCy = 0, shrinkFactor = 1) => balanceAssist({
    buildAtT: (t) => buildProposedSurface({
      els, ffeFt: FFE, drainTarget: { x: 400, y: 50 }, fieldT: t,
      existAt: (pt) => (pt.x < 0 ? 99.85 : existFt), opts: { maxCells: 4000 },
    }).grid,
    shrinkFactor, borrowCy,
  });
  it("finds the in-band fieldT that nets ≈ 0 (fill balances the borrow)", () => {
    // paving plane: tie 99.85 − s(t)·x, exist 96: mean fill = 3.85 − s/2 ft (s = 1+4t %).
    // borrow 740.74 CY = 20,000 cf → mean fill 2.0 ft → t = 0.675.
    const r = mk(96, 20000 / 27);
    expect(r.achieved).toBe(true);
    expect(Math.abs(r.t - 0.675)).toBeLessThan(0.06);
    expect(Math.abs(r.netCy)).toBeLessThanOrEqual(10);
  });
  it("clamps honestly at the band edges and says which", () => {
    const imp = mk(90); // ~9 ft of fill — no in-band slope balances it
    expect(imp.t).toBe(1);
    expect(imp.clamped).toBe("steepest");
    expect(imp.netCy).toBeGreaterThan(0);
    const exp2 = mk(103); // ground above the tie — cut everywhere, flattest still exports
    expect(exp2.t).toBe(0);
    expect(exp2.clamped).toBe("flattest");
    expect(exp2.netCy).toBeLessThan(0);
  });
  it("returns null (never a guess) when the grid can't price", () => {
    expect(balanceAssist({ buildAtT: () => ({ fillCy: null, cutCy: null }) })).toBeNull();
  });
  it("netImportCy: shrink inflates the bank demand; borrow subtracts; sign = import/export", () => {
    expect(netImportCy({ fillCy: 100, cutCy: 40, borrowCy: 10 })).toBeCloseTo(50, 9);
    expect(netImportCy({ fillCy: 100, cutCy: 40, shrinkFactor: 1.2 })).toBeCloseTo(80, 9);
    expect(netImportCy({ fillCy: 10, cutCy: 40 })).toBeLessThan(0);
  });
});

describe("mitigation on the surface basis (fp.surfaceAt)", () => {
  const bboxOf = (rings) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of rings) for (const p of r) {
      if (p.x < a) a = p.x; if (p.x > c) c = p.x;
      if (p.y < b) b = p.y; if (p.y > d) d = p.y;
    }
    return [a, b, c, d];
  };
  const zone = { cls: "1pct", zone: "AE", subtype: "", staticBfeFt: 100, aoDepthFt: null, vdatum: null, unstudiedA: false, rings: [rect(-50, -50, 400, 400)], bbox: bboxOf([rect(-50, -50, 400, 400)]) };
  const harris = { ...DEFAULT_FLOODPLAIN_RULES.harris, verified: true }; // 1:1
  const ring = rect(0, 0, 100, 100);
  it("prices min(WSE, surface(pt)) − grade per cell and labels the basis", () => {
    // surface 98 − 0.02x (98→96), grade 94, WSE 100 → depth = 4 − 0.02x → 30,000 cf
    const surfaceAt = (pt) => 98 - 0.02 * pt.x;
    const r = computeMitigation({
      footprints: [{ id: "f", ring, surfaceAt }],
      zones: [zone], rule: harris,
      elev: { padElevFt: 98, existGradeFt: 94, gradeAt: () => 94, sources: { existGrade: "3dep" } },
    });
    expect(r.padBasis).toBe("surface");
    expect(r.providers.padElev).toBe("proposed-surface");
    expect(r.volumeCf).toBeGreaterThan(30000 * 0.99);
    expect(r.volumeCf).toBeLessThan(30000 * 1.01);
    // flat-pad comparison (pad 98 flat → 4 ft everywhere → 40,000 cf) rides along…
    expect(r.volumeFlatCf).toBeGreaterThan(40000 * 0.99);
    // …but the delta flag is SUPPRESSED on a surface basis (expected difference, not a warning)
    expect(r.flags).not.toContain("grid-median-delta");
  });
  it("surface basis works on the flat-median grade too (per-cell surface, scalar ground)", () => {
    const r = computeMitigation({
      footprints: [{ id: "f", ring, surfaceAt: (pt) => 98 - 0.02 * pt.x }],
      zones: [zone], rule: harris,
      elev: { padElevFt: 98, existGradeFt: 94, sources: { existGrade: "3dep" } },
    });
    expect(r.padBasis).toBe("surface");
    expect(r.volumeCf).toBeGreaterThan(30000 * 0.98);
    expect(r.volumeCf).toBeLessThan(30000 * 1.02);
  });
  it("no surfaceAt → flat basis, labels unchanged (back-compat)", () => {
    const r = computeMitigation({
      footprints: [{ id: "f", ring }],
      zones: [zone], rule: harris,
      elev: { padElevFt: 98, existGradeFt: 94, sources: { existGrade: "3dep" } },
    });
    expect(r.padBasis).toBe("flat");
    expect(r.providers.padElev).toBe("manual");
  });
  it("combineMitigation: any surface part makes the combined basis 'surface' and keeps the flag suppressed", () => {
    const a = computeMitigation({ footprints: [{ id: "a", ring, surfaceAt: () => 96 }], zones: [zone], rule: harris, elev: { padElevFt: 98, existGradeFt: 94, gradeAt: () => 94, sources: { existGrade: "3dep" } } });
    const b = computeMitigation({ footprints: [{ id: "b", ring: rect(150, 0, 50, 50) }], zones: [zone], rule: harris, elev: { padElevFt: 98, existGradeFt: 94, gradeAt: () => 94, sources: { existGrade: "3dep" } } });
    const out = combineMitigation([a, b]);
    expect(out.padBasis).toBe("surface");
    expect(out.flags).not.toContain("grid-median-delta");
  });
});
