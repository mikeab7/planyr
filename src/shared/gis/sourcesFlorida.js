/* NEW-1 (Florida, B2452976, 2026-10-29) — THE FLORIDA DUE-DILIGENCE ROWS of the GIS source registry, spread into `GIS_SOURCES` (sources.js).
 *
 * WHY A SEPARATE FILE: Florida adds ~25 endpoint facts at once, and sibling state sessions edit `sources.js` in parallel; a block of its own
 * keeps every one of those merges additive. The fixtures / docs / reach overrides that go with these rows live in `sourceFixturesFlorida.js`
 * (the same app-bundle split `sourceFixtures.js` documents).
 *
 * EVERY ROW HERE IS AN AGENCY'S OWN PUBLICATION, probed 2026-10-29: either on an ArcGIS Online org the agency owns (CORS-open, read directly),
 * or on the agency's own ArcGIS Server (FDEP, SFWMD, FWC, Broward County) — hosts this build sandbox cannot reach, so they are reached through the
 * same-origin /gis-proxy relay (functions/gis-proxy) and were MEASURED through planyr.io before being wired. Where a state agency hosts a COPY of
 * someone else's data the row says so in `provider`. Nothing is a scraped or consultant-hosted copy.
 *
 * `relay: true` marks a row whose layer URL is `/gis-proxy/<host>/…` (the registry `serviceUrl` stays the agency's real https URL so the weekly
 * verifier and the audit read the true endpoint; the layer row rewrites it through `relayUrl`).
 */
const FL = (key, o) => ({ key, layerId: null, coverage: "florida", states: ["FL"], tier: "production", lastVerified: "2026-10-29", ...o });

