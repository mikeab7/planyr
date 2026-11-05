import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildLattice, prepareSweep, maskAt, cachedMaskAt, sweep, groundSummary, severityOfShare, parcelRelief,
  latticeZAt, clearSweepCache, ringAreaSf, SQFT_PER_ACRE,
} from "../src/workspaces/site-planner/lib/buildableGround.js";
import { latticeFromDem, sweepBBox } from "../src/workspaces/site-planner/lib/buildableLattice.js";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet } from "../src/workspaces/site-planner/lib/mapLock.js";
import { offsetPolygon } from "../src/workspaces/site-planner/lib/parcelOffset.js";

/* NEW-1 — the buildable-ground sweep. Two kinds of proof: an ANALYTIC plane whose answer is derivable on
 * paper (so the engine is checked against mathematics, not against itself), and the REAL Chehaw Rd parcel
 * (Spalding Co. GA, parcel 218 02007, real USGS 3DEP ground) against the numbers the owner's prototype
 * measured: the largest single level pad at 2:1, no walls, ≤12 ft cut/fill, setbacks 50/25 is 37.4 of
 * 74.0 ac with a best finish of 795. */

const rect = (w, h, x = 0, y = 0) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

describe("buildableGround — analytic tilted plane", () => {
  beforeEach(() => clearSweepCache());
  // z = g·x over a 1000 × 800 ft setback rectangle. Pad at E: band |E − g x| ≤ D is 2D/g wide, and the
  // 2:1 slope off the N and S edges eats s·|E − z| of run at each cell (the ground does not change along y,
  // so a cell with t ft of cut/fill daylights s·t ft away): lost area = 2 sides · s · ∫t dx = 2·s·D²/g.
  const g = 0.05, D = 12, s = 2, E = 25;
  const lat = buildLattice({ bbox: [-200, -200, 1200, 1000], cell: 10, sample: (x) => g * x });
  const ctx = prepareSweep({ lattice: lat, rings: [rect(1000, 800)] });

  it("pad area matches 2D/g wide band minus the slope reach at the edges, within 3%", () => {
    const r = maskAt(ctx, E, s, D);
    const expected = (2 * D / g) * 800 - 2 * s * D * D / g;
    expect(Math.abs(r.areaSf - expected) / expected).toBeLessThan(0.03);
  });
  it("is one connected pad whose width is 2D/g at the centre line", () => {
    const r = maskAt(ctx, E, s, D);
    const { nx, x0, cell } = lat;
    const j = Math.floor((400 - lat.y0) / cell);
    let n = 0; for (let i = 0; i < nx; i++) n += r.mask[j * nx + i];
    expect(Math.abs(n * cell - 2 * D / g)).toBeLessThanOrEqual(2 * cell);
    void x0;
  });
  it("a pad finish above the ground range of the parcel is empty", () => {
    expect(maskAt(ctx, 500, s, D).areaSf).toBe(0);
  });
  it("a steeper slope ratio (3:1) never gains area", () => {
    expect(maskAt(ctx, E, 3, D).areaSf).toBeLessThanOrEqual(maskAt(ctx, E, 2, D).areaSf);
  });
  it("a deeper allowed cut/fill never loses area", () => {
    expect(maskAt(ctx, E, s, 20).areaSf).toBeGreaterThanOrEqual(maskAt(ctx, E, s, 12).areaSf);
  });
  it("the sweep reports the finish with the largest pad and a full curve", () => {
    const sw = sweep(ctx, { s, D });
    expect(sw.curve.length).toBeGreaterThan(20);
    const bestFromCurve = sw.curve.reduce((a, c) => (c.areaSf > a.areaSf ? c : a));
    expect(sw.best.E).toBe(bestFromCurve.E);
    // the whole band fits for any finish in about [12, 38] (a plateau — the FIRST maximum is reported)
    expect(sw.best.E).toBeGreaterThanOrEqual(10); expect(sw.best.E).toBeLessThanOrEqual(40);
  });
  it("the cache returns the SAME object for the same (E, s, D, signature)", () => {
    expect(cachedMaskAt(ctx, 20, 2, 12)).toBe(cachedMaskAt(ctx, 20, 2, 12));
    expect(cachedMaskAt(ctx, 20, 2, 12)).not.toBe(cachedMaskAt(ctx, 21, 2, 12));
  });
});

describe("buildableGround — honesty about missing ground", () => {
  it("a void patch is never pad-able and never reads as flat ground", () => {
    const lat = buildLattice({ bbox: [-100, -100, 600, 600], cell: 10, sample: (x, y) => (x > 200 && x < 300 && y > 200 && y < 300 ? null : 10) });
    const ctx = prepareSweep({ lattice: lat, rings: [rect(500, 500)] });
    const r = maskAt(ctx, 10, 2, 12);
    const i = Math.floor((250 - lat.x0) / 10), j = Math.floor((250 - lat.y0) / 10);
    expect(r.mask[j * lat.nx + i]).toBe(0);
    expect(latticeZAt(lat, 250, 250)).toBeNull();
    expect(r.areaSf).toBeGreaterThan(0.9 * (500 * 500 - 100 * 100));
  });
  it("keeps ONLY the largest 4-connected component", () => {
    // a ridge of un-pad-able ground splits the parcel into a big west piece and a small east piece
    const lat = buildLattice({ bbox: [-100, -100, 700, 700], cell: 10, sample: (x) => (x > 400 && x < 430 ? 100 : 10) });
    const ctx = prepareSweep({ lattice: lat, rings: [rect(600, 600)] });
    const r = maskAt(ctx, 10, 2, 12);
    const eastCell = r.mask[Math.floor((300 - lat.y0) / 10) * lat.nx + Math.floor((550 - lat.x0) / 10)];
    const westCell = r.mask[Math.floor((300 - lat.y0) / 10) * lat.nx + Math.floor((150 - lat.x0) / 10)];
    expect(westCell).toBe(1);
    expect(eastCell).toBe(0);
  });
  it("an empty setback sweeps to nothing, not to an error", () => {
    const lat = buildLattice({ bbox: [0, 0, 100, 100], cell: 10, sample: () => 5 });
    const ctx = prepareSweep({ lattice: lat, rings: [] });
    expect(sweep(ctx, {}).best).toBeNull();
  });
});

