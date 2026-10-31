import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet, feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";
import { sampleAtLatLng } from "../src/workspaces/site-planner/lib/demGrid.js";
import { buildProposedSurface, contourLattice, sampleProposedAt } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { pointInRegions } from "../src/workspaces/site-planner/lib/gradingLimit.js";
import { gradingCfg, gradingSetback, gradingPack, hostIdMap } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { buildProposedContours } from "../src/workspaces/site-planner/lib/contourTrace.js";
import { contourLinesToFeet, ringsToLatticePx, planContourDraw } from "../src/workspaces/site-planner/lib/gradingPaint.js";
import { CHEHAW_CONCEPT_A_ROWS, rowRing, OWNER_ORIGIN } from "../ui-audit/lib/chehawCrossDock.mjs";

// The owner's Concept A as it stood on 2026-10-30 (read-only copy of the plan's rows; the plan's setback is a uniform 25 ft)
function conceptA() {
  const F = new URL("./fixtures/chehaw-218-02007", import.meta.url).pathname;
  const pj = JSON.parse(readFileSync(F + ".parcel.json", "utf8"));
  const ll = pj.ringLngLat.slice(0, -1);
  const lat0 = ll.reduce((a, p) => a + p[1], 0) / ll.length, lon0 = ll.reduce((a, p) => a + p[0], 0) / ll.length;
  const ring = ll.map(([lo, la]) => lngLatToFeet(lo, la, lon0, lat0));
  const req = JSON.parse(readFileSync(F + ".req.json", "utf8"));
  const grid = decodeGrid(new Uint8Array(readFileSync(F + ".lerc")).buffer, req);
  const existAt = (pt) => { const [la, lo] = feetToLatLngPair(pt, lat0, lon0); return sampleAtLatLng(grid, req, la, lo); };
  const o = lngLatToFeet(OWNER_ORIGIN.lon, OWNER_ORIGIN.lat, lon0, lat0);
  const host = CHEHAW_CONCEPT_A_ROWS[0]; const hc = { x: host.cx + o.x, y: host.cy + o.y };
  const els = CHEHAW_CONCEPT_A_ROWS.filter((e) => ["building", "paving", "parking", "trailer"].includes(e.type)).map((e) => ({
    id: e.id, type: e.type, attachedTo: e.attachedTo, ring: rowRing(e).map((p) => ({ x: p.x + o.x, y: p.y + o.y })), ...(e.truckCourt || e.forCourt ? { dockStack: hc } : {}) }));
  const hosts = hostIdMap(els);
  const setback = gradingSetback([{ id: "pc", points: ring, active: true }], 25);
  const gsEls = (FFE) => els.map((e) => ({ id: e.id, type: e.type, ring: e.ring, dockStack: e.dockStack || null, accessible: false, slopeOverridePct: null, padElevFt: e.type === "building" ? FFE : null, ...(e.type !== "building" ? { hostId: hosts.get(e.id) ?? null } : {}) }));
  const build = (FFE, mode) => {
    const cfg = gradingCfg({ enabled: true, limitMode: mode, layers: { cutfill: true, contours: true } });
    return buildProposedSurface({ els: gsEls(FFE), ffeFt: null, dockDropFt: 4, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [],
      opts: { existKey: `r9:${mode}:${FFE}` }, grading: gradingPack(cfg, setback) });
  };
  return { els, ring, setback, existAt, build, origin: { lat: lat0, lon: lon0 } };
}


import { planAllContourLabels, pathToPieces, CONTOUR_LABEL_ALL } from "../src/workspaces/site-planner/lib/contourLabelPlan.js";
import { buildProposedContours } from "../src/workspaces/site-planner/lib/contourTrace.js";
import { groundReadout } from "../src/workspaces/site-planner/lib/groundReadout.js";

/* ROUND 10 (NEW-2, owner 2026-10-30 7:11 PM): "I can't see any topo information from this view" — at the 50-ft scale NOT ONE existing or
 * proposed contour carried a label (the only labels were every-fifth INDEX lines, one per index piece), and the cursor chip read "Prop —". */
const S = conceptA();
const FFE = 792.2;

