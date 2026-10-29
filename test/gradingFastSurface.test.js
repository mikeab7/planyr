// B2319137 ×3 (V1950033 FAILED, owner 2026-10-29): the grading picture took ~65 s on a fresh load and never came back after
// three zoom steps. Three causes, three guards here:
//   (1) the open ground's cone search scanned every piece of every graded outline for every lattice node, on every build of the
//       FFE search — now blocks of pieces are skipped by an exact lower bound, and the limit's nearest edge comes off a grid;
//       both must give EXACTLY the full scan's answer (switched off with __setFastSurface for the comparison);
//   (2) the build waited for a painted frame between slices — runChunked now waits at most FRAME_WAIT_MS (test/runChunkedFrames);
//   (3) grading's worker jobs queued behind the existing contour layer's tile traces on ONE worker — grading has its own.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet, feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";
import { sampleAtLatLng } from "../src/workspaces/site-planner/lib/demGrid.js";
import { buildProposedSurface, regionEdgeIndex, nearestOnRegions, __setFastSurface } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { gradingCfg, gradingSetback, gradingPack, hostIdMap } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { CHEHAW_CROSS_DOCK_ROWS, rowRing, OWNER_ORIGIN } from "../ui-audit/lib/chehawCrossDock.mjs";

function chehaw() {
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
  const setback = gradingSetback([{ id: "pc", points: ring, active: true }], 25);
  const build = (FFE, mode, tag) => {
    const cfg = gradingCfg({ enabled: true, limitMode: mode, layers: { cutfill: true, contours: true } });
    return buildProposedSurface({
      els: els.map((e) => ({ id: e.id, type: e.type, ring: e.ring, dockStack: e.dockStack || null, accessible: false, slopeOverridePct: null, padElevFt: e.type === "building" ? FFE : null, ...(e.type !== "building" ? { hostId: hosts.get(e.id) ?? null } : {}) })),
      ffeFt: null, dockDropFt: 4, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [],
      opts: { existKey: `fast:${tag}:${mode}:${FFE}` }, grading: gradingPack(cfg, setback) });
  };
  return { build };
}

afterAll(() => __setFastSurface(true));

describe("the fast surface IS the full scan (real Chehaw ground, the owner's cross-dock)", () => {
  const C = chehaw();
  for (const mode of ["boundary", "layout"]) {
    it(`${mode}: every earthwork cell, the limit and the totals are identical with the shortcuts on and off`, () => {
      __setFastSurface(true);
      const t0 = performance.now(); const fast = C.build(790.3, mode, "on"); const tFast = performance.now() - t0;
      __setFastSurface(false);
      const t1 = performance.now(); const full = C.build(790.3, mode, "off"); const tFull = performance.now() - t1;
      __setFastSurface(true);
      expect(fast.grid.cells.length).toBe(full.grid.cells.length);
      for (let i = 0; i < full.grid.cells.length; i++) {
        const a = fast.grid.cells[i], b = full.grid.cells[i];
        expect([a.x, a.y, a.elId, a.propFt ?? null, a.dzFt ?? null]).toEqual([b.x, b.y, b.elId, b.propFt ?? null, b.dzFt ?? null]);
      }
      expect(fast.grid.cutCf).toBe(full.grid.cutCf);
      expect(fast.grid.fillCf).toBe(full.grid.fillCf);
      expect(fast.grid.limit.areaAc).toBe(full.grid.limit.areaAc);
      // the speed is measured in the browser (ui-audit perf-grading-freeze); one cold run here is too noisy to assert on
      console.log(`  ${mode}: fast ${tFast.toFixed(0)} ms · full scan ${tFull.toFixed(0)} ms`);
    }, 120000);
  }
});

describe("regionEdgeIndex.nearest === nearestOnRegions (point, distance AND region, ties included)", () => {
  const ring = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) * 0.7 }));
  const regions = [{ outer: ring(0, 0, 900, 240), holes: [ring(100, 50, 120, 30)] }, { outer: ring(2400, 300, 400, 7), holes: [] }];
  const idx = regionEdgeIndex(regions);
  it("on 3,000 points inside, outside and far off the regions", () => {
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 3000; i++) {
      const pt = { x: -2500 + rnd() * 6000, y: -2000 + rnd() * 4000 };
      const a = idx.nearest(pt), b = nearestOnRegions(pt, regions);
      expect([a.d, a.q.x, a.q.y, a.k]).toEqual([b.d, b.q.x, b.q.y, b.k]);
    }
  });
  it("on the vertices themselves (exact ties between two edges)", () => {
    for (const r of regions) for (const p of r.outer) {
      const a = idx.nearest(p), b = nearestOnRegions(p, regions);
      expect([a.d, a.q.x, a.q.y, a.k]).toEqual([b.d, b.q.x, b.q.y, b.k]);
    }
  });
});

describe("grading has its own worker — map tiles never queue in front of it", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/lib/terrainLayers.js", import.meta.url), "utf8");
  it("the ground sweep / pad mask, the band outline and the proposed contours post to the GRADING worker", () => {
    expect(src).toMatch(/export function runBuildableJob\(payload\) \{\s*return gradingWorker\.post\(/);
    expect(src).toMatch(/export function runBandOutlineJob\(payload\) \{\s*return gradingWorker\.post\(/);
    expect(src).toMatch(/export function runProposedContoursJob\(payload\) \{\s*return gradingWorker\.post\(/);
  });
  it("the existing contour layer's tiles post to the TILE worker, and nothing else posts anywhere", () => {
    expect(src).toMatch(/await tileWorker\.post\(\{ req, buffer: buf/);
    expect((src.match(/get\(\)\.postMessage\(/g) || []).length).toBe(1);     // the one inside workerSlot
    expect(src).not.toMatch(/getWorker\(\)/);
  });
});
