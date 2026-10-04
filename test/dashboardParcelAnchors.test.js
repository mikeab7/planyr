import { describe, it, expect } from "vitest";
import { displayPointsByGroup } from "../src/workspaces/dashboard/lib/dashboardParcelAnchors.js";
import { mapMarkers } from "../src/workspaces/dashboard/lib/dashboardMapMarkers.js";
import { siteAnchorLatLon } from "../src/workspaces/site-planner/lib/siteAnchor.js";
import { lngLatToFeet } from "../src/workspaces/site-planner/lib/mapLock.js";
import { signedDist } from "../src/workspaces/site-planner/lib/polylabel.js";

// B-NEW-1 — Dashboard Locations pins use the Site tab's inside-the-parcel point, not the saved origin.
// Katz-shaped: a wide block, a long tail down the east side, a notch lower-left. The saved origin
// (0,0) is deliberately IN the notch, i.e. outside the parcel.
const L_SHAPE = [
  { x: 100, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 1500 }, { x: 450, y: 1500 },
  { x: 450, y: 400 }, { x: 100, y: 400 },
];
const ORIGIN = { lat: 29.9, lon: -95.4 };
const proj = (siteId, groupId, origin = ORIGIN) => ({ groupId, siteId, name: groupId, role: "pursuit", status: "active", origin });
const rows = (siteId, pts) => [{ site_id: siteId, data: { id: "p1", points: pts, active: true } }];

describe("dashboard pin placement", () => {
  it("the notched site's pin equals the shared helper's inside point, not the saved origin", () => {
    const p = proj("s1", "g1");
    const pts = displayPointsByGroup([p], rows("s1", L_SHAPE));
    const [m] = mapMarkers([p], [], pts);
    const want = siteAnchorLatLon({ origin: ORIGIN }, [{ points: L_SHAPE }]);
    expect(want.source).toBe("geometry");
    expect(m.lat).toBeCloseTo(want.lat, 9);
    expect(m.lon).toBeCloseTo(want.lon, 9);
    expect(m.lat !== ORIGIN.lat || m.lon !== ORIGIN.lon).toBe(true);
    // and it really is inside the parcel (back in the plan's feet frame)
    const { x, y } = lngLatToFeet(m.lon, m.lat, ORIGIN.lon, ORIGIN.lat);
    expect(signedDist({ x, y }, L_SHAPE)).toBeGreaterThan(0);
  });

  it("the saved origin really is outside that parcel (the premise of the bug)", () => {
    expect(signedDist({ x: 0, y: 0 }, L_SHAPE)).toBeLessThan(0);
  });

  it("a site with no boundary falls back to its saved origin", () => {
    const p = proj("s2", "g2");
    const pts = displayPointsByGroup([p], []);
    expect(pts).toEqual({});
    const [m] = mapMarkers([p], [], pts);
    expect([m.lat, m.lon]).toEqual([ORIGIN.lat, ORIGIN.lon]);
  });

  it("rows for other plans don't move this project; inactive/deleted parcels are ignored", () => {
    const p = proj("s3", "g3");
    expect(displayPointsByGroup([p], rows("other", L_SHAPE))).toEqual({});
    const dead = [{ site_id: "s3", data: { points: L_SHAPE, active: false } }];
    expect(displayPointsByGroup([p], dead)).toEqual({});
  });

  it("mapMarkers without display points is unchanged (origin)", () => {
    const [m] = mapMarkers([proj("s4", "g4")], []);
    expect([m.lat, m.lon]).toEqual([ORIGIN.lat, ORIGIN.lon]);
  });
});
