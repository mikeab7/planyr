// ROUND 8 (owner live check 2026-10-29, Georgia Test Site › Concept A, "To the boundary"): the open ground inside the limit
// drew a closed hairpin loop, an ovoid ring and a swirl running under the car lot's edge — the round-6 surface ("the lowest
// plane among the edges a point can SEE") jumped wherever the visible set changed. NEW-1: it is now one continuous drainage
// surface (a min of cones less the distance term — proposedSurface.js "ROUND 8"). NEW-2: the boundary limit is the
// PROPERTY LINE inset by a grading margin (10 ft default) and any undisturbed buffer — never the building setback.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet, feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";
import { sampleAtLatLng } from "../src/workspaces/site-planner/lib/demGrid.js";
import { buildProposedSurface, contourLattice, nearestOnRing } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { contourLinesToFeet, ringsToLatticePx } from "../src/workspaces/site-planner/lib/gradingPaint.js";
import { buildProposedContours } from "../src/workspaces/site-planner/lib/contourTrace.js";
import { propertyLimit, pointInRegions, resolveGradingLimit, ringAreaSf } from "../src/workspaces/site-planner/lib/gradingLimit.js";
import { gradingCfg, gradingSetback, gradingPack, hostIdMap, GRADING_DEFAULTS } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { limitBasisPhrase, limitCrossPlace } from "../src/workspaces/site-planner/lib/gradingPanelModel.js";
import { describeFlag } from "../src/workspaces/site-planner/lib/buildingGrade.js";
import { pointInRing } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { CHEHAW_CROSS_DOCK_ROWS, rowRing, OWNER_ORIGIN } from "../ui-audit/lib/chehawCrossDock.mjs";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

function chehawScene() {
  const F = new URL("./fixtures/chehaw-218-02007", import.meta.url).pathname;
  const pj = JSON.parse(readFileSync(F + ".parcel.json", "utf8"));
  const ll = pj.ringLngLat.slice(0, -1);
  const lat0 = ll.reduce((a, p) => a + p[1], 0) / ll.length, lon0 = ll.reduce((a, p) => a + p[0], 0) / ll.length;
  const ring = ll.map(([lo, la]) => lngLatToFeet(lo, la, lon0, lat0));
  const req = JSON.parse(readFileSync(F + ".req.json", "utf8"));
  const grid = decodeGrid(new Uint8Array(readFileSync(F + ".lerc")).buffer, req);
  const existAt = (pt) => { const [la, lo] = feetToLatLngPair(pt, lat0, lon0); return sampleAtLatLng(grid, req, la, lo); };
  const o = lngLatToFeet(OWNER_ORIGIN.lon, OWNER_ORIGIN.lat, lon0, lat0);
  const host = CHEHAW_CROSS_DOCK_ROWS[0]; const hc = { x: host.cx + o.x, y: host.cy + o.y };
  const els = CHEHAW_CROSS_DOCK_ROWS.filter((e) => ["building", "paving", "parking", "trailer"].includes(e.type)).map((e) => ({
    id: e.id, type: e.type, attachedTo: e.attachedTo, truckCourt: !!e.truckCourt, ring: rowRing(e).map((p) => ({ x: p.x + o.x, y: p.y + o.y })), ...(e.truckCourt || e.forCourt ? { dockStack: hc } : {}) }));
  const hosts = hostIdMap(els);
  let minY = Infinity; for (const p of ring) minY = Math.min(minY, p.y);
  const sb = ring.map((a, i) => { const c = ring[(i + 1) % ring.length]; return (a.y + c.y) / 2 < minY + 400 ? 50 : 25; });
  const setback = gradingSetback([{ id: "pc", points: ring, setbacks: sb, active: true }], 25);
  const gsEls = (FFE) => els.map((e) => ({ id: e.id, type: e.type, ring: e.ring, dockStack: e.dockStack || null, accessible: false, slopeOverridePct: null, padElevFt: e.type === "building" ? FFE : null, ...(e.type !== "building" ? { hostId: hosts.get(e.id) ?? null } : {}) }));
  const build = (FFE, { mode = "boundary", maxCells, g = {} } = {}) => {
    const cfg = gradingCfg({ enabled: true, limitMode: mode, layers: { cutfill: true, contours: true }, ...g });
    return buildProposedSurface({ els: gsEls(FFE), ffeFt: null, dockDropFt: 4, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [],
      opts: { existKey: `r8:${mode}:${FFE}:${maxCells || ""}:${JSON.stringify(g)}`, ...(maxCells ? { maxCells } : {}) }, grading: gradingPack(cfg, setback) });
  };
  return { els, ring, setback, existAt, build };
}

