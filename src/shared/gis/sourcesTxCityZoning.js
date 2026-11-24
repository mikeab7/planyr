/* NEW-1 / NEW-2 (Texas city zoning — Richmond, Fulshear, Stafford, Webster; 2026-11-12, Webster measured 2026-11-15; Katy 2026-11-24) — THE GIS REGISTRY ROWS of the Texas city zoning layers (lib/txCityZoning.js reads them).
 *
 * Every row is `states: ["TX"]`, production tier. Spread into `GIS_SOURCES` (sources.js) in one line so this block does not share a patch hunk with another state's rows; fixtures and
 * notes live in `sourceFixturesTxCityZoning.js`, off the app bundle, like every other row.
 *
 * WHERE EACH CITY'S LAYER LIVES (all MEASURED — fields, counts, edit dates, geometry):
 *   · Richmond  — the city's ArcGIS Online org (services6.arcgis.com/riku34rn6C8cs2t5): CORZONINGDISTRICTS020320, 114 polygons, layer edited 2021-03-23. Public, CORS-open, read directly.
 *   · Fulshear  — the city's ArcGIS Online org (services5.arcgis.com/k1ZyjVw1fpWcwy7h): ZONING (67 polygons, edited 2023-09-06) + ZONING_NEWER (9 polygons, edited 2026-10-26). Public, read directly.
 *   · Stafford  — the city's ArcGIS Online org (services.arcgis.com/Ga5PFntoooL0Dlwu): Zoning_Designations_Current, 11 polygons, edited 2024-04-10. Public, read directly.
 *   · Webster   — the city's own ArcGIS Server (www1.cityofwebster.com): Landbase/Zoning/MapServer, layers 0 (base districts, 226) and 1 (planned developments, 45), last edited 2025-12-29.
 *                 It sends no CORS header and the build sandbox's egress refuses it (403 on CONNECT), so it is read through the same-origin /gis-proxy relay (the host is on its ALLOWED_HOSTS) and was
 *                 MEASURED through the branch preview's relay on 2026-11-15 (fields, counts, codes, geometry, overlap of the two layers).
 *   · Katy      — the city's ArcGIS Online org (services8.arcgis.com/ihZy0ZJt5Ea5u0dK), ONE service, Planning_Map/FeatureServer, public and CORS-open, measured 2026-11-24: layer 11 Zoning (18 polygons),
 *                 layer 15 Future Land Use (10,967 parcel-shaped polygons), layer 25 Thoroughfare Plan (391 centrelines). Its layers 7 (City Limits), 8 (ETJ) and 4 (MUDs) are NOT rows here:
 *                 limits / ETJ / MUDs are already drawn from other sources; layers 7 and 8 are the `katy` service area (regions) the three rows are gated to.
 * NOT FOUND, and so not here (each measured): Rosenberg (maps.rosenbergtx.gov publishes no zoning layer), Missouri City (gis.missouricitytx.gov refuses non-browser clients).
 * Unincorporated Fort Bend County keeps the "Texas counties have no zoning" sentence — these layers are drawn only inside a city's limits (lib/txCityZoningLayers.js, `regions`). */

