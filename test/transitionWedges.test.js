// B833 (pond-roles branch, chat NEW-14) — transition wedges are real fill: the apron
// cells off every graded edge, the daylight line, the daylight-ASAP plane preference,
// wedge mitigation pricing, easement/PL crossings, and berm-as-fill. Pure — no browser.
import { describe, it, expect } from "vitest";
import { buildProposedSurface, daylightRings } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { wedgeMitigation, zoneWaterSurface } from "../src/workspaces/site-planner/lib/floodplainMitigation.js";
import { bermFillVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const FFE = 100;
const flat = (v) => () => v;
const OPTS = { maxCells: 12000, minCellFt: 1 };

describe("transition wedges — the daylight fringe joins the grid (B833 a)", () => {
  it("a 1-ft pad over flat ground grows a ~perimeter × h²·ratio/2 fill fringe at 3:1", () => {
    // 100×100 pad at FFE 100 over ground 99 → edge drop 1 ft → wedge cross-section
    // 1×3/2 = 1.5 sf → volume ≈ 400 × 1.5 = 600 cf (corners add a little).
    const s = buildProposedSurface({
      els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flat(99), opts: OPTS,
    });
    expect(s.grid.wedgeFillCf).toBeGreaterThan(600 * 0.85);
    expect(s.grid.wedgeFillCf).toBeLessThan(600 * 1.35);
    // the wedge is INSIDE the grid totals (engine truth): footprint fill = 10 000 cf
    expect(s.grid.fillCf).toBeCloseTo(10000 + s.grid.wedgeFillCf, -3);
    // wedge cells carry their own elevations for downstream pricing
    const w = s.grid.cells.find((c) => c.wedge && c.dzFt > 0);
    expect(w.cls).toBe("transition");
    expect(w.propFt).toBeCloseTo(w.gFt + w.dzFt, 9);
  });
  it("a 4:1 apron takes MORE room and MORE fill than 3:1 (the mowable preference)", () => {
    const at = (ratio) => buildProposedSurface({
      els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flat(99), opts: { ...OPTS, apronRatio: ratio },
    }).grid.wedgeFillCf;
    expect(at(4)).toBeGreaterThan(at(3) * 1.2);
  });
  it("the taper daylights: no wedge cells beyond drop × ratio from the edge", () => {
    const s = buildProposedSurface({
      els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flat(99), opts: OPTS,
    });
    for (const c of s.grid.cells) {
      if (!c.wedge || c.dzFt == null) continue;
      const dEdge = Math.max(0 - c.x, c.x - 100, 0 - c.y, c.y - 100);
      expect(dEdge).toBeLessThanOrEqual(3 * 1 + 1.5); // 3:1 × 1 ft + a cell of slack
    }
  });
  it("a cut pad (below grade) grows a CUT fringe — the taper works both ways", () => {
    const s = buildProposedSurface({
      els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100), padElevFt: 98 }],
      ffeFt: FFE, existAt: flat(99), opts: OPTS,
    });
    expect(s.grid.wedgeCutCf).toBeGreaterThan(600 * 0.85);
    expect(s.grid.wedgeFillCf).toBe(0);
  });
  it("aprons:false restores the footprint-only grid (the legacy closed forms)", () => {
    const s = buildProposedSurface({
      els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flat(99), opts: { ...OPTS, aprons: false },
    });
    expect(s.grid.wedgeFillCf).toBe(0);
    expect(s.grid.fillCf).toBeCloseTo(10000, -3);
  });
  it("wedge fill outside the parcel joins plFillSf; inside a drawn easement flags wedge-easement", () => {
    // Parcel hugs the pad exactly → the whole fringe is outside the PL. A separate
    // run with an easement strip across the east fringe trips the new violation.
    const pad = rect(0, 0, 100, 100);
    const s = buildProposedSurface({
      els: [{ id: "b", type: "building", ring: pad }],
      ffeFt: FFE, existAt: flat(98), parcelRings: [pad], opts: OPTS,
    });
    expect(s.grid.plFillSf).toBeGreaterThan(0);
    expect(s.violations.find((v) => v.kind === "pl-fill")).toBeTruthy();
    const s2 = buildProposedSurface({
      els: [{ id: "b", type: "building", ring: pad }],
      ffeFt: FFE, existAt: flat(98), parcelRings: [rect(-200, -200, 500, 500)],
      easementRings: [rect(100, 0, 8, 100)], opts: OPTS,
    });
    expect(s2.grid.wedgeEasementSf).toBeGreaterThan(200);
    const v = s2.violations.find((x) => x.kind === "wedge-easement");
    expect(v).toBeTruthy();
    expect(v.short.length).toBeLessThanOrEqual(110);
  });
});

