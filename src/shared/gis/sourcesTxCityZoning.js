/* NEW-1 / NEW-2 (Texas city zoning — Richmond, Fulshear, Stafford, Webster; 2026-11-12) — THE GIS REGISTRY ROWS of the city zoning layers (lib/txCityZoning.js reads them).
 *
 * Every row is `states: ["TX"]`, production tier. Spread into `GIS_SOURCES` (sources.js) in one line so this block does not share a patch hunk with another state's rows; fixtures and
 * notes live in `sourceFixturesTxCityZoning.js`, off the app bundle, like every other row.
 *
 * WHERE EACH CITY'S LAYER LIVES (all MEASURED 2026-11-12 from the build sandbox — fields, counts, edit dates, geometry):
 *   · Richmond  — the city's ArcGIS Online org (services6.arcgis.com/riku34rn6C8cs2t5): CORZONINGDISTRICTS020320, 114 polygons, layer edited 2021-03-23. Public, CORS-open, read directly.
 *   · Fulshear  — the city's ArcGIS Online org (services5.arcgis.com/k1ZyjVw1fpWcwy7h): ZONING (67 polygons, edited 2023-09-06) + ZONING_NEWER (9 polygons, edited 2026-10-26). Public, read directly.
 *   · Stafford  — the city's ArcGIS Online org (services.arcgis.com/Ga5PFntoooL0Dlwu): Zoning_Designations_Current, 11 polygons, edited 2024-04-10. Public, read directly.
 *   · Webster   — the city's own ArcGIS Server (www1.cityofwebster.com): Landbase/Zoning/MapServer. It sends no CORS header and the build sandbox's egress refuses it, so it is read through the
 *                 same-origin /gis-proxy relay (the host is on its ALLOWED_HOSTS). See the Webster row for what has and has not been measured.
 * NOT FOUND, and so not here (each measured): Rosenberg (maps.rosenbergtx.gov publishes no zoning layer), Katy (none public), Missouri City (gis.missouricitytx.gov refuses non-browser clients).
 * Unincorporated Fort Bend County keeps the "Texas counties have no zoning" sentence — these layers are drawn only inside a city's limits (lib/txCityZoningLayers.js, `regions`). */

const RICHMOND = "https://services6.arcgis.com/riku34rn6C8cs2t5/arcgis/rest/services/CORZONINGDISTRICTS020320/FeatureServer/0";
const FULSHEAR_OLD = "https://services5.arcgis.com/k1ZyjVw1fpWcwy7h/arcgis/rest/services/ZONING/FeatureServer/0";
const FULSHEAR_NEW = "https://services5.arcgis.com/k1ZyjVw1fpWcwy7h/arcgis/rest/services/ZONING_NEWER/FeatureServer/0";
const STAFFORD = "https://services.arcgis.com/Ga5PFntoooL0Dlwu/arcgis/rest/services/Zoning_Designations_Current/FeatureServer/0";
export const WEBSTER_ZONING_URL = "https://www1.cityofwebster.com/arcgis/rest/services/Landbase/Zoning/MapServer/0";

const base = { states: ["TX"], tier: "production", lastVerified: "2026-11-12", layerId: null, geometryType: "polygon" };

export const TX_CITY_ZONING_SOURCES = {
  richmondZoning: {
    key: "richmondZoning", label: "Zoning districts (City of Richmond)", provider: "City of Richmond — Planning (zoning districts, Citywide Zoning Initiative 2015 and later changes)",
    serviceUrl: RICHMOND, coverage: "richmond",
    fields: { code: "Zone", description: "ECP_Zone_Description", ordinance: "ZOrdinance", change: "ZoneChange", date: "ZoneDate" },
    ...base,
    // Live 2026-11-12: 114 polygons — SC 20 · GR 26 · GC 18 · PI 19 · OT 12 · MU 11 · SR 6 · DN 1 · IN 1. Layer edited 2021-03-23.
  },
  fulshearZoning: {
    key: "fulshearZoning", label: "Zoning districts (City of Fulshear, earlier map)", provider: "City of Fulshear — Planning (zoning districts, earlier layer)",
    serviceUrl: FULSHEAR_OLD, coverage: "fulshear",
    fields: { code: "Zone_Distr", name: "Zone_Rev", previous: "Zone_Prev", ordinance: "OrdNo", effective: "Effect_Dat", note: "Comments" },
    ...base,
    // Live 2026-11-12: 67 polygons (C 26 · DD 15 · SUR 9 · ER 6 · I 4 · PUD 3 · MU 1 · 3 with no code, MANUFACTURED HOMES). Layer edited 2023-09-06.
  },
  fulshearZoningNewer: {
    key: "fulshearZoningNewer", label: "Zoning districts (City of Fulshear, newer map)", provider: "City of Fulshear — Planning (zoning districts, newer layer: recent rezonings and the city's new district codes)",
    serviceUrl: FULSHEAR_NEW, coverage: "fulshear",
    fields: { code: "Zone_Distr", name: "Zone_Rev", previous: "Zone_Prev", ordinance: "OrdNo", effective: "Effect_Dat", note: "Comments" },
    ...base,
    // Live 2026-11-12: 9 polygons (PUD · MH · CD · SUR · D · SR · ER ×2 · I). Layer edited 2026-10-26. Seven of the nine sit on ground the earlier layer also covers (98 % or more of sampled points); the SR block and one ER block are ground the earlier layer never covered (0 % of sampled points).
  },
  staffordZoning: {
    key: "staffordZoning", label: "Zoning districts (City of Stafford)", provider: "City of Stafford — Planning (zoning designations)",
    serviceUrl: STAFFORD, coverage: "stafford",
    fields: { code: "ZONE_CODE", description: "ZONE_DESCR", link: "CODE_LINK" },
    ...base,
    // Live 2026-11-12: 11 polygons — AE · PDD · IS · MU-2 · MU-1 · MFR · RCLM · RCT · MU · SFR · PC. Layer edited 2024-04-10.
  },
  websterZoning: {
    key: "websterZoning", label: "Zoning districts (City of Webster)", provider: "City of Webster — Planning (zoning districts)",
    serviceUrl: WEBSTER_ZONING_URL, relay: true, coverage: "webster", fields: {},
    ...base,
    // PROVISIONAL: not yet measured (see NEW-2).
  },
};

/* Every row's real coverage is one city's limits — a "local" fixture class (≥2 points, ≥2 km apart), not the state class a Texas scope implies. */
const CITY_ONLY = (what, city) => ["local", `${what} — the City of ${city} only; probing it in Dallas or elsewhere in Houston would assert a guaranteed zero.`];
export const TX_CITY_ZONING_FIXTURE_REACH = Object.fromEntries(Object.entries(TX_CITY_ZONING_SOURCES).map(([k, s]) => [k, CITY_ONLY(s.label, /Richmond|Fulshear|Stafford|Webster/.exec(s.label)[0])]));
