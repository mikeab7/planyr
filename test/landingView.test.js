import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  landingView, clusterSites, densestCluster, milesBetween, boundsOf, fitZoom, clampedFitZoom,
  locatedPoints, CONUS_BOUNDS, CLUSTER_RADIUS_MI, LANDING_MAX_ZOOM, LANDING_MIN_ZOOM,
} from "../src/workspaces/site-planner/lib/landingView.js";

/* NEW-1 — where the Map view OPENS is DERIVED from the user's own saved sites.
 *
 * The defect: `MapFinder` created its Leaflet map on `COUNTIES_MAP.harris`, so a brand-new
 * account in Denver, Phoenix or Atlanta opened over Houston, Texas. The rule replacing it has
 * three cases (no sites → the continental US · one site → its AREA, never its parcel · more
 * than one → the DENSEST CLUSTER, so an outlier can't drag the camera) and one hard constraint
 * on all of them: the landing zoom is clamped OUT to a metro / county-scale reading.
 *
 * These are pure tests over the helper — no Leaflet, no DOM. The component's own wiring is
 * guarded by the source check at the bottom and by V### in the browser.
 */

const VIEWPORT = { width: 1440, height: 900 };

/* ── The OWNER'S REAL DISTRIBUTION, which is the fixture that matters ──────────────────────
 * 26 sites around Houston — Harris, Fort Bend, Waller and Chambers — and EXACTLY ONE in Weld
 * County, Colorado. The correct landing today is Houston, unchanged from what he has now,
 * with the Colorado site simply not pulling the camera. Spread deterministically (no random)
 * inside each county so the clustering is exercised on real distances, not on one point. */