describe("daylight line + daylight-ASAP (B833 b, c)", () => {
  it("daylightRings offsets each sample outward by |Δz| × ratio", () => {
    const s = buildProposedSurface({
      els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flat(99), opts: OPTS,
    });
    expect(s.daylight).toHaveLength(1);
    const ring = s.daylight[0].ring;
    // 1 ft drop at 3:1 → every sample sits ~3 ft outside the pad edges
    for (const p of ring) {
      const dEdge = Math.max(0 - p.x, p.x - 100, 0 - p.y, p.y - 100);
      expect(dEdge).toBeGreaterThan(2.5);
      expect(dEdge).toBeLessThan(3.5);
    }
    // standalone helper agrees
    const dl = daylightRings({ planes: s.planes, els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }], existAt: flat(99), apronRatio: 3 });
    expect(dl[0].ring.length).toBe(ring.length);
  });
  it("daylight ASAP pins floating fields at their class ceiling", () => {
    const els = [
      { id: "b", type: "building", ring: rect(-100, 0, 100, 100) },
      { id: "p", type: "paving", ring: rect(0, 0, 100, 100) },
    ];
    const off = buildProposedSurface({ els, ffeFt: FFE, drainTarget: { x: 400, y: 50 }, existAt: flat(99), opts: OPTS });
    const on = buildProposedSurface({ els, ffeFt: FFE, drainTarget: { x: 400, y: 50 }, daylightAsap: true, existAt: flat(99), opts: OPTS });
    expect(off.planes.get("p").slopePct).toBeCloseTo(1, 6);   // driveAisles floor
    expect(on.planes.get("p").slopePct).toBeCloseTo(5, 6);    // driveAisles cap
    expect(on.surfaceKey).not.toBe(off.surfaceKey);           // the memo can't serve a stale surface
  });
});

describe("wedgeMitigation — the fringe joins the required volume (B833 a)", () => {
  const zone = { cls: "1pct", rings: [rect(-50, -50, 300, 300)], staticBfeFt: 105, vdatum: "NAVD88" };
  const rule = { trigger: "1pct", ratio: 1, verified: true };
  it("WSE above the whole fringe → wedge volume ≈ the wedge fill × ratio", () => {
    const s = buildProposedSurface({
      els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flat(99), opts: OPTS,
    });
    const m = wedgeMitigation({ cells: s.grid.cells, zones: [zone], rule, elev: {} });
    expect(m.volumeCf).toBeCloseTo(s.grid.wedgeFillCf, -2);
    expect(m.cells.length).toBeGreaterThan(0);
    expect(m.cells[0].fpId).toBe("b:wedge");
    const m15 = wedgeMitigation({ cells: s.grid.cells, zones: [zone], rule: { ...rule, ratio: 1.5 }, elev: {} });
    expect(m15.volumeCf).toBeCloseTo(1.5 * m.volumeCf, -2);
  });
  it("no usable WSE → unknown area, never a fabricated volume; floodway fringe flags", () => {
    const s = buildProposedSurface({
      els: [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }],
      ffeFt: FFE, existAt: flat(99), opts: OPTS,
    });
    const unk = wedgeMitigation({ cells: s.grid.cells, zones: [{ cls: "1pct", rings: zone.rings }], rule, elev: {} });
    expect(unk.volumeCf).toBe(0);
    expect(unk.unknownSf).toBeGreaterThan(0);
    const fw = wedgeMitigation({ cells: s.grid.cells, zones: [{ cls: "floodway", rings: zone.rings }], rule, elev: {} });
    expect(fw.floodwaySf).toBeGreaterThan(0);
    expect(fw.volumeCf).toBe(0);
  });
  it("zoneWaterSurface keeps the computeMitigation precedence (static BFE > manual > derived)", () => {
    expect(zoneWaterSurface({ cls: "1pct", staticBfeFt: 101 }, { manualBfe: 99 })).toEqual({ wse: 101, wseSrc: "static-bfe" });
    expect(zoneWaterSurface({ cls: "1pct" }, { manualBfe: 99, derivedBfe: 98 })).toEqual({ wse: 99, wseSrc: "manual" });
    expect(zoneWaterSurface({ cls: "1pct" }, { derivedBfe: 98 })).toEqual({ wse: 98, wseSrc: "bfe-line-interp" });
    expect(zoneWaterSurface({ cls: "02pct" }, { wse02: 102 })).toEqual({ wse: 102, wseSrc: "manual" });
  });
});

describe("bermFillVolume — the embankment leg (B833 e)", () => {
  it("closed form: perimeter × h²·ratio/2; null on degenerate inputs", () => {
    const ring = rect(0, 0, 100, 100); // perimeter 400
    expect(bermFillVolume(ring, 2, 3)).toBeCloseTo(400 * 4 * 3 / 2, 6);
    expect(bermFillVolume(ring, 2, 4)).toBeGreaterThan(bermFillVolume(ring, 2, 3));
    expect(bermFillVolume(ring, 0, 3)).toBeNull();
    expect(bermFillVolume([{ x: 0, y: 0 }], 2, 3)).toBeNull();
  });
});
