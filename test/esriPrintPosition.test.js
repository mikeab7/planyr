/* B2095745 — a GIS layer must print IN THE RIGHT PLACE and be LEGIBLE on the sheet.
 * Michael's Adairsville PDF (V1518082, build 93f7114): the layers drew on screen and none was visible on the page.
 * Two defects, one test file for each:
 *  (1) PLACEMENT — the lng/lat → sheet projection is checked against ground truth computed INDEPENDENTLY of the app's
 *      own projection code (spherical earth), for a known feature: the I-75 vertex near Adairsville, GA (34.37717,
 *      -84.91092) on a plan whose origin is 34.37, -84.92. It must land inside the exhibit frame at that spot.
 *  (2) LEGIBILITY — the generic plan-stroke retarget printed a weight-2 / 0.55-alpha overlay line at ~0.6 pt, which is
 *      invisible over a dark aerial. Overlay ink now has a floor (RED against the old rule: see the replay below). */
import { describe, it, expect } from "vitest";
import { lngLatRingToFeet } from "../src/workspaces/site-planner/lib/arcgis.js";
import { buildOverlayVectorFragment } from "../src/workspaces/site-planner/lib/overlayVectorSvg.js";
import { printStrokeWidth, sheetFitScale, overlayLinePt, overlayStrokeWidth, overlayPointRadius, overlayPrintOpacity, OVERLAY_PRINT, PT_PER_CENTI_INCH } from "../src/workspaces/site-planner/lib/exportStyle.js";

// The planner's own feet → view-px map (SitePlanner f2p): x right, y DOWN (south).
const view = { ppf: 0.2, offX: 200, offY: 600 };
const f2p = (p) => ({ x: view.offX + p.x * view.ppf, y: view.offY + p.y * view.ppf });
const ORIGIN = { lat: 34.37, lon: -84.92 };
const projectLngLat = (ll) => f2p(lngLatRingToFeet([ll], ORIGIN.lon, ORIGIN.lat)[0]);

// The exhibit frame: the crop the export nests as its inner viewBox (view px).
const FRAME = { w: 1000, h: 700 };

// Ground truth, independent of mapLock: a sphere of the WGS84 mean radius in US survey feet.
const R_FT = 20902231;
const truthFeet = (lon, lat) => ({
  x: ((lon - ORIGIN.lon) * Math.PI / 180) * R_FT * Math.cos((ORIGIN.lat * Math.PI) / 180),
  y: -((lat - ORIGIN.lat) * Math.PI / 180) * R_FT,
});
const I75 = [-84.91092, 34.37717]; // [lon, lat] — NN=1 I-75 vertex near Adairsville, AADT 70,100
const BP_UST = [-84.91273, 34.37701]; // Georgia EPD UST facility (a POINT layer)

const pathPoints = (svg) => (svg.match(/d="([^"]+)"/) || [, ""])[1].split(/[ML]/).filter(Boolean).map((s) => s.trim().split(",").map(Number));
const circle = (svg) => { const m = svg.match(/cx="([-\d.]+)" cy="([-\d.]+)"/); return m ? { x: Number(m[1]), y: Number(m[2]) } : null; };

