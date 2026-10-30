// ROUND 9 (B2500224 ×2, owner live check 2026-10-30 on Georgia Test Site › Concept A, "To the boundary", NE corner at the
// 50-ft scale): the panel said "to the property line (10 ft margin)", but the cut band hugged the truck court with a strip of
// paper and EXISTING contours between it and the limit. Measured on planyr.io (ui-audit diagnose-grading-boundary-live): the
// band painted at that moment was the LAYOUT-mode composition — the band, the proposed contours and the existing-contour cut are
// traced separately from the surface and the previous limit's picture stayed up until each re-trace landed. NEW-1: one limit —
// every picture is painted only against the limit the surface carries now (lib/gradingPicture.js). NEW-2: inside the slope band
// the surface is the exact plane at the ratio (proposedSurface.js), so the band's contours are evenly spaced.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet, feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";
import { sampleAtLatLng } from "../src/workspaces/site-planner/lib/demGrid.js";
import { buildProposedSurface, nearestOnRing } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { propertyLimit, pointInRegions, resolveGradingLimit } from "../src/workspaces/site-planner/lib/gradingLimit.js";
import { gradingCfg, gradingSetback, gradingPack, hostIdMap } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { limitSigOf, tracedOnLimit, existingClipFeet, publishedContours, publishedBand, limitRingsOf } from "../src/workspaces/site-planner/lib/gradingPicture.js";
import { planContourDraw } from "../src/workspaces/site-planner/lib/gradingPaint.js";
import { buildContours } from "../src/workspaces/site-planner/lib/contourTrace.js";
import { clipPolyline } from "../src/workspaces/site-planner/lib/polylineClip.js";
import { pointInRing } from "../src/workspaces/site-planner/lib/pondGeom.js";
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

const S = conceptA();
const FFE = 792.2;                       // the floor the live planner suggested for this layout (2026-10-30)
const B = S.build(FFE, "boundary");
const Lay = S.build(FFE, "layout");
const court = S.els.find((e) => e.id === "e336olvzwe");   // the east truck court (the NE corner's court)

