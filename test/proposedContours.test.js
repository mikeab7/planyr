// ROUND 5 (NEW-1 / NEW-2 / NEW-3) — the proposed contours read like a civil's grading plan: the contour lattice is sampled
// off the REAL surface (the pad exactly at the FFE, never existing ground inside the limit), traced with interpolation,
// clipped to the daylight line, cut out of the pads, smoothed, and tied into the existing ground at the line.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet, feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";
import { sampleAtLatLng } from "../src/workspaces/site-planner/lib/demGrid.js";
import { buildProposedSurface, contourLattice, PL_FILL_EPS_FT } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { contourLinesToFeet, ringsToLatticePx, placeContourLabels, planContourDraw, contourMultiple, CONTOUR_DRAW, bandField, bandRingsToFeet, cellsPixels, cellsOutlinePath, cellPaint, BAND_TINT } from "../src/workspaces/site-planner/lib/gradingPaint.js";
import { buildProposedContours, buildContours, traceDaylight, pieceSpacingCells, traceBandOutline } from "../src/workspaces/site-planner/lib/contourTrace.js";
import { bandRegions, pointInRegions, unionRings } from "../src/workspaces/site-planner/lib/gradingLimit.js";
import { clipPolyline, chaikin, expandRing, pointInRings, longestCellEdgeRun, longestCornerRun, selfIntersects, polylineLength, pointAlong } from "../src/workspaces/site-planner/lib/polylineClip.js";
import { clipContourLinesOutside, labelInsideClip } from "../src/workspaces/site-planner/lib/contours.js";
import { gradingCfg, gradingSetback, gradingPack, hostIdMap } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { pointInRing } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { CHEHAW_CROSS_DOCK_ROWS, rowRing, OWNER_ORIGIN } from "../ui-audit/lib/chehawCrossDock.mjs";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const verts = (d) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
const pieces = (d) => d.split("M").filter(Boolean).map((seg) => verts("M" + seg));

/* the owner's real cross-dock (Georgia Test Site › Concept A rows) on the real Chehaw ground, at the FFE he saw */
function chehaw(mode, FFE = 794.8) {
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
  const gsEls = els.map((e) => ({ id: e.id, type: e.type, ring: e.ring, dockStack: e.dockStack || null, accessible: false, slopeOverridePct: null, padElevFt: e.type === "building" ? FFE : null, ...(e.type !== "building" ? { hostId: hosts.get(e.id) ?? null } : {}) }));
  let minY = Infinity; for (const p of ring) minY = Math.min(minY, p.y);
  const sb = ring.map((a, i) => { const c = ring[(i + 1) % ring.length]; return (a.y + c.y) / 2 < minY + 400 ? 50 : 25; });
  const setback = gradingSetback([{ id: "pc", points: ring, setbacks: sb, active: true }], 25);
  const cfg = gradingCfg({ enabled: true, limitMode: mode, layers: { cutfill: true, contours: true } });
  const s = buildProposedSurface({ els: gsEls, ffeFt: null, dockDropFt: 4, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [], opts: { existKey: "t" }, grading: gradingPack(cfg, setback) });
  const L = contourLattice(s.grid, { existAt });
  const mask = new Uint8Array(L.nx * L.ny), work = new Float32Array(L.nx * L.ny);
  for (let k = 0; k < mask.length; k++) { const v = L.values[k]; if (v === v) { mask[k] = 1; work[k] = v; } }
  const c = buildProposedContours({ values: work, mask, width: L.nx, height: L.ny }, { interval: L.interval, inside: L.inside, clipRings: L.clipRings ? ringsToLatticePx(L.clipRings, L) : null, clipHoles: L.clipHoles ? ringsToLatticePx(L.clipHoles, L) : null, cutRings: ringsToLatticePx(L.pads, L), labelMinCells: Math.max(8, Math.ceil(40 / L.cellFt)) });
  return { s, L, c, feet: contourLinesToFeet(c, L), els, existAt, ring, FFE };
}

