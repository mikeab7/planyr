import { describe, it, expect } from "vitest";
import {
  rasterPxPerInch, isPdfOverlay, setScaleBlock, currentFeetPerInch, planSetScale, planTrace, planMatch,
} from "../src/shared/sitePlans/lib/overlayScaleGeo.js";
import {
  calibrationAfterClick, calibrationUndo, calibrationReady, calibrationPrompt, matchPairsOf, CALIB_MAX_PAIRS,
} from "../src/shared/sitePlans/lib/overlayCalibration.js";
import { imagePointToLatLon, latLonToImagePoint, feetBetween, anchorVisibleCentreGeo, alignOverlayGeo } from "../src/shared/overlay/overlayPlacement.js";

const base = { centerLat: 29.78, centerLon: -95.83, ftPerPx: 0.5, rotationDeg: 0, imgW: 1800, imgH: 1200, sourceFileName: "flyer.pdf", reviewId: "r1", page: 1 };
const ll = (o, x, y) => { const r = imagePointToLatLon(o, o.imgW, o.imgH, x, y); return { lat: r.lat, lng: r.lon }; };

describe("overlayScaleGeo — NEW-7 scale actions on the Map/Comps surface", () => {
  it("PDF pages: 150 px per inch unless the raster hit the cap; a capped sheet is matched by aspect", () => {
    expect(rasterPxPerInch(1275, 1650)).toBe(150);           // 8.5×11
    expect(rasterPxPerInch(4000, 2667)).toBeCloseTo(4000 / 36, 3); // 36×24 capped
    expect(rasterPxPerInch(4000, 3100)).toBeNull();          // not a standard sheet
  });
  it("Set scale is a PDF-only action and says why otherwise", () => {
    expect(setScaleBlock(base)).toBeNull();
    expect(setScaleBlock({ ...base, sourceFileName: "photo.png", page: 1 })).toMatch(/PDF/);
    expect(isPdfOverlay({ ...base, sourceFileName: "" })).toBe(true);
  });
  it("Set scale: 1\" = 40' puts 40 ft on every page inch, about the visible centre", () => {
    const r = planSetScale(base, 40);
    const o2 = { ...base, ...r.patch };
    expect(currentFeetPerInch(o2)).toBeCloseTo(40, 6);
    const c0 = ll(base, 900, 600), c1 = ll(o2, 900, 600);
    expect(feetBetween(c0.lat, c0.lng, c1.lat, c1.lng)).toBeLessThan(0.01);   // centre did not move
    expect(planSetScale(base, 0).error).toBeTruthy();
    expect(planSetScale({ ...base, sourceFileName: "x.png" }, 40).error).toMatch(/PDF/);
  });
  it("Trace a length: the traced segment becomes exactly the typed length and its midpoint stays put", () => {
    const a = ll(base, 200, 300), b = ll(base, 1000, 300);     // 800 px × 0.5 = 400 ft today
    const r = planTrace(base, a, b, "600");
    const o2 = { ...base, ...r.patch };
    const a2 = ll(o2, 200, 300), b2 = ll(o2, 1000, 300);
    expect(feetBetween(a2.lat, a2.lng, b2.lat, b2.lng)).toBeCloseTo(600, 1);
    const m0 = ll(base, 600, 300), m1 = ll(o2, 600, 300);
    expect(feetBetween(m0.lat, m0.lng, m1.lat, m1.lng)).toBeLessThan(0.05);
    expect(planTrace(base, a, a, "600").error).toMatch(/same spot/);
    expect(planTrace(base, a, b, "").error).toMatch(/real length/);
    expect(planTrace(base, a, b, "1/2", "ft").patch.ftPerPx).toBeGreaterThan(0);
  });
  it("Trace honours the unit (metres)", () => {
    const a = ll(base, 0, 0), b = ll(base, 100, 0);            // 100 px
    const r = planTrace(base, a, b, "10", "m");
    expect(r.patch.ftPerPx).toBeCloseTo(32.80839895 / 100, 8);
  });
  it("Match 2 points: lands both drawing points on their map spots (moves, rotates, scales)", () => {
    // target world = the drawing rotated 20°, scaled 1.7×, shifted: build it by placing a COPY then reading its lat/lng
    const target = { ...base, ftPerPx: 0.85, rotationDeg: 20, centerLat: 29.7812, centerLon: -95.8291 };
    const p1 = { x: 300, y: 250 }, p2 = { x: 1500, y: 900 };
    const pairs = [p1, p2].map((p) => ({ from: ll(base, p.x, p.y), to: ll(target, p.x, p.y) }));
    const r = planMatch(base, pairs);
    expect(r.error).toBeUndefined();
    const o2 = { ...base, ...r.patch };
    for (const p of [p1, p2]) {
      const got = ll(o2, p.x, p.y), want = ll(target, p.x, p.y);
      expect(feetBetween(got.lat, got.lng, want.lat, want.lng)).toBeLessThan(0.05);
    }
    expect(r.patch.ftPerPx).toBeCloseTo(0.85, 3);
    expect(((r.patch.rotationDeg % 360) + 360) % 360).toBeCloseTo(20, 2);
    expect(r.residualFt).toBeLessThan(0.05);
  });
  it("Match: three pairs best-fit and report a residual; fewer than two is refused", () => {
    const target = { ...base, ftPerPx: 0.6, rotationDeg: -5 };
    const pts = [{ x: 100, y: 100 }, { x: 1700, y: 200 }, { x: 900, y: 1100 }];
    const pairs = pts.map((p, i) => ({ from: ll(base, p.x, p.y), to: ll(target, p.x + (i === 2 ? 40 : 0), p.y) }));
    const r = planMatch(base, pairs);
    expect(r.pairs).toBe(3);
    expect(r.residualFt).toBeGreaterThan(0.5);
    expect(planMatch(base, pairs.slice(0, 1)).error).toMatch(/at least 2/);
    expect(planMatch(base, [{ from: pairs[0].from, to: null }, pairs[1]]).error).toMatch(/at least 2/);
  });
  it("engine: anchorVisibleCentreGeo still pins the visible centre (delegation to the pivot form is behaviour-preserving)", () => {
    const o = { ...base, crop: { kind: "rect", x: 100, y: 100, w: 800, h: 600 } };
    const before = imagePointToLatLon(o, o.imgW, o.imgH, 500, 400);
    const n = anchorVisibleCentreGeo(o, { ftPerPx: 1.2, rotationDeg: 33 });
    const after = imagePointToLatLon(n, n.imgW, n.imgH, 500, 400);
    expect(feetBetween(before.lat, before.lon, after.lat, after.lon)).toBeLessThan(0.01);
    expect(alignOverlayGeo(o, [{ img: { x: 0, y: 0 }, ll: { lat: 29.78, lon: -95.83 } }])).toBeNull();
  });
});

