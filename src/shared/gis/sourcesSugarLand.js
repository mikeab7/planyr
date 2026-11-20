/* NEW-1 (City of Sugar Land layers, 2026-11-02) — THE SUGAR LAND GIS REGISTRY ROWS.
 *
 * Every row is `states: ["TX"]`, production tier, probed 2026-11-02. Spread into `GIS_SOURCES` (sources.js) — one line there — so this block does not share a patch hunk with any other
 * state's rows. Fixtures and notes live in `sourceFixturesSugarLand.js` (off the app bundle, same rule as every other row).
 *
 * TWO WAYS IN, both MEASURED:
 *   · the city's ArcGIS Online org (services1.arcgis.com/SVtsrBXEiBhI5L5n) — public, CORS-open, read straight from the browser;
 *   · the city's own ArcGIS Server 10.91 (interactivemaps.sugarlandtx.gov/512) — no CORS header, and the build sandbox's egress refuses it, so `relay: true` rows are read through the same-origin
 *     /gis-proxy relay (the host is on its ALLOWED_HOSTS) and were measured on the PR preview. `serviceUrl` stays the city's real https address (the drift verifier reads it directly).
 *
 * The layer rows in lib/sugarLandLayers.js read their URL and `where` from here, so the two cannot disagree. What the city does NOT publish (and which layers were looked at and left out,
 * with the reason for each) is the header of lib/sugarLandLayers.js and backlog item NEW-1. */

const SL_ORG = "https://services1.arcgis.com/SVtsrBXEiBhI5L5n/arcgis/rest/services";
const SL_CITY = "https://interactivemaps.sugarlandtx.gov/512/rest/services";
/* NEW-1 (2026-11-06) — the water and sewer network: CDM Smith's public copy for the city (item owner seetoner_CDMSmith), a DIFFERENT ArcGIS Online org from the city's own. CORS-open, no token. */
const SL_IWRP = "https://services1.arcgis.com/VVapzOPgBae5joyC/arcgis/rest/services/CityofSugarLand/FeatureServer";
const base = { states: ["TX"], coverage: "sugarland", tier: "production", lastVerified: "2026-11-02", layerId: null };
const iwrp = { ...base, lastVerified: "2026-11-06" };