describe("NEW-1 — the contour lattice is the proposed surface, every cell, never existing ground inside the limit", () => {
  const { s, L, c, feet, els, existAt, FFE } = chehaw("layout");
  const pad = els[0].ring;
  it("every lattice sample whose centre lies in the building ring is exactly the FFE", () => {
    let n = 0, off = 0;
    for (let i = 0; i < L.nx; i++) for (let j = 0; j < L.ny; j++) {
      const pt = { x: L.x0 + (i + 0.5) * L.dx, y: L.y0 + (j + 0.5) * L.dy };
      if (!pointInRing(pt, pad)) continue;
      n++; if (Math.abs(L.values[j * L.nx + i] - FFE) > 1e-3) off++;   // Float32 lattice
    }
    expect(n).toBeGreaterThan(500);
    expect(off).toBe(0);
  });
  it("the lattice is fine (≤ 6 ft on the owner's site) and every sample inside the limit is graded ground, never the DEM", () => {
    expect(L.cellFt).toBeLessThanOrEqual(6);
    let inLimit = 0, eqGround = 0;
    for (let i = 0; i < L.nx; i++) for (let j = 0; j < L.ny; j++) {
      const pt = { x: L.x0 + (i + 0.5) * L.dx, y: L.y0 + (j + 0.5) * L.dy };
      if (s.grid.limit.regions.every((r) => !pointInRing(pt, r.outer))) continue;
      const r = s.grid.probe(pt);
      if (!r || r.status !== "value" || r.wedge) continue;
      inLimit++;
      const g = existAt(pt);
      if (g != null && Math.abs(L.values[j * L.nx + i] - g) < 1e-6 && Math.abs(L.values[j * L.nx + i] - r.ft) > 1e-6) eqGround++;
    }
    expect(inLimit).toBeGreaterThan(5000);
    expect(eqGround).toBe(0);
  });
  it("no traced contour segment lies inside the building ring (the dock wall is a wall, not a contour)", () => {
    let inside = 0, total = 0;
    for (const lv of feet.levels) for (const v of verts(lv.d)) { total++; if (pointInRing(v, pad)) inside++; }
    expect(total).toBeGreaterThan(500);
    expect(inside).toBe(0);
    // and no segment's midpoint either
    let mid = 0;
    for (const lv of feet.levels) for (const pc of pieces(lv.d)) for (let i = 1; i < pc.length; i++) if (pointInRing({ x: (pc[i].x + pc[i - 1].x) / 2, y: (pc[i].y + pc[i - 1].y) / 2 }, pad)) mid++;
    expect(mid).toBe(0);
  });
  it("across a 1.5% court at most ceil(depth × 0.015 / interval) + 1 contours cross it", () => {
    const court = els.find((e) => e.type === "paving");
    // the court's depth is its short side; a transect across it at mid-length
    const xs = court.ring.map((p) => p.x), ys = court.ring.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const depth = Math.min(w, h);
    const a = w < h ? { x: Math.min(...xs) + 1, y: (Math.min(...ys) + Math.max(...ys)) / 2 } : { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) + 1 };
    const b = w < h ? { x: Math.max(...xs) - 1, y: a.y } : { x: a.x, y: Math.max(...ys) - 1 };
    let crossings = 0;
    const cross = (p, q) => { const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x), d2 = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x); const d3 = (q.x - p.x) * (a.y - p.y) - (q.y - p.y) * (a.x - p.x), d4 = (q.x - p.x) * (b.y - p.y) - (q.y - p.y) * (b.x - p.x); return d1 * d2 < 0 && d3 * d4 < 0; };
    for (const lv of feet.levels) for (const pc of pieces(lv.d)) for (let i = 1; i < pc.length; i++) if (cross(pc[i - 1], pc[i])) crossings++;
    expect(crossings).toBeLessThanOrEqual(Math.ceil(depth * 0.015 / c.interval) + 1);
    expect(crossings).toBeGreaterThanOrEqual(1);
  });
});

