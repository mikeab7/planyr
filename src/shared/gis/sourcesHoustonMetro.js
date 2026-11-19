/* NEW-1 / NEW-2 / NEW-3 (Houston-metro sweep, 2026-11-12) — THE THREE GIS REGISTRY ROWS of the "where people are working" sweep, spread into `GIS_SOURCES` (sources.js)
 * with one line, exactly as Florida's and Sugar Land's blocks are (so sibling sessions' edits to sources.js stay additive). Fixtures and notes live in
 * `sourceFixturesHoustonMetro.js` (off the app bundle, same rule as every other row).
 *
 * ALL THREE HOSTS ARE CORS-OPEN (measured 2026-11-12 with Origin: https://planyr.io — each answers an `Access-Control-Allow-Origin`) and answer the build sandbox directly, so none
 * is read through the /gis-proxy relay and nothing needs adding to its allow-list:
 *   · harrisMtfp     — Harris County's own ArcGIS Server (www.gis.hctx.net/arcgishcpid), the host that already serves the wired `hcfcd_row`;
 *   · hasAirspaceTiers — the City of Houston's ArcGIS Server (geogimsms.houstontx.gov). The sweep's other address, mycity2.houstontx.gov/.../HAS/HAS/MapServer, answers "Service not started" — do not use;
 *   · txEvacZones    — the Harris County GIS ArcGIS Online org (services.arcgis.com/su8ic9KbA7PYVxPS).
 * Every row is `states: ["TX"]`, production tier. */

const base = { layerId: null, states: ["TX"], tier: "production", lastVerified: "2026-11-12" };

/* The Houston MTFP's drawn set: ROW_STATUS 1–15 is exactly what the City's own renderer paints (0 = "not on the plan's map": 41 segments, e.g. a Tollway with no status). */
export const HARRIS_MTFP_WHERE = "ROW_STATUS >= 1 AND ROW_STATUS <= 15";

export const HOUSTON_METRO_SOURCES = {
  harrisMtfp: {
    key: "harrisMtfp", label: "Major Thoroughfare & Freeway Plan (City of Houston)",
    provider: "City of Houston Planning & Development — Major Thoroughfare and Freeway Plan, hosted by Harris County GIS",
    serviceUrl: "https://www.gis.hctx.net/arcgishcpid/rest/services/Transportation/MTFP/MapServer/0",
    geometryType: "line",
    fields: { name: "FULL_NAME", cls: "ST_TYPE", status: "ST_STATUS", owner: "OWNERSHIP", code: "HIER_TABLE", jurisdiction: "JDT", amended: "LastMTFPA", drawn: "ROW_STATUS" },
    where: HARRIS_MTFP_WHERE,
    coverage: "houston",
    ...base,
    // Live 2026-11-12: layer 0 "COH MTFP" holds 26,699 polylines (the same count the B721 ingest reconciled); 26,656 are on the City's map (ROW_STATUS 1–15). The service description:
    // "Approved by Houston Planning Commission on September 18, 2025. Adopted by Houston City Council on October 15, 2025. Downloaded by OCE GIS 1/9/2026". Layers 1–8 (No ETJ, Friendswood,
    // Pasadena, Pearland, Seabrook, Stafford, Tomball, Webster) are OTHER cities' plans, each with its own schema — none is read.
  },
  hasAirspaceTiers: {
    key: "hasAirspaceTiers", label: "Airport height-hazard tiers (Houston Airport System)",
    provider: "City of Houston — Houston Airport System airport land-use tiers (HPC / Houston_Airport_System)",
    serviceUrl: "https://geogimsms.houstontx.gov/arcgis/rest/services/HPC/Houston_Airport_System/MapServer/7",
    geometryType: "polygon",
    fields: { tier: "Tier" },
    coverage: "houston",
    ...base,
    // Live 2026-11-12: layer 7 "All Airport Tiers" = 9 polygons — GBIA Tier 1/2/3 (George Bush Intercontinental), Hobby Tier 1/2/3, Ellington-Tier 1/2/3. Layers 2 and 6 hold the same tiers as
    // ~1.9 million 1-cell terrain polygons (AIR_AGL / AIR_AMSL per cell) — a grid, not a map layer, and never read.
  },
  txEvacZones: {
    key: "txEvacZones", label: "Hurricane evacuation Zip-Zones (Texas Gulf coast)",
    provider: "Harris County GIS — hurricane evacuation Zip-Zones (the Houston-Galveston region's Zip-Zone scheme)",
    serviceUrl: "https://services.arcgis.com/su8ic9KbA7PYVxPS/arcgis/rest/services/HurricaneEvac_Zones/FeatureServer/0",
    geometryType: "polygon",
    fields: { zone: "Zone", zip: "Zip5digit", place: "Name", county: "County", direction: "Direction" },
    coverage: "gulfcoast",
    ...base,
    // Live 2026-11-12: 87 polygons — Zip-Zone A 12 · B 24 · C 37 · Coastal 14 — in five counties (Brazoria, Chambers, Galveston, Harris, Matagorda) plus one blank-county row per zone.
    // Layer last edited 2026-07-10; its DATA last edited 2024-06-04. Jefferson County, which the layer's extent reaches, holds no polygon.
  },
};

/* Where each row's data really is → the fixture class the registry demands (B209505): not the "state" class a Texas scope implies. */
export const HOUSTON_METRO_FIXTURE_REACH = {
  harrisMtfp: ["regional", "The City of Houston's thoroughfare plan covers the city, its ETJ and the roads Harris, Fort Bend and Montgomery counties own inside it — probing Dallas would assert a guaranteed zero."],
  hasAirspaceTiers: ["regional", "The nine tiers are the zones around Bush Intercontinental, Hobby and Ellington Field — about 40 km between the farthest two; a Katy or Dallas point is correctly empty."],
  txEvacZones: ["regional", "Zip-Zones exist only for the Houston-Galveston coast (Brazoria, Chambers, Galveston, Harris, Matagorda) — a Dallas point is correctly empty."],
};
