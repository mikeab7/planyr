import { describe, it, expect } from "vitest";
import {
  signedArea, pointInRing, pointInPolygons, esriPolygons, ringsAsPolygons,
  polygonAreaSqM, unionAreaSqM, intersectionAreaSqM, areaShare, distanceToBoundaryM,
  boundaryLengthNearM, shareConfidence, metresPerDegree, southIsLargerY, SQM_PER_ACRE,
} from "../src/workspaces/site-planner/lib/jurisdictionShare.js";

/* NEW-2 — the pure engine, on shapes whose answers are known exactly. The real-ground assertions
 * live in test/jurisdictionArea.test.js; these are the invariants that make those meaningful. */

const REF = [-95, 29.8];
// A square `d` degrees on a side, anchored at REF. CCW (our own parcel convention).
const sq = (dx, dy, w, h) => [
  [REF[0] + dx, REF[1] + dy], [REF[0] + dx + w, REF[1] + dy],
  [REF[0] + dx + w, REF[1] + dy + h], [REF[0] + dx, REF[1] + dy + h],
];
const esriOuter = (ring) => (signedArea(ring) < 0 ? ring : ring.slice().reverse());
const esriHole = (ring) => (signedArea(ring) > 0 ? ring : ring.slice().reverse());

describe("ESRI rings → outers and holes", () => {
  it("splits on winding and nests each hole under its containing outer", () => {
    const outer = esriOuter(sq(0, 0, 0.01, 0.01));
    const hole = esriHole(sq(0.002, 0.002, 0.002, 0.002));
    const polys = esriPolygons({ rings: [outer, hole] });
    expect(polys.length).toBe(1);
    expect(polys[0].holes.length).toBe(1);
  });

  it("⛔ a point in a hole is inside the OUTER RING and NOT in the polygon", () => {
    const outer = esriOuter(sq(0, 0, 0.01, 0.01));
    const hole = esriHole(sq(0.002, 0.002, 0.002, 0.002));
    const polys = esriPolygons({ rings: [outer, hole] });
    const inHole = [REF[0] + 0.003, REF[1] + 0.003];
    expect(pointInRing(inHole, polys[0].outer)).toBe(true);
    expect(pointInPolygons(inHole, polys)).toBe(false);
    expect(pointInPolygons([REF[0] + 0.001, REF[1] + 0.001], polys)).toBe(true);
  });

  it("the hole is subtracted from the area, by both the shoelace and the clipper path", () => {
    const outer = esriOuter(sq(0, 0, 0.01, 0.01));
    const hole = esriHole(sq(0.002, 0.002, 0.002, 0.002));
    const polys = esriPolygons({ rings: [outer, hole] });
    const solid = polygonAreaSqM([{ outer: polys[0].outer, holes: [] }], REF);
    expect(polygonAreaSqM(polys, REF)).toBeCloseTo(solid * (1 - 0.04), 5);
    expect(unionAreaSqM(polys, REF)).toBeCloseTo(polygonAreaSqM(polys, REF), 0);
  });

  it("two outers and two holes pair up correctly, and a stray hole is dropped, never promoted", () => {
    const a = esriOuter(sq(0, 0, 0.01, 0.01)), b = esriOuter(sq(0.05, 0, 0.01, 0.01));
    const inA = esriHole(sq(0.002, 0.002, 0.002, 0.002)), inB = esriHole(sq(0.052, 0.002, 0.002, 0.002));
    const stray = esriHole(sq(0.5, 0.5, 0.001, 0.001));
    const polys = esriPolygons({ rings: [a, inA, b, inB, stray] });
    expect(polys.map((p) => p.holes.length)).toEqual([1, 1]);
    expect(polys.length).toBe(2);
  });
});

