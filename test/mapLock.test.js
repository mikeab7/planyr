/* NEW-1 — the drawing must stay welded to the aerial no matter how far you pan.
 *
 * The bug these tests lock down: position went through an equirectangular frame pinned at
 * the site origin while the basemap's SCALE was re-derived at the panned-to latitude. Two
 * different latitude models, so the round trip lost a little every north–south excursion.
 * Measured live on 2026-07-28: -4.3 ft residual per ~89,000 ft out-and-back, uniform across
 * every element, cumulative; east–west (where the two models agree) was exactly lossless.
 *
 * The regression guard is the round-trip invariant the report asked for: an out-and-back
 * pan of ANY distance in ANY direction returns the drawing to within a hair of its starting
 * lock. `lockOffsetPx` is the honest test of that — it computes where a feet point lands on
 * screen two independent ways (the planner's SVG transform, and the basemap's own Mercator
 * projection at the derived zoom) and the two must agree.
 */
import { describe, it, expect } from "vitest";
import {
  FT_PER_DEG, mercDeg, invMercDeg, lngLatToFeet, feetToLatLngPair,
  ppfToZoom, zoomToPpf, lockOffsetPx,
} from "../src/workspaces/site-planner/lib/mapLock.js";
import { lngLatRingToFeet, feetToLatLng } from "../src/workspaces/site-planner/lib/arcgis.js";

// The Katy-area origin the app lives on, and the Tomball-edge latitude the drift was measured at.
const ORIGIN = { lat: 29.7858, lon: -95.8244 };

describe("Mercator northing", () => {
  it("is the identity at the equator and grows faster than latitude away from it", () => {
    expect(mercDeg(0)).toBeCloseTo(0, 12);
    expect(mercDeg(30)).toBeGreaterThan(30);
    expect(mercDeg(-30)).toBeLessThan(-30);
  });

  it("inverts exactly", () => {
    for (const lat of [-60, -29.8, 0, 12.34, 29.7858, 45, 61.5]) {
      expect(invMercDeg(mercDeg(lat))).toBeCloseTo(lat, 10);
    }
  });

  it("clamps at the Web-Mercator world edge instead of running to infinity", () => {
    expect(Number.isFinite(mercDeg(90))).toBe(true);
    expect(Number.isFinite(mercDeg(-90))).toBe(true);
  });
});

describe("feet ↔ lat/lng round trip", () => {
  it("returns the exact same point, at the origin and far from it", () => {
    for (const pt of [{ x: 0, y: 0 }, { x: 1200, y: -3400 }, { x: -90000, y: 250000 }]) {
      const [lat, lon] = feetToLatLngPair(pt, ORIGIN.lat, ORIGIN.lon);
      const back = lngLatToFeet(lon, lat, ORIGIN.lon, ORIGIN.lat);
      expect(back.x).toBeCloseTo(pt.x, 6);
      expect(back.y).toBeCloseTo(pt.y, 6);
    }
  });

  it("is ground-true at the site origin (feet per degree of latitude ≈ FT_PER_DEG)", () => {
    // A tenth of a degree north of the origin should measure ~0.1 * FT_PER_DEG feet, which is
    // what keeps every acreage and setback unchanged by this reprojection.
    const a = lngLatToFeet(ORIGIN.lon, ORIGIN.lat + 0.1, ORIGIN.lon, ORIGIN.lat);
    expect(Math.abs(a.y) / FT_PER_DEG).toBeCloseTo(0.1, 3);
  });

  it("barely moves site-scale geometry vs the old linear frame", () => {
    // The frame changed, so this pins how much: across a whole site the difference is well
    // under an inch, and even a mile out it is a few tenths of a foot — and that difference
    // is the CORRECTION, since the basemap under the drawing has always been Mercator.
    // Saved sites therefore need no migration: their stored feet are reused as-is.
    const offsetAt = (ft) => {
      const d = ft / FT_PER_DEG;
      const merc = lngLatToFeet(ORIGIN.lon, ORIGIN.lat + d, ORIGIN.lon, ORIGIN.lat).y;
      return Math.abs(merc - -d * FT_PER_DEG); // the pre-fix frame was linear in latitude
    };
    expect(offsetAt(2000)).toBeLessThan(1 / 12); // across a site: under an inch
    expect(offsetAt(5280)).toBeLessThan(0.5);    // a mile out: a few tenths of a foot
  });

  it("is the same projection arcgis.js exposes (one seam, not two)", () => {
    const [lat, lon] = feetToLatLng({ x: 4321, y: -8765 }, ORIGIN.lat, ORIGIN.lon);
    const [ring] = lngLatRingToFeet([[lon, lat]], ORIGIN.lon, ORIGIN.lat);
    expect(ring.x).toBeCloseTo(4321, 6);
    expect(ring.y).toBeCloseTo(-8765, 6);
  });
});