const spread = (n, lat0, lon0, dLat, dLon, at0) =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${lat0}-${i}`,
    origin: { lat: lat0 + ((i % 5) - 2) * dLat, lon: lon0 + ((i % 4) - 1.5) * dLon },
    updatedAt: at0 + i * 1000,
  }));

const HOUSTON_26 = [
  ...spread(14, 29.80, -95.40, 0.09, 0.12, 1_700_000_000_000), // Harris
  ...spread(6, 29.55, -95.75, 0.06, 0.09, 1_700_100_000_000),  // Fort Bend
  ...spread(3, 30.00, -95.86, 0.05, 0.06, 1_700_200_000_000),  // Waller
  ...spread(3, 29.72, -94.70, 0.05, 0.07, 1_700_300_000_000),  // Chambers
];
const WELD_CO = { id: "weld-1", origin: { lat: 40.42, lon: -104.71 }, updatedAt: 1_700_400_000_000 };
const OWNER_SITES = [...HOUSTON_26, WELD_CO];

/* What the user can actually SEE at a given center+zoom, in degrees — so "Colorado is
 * off-screen" is asserted as a fact about the rendered viewport, not eyeballed from a number. */
const D = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2));
const invMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D;
function visibleBounds({ center, zoom }, { width, height }) {
  const worldPx = 256 * 2 ** zoom;
  const halfLon = (width / 2) * (360 / worldPx);
  const halfMerc = (height / 2) * ((2 * Math.PI) / worldPx);
  const cy = mercY(center[0]);
  return {
    south: invMercY(cy - halfMerc), north: invMercY(cy + halfMerc),
    west: center[1] - halfLon, east: center[1] + halfLon,
  };
}
const contains = (b, lat, lon) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

describe("milesBetween / locatedPoints — the inputs the rule reasons over", () => {
  it("measures real-world distance (Houston → Weld County is ~900 mi, not 'far')", () => {
    const d = milesBetween({ lat: 29.76, lon: -95.37 }, { lat: 40.42, lon: -104.71 });
    expect(d).toBeGreaterThan(850);
    expect(d).toBeLessThan(1000);
  });

  it("a blank-planner site (no origin) never votes on where the map opens", () => {
    const pts = locatedPoints([{ id: "a", origin: { lat: 29.7, lon: -95.4 } }, { id: "b" }, { id: "c", origin: null }]);
    expect(pts).toHaveLength(1);
    expect(pts[0].id).toBe("a");
  });

  it("a husk record with a non-finite origin is dropped, not landed on", () => {
    const pts = locatedPoints([{ origin: { lat: NaN, lon: -95.4 } }, { origin: { lat: 29.7, lon: null } }]);
    expect(pts).toHaveLength(0);
  });
});

describe("case 1 — NO SITES YET: the whole continental US", () => {
  it("opens on the country, not on Houston", () => {
    const v = landingView([], VIEWPORT);
    expect(v.source).toBe("empty");
    expect(v.count).toBe(0);
    // Nowhere near the old hardcoded Harris landing ([29.76, -95.37] @ z11).
    expect(v.zoom).toBeLessThanOrEqual(5);
    expect(v.center[0]).toBeGreaterThan(30);
  });

  it("the continental US actually FITS in the opening view", () => {
    const b = visibleBounds(landingView([], VIEWPORT), VIEWPORT);
    expect(b.south).toBeLessThanOrEqual(CONUS_BOUNDS.south);
    expect(b.north).toBeGreaterThanOrEqual(CONUS_BOUNDS.north);
    expect(b.west).toBeLessThanOrEqual(CONUS_BOUNDS.west);
    expect(b.east).toBeGreaterThanOrEqual(CONUS_BOUNDS.east);
  });

  it("an account whose only records are un-located plans still gets the country", () => {
    expect(landingView([{ id: "blank1" }, { id: "blank2", origin: null }], VIEWPORT).source).toBe("empty");
  });
});

describe("case 2 — EXACTLY ONE SITE: that site's AREA, clamped to metro scale", () => {
  const ONE = [{ id: "denver-1", origin: { lat: 39.74, lon: -104.99 }, updatedAt: 5 }];

  it("centers on the site", () => {
    const v = landingView(ONE, VIEWPORT);
    expect(v.center[0]).toBeCloseTo(39.74, 6);
    expect(v.center[1]).toBeCloseTo(-104.99, 6);
    expect(v.count).toBe(1);
  });

  it("does NOT open zoomed to that parcel — it stops at the metro-scale clamp", () => {
    expect(landingView(ONE, VIEWPORT).zoom).toBe(LANDING_MAX_ZOOM);
  });

  it("the visible area is a market, not a lot (tens of miles across)", () => {
    const b = visibleBounds(landingView(ONE, VIEWPORT), VIEWPORT);
    const acrossMi = milesBetween({ lat: b.south, lon: b.west }, { lat: b.south, lon: b.east });
    expect(acrossMi).toBeGreaterThan(10);
  });
});

describe("case 3 — MORE THAN ONE SITE: the densest cluster wins the camera", () => {
  it("the owner's 26 Houston sites + 1 Colorado outlier land on HOUSTON", () => {
    const v = landingView(OWNER_SITES, VIEWPORT);
    expect(v.source).toBe("sites");
    expect(v.count).toBe(26);            // the Colorado site is not in the winning market
    expect(v.center[0]).toBeGreaterThan(29.3);
    expect(v.center[0]).toBeLessThan(30.2);
    expect(v.center[1]).toBeGreaterThan(-96.1);
    expect(v.center[1]).toBeLessThan(-94.5);
  });

  it("it is the CLUSTER, not a bounding box of everything the user owns", () => {
    const v = landingView(OWNER_SITES, VIEWPORT);
    const all = boundsOf(OWNER_SITES.map((s) => s.origin));
    // A naive fit-all would center in the Texas panhandle / Kansas, ~5 degrees north.
    const naiveCenterLat = (all.south + all.north) / 2;
    expect(naiveCenterLat).toBeGreaterThan(34);
    expect(v.center[0]).toBeLessThan(31);
    expect(v.bounds.north).toBeLessThan(31);   // the fitted bounds stop well short of Colorado
  });

  it("Colorado is OFF-SCREEN in the landing view", () => {
    const v = landingView(OWNER_SITES, VIEWPORT);
    expect(contains(visibleBounds(v, VIEWPORT), WELD_CO.origin.lat, WELD_CO.origin.lon)).toBe(false);
  });

  it("all four Houston-area counties ARE on screen (Waller to Chambers, one market)", () => {
    const b = visibleBounds(landingView(OWNER_SITES, VIEWPORT), VIEWPORT);
    HOUSTON_26.forEach((s) => expect(contains(b, s.origin.lat, s.origin.lon)).toBe(true));
  });

  it("Waller and Chambers chain into ONE market through the Harris sites between them", () => {
    // They are further apart than the threshold on their own — single-linkage is the point.
    expect(milesBetween({ lat: 30.0, lon: -95.86 }, { lat: 29.72, lon: -94.7 })).toBeGreaterThan(CLUSTER_RADIUS_MI);
    const groups = clusterSites(OWNER_SITES);
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(26);
    expect(groups[1].count).toBe(1);
  });

  it("if Colorado ever becomes the denser market, the landing view follows on its own", () => {
    const flipped = [...HOUSTON_26.slice(0, 3), ...spread(9, 40.42, -104.71, 0.06, 0.08, 1_800_000_000_000)];
    const v = landingView(flipped, VIEWPORT);
    expect(v.count).toBe(9);
    expect(v.center[0]).toBeGreaterThan(39.5);
    expect(v.center[1]).toBeLessThan(-104);
  });
});

describe("tie-break — two equally dense markets go to the most recently updated", () => {
  const tx = spread(4, 29.80, -95.40, 0.05, 0.06, 1_000);
  const co = spread(4, 39.74, -104.99, 0.05, 0.06, 9_000);

  it("picks the market with the newest site when the counts are equal", () => {
    const v = landingView([...tx, ...co], VIEWPORT);
    expect(v.count).toBe(4);
    expect(v.center[0]).toBeGreaterThan(39);        // Colorado — it was touched more recently
  });

  it("…and flips when the OTHER market is the one touched most recently", () => {
    const txNewer = tx.map((s) => ({ ...s, updatedAt: s.updatedAt + 20_000 }));
    const v = landingView([...txNewer, ...co], VIEWPORT);
    expect(v.center[0]).toBeLessThan(31);           // Houston
  });

  it("a missing updatedAt is treated as oldest, never as newest", () => {
    const undated = co.map((s) => ({ ...s, updatedAt: undefined }));
    const v = landingView([...tx, ...undated], VIEWPORT);
    expect(v.center[0]).toBeLessThan(31);           // Texas (updatedAt 1_000) beats undated
  });
});

describe("ZOOM — 'make sure it's appropriately zoomed out'", () => {
  it("sites all within one mile of each other still clamp OUT to metro scale", () => {
    const tight = [
      { origin: { lat: 29.7600, lon: -95.3700 }, updatedAt: 1 },
      { origin: { lat: 29.7650, lon: -95.3720 }, updatedAt: 2 },
      { origin: { lat: 29.7620, lon: -95.3660 }, updatedAt: 3 },
    ];
    const far = milesBetween(tight[0].origin, tight[1].origin);
    expect(far).toBeLessThan(1);
    expect(landingView(tight, VIEWPORT).zoom).toBe(LANDING_MAX_ZOOM);
  });

  it("two sites on top of each other (degenerate bounds) clamp instead of dividing by zero", () => {
    const same = [{ origin: { lat: 29.76, lon: -95.37 } }, { origin: { lat: 29.76, lon: -95.37 } }];
    const v = landingView(same, VIEWPORT);
    expect(Number.isFinite(v.zoom)).toBe(true);
    expect(v.zoom).toBe(LANDING_MAX_ZOOM);
  });

  it("never zooms past the metro clamp, at any viewport size", () => {
    [{ width: 320, height: 480 }, { width: 1440, height: 900 }, { width: 3840, height: 2160 }].forEach((vp) => {
      expect(landingView([{ origin: { lat: 29.76, lon: -95.37 } }], vp).zoom).toBeLessThanOrEqual(LANDING_MAX_ZOOM);
      expect(landingView(OWNER_SITES, vp).zoom).toBeLessThanOrEqual(LANDING_MAX_ZOOM);
    });
  });

  it("never falls below the map's own floor, even fitting the whole world", () => {
    expect(clampedFitZoom({ south: -60, west: -179, north: 70, east: 179 }, VIEWPORT)).toBe(LANDING_MIN_ZOOM);
  });

  it("errs WIDE: the fit is floored, and padding is left around the bounds", () => {
    const b = { south: 29.5, west: -95.9, north: 30.1, east: -94.6 };
    const raw = fitZoom(b, VIEWPORT);
    const padless = fitZoom(b, { ...VIEWPORT, padFrac: 0 });
    expect(raw).toBeLessThan(padless);             // padding costs zoom, i.e. shows more
    expect(clampedFitZoom(b, VIEWPORT)).toBe(Math.floor(raw));
    // The fitted bounds sit comfortably inside what's visible, on every side.
    const vb = visibleBounds({ center: [(b.south + b.north) / 2, (b.west + b.east) / 2], zoom: clampedFitZoom(b, VIEWPORT) }, VIEWPORT);
    expect(vb.south).toBeLessThan(b.south);
    expect(vb.north).toBeGreaterThan(b.north);
    expect(vb.west).toBeLessThan(b.west);
    expect(vb.east).toBeGreaterThan(b.east);
  });
});

describe("clustering is deterministic and order-independent", () => {
  it("the same sites in a different order give the same answer", () => {
    const a = landingView(OWNER_SITES, VIEWPORT);
    const b = landingView([...OWNER_SITES].reverse(), VIEWPORT);
    expect(b.center).toEqual(a.center);
    expect(b.zoom).toBe(a.zoom);
    expect(b.count).toBe(a.count);
  });

  it("densestCluster is null only when nothing is located", () => {
    expect(densestCluster([])).toBeNull();
    expect(densestCluster([{ id: "blank" }])).toBeNull();
    expect(densestCluster(OWNER_SITES).count).toBe(26);
  });
});

/* Source guard — the whole point of this item is that the landing view is DERIVED. A future
 * refactor that quietly puts a fixed county back is the regression to catch in CI, not live. */
describe("MapFinder no longer hardcodes a landing view (source guard)", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");

  it("creates its map from landingView(), not from a county config", () => {
    // NEW-MAPCTRL-2 — the "back to your sites" affordance pulls milesBetween/CLUSTER_RADIUS_MI
    // in alongside landingView from the SAME module, so this now allows (but doesn't require)
    // extra named imports rather than requiring landingView to be the ONLY one.
    expect(src).toMatch(/import \{ landingView[^}]*\} from "\.\/lib\/landingView\.js"/);
    expect(src).toMatch(/const cfg = landingView\(/);
    // (the string still appears in the comment explaining what it replaced — this is the
    // ASSIGNMENT, i.e. a fixed county actually being used as a view again.)
    expect(src).not.toMatch(/=\s*COUNTIES_MAP\.\w+\s*;/);
    expect(src).not.toMatch(/setView\(\s*COUNTIES_MAP/);
  });

  it("resolves the Layers-panel jurisdiction with countyForView, not candidate[0]", () => {
    // candidateCountiesForPoint(...)[0] is harris-first by contract for any point outside every
    // county bbox — reading it as a jurisdiction is the same hardcoded-Houston bug one layer down.
    expect(src).toMatch(/setViewCounty\(countyForView\(/);
    expect(src).not.toMatch(/setViewCounty\(cand\[0\]\)/);
  });

  it("the derived view is an opening position, not a leash on the user", () => {
    expect(src).toMatch(/userMovedRef/);
    expect(src).toMatch(/landedRef/);
  });
});