describe("NEW-1 — ONE limit: the panel, the surface, the band, the contours and the existing-contour cut read the same ring", () => {
  it("(a) the limit the panel reports IS the property limit the surface graded to (deep-equal rings, one identity)", () => {
    const L = B.grid.limit;
    expect(L.mode).toBe("boundary");
    expect(L.basis).toEqual({ kind: "property", marginFt: 10, bufferFt: 0 });
    const pl = propertyLimit({ parcelRings: S.setback.parcelRings, holes: S.setback.holes, marginFt: 10, bufferFt: 0 });
    expect(limitRingsOf(B.grid).rings).toEqual(pl.rings);
    // the resolver's own identity is carried on the grid, and it is not the layout limit's
    const again = resolveGradingLimit({ els: [], spec: { mode: "boundary", setbackRings: pl.rings, setbackHoles: pl.holes } });
    expect(limitSigOf(B.grid)).toBe(again.defSig);
    // an element edit is not a new limit in boundary mode: the same definition, so the picture in flight stays up
    expect(limitSigOf(S.build(FFE + 1, "boundary").grid)).toBe(limitSigOf(B.grid));
    expect(limitSigOf(B.grid)).not.toBe(limitSigOf(Lay.grid));
    // the clip the existing layer is cut by in boundary mode is that same ring, with no trace at all
    expect(existingClipFeet(B.grid, null)).toEqual({ rings: pl.rings, holes: pl.holes });
  });

  it("(a) a band or contour set traced against the OTHER mode's limit is never painted under this one (the measured defect)", () => {
    const layoutBand = { limitSig: limitSigOf(Lay.grid), band: [{ outer: court.ring, holes: [] }], daylight: [], inner: [], mode: "layout", source: "contours" };
    expect(publishedBand(layoutBand, B.grid)).toBe(null);
    expect(publishedBand({ ...layoutBand, limitSig: limitSigOf(B.grid) }, B.grid)).not.toBe(null);
    const layoutContours = { key: "k", limitSig: limitSigOf(Lay.grid), interval: 1, levels: [{ level: 790, isIndex: true, pieces: [{ d: "M0 0L1 1", spacingFt: 2 }] }], labels: [], daylight: { rings: [court.ring], holes: [] } };
    const pub = publishedContours(layoutContours, B.grid, (r) => r.map((p) => [p.y, p.x]));
    expect(pub.levels).toEqual([]);
    expect(pub.pending).toBe(true);
    expect(pub.daylight).toEqual(limitRingsOf(B.grid));      // the cut is still the current limit, not the stale trace
    expect(tracedOnLimit({ limitSig: limitSigOf(B.grid) }, B.grid)).toBe(true);
    expect(tracedOnLimit({ limitSig: "" }, B.grid)).toBe(false);
  });

  it("(b) no existing-contour segment survives inside the limit", () => {
    const rx = S.ring.map((p) => p.x), ry = S.ring.map((p) => p.y);
    const cell = 6, x0 = Math.min(...rx) - 60, y0 = Math.min(...ry) - 60;
    const nx = Math.ceil((Math.max(...rx) - x0 + 60) / cell), ny = Math.ceil((Math.max(...ry) - y0 + 60) / cell);
    const values = new Float32Array(nx * ny), mask = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const g = S.existAt({ x: x0 + (i + 0.5) * cell, y: y0 + (j + 0.5) * cell }); if (g != null) { values[j * nx + i] = g; mask[j * nx + i] = 1; } }
    const c = buildContours({ values, mask, width: nx, height: ny }, { interval: 2, maxLevels: 200, labelCap: 0 });
    const clip = existingClipFeet(B.grid, null);
    const toPx = (r) => r.map((p) => [(p.x - x0) / cell, (p.y - y0) / cell]);
    const rings = [...clip.rings.map(toPx), ...clip.holes.map(toPx)];
    const regions = B.grid.limit.limitRegions;
    let kept = 0, inside = [];
    for (const lv of c.levels) for (const run of lv.lines) for (const piece of clipPolyline(run, rings, { keepInside: false })) {
      for (const [px, py] of piece) {
        kept++;
        const pt = { x: x0 + px * cell, y: y0 + py * cell };
        if (!pointInRegions(pt, regions)) continue;
        // a vertex ON the line is the cut itself; one a foot or more inside is a leak
        let d = Infinity; for (const r of clip.rings) { const q = nearestOnRing(pt, r); if (q) d = Math.min(d, Math.hypot(pt.x - q.x, pt.y - q.y)); }
        if (d > 1) inside.push(pt);
      }
    }
    expect(kept).toBeGreaterThan(500);                       // known-good arm: there IS existing ink outside the limit
    expect(inside).toEqual([]);
  });

  it("(c) the strip between the court and the limit is graded — every open-ground point carries a proposed elevation, and it is not left at existing ground where the two differ", () => {
    // walk outward from the east court's outer face to the limit along its normal, at ten stations
    const [p0, p1, p2] = court.ring;
    const ex = p1.x - p0.x, ey = p1.y - p0.y, L = Math.hypot(ex, ey);
    let n = { x: -ey / L, y: ex / L };
    const cc = court.ring.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    if ((mid.x - cc.x) * n.x + (mid.y - cc.y) * n.y < 0) n = { x: -n.x, y: -n.y };
    const regions = B.grid.limit.limitRegions;
    let sampled = 0, ungraded = [], skipped = 0;
    for (let k = 1; k < 10; k++) {
      const a = { x: p0.x + ex * k / 10, y: p0.y + ey * k / 10 };
      for (let d = 2; d < 1500; d += 3) {
        const pt = { x: a.x + n.x * d, y: a.y + n.y * d };
        if (!pointInRegions(pt, regions)) break;
        if (S.els.some((e) => pointInRing(pt, e.ring))) continue;
        const r = B.grid.probe(pt);
        sampled++;
        if (r.status !== "value") { ungraded.push(pt); continue; }
        // the open ground is the drainage surface, the band clamps it toward the ground: graded means "a proposed elevation
        // of its own", which coincides with existing only at the daylight itself
        const g = S.existAt(pt);
        if (g != null && Math.abs(r.ft - g) <= 0.1 && r.cls === "infill") skipped++;
      }
    }
    expect(sampled).toBeGreaterThan(200);
    expect(ungraded).toEqual([]);
    expect(skipped / sampled).toBeLessThan(0.05);
  });

  it("(d) the band's outer edge is never a parallel offset of an element edge (it follows the ground and the property line)", () => {
    const outer = B.grid.limit.limitRegions[0].outer;
    const dists = [];
    for (const p of outer) {
      const q = nearestOnRing(p, court.ring);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < 600) dists.push(d);
    }
    expect(dists.length).toBeGreaterThan(3);
    const cellFt = 13;
    expect(Math.max(...dists) - Math.min(...dists)).toBeGreaterThan(cellFt);
  });
});

/* The band's contour spacing along a transect: probe at a fine step, find every crossing of an interval level by linear
 * interpolation, keep consecutive crossings that are BOTH in the band. */
function bandSpacings(grid, a, n, maxD, interval = 1) {
  const step = 0.2, out = [];
  let prev = null, lastCross = null;
  for (let d = 0; d <= maxD; d += step) {
    const pt = { x: a.x + n.x * d, y: a.y + n.y * d };
    const r = grid.probe(pt);
    const cur = r.status === "value" ? { d, z: r.ft, band: r.cls === "transition" } : null;
    if (prev && cur && prev.band && cur.band) {
      const lo = Math.min(prev.z, cur.z), hi = Math.max(prev.z, cur.z);
      for (let lv = Math.ceil(lo / interval) * interval; lv <= hi; lv += interval) {
        if (lv === lo && lo !== hi) continue;
        const t = hi === lo ? 0 : (lv - prev.z) / (cur.z - prev.z);
        const dc = prev.d + t * step;
        if (lastCross != null) out.push(dc - lastCross);
        lastCross = dc;
      }
    } else lastCross = null;
    prev = cur;
  }
  return out;
}