export const FLORIDA_SOURCES = {
  /* ── Jurisdictions ───────────────────────────────────────────────────────────────────────────── */
  countyFl: FL("countyFl", {
    label: "County boundaries (Florida)",
    provider: "Florida Division of Emergency Management (FDEM) — statewide counties",
    serviceUrl: "https://services.arcgis.com/3wFbqsFPLeKqOlIK/arcgis/rest/services/Counties_Hosted/FeatureServer/5",
    geometryType: "polygon",
    fields: { name: "NAME", fips: "FIPS" },
  }),
  cityFl: FL("cityFl", {
    label: "City limits (Florida)",
    provider: "UF GeoPlan Center / Florida Dept. of Revenue — city limits compiled from the 2021 county tax rolls (hosted by FWC)",
    serviceUrl: "https://services2.arcgis.com/z6TmTIyYXEYhuNM0/arcgis/rest/services/par_citylm_2021/FeatureServer/0",
    geometryType: "polygon",
    fields: { name: "NAME", county: "COUNTY" },
    fullPurposeOnly: true,
  }),
  wmdFl: FL("wmdFl", {
    label: "Water management districts (Florida)",
    provider: "South Florida Water Management District — hosting FDEP's boundary of the five Florida water management districts",
    serviceUrl: "https://services1.arcgis.com/sDAPyc2rGRn7vf9B/arcgis/rest/services/BDWMD_Boundary_Area/FeatureServer/0",
    geometryType: "polygon",
    fields: { name: "WMDNAME" },
  }),

  /* ── Flood & drainage ────────────────────────────────────────────────────────────────────────── */
  drainageBroward: FL("drainageBroward", {
    label: "Drainage districts (Broward County)",
    provider: "Broward County Natural Resources Planning and Management Division",
    serviceUrl: "https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/DrainageDistricts/FeatureServer/0",
    geometryType: "polygon",
    fields: { name: "LABELNAME" },
    coverage: "broward",
  }),
  evacZonesFl: FL("evacZonesFl", {
    label: "Hurricane evacuation zones (Florida)",
    provider: "Florida Division of Emergency Management — Know Your Zone evacuation zones",
    serviceUrl: "https://services.arcgis.com/3wFbqsFPLeKqOlIK/arcgis/rest/services/KYZ_ZL_Vector_Enriched_Calculated_20230608/FeatureServer/46",
    geometryType: "polygon",
    fields: { zone: "EZone", county: "County_Nam" },
  }),

  /* ── Access ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  sisHighwaysFl: FL("sisHighwaysFl", {
    label: "Strategic Intermodal System highways (Florida)",
    provider: "Florida Department of Transportation — Transportation Data and Analytics Office",
    serviceUrl: "https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/SISHighway_SIO/FeatureServer/0",
    geometryType: "line",
    fields: { facility: "FACILITY", type: "SISTYPE_DE", county: "COUNTY" },
  }),

  /* ── Environmental & hazards ─────────────────────────────────────────────────────────────────── */
  wellfieldBroward: FL("wellfieldBroward", {
    label: "Wellfield protection zones (Broward County)",
    provider: "Broward County Pollution Prevention, Remediation and Air Quality Division",
    serviceUrl: "https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/WellfieldProtectionZones/FeatureServer/0",
    geometryType: "polygon",
    fields: { zone: "ZONE", wellfield: "LABEL", permit: "PERMIT_NO" },
    coverage: "broward",
  }),
  wellfieldMdc: FL("wellfieldMdc", {
    label: "Wellfield protection areas (Miami-Dade County)",
    provider: "Miami-Dade County (Regulatory and Economic Resources)",
    serviceUrl: "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/WellFieldProtectionArea_gdb/FeatureServer/0",
    geometryType: "polygon",
    fields: { travel: "TRAVELTIME", wellfield: "NAME" },
    coverage: "miamidade",
  }),
  erpSfwmd: FL("erpSfwmd", {
    label: "Approved Environmental Resource Permits (SFWMD)",
    provider: "South Florida Water Management District — Regulation permitting system",
    serviceUrl: "https://services1.arcgis.com/sDAPyc2rGRn7vf9B/arcgis/rest/services/Approved_Environmental_Resource_Permits/FeatureServer/16",
    geometryType: "polygon",
    fields: { project: "PROJECT_NAME", permit: "PERMIT_NO", type: "PermitType", status: "PermitStatus", issued: "IssueDate", link: "Link" },
    coverage: "sfwmd",
  }),
  conservationLandsFl: FL("conservationLandsFl", {
    label: "Conservation lands (Florida)",
    provider: "Florida Natural Areas Inventory (FNAI) — Florida Conservation Lands",
    serviceUrl: "https://services.arcgis.com/9Jk4Zl9KofTtvg3x/arcgis/rest/services/FL_Conservation_Lands_web/FeatureServer/9",
    geometryType: "polygon",
    fields: { name: "MANAME", manager: "MANAGING_A", owner: "OWNER", acres: "TOTACRES" },
  }),
  wetlandsBroward: FL("wetlandsBroward", {
    label: "Wetlands (Broward County)",
    provider: "Broward County Environmental Protection and Growth Management — Aquatic and Wetland Resources",
    serviceUrl: "https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/AWR_Wetlands_noDER/FeatureServer/10",
    geometryType: "polygon",
    fields: { acres: "ACRESGIS" },
    coverage: "broward",
  }),
  naturalLandsBroward: FL("naturalLandsBroward", {
    label: "Protected natural lands (Broward County)",
    provider: "Broward County Natural Resources Planning and Management Division — Land Stewardship Program",
    serviceUrl: "https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/Open_Data_Broward_Protected_Natural_Lands/FeatureServer/0",
    geometryType: "polygon",
    fields: { name: "NAME", owner: "OWNER", manager: "MNGMTAUTHO", mechanism: "PRESMECHAN" },
    coverage: "broward",
  }),
};

/* Rows whose real coverage is one county / district, not the state: the fixture-reach audit asks 2 points ≥ 15 km apart instead of 3 ≥ 200 km (every one carries its reason). */
export const FLORIDA_FIXTURE_REACH = {
  drainageBroward: ["regional", "Broward County's drainage districts cover Broward only; fixtures probe two districts ~25 km apart."],
  wellfieldBroward: ["regional", "Broward County's wellfield zones cover Broward only; fixtures probe Sunrise and Hollywood (~19 km)."],
  wellfieldMdc: ["regional", "Miami-Dade County's wellfield areas cover Miami-Dade only; fixtures probe the northwest and south wellfield belts (~22 km)."],
  erpSfwmd: ["regional", "SFWMD's permits cover its 16-county district only; fixtures probe the Gold Coast, Palm Beach and Lee County (all inside it, well over 15 km apart)."],
  wetlandsBroward: ["regional", "Broward County's wetland map covers Broward only; fixtures probe Pembroke Pines and Coral Springs (~36 km)."],
  naturalLandsBroward: ["regional", "Broward County's natural-lands inventory covers Broward only; fixtures probe Tradewinds Park and Weston (~29 km)."],
};
