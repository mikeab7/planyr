/* B2521584 — the Tennessee stream-buffer rule (pure half). Synthetic geometry with KNOWN answers: a straight stream at a known latitude, so the
 * band widths can be measured in feet and compared with the rule they are cited to (TDEC Construction General Permit TNR100000:
 * 30 ft average natural riparian buffer; 60 ft average on exceptional / unavailable waters). */
import { describe, it, expect } from "vitest";
import {
  TN_BUFFER_TIERS, MATCH_FT, pointSegmentFt, buildLineIndex, streamBufferBandsTn, bufferLegendTn,
} from "../src/workspaces/site-planner/lib/tennesseeStreamBuffers.js";

const LAT = 35.74, KX = Math.cos((LAT * Math.PI) / 180) * 364567, KY = 364567;
const line = (props, coords) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
const fc = (...features) => ({ type: "FeatureCollection", features });
/* an east-west stream 2,000 ft long starting at (-86.35, LAT); `dyFt` moves it north */
const ew = (props, dyFt = 0) => line(props, [[-86.35, LAT + dyFt / KY], [-86.35 + 1000 / KX, LAT + dyFt / KY], [-86.35 + 2000 / KX, LAT + dyFt / KY]]);
const widthFt = (band) => { const ys = band.ring.map((p) => p[1]); return (Math.max(...ys) - Math.min(...ys)) * KY; };
const STREAM = { ftype: 460, fcode: 46006 }, EPHEMERAL = { ftype: 460, fcode: 46007 }, CANAL = { ftype: 336, fcode: 33600 };

describe("the rule is the permit's, with its citation in the numbers", () => {
  it("30 ft each side on a stream, 60 ft each side on a TDEC-listed one — no other width", () => {
    expect(TN_BUFFER_TIERS.standard.eachSideFt).toBe(30);
    expect(TN_BUFFER_TIERS.restricted.eachSideFt).toBe(60);
    expect(Object.keys(TN_BUFFER_TIERS).sort()).toEqual(["restricted", "standard"]);
  });
});

describe("streamBufferBandsTn — widths measured in feet", () => {
  it("a plain NHD stream gets a 60 ft wide band (30 ft each side of the centreline)", () => {
    const bands = streamBufferBandsTn({ nhd: fc(ew(STREAM)), restricted: fc() });
    expect(bands).toHaveLength(1);
    expect(bands[0].tier.id).toBe("standard");
    expect(widthFt(bands[0])).toBeGreaterThan(58);
    expect(widthFt(bands[0])).toBeLessThan(62);
  });
  it("a TDEC-restricted line is drawn from TDEC's own geometry at 120 ft wide (60 each side)", () => {
    const bands = streamBufferBandsTn({ nhd: fc(), restricted: fc(ew({ ATTAINMENT: "Not Supporting" })) });
    expect(bands).toHaveLength(1);
    expect(bands[0].tier.id).toBe("restricted");
    expect(bands[0].from).toBe("tdec");
    expect(widthFt(bands[0])).toBeGreaterThan(118);
    expect(widthFt(bands[0])).toBeLessThan(122);
  });
  it("the same stream in both sources is drawn ONCE, at the wider width — never a 30 ft band under a 60 ft band", () => {
    const bands = streamBufferBandsTn({ nhd: fc(ew(STREAM, 40)), restricted: fc(ew({}, 0)) }); // TDEC's line 40 ft off NHD's — the same water
    expect(bands.map((b) => b.tier.id)).toEqual(["restricted"]);
  });
  it("a DIFFERENT stream a few hundred feet away keeps its own 30 ft band beside the restricted one", () => {
    const bands = streamBufferBandsTn({ nhd: fc(ew(STREAM, MATCH_FT * 4)), restricted: fc(ew({}, 0)) });
    expect(bands.map((b) => b.tier.id).sort()).toEqual(["restricted", "standard"]);
  });
  it("only streams are buffered: ephemeral channels, canals and ditches are not", () => {
    expect(streamBufferBandsTn({ nhd: fc(ew(EPHEMERAL), ew(CANAL, 500), ew({ ftype: 558 }, 900), ew({ ftype: 428 }, 1300)), restricted: fc() })).toEqual([]);
  });
  it("a MISSING TDEC list promotes nothing — the caller is told by `restricted: null`, and the bands are the 30 ft floor only", () => {
    const bands = streamBufferBandsTn({ nhd: fc(ew(STREAM)), restricted: null });
    expect(bands.map((b) => b.tier.id)).toEqual(["standard"]);
  });
  it("an empty view returns nothing, and nothing throws on null input", () => {
    expect(streamBufferBandsTn({})).toEqual([]);
    expect(streamBufferBandsTn({ nhd: fc(), restricted: fc() })).toEqual([]);
    expect(streamBufferBandsTn({ nhd: { features: [{ properties: STREAM, geometry: null }] } })).toEqual([]);
  });
  it("a MultiLineString NHD feature buffers every part", () => {
    const mls = { type: "Feature", properties: STREAM, geometry: { type: "MultiLineString", coordinates: [ew(STREAM).geometry.coordinates, ew(STREAM, 800).geometry.coordinates] } };
    expect(streamBufferBandsTn({ nhd: fc(mls), restricted: fc() })).toHaveLength(2);
  });
});

