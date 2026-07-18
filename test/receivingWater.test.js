// NEW-A5 — nearest receiving water (NHDPlus HR) for a pond outfall: FCODE crosswalk,
// nearest-reach math, the outfall-easement flag, and the honest-failure resolver. Pure.
import { describe, it, expect } from "vitest";
import {
  fcodeType,
  nearestReceivingWater,
  receivingWaterFlag,
  resolveReceivingWater,
  RECEIVING_WATER_SOURCE,
} from "../src/workspaces/site-planner/lib/receivingWater.js";

// An ArcGIS-shaped flowline item at a due-east offset: a short path near lat 29.78.
const flowline = (name, fcode, lngOffsetDeg) => ({
  attrs: { GNIS_NAME: name, FCODE: fcode, LENGTHKM: 1 },
  geometry: { paths: [[[-95.83 + lngOffsetDeg, 29.78], [-95.83 + lngOffsetDeg, 29.79]]] },
});

describe("fcodeType crosswalk", () => {
  it("maps the common NHD codes", () => {
    expect(fcodeType(46006)).toBe("stream/river");
    expect(fcodeType(46003)).toBe("stream/river");
    expect(fcodeType(33600)).toBe("canal/ditch");
    expect(fcodeType(55800)).toBe("artificial path");
    expect(fcodeType(42813)).toBe("pipeline");
    expect(fcodeType(99999)).toBe("flowline");
    expect(fcodeType(null)).toBe("flowline");
  });
});

describe("nearestReceivingWater", () => {
  it("picks the nearest reach and reports its type + distance", () => {
    const items = [
      flowline("Far River", 46006, 0.01),      // ~960 m east
      flowline("Willow Fork", 46006, 0.001),   // ~96 m east
    ];
    const n = nearestReceivingWater(items, -95.83, 29.78);
    expect(n.name).toBe("Willow Fork");
    expect(n.type).toBe("stream/river");
    expect(n.distFt).toBeGreaterThan(0);
    expect(n.distFt).toBeLessThan(500);
  });
  it("keeps the nearest NAMED reach when the closest is unnamed", () => {
    const items = [
      { attrs: { GNIS_NAME: null, FCODE: 55800 }, geometry: { paths: [[[-95.8301, 29.78], [-95.8301, 29.79]]] } }, // unnamed, very close
      flowline("Cane Island Branch", 46006, 0.002), // named, a bit farther
    ];
    const n = nearestReceivingWater(items, -95.83, 29.78);
    expect(n.unnamed).toBe(true);          // nearest overall is unnamed
    expect(n.named.name).toBe("Cane Island Branch");
  });
  it("empty list → null", () => {
    expect(nearestReceivingWater([], -95.83, 29.78)).toBeNull();
  });
});

describe("receivingWaterFlag — outfall-easement screen", () => {
  it("adjacent water → ok, no easement flag", () => {
    const f = receivingWaterFlag({ name: "Willow Fork", type: "stream/river", distFt: 120, named: null });
    expect(f.risk).toBe("adjacent");
    expect(f.severity).toBe("ok");
  });
  it("distant water → offsite easement warning", () => {
    const f = receivingWaterFlag({ name: "Willow Fork", type: "stream/river", distFt: 1200, named: null });
    expect(f.risk).toBe("offsite");
    expect(f.severity).toBe("warn");
    expect(f.message).toMatch(/easement/);
  });
  it("nothing nearby → loudest flag (none-nearby)", () => {
    const f = receivingWaterFlag(null);
    expect(f.risk).toBe("none-nearby");
    expect(f.severity).toBe("warn");
  });
  it("prefers a nearby NAMED reach for the message when close enough", () => {
    const f = receivingWaterFlag({ name: null, type: "artificial path", distFt: 100, named: { name: "Snake Creek", type: "stream/river", distFt: 180 } });
    expect(f.nearest.name).toBe("Snake Creek");
  });
});

describe("resolveReceivingWater — honest failure", () => {
  const geom = { lng: -95.83, lat: 29.78 };
  it("returns nearest + flag on success (injected fetch)", async () => {
    const fetchJson = async () => ({ features: [
      { attributes: { GNIS_NAME: "Willow Fork", FCODE: 46006 }, geometry: { paths: [[[-95.8302, 29.78], [-95.8302, 29.79]]] } },
    ] });
    const cache = { swr: (k, fetcher) => ({ cached: null, stale: false, fresh: fetcher().then((items) => ({ data: items, ageMs: 0, ts: 1 })) }) };
    const r = await resolveReceivingWater(geom, { cache, fetchJson });
    expect(r.state).toBe("loaded");
    expect(r.nearest.name).toBe("Willow Fork");
  });
  it("a source outage is an honest 'unverified', never a silent no", async () => {
    const cache = { swr: (k, fetcher) => ({ cached: null, stale: false, fresh: Promise.resolve({ data: [], ageMs: null, ts: null, error: new Error("503") }) }) };
    const r = await resolveReceivingWater(geom, { cache, fetchJson: async () => ({}) });
    expect(r.state).toBe("failed");
    expect(r.flag.risk).toBe("unverified");
  });
});

describe("registry descriptor", () => {
  it("points at NetworkNHDFlowline layer 3", () => {
    expect(RECEIVING_WATER_SOURCE.url).toMatch(/NHDPlus_HR\/MapServer\/3$/);
    expect(RECEIVING_WATER_SOURCE.kind).toBe("line");
  });
});
