/* Georgia stream buffers (Georgia screening, Part B1) — the pure rules. */
import { describe, it, expect } from "vitest";
import {
  GA_BUFFER_TIERS, isBufferedStream, tierFor, pointInRing, districtRings, streamBufferBands, bufferLegend, linePartsOf,
} from "../src/workspaces/site-planner/lib/georgiaStreamBuffers.js";

const line = (coords, props) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
const fc = (features) => ({ type: "FeatureCollection", features });
// ~330 m of stream near Lawrenceville, GA (Gwinnett — inside the Metro North Georgia District)
const GWINNETT = [[-83.9500, 34.0200], [-83.9480, 34.0210], [-83.9460, 34.0220]];
// the same shape near Savannah (outside it)
const SAVANNAH = [[-81.1000, 32.0800], [-81.0980, 32.0810], [-81.0960, 32.0820]];
const DISTRICT = fc([{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-84.6, 33.5], [-83.7, 33.5], [-83.7, 34.4], [-84.6, 34.4], [-84.6, 33.5]]] } }]);
const STREAM = { ftype: 460, fcode: 46006 };

describe("which reaches are 'state waters' (isBufferedStream)", () => {
  it("buffers perennial and intermittent streams", () => {
    expect(isBufferedStream({ ftype: 460, fcode: 46006 })).toBe(true);
    expect(isBufferedStream({ ftype: 460, fcode: 46003 })).toBe(true);
    expect(isBufferedStream({ ftype: 460, fcode: 46000 })).toBe(true);
  });
  it("never buffers ephemeral channels, ditches/canals, artificial paths, or pipelines", () => {
    expect(isBufferedStream({ ftype: 460, fcode: 46007 })).toBe(false);
    expect(isBufferedStream({ ftype: 336, fcode: 33600 })).toBe(false);
    expect(isBufferedStream({ ftype: 558, fcode: 55800 })).toBe(false);
    expect(isBufferedStream({ ftype: 428, fcode: 42801 })).toBe(false);
  });
  it("reads either attribute casing the service has served, and fails closed on garbage", () => {
    expect(isBufferedStream({ FTYPE: 460, FCODE: 46006 })).toBe(true);
    expect(isBufferedStream({})).toBe(false);
    expect(isBufferedStream(null)).toBe(false);
  });
});

describe("tier precedence — the WIDER rule governs", () => {
  it("25 floor · 50 trout · 75 district, and district beats trout", () => {
    expect(tierFor({}).eachSideFt).toBe(25);
    expect(tierFor({ trout: true }).eachSideFt).toBe(50);
    expect(tierFor({ inDistrict: true }).eachSideFt).toBe(75);
    expect(tierFor({ inDistrict: true, trout: true }).eachSideFt).toBe(75);
  });
});

describe("geometry helpers", () => {
  it("pointInRing works for either winding, and districtRings reads Polygon + MultiPolygon", () => {
    const sq = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(pointInRing(5, 5, sq)).toBe(true);
    expect(pointInRing(15, 5, sq)).toBe(false);
    expect(pointInRing(5, 5, [...sq].reverse())).toBe(true);
    const multi = fc([{ geometry: { type: "MultiPolygon", coordinates: [[sq], [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]] } }]);
    expect(districtRings(multi).length).toBe(2);
    expect(districtRings(null)).toEqual([]);
  });
  it("linePartsOf handles LineString, MultiLineString and non-lines", () => {
    expect(linePartsOf(line(GWINNETT, {})).length).toBe(1);
    expect(linePartsOf({ geometry: { type: "MultiLineString", coordinates: [GWINNETT, SAVANNAH] } }).length).toBe(2);
    expect(linePartsOf({ geometry: { type: "Point", coordinates: [0, 0] } })).toEqual([]);
  });
});

describe("streamBufferBands — the layer's whole decision", () => {
  it("a Savannah stream gets the 25 ft band; the same stream in Gwinnett gets 75 ft", () => {
    const nhd = fc([line(SAVANNAH, STREAM), line(GWINNETT, STREAM)]);
    const bands = streamBufferBands({ nhd, district: DISTRICT });
    expect(bands.map((b) => b.tier.id).sort()).toEqual(["district", "state"]);
  });
  it("band width is the tier's: a 25 ft buffer ring is ~50 ft across, a 75 ft ring ~150 ft", () => {
    const widthFt = (ring) => {
      // perpendicular extent: the ring spans the line's bbox widened by the offset; measure N-S extent in feet
      const lats = ring.map((p) => p[1]);
      return (Math.max(...lats) - Math.min(...lats)) * 364567;
    };
    const base = (coords) => { const lats = coords.map((p) => p[1]); return (Math.max(...lats) - Math.min(...lats)) * 364567; };
    const a = streamBufferBands({ nhd: fc([line(SAVANNAH, STREAM)]) })[0];
    const b = streamBufferBands({ nhd: fc([line(GWINNETT, STREAM)]), district: DISTRICT })[0];
    expect(widthFt(a.ring)).toBeGreaterThan(base(SAVANNAH) + 20);
    expect(widthFt(b.ring)).toBeGreaterThan(widthFt(a.ring) + 30); // 75 > 25, by a clear margin
  });
  it("a DNR trout stream outside the District is 50 ft; inside it is promoted to 75 ft", () => {
    const outside = streamBufferBands({ trout: fc([line(SAVANNAH, { Name: "Trout Creek" })]), district: DISTRICT });
    expect(outside.map((b) => [b.from, b.tier.id])).toEqual([["trout", "trout"]]);
    const inside = streamBufferBands({ trout: fc([line(GWINNETT, { Name: "Chattahoochee" })]), district: DISTRICT });
    expect(inside.map((b) => [b.from, b.tier.id])).toEqual([["trout", "district"]]);
  });
  it("⛔ no District outline ⇒ nothing is promoted to 75 (the caller must say so; it can never be guessed)", () => {
    const bands = streamBufferBands({ nhd: fc([line(GWINNETT, STREAM)]), district: null });
    expect(bands.map((b) => b.tier.id)).toEqual(["state"]);
  });
  it("ditches, canals and ephemeral reaches draw nothing", () => {
    const nhd = fc([line(SAVANNAH, { ftype: 336, fcode: 33600 }), line(SAVANNAH, { ftype: 460, fcode: 46007 })]);
    expect(streamBufferBands({ nhd })).toEqual([]);
  });
  it("degenerate parts and empty inputs yield no bands rather than a half-drawn ring", () => {
    expect(streamBufferBands({})).toEqual([]);
    expect(streamBufferBands({ nhd: fc([line([[-81.1, 32.08]], STREAM)]) })).toEqual([]);
  });
  it("the legend names only the tiers actually drawn", () => {
    const bands = streamBufferBands({ nhd: fc([line(SAVANNAH, STREAM)]) });
    expect(bufferLegend(bands)).toEqual([GA_BUFFER_TIERS.state.label]);
    expect(bufferLegend([])).toEqual([]);
  });
});