const S = chehawScene();
const FFE = +(process.env.R8_FFE || 790.3);   // the floor the harness suggests on this layout (dock 786.3 in the picture)
const s = S.build(FFE);
const paved = S.els.filter((e) => e.type !== "building");
const inAnyEl = (pt) => S.els.some((e) => pointInRing(pt, e.ring));

describe("NEW-1 — the open ground inside the limit is one continuous drainage surface (real Chehaw ground, boundary mode)", () => {
  // a fine probe lattice over the whole limit, 6 ft — the probe is the same surface the earthwork priced
  const lim = s.grid.limit.limitRegions;
  const xs = lim.flatMap((r) => r.outer.map((p) => p.x)), ys = lim.flatMap((r) => r.outer.map((p) => p.y));
  const x0 = Math.min(...xs), y0 = Math.min(...ys), step = 6;
  const nx = Math.ceil((Math.max(...xs) - x0) / step), ny = Math.ceil((Math.max(...ys) - y0) / step);
  const Z = new Float64Array(nx * ny).fill(NaN), cls = new Array(nx * ny).fill(null);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const pt = { x: x0 + (i + 0.5) * step, y: y0 + (j + 0.5) * step };
    const r = s.grid.probe(pt);
    if (r.status !== "value") continue;
    Z[j * nx + i] = r.ft; cls[j * nx + i] = r.cls;
  }
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? null : j * nx + i);
  const nbrs = (i, j) => [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].map(([a, b]) => at(i + a, j + b));

  it("(c) no local maximum or minimum strictly inside the open ground: every open-ground cell has a lower AND a higher neighbour unless it borders the limit, the band or a graded element", () => {
    let interior = 0, bad = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const k = at(i, j);
      if (cls[k] !== "infill") continue;
      const N = nbrs(i, j);
      if (N.some((n) => n == null || cls[n] !== "infill")) continue;   // borders the limit, the band or an element
      interior++;
      const z = Z[k];
      const lower = N.some((n) => Z[n] < z - 1e-9), higher = N.some((n) => Z[n] > z + 1e-9);
      if (!lower || !higher) bad.push({ x: x0 + (i + 0.5) * step, y: y0 + (j + 0.5) * step, z, lower, higher });
    }
    expect(interior).toBeGreaterThan(2000);
    expect(bad).toEqual([]);
  });

  it("(b) at a pavement edge the open ground meets the pavement: never above it, and within one contour interval of it — except where a LOWER element is too close for the 2:1 bank (a named step, never silent)", () => {
    let n = 0, above = 0, worst = 0, steps = 0;
    const K = 1 / 2;
    for (const e of paved) {
      for (let k = 0; k < e.ring.length; k++) {
        const a = e.ring[k], b = e.ring[(k + 1) % e.ring.length];
        const L = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
        for (let t = 3; t < L - 3; t += 4) {
          const p = { x: a.x + ux * t, y: a.y + uy * t };
          for (const sgn of [1, -1]) {
            const out = { x: p.x - uy * 1.5 * sgn, y: p.y + ux * 1.5 * sgn }, inn = { x: p.x + uy * 1.5 * sgn, y: p.y - ux * 1.5 * sgn };
            if (!pointInRing(inn, e.ring) || pointInRing(out, e.ring) || inAnyEl(out)) continue;
            const ro = s.grid.probe(out), ri = s.grid.probe(inn);
            if (ro.status !== "value" || ri.status !== "value" || ro.cls !== "infill") continue;
            n++;
            if (ro.ft > ri.ft + 0.05) above++;
            const d = Math.abs(ro.ft - ri.ft);
            // a lower element within reach of the 2:1 bank: the ground cannot meet this edge without a step there
            const tooClose = S.els.some((g) => { if (g.id === e.id) return false; const q = nearestOnRing(out, g.ring); const r = s.grid.probe({ x: q.x + (q.x - out.x) * 0.01, y: q.y + (q.y - out.y) * 0.01 }); return r.status === "value" && r.ft + K * Math.hypot(out.x - q.x, out.y - q.y) < ri.ft - 1; });
            if (tooClose) { steps++; continue; }
            if (d > worst) worst = d;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(200);
    expect(above).toBe(0);
    expect(worst).toBeLessThan(1);           // one interval (1 ft); 3 ft across the edge at 2% ≈ 0.06 ft
    expect(steps / n).toBeLessThan(0.02);    // the step is only where a lower court corner sits a few feet off the lot
  });

  it("(a) the traced proposed contours: no closed ring on open ground (one that holds no graded element and no pond)", () => {
    const L = contourLattice(s.grid, { existAt: S.existAt });
    const mask = new Uint8Array(L.nx * L.ny), work = new Float32Array(L.nx * L.ny);
    for (let k = 0; k < mask.length; k++) { const v = L.values[k]; if (v === v) { mask[k] = 1; work[k] = v; } }
    const c = buildProposedContours({ values: work, mask, width: L.nx, height: L.ny }, { interval: L.interval, inside: L.inside, clipRings: L.clipRings ? ringsToLatticePx(L.clipRings, L) : null, clipHoles: L.clipHoles ? ringsToLatticePx(L.clipHoles, L) : null, cutRings: ringsToLatticePx(L.pads, L), labelMinCells: Math.max(8, Math.ceil(40 / L.cellFt)) });
    const feet = contourLinesToFeet(c, L);
    const closedOpen = [];
    for (const ln of feet.levels) for (const pc of ln.pieces) {
      const pts = [...pc.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
      if (!Array.isArray(pts) || pts.length < 4) continue;
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 0.5) continue;           // open line
      // a closed ring that holds no graded element and no limit hole (a pond is an outlet; contours may ring it) is a closed
      // contour on open ground — the slope band counts as open ground here: a ring through it is a pit or a hump all the same
      const holds = S.els.some((e) => pointInRing(e.ring[0], pts)) || s.grid.limit.limitRegions.some((r) => r.holes.some((h) => pointInRing(h[0], pts)));
      if (!holds) closedOpen.push({ level: ln.level, n: pts.length, at: { x: Math.round(a.x), y: Math.round(a.y) } });
    }
    expect(closedOpen).toEqual([]);
  });

  it("(d) the earthwork still balances at a suggested floor: net dirt crosses zero inside the search range and lands within 500 CY", () => {
    const net = (f) => { const r = S.build(f, { maxCells: 5000 }); return r.grid.fillCy - r.grid.cutCy; };
    let lo = FFE - 12, hi = FFE + 12, nlo = net(lo), nhi = net(hi);
    expect(nlo).toBeLessThan(0); expect(nhi).toBeGreaterThan(0);
    for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2, nm = net(m); if (nm < 0) { lo = m; nlo = nm; } else { hi = m; nhi = nm; } }
    expect(Math.min(Math.abs(nlo), Math.abs(nhi))).toBeLessThan(500);
  }, 60000);

  it("synthetic: a court falling to E with 100 ft of open ground then a car lot 2 ft lower — the ground between them is continuous, never above either edge, and has no hump", () => {
    const els = [
      { id: "b", type: "building", ring: rect(0, 0, 200, 100), padElevFt: 800 },
      { id: "c", type: "paving", ring: rect(0, 100, 200, 120), hostId: "b", dockStack: { x: 100, y: 50 } },
      { id: "p", type: "parking", ring: rect(300, 0, 120, 100), padElevFt: null },
    ];
    const flat = () => 790;
    const r = buildProposedSurface({ els, ffeFt: 800, dockDropFt: 4, existAt: flat, parcelRings: [rect(-200, -200, 820, 620)],
      grading: { pavementSlopePct: 1.5, lotDropFt: 0.5, slopeRatio: 2, shoulderFt: 5, openGroundSlopePct: 2, setbackRings: [rect(-150, -150, 720, 520)], limit: { mode: "boundary" } }, opts: { existKey: "r8-syn" } });
    // walk east along y = 50 from the pad edge (x=200) to the lot (x=300): continuous, monotone-free of humps, ≤ both edges
    const zs = [];
    for (let x = 200.5; x <= 299.5; x += 1) zs.push(r.grid.probe({ x, y: 50 }).ft);
    for (let k = 1; k < zs.length; k++) expect(Math.abs(zs[k] - zs[k - 1])).toBeLessThan(0.6);   // ≤ K = 0.5 per ft + slack
    const padEdge = r.grid.probe({ x: 199.5, y: 50 }).ft, lotEdge = r.grid.probe({ x: 300.5, y: 50 }).ft;
    expect(zs[0]).toBeLessThanOrEqual(padEdge + 1e-6);
    expect(zs[zs.length - 1]).toBeLessThanOrEqual(lotEdge + 0.6);
    // no interior maximum along the walk
    for (let k = 1; k < zs.length - 1; k++) expect(zs[k] > zs[k - 1] + 1e-9 && zs[k] > zs[k + 1] + 1e-9).toBe(false);
  });
});

describe("NEW-1 — a bowl cut below its own limit drains (the pit fill)", () => {
  // the court falls to E ≈ 94, the open ground falls 4% beyond it to ≈ 90 at the limit, but the ground there is 93: the slope
  // band climbs back up and the open ground is a closed bowl. The drainage pass fills it so every point drains to an outlet.
  const FFE0 = 100;
  const court = [
    { id: "b", type: "building", ring: rect(0, 0, 200, 100), padElevFt: FFE0 },
    { id: "c", type: "paving", ring: rect(0, 100, 200, 130), dockStack: { x: 100, y: 50 }, hostId: "b" },
  ];
  const SB2 = rect(-100, -100, 400, 430);
  const ground = () => FFE0 - 7;
  const r = buildProposedSurface({ els: court, ffeFt: FFE0, dockDropFt: 4, existAt: ground, parcelRings: [SB2],
    grading: { pavementSlopePct: 1.5, lotDropFt: 0.5, slopeRatio: 2, shoulderFt: 5, openGroundSlopePct: 4, setbackRings: [SB2], limit: { mode: "boundary" } },
    opts: { maxCells: 12000, minCellFt: 2, existKey: "r8-bowl" } });
  it("the pass ran and says how much it filled", () => {
    expect(r.grid.limit.pitFill.nodes).toBeGreaterThan(50);
    expect(r.grid.limit.pitFill.maxFt).toBeGreaterThan(0.2);
  });
  it("every point of open ground on a 5 ft walk has somewhere lower to go (no pit), and nothing rises above the court's edge", () => {
    const step = 5, pts = [];
    for (let x = -95; x <= 295; x += step) for (let y = 235; y <= 325; y += step) pts.push({ x, y });
    const z = (p) => { const q = r.grid.probe(p); return q.status === "value" ? q.ft : null; };
    let pits = 0;
    for (const p of pts) {
      const z0 = z(p); if (z0 == null) continue;
      const nb = [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, step], [step, -step], [-step, -step]].map(([a, b]) => z({ x: p.x + a, y: p.y + b }));
      if (nb.some((v) => v == null)) continue;              // touches the limit / an element
      if (!nb.some((v) => v < z0 - 1e-9)) pits++;
    }
    expect(pits).toBe(0);
    const E = r.grid.probe({ x: 100, y: 229.5 }).ft;
    expect(pts.every((p) => { const v = z(p); return v == null || v <= E + 1e-6; })).toBe(true);
  });
});