describe("NEW-2 — the lines flow: interpolated marching squares, clipped, smoothed", () => {
  it("a 2:1 fill band around a flat pad on tilted ground traces as closed, non-self-intersecting, evenly spaced rings off the cell edges", () => {
    const existAt = (pt) => 100 + (pt.x - 150) * 0.02 - 7;           // 2% tilt: 10 ft of fill at the west edge, 4 ft at the east
    const pad = { id: "b", type: "building", ring: rect(0, 0, 300, 200), padElevFt: 100 };
    // a bare pad: the limit's corner rounding (30 ft by default) would cut across the pad's own corners, so the test asks
    // for a tight radius — the rings are about the band, not the rounding (gradingLimit.test.js owns that)
    const s = buildProposedSurface({ els: [pad], ffeFt: 100, existAt, parcelRings: [rect(-400, -400, 1100, 1000)],
      grading: { pavementSlopePct: 1.5, lotDropFt: 0.5, slopeRatio: 2, shoulderFt: 5, setbackRings: [rect(-400, -400, 1100, 1000)], limit: { mode: "layout", cornerRadiusFt: 2, aisleFt: 2 } }, opts: { maxCells: 9000, existKey: "tilt" } });
    const L = contourLattice(s.grid, { existAt });
    const mask = new Uint8Array(L.nx * L.ny), work = new Float32Array(L.nx * L.ny);
    for (let k = 0; k < mask.length; k++) { const v = L.values[k]; if (v === v) { mask[k] = 1; work[k] = v; } }
    const c = buildProposedContours({ values: work, mask, width: L.nx, height: L.ny }, { interval: 1, inside: L.inside, cutRings: ringsToLatticePx(L.pads, L) });
    const rings = c.levels.flatMap((lv) => lv.lines.filter((ln) => ln.length > 3 && ln[0][0] === ln[ln.length - 1][0] && ln[0][1] === ln[ln.length - 1][1]).map((ln) => ({ level: lv.level, ln })));
    expect(rings.length).toBeGreaterThanOrEqual(3);                 // several fill contours ring the pad
    for (const r of rings) {
      expect(selfIntersects(r.ln)).toBe(false);
      expect(longestCellEdgeRun(r.ln, { x0: 0, y0: 0, dx: 1, dy: 1 })).toBeLessThanOrEqual(2);
      expect(r.ln.length % (L.nx * L.ny)).not.toBe(0);
    }
    // evenly spaced: along the pad's west edge (x < 0, y = 100) consecutive rings sit 2 ft apart (1 ft at 2:1), ±25%
    const west = rings.map((r) => ({ level: r.level, x: Math.min(...r.ln.map((p) => L.x0 + p[0] * L.dx)) })).sort((a, b) => a.level - b.level);
    expect(west.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < west.length; i++) { const gap = Math.abs(west[i].x - west[i - 1].x) / (west[i].level - west[i - 1].level); expect(gap).toBeGreaterThan(1.5); expect(gap).toBeLessThan(2.5); }
    // the daylight line traced off the field is one closed outer ring around everything
    expect(c.daylight.rings.length).toBe(1);
    expect(c.daylight.holes.length).toBe(0);
  });
  it("the daylight field's zero crossing is where the slope meets the ground (|dz| = the engine's epsilon)", () => {
    const inside = new Float32Array([ -1, -1, -1, -1,  -1, 1, 1, -1,  -1, 1, 1, -1,  -1, -1, -1, -1 ]);
    const d = traceDaylight(inside, 4, 4);
    expect(d.rings.length).toBe(1); expect(d.holes.length).toBe(0);
    expect(PL_FILL_EPS_FT).toBe(0.05);
  });
  it("Chaikin keeps an open line's endpoints and closes a ring; the clipper's cut points are exact", () => {
    const sm = chaikin([[0, 0], [10, 0], [10, 10]], 2);
    expect(sm[0]).toEqual([0, 0]); expect(sm[sm.length - 1]).toEqual([10, 10]); expect(sm.length).toBeGreaterThan(5);
    const ring = chaikin([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(clipPolyline([[-5, 5], [15, 5]], [sq])).toEqual([[[0, 5], [10, 5]]]);
    expect(clipPolyline([[-5, 5], [15, 5]], [sq], { keepInside: false })).toEqual([[[-5, 5], [0, 5]], [[10, 5], [15, 5]]]);
    expect(clipPolyline([[2, 2], [8, 8]], [sq], { keepInside: false })).toEqual([]);
    expect(clipPolyline([[2, 2], [8, 8]], [sq])).toEqual([[[2, 2], [8, 8]]]);
    // a hole toggles
    const hole = [[4, 4], [6, 4], [6, 6], [4, 6]];
    expect(clipPolyline([[-5, 5], [15, 5]], [sq, hole]).map((p) => p.map((q) => q[0]))).toEqual([[0, 4], [6, 10]]);
    expect(pointInRings([5, 5], [sq, hole])).toBe(false); expect(pointInRings([2, 2], [sq, hole])).toBe(true);
    const ex = expandRing(sq, 1);
    expect(pointInRings([-0.5, 5], [ex])).toBe(true); expect(pointInRings([-1.5, 5], [ex])).toBe(false);
    expect(polylineLength([[0, 0], [3, 4]])).toBe(5);
    expect(pointAlong([[0, 0], [10, 0]], 0.5)).toEqual({ x: 5, y: 0, angle: 0 });
  });
  it("labels: one per index piece, along the line, upright, never two on top of each other, none on a piece shorter than the label", () => {
    const labels = [
      { pt: { x: 0, y: 0 }, text: "800", level: 800, angle: Math.PI * 0.9, lenFt: 400 },     // steep angle → flipped upright
      { pt: { x: 20, y: 8 }, text: "805", level: 805, angle: 0, lenFt: 300 },                // on top of the first at this zoom → dropped
      { pt: { x: 400, y: 0 }, text: "810", level: 810, angle: 0, lenFt: 5 },                 // too short a piece → dropped
      { pt: { x: 200, y: 200 }, text: "815", level: 815, angle: -Math.PI / 4, lenFt: 300 },
    ];
    const out = placeContourLabels(labels, 1);
    expect(out.map((l) => l.text)).toEqual(["800", "815"]);
    expect(out[0].deg).toBeGreaterThan(-90); expect(out[0].deg).toBeLessThanOrEqual(90);
    expect(placeContourLabels(labels, 0.2)).toEqual([]);                                    // below the working zoom
    expect(placeContourLabels(labels, 4).map((l) => l.text)).toEqual(["800", "805", "815"]); // zoomed in: room for both
  });
});

describe("NEW-3 — proposed ties into existing at the daylight line", () => {
  it("layout: the ground at every proposed endpoint on the outer daylight ring is the contour's own level (median ≤ 0.3 ft, p90 ≤ 1 ft)", () => {
    const { c, L, existAt, feet } = chehaw("layout");
    expect(feet.daylight.rings.length).toBeGreaterThanOrEqual(1);
    const outer = feet.daylight.rings.map((r) => r.map((p) => [(p.x - L.x0) / L.dx, (p.y - L.y0) / L.dy]));
    const onRing = (p) => outer.some((r) => { for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); if (Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t) < 0.01) return true; } return false; });
    const errs = [];
    let outsideVerts = 0;
    for (const lv of c.levels) for (const ln of lv.lines) {
      for (const p of ln) if (!pointInRings(p, [...c.daylight.rings, ...c.daylight.holes]) && !onRing(p)) outsideVerts++;
      for (const end of [ln[0], ln[ln.length - 1]]) { if (!onRing(end)) continue; errs.push(Math.abs(existAt({ x: L.x0 + end[0] * L.dx, y: L.y0 + end[1] * L.dy }) - lv.level)); }
    }
    errs.sort((a, b) => a - b);
    expect(errs.length).toBeGreaterThan(50);
    expect(errs[errs.length >> 1]).toBeLessThanOrEqual(0.3);
    expect(errs[Math.floor(errs.length * 0.9)]).toBeLessThanOrEqual(1.0);
    expect(outsideVerts).toBe(0);                                                          // nothing proposed outside the line
  });
  it("boundary: the limit IS the outer clip; nothing proposed outside the setback; and (ROUND 6) nothing inside it is left ungraded — the field has no hole", () => {
    const { c, L, s } = chehaw("boundary");
    expect(L.clipRings.length).toBeGreaterThanOrEqual(1);
    const limitPx = ringsToLatticePx(L.clipRings, L);
    let out = 0, total = 0;
    const edgeDist = (p) => Math.min(...limitPx.map((r) => { let best = Infinity; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t)); } return best; }));
    for (const lv of c.levels) for (const ln of lv.lines) for (const p of ln) { total++; if (!pointInRings(p, limitPx) && edgeDist(p) > 0.01) out++; }
    expect(total).toBeGreaterThan(500); expect(out).toBe(0);
    expect(c.daylight.holes.length).toBe(0);
    // every lattice sample inside the limit is graded ground (the inside field is +1 there), so no existing contour can show inside
    let insideSamples = 0, graded = 0;
    for (let j = 0; j < L.ny; j++) for (let i = 0; i < L.nx; i++) { const p = [i + 0.5, j + 0.5]; if (!pointInRings(p, limitPx)) continue; insideSamples++; if (L.inside[j * L.nx + i] > 0) graded++; }
    expect(insideSamples).toBeGreaterThan(1000);
    expect(graded / insideSamples).toBeGreaterThan(0.995);
    expect(s.grid.limit.mode).toBe("boundary");
  });
  it("the existing layer is cut OUTSIDE the same rings, labels inside it dropped (contours.js, the main-thread half)", () => {
    const clip = { rings: [[[0, 0], [0, 10], [10, 10], [10, 0]]], holes: [] };
    const lines = [{ coords: [[-5, 5], [15, 5]], level: 100, isIndex: true }, { coords: [[2, 2], [8, 8]], level: 101, isIndex: false }];
    const cut = clipContourLinesOutside(lines, clip);
    expect(cut.map((l) => [l.level, l.coords])).toEqual([[100, [[-5, 5], [0, 5]]], [100, [[10, 5], [15, 5]]]]);
    expect(clipContourLinesOutside(lines, null)).toBe(lines);
    expect(labelInsideClip({ ll: [5, 5] }, clip)).toBe(true); expect(labelInsideClip({ ll: [12, 5] }, clip)).toBe(false);
  });
});