describe("an overlay feature lands at its ground position inside the exhibit frame", () => {
  it("I-75 near Adairsville (line): every vertex is where the ground says, inside the frame", () => {
    const line = { kind: "line", coords: [[-84.9150, 34.3745], I75, [-84.9130, 34.3750]], style: { stroke: "#be185d", strokeWidth: 2.5, strokeOpacity: 0.55 } };
    const { svg, emitted, skipped } = buildOverlayVectorFragment([line], projectLngLat, { opacity: 1 });
    expect(skipped).toBe(0); expect(emitted).toBe(1);
    const pts = pathPoints(svg);
    expect(pts).toHaveLength(3);
    line.coords.forEach(([lon, lat], i) => {
      const t = truthFeet(lon, lat);
      const want = f2p(t);
      expect(Math.abs(pts[i][0] - want.x)).toBeLessThan(1.5); // 1.5 px — the sphere vs the app's ellipsoid constants; far tighter than any "wrong place"
      expect(Math.abs(pts[i][1] - want.y)).toBeLessThan(1.5);
      expect(pts[i][0]).toBeGreaterThan(0); expect(pts[i][0]).toBeLessThan(FRAME.w);
      expect(pts[i][1]).toBeGreaterThan(0); expect(pts[i][1]).toBeLessThan(FRAME.h);
    });
    // North is UP: the Adairsville I-75 vertex is north (smaller y) and east (larger x) of the origin.
    const mid = f2p(truthFeet(...I75));
    expect(mid.y).toBeLessThan(view.offY); expect(mid.x).toBeGreaterThan(view.offX);
  });

  it("a UST facility (point): the circle centre is at the facility, not the layer's bounding corner", () => {
    const { svg } = buildOverlayVectorFragment([{ kind: "point", coords: BP_UST, style: { stroke: "#7c2d12", fill: "#ea580c", fillOpacity: 0.9, radius: 4.5 } }], projectLngLat, {});
    const c = circle(svg); const want = f2p(truthFeet(...BP_UST));
    expect(Math.abs(c.x - want.x)).toBeLessThan(1.5); expect(Math.abs(c.y - want.y)).toBeLessThan(1.5);
    expect(c.x).toBeGreaterThan(0); expect(c.x).toBeLessThan(FRAME.w);
  });

  it("a parcel corner and the layer vertex placed at the same ground point print at the same pixel", () => {
    const corner = { x: 535.5, y: -535.5 }; // feet, NE corner of the plan's parcel
    const asLngLat = (() => { const r = 20902231; return [ORIGIN.lon + (corner.x / (r * Math.cos((ORIGIN.lat * Math.PI) / 180))) * 180 / Math.PI, ORIGIN.lat - (corner.y / r) * 180 / Math.PI]; })();
    const q = projectLngLat(asLngLat), want = f2p(corner);
    expect(Math.abs(q.x - want.x)).toBeLessThan(0.5); expect(Math.abs(q.y - want.y)).toBeLessThan(0.5);
  });

  it("RED-PROOF: a projection with the y axis flipped (the classic wrong-place bug) fails this very check", () => {
    const flipped = (ll) => { const p = projectLngLat(ll); return { x: p.x, y: 2 * view.offY - p.y }; };
    const q = flipped(I75), want = f2p(truthFeet(...I75));
    expect(Math.abs(q.y - want.y)).toBeGreaterThan(50);
  });
});

describe("an overlay prints legibly (not at the plan's 0.6 pt, not at the screen's faint alpha)", () => {
  const sheetScale = sheetFitScale(FRAME.w, FRAME.h, 1000, 700 * 0.9); // ~1 centi-inch per unit
  const ptOf = (units) => units * sheetScale * PT_PER_CENTI_INCH;
  it("a weight-2 overlay line prints at >= 1 pt, a firm 2.5 band at more", () => {
    expect(ptOf(overlayStrokeWidth(2, sheetScale))).toBeGreaterThanOrEqual(OVERLAY_PRINT.minPt - 1e-9);
    expect(ptOf(overlayStrokeWidth(2.5, sheetScale))).toBeGreaterThan(ptOf(overlayStrokeWidth(1.2, sheetScale)) - 1e-9);
    expect(overlayLinePt(50)).toBeLessThanOrEqual(OVERLAY_PRINT.maxPt);
  });
  it("RED-PROOF: the OLD generic retarget printed that same line at 0.6 pt — under the new floor", () => {
    expect(ptOf(printStrokeWidth(2, sheetScale))).toBeCloseTo(0.6, 5);
    expect(ptOf(printStrokeWidth(2, sheetScale))).toBeLessThan(OVERLAY_PRINT.minPt);
  });
  it("the casing is wider than the line it sits under", () => {
    expect(overlayStrokeWidth(2, sheetScale, { casing: true })).toBeGreaterThan(overlayStrokeWidth(2, sheetScale));
  });
  it("opacity never prints below the floor, and never drops a stronger authored value", () => {
    expect(overlayPrintOpacity(0.3)).toBe(OVERLAY_PRINT.minOpacity);
    expect(overlayPrintOpacity(1)).toBe(1);
  });
  it("a point marker has a physical size on paper", () => {
    const dia = ptOf(overlayPointRadius(3.5, sheetScale));
    expect(dia).toBeGreaterThanOrEqual(OVERLAY_PRINT.pointMinPt - 1e-9);
    expect(dia).toBeLessThanOrEqual(OVERLAY_PRINT.pointMaxPt + 1e-9);
  });
  it("a line emitted for the export carries a casing underlay; a pixel-space glyph does not", () => {
    const line = { kind: "line", coords: [[-84.92, 34.37], [-84.91, 34.38]], style: { stroke: "#000", strokeWidth: 2 } };
    expect((buildOverlayVectorFragment([line], projectLngLat, { casing: true }).svg.match(/data-vcase/g) || []).length).toBe(1);
    expect(buildOverlayVectorFragment([line], projectLngLat, {}).svg).not.toMatch(/data-vcase/);
    const glyph = { kind: "line", space: "pixel", coords: [[1, 1], [5, 5]], style: { stroke: "#000", strokeWidth: 2 } };
    expect(buildOverlayVectorFragment([glyph], projectLngLat, { casing: true }).svg).not.toMatch(/data-vcase/);
  });
});