describe("NEW-2 — inside a slope band the contours are evenly spaced at interval × ratio", () => {
  it("boundary mode: along transects across the straight runs of the band, consecutive spacings are equal within 10% and equal to 1 ft × 2:1", () => {
    const outer = B.grid.limit.limitRegions[0].outer;
    let runs = 0, bad = [];
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 300) continue;                                  // a straight run long enough to judge away from its corners
      let n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!pointInRegions({ x: m.x + n.x * 5, y: m.y + n.y * 5 }, B.grid.limit.limitRegions)) n = { x: -n.x, y: -n.y };
      for (const t of [0.3, 0.5, 0.7]) {
        const s = { x: a.x + (b.x - a.x) * t + n.x * 0.5, y: a.y + (b.y - a.y) * t + n.y * 0.5 };
        // the bank's body: the last three crossings are the TOE, where the bank meets the drained open ground (or a filled
        // swale) and its slope has to ease into it — a real change of grade, not a spacing defect
        const sp = bandSpacings(B.grid, s, n, 120).slice(0, -3);
        if (sp.length < 3) continue;
        runs++;
        if (process.env.R9_DEBUG) console.log("edge", i, "t", t, sp.map((v) => v.toFixed(2)).join(" "));
        for (const v of sp) if (Math.abs(v - 2) > 0.2) bad.push({ edge: i, t, v: +v.toFixed(2) });
      }
    }
    expect(runs).toBeGreaterThan(4);
    expect(bad).toEqual([]);
  });

  it("layout mode: across the east court's slope band, the same — every 1 ft × 2:1", () => {
    // the court's long side that faces AWAY from the building (its outer face)
    const bc = S.els[0].ring.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    const sides = [[court.ring[0], court.ring[1]], [court.ring[2], court.ring[3]]];
    const far = (s2) => Math.hypot((s2[0].x + s2[1].x) / 2 - bc.x, (s2[0].y + s2[1].y) / 2 - bc.y);
    const [p0, p1] = far(sides[0]) > far(sides[1]) ? sides[0] : sides[1];
    const ex = p1.x - p0.x, ey = p1.y - p0.y, L = Math.hypot(ex, ey);
    let n = { x: -ey / L, y: ex / L };
    const cc = court.ring.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    if (((p0.x + p1.x) / 2 - cc.x) * n.x + ((p0.y + p1.y) / 2 - cc.y) * n.y < 0) n = { x: -n.x, y: -n.y };
    const regions = Lay.grid.limit.regions;
    let runs = 0, bad = [];
    for (const t of [0.3, 0.5, 0.7]) {
      const a = { x: p0.x + ex * t, y: p0.y + ey * t };
      let d0 = 0; while (d0 < 600 && pointInRegions({ x: a.x + n.x * d0, y: a.y + n.y * d0 }, regions)) d0 += 0.5;
      const s = { x: a.x + n.x * (d0 + 0.5), y: a.y + n.y * (d0 + 0.5) };
      const sp = bandSpacings(Lay.grid, s, n, 150).slice(0, -3);
      if (sp.length < 3) continue;
      runs++;
      for (const v of sp) if (Math.abs(v - 2) > 0.2) bad.push({ t, v: +v.toFixed(2) });
    }
    expect(runs).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it("the draw plan thins the whole band with ONE multiple — never every-level pieces beside every-other-level pieces", () => {
    // three band pieces whose measured spacings scatter around 2 ft (1 ft × 2:1): at a zoom where 2 ft is under the minimum
    // pitch, every one of them takes the same multiple
    const lv = (level, sp) => ({ level, isIndex: level % 5 === 0, pieces: [{ d: `M${level} 0L${level} 1`, spacingFt: sp }] });
    const contours = { interval: 1, bandSpacingFt: 2, levels: [lv(791, 1.7), lv(792, 2.4), lv(793, 2.0), lv(794, 1.6), lv(795, 2.9), lv(796, 2.2)], labels: [] };
    const rppf = 1.0;                                          // 2 ft × 1.0 = 2 px: thinned to every 2nd level (4 px)
    const plan = planContourDraw(contours, rppf);
    expect(plan.levels.map((l) => l.level)).toEqual([792, 794, 796]);
    // without the band spacing the scatter decides piece by piece — the mixture the owner saw
    const mixed = planContourDraw({ ...contours, bandSpacingFt: undefined }, rppf);
    expect(mixed.levels.map((l) => l.level)).not.toEqual([792, 794, 796]);
  });
});
