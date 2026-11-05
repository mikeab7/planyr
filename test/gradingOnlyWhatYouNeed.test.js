// NEW-1 (2026-11-04, owner, Georgia Test Site › Concept A): GRADING FLATTENED THE WHOLE PARCEL TO THE PROPERTY LINE.
// The owner saw Cut 804,400 / Fill 808,100 CY, a 31-ft cut and a 54-ft fill, one flat plateau between the parking and the band at the
// property line, and no proposed contours anywhere inside — "grading only what you need" (the Falcon Design Tomochichi sheet) was the
// ask. "Limits of disturbance" is a FENCE grading may not cross, not the area that gets graded; the app had read it as the retired
// "To the boundary" mode (the whole fenced parcel) since #2771 / #2775.
//
// RED-PROOF: every assertion in the first describe goes through the APP's own path — `gradingCfg(storedSettings)` (no engine opts) →
// `gradingPack` → `buildProposedSurface` — on the owner's Concept A over the REAL Chehaw ground. On main before this change the cfg is
// "boundary", the graded area is the whole fenced parcel (72.4 AC) and the earthwork is ~2× — this file fails there.
import { describe, it, expect } from "vitest";
import { chehawInputs } from "../ui-audit/lib/chehawSurfaceNode.mjs";
import { buildProposedSurface, sampleProposedAt } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { gradingCfg, gradingPack, GRADING_DEFAULTS } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { propertyLimit, regionsAreaSf, unionRings, pointInRegions } from "../src/workspaces/site-planner/lib/gradingLimit.js";
import { describeFlag, spotElevationsFor, courtDropReadout } from "../src/workspaces/site-planner/lib/buildingGrade.js";
import { limitFlagSentence } from "../src/workspaces/site-planner/lib/gradingPanelModel.js";
import { SQFT_PER_ACRE } from "../src/shared/units/areaUnits.js";

const { inputs } = chehawInputs({ owner: 2 });
const FFE = 793;   // a floor the engine balances near on this ground (the live suggestion moves with the layout; the claims below do not depend on it)

/* Build Concept A through the app's own config path. `stored` = what a plan saved in settings.grading; `engine` = engine-only opts. */
function build({ stored = {}, ffe = FFE, dx = 0, dy = 0, tag = "" } = {}, engine = undefined) {
  const base = inputs(ffe, "layout", `gown${tag}${JSON.stringify(stored)}${ffe}${dx},${dy}`);
  base.els = base.els.map((e) => ({ ...e, ring: e.ring.map((p) => ({ x: p.x + dx, y: p.y + dy })), dockStack: e.dockStack ? { x: e.dockStack.x + dx, y: e.dockStack.y + dy } : e.dockStack }));
  const cfg = gradingCfg({ enabled: true, ...stored }, engine);
  const setback = { parcelRings: base.parcelRings, holes: [], rings: base.parcelRings };
  base.grading = gradingPack(cfg, setback);
  const s = buildProposedSurface(base);
  const fence = propertyLimit({ parcelRings: base.parcelRings, marginFt: cfg.gradingMarginFt, bufferFt: cfg.undisturbedBufferFt });
  const fenceAc = regionsAreaSf(unionRings(fence.rings)) / SQFT_PER_ACRE;
  const g = s.grid;
  let maxCut = 0, maxFill = 0;
  for (const c of g.cells) { if (c.dzFt == null) continue; if (c.dzFt > maxFill) maxFill = c.dzFt; if (-c.dzFt > maxCut) maxCut = -c.dzFt; }
  return { cfg, s, g, fenceAc, maxCut, maxFill, existAt: base.existAt, base };
}