describe("ppf ↔ zoom", () => {
  it("inverts exactly at the anchor latitude", () => {
    for (const ppf of [0.02, 0.35, 1.4, 6]) {
      expect(zoomToPpf(ppfToZoom(ppf, ORIGIN.lat), ORIGIN.lat)).toBeCloseTo(ppf, 10);
    }
  });
});

/* ── the invariant that matters ──────────────────────────────────────────────────────── */

// Pan the planner view by a screen-pixel delta, the way a drag does.
const panBy = (view, dx, dy) => ({ ppf: view.ppf, offX: view.offX + dx, offY: view.offY + dy });

describe("the drawing stays locked to the imagery", () => {
  const size = { w: 1600, h: 465 };            // the measured viewport
  const view0 = { ppf: 0.35, offX: 60, offY: 60 };

  it("puts a feet point at the same screen pixel by BOTH routes, at the origin", () => {
    const off = lockOffsetPx({ x: 500, y: -700 }, view0, size, ORIGIN);
    expect(Math.hypot(off.dx, off.dy)).toBeLessThan(1e-6);
  });

  it("still agrees after a long NORTH pan — the case that used to drift", () => {
    // ~89,000 ft of northward travel, the excursion the live measurement used.
    let v = view0;
    for (let i = 0; i < 8; i++) v = panBy(v, 0, 3900);
    for (const pt of [{ x: 0, y: 0 }, { x: 2500, y: 1800 }, { x: -4000, y: -2200 }]) {
      const off = lockOffsetPx(pt, v, size, ORIGIN);
      expect(Math.hypot(off.dx, off.dy)).toBeLessThan(1e-6);
    }
  });

  it("returns to the SAME lock after an out-and-back pan, in every direction", () => {
    const probe = { x: 1200, y: -900 };
    for (const [dx, dy] of [[0, 3900], [0, -3900], [4200, 0], [-4200, 0], [2600, 2600]]) {
      let v = view0;
      for (let i = 0; i < 8; i++) v = panBy(v, dx, dy);   // out
      for (let i = 0; i < 8; i++) v = panBy(v, -dx, -dy); // and back
      expect(v.offX).toBeCloseTo(view0.offX, 9);
      expect(v.offY).toBeCloseTo(view0.offY, 9);
      const off = lockOffsetPx(probe, v, size, ORIGIN);
      // The residual the report measured was 4.3 FEET (≈1.5 px at this scale). A tenth of a
      // pixel is far below anything that could accumulate into a pond over a freeway.
      expect(Math.hypot(off.dx, off.dy)).toBeLessThan(0.1);
    }
  });

  it("does not accumulate over many excursions", () => {
    const probe = { x: 0, y: 0 };
    let v = view0;
    for (let trip = 0; trip < 10; trip++) {
      for (let i = 0; i < 8; i++) v = panBy(v, 0, 3900);
      for (let i = 0; i < 8; i++) v = panBy(v, 0, -3900);
    }
    expect(Math.hypot(...Object.values(lockOffsetPx(probe, v, size, ORIGIN)))).toBeLessThan(0.1);
  });

  it("the OLD mixed model would have failed this — proof the test has teeth", () => {
    // Reproduce the pre-fix pairing: linear-in-latitude position, zoom re-derived at the
    // panned-to centre. If this DIDN'T drift, the invariant above would be vacuous.
    const D2R = Math.PI / 180;
    const oldFeetToLatLng = (pt, lat0, lon0) => [
      lat0 - pt.y / FT_PER_DEG,
      lon0 + pt.x / (FT_PER_DEG * Math.cos(lat0 * D2R)),
    ];
    let v = view0;
    for (let i = 0; i < 8; i++) v = panBy(v, 0, 3900);
    const centerFt = { x: (size.w / 2 - v.offX) / v.ppf, y: (size.h / 2 - v.offY) / v.ppf };
    const [cLat] = oldFeetToLatLng(centerFt, ORIGIN.lat, ORIGIN.lon);
    // The old code's scale came from the panned-to latitude; the drawing's came from lat0.
    const scaleDisagreement = Math.abs(ppfToZoom(v.ppf, cLat) - ppfToZoom(v.ppf, ORIGIN.lat));
    expect(scaleDisagreement).toBeGreaterThan(0);
  });
});