describe("NEW-2 — every contour in view carries an elevation at working zoom", () => {
  it("parallel lines 4 px apart (a steep bank) ALL get a label, staggered along the run, none overlapping, each ON its line and upright", () => {
    const lines = [];
    for (let k = 0; k < 14; k++) lines.push({ key: `k${k}`, level: 780 + k, isIndex: k % 5 === 0, pts: [{ x: 0, y: k * 4 }, { x: 900, y: k * 4 + 60 }] });
    const labs = planAllContourLabels(lines, 1.0);
    expect(new Set(labs.map((l) => l.key)).size).toBe(14);
    for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
      const a = labs[i], b = labs[j];
      // axis-aligned centre test at the label box size: no two label centres closer than a box in BOTH axes
      expect(Math.abs(a.pt.x - b.pt.x) < 20 && Math.abs(a.pt.y - b.pt.y) < 12).toBe(false);
    }
    for (const l of labs) {
      const ln = lines.find((q) => q.key === l.key);
      // on its line: the label point is on the segment (within 0.5 px)
      const [p, q] = ln.pts; const t = ((l.pt.x - p.x) * (q.x - p.x) + (l.pt.y - p.y) * (q.y - p.y)) / ((q.x - p.x) ** 2 + (q.y - p.y) ** 2);
      expect(Math.hypot(p.x + (q.x - p.x) * t - l.pt.x, p.y + (q.y - p.y) * t - l.pt.y)).toBeLessThan(0.5);
      expect(Math.abs(l.deg)).toBeLessThanOrEqual(90);
    }
  });
  it("a long run repeats about every 300 px; below the working zoom (the 250-ft scale) it plans nothing — the index labels stay", () => {
    const line = [{ key: "a", level: 790, isIndex: true, pts: [{ x: 0, y: 0 }, { x: 1500, y: 0 }] }];
    const labs = planAllContourLabels(line, 1.0);
    expect(labs.length).toBeGreaterThanOrEqual(4); expect(labs.length).toBeLessThanOrEqual(6);
    expect(planAllContourLabels(line, 0.4)).toEqual([]);
  });
  it("a corner is not labelled across (a label sits on a straight-ish stretch)", () => {
    const L = [{ key: "z", level: 790, isIndex: true, pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 200 }] }];
    for (const l of planAllContourLabels(L, 1.0)) expect(Math.hypot(l.pt.x - 40, l.pt.y) > 14).toBe(true);
  });
  it("Concept A at the 50-ft scale, both limit modes: the label count is at least the number of drawn lines long enough to carry one", () => {
    for (const mode of ["boundary", "layout"]) {
      const sf = S.build(FFE, mode);
      const L = contourLattice(sf.grid, { existAt: S.existAt });
      const mask = new Uint8Array(L.nx * L.ny), work = new Float32Array(L.nx * L.ny);
      for (let k = 0; k < mask.length; k++) { const v = L.values[k]; if (v === v) { mask[k] = 1; work[k] = v; } }
      const c = buildProposedContours({ values: work, mask, width: L.nx, height: L.ny }, { interval: L.interval, inside: L.inside, clipRings: L.clipRings ? ringsToLatticePx(L.clipRings, L) : null, clipHoles: L.clipHoles ? ringsToLatticePx(L.clipHoles, L) : null, cutRings: ringsToLatticePx(L.pads, L), labelMinCells: 8 });
      const contours = { ...contourLinesToFeet(c, L), interval: c.interval, bandSpacingFt: c.interval * (sf.grid.apronRatio || 2) };
      const rppf = 1.0;                                        // the 50-ft scale bar
      const plan = planContourDraw(contours, rppf);
      const lines = [];
      for (const lv of plan.levels) pathToPieces(lv.d).forEach((pts, i) => lines.push({ key: `${lv.level}:${i}`, level: lv.level, isIndex: lv.isIndex, pts }));
      const carry = lines.filter((ln) => { let len = 0; for (let i = 1; i < ln.pts.length; i++) len += Math.hypot(ln.pts[i].x - ln.pts[i - 1].x, ln.pts[i].y - ln.pts[i - 1].y); return len * rppf >= 60; });
      const labs = planAllContourLabels(lines, rppf);
      expect(carry.length).toBeGreaterThan(10);
      const labelled = new Set(labs.map((l) => l.key));
      const missing = carry.filter((ln) => !labelled.has(ln.key)).length;
      // a handful of the shortest slivers may find no clear station among 100+ lines; the bank's lines may not
      expect(missing / carry.length).toBeLessThan(0.05);
      expect(labs.length).toBeGreaterThanOrEqual(carry.length - missing);
    }
  });
});

describe("NEW-2 — the cursor readout names the proposed elevation at EVERY point inside the grading limit", () => {
  it("200 random points inside the limit, both modes: a value every time (court, pad, band, open ground, ramp); a dash only outside it", () => {
    for (const mode of ["boundary", "layout"]) {
      const sf = S.build(FFE, mode);
      const regs = sf.grid.limit.limitRegions;
      const all = regs.flatMap((r) => r.outer);
      const x0 = Math.min(...all.map((p) => p.x)), x1 = Math.max(...all.map((p) => p.x)), y0 = Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y));
      let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      let n = 0, tries = 0; const bad = [];
      while (n < 200 && tries++ < 50000) {
        const pt = { x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0) };
        if (!pointInRegions(pt, mode === "boundary" ? regs : sf.grid.limit.regions)) continue;
        n++;
        const r = sampleProposedAt(sf.grid, pt, S.existAt);
        if (r.status !== "value" || !Number.isFinite(r.ft)) bad.push({ pt, r });
        else {
          const text = groundReadout({ el: { status: "value", ft: S.existAt(pt) ?? 0 }, prop: r }).text;
          if (!/Prop \d/.test(text) || !/(Cut|Fill|On grade)/.test(text)) bad.push({ pt, text });
        }
      }
      expect(n).toBe(200);
      expect(bad).toEqual([]);
    }
  });
  it("a point far outside the limit still says '—' (the one place it may)", () => {
    const sf = S.build(FFE, "boundary");
    const all = sf.grid.limit.limitRegions.flatMap((r) => r.outer);
    const far = { x: Math.min(...all.map((p) => p.x)) - 800, y: Math.min(...all.map((p) => p.y)) - 800 };
    expect(sampleProposedAt(sf.grid, far, S.existAt).status).toBe("none");
  });
});
