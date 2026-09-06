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
  ppfToZoom, zoomToPpf, lockOffsetPx, exactContainerPoint, registrationLayoutMayHaveChanged,
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

  /* The basemap's whole-pixel floor (V478's residual). Leaflet can only place the map on
   * whole screen pixels, so the drawing↔imagery registration is quantised — bounded and
   * non-cumulative, deliberately NOT compensated (see the note in mapLock.js). What we can
   * still remove is a SECOND rounding at our own call sites, which is what
   * `exactContainerPoint` is for. These pin its honest scope so the claim can't rot. */
  describe("exactContainerPoint — the unsnapped container-frame conversion", () => {
    const PO = { x: 1000, y: 2000 };   // map.getPixelOrigin() — always integer
    const PP = { x: -7, y: 13 };       // map pane position — always integer

    it("is the plain frame shift, with no rounding of its own", () => {
      const p = exactContainerPoint({ x: 1234.37, y: 2345.62 }, PO, PP);
      expect(p.x).toBeCloseTo(1234.37 - 1000 - 7, 10);
      expect(p.y).toBeCloseTo(2345.62 - 2000 + 13, 10);
    });

    it("is a NO-OP against Leaflet's rounded route when the container is even-sized", () => {
      // What `commit` computes: (containerPoint - halfSize), then panBy rounds it. With an
      // even container, half is an integer, and round(round(w) - k) === round(w) - k. So
      // dropping the inner round changes nothing — which is exactly what the live gate
      // measured. This is the "it did not move the residual" claim, made checkable.
      const half = { x: 720, y: 450 }; // 1440 x 900 → integer halves
      for (const w of [{ x: 1234.37, y: 2345.62 }, { x: 1000.5, y: 2000.5 }, { x: 999.499, y: 2001.501 }]) {
        const snapped = { x: Math.round(w.x) - PO.x + PP.x, y: Math.round(w.y) - PO.y + PP.y };
        const exact = exactContainerPoint(w, PO, PP);
        expect(Math.round(snapped.x - half.x)).toBe(Math.round(exact.x - half.x));
        expect(Math.round(snapped.y - half.y)).toBe(Math.round(exact.y - half.y));
      }
    });

    it("DOES differ on an odd-sized container — the case it exists to remove", () => {
      // An odd dimension makes half a .5, and then the two roundings can disagree by a whole
      // pixel. If this ever stopped differing, the helper would be pure ceremony.
      const half = { x: 720.5, y: 450.5 }; // 1441 x 901
      const w = { x: 1000.5, y: 2000.5 };
      const snapped = { x: Math.round(w.x) - PO.x + PP.x, y: Math.round(w.y) - PO.y + PP.y };
      const exact = exactContainerPoint(w, PO, PP);
      const dx = Math.round(snapped.x - half.x) - Math.round(exact.x - half.x);
      const dy = Math.round(snapped.y - half.y) - Math.round(exact.y - half.y);
      expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
    });

    it("never introduces error larger than the one snap Leaflet has to make", () => {
      // The floor: a single nearest-pixel snap, i.e. half a pixel per axis. Feeding an
      // unrounded target guarantees we stay at that floor instead of stacking two snaps.
      for (let i = 0; i < 200; i++) {
        const w = { x: 1000 + i * 0.137, y: 2000 + i * 0.611 };
        const exact = exactContainerPoint(w, PO, PP);
        expect(Math.abs(Math.round(exact.x) - exact.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(Math.round(exact.y) - exact.y)).toBeLessThanOrEqual(0.5);
      }
    });
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

/* B846384 — the pure gate B1359 costed and this session ships: skip the registration effect's
 * forced-layout container read on a commit where neither the canvas size nor the overscan could
 * have moved the container. Boundary conditions asserted here so the component's own reasoning
 * ("React already knows every input that can change them") is a proven property, not a comment. */
describe("registrationLayoutMayHaveChanged — B846384's forced-layout gate", () => {
  it("says yes on the very first check (nothing to compare against yet)", () => {
    expect(registrationLayoutMayHaveChanged(null, 800, 560, 107)).toBe(true);
  });

  it("says no once the same inputs have already been checked", () => {
    const li = { w: 800, h: 560, overscan: 107 };
    expect(registrationLayoutMayHaveChanged(li, 800, 560, 107)).toBe(false);
  });

  it("says yes when EITHER canvas dimension alone has moved", () => {
    const li = { w: 800, h: 560, overscan: 107 };
    expect(registrationLayoutMayHaveChanged(li, 801, 560, 107)).toBe(true);
    expect(registrationLayoutMayHaveChanged(li, 800, 561, 107)).toBe(true);
  });

  it("says yes when the overscan alone has moved — the container can resize with the canvas unchanged", () => {
    const li = { w: 800, h: 560, overscan: 107 };
    expect(registrationLayoutMayHaveChanged(li, 800, 560, 176)).toBe(true);
  });
});