describe("calibration click state (NEW-7)", () => {
  const pt = (n) => ({ lat: 29 + n / 1000, lng: -95 });
  it("Trace: two clicks make it ready, a third starts over, undo steps back", () => {
    let c = { kind: "trace", id: "a", pts: [] };
    expect(calibrationPrompt(c)).toMatch(/one end/);
    c = calibrationAfterClick(c, pt(1)); expect(calibrationPrompt(c)).toMatch(/other end/); expect(calibrationReady(c)).toBe(false);
    c = calibrationAfterClick(c, pt(2)); expect(calibrationReady(c)).toBe(true); expect(calibrationPrompt(c)).toMatch(/real length/);
    c = calibrationAfterClick(c, pt(3)); expect(c.pts).toEqual([pt(3)]);
    expect(calibrationUndo(c).pts).toEqual([]);
  });
  it("Match: alternates drawing point / map spot; ready only with two COMPLETE pairs; caps the pair count", () => {
    let c = { kind: "match", id: "a", pts: [] };
    c = calibrationAfterClick(c, pt(1)); expect(calibrationPrompt(c)).toMatch(/belongs on the map/);
    c = calibrationAfterClick(c, pt(2)); expect(calibrationReady(c)).toBe(false);
    c = calibrationAfterClick(c, pt(3)); c = calibrationAfterClick(c, pt(4));
    expect(calibrationReady(c)).toBe(true);
    expect(matchPairsOf(c.pts)).toEqual([{ from: pt(1), to: pt(2) }, { from: pt(3), to: pt(4) }]);
    c = calibrationAfterClick(c, pt(5)); expect(matchPairsOf(c.pts)[2].to).toBeNull(); expect(calibrationReady(c)).toBe(true);
    let big = { kind: "match", id: "a", pts: Array.from({ length: 2 * CALIB_MAX_PAIRS }, (_, i) => pt(i)) };
    expect(calibrationAfterClick(big, pt(99)).pts.length).toBe(2 * CALIB_MAX_PAIRS);
  });
});