describe("a share is an area fraction", () => {
  const parcel = ringsAsPolygons([sq(0, 0, 0.01, 0.01)]);
  it("half in, half out reads 0.5 whatever the vertices do", () => {
    const clip = [{ outer: esriOuter(sq(-0.05, 0, 0.055, 0.01)), holes: [] }];
    const r = areaShare(parcel, clip, REF);
    expect(r.share).toBeCloseTo(0.5, 3);
    // The same answer with the parcel densified along one edge — vertex COUNT is not the quantity.
    const dense = [...sq(0, 0, 0.01, 0.01)];
    const densified = [dense[0], ...Array.from({ length: 40 }, (_, i) => [REF[0] + (i + 1) * 0.01 / 41, REF[1]]), ...dense.slice(1)];
    expect(areaShare(ringsAsPolygons([densified]), clip, REF).share).toBeCloseTo(0.5, 3);
  });

  it("a jurisdiction hole punched through the parcel removes that land from the share", () => {
    const clip = esriPolygons({ rings: [esriOuter(sq(-0.01, -0.01, 0.03, 0.03)), esriHole(sq(0.002, 0.002, 0.002, 0.002))] });
    const r = areaShare(parcel, clip, REF);
    expect(r.share).toBeCloseTo(1 - 0.04, 3);
  });

  it("⛔ overlapping subject records measure ONCE — the dissolve, which is rule 3", () => {
    const twice = ringsAsPolygons([sq(0, 0, 0.01, 0.01), sq(0, 0, 0.01, 0.01), sq(0.005, 0, 0.01, 0.01)]);
    const one = unionAreaSqM(ringsAsPolygons([sq(0, 0, 0.01, 0.01)]), REF);
    // Two identical squares plus one offset by half: the union is 1.5 squares, never 3.
    expect(unionAreaSqM(twice, REF) / one).toBeCloseTo(1.5, 5);
    // …and an EVEN-ODD resolve of the same set would cancel the duplicate pair to nothing, which is
    // the bug this replaced: it measured a real 107-acre site at 0.0 acres.
    expect(unionAreaSqM(twice, REF)).toBeGreaterThan(one);
  });

  it("no subject and no clip are honest zeroes, not crashes", () => {
    expect(areaShare([], [{ outer: sq(0, 0, 1, 1), holes: [] }], REF).share).toBe(0);
    expect(intersectionAreaSqM(parcel, [], REF)).toBe(0);
    expect(unionAreaSqM(null, REF)).toBe(0);
  });
});

describe("distance and the tolerance guard", () => {
  it("⛔ segment-to-segment: a corner poking at a long lot line is measured, not missed", () => {
    // A parcel edge with NO vertex near the clip's corner. A vertex-only sweep would report the
    // distance to the parcel's own far corner instead of to the corner in front of it.
    const parcel = ringsAsPolygons([sq(0, 0, 0.01, 0.01)]);
    const spike = [{ outer: esriOuter([[REF[0] + 0.005, REF[1] - 0.001], [REF[0] + 0.006, REF[1] - 0.001], [REF[0] + 0.0055, REF[1] - 0.0002]]), holes: [] }];
    const d = distanceToBoundaryM(parcel, spike, REF);
    const mLat = metresPerDegree(REF[1]).lat;
    expect(d).toBeCloseTo(0.0002 * mLat, 0);
  });

  it("exact geometry is always confident; a material smear is refused with a reason", () => {
    expect(shareConfidence(0, 1e6, 1).confident).toBe(true);
    expect(shareConfidence(1, 100, 1e6).confident).toBe(true);         // ±0.01% — immaterial
    const bad = shareConfidence(30, 1000, 100000);
    expect(bad.confident).toBe(false);
    expect(bad.uncertainty).toBeCloseTo(0.3, 3);
    expect(bad.reason).toMatch(/more than the 2% this may be stated to/);
  });

  it("⛔ the guard is on the SHARE, not on a distance — a boundary THROUGH the site is not refused", () => {
    // The first draft refused whenever the tolerance was a tenth of the distance to the boundary,
    // which is zero for every split site — i.e. it refused precisely the sites this item is about.
    const parcel = ringsAsPolygons([sq(0, 0, 0.01, 0.01)]);
    const clip = [{ outer: esriOuter(sq(-0.05, 0, 0.055, 0.01)), holes: [] }];
    const r = areaShare(parcel, clip, REF, { toleranceM: 1 });
    expect(r.distanceM).toBe(0);
    expect(r.confident).toBe(true);
    expect(r.share).toBeCloseTo(0.5, 2);
  });

  it("only boundary running NEAR the land counts toward the uncertainty", () => {
    const parcel = ringsAsPolygons([sq(0, 0, 0.001, 0.001)]);
    const far = [{ outer: esriOuter(sq(1, 1, 0.5, 0.5)), holes: [] }];
    expect(boundaryLengthNearM(parcel, far, REF, 50)).toBe(0);
  });
});

describe("the y-sign is taken from the projection, not asserted", () => {
  it("reports which way round the frame actually is", () => {
    const down = southIsLargerY((pt) => [29.8 - pt.y / 364000, -95]);   // screen-down (the planner)
    const up = southIsLargerY((pt) => [29.8 + pt.y / 364000, -95]);     // the inverted world
    expect(down.southIsLargerY).toBe(true);
    expect(up.southIsLargerY).toBe(false);
  });
});

describe("units", () => {
  it("an acre is an acre", () => {
    const oneAcreSide = Math.sqrt(SQM_PER_ACRE);
    const m = metresPerDegree(REF[1]);
    const ring = sq(0, 0, oneAcreSide / m.lon, oneAcreSide / m.lat);
    expect(polygonAreaSqM(ringsAsPolygons([ring]), REF) / SQM_PER_ACRE).toBeCloseTo(1, 6);
  });
});
