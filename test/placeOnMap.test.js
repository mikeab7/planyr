import { describe, it, expect } from "vitest";
import { choosePlacement, METHOD, RUNGS } from "../src/shared/placement/placeOnMap.js";
import { emptyPlacementFacts, longestDimension } from "../src/shared/placement/placementFacts.js";

const facts = (patch = {}) => ({ ...emptyPlacementFacts(), ...patch });

describe("placeOnMap — cascade chooses best available rung (B182/NEW-3)", () => {
  it("rung 1: embedded coords win when reprojection is available", () => {
    const r = choosePlacement(facts({ embeddedCoords: { present: true, crs: "EPSG:2278" } }), { canReproject: true });
    expect(r.method).toBe(METHOD.EMBEDDED);
    expect(r.confident).toBe(true);
    expect(r.skipped).toHaveLength(0);
  });
  it("embedded coords are SKIPPED (with a reason) when reprojection isn't available", () => {
    const r = choosePlacement(facts({ embeddedCoords: { present: true, crs: "EPSG:2278" }, boundary: { present: true } }), { canReproject: false, targetBoundary: { rings: [] } });
    expect(r.method).toBe(METHOD.FIT_BOUNDARY);
    expect(r.skipped[0].method).toBe(METHOD.EMBEDDED);
    expect(r.skipped[0].reason).toMatch(/reprojection/i);
  });
  it("rung 2: fit-to-boundary preferred over a stated scale", () => {
    const r = choosePlacement(facts({ boundary: { present: true }, statedScale: { present: true, feetPerInch: 100 } }), { targetBoundary: { rings: [[]] } });
    expect(r.method).toBe(METHOD.FIT_BOUNDARY);
  });
  it("boundary present but no held geometry → skipped with reason, falls to measure", () => {
    const r = choosePlacement(facts({ boundary: { present: true }, scaleBar: { present: true, drawnLenPx: 200, realLenFt: 100 } }), {});
    expect(r.method).toBe(METHOD.MEASURE);
    expect(r.skipped.find((s) => s.method === METHOD.FIT_BOUNDARY).reason).toMatch(/held parcel/i);
  });
  it("rung 3: measure a scale bar, carrying north-arrow rotation", () => {
    const r = choosePlacement(facts({ scaleBar: { present: true, drawnLenPx: 144, realLenFt: 200 }, northArrow: { present: true, orientationDeg: 12 } }), {});
    expect(r.method).toBe(METHOD.MEASURE);
    expect(r.detail.baseline).toBe("scale-bar");
    expect(r.detail.rotationDeg).toBe(12);
  });
  it("rung 3: measure the LONGEST dimension when there's no scale bar", () => {
    const r = choosePlacement(facts({ dimensions: [
      { valueFt: 24, p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } },
      { valueFt: 240, p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 } },
    ] }), {});
    expect(r.method).toBe(METHOD.MEASURE);
    expect(r.detail.baseline).toBe("dimension");
    expect(r.detail.dimension.valueFt).toBe(240);
  });
  it("rung 4: manual when nothing else runs — not confident, all higher rungs explained", () => {
    const r = choosePlacement(facts(), {});
    expect(r.method).toBe(METHOD.MANUAL);
    expect(r.confident).toBe(false);
    expect(r.skipped.map((s) => s.method)).toEqual([METHOD.EMBEDDED, METHOD.FIT_BOUNDARY, METHOD.MEASURE]);
    r.skipped.forEach((s) => expect(typeof s.reason).toBe("string"));
  });
  it("never silently falls through — every skipped rung carries a reason", () => {
    const r = choosePlacement(facts({ scaleBar: { present: true, drawnLenPx: 100, realLenFt: 50 } }), {});
    r.skipped.forEach((s) => expect(s.reason && s.reason.length).toBeGreaterThan(0));
  });
  it("RUNGS are in best→fallback order ending in MANUAL", () => {
    expect(RUNGS.map((r) => r.method)).toEqual([METHOD.EMBEDDED, METHOD.FIT_BOUNDARY, METHOD.MEASURE, METHOD.MANUAL]);
  });
});

describe("placementFacts — longestDimension", () => {
  it("returns the largest real-world value, or null", () => {
    expect(longestDimension(facts({ dimensions: [{ valueFt: 12 }, { valueFt: 99 }, { valueFt: 4 }] })).valueFt).toBe(99);
    expect(longestDimension(facts())).toBe(null);
  });
});