describe("buildableGround — the severity pill", () => {
  it("≥45% Workable · 25–45% Tight · <25% Steep", () => {
    expect(severityOfShare(0.45).id).toBe("workable");
    expect(severityOfShare(0.449).id).toBe("tight");
    expect(severityOfShare(0.25).id).toBe("tight");
    expect(severityOfShare(0.2499).id).toBe("steep");
    expect(severityOfShare(0.45).tone).toBe("green");
    expect(severityOfShare(0.3).tone).toBe("amber");
    expect(severityOfShare(0.1).tone).toBe("red");
    expect(severityOfShare(null)).toBeNull();
  });
});

describe("buildableGround — REAL Chehaw Rd lattice (USGS 3DEP + Spalding Co. parcel 218 02007)", () => {
  const F = fileURLToPath(new URL("./fixtures/chehaw-218-02007", import.meta.url));
  const b = readFileSync(F + ".lerc");
  const grid = decodeGrid(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), JSON.parse(readFileSync(F + ".req.json", "utf8")));
  const req = JSON.parse(readFileSync(F + ".req.json", "utf8"));
  const pj = JSON.parse(readFileSync(F + ".parcel.json", "utf8"));
  const ll = pj.ringLngLat.slice(0, -1);
  const lat0 = ll.reduce((a, p) => a + p[1], 0) / ll.length, lon0 = ll.reduce((a, p) => a + p[0], 0) / ll.length;
  const ring = ll.map(([lo, la]) => lngLatToFeet(lo, la, lon0, lat0));
  // 50 ft on the road frontage (the north edges), 25 ft everywhere else — the prototype's setbacks.
  let minY = Infinity; for (const p of ring) minY = Math.min(minY, p.y);
  const sb = ring.map((a, i) => { const c = ring[(i + 1) % ring.length]; return (a.y + c.y) / 2 < minY + 400 ? 50 : 25; });
  const setback = offsetPolygon(ring, sb);
  const lattice = latticeFromDem({ grid, req, origin: { lat: lat0, lon: lon0 }, bbox: sweepBBox([ring]) });

  it("the fixture parcel is the 73.97-acre lot", () => {
    expect(Math.abs(ringAreaSf(ring) / SQFT_PER_ACRE - 73.97)).toBeLessThan(0.5); // the feet frame is Web-Mercator-scaled: ~0.4% off the county ring
  });
  it("relief matches the owner's numbers: 719 to 814 ft, ~95 ft", () => {
    const r = parcelRelief({ lattice, rings: [ring] });
    expect(r.lowFt).toBeGreaterThan(718); expect(r.lowFt).toBeLessThan(721);
    expect(r.highFt).toBeGreaterThan(812); expect(r.highFt).toBeLessThan(816);
    expect(r.reliefFt).toBeGreaterThan(92); expect(r.reliefFt).toBeLessThan(98);
    // "4% of the parcel is steeper than 15%, nearly all on the creek banks"
    expect(r.steepShare).toBeGreaterThan(0.02); expect(r.steepShare).toBeLessThan(0.08);
  });
  it("at 2:1, no walls, ≤12 ft cut or fill: 35–40 ac, best finish 793–797", () => {
    const t0 = Date.now();
    const r = groundSummary({ lattice, setbackRings: [setback], parcelRings: [ring], s: 2, D: 12 });
    expect(r.best.areaAc).toBeGreaterThan(35); expect(r.best.areaAc).toBeLessThan(40);
    expect(r.best.E).toBeGreaterThanOrEqual(793); expect(r.best.E).toBeLessThanOrEqual(797);
    expect(Math.abs(r.parcelAc - 73.97)).toBeLessThan(0.5);
    expect(r.severity.id).toBe("workable");     // ~50% of the parcel
    expect(Date.now() - t0).toBeLessThan(2000); // "full sweep well under 2 s"
  });
  it("a steeper ratio (3:1) leaves a smaller pad; more allowed depth leaves a larger one", () => {
    const base = groundSummary({ lattice, setbackRings: [setback], parcelRings: [ring], s: 2, D: 12 }).best.areaAc;
    const s3 = groundSummary({ lattice, setbackRings: [setback], parcelRings: [ring], s: 3, D: 12 }).best.areaAc;
    const d20 = groundSummary({ lattice, setbackRings: [setback], parcelRings: [ring], s: 2, D: 20 }).best.areaAc;
    expect(s3).toBeLessThan(base);
    expect(d20).toBeGreaterThan(base);
  });
});