export const SUGARLAND_SOURCES = {
  slThoroughfare: {
    key: "slThoroughfare", label: "Master Thoroughfare Plan (City of Sugar Land)", provider: "City of Sugar Land — Planning (Master Thoroughfare Plan, Ordinance 2167)",
    serviceUrl: `${SL_CITY}/Planning/Master_Thoroughfare_Plan/MapServer/0`, relay: true, geometryType: "line",
    fields: { name: "FULL_STREET_NAME", cls: "FUNCTIONAL_CLASS", section: "SECTION_TYPE", planned: "RECOMMENDED_SECTION", section2035: "SECTION_2035", lanes: "LANE_NUMBER", life: "LIFE_CYCLE" },
    where: "FUNCTIONAL_CLASS IN ('FRWY','STATE','ARTERIAL','MAJ COLL','MIN COLL') AND (LIFE_CYCLE IS NULL OR LIFE_CYCLE <> 'Retired')",
    ...base,
    // Live 2026-11-02 (through the relay): 9,092 segments in all · 3,286 classed (FRWY 221 · STATE 335 · ARTERIAL 821 · MAJ COLL 806 · MIN COLL 1,103 less the blanks) · 2 retired · 3,284 drawn.
  },
  slZoning: {
    key: "slZoning", label: "Zoning districts (City of Sugar Land)", provider: "City of Sugar Land — Planning (zoning districts)",
    serviceUrl: `${SL_CITY}/Zoning_GWNT/MapServer/0`, relay: true, geometryType: "polygon",
    fields: { code: "Zone_Label", definition: "ZONE_DEF", ordinance: "ORD_NO", date: "DATE_", previous: "OLDZN", pdf: "PDF_Link" },
    ...base,
    // Live 2026-11-02: 339 polygons. Interactive_Map/Zoning_Districts_Map/MapServer/2 holds the SAME 339 records but its /query returns no geometry (attributes only), so the drawn copy is this one.
  },
  slAirportZoning: {
    key: "slAirportZoning", label: "Airport zoning (City of Sugar Land)", provider: "City of Sugar Land — Planning (Sugar Land Regional Airport zoning)",
    serviceUrl: `${SL_CITY}/Planning/Airport_Zoning/MapServer/0`, relay: true, geometryType: "polygon",
    fields: { type: "TYPE" },
    ...base,
    // Live 2026-11-02: 8 polygons — AZ-01 ×1, AZ-02 ×2, ANID ×1, AVIGATION EASEMENT ×3, AIRPORT PROPERTY ×1.
  },
  slFlu: {
    key: "slFlu", label: "Future land use (City of Sugar Land, 2022)", provider: "City of Sugar Land — Planning (Future Land Use Map, Ordinance 2263)",
    serviceUrl: `${SL_ORG}/Future_Land_Use_Map_2022_WFL1/FeatureServer/8`, geometryType: "polygon",
    fields: { landUse: "FUTURE_LAND_USE", area: "SUBREGION" },
    ...base,
    // Live 2026-11-02: 20 polygons — the full classification (layers 1-6 are highway symbols, a future-roadway pair, schools, railroads, ETJ-release notes and water; layer 7 is the same data plus a test polygon).
  },
  slHydrants: {
    key: "slHydrants", label: "Fire hydrants (City of Sugar Land)", provider: "City of Sugar Land — Utilities (hydrant inspection layer)",
    serviceUrl: `${SL_ORG}/COSLHydrantInspections_FeatureService/FeatureServer/0`, geometryType: "point",
    fields: { id: "FacilityID", installed: "InstallDate" },
    where: "LifecycleStatus IS NULL OR LifecycleStatus = 'Active'",
    ...base,
    // Live 2026-11-02: 5,919 hydrants (5,743 Active · 72 blank · 98 Removed · 6 Abandoned). Layer last edited 2021-02-23. Only the id and install date are ever requested — the other fields carry editor names and work orders.
  },
  slCups: {
    key: "slCups", label: "Conditional use permits (City of Sugar Land)", provider: "City of Sugar Land — Planning (conditional use permits)",
    serviceUrl: `${SL_ORG}/Overlays/FeatureServer/0`, geometryType: "polygon",
    fields: { project: "Project_Na", request: "Descriptio", approved: "Date_Appro", ordinance: "Ordinance", district: "District", category: "Category" },
    ...base,
    // Live 2026-11-02: 69 permits, 1998-05-05 to 2024-11-05. The city's own Planning/CUPs service holds the same 69; the org copy is CORS-open, so it is the one read.
  },
  slSpecialExceptions: {
    key: "slSpecialExceptions", label: "Special exceptions (City of Sugar Land)", provider: "City of Sugar Land — Planning (special exceptions)",
    serviceUrl: `${SL_ORG}/Overlays/FeatureServer/1`, geometryType: "polygon",
    fields: { caseNo: "Case_No_", date: "DATE_", district: "ZONING_DIS", request: "REQUEST", action: "ACTION", result: "RESULT" },
    ...base,
    // Live 2026-11-02: 244 cases, newest 2024-01-17; same count and dates as the city's Planning/Special_Exceptions.
  },
  slVariances: {
    key: "slVariances", label: "Variances (City of Sugar Land)", provider: "City of Sugar Land — Planning (variances)",
    serviceUrl: `${SL_ORG}/Overlays/FeatureServer/2`, geometryType: "polygon",
    fields: { caseNo: "CASE_NO", date: "DATE", district: "ZONING_DIS", request: "REQUEST", action: "ACTION", result: "RESULT" },
    ...base,
    // Live 2026-11-02: 160 cases, newest 2016-10-19; same count and dates as the city's Planning/Variances.
  },
  slCip: {
    key: "slCip", label: "Capital projects (City of Sugar Land, 2024 list)", provider: "City of Sugar Land — Engineering (Capital Improvement Program, 2024 public edition)",
    serviceUrl: `${SL_ORG}/CIPDatabase2024_Public/FeatureServer/6`, geometryType: "polygon",
    fields: { title: "Title", phase: "Phase", status: "Status", budget: "Budget" },
    where: "Status IN ('In Progress','Initiated','Future','ON HOLD')",
    ...base,
    // Live 2026-11-02: 334 project polygons · 247 not yet closed out (Future 133 · In Progress 90 · Initiated 16 · ON HOLD 8). The manager, engineer, contractor and inspector fields are never requested.
  },
  slRowLand: {
    key: "slRowLand", label: "Public right-of-way and land (City of Sugar Land)", provider: "City of Sugar Land — GIS (ROW and Property, Public Entities)",
    serviceUrl: `${SL_CITY}/ROW_and_Property_Public_Entities/MapServer/0`, relay: true, geometryType: "polygon",
    fields: { owner: "OWNERNAME", address: "SITUS", type: "PARCELTYPE", acres: "LANDSIZEAC" },
    ...base,
    // Live 2026-11-02: 6,448 polygons (RoadROW 1,620 of the first 2,000 · Parcel · Reserve · Easement); owners are public entities (Fort Bend County, the City, the State, TxDOT, neighbouring cities, ISDs).
  },
  slTirz: {
    key: "slTirz", label: "Tax increment reinvestment zones (City of Sugar Land)", provider: "City of Sugar Land — Economic Development (TIRZ boundaries)",
    serviceUrl: `${SL_ORG}/TIRZ/FeatureServer/0`, geometryType: "polygon",
    fields: { name: "NAME", notes: "TIRZNOTES", acres: "ACRES" },
    ...base,
    // Live 2026-11-02: 4 zones (TIRZ 1, 2 inactive, 3 Imperial, 4). Layer edited 2026-04-30.
  },
  slAvailableSites: {
    key: "slAvailableSites", label: "Available sites (City of Sugar Land)", provider: "City of Sugar Land — Economic Development (available sites)",
    serviceUrl: `${SL_ORG}/EcoDev_Available_Sites_VIEW/FeatureServer/0`, geometryType: "polygon",
    fields: { name: "Name", type: "Property_Type", owner: "Ownership", acres: "acres" },
    ...base,
    // Live 2026-11-02: 23 sites. Layer last edited 2022-05-11.
  },
  slDevProjects: {
    key: "slDevProjects", label: "Development projects (City of Sugar Land)", provider: "City of Sugar Land — Development Services (development project tracker)",
    serviceUrl: `${SL_ORG}/Development_Projects_(City_Wide)_view_layer/FeatureServer/0`, geometryType: "polygon",
    fields: { name: "Project_Name", address: "Address", status: "Status", start: "Construction_Start", done: "Completion_Date", estimated: "Estimated_Completion" },
    ...base,
    // Live 2026-11-02: 47 projects (29 In Progress · 18 Completed), edited 2026-10-09. The contractor / superintendent names, phones and emails in the layer are never requested.
  },
  /* ---- Water and sewer network (NEW-1, 2026-11-06) — see lib/sugarLandUtilities.js for the date story: every layer's newest install date is Jan 2017; the layers' own edit dates are 2021-11-10 (most), 2025-11-20 (Pressurized Main), 2025-12-23 (Gravity Main). ---- */
  slWaterLines: {
    key: "slWaterLines", label: "Water mains (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (IWRP - Pressurized Main)",
    serviceUrl: `${SL_IWRP}/17`, geometryType: "line",
    fields: { size: "Diameter", material: "Material", water: "WaterType", status: "LifecycleS", installed: "InstallDat", operator: "Administra" },
    where: "(LifecycleS IS NULL OR LifecycleS <> 'Removed')",
    ...iwrp,
    // Live 2026-11-06: 32,175 mains (Active 31,548 · Abandoned 563 · Removed 3 · blank 61); WaterType Potable 31,846 + "Potable Water" 55 · Raw 143 · Reclaimed 4 · chemical feed 36. Layer last edited 2025-11-20; newest InstallDat 2017-01-27. Layer 27 (Surface Water Transmission Line, 91) is a subset (89 of 91 ASSETIDs are here).
  },
  slSewerGravity: {
    key: "slSewerGravity", label: "Gravity sewer mains (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (IWRP - Gravity Main)",
    serviceUrl: `${SL_IWRP}/20`, geometryType: "line",
    fields: { size: "NominalDia", material: "Material", status: "LifecycleS", installed: "InstallDat", operator: "Administra" },
    where: "(LifecycleS IS NULL OR LifecycleS NOT IN ('Removed','Proposed')) AND (WaterType IS NULL OR WaterType <> 'Storm')",
    ...iwrp,
    // Live 2026-11-06: 16,049 mains (Active 16,032 · Abandoned 12 · Proposed 3 · …); 11 are typed WaterType Storm and left out. Layer last edited 2025-12-23; newest InstallDat 2017-01-27.
  },
  slSewerLaterals: {
    key: "slSewerLaterals", label: "Sewer laterals (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (IWRP - Lateral Line)",
    serviceUrl: `${SL_IWRP}/19`, geometryType: "line",
    fields: { size: "Diameter", material: "Material", status: "LifecycleS", installed: "InstallDat", operator: "Administra" },
    ...iwrp,
    // Live 2026-11-06: 8,260 laterals (mostly 6 in, ~57 ft long). Layer last edited 2021-11-10; newest InstallDat 2017-01-27.
  },
  slSewerForce: {
    key: "slSewerForce", label: "Sewer force mains (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (IWRP - Pressurized Mains)",
    serviceUrl: `${SL_IWRP}/18`, geometryType: "line",
    fields: { size: "Diameter", material: "Material", status: "LifecycleS", installed: "InstallDat", operator: "Administra" },
    where: "(LifecycleS IS NULL OR LifecycleS <> 'Removed')",
    ...iwrp,
    // Live 2026-11-06: 189 lines, every one WaterType Sewage (this is the SEWER pressure layer — the water pressure mains are layer 17). Layer last edited 2021-11-10; newest InstallDat 2017-03-02.
  },
  slWaterValves: {
    key: "slWaterValves", label: "Water system valves (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (IWRP - System Valve, water)",
    serviceUrl: `${SL_IWRP}/2`, geometryType: "point",
    fields: { size: "Diameter", status: "LifecycleS", installed: "InstallDat", id: "ASSETID" },
    ...iwrp,
    // Live 2026-11-06: 14,648 valves. Layer last edited 2021-11-10; newest InstallDat 2017-01-27.
  },
  slWaterControlValves: {
    key: "slWaterControlValves", label: "Water control valves (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (IWRP - Control Valve, water)",
    serviceUrl: `${SL_IWRP}/9`, geometryType: "point",
    fields: { size: "Diameter", status: "LifecycleS", installed: "InstallDat", id: "ASSETID" },
    ...iwrp,
    // Live 2026-11-06: 51 control valves.
  },
  slManholes: {
    key: "slManholes", label: "Sewer manholes (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (IWRP - Manhole)",
    serviceUrl: `${SL_IWRP}/13`, geometryType: "point",
    fields: { status: "LifecycleS", installed: "InstallDat", id: "ASSETID" },
    ...iwrp,
    // Live 2026-11-06: 15,135 manholes. Layer last edited 2021-11-10; newest InstallDat 2017-01-27.
  },
  slCleanouts: {
    key: "slCleanouts", label: "Sewer clean-outs (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (IWRP - Clean Out)",
    serviceUrl: `${SL_IWRP}/16`, geometryType: "point",
    fields: { status: "LifecycleS", installed: "InstallDat", id: "ASSETID" },
    ...iwrp,
    // Live 2026-11-06: 1,065 clean-outs.
  },
  slLiftStations: {
    key: "slLiftStations", label: "Sewer lift stations (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (Lift Stations)",
    serviceUrl: `${SL_IWRP}/23`, geometryType: "point",
    fields: { name: "BUILDING_N", address: "LOCATION", status: "LIFE_CYCLE" },
    ...iwrp,
    // Live 2026-11-06: 116 points (114 LS · 2 WWTP). Layer last edited 2021-11-10.
  },
  slWwtp: {
    key: "slWwtp", label: "Wastewater treatment plants (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (WWTP)",
    serviceUrl: `${SL_IWRP}/22`, geometryType: "point",
    fields: { name: "BUILDING_N", status: "LIFE_CYCLE" },
    ...iwrp,
    // Live 2026-11-06: 5 plants (the Latitude / Longitude attributes read 0; the GEOMETRY is correct, all 5 inside Sugar Land).
  },
  slWaterPlants: {
    key: "slWaterPlants", label: "Water plants (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (Water Plant Facilities)",
    serviceUrl: `${SL_IWRP}/21`, geometryType: "point",
    fields: { name: "Name", status: "LifecycleS", installed: "InstallDat" },
    ...iwrp,
    // Live 2026-11-06: 78 facilities. Layer last edited 2021-11-10.
  },
  slWaterWells: {
    key: "slWaterWells", label: "Water production wells (City of Sugar Land, CDM Smith copy)", provider: "CDM Smith for the City of Sugar Land (IWRP - Production Wells)",
    serviceUrl: `${SL_IWRP}/4`, geometryType: "point",
    fields: { name: "Name", water: "WaterType", status: "LifecycleS", installed: "InstallDat" },
    ...iwrp,
    // Live 2026-11-06: 22 wells.
  },
};

/* Every row's real coverage is one city (plus its ETJ) — a "local" fixture class (≥2 points, ≥2 km apart), not the state class a Texas scope implies. */
const CITY_ONLY = (what) => ["local", `${what} — the City of Sugar Land only; probing it in Dallas or Houston would assert a guaranteed zero.`];
export const SUGARLAND_FIXTURE_REACH = Object.fromEntries(Object.keys(SUGARLAND_SOURCES).map((k) => [k, CITY_ONLY(SUGARLAND_SOURCES[k].label)]));
