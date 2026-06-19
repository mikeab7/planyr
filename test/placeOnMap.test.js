import { describe, it, expect } from "vitest";
import { RUNGS, chooseMethod, placeByGraphic, fitToBoundary, placeFromEmbeddedCoords, runCascade } from "../src/workspaces/site-planner/lib/placeOnMap.js";
import { makeFileFacts } from "../src/shared/files/fileFacts.js";
import { imagePointToWorld } from "../src/workspaces/site-planner/lib/overlayAlign.js";

const ov = (over = {}) => ({ x: 100, y: 50, imgW: 800, imgH: 600, ftPerPx: 0.5, rotation: 0, ...over });

describe("placeOnMap — chooseMethod (best→fallback by facts)", () => {
  it("prefers embedded over boundary over graphic over manual", () => {
    expect(chooseMethod(makeFileFacts({ embeddedCoords: { present: true } })).id).toBe("embedded");
    expect(chooseMethod(makeFileFacts({ boundary: { present: true } })).id).toBe("boundary");
    expect(chooseMethod(makeFileFacts({ dimensions: [{ valueFt: 240 }] })).id).toBe("graphic");
    expect(chooseMethod(makeFileFacts()).id).toBe("manual");
  });
  it("RUNGS are ordered 1..4", () => {
    expect(RUNGS.map((r) => r.n)).toEqual([1, 2, 3, 4]);
  });
});

describe("placeOnMap — rung 3 graphic (live, resize-invariant)", () => {
  it("sets feet-per-unit from the measured baseline", () => {
    const o = ov({ ftPerPx: 1 });             // start wrong (1 ft/px)
    const r = placeByGraphic({ overlay: o, graphic: { px: 480, realFt: 240 } });
    expect(r.ran).toBe(true);
    expect(r.patch.ftPerPx).toBeCloseTo(0.5, 9); // 240 ft over 480 px
    expect(r.ftPerUnit).toBeCloseTo(0.5, 9);
  });
  it("rotates to ground north when a north arrow is present", () => {
    const o = ov();
    const r = placeByGraphic({ overlay: o, graphic: { px: 100, realFt: 50 }, northDeg: 30 });
    expect(r.patch.rotation).toBeCloseTo(330, 5); // 0 - 30, normalized
  });
  it("skips cleanly with no measurable graphic", () => {
    expect(placeByGraphic({ overlay: ov(), graphic: null }).ran).toBe(false);
  });
});

describe("placeOnMap — rung 2 fitToBoundary (live when points exist, else stub)", () => {
  it("solves scale+rotation+translation from corresponded boundary points", () => {
    const o = ov();
    // pick 3 drawing points, map them to where the parcel says they should be
    const img = [{ ix: 100, iy: 100 }, { ix: 700, iy: 120 }, { ix: 400, iy: 500 }];
    const world = [{ x: 5000, y: 9000 }, { x: 5600, y: 9050 }, { x: 5300, y: 9400 }];
    const r = fitToBoundary({ overlay: o, pairs: img.map((im, i) => ({ img: im, world: world[i] })) });
    expect(r.ran).toBe(true);
    expect(typeof r.residualFt).toBe("number");
    // the RMS of the per-point landing errors under the new placement equals the
    // reported residual (validates both the applied patch and the residual readout)
    const placed = { ...o, ...r.patch };
    const se = img.reduce((s, im, i) => {
      const w = imagePointToWorld(placed, im.ix, im.iy);
      return s + (w.x - world[i].x) ** 2 + (w.y - world[i].y) ** 2;
    }, 0);
    expect(Math.sqrt(se / img.length)).toBeCloseTo(r.residualFt, 5);
  });
  it("stubs out (available:false) when no boundary points are given", () => {
    const r = fitToBoundary({ overlay: ov() });
    expect(r.ran).toBe(false);
    expect(r.available).toBe(false);
    expect(r.why).toMatch(/backend/i);
  });
});

describe("placeOnMap — rung 1 embedded (backend stub)", () => {
  it("is unavailable browser-side even when coords are present (no reprojector)", () => {
    const r = placeFromEmbeddedCoords({ facts: makeFileFacts({ embeddedCoords: { present: true, crs: "EPSG:2278" } }), overlay: ov() });
    expect(r.ran).toBe(false);
    expect(r.why).toMatch(/backend tranche/i);
  });
  it("runs when a backend reprojector is injected", () => {
    const r = placeFromEmbeddedCoords({ facts: makeFileFacts({ embeddedCoords: { present: true } }), overlay: ov(), reproject: () => ({ x: 0, y: 0, ftPerPx: 1, rotation: 0 }) });
    expect(r.ran).toBe(true);
    expect(r.confidence).toBe("high");
  });
});

describe("placeOnMap — runCascade (orchestration + never silently fall through)", () => {
  it("falls to graphic, records WHY the higher rungs were skipped, and verifies", () => {
    const o = ov({ ftPerPx: 1 });
    const facts = makeFileFacts({ dimensions: [{ valueFt: 240 }] });
    const res = runCascade({
      facts, overlay: o,
      graphic: { px: 480, realFt: 240, axis: "x" },
      verifyGraphic: { px: 120, statedFt: 60, label: "60'" }, // 120 px * 0.5 ft/px = 60 ft → exact
    });
    expect(res.method).toBe("graphic");
    expect(res.skipped.map((s) => s.rung)).toEqual(["embedded", "boundary"]);
    res.skipped.forEach((s) => expect(typeof s.why).toBe("string"));
    expect(res.verification.status).toBe("ok");
    expect(res.status).toBe("placed");
  });
  it("downgrades to verify-failed when the placed result measures wrong", () => {
    const o = ov({ ftPerPx: 1 });
    const res = runCascade({
      facts: makeFileFacts({ dimensions: [{ valueFt: 240 }] }), overlay: o,
      graphic: { px: 480, realFt: 240 },
      verifyGraphic: { px: 120, statedFt: 100 }, // 60 ft measured vs 100 stated → fail
    });
    expect(res.status).toBe("verify-failed");
    expect(res.verification.severity).toBe("high");
  });
  it("flags nonuniform when two independent reads disagree (no averaging)", () => {
    const o = ov({ ftPerPx: 1 });
    const res = runCascade({
      facts: makeFileFacts({ dimensions: [{ valueFt: 240 }] }), overlay: o,
      graphic: { px: 480, realFt: 240, axis: "x" },   // 0.5
      crossGraphic: { px: 480, realFt: 288, axis: "y" }, // 0.6 → 18% off
    });
    expect(res.crossCheck.status).toBe("nonuniform");
    expect(res.status).toBe("nonuniform");
  });
  it("returns manual (no patch) when nothing auto-runs, still listing skips", () => {
    const res = runCascade({ facts: makeFileFacts(), overlay: ov() });
    expect(res.method).toBe("manual");
    expect(res.patch).toBe(null);
    expect(res.skipped.length).toBe(3);
  });
});
