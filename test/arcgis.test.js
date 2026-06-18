import { describe, it, expect } from "vitest";
import { outerRingsLngLat } from "../src/workspaces/site-planner/lib/arcgis.js";

// outerRingsLngLat returns EVERY outer-boundary ring of a (possibly multipart)
// ArcGIS polygon feature, dropping holes. This is the fix for the Pearland bug
// (parcel 0440520000010 "TRS 3 & 5" = two separate tracts under one account):
// the old largest-ring-only pick highlighted/imported just the biggest tract, so a
// click on the smaller tract registered the account but lit up the neighbour.
//
// ArcGIS winding: outer rings are clockwise (negative shoelace area), holes are
// counter-clockwise (positive). A CLOSED square has 5 points (last === first);
// the helper returns it OPEN (4 points).
const sq = (lon, lat, h, cw = true) => {
  const ccw = [
    [lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h],
  ];
  return cw ? [...ccw].reverse() : ccw; // reverse(ccw) = clockwise = an outer ring
};
const feat = (rings) => ({ geometry: { rings } });

describe("outerRingsLngLat — multipart parcel support (Pearland B36c fix)", () => {
  it("returns the single outer ring of a one-part parcel, opened", () => {
    const out = outerRingsLngLat(feat([sq(-95.4, 29.58, 0.001)]));
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(4); // closing vertex stripped
    expect(out[0][0]).not.toEqual(out[0][out[0].length - 1]); // open ring
  });

  it("returns BOTH tracts of a two-part parcel (the bug: only one came back before)", () => {
    // two separate squares, same (outer) winding — like TRS 3 & 5
    const out = outerRingsLngLat(feat([sq(-95.41, 29.583, 0.0008), sq(-95.405, 29.583, 0.0009)]));
    expect(out).toHaveLength(2);
    // the two parts are distinct (different centroids), so neither is dropped
    const cx = (r) => r.reduce((s, p) => s + p[0], 0) / r.length;
    expect(Math.abs(cx(out[0]) - cx(out[1]))).toBeGreaterThan(0.003);
  });

  it("drops a hole (opposite winding) but keeps its outer ring → a donut yields 1 ring", () => {
    const out = outerRingsLngLat(feat([sq(-95.4, 29.58, 0.002, true), sq(-95.4, 29.58, 0.0005, false)]));
    expect(out).toHaveLength(1); // the small CCW hole is excluded
  });

  it("keeps every outer part even when a hole's |area| exceeds a small separate part", () => {
    // big outer + big hole + a small separate outer tract: must still return 2 outers
    const out = outerRingsLngLat(feat([
      sq(-95.4, 29.58, 0.003, true),   // big outer
      sq(-95.4, 29.58, 0.0025, false), // big hole (bigger than the small tract)
      sq(-95.39, 29.58, 0.0006, true), // small separate outer tract
    ]));
    expect(out).toHaveLength(2);
  });

  it("returns [] for a feature with no geometry", () => {
    expect(outerRingsLngLat(null)).toEqual([]);
    expect(outerRingsLngLat({})).toEqual([]);
    expect(outerRingsLngLat({ geometry: { rings: [] } })).toEqual([]);
  });
});
