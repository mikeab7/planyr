/* B2573312 (NEW-3) — the zone-code labels: ONE per polygon (its largest part), CENTRED INSIDE it, hidden when too small to hold the text, never overlapping — one pure layout shared by the screen and the PDF. */
import { describe, it, expect } from "vitest";
import { labelSpotOf, layoutZoneLabels, labelFits, textBox, rectInside } from "../src/workspaces/site-planner/lib/zoneLabels.js";
import { esriZoneLabels } from "../src/workspaces/site-planner/lib/overlayVectorSvg.js";

const LAT = 34.95, LNG = -89.83, KX = 111320 * Math.cos(LAT * Math.PI / 180), KY = 111320;
// a rectangle w × h METRES with its south-west corner at (east, north) metres from (LNG, LAT)
const rect = (east, north, w, h) => [[east, north], [east + w, north], [east + w, north + h], [east, north + h], [east, north]].map(([x, y]) => [LNG + x / KX, LAT + y / KY]);
const poly = (...rings) => ({ type: "Polygon", coordinates: rings });
const feat = (id, geometry, zone) => ({ id, geometry, properties: { ZONE: zone } });
const project = ([lng, lat], ppm) => ({ x: (lng - LNG) * KX * ppm, y: -(lat - LAT) * KY * ppm });   // metres → px at `ppm` px per metre

describe("labelSpotOf — where the code sits", () => {
  it("is the middle of a plain rectangle, with its clear radius", () => {
    const s = labelSpotOf(poly(rect(0, 0, 100, 60)));
    expect(s.lng).toBeCloseTo(LNG + 50 / KX, 6); expect(s.lat).toBeCloseTo(LAT + 30 / KY, 6);
    expect(s.r).toBeGreaterThan(29); expect(s.r).toBeLessThanOrEqual(30.5);
  });
  it("is INSIDE an L-shaped lot — the vertex average and the centroid of an L land in the notch", () => {
    const L = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100], [0, 0]].map(([x, y]) => [LNG + x / KX, LAT + y / KY]);
    const s = labelSpotOf(poly(L));
    const x = (s.lng - LNG) * KX, y = (s.lat - LAT) * KY;
    const inside = (x >= 0 && x <= 100 && y >= 0 && y <= 20) || (x >= 0 && x <= 20 && y >= 0 && y <= 100);
    expect(inside).toBe(true);
    const avgX = (0 + 100 + 100 + 20 + 20 + 0) / 6, avgY = (0 + 0 + 20 + 20 + 100 + 100) / 6;   // the old vertex average
    const oldInside = (avgX <= 100 && avgY <= 20) || (avgX <= 20 && avgY <= 100);
    expect(oldInside).toBe(false);                                                                  // known-bad arm: the old point WAS in the notch
  });
  it("labels the LARGEST part of a multipolygon and keeps clear of a hole", () => {
    const g = { type: "MultiPolygon", coordinates: [[rect(0, 0, 20, 20)], [rect(500, 0, 100, 100), rect(530, 30, 40, 40).reverse()]] };
    const s = labelSpotOf(g);
    const x = (s.lng - LNG) * KX, y = (s.lat - LAT) * KY;
    expect(x).toBeGreaterThan(500); expect(x).toBeLessThan(600);                                    // the big part, not the 20 m one
    expect(Math.abs(x - 550) > 20 || Math.abs(y - 50) > 20).toBe(true);                             // not in the 40 m hole
  });
  it("a degenerate geometry gives no spot; the answer is memoised per geometry object", () => {
    expect(labelSpotOf(null)).toBeNull(); expect(labelSpotOf({ type: "Point", coordinates: [0, 0] })).toBeNull();
    const g = poly(rect(0, 0, 50, 50));
    expect(labelSpotOf(g)).toBe(labelSpotOf(g));
  });
});

describe("labelFits — hidden when the polygon is too small on screen to hold the text", () => {
  const spot = labelSpotOf(poly(rect(0, 0, 100, 40)));
  it("fits at a zoom where the lot is wide enough, not where it is a few pixels", () => {
    const box = textBox("C-2");
    expect(labelFits(spot, box, 1)).toBe(true);        // 100 m × 40 m at 1 px/m: 100 × 40 px
    expect(labelFits(spot, box, 0.1)).toBe(false);     // 10 × 4 px
  });
  it("a long strip just taller than the text still holds a short code (the exact test, not the circle)", () => {
    const strip = labelSpotOf(poly(rect(0, 0, 300, 20)));
    const box = textBox("R-1");                          // ~26 × 15 px
    expect(Math.hypot(box.w, box.h) / 2).toBeGreaterThan(strip.r * 1);   // the circle alone would refuse it at 1 px/m …
    expect(labelFits(strip, box, 1)).toBe(true);                         // … but the box really fits inside the strip
    expect(labelFits(strip, textBox("R".repeat(60)), 1)).toBe(false);   // a text wider than the strip does not
  });
  it("rectInside is exact: a notch the box would cross refuses it", () => {
    const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 60, y: 100 }, { x: 60, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
    expect(rectInside(ring, [], 20, 50, 15, 10)).toBe(true);
    expect(rectInside(ring, [], 50, 50, 15, 10)).toBe(false);   // centre is in the notch (outside)
    expect(rectInside(ring, [], 20, 25, 25, 10)).toBe(false);   // crosses the notch's wall
  });
});

