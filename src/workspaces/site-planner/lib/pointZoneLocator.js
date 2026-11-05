/* NEW-2 (STATE-PLANE-STATUTE) — the point → county → state-plane-zone locator, installed into the lean coordinate core.
 *
 * A bare lat/lon (Map/Comps overlay anchors carry no state or county) used to resolve through coarse boxes, and the Houston-area box
 * (27.0–31.2 N, -99.8 – -93.5 W) answers South Central for Conroe, Liberty and Beaumont-area counties that the statute puts in Texas
 * CENTRAL. Zone lines are county lines, so the right answer is: which county is the point in (the bundled county polygons), then that
 * county's statutory zone (the generated county table). This module joins the two. It is loaded DYNAMICALLY by countyPolygons.js, at
 * the moment the polygons are resident — never statically — because it pulls in the 22 KB county table, which must stay off the Site
 * route's boot path (see shared/coordinates/statePlaneCore.js). */
import { resolveCounty } from "./countyPolygons.js";
import { zoneForCounty } from "../../../shared/coordinates/statePlane.js";
import { setPointZoneLocator } from "../../../shared/coordinates/statePlaneCore.js";

// Alaska is positional (boroughs straddle the meridian bands) and Hawaii is by island — the core's own position logic answers those.
const POSITIONAL = new Set(["AK", "HI"]);

export const pointZoneLocator = {
  forPoint(lat, lon) {
    const c = resolveCounty(lat, lon);
    if (c.status !== "ok" || POSITIONAL.has(c.state)) return null;
    const zone = zoneForCounty(c.state, c.name, { lat });
    return zone ? { zone, nearEdge: c.nearEdge === true } : null;
  },
};

export function installPointZoneLocator() { setPointZoneLocator(pointZoneLocator); }
