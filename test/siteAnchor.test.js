import { describe, it, expect } from "vitest";
import { siteAnchorFeet, siteAnchorLatLon, polygonAnchor } from "../src/workspaces/site-planner/lib/siteAnchor.js";
import { signedDist } from "../src/workspaces/site-planner/lib/polylabel.js";
import { lngLatToFeet } from "../src/workspaces/site-planner/lib/mapLock.js";

const P = (...xy) => xy.map(([x, y]) => ({ x, y }));
// A "Katz-like" shape: wide top rectangle + long tail down the east side; the notch (lower-left) is empty.
const KATZ = P([0, 0], [1000, 0], [1000, 1600], [800, 1600], [800, 300], [0, 300]);
const areaCentroid = (r) => { let a = 0, cx = 0, cy = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j].x * r[i].y - r[i].x * r[j].y; a += f; cx += (r[j].x + r[i].x) * f; cy += (r[j].y + r[i].y) * f; } return { x: cx / (3 * a), y: cy / (3 * a) }; };
const parcel = (points, extra = {}) => ({ id: "p", points, active: true, ...extra });

describe("siteAnchor", () => {
  it("RED-PROOF: the L shape's centroid is OUTSIDE, the anchor is inside with real clearance", () => {
    const c = areaCentroid(KATZ);
    expect(signedDist(c, KATZ)).toBeLessThan(0);          // the bug's premise: centroid / bbox-style anchors land in the notch
    const a = siteAnchorFeet([parcel(KATZ)]);
    expect(signedDist(a, KATZ)).toBeGreaterThan(50);      // meaningfully clear of every edge, not inside by a hair
  });
  it("a convex rectangle stays at its centroid (the pin does not move)", () => {
    const r = P([0, 0], [400, 0], [400, 200], [0, 200]);
    const a = siteAnchorFeet([parcel(r)]);
    expect(a.x).toBeCloseTo(200, 3); expect(a.y).toBeCloseTo(100, 3);
  });
  it("multi-parcel: anchors in the largest part", () => {
    const small = P([0, 0], [50, 0], [50, 50], [0, 50]);
    const big = P([1000, 1000], [1600, 1000], [1600, 1400], [1000, 1400]);
    const a = siteAnchorFeet([parcel(small), parcel(big)]);
    expect(signedDist(a, big)).toBeGreaterThan(0);
  });
  it("ignores inactive / deleted parcels", () => {
    const big = P([1000, 1000], [1600, 1000], [1600, 1400], [1000, 1400]);
    const a = siteAnchorFeet([parcel(big, { active: false }), parcel(P([0, 0], [50, 0], [50, 50], [0, 50]))]);
    expect(a.x).toBeLessThan(50);
    expect(siteAnchorFeet([parcel(big, { deletedAt: "x" })])).toBeNull();
  });
  it("never lands in a save-and-except hole", () => {
    const outer = P([0, 0], [400, 0], [400, 400], [0, 400]);
    const hole = P([50, 50], [350, 50], [350, 350], [50, 350]);       // hole covers the centroid
    const a = siteAnchorFeet([parcel(outer, { exceptions: [{ pts: hole }] })]);
    expect(signedDist(a, outer)).toBeGreaterThan(0);
    expect(signedDist(a, hole)).toBeLessThan(0);
    expect(-signedDist(a, hole)).toBeGreaterThan(10);
  });
  it("thin sliver stays inside", () => {
    const s = P([0, 0], [2000, 30], [2000, 45], [0, 15]);
    const a = polygonAnchor(s);
    expect(signedDist(a, s)).toBeGreaterThan(0);
  });
  it("memoised per geometry", () => {
    const pc = parcel(KATZ);
    expect(siteAnchorFeet([pc])).toBe(siteAnchorFeet([pc]));
  });
  it("latlon: inside the parcel when projected back; falls back to origin with no parcel; null with no origin", () => {
    const origin = { lat: 29.95, lon: -95.4 };
    const r = siteAnchorLatLon({ origin }, [parcel(KATZ)]);
    expect(r.source).toBe("geometry");
    const back = lngLatToFeet(r.lon, r.lat, origin.lon, origin.lat);
    expect(signedDist(back, KATZ)).toBeGreaterThan(50);
    expect(siteAnchorLatLon({ origin }, [])).toEqual({ lat: 29.95, lon: -95.4, source: "origin" });
    expect(siteAnchorLatLon({}, [parcel(KATZ)])).toBeNull();
  });
});