describe("NEW-1 — the graded area is what the layout needs; the property line ± N ft is only the fence (the app's own path)", () => {
  const A = build();            // the plan as the owner has it: stored margin 10 ft inside the line (panel −10), nothing else stored
  // the retired whole-parcel limit, reachable only through the engine opt (what main's app path produced)
  const OLD = build({ stored: { limitMode: "boundary" } }, { engineBoundary: true });

  it("the default limit is the layout's outline, not the fenced parcel: roughly half the acres, never the property line", () => {
    expect(A.cfg.limitMode).toBe("layout");
    expect(A.g.limit.mode).toBe("layout");
    expect(A.g.limit.areaAc).toBeGreaterThan(5);
    expect(A.g.limit.areaAc).toBeLessThan(0.6 * A.fenceAc);                   // 36 of 72 AC; the old reading graded all 72
    expect(OLD.g.limit.mode).toBe("boundary");                                // the instrument can see the old shape (known-bad arm)
    expect(OLD.g.limit.areaAc).toBeGreaterThan(0.95 * OLD.fenceAc);
  });
  it("earthwork and depths are about half of the whole-parcel grading's, in the owner's range, not ~800k CY each way", () => {
    expect(A.g.cutCy).toBeLessThan(0.65 * OLD.g.cutCy);
    expect(A.g.fillCy).toBeLessThan(0.6 * OLD.g.fillCy);
    expect(A.g.cutCy).toBeLessThan(500000); expect(A.g.fillCy).toBeLessThan(500000);
    expect(OLD.g.fillCy).toBeGreaterThan(800000);                             // the owner's ~808k–938k
    expect(A.maxFill).toBeLessThan(OLD.maxFill - 8);                          // the 49-ft fill at the open ground is gone
    expect(A.maxCut).toBeLessThanOrEqual(OLD.maxCut + 0.5);
  });
  it("ground the layout does not need stays EXISTING: far from every element, on the property, the readout is 'On grade' and nothing is graded there", () => {
    // property points more than 250 ft from every graded outline's box — the layout does not need them
    const rings = A.base.parcelRings;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) for (const p of r) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const farFromLayout = (pt) => A.g.owners.every((o) => pt.x < o.bbox[0] - 250 || pt.x > o.bbox[2] + 250 || pt.y < o.bbox[1] - 250 || pt.y > o.bbox[3] + 250);
    const far = [];
    for (let x = x0; x <= x1; x += 60) for (let y = y0; y <= y1; y += 60) {
      const pt = { x, y };
      if (rings.some((r) => pointInRegionsRing(pt, r)) && farFromLayout(pt)) far.push(pt);
    }
    expect(far.length).toBeGreaterThan(20);                     // the instrument can find ungraded property (known-good arm: the old reading has none)
    for (const pt of far) {
      const smp = sampleProposedAt(A.g, pt, A.existAt);
      expect(smp.status).toBe("value"); expect(smp.undisturbed).toBe(true);
      expect(smp.ft).toBeCloseTo(A.existAt(pt), 6);
    }
    expect(far.filter((pt) => sampleProposedAt(OLD.g, pt, OLD.existAt).undisturbed).length).toBeLessThan(far.length / 2);   // whole-parcel grading graded them
    // every open-ground (infill) cell is inside the limit; the rest are elements and the thrown slope — none is open parcel the layout does not reach
    const stray = A.g.cells.filter((c) => c.cls === "infill" && !pointInRegions(c, A.g.limit.regions));
    expect(stray).toEqual([]);
  });
  it("a plan #2775 converted to 'boundary' (or saved on 'layout' with no outline) computes under the new rule WITHOUT being re-saved", () => {
    const sig = (r) => [r.g.limit.sig, Math.round(r.g.cutCy), Math.round(r.g.fillCy), r.g.limit.areaAc.toFixed(3)].join("|");
    for (const stored of [{ limitMode: "boundary" }, { limitMode: "layout" }, { limitMode: "boundary", gradingMarginFt: 10 }]) {
      const r = build({ stored });
      expect(r.cfg.limitMode).toBe("layout");
      expect(sig(r)).toBe(sig(A));
    }
  });
});