/* ROUND 6 (NEW-1) — DENSITY AND WEIGHT BY ZOOM: the traced set stays at the full interval; what is DRAWN follows the zoom
 * scalar, and a band whose lines would touch on screen drops to the next coarser interval. */
describe("ROUND 6 — density and weight by zoom (planContourDraw)", () => {
  // a plane falling 2% in x on a 1 ft lattice: 1 ft contours every 50 cells
  const w = 120, h = 40;
  const values = new Float32Array(w * h), mask = new Uint8Array(w * h).fill(1);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) values[j * w + i] = 100 + 0.02 * i;
  const grid = { values, mask, width: w, height: h };
  it("pieceSpacingCells reads interval / |∇z| off the lattice (50 cells for 1 ft on a 2% plane; 4 ft lattice → 200 ft)", () => {
    const piece = [[50.5, 2], [50.5, 38]];
    expect(pieceSpacingCells(grid, piece, 1)).toBeCloseTo(50, 1);
    expect(pieceSpacingCells(grid, piece, 2)).toBeCloseTo(100, 1);
    const flat = { values: new Float32Array(w * h).fill(7), mask, width: w, height: h };
    expect(pieceSpacingCells(flat, piece, 1)).toBe(Infinity);
    const c = buildProposedContours(grid, { interval: 1, smoothPasses: 0, labelMinCells: 1 });
    expect(c.levels.length).toBeGreaterThan(1);
    for (const lv of c.levels) { expect(lv.spacing.length).toBe(lv.lines.length); for (const sp of lv.spacing) expect(sp).toBeCloseTo(50, 1); }
    const feet = contourLinesToFeet(c, { x0: 0, y0: 0, dx: 4, dy: 4, nx: w, ny: h });
    for (const lv of feet.levels) { expect(lv.pieces.length).toBe(lv.d.split("M").length - 1); for (const pc of lv.pieces) expect(pc.spacingFt).toBeCloseTo(200, 0); }
    for (const lb of feet.labels) expect(lb.spacingFt).toBeCloseTo(200, 0);
  });
  it("contourMultiple: the parcel filling the map (ppf < 1) draws index lines only; a band whose pitch is under 4 px drops to the next coarser multiple", () => {
    expect(CONTOUR_DRAW.minPitchPx).toBe(4); expect(CONTOUR_DRAW.indexOnlyBelowPpf).toBe(1.0);
    expect(contourMultiple(50, 0.6)).toBe(5);                 // parcel zoom: every 5th, however wide the band
    expect(contourMultiple(50, 2.0)).toBe(1);                 // building zoom, 50 ft spacing → 100 px pitch: every level
    expect(contourMultiple(1.5, 2.0)).toBe(2);                // 1.5 ft spacing at 2 px/ft = 3 px → 2 ft (6 px)
    expect(contourMultiple(0.5, 2.0)).toBe(5);                // a 2:1 bank at 2 px/ft: 1 px pitch → 5 ft (5 px)
    expect(contourMultiple(0.1, 2.0)).toBe(20);               // a near-wall: 20 ft
    expect(contourMultiple(Infinity, 2.0)).toBe(1);           // flat ground: nothing to thin
    expect(contourMultiple(0.5, 0.6)).toBe(20);               // parcel zoom AND steep: coarser still (0.5 × 5 × 0.6 = 1.5 px < 4)
  });
  it("planContourDraw: index only + thin at parcel zoom; every level at building zoom (hairline / heavier index); a steep piece thinned; labels only on drawn pieces", () => {
    const pc = (d, spacingFt) => ({ d, spacingFt, lenFt: 100 });
    const contours = { interval: 1, levels: [
      { level: 100, isIndex: true, d: "M0 0L1 1", pieces: [pc("M0 0L1 1", 50)] },
      { level: 101, isIndex: false, d: "M0 1L1 2", pieces: [pc("M0 1L1 2", 50), pc("M5 5L6 6", 0.5)] },
      { level: 102, isIndex: false, d: "M0 2L1 3M7 7L8 8", pieces: [pc("M0 2L1 3", 50), pc("M7 7L8 8", 0.5)] },
      { level: 105, isIndex: true, d: "M0 5L1 6", pieces: [pc("M0 5L1 6", 50), pc("M9 9L10 10", 0.5)] },
    ], labels: [
      { pt: { x: 0, y: 0 }, level: 100, text: "100", angle: 0, lenFt: 100, spacingFt: 50 },
      { pt: { x: 5, y: 5 }, level: 101, text: "101", angle: 0, lenFt: 100, spacingFt: 0.5 },
      { pt: { x: 0, y: 1 }, level: 101, text: "101", angle: 0, lenFt: 100, spacingFt: 50 },
      { pt: { x: 9, y: 9 }, level: 105, text: "105", angle: 0, lenFt: 100, spacingFt: 0.5 },
    ] };
    const site = planContourDraw(contours, 0.6);
    expect(site.indexOnly).toBe(true);
    expect(site.levels.map((l) => l.level)).toEqual([100, 105]);
    expect(site.levels.every((l) => l.weight === CONTOUR_DRAW.thinPx)).toBe(true);
    expect(site.levels[1].d).toBe("M0 5L1 6");                            // at parcel zoom a 0.5 ft spacing × 5 × 0.6 = 1.5 px → the steep piece drops to 20 ft, and 105 is not a multiple of 20
    expect(site.labels.map((l) => l.level)).toEqual([100]);              // the 105 label rode the steep piece, so it goes with it
    const bldg = planContourDraw(contours, 2.0);
    expect(bldg.indexOnly).toBe(false);
    expect(bldg.levels.map((l) => [l.level, l.weight])).toEqual([[100, CONTOUR_DRAW.indexPx], [101, CONTOUR_DRAW.hairPx], [102, CONTOUR_DRAW.hairPx], [105, CONTOUR_DRAW.indexPx]]);
    expect(bldg.levels[1].d).toBe("M0 1L1 2");                            // the steep piece at 101 (0.5 ft → 1 px pitch) is thinned to 5 ft: not drawn at 101
    expect(bldg.levels[2].d).toBe("M0 2L1 3");                            // …nor at 102
    expect(bldg.levels[3].d).toBe("M0 5L1 6M9 9L10 10");                  // …but drawn at 105
    expect(bldg.labels.map((l) => [l.level, l.pt.x])).toEqual([[100, 0], [101, 0], [105, 9]]);   // the steep 101 label goes with its piece
    expect(planContourDraw(null, 2).levels).toEqual([]);
  });
});