describe("the nearest-line index", () => {
  it("measures a point to a segment in feet", () => {
    const a = [-86.35, LAT], b = [-86.35 + 1000 / KX, LAT];
    expect(pointSegmentFt(-86.35 + 500 / KX, LAT + 80 / KY, a, b)).toBeCloseTo(80, 0);
    expect(pointSegmentFt(-86.35 - 100 / KX, LAT, a, b)).toBeCloseTo(100, 0); // past the end: distance to the end point
  });
  it("answers Infinity with no lines and the true distance with some", () => {
    expect(buildLineIndex([]).nearestFt(-86.35, LAT)).toBe(Infinity);
    const idx = buildLineIndex([ew({}).geometry.coordinates]);
    expect(idx.nearestFt(-86.35 + 700 / KX, LAT + 120 / KY)).toBeCloseTo(120, 0);
    expect(idx.nearestFt(-86.35 + 700 / KX, LAT + 5000 / KY)).toBe(Infinity); // beyond the 3×3 neighbourhood
  });
  it("agrees with brute force across a grid of points (a cell-edge bug would show here)", () => {
    const paths = [ew({}).geometry.coordinates, ew({}, 600).geometry.coordinates, [[-86.349, LAT - 0.003], [-86.347, LAT + 0.004]]];
    const idx = buildLineIndex(paths);
    for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) {
      const lng = -86.352 + i * 0.00023, lat = LAT - 0.004 + j * 0.00027;
      let brute = Infinity;
      for (const p of paths) for (let k = 0; k + 1 < p.length; k++) brute = Math.min(brute, pointSegmentFt(lng, lat, p[k], p[k + 1]));
      const got = idx.nearestFt(lng, lat);
      if (brute <= 1200) expect(got, `${i},${j}`).toBeCloseTo(brute, 3);
    }
  });
});

describe("legend", () => {
  it("names only the tiers present, in the permit's words", () => {
    expect(bufferLegendTn([])).toEqual([]);
    const std = streamBufferBandsTn({ nhd: fc(ew(STREAM)), restricted: fc() });
    expect(bufferLegendTn(std)).toEqual([TN_BUFFER_TIERS.standard.label]);
    const both = streamBufferBandsTn({ nhd: fc(ew(STREAM, 2000)), restricted: fc(ew({}, 0)) });
    expect(bufferLegendTn(both)).toEqual([TN_BUFFER_TIERS.standard.label, TN_BUFFER_TIERS.restricted.label]);
  });
});