describe("NEW-1 — Limits of disturbance is a hard FENCE, not a target (Concept A at −10 / +20 / −40, 2:1 / 3:1 / 4:1)", () => {
  const at = (offset, extra = {}) => build({ stored: { gradingMarginFt: -offset, ...extra }, tag: `o${offset}` });
  const m10 = at(-10), p20 = at(20), m40 = at(-40);
  it("moving the fence moves the fence only: the graded area and the earthwork are IDENTICAL at −10, +20 and −40 while the fence area changes", () => {
    for (const r of [p20, m40]) {
      expect(r.g.limit.areaAc).toBeCloseTo(m10.g.limit.areaAc, 6);
      expect(Math.round(r.g.cutCy)).toBe(Math.round(m10.g.cutCy));
      expect(Math.round(r.g.fillCy)).toBe(Math.round(m10.g.fillCy));
    }
    expect(p20.fenceAc).toBeGreaterThan(m10.fenceAc + 3);
    expect(m40.fenceAc).toBeLessThan(m10.fenceAc - 3);
  });
  it("at those fences no slope crosses it, so nothing is flagged", () => {
    for (const r of [m10, p20, m40]) { expect(r.g.outside.count).toBe(0); expect(describeFlag({ grid: r.g }, [])).toBeNull(); }
  });
  it("a fence pulled in far enough to meet the slopes (panel −400) DOES flag, naming the place the slope lands", () => {
    const tight = at(-400);
    expect(tight.g.outside.count).toBeGreaterThan(0);
    const f = describeFlag({ grid: tight.g }, []);
    expect(f).toBeTruthy(); expect(f.limit).toBe(true);
    expect(f.place).toMatch(/grading margin|buffer|property line/);
    expect(limitFlagSentence(f)).toMatch(/slope runs \d+ ft /);
    expect(tight.g.limit.areaAc).toBeLessThanOrEqual(m10.g.limit.areaAc + 1e-6);   // the graded area is clipped to the fence, never grown to fill it
  });
  it("3:1 and 4:1 widen only the slopes: the graded area is unchanged, the earthwork grows, the daylight reaches further", () => {
    const r2 = m10, r3 = build({ stored: { slopeRatio: 3 } }), r4 = build({ stored: { slopeRatio: 4 } });
    expect(r3.g.limit.areaAc).toBeCloseTo(r2.g.limit.areaAc, 6); expect(r4.g.limit.areaAc).toBeCloseTo(r2.g.limit.areaAc, 6);
    expect(r3.g.cutCy + r3.g.fillCy).toBeGreaterThan(r2.g.cutCy + r2.g.fillCy);
    expect(r4.g.cutCy + r4.g.fillCy).toBeGreaterThan(r3.g.cutCy + r3.g.fillCy);
    expect(r4.g.wedgeSf).toBeGreaterThan(r2.g.wedgeSf);
    // and each is still far below the whole-parcel grading at 2:1
    expect(r4.g.fillCy).toBeLessThan(build({ stored: { limitMode: "boundary" } }, { engineBoundary: true }).g.fillCy);
  });
  it("the building dragged toward the south line trips the fence flag; dragged back, the flag goes and the numbers return exactly", () => {
    const counts = [0, 100, 200, 300].map((dy) => build({ dy }).g.outside.count);
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBeGreaterThan(0);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    const near = build({ dy: 100 });
    const flag = describeFlag({ grid: near.g }, []);
    expect(flag && flag.kind).toBe("fill");
    const back = build({ dy: 0, tag: "back" });
    expect(back.g.outside.count).toBe(0);
    expect(Math.round(back.g.cutCy)).toBe(Math.round(A_().g.cutCy));
    expect(Math.round(back.g.fillCy)).toBe(Math.round(A_().g.fillCy));
  });
});

describe("NEW-1 — Grand Port › Concept A shape (the real parcel ring, a synthetic ridge ground; the real-ground run is the live V#)", () => {
  // Same claims on a second parcel: the graded area follows the layout, the fence follows the line.
  it("a layout in the middle of the Grand Port parcel grades a fraction of it and flags nothing at −10; the whole-parcel mode graded all of it", async () => {
    const { readFileSync } = await import("node:fs");
    const G = JSON.parse(readFileSync(new URL("./fixtures/grandPortParcel.json", import.meta.url)));
    const pts = G.points.map((p) => ({ x: p.x, y: p.y }));
    // the parcel is a concave 100-AC shape (its centroid is NOT inside it); the layout goes at its deepest interior point (765 ft from every edge)
    const cx = -898, cy = -450;
    const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    const els = [
      { id: "b1", type: "building", ring: rect(cx - 250, cy - 200, 500, 250), dockStack: null, accessible: false, slopeOverridePct: null, padElevFt: 101 },
      { id: "c1", type: "paving", truckCourt: true, ring: rect(cx - 250, cy + 50, 500, 130), dockStack: { x: cx, y: cy + 50 }, accessible: false, slopeOverridePct: null, padElevFt: null, hostId: "b1" },
    ];
    const existAt = (p) => 100 + 0.012 * (p.x - cx) + 0.02 * (p.y - cy);
    const run = (stored, engine) => {
      const cfg = gradingCfg({ enabled: true, ...stored }, engine);
      const setback = { parcelRings: [pts], holes: [], rings: [pts] };
      return buildProposedSurface({ els, ffeFt: null, dockDropFt: 4, existAt, parcelRings: [pts], pondRings: [], easementRings: [], opts: { existKey: `gp${JSON.stringify(stored)}${!!engine}` }, grading: gradingPack(cfg, setback) }).grid;
    };
    const gA = run({}), gOld = run({ limitMode: "boundary" }, { engineBoundary: true });
    const parcelAc = regionsAreaSf(unionRings([pts])) / SQFT_PER_ACRE;
    expect(gA.limit.mode).toBe("layout");
    expect(gA.limit.areaAc).toBeLessThan(0.5 * parcelAc);
    expect(gOld.limit.areaAc).toBeGreaterThan(0.85 * parcelAc);
    expect(gA.outside.count).toBe(0);
    expect(gA.cutCy + gA.fillCy).toBeLessThan(0.5 * (gOld.cutCy + gOld.fillCy));
  });
});

