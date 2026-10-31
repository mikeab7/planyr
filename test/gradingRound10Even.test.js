import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet, feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";
import { sampleAtLatLng } from "../src/workspaces/site-planner/lib/demGrid.js";
import { buildProposedSurface, contourLattice } from "../src/workspaces/site-planner/lib/proposedSurface.js";
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


/* ROUND 10 (NEW-1 — the THIRD attempt at even band contours; B2571184 ×3, B2431312 ×2; owner 2026-10-30 7:11 and 7:15 PM CT, Concept A,
 * "To the boundary"). Round 9 proved the band's SURFACE is an exact plane at the ratio and called it done — but the lines the owner
 * SEES are the traced polylines, and round 9's guard probed the surface, never the drawn lines. Measured on the owner's Concept A:
 * `buildContours` simplified every traced ring at 0.5 cell (3 ft on the contour lattice) and the proposed tracer again at 0.12 cell, which
 * moves a line by up to a fifth of the 4 ft it sits from its neighbour (crossings of one transect 5.6 / 3.0 / 3.8 / 3.9 / 4.7 / 4.1 ft apart
 * against a true 4.0). THESE tests judge the TRACED POLYLINES (contourLinesToFeet), the thing painted. */

const trace = (sf, S2, extra = {}) => {
  const L = contourLattice(sf.grid, { existAt: S2.existAt });
  const mask = new Uint8Array(L.nx * L.ny), work = new Float32Array(L.nx * L.ny);
  for (let k = 0; k < mask.length; k++) { const v = L.values[k]; if (v === v) { mask[k] = 1; work[k] = v; } }
  const c = buildProposedContours({ values: work, mask, width: L.nx, height: L.ny }, { interval: L.interval, inside: L.inside, clipRings: L.clipRings ? ringsToLatticePx(L.clipRings, L) : null, clipHoles: L.clipHoles ? ringsToLatticePx(L.clipHoles, L) : null, cutRings: ringsToLatticePx(L.pads, L), labelMinCells: Math.max(8, Math.ceil(40 / L.cellFt)), ...extra });
  return { L, c, feet: contourLinesToFeet(c, L) };
};
const piecesOf = (feet) => feet.levels.flatMap((lv) => lv.pieces.map((pc) => ({ level: lv.level, pts: [...pc.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] })) })));
const turnAt = (a, b, c) => { const a1 = Math.atan2(b.y - a.y, b.x - a.x), a2 = Math.atan2(c.y - b.y, c.x - b.x); let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d; return (d * 180) / Math.PI; };

describe("NEW-1 — a synthetic flat-ground site: the band is concentric offsets of the (rounded) limit, evenly spaced", () => {
  // 780 × 480 ft inside a 800 × 500 parcel, ground flat at 780, finished floor 800: a 20 ft fill, so a ~40 ft band all round
  const parcel = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 500 }, { x: 0, y: 500 }];
  const existAt = () => 780;
  const FFE2 = 800;
  const els = [{ id: "b", type: "building", ring: [{ x: 300, y: 150 }, { x: 500, y: 150 }, { x: 500, y: 250 }, { x: 300, y: 250 }], dockStack: null, accessible: false, slopeOverridePct: null, padElevFt: FFE2 }];
  const setback = gradingSetback([{ id: "pc", points: parcel, active: true }], 25);
  const cfg = gradingCfg({ enabled: true, limitMode: "boundary", layers: { cutfill: true, contours: true } });
  const sf = buildProposedSurface({ els, ffeFt: null, dockDropFt: 4, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [], opts: { existKey: "r10-flat" }, grading: gradingPack(cfg, setback) });
  const T = trace(sf, { existAt });
  const pieces = piecesOf(T.feet);
  const outer = sf.grid.limit.limitRegions[0].outer;
  const R = sf.grid.limit.cornerRadiusFt;
  const xs = outer.map((p) => p.x), ys = outer.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  it("the limit is still the exact property inset (its corners are NOT rounded — only the slope's throw edge is)", () => {
    expect(Math.abs(x1 - x0 - 780)).toBeLessThan(0.5); expect(Math.abs(y1 - y0 - 480)).toBeLessThan(0.5);
    expect(outer.some((p) => Math.hypot(p.x - x0, p.y - y0) < 0.5)).toBe(true);           // the sharp corner vertex is still there
    expect(R).toBeGreaterThanOrEqual(30);
  });
  it("(spacing) along a transect across the straight run, every consecutive spacing of the DRAWN contours is interval × 2:1 within 5%", () => {
    const iv = T.L.interval, want = iv * 2;
    let judged = 0; const bad = [];
    for (const x of [200, 300, 400, 500, 600]) {
      // inward from the north edge at fixed x: the contours the line x crosses, ordered by distance from the edge
      const cr = [];
      for (const pc of pieces) for (let i = 1; i < pc.pts.length; i++) {
        const a = pc.pts[i - 1], b = pc.pts[i];
        if ((a.x - x) * (b.x - x) < 0) cr.push({ d: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) - y0, level: pc.level });
      }
      cr.sort((p, q) => p.d - q.d);
      if (process.env.R10_DEBUG) console.log('x', x, cr.map((c) => c.level + '@' + c.d.toFixed(2)).join(' '));
      const body = cr.filter((c) => c.d > 0.5 && c.d < 20);       // the bank's body (past ~half the band the toe eases into the open ground)
      for (let i = 1; i < body.length; i++) { judged++; const sp = body[i].d - body[i - 1].d; if (Math.abs(sp - want) > 0.05 * want) bad.push({ x, sp: +sp.toFixed(2), want }); }
    }
    expect(judged).toBeGreaterThan(8);
    expect(bad).toEqual([]);
  });
  it("(corners) the bank's contours turn the limit's corners as arcs: at depth c the line is a circle of radius R − c about the fillet centre, and never turns more than 20° between segments (a tight 12 ft arc on a 3 ft lattice is ~15° a step; a mitre is 90°)", () => {
    const iv = T.L.interval, ratio = 2;
    const corners = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]];
    let judged = 0; const bad = [];
    for (const [cx, cy, sx, sy] of corners) {
      const C = { x: cx + sx * R, y: cy + sy * R };                // the fillet's centre
      for (const c of [14, 18]) {                                  // the contour at depth c: level = ground + c / ratio — deeper than the corner's sliver (≈ 0.41 R from the vertex), inside the bank's body
        const level = 780 + c / ratio;
        if (Math.abs(level / iv - Math.round(level / iv)) > 1e-6) continue;
        const arcPts = [];
        for (const pc of pieces) if (pc.level === level) for (const p of pc.pts) {
          // the quarter of the circle that wraps the corner: the points on the corner's side of the centre
          if ((p.x - C.x) * -sx > 0.3 && (p.y - C.y) * -sy > 0.3) arcPts.push(p);
        }
        if (arcPts.length < 3) { bad.push({ corner: [cx, cy], c, why: "no arc" }); continue; }
        judged++;
        const err = Math.max(...arcPts.map((p) => Math.abs(Math.hypot(p.x - C.x, p.y - C.y) - (R - c))));
        if (err > T.L.cellFt) bad.push({ corner: [cx, cy], c, err: +err.toFixed(2) });
        // no hard mitre anywhere along the line within the corner's span
        for (const pc of pieces) if (pc.level === level) for (let i = 1; i < pc.pts.length - 1; i++) {
          const p = pc.pts[i]; if (Math.hypot(p.x - C.x, p.y - C.y) > R + 6) continue;
          if (turnAt(pc.pts[i - 1], p, pc.pts[i + 1]) > 20) bad.push({ corner: [cx, cy], c, turn: +turnAt(pc.pts[i - 1], p, pc.pts[i + 1]).toFixed(1) });
        }
      }
    }
    if (process.env.R10_DEBUG) console.log('CORNER bad', JSON.stringify(bad), 'judged', judged, 'R', R, 'cell', T.L.cellFt, 'interval', iv);
    expect(judged).toBeGreaterThanOrEqual(8);
    expect(bad).toEqual([]);
  });
});