describe("NEW-2 — the boundary limit is the property line less a grading margin and any undisturbed buffer, never the setback", () => {
  const parcel = rect(0, 0, 1000, 600);
  it("inset by the margin (10 ft default), straight edges stay straight", () => {
    const pl = propertyLimit({ parcelRings: [parcel] });
    expect(pl.rings.length).toBe(1);
    expect(ringAreaSf(pl.rings[0])).toBeCloseTo(980 * 580, -1);
    expect(pl.marginFt).toBe(10); expect(pl.bufferFt).toBe(0);
  });
  it("the undisturbed buffer is subtracted along every edge on top of the margin; 0 margin is the property line itself", () => {
    expect(ringAreaSf(propertyLimit({ parcelRings: [parcel], marginFt: 10, bufferFt: 25 }).rings[0])).toBeCloseTo(930 * 530, -1);
    expect(ringAreaSf(propertyLimit({ parcelRings: [parcel], marginFt: 0 }).rings[0])).toBeCloseTo(1000 * 600, -1);
  });
  it("a save-and-except carve-out grows by the same inset", () => {
    const pl = propertyLimit({ parcelRings: [parcel], holes: [rect(400, 200, 100, 100)], marginFt: 10 });
    expect(pl.holes.length).toBe(1);
    expect(ringAreaSf(pl.holes[0])).toBeGreaterThan(110 * 110);
  });
  it("the pack ignores the setback: boundary mode grades to 10 ft inside the property line even with a 50 ft setback drawn", () => {
    const setback = gradingSetback([{ id: "pc", points: parcel, setbacks: [50, 50, 50, 50], active: true }], 0);
    expect(ringAreaSf(setback.rings[0])).toBeCloseTo(900 * 500, -1);       // the setback still exists (buildings)
    const pack = gradingPack(gradingCfg({ enabled: true, limitMode: "boundary" }), setback);
    const r = resolveGradingLimit({ els: [{ id: "b", ring: rect(300, 200, 300, 150) }], spec: { mode: "boundary", setbackRings: pack.setbackRings, setbackHoles: pack.limit.setbackHoles } });
    expect(r.areaSf).toBeCloseTo(980 * 580, -1);
    expect(pointInRegions({ x: 20, y: 300 }, r.regions)).toBe(true);        // inside the setback band, inside the limit
    expect(pointInRegions({ x: 5, y: 300 }, r.regions)).toBe(false);        // inside the 10 ft margin
    expect(pack.limit.basis).toEqual({ kind: "property", marginFt: 10, bufferFt: 0 });
  });
  it("the gear rows are normalised (default 10 ft margin, 0 buffer; 0 allowed; a negative falls back)", () => {
    expect(GRADING_DEFAULTS.gradingMarginFt).toBe(10);
    expect(gradingCfg({}).gradingMarginFt).toBe(10);
    expect(gradingCfg({ gradingMarginFt: 0 }).gradingMarginFt).toBe(0);
    expect(gradingCfg({ undisturbedBufferFt: 50 }).undisturbedBufferFt).toBe(50);
    expect(gradingCfg({ gradingMarginFt: -3 }).gradingMarginFt).toBe(10);
  });
  it("the panel words: 'to the property line (10 ft margin)', and a flag reads past the property line / into the buffer / into the margin", () => {
    expect(limitBasisPhrase({ marginFt: 10, bufferFt: 0 })).toBe("to the property line (10 ft margin)");
    expect(limitBasisPhrase({ marginFt: 5, bufferFt: 25 })).toBe("to the property line (5 ft margin, 25 ft buffer)");
    expect(limitBasisPhrase({ marginFt: 0, bufferFt: 0 })).toBe("to the property line (no margin)");
    expect(limitCrossPlace({ marginFt: 10, bufferFt: 0 }, true)).toBe("past the property line");
    expect(limitCrossPlace({ marginFt: 10, bufferFt: 25 }, false)).toBe("into the buffer");
    expect(limitCrossPlace({ marginFt: 10, bufferFt: 0 }, false)).toBe("into the grading margin");
  });
  it("layout mode's flag measures against the same limit and never says 'setback'", () => {
    // a building pushed 30 ft from the west property line, deep cut: the 2:1 slope runs into the margin / past the line
    const els = [{ id: "b", type: "building", ring: rect(30, 200, 300, 200), padElevFt: 780 }];
    const sb = gradingSetback([{ id: "pc", points: parcel, setbacks: [25, 25, 25, 25], active: true }], 0);
    const pack = gradingPack(gradingCfg({ enabled: true, limitMode: "layout", shoulderFt: 0 }), sb);
    const r = buildProposedSurface({ els, ffeFt: 780, existAt: () => 800, parcelRings: sb.parcelRings, grading: pack, opts: { existKey: "r8-flag" } });
    const f = describeFlag(r, new Set(["b"]), { buildingCentre: { x: 180, y: 300 }, elements: els, slopeRatio: 2 });
    expect(f).not.toBeNull();
    expect(f.text.title + f.text.body).not.toMatch(/setback/);
    expect(f.text.body).toMatch(/past the property line|into the grading margin/);
  });
});
