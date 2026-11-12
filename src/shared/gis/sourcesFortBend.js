/* NEW-1 (Fort Bend County layers, 2026-11-12) — THE FORT BEND COUNTY GIS REGISTRY ROWS.
 *
 * Every row is `states: ["TX"]`, production tier, probed 2026-11-12 against the county's PUBLIC ArcGIS Server (gisportal.fortbendcountytx.gov, 11.3). Spread into `GIS_SOURCES` (sources.js)
 * with one line so this block does not share a patch hunk with any other region's rows. Fixtures and notes live in `sourceFixturesFortBend.js` (off the app bundle, same rule as every other row).
 *
 * THE HOST IS CORS-OPEN (measured 2026-11-12: `access-control-allow-origin` echoes the page origin on the layer JSON, the OPTIONS preflight and /query), so every row is read straight from the
 * browser — nothing rides the /gis-proxy relay. The SERVICE PATHS are not the ones the weekly sweep first reported: the public copies live under `InteractiveMap/` (`Boundaries_Public`,
 * `Transportation_Public`, `Water_Districts_Public`); the root folders `Boundaries`, `WaterDistricts`, `ThoroughfarePlan` and `Parcels` answer 499 "Token Required" and are never read.
 *
 * WHAT IS NOT HERE, and why (each measured): Municipal Utility Districts (`Water_Districts_Public/1`), WCIDs (`/3`), FWSDs (`/4`) and Drainage Districts (`/5`) — the TCEQ water-district row
 * (`jur_mud`) already draws them statewide; the county's Streams (`Drainage_Public/4`, the NHD-fed channel row covers it); the Major Thoroughfare Plan's EXISTING roadways (`/3`, 1,429 segments of
 * classification the TxDOT road row already carries). */

const FB = "https://gisportal.fortbendcountytx.gov/arcgis/rest/services";
const base = { states: ["TX"], coverage: "fortbend", tier: "production", lastVerified: "2026-11-12", layerId: null };