/* ROUND 7 (NEW-1/NEW-2) — the slope band's outline is traced and smoothed like the contours, and the hatch is a tint. */
describe("ROUND 7 — the band outline (daylight line, inner edge) is a smooth closed line, not a cell staircase", () => {
  const ringPx = (ring, F) => ring.map((p) => [(p.x - F.x0) / F.dx, (p.y - F.y0) / F.dy]);
  const GRID = { x0: 0, y0: 0, dx: 1, dy: 1, eps: 2e-3 };   // the clipper grid rounds to a hundredth of a foot
  for (const mode of ["layout", "boundary"]) {
    const { s, existAt } = chehaw(mode);
    const F = bandField(s.grid, { pointInRegions });
    const t = traceBandOutline(F.values.slice(), F.nx, F.ny);
    const traced = bandRingsToFeet(t, F);
    const limitRegions = mode === "boundary" ? s.grid.limit.limitRegions : s.grid.limit.regions;
    const shapes = bandRegions({ traced, limitRegions, mode });
    it(`${mode}: every traced ring is closed, never crosses itself, and has no run of more than two vertices on cell edges`, () => {
      expect(t.rings.length).toBeGreaterThanOrEqual(1);
      for (const r of [...t.rings, ...t.holes]) {
        expect(r.length).toBeGreaterThan(8);
        expect(r[0]).toEqual(r[r.length - 1]);
        expect(selfIntersects(r)).toBe(false);
        expect(longestCellEdgeRun(r, GRID)).toBeLessThanOrEqual(2);
        expect(longestCornerRun(r, GRID)).toBeLessThanOrEqual(2);
      }
      for (const r of shapes.daylight) {
        expect(longestCellEdgeRun(ringPx(r, F), GRID)).toBeLessThanOrEqual(2);
        expect(longestCornerRun(ringPx(r, F), GRID)).toBeLessThanOrEqual(2);
      }
    });
    it(`${mode}: known-bad arm — the old cell-edge outline IS a staircase on the same metric (so the check above can see one)`, () => {
      const sq = s.grid.cells.filter((c) => c.wedge).map((c) => rect(c.x - c.wFt / 2, c.y - c.hFt / 2, c.wFt, c.hFt));
      const staircase = unionRings(sq);                                        // the old per-cell outline, as rings
      expect(staircase.length).toBeGreaterThanOrEqual(1);
      const worst = Math.max(...staircase.map((r) => longestCornerRun(ringPx(r.outer, F), GRID)));
      expect(worst).toBeGreaterThan(10);
    });
    it(`${mode}: the band covers the slope cells and stays off the open ground / the pad`, () => {
      const wedge = s.grid.cells.filter((c) => c.wedge && !c.out);
      expect(wedge.length).toBeGreaterThan(100);
      const inBand = wedge.filter((c) => pointInRegions(c, shapes.band)).length;
      expect(inBand / wedge.length).toBeGreaterThan(0.9);
      const pad = s.grid.cells.filter((c) => c.cls === "buildingPad");
      expect(pad.length).toBeGreaterThan(100);
      expect(pad.filter((c) => pointInRegions(c, shapes.band)).length).toBe(0);
    });
    if (mode === "layout") {
      it("layout: the traced daylight line agrees with the contours' own daylight line (where the slope meets existing ground, round 5) to within one earthwork cell", () => {
        const { feet } = chehaw("layout");
        const cell = s.grid.cells[0].wFt;
        const segDist = (p, r) => { let b = Infinity; for (let i = 0; i < r.length; i++) { const a = r[i], c = r[(i + 1) % r.length]; const dx = c.x - a.x, dy = c.y - a.y, l2 = dx * dx + dy * dy || 1; const tt = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)); b = Math.min(b, Math.hypot(p.x - a.x - dx * tt, p.y - a.y - dy * tt)); } return b; };
        const ds = [];
        for (const r of shapes.daylight) for (const p of r) ds.push(Math.min(...feet.daylight.rings.map((q) => segDist(p, q))));
        ds.sort((a, b) => a - b);
        expect(ds.length).toBeGreaterThan(50);
        expect(ds[ds.length >> 1]).toBeLessThanOrEqual(0.5 * cell);
        expect(ds[ds.length - 1]).toBeLessThanOrEqual(1.25 * cell);
      });
    } else {
      it("boundary: the daylight line IS the setback (B2376240) and the inner edge closes round the open ground", () => {
        expect(shapes.daylight.length).toBe(limitRegions.reduce((n, r) => n + 1 + r.holes.length, 0));
        expect(shapes.inner.length).toBeGreaterThanOrEqual(1);
        for (const r of shapes.inner) expect(selfIntersects(r.map((p) => [p.x, p.y]))).toBe(false);
      });
    }
  }
  it("NEW-2: the hatch is a tint — never more than a quarter opacity at full depth; outside the setback stays a stronger alert", () => {
    expect(BAND_TINT.max).toBeLessThanOrEqual(0.25);
    expect(cellPaint({ dzFt: 30 }).a).toBeCloseTo(BAND_TINT.max, 6);
    expect(cellPaint({ dzFt: -0.3 }).a).toBeLessThan(BAND_TINT.max);
    expect(cellPaint({ dzFt: 5, out: true }).a).toBeGreaterThan(BAND_TINT.max);
    expect(cellPaint({ dzFt: 0.01 })).toBeNull();
  });
});
