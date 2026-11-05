/* B290247 (+ NEW-1 STATE-PLANE-AUDIT) — a screening distance is measured on the SITE'S OWN state plane zone.
 *
 * `proximityScreen.js` projected every point through the hardcoded EPSG:2278 Texas South Central cone, wherever the site was.
 * B290247 measured it on a Colorado site: a 40-ac square at Johnstown, features placed at known TRUE distances, read back through
 * the shipped `screenProximity` — 500 ft read 509.6, 1,000 read 1,019.3, 2,640 read 2,690.9: a constant +1.93%, and a hazard
 * 990 ft away reading 1,009 ft falls OUTSIDE a 1,000-ft buffer and is dropped. This replays that experiment for Colorado,
 * Tennessee and Georgia (where the Texas cone is wrong by more), and holds the Texas control exact.
 */
import { describe, it, expect } from "vitest";
import { screenProximity, planeForRings, toGrid } from "../src/workspaces/site-planner/lib/proximityScreen.js";
import { measureFlood } from "../src/workspaces/site-planner/lib/siteChecks.js";
import { projectToGrid } from "../src/shared/coordinates/index.js";
import { SP_ZONES, projectToZone, zoneToProject } from "../src/shared/coordinates/statePlane.js";

/* A 1,320 ft square (≈ 40 ac) whose SW corner sits at (lat, lon), laid out on `zone`'s own grid; and a point `eastFt` east of its
 * east edge, also on that grid — "true" here is the zone's grid, which is ground-true to ~1e-4 inside a zone. */
function square(zone, lat, lon, side = 1320) {
  const o = projectToZone(SP_ZONES[zone], lat, lon);
  const p = (dx, dy) => { const r = zoneToProject(SP_ZONES[zone], { x: o.x + dx, y: o.y + dy }); return [r.lon, r.lat]; };
  return { ring: [p(0, 0), p(side, 0), p(side, side), p(0, side), p(0, 0)], at: (eastOfEdge, y = side / 2) => p(side + eastOfEdge, y) };
}

const SITES = [
  ["Johnstown, CO (co_north)", "co_north", 40.3369, -104.9125, 0.0003],
  ["Nashville, TN (tn)", "tn", 36.1627, -86.7816, 0.0003],
  ["Savannah, GA (ga_east)", "ga_east", 32.0809, -81.0912, 0.0003],
  ["Katy, TX (tx_sc) — the control", "tx_sc", 29.7858, -95.8244, 1e-7],
];

describe("distances read back at their true ground distance", () => {
  for (const [name, zone, lat, lon, tol] of SITES) {
    it(`${name}: 500 / 1,000 / 2,640 ft`, () => {
      const sq = square(zone, lat, lon);
      expect(planeForRings([sq.ring]).id, "the plane resolved from the site").toBe(zone);
      for (const want of [500, 1000, 2640]) {
        const r = screenProximity([sq.ring], [{ lngLat: sq.at(want), attrs: {} }]);
        expect(Math.abs(r.nearestFt - want) / want, `${want} ft read ${r.nearestFt}`).toBeLessThan(tol);
      }
    });
  }
  it("the 990-ft pipeline B290247 said was dropped from a 1,000-ft buffer is inside it", () => {
    const sq = square("co_north", 40.3369, -104.9125);
    const r = screenProximity([sq.ring], [{ lngLat: sq.at(990), attrs: {} }]);
    expect(r.nearestFt).toBeLessThan(1000);
  });
  it("RED-PROOF: the old Texas-cone arithmetic reads the same Colorado square ~1.9% long", () => {
    const sq = square("co_north", 40.3369, -104.9125);
    const a = projectToGrid(sq.at(0)[1], sq.at(0)[0]), b = projectToGrid(sq.at(2640)[1], sq.at(2640)[0]);   // the east-edge midpoint, 2,640 ft due east of it
    const old = Math.hypot(b.x - a.x, b.y - a.y);
    expect(old / 2640).toBeGreaterThan(1.015);
    expect(old / 2640).toBeLessThan(1.025);
  });
});

describe("Texas South Central is unchanged, bit for bit", () => {
  it("a Houston point projects exactly as the original EPSG:2278 code did", () => {
    const old = projectToGrid(29.7604, -95.3698);
    const now = toGrid([-95.3698, 29.7604]);
    expect(Object.is(old.x, now.x)).toBe(true);
    expect(Object.is(old.y, now.y)).toBe(true);
  });
});

describe("one plane for the rings AND the features; never Texas where no zone exists", () => {
  it("ground outside every zone gets an explicit site-local frame", () => {
    const z = planeForRings([[[-97.14, 49.9], [-97.13, 49.9], [-97.13, 49.91]]]);
    expect(z.local).toBe(true);
    expect(z.epsg).toBeNull();
    const a = toGrid([-97.14, 49.9], z), b = toGrid([-97.14, 49.91], z);
    expect(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 0.01 * 111133 * 3.2808333)).toBeLessThan(5);   // ~ground-true at the anchor
  });
  it("the area scale of the Georgia site is Georgia's, not Texas's (the 0.46% Site Analysis was off by)", () => {
    // 1,000 × 1,000 ft on Georgia West is 1,000,000 sqft; the Texas cone would read it ~0.46% bigger at this longitude.
    const sq = square("ga_west", 32.6, -83.4, 1000);
    const m = measureFlood([sq.ring], [], []);
    expect(Math.abs(m.siteSqft / 1_000_000 - 1)).toBeLessThan(5e-4);
  });
});