export const FORTBEND_SOURCES = {
  fbLid: {
    key: "fbLid", label: "Levee Improvement Districts (Fort Bend County)", provider: "Fort Bend County — GIS (Water Districts: Levee Improvement Districts)",
    serviceUrl: `${FB}/InteractiveMap/Water_Districts_Public/MapServer/2`, geometryType: "polygon",
    fields: { name: "LID_NAME", tceq: "TCEQ_ID", operator: "OPERATOR", engineer: "ENGINEER_FIRM", status: "STATUS", modified: "DATE_MODIFIED" },
    ...base,
    // Live 2026-11-12: 15 polygons (STATUS A). (-95.62, 29.58) → "Fort Bend LID #2"; Sienna LID, First Colony LID and LID #2 in the same county.
  },
  fbLevees: {
    key: "fbLevees", label: "Levees (Fort Bend County Drainage District)", provider: "Fort Bend County Drainage District — Drainage (levee centerlines, FEMA levee schema)",
    serviceUrl: `${FB}/Drainage/Drainage_Public/MapServer/5`, geometryType: "line",
    fields: { id: "LEVEE_ID", name: "LEVEE_NM", water: "WTR_NM", status: "LEVEE_STAT", owner: "OWNER", pl8499: "PL84_99TF", type: "LEVEE_TYP", built: "CONST_DATE", source: "SOURCE_CIT" },
    ...base,
    // Live 2026-11-12: 56 rows, 28 distinct LEVEE_IDs — rows 49–76 repeat rows 1–28 exactly, so the card dedupes on LEVEE_ID. LEVEE_STAT is 'NP' (not provided) on 26 of the 28 and 'Accredited' on the two Pecan Grove
    // segments; FREEBOARD is -8888 (no value) everywhere and CONST_DATE a year-9999 placeholder — neither is ever shown.
  },
  fbBrazosInundation: {
    key: "fbBrazosInundation", label: "Brazos River 100-year inundation (Fort Bend County Drainage District study)", provider: "Fort Bend County Drainage District — Brazos River 100-year inundation study",
    serviceUrl: `${FB}/Drainage/Drainage_Public/MapServer/8`, geometryType: "polygon",
    fields: {},
    ...base,
    // Live 2026-11-12: 2 polygons spanning the whole Brazos corridor (extent -96.26..-95.33 × 28.89..30.24, past the county on both ends); Range_Min / Range_Max are blank on both, so no attribute is ever shown.
  },
  fbBrazosFloodplain: {
    key: "fbBrazosFloodplain", label: "Brazos River 55-foot floodplain (Fort Bend County Drainage District study)", provider: "Fort Bend County Drainage District — Brazos River floodplain study (55 ft)",
    serviceUrl: `${FB}/Drainage/Drainage_Public/MapServer/9`, geometryType: "polygon",
    fields: { zone: "FLD_ZONE", source: "SOURCE_CIT" },
    ...base,
    // Live 2026-11-12: 492 polygons, every one FLD_ZONE 'AE' / SOURCE_CIT 'STUDY1'; STATIC_BFE and DEPTH read -9999 (no value). Extent -96.07..-95.47 × 29.29..29.73.
  },
  fbTirz: {
    key: "fbTirz", label: "Tax increment reinvestment zones (Fort Bend County)", provider: "Fort Bend County — GIS (Boundaries: TIRZ)",
    serviceUrl: `${FB}/InteractiveMap/Boundaries_Public/MapServer/11`, geometryType: "polygon",
    fields: { name: "NAME", notes: "NOTES", entity: "ENTITYCODE" },
    ...base,
    // Live 2026-11-12: 29 zones ("C06 TIRZ 1" = the city numbered 06's first zone — the county's own code, not a city name).
  },
  fbMmd: {
    key: "fbMmd", label: "Management districts (Fort Bend County)", provider: "Fort Bend County — GIS (Boundaries: Management Districts)",
    serviceUrl: `${FB}/InteractiveMap/Boundaries_Public/MapServer/13`, geometryType: "polygon",
    fields: { name: "MMD_NAME", tceq: "TCEQ_ID", status: "STATUS", modified: "DATE_MODIFIED" },
    ...base,
    // Live 2026-11-12: 13 districts (First Colony, Sienna Plantation, International, Fort Bend County MMD #1, …). The point-of-contact name, title and phone and the law firm are never requested.
  },
  fbDevAgreements: {
    key: "fbDevAgreements", label: "Development agreements (Fort Bend County)", provider: "Fort Bend County — GIS (Boundaries: Development Agreements)",
    serviceUrl: `${FB}/InteractiveMap/Boundaries_Public/MapServer/9`, geometryType: "polygon",
    fields: { subdivision: "SUBDIVISION", road: "AFFECTED_ROAD", developer: "DEVELOPER", type: "TYPE", status: "STATUS" },
    ...base,
    // Live 2026-11-12: 48 agreements (Active / Complete). Types are the county's own wording: Phased-Dedication and Construction, Phased-Contribution, Deferred-Contribution, Delayed-Dedication and Construction, Shared-Construction and Contribution, …
  },
  fbMtpProposed: {
    key: "fbMtpProposed", label: "Major Thoroughfare Plan — proposed roadways (Fort Bend County)", provider: "Fort Bend County — Engineering (Major Thoroughfare Plan, proposed roadways)",
    serviceUrl: `${FB}/InteractiveMap/Transportation_Public/MapServer/4`, geometryType: "line",
    fields: { name: "FULL_NAME", rdName: "RD_NAME", city: "CITY", cls: "ROAD_CLA_1", modified: "DATE_MODIF" },
    ...base,
    // Live 2026-11-12: 339 segments (ROAD_CLA_1 'PROPOSED'; LANES reads 0 on the ones sampled, so no lane count is shown). Cities: Rosenberg, Richmond, Fulshear, … or blank (unincorporated).
  },
};

/* The county's own layers have no business in Dallas or Harris County — a "local" fixture class (≥2 points, ≥2 km apart), not the state class a Texas scope implies. */
const COUNTY_ONLY = (what) => ["local", `${what} — Fort Bend County only; probing it in Dallas or Houston would assert a guaranteed zero.`];
export const FORTBEND_FIXTURE_REACH = Object.fromEntries(Object.keys(FORTBEND_SOURCES).map((k) => [k, COUNTY_ONLY(FORTBEND_SOURCES[k].label)]));
