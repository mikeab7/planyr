/* NEW-1 / NEW-3 (Metro Nashville zoning sweep, 2026-11-12) — THE METRO NASHVILLE & DAVIDSON COUNTY GIS REGISTRY ROWS.
 *
 * Every row is `states: ["TN"]`, production tier, probed 2026-11-12. Spread into `GIS_SOURCES` (sources.js) with one line so this block does not share a patch hunk with another state's rows.
 * Fixtures and notes live in `sourceFixturesNashville.js` (off the app bundle, same rule as every other row).
 *
 * TWO WAYS IN, both MEASURED:
 *   · Metro's ArcGIS Online org (services2.arcgis.com/HdTo6HJqh92wn4D8 — the same org that publishes the Parcels_view the Davidson parcel row reads): public, CORS-open (access-control-allow-origin: *),
 *     read straight from the browser. The zoning, overlay, downtown-code, PUD and satellite-city layers are all here.
 *   · Metro's own ArcGIS Server (maps.nashville.gov/arcgis) — the NashvilleNext Community Character Policy. The build sandbox's egress refuses it and the browser's CORS is unmeasured, so the row is
 *     read through the same-origin /gis-proxy relay (`relay: true`; the host went on ALLOWED_HOSTS in the same commit) and measured on the PR preview.
 *
 * The layer rows in lib/nashvilleLayers.js read their URL from here, so the two cannot disagree. */

const NASH_ORG = "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services";
const NASH_SERVER = "https://maps.nashville.gov/arcgis/rest/services";
const base = { states: ["TN"], coverage: "davidson", tier: "production", lastVerified: "2026-11-12", layerId: null };

export const NASHVILLE_SOURCES = {
  nashZoning: {
    key: "nashZoning", label: "Zoning districts (Metro Nashville & Davidson County)", provider: "Metro Nashville & Davidson County — Planning Department (zoning districts, Title 17)",
    serviceUrl: `${NASH_ORG}/Zoning_Vw/FeatureServer/0`, geometryType: "polygon",
    fields: { code: "ZONE_DESC", name: "NAME", ordinance: "ORDINANCE", date: "ORD_DATE", case: "CASE_NO" },
    dataLastEdited: "2026-11-12",
    ...base,
    // Live 2026-11-12: 6,027 polygons, 92 distinct ZONE_DESC codes (the field's coded-value domain lists 115, names identical to the codes), maxRecordCount 2000, CORS open. The 1,053 "SP" polygons carry the
    // specific plan's name in NAME. A satellite city's land reads "Satellite City" (the city zones it, not Metro). First 2,000 polygons = 92,652 vertices, so the whole county (~280 k) sits at the 300 k draw budget — the row is asked simplified.
  },
  nashOverlays: {
    key: "nashOverlays", label: "Zoning overlay districts (Metro Nashville & Davidson County)", provider: "Metro Nashville & Davidson County — Planning Department (overlay districts)",
    serviceUrl: `${NASH_ORG}/Zoning_Overlay_Districts_Vw/FeatureServer/0`, geometryType: "polygon",
    fields: { name: "ZONE_DESC", subdistrict: "SUBDISTRICT", impact: "IMPACT_ZONE", detail: "NAME", ordinance: "ORDINANCE", date: "ORD_DATE", case: "CASE_NO" },
    dataLastEdited: "2026-11-12",
    ...base,
    // Live 2026-11-12: 332 polygons, 19 distinct ZONE_DESC values in use (the domain lists 22). ZONE_DESC is already a plain-words name ("Urban Design Overlay", "Airport Impact", "I-440 Impact"). 70,014 vertices in all.
  },
  nashDtc: {
    key: "nashDtc", label: "Downtown Code subdistricts (Metro Nashville)", provider: "Metro Nashville & Davidson County — Planning Department (Downtown Code subdistricts and use areas)",
    serviceUrl: `${NASH_ORG}/Downtown_Code_Subdistricts_and_Use_Areas_view/FeatureServer/0`, geometryType: "polygon",
    fields: { subdistrict: "Subdistrict", useArea: "UseArea" },
    dataLastEdited: "2026-11-11",
    ...base,
    // Live 2026-11-12: 18 polygons, 17 named subdistricts (CORE, SOBRO, GULCH SOUTH, RUTLEDGE HILL …) in five use areas (CENTRAL, EAST, NORTH, SOUTH, WEST).
  },
  nashPud: {
    key: "nashPud", label: "Planned unit developments (Metro Nashville & Davidson County)", provider: "Metro Nashville & Davidson County — Planning Department (planned unit developments)",
    serviceUrl: `${NASH_ORG}/Planned_Unit_Developments_Vw/FeatureServer/0`, geometryType: "polygon",
    fields: { type: "ZONE_DESC", case: "CASE_NO", ordinance: "ORDINANCE", date: "ORD_DATE" },
    dataLastEdited: "2026-11-12",
    ...base,
    // Live 2026-11-12: 876 polygons, ZONE_DESC in 18 spellings ("Res. PUD", "Comm. PUD (Amended)", "Ind. PUD", "MU PUD", "Reduced Lot Dist." …) — shown exactly as the Planning Department typed them.
  },
  nashSatellite: {
    key: "nashSatellite", label: "Satellite cities (Metro Nashville & Davidson County)", provider: "Metro Nashville & Davidson County — Planning Department (satellite city limits)",
    serviceUrl: `${NASH_ORG}/Satellite_Cities_view/FeatureServer/0`, geometryType: "polygon",
    fields: { name: "Name" },
    dataLastEdited: "2025-01-02",
    ...base,
    // Live 2026-11-12: 8 polygons for 6 cities — Belle Meade, Berry Hill, Forest Hills, Goodlettsville, Oak Hill, Ridgetop (Ridgetop is three pieces). These govern their own zoning, which is why Metro's zoning layer reads
    // "Satellite City" there. Fetched once (4,425 vertices) and kept in memory to name the city a site falls in (lib/nashvilleJurisdiction.js).
  },
  nashCcm: {
    key: "nashCcm", label: "Community Character Policy (NashvilleNext)", provider: "Metro Nashville & Davidson County — Planning Department (NashvilleNext Community Character Manual policy)",
    serviceUrl: `${NASH_SERVER}/Planning/CCM/MapServer/2`, relay: true, geometryType: "polygon",
    fields: { code: "PolicyCode", name: "PolicyDesc", transect: "Transect", adopted: "DateAdopted" },
    ...base,
    // Sweep 2026-11-01: 33,105 polygons; PolicyCode / PolicyDesc / Transect / DateAdopted; the Elm Hill Pike site reads "CO" (Conservation). NOT re-measured here — maps.nashville.gov is refused by this build environment's
    // egress and the relay allow-list entry only exists once this commit deploys; the PR preview's relay is the first place it can be read (V2115889).
  },
};

/* Every row's real coverage is one county — a "local" fixture class (≥2 points, ≥2 km apart), not the state class a Tennessee scope implies. */
const COUNTY_ONLY = (what) => ["local", `${what} — Davidson County only; probing it in Memphis or Knoxville would assert a guaranteed zero.`];
export const NASHVILLE_FIXTURE_REACH = Object.fromEntries(Object.keys(NASHVILLE_SOURCES).map((k) => [k, COUNTY_ONLY(NASHVILLE_SOURCES[k].label)]));