describe("NEW-2 — the dock-face spot is FFE − the dock-drop setting; a trailer row out along the fall is a ROW, never a 'dock' (the owner's 784.5)", () => {
  // The owner's screenshot: FFE 790.5, a spot "dock 784.5" = a 6 ft drop on a plan whose drop is the 4 ft default. The truck court itself
  // reads 786.5 (= 790.5 − 4); the 784.5 was a TRAILER ROW (same dock-apron plane family, 1.5 % fall off the wall) whose near edge sits
  // ~130 ft out — 2 ft lower — and was labelled "dock" like the court.
  const run = (dockDropFt) => {
    const base = inputs(790.5, "layout", `n2${dockDropFt}`);
    base.dockDropFt = dockDropFt;
    base.grading = gradingPack(gradingCfg({ enabled: true }), { parcelRings: base.parcelRings, holes: [], rings: base.parcelRings });
    const s = buildProposedSurface(base);
    const out = [];
    for (const [id, plane] of s.planes) {
      if (plane.classId !== "dockApron" || !plane.wall) continue;
      const owner = s.grid.owners.find((o) => o.el.id === id), el = base.els.find((e) => e.id === id);
      out.push({ id, type: el.type, spot: spotElevationsFor(plane, el.ring, (pt) => s.grid.zOf(owner, pt)) });
    }
    return out;
  };
  it("every court that TOUCHES the dock wall reads exactly FFE − dockDrop at its face, and says 'dock' (4 ft default → 786.5; a plan set to 6 → 784.5)", () => {
    for (const [drop, face] of [[4, 786.5], [6, 784.5], [3.5, 787]]) {
      const courts = run(drop).filter((x) => x.type !== "trailer");
      expect(courts.length).toBeGreaterThan(0);
      for (const c of courts) { expect(c.spot.face.atWall).toBe(true); expect(c.spot.face.z).toBeCloseTo(face, 1); expect(c.spot.face.label).toBe(`dock ${face.toFixed(1)}`); }
    }
  });
  it("a trailer row is labelled 'row', not 'dock': its near edge is lower along the fall, and it is not a dock face", () => {
    const rows = run(4).filter((x) => x.type === "trailer");
    expect(rows.length).toBeGreaterThan(0);                                           // known-good arm: the fixture HAS trailer rows
    for (const r of rows) { expect(r.spot.face.atWall).toBe(false); expect(r.spot.face.label).toMatch(/^row /); expect(r.spot.face.z).toBeLessThan(786.5 - 1); }
    // the owner's number: that row edge reads 784.5 while the court beside it reads 786.5
    expect(rows.some((r) => Math.abs(r.spot.face.z - 784.5) < 0.1)).toBe(true);
    expect(run(4).some((x) => x.type !== "trailer" && courtDropReadout(x.spot).startsWith("786.5"))).toBe(true);
  });
});

describe("NEW-1 — plumbing that must not drift", () => {
  it("the stored default is the layout limit and no panel mode control comes back", () => {
    expect(GRADING_DEFAULTS.limitMode).toBe("layout");
    expect(gradingCfg(undefined).limitMode).toBe("layout");
    expect(gradingCfg({ limitMode: "boundary" }).limitMode).toBe("layout");
  });
});

// helpers kept at the bottom so the describes read top-down
function A_() { return build(); }
function pointInRegionsRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