const RICHMOND = "https://services6.arcgis.com/riku34rn6C8cs2t5/arcgis/rest/services/CORZONINGDISTRICTS020320/FeatureServer/0";
const FULSHEAR_OLD = "https://services5.arcgis.com/k1ZyjVw1fpWcwy7h/arcgis/rest/services/ZONING/FeatureServer/0";
const FULSHEAR_NEW = "https://services5.arcgis.com/k1ZyjVw1fpWcwy7h/arcgis/rest/services/ZONING_NEWER/FeatureServer/0";
const STAFFORD = "https://services.arcgis.com/Ga5PFntoooL0Dlwu/arcgis/rest/services/Zoning_Designations_Current/FeatureServer/0";
const KATY = "https://services8.arcgis.com/ihZy0ZJt5Ea5u0dK/arcgis/rest/services/Planning_Map/FeatureServer";
const WEBSTER = "https://www1.cityofwebster.com/arcgis/rest/services/Landbase/Zoning/MapServer";

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
    key: "websterZoning", label: "Zoning districts (City of Webster)", provider: "City of Webster — Planning (zoning districts, Landbase/Zoning layer 0)",
    serviceUrl: `${WEBSTER}/0`, relay: true, coverage: "webster",
    fields: { code: "ZONE_", ordinance: "ORDINANCE", date: "DATE_", section: "Zone_Link", uses: "Use_Link", summary: "District_Summary" },
    ...base,
    // Live 2026-11-15 (through the relay): 226 polygons — NP 38 · R1 37 · C3 34 · C2 33 · C1 25 · R2 19 · O 17 · M1 16 · R1A 7 (the renderer also lists M2; none are drawn). Layer edited 2025-12-29.
  },
  websterPlannedDev: {
    key: "websterPlannedDev", label: "Planned developments (City of Webster)", provider: "City of Webster — Planning (planned development districts, Landbase/Zoning layer 1)",
    serviceUrl: `${WEBSTER}/1`, relay: true, coverage: "webster",
    fields: { code: "ZONE_", name: "PD_Guide_Name", location: "PD_Guide_Location", ordinance: "PD_Guide_Ordinance", ordLink: "Ord_Link", guide: "PD_Guide_Hyperlink" },
    ...base,
    // Live 2026-11-15 (through the relay): 45 PD polygons (17 with a named development guide). They do not overlap the base layer. PD_Guide_Hyperlink is typed with backslashes on 16 of 17.
  },
  katyZoning: {
    key: "katyZoning", label: "Zoning districts (City of Katy)", provider: "City of Katy — Planning (zoning, Planning_Map layer 11)",
    serviceUrl: `${KATY}/11`, coverage: "katy",
    fields: { code: "ZONECODE", description: "ZONDESC", link: "LINK" },
    ...base, lastVerified: "2026-11-24",
    // Live 2026-11-24: 18 polygons — C-1 · C-2 · M · R-1 · MH · OKD and 10 planned districts (PDD / MPC) whose ZONECODE is the development's name. Layer edited 2024-12-02. LINK = an ecode360 section.
  },
  katyFutureLandUse: {
    key: "katyFutureLandUse", label: "Future land use (City of Katy)", provider: "City of Katy — Planning (future land use, Planning_Map layer 15)",
    serviceUrl: `${KATY}/15`, coverage: "katy",
    fields: { code: "FLU", jurisdiction: "Jurisdiction" },
    ...base, lastVerified: "2026-11-24",
    // Live 2026-11-24: 10,967 parcel-shaped polygons (City of Katy 9,451 · Katy ETJ 1,505 · Fulshear ETJ 3 · NOT IN 8). 15 legend classes + ROW (21) + 7 blank. Owner / address / parcel-number fields exist and are never requested.
  },
  katyThoroughfare: {
    key: "katyThoroughfare", label: "Thoroughfare plan (City of Katy)", provider: "City of Katy — Planning (thoroughfare plan, Planning_Map layer 25)",
    serviceUrl: `${KATY}/25`, coverage: "katy",
    fields: { class: "ThoroClass", street: "FullStreet" },
    ...base, geometryType: "line", lastVerified: "2026-11-24",
    // Live 2026-11-24: 391 centrelines — Major 330 · Collector 53 · Proposed Collector 3 · Proposed Major 4 · Interstate Freeway 1.
  },
};

/* Every row's real coverage is one city's limits — a "local" fixture class (≥2 points, ≥2 km apart), not the state class a Texas scope implies. */
const CITY_ONLY = (what, city) => ["local", `${what} — the City of ${city} only; probing it in Dallas or elsewhere in Houston would assert a guaranteed zero.`];
export const TX_CITY_ZONING_FIXTURE_REACH = Object.fromEntries(Object.entries(TX_CITY_ZONING_SOURCES).map(([k, s]) => [k, CITY_ONLY(s.label, /Richmond|Fulshear|Stafford|Webster|Katy/.exec(s.label)[0])]));