describe("layoutZoneLabels — one per polygon, never overlapping", () => {
  const items = (ppm, defs) => defs.map(([id, text, e, n, w, h]) => { const spot = labelSpotOf(poly(rect(e, n, w, h))); const p = project([spot.lng, spot.lat], ppm); return { key: id, text, x: p.x + 500, y: p.y + 500, spot, pxPerM: ppm }; });
  const view = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
  it("places each polygon's code once, at its spot", () => {
    const out = layoutZoneLabels(items(1, [["a", "M-1", 0, 0, 100, 60], ["b", "C-2", 200, 0, 100, 60]]), { view });
    expect(out.map((o) => o.key).sort()).toEqual(["a", "b"]);
    expect(out.find((o) => o.key === "a").text).toBe("M-1");
  });
  it("drops the polygon that is too small, keeps the big one", () => {
    const out = layoutZoneLabels(items(1, [["big", "M-1", 0, 0, 100, 60], ["tiny", "C-2", 200, 0, 8, 6]]), { view });
    expect(out.map((o) => o.key)).toEqual(["big"]);
  });
  it("two labels that would touch are never both drawn — the larger polygon wins", () => {
    const out = layoutZoneLabels(items(1, [["small", "R-2", 0, 0, 30, 20], ["large", "R-3", 20, 0, 90, 20]]), { view });
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      expect(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2).toBe(true);
    }
    expect(out.length).toBeGreaterThanOrEqual(1);
    if (out.length === 1) expect(out[0].key).toBe("large");
  });
  it("leaves out a label whose spot is outside the view", () => {
    expect(layoutZoneLabels(items(1, [["a", "M-1", 0, 0, 100, 60]]), { view: { x0: 0, y0: 0, x1: 10, y1: 10 } })).toEqual([]);
  });
});

describe("esriZoneLabels — the printed twin runs the same layout in sheet pixels", () => {
  const cfg = { lineLabel: { field: "ZONE", polygon: true, format: (v) => String(v || "").trim() || null } };
  it("prints one code per polygon, none where the polygon is too small on the sheet", () => {
    const gjs = [feat(1, poly(rect(0, 0, 100, 60)), "M-1"), feat(2, poly(rect(200, 0, 100, 60)), "C-2"), feat(3, poly(rect(400, 0, 6, 6)), "R-1")];
    const out = esriZoneLabels(gjs, cfg, (ll) => { const p = project(ll, 1); return { x: p.x + 100, y: p.y + 200 }; }, { w: 1000, h: 1000 });
    expect(out.map((o) => o.text).sort()).toEqual(["C-2", "M-1"]);
    for (const o of out) { expect(Number.isFinite(o.x) && Number.isFinite(o.y)).toBe(true); }
  });
  it("a feature with no code prints nothing", () => {
    expect(esriZoneLabels([feat(1, poly(rect(0, 0, 100, 60)), "")], cfg, (ll) => project(ll, 1), { w: 1000, h: 1000 })).toEqual([]);
  });
});

describe("the printed sheet keeps a code whole (contain)", () => {
  const spot = labelSpotOf(poly(rect(0, 0, 200, 100)));
  const item = (x, y) => ({ key: "a", text: "C-2", x, y, spot, pxPerM: 1 });
  it("a code whose box would be cut by the frame edge is not printed; on screen the same label (centre in view) stays", () => {
    const view = { x0: 0, y0: 0, x1: 100, y1: 100 };
    expect(layoutZoneLabels([item(98, 50)], { view })).toHaveLength(1);
    expect(layoutZoneLabels([item(98, 50)], { view, contain: true })).toEqual([]);
    expect(layoutZoneLabels([item(50, 50)], { view, contain: true })).toHaveLength(1);
  });
  it("esriZoneLabels takes the printed frame as a rect", () => {
    const cfg = { lineLabel: { field: "ZONE", polygon: true, format: (v) => String(v || "").trim() || null } };
    const proj = (ll) => { const p = project(ll, 1); return { x: p.x + 100, y: p.y + 200 }; };
    const g = [feat(1, poly(rect(0, 0, 100, 60)), "M-1")];
    expect(esriZoneLabels(g, cfg, proj, { x0: 0, y0: 0, x1: 1000, y1: 1000 })).toHaveLength(1);
    expect(esriZoneLabels(g, cfg, proj, { x0: 400, y0: 0, x1: 1000, y1: 1000 })).toEqual([]);
  });
});
