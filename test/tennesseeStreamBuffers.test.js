/* B2521584 — the Tennessee stream-buffer rule (pure half). Synthetic geometry with KNOWN answers: a straight stream at a known latitude, so the band
 * width can be measured in feet and compared with the rule it is cited to (TDEC Construction General Permit TNR100000: 30 ft average natural
 * riparian buffer zone). The 60 ft tier on TDEC-listed waters is deliberately NOT drawn (its source is unreachable) — asserted, so it cannot be
 * half-added without its data. */
import { describe, it, expect } from "vitest";
import { TN_BUFFER_TIERS, streamBufferBandsTn, bufferLegendTn } from "../src/workspaces/site-planner/lib/tennesseeStreamBuffers.js";

const LAT = 35.74, KX = Math.cos((LAT * Math.PI) / 180) * 364567, KY = 364567;
const line = (props, coords) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
const fc = (...features) => ({ type: "FeatureCollection", features });
const ew = (props, dyFt = 0) => line(props, [[-86.35, LAT + dyFt / KY], [-86.35 + 1000 / KX, LAT + dyFt / KY], [-86.35 + 2000 / KX, LAT + dyFt / KY]]);
const widthFt = (band) => { const ys = band.ring.map((p) => p[1]); return (Math.max(...ys) - Math.min(...ys)) * KY; };
const STREAM = { ftype: 460, fcode: 46006 }, INTERMITTENT = { ftype: 460, fcode: 46003 }, EPHEMERAL = { ftype: 460, fcode: 46007 }, CANAL = { ftype: 336, fcode: 33600 };

describe("the rule is the permit's, with its citation in the number", () => {
  it("one tier: 30 ft each side — and no 60 ft tier until its source exists", () => {
    expect(Object.keys(TN_BUFFER_TIERS)).toEqual(["standard"]);
    expect(TN_BUFFER_TIERS.standard.eachSideFt).toBe(30);
  });
});

describe("streamBufferBandsTn — widths measured in feet", () => {
  it("a perennial NHD stream gets a 60 ft wide band (30 ft each side of the centreline)", () => {
    const bands = streamBufferBandsTn({ nhd: fc(ew(STREAM)) });
    expect(bands).toHaveLength(1);
    expect(bands[0].tier.id).toBe("standard");
    expect(widthFt(bands[0])).toBeGreaterThan(58);
    expect(widthFt(bands[0])).toBeLessThan(62);
  });
  it("an intermittent stream is buffered too", () => {
    expect(streamBufferBandsTn({ nhd: fc(ew(INTERMITTENT)) })).toHaveLength(1);
  });
  it("only streams are buffered: ephemeral channels, canals, UNNAMED artificial paths and ditches are not", () => {
    expect(streamBufferBandsTn({ nhd: fc(ew(EPHEMERAL), ew(CANAL, 500), ew({ ftype: 558 }, 900), ew({ ftype: 558, gnis_name: "   " }, 1100), ew({ ftype: 428 }, 1300)) })).toEqual([]);
  });
  it("an empty view returns nothing, and nothing throws on null input", () => {
    expect(streamBufferBandsTn({})).toEqual([]);
    expect(streamBufferBandsTn({ nhd: fc() })).toEqual([]);
    expect(streamBufferBandsTn({ nhd: { features: [{ properties: STREAM, geometry: null }] } })).toEqual([]);
  });
  it("a MultiLineString NHD feature buffers every part", () => {
    const mls = { type: "Feature", properties: STREAM, geometry: { type: "MultiLineString", coordinates: [ew(STREAM).geometry.coordinates, ew(STREAM, 800).geometry.coordinates] } };
    expect(streamBufferBandsTn({ nhd: fc(mls) })).toHaveLength(2);
  });
  it("a one-point 'line' makes no band", () => {
    expect(streamBufferBandsTn({ nhd: fc(line(STREAM, [[-86.35, LAT]])) })).toEqual([]);
  });
});

describe("legend", () => {
  it("names the 30 ft tier only when there is a band", () => {
    expect(bufferLegendTn([])).toEqual([]);
    expect(bufferLegendTn(null)).toEqual([]);
    expect(bufferLegendTn(streamBufferBandsTn({ nhd: fc(ew(STREAM)) }))).toEqual([TN_BUFFER_TIERS.standard.label]);
  });
  it("a NAMED artificial path (the centreline NHD draws through a wide river — Middle Fork Stones River near Christiana) IS buffered, in either property casing", () => {
    expect(streamBufferBandsTn({ nhd: fc(ew({ ftype: 558, fcode: 55800, gnis_name: "Middle Fork Stones River" }, 700)) })).toHaveLength(1);
    expect(streamBufferBandsTn({ nhd: fc(ew({ FTYPE: 558, GNIS_NAME: "Stones River" }, 700)) })).toHaveLength(1);
  });
});
