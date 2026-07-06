/* Unit tests for the MCP site summarizer (B671) — pure math over sites.data blobs. */
import { describe, it, expect } from "vitest";
import { summarizeSite } from "../functions/api/mcp/_metrics.js";

const square = (side) => [{ x: 0, y: 0 }, { x: side, y: 0 }, { x: side, y: side }, { x: 0, y: side }];

describe("summarizeSite", () => {
  it("computes ~1 acre for a 208.71 ft square active parcel", () => {
    const s = summarizeSite({ parcels: [{ points: square(208.71) }], els: [] });
    expect(s.parcels.siteAcres).toBeCloseTo(1.0, 2);
    expect(s.parcels.activeCount).toBe(1);
  });

  it("excludes inactive parcels from the area math but counts them", () => {
    const s = summarizeSite({
      parcels: [{ points: square(208.71) }, { points: square(208.71), active: false }],
      els: [],
    });
    expect(s.parcels.siteAcres).toBeCloseTo(1.0, 2);
    expect(s.parcels.inactiveCount).toBe(1);
  });

  it("sums w×h and polygon buildings and computes coverage", () => {
    const s = summarizeSite({
      parcels: [{ points: square(1000) }], // 1,000,000 sf
      els: [
        { type: "building", w: 100, h: 200, name: "Bldg A", clearHeightOverride: 32 },
        { type: "building", points: square(100) }, // 10,000 sf
      ],
    });
    expect(s.buildings.count).toBe(2);
    expect(s.buildings.totalSqft).toBe(30000);
    expect(s.buildings.lotCoveragePct).toBeCloseTo(3.0, 1);
    expect(s.buildings.list[0]).toMatchObject({ name: "Bldg A", footprintSqft: 20000, clearHeightFt: 32 });
    expect(s.buildings.list[1].clearHeightFt).toBeNull();
  });

  it("tallies parking, trailer, pond and paving areas without inventing stall counts", () => {
    const s = summarizeSite({
      parcels: [],
      els: [
        { type: "parking", w: 100, h: 60 },
        { type: "trailer", points: square(50) },
        { type: "pond", points: square(100), det: { depth: 10 } },
        { type: "paving", w: 10, h: 10 },
        { type: "sidewalk", w: 5, h: 20 },
      ],
    });
    expect(s.parking).toMatchObject({ areas: 1, totalSqft: 6000 });
    expect(String(s.parking.stallCounts)).toMatch(/not computed/);
    expect(s.trailerParking.totalSqft).toBe(2500);
    expect(s.ponds).toMatchObject({ count: 1, totalSqft: 10000 });
    expect(s.ponds.list[0].depthFt).toBe(10);
    expect(s.paving.areas).toBe(2);
    expect(s.paving.totalSqft).toBe(200);
  });

  it("counts centerline roads but excludes their area (flagged)", () => {
    const s = summarizeSite({
      parcels: [],
      els: [
        { type: "road", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, // centerline — no ring
        { type: "road", points: square(20) },                       // traced polygon road
      ],
    });
    expect(s.paving.centerlineRoadsCounted).toBe(1);
    expect(s.paving.centerlineRoadAreaExcluded).toBe(true);
    expect(s.paving.totalSqft).toBe(400);
  });

  it("passes through status/county/origin/schedule and never throws on malformed input", () => {
    const s = summarizeSite({
      status: "active", county: "Harris", origin: { lat: 29.78, lon: -95.36 },
      scheduleProjectId: 3, scheduleProjectName: "Goose Creek",
      els: [null, 42, { w: "x" }, { type: "building" }], parcels: [null, { points: "nope" }],
    });
    expect(s.status).toBe("active");
    expect(s.origin).toEqual({ lat: 29.78, lon: -95.36 });
    expect(s.schedule).toEqual({ id: 3, name: "Goose Creek" });
    expect(s.buildings.count).toBe(1);
    expect(s.buildings.totalSqft).toBe(0);
    expect(summarizeSite(null).parcels.siteAcres).toBe(0);
    expect(summarizeSite(undefined).elementTally).toEqual({});
  });
});