describe("NEW-1 — the owner's Concept A, 'To the boundary': the drawn band contours are evenly spaced across the straight runs", () => {
  const S = conceptA();
  const B = S.build(792.2, "boundary");
  const T = trace(B, S);
  const pieces = piecesOf(T.feet);
  it("every consecutive spacing across the bank's body is interval × ratio within 5% on every straight run ≥ 300 ft (judged off the traced lines)", () => {
    const outer = B.grid.limit.limitRegions[0].outer, regions = B.grid.limit.limitRegions;
    const want = T.L.interval * B.grid.apronRatio;
    let runs = 0; const bad = [];
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length], L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 300) continue;
      let n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
      if (!pointInRegions({ x: (a.x + b.x) / 2 + n.x * 5, y: (a.y + b.y) / 2 + n.y * 5 }, regions)) n = { x: -n.x, y: -n.y };
      for (const t of [0.4, 0.5, 0.6]) {
        const o = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, far = { x: o.x + n.x * 80, y: o.y + n.y * 80 };
        const cr = [];
        for (const pc of pieces) for (let k = 1; k < pc.pts.length; k++) {
          const p = pc.pts[k - 1], q = pc.pts[k];
          const d1 = (far.x - o.x) * (p.y - o.y) - (far.y - o.y) * (p.x - o.x), d2 = (far.x - o.x) * (q.y - o.y) - (far.y - o.y) * (q.x - o.x);
          if (d1 * d2 < 0) { const u = d1 / (d1 - d2), x = p.x + (q.x - p.x) * u, y = p.y + (q.y - p.y) * u; const along = (x - o.x) * n.x + (y - o.y) * n.y; if (along > 0 && along < 80) cr.push(along); }
        }
        cr.sort((p, q) => p - q);
        if (process.env.R10_DEBUG && i === 2) console.log('edge', i, t, cr.slice(0, 12).map((d) => d.toFixed(2)).join(' '));
        // the bank's BODY: from the first crossing inward until the toe (the first spacing off by more than 12% — where the bank
        // eases into the drained open ground). The first five spacings must each be right to 5%: the pre-fix trace is off by more than 5% within its first two spacings, so it has no body at all.
        const all = cr.filter((d) => d > 0.3);
        if (all.filter((d) => d < 40).length < 7) continue;        // no real bank here (the cut or fill is a few feet)
        let clean = 0, sawBody = false;
        for (let k = 1; k < all.length; k++) {
          const sp = all[k] - all[k - 1], off = Math.abs(sp - want) / want;
          if (off > 0.05) break;
          sawBody = true; clean++;
        }
        if (clean < 5) bad.push({ edge: i, t, body: clean + 1, why: "no bank body of 5 lines" });
        if (sawBody) runs++;
      }
    }
    if (process.env.R10_DEBUG) console.log('A bad', JSON.stringify(bad), runs);
    expect(runs).toBeGreaterThan(4);
    expect(bad).toEqual([]);
  });
});
