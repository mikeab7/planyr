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

  udbMdc: FL("udbMdc", {
    label: "Urban Development Boundary (Miami-Dade County)",
    provider: "Miami-Dade County (Regulatory and Economic Resources)",
    serviceUrl: "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/UrbanDevelopmentBoundary_gdb/FeatureServer/0",
    geometryType: "line",
    fields: {},
    coverage: "miamidade",
  }),

  /* ── Rows reached through the /gis-proxy relay (the agency's own server; MEASURED through planyr.io's preview before wiring, 2026-10-29) ───────────────── */
  canalsSfwmd: FL("canalsSfwmd", {
    label: "Canals and streams (SFWMD)",
    provider: "South Florida Water Management District — AHED hydrography (canals and streams)",
    serviceUrl: "https://geoweb.sfwmd.gov/agsext1/rest/services/WaterManagementSystem/Canals/FeatureServer/5",
    geometryType: "line", relay: true,
    fields: { name: "NAME", owner: "OWNER", operator: "OPER_MAINT" },
    coverage: "sfwmd",
  }),
  rowPermitsSfwmd: FL("rowPermitsSfwmd", {
    label: "Canal and levee right-of-way permits (SFWMD)",
    provider: "South Florida Water Management District — Regulation (Right of Way and Right of Way Occupancy permits)",
    serviceUrl: "https://geoweb.sfwmd.gov/agsext1/rest/services/Regulation_RightOfWayPermit/Rights_of_Way_Permits/FeatureServer/0",
    geometryType: "polygon", relay: true,
    fields: { permit: "PERMIT_NO", permittee: "PERMITEE", works: "PROJECT_WORKS", use: "AUTHORIZATION_", issued: "DATE_ISSUED" },
    coverage: "sfwmd",
  }),
  conEasementsSfwmd: FL("conEasementsSfwmd", {
    label: "Conservation easements (SFWMD)",
    provider: "South Florida Water Management District — Regulation (conservation easements)",
    serviceUrl: "https://geoweb.sfwmd.gov/agsext1/rest/services/Regulation_ApplicationPermits/Reg_Conservation_Easement/FeatureServer/12",
    geometryType: "polygon", relay: true,
    fields: { type: "CE_TYPE_DESC", permit: "REG_PERMIT_NO", grantor: "GRANTOR", recorded: "RECORDED_DATE", acres: "RECORDED_ACRES", county: "COUNTY" },
    coverage: "sfwmd",
  }),
  cleanupFl: FL("cleanupFl", {
    label: "Contamination sites (Florida DEP)",
    provider: "Florida Department of Environmental Protection — Contamination Locator Map (DEP Cleanup Sites)",
    serviceUrl: "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/CLEANUP_SP/MapServer/0",
    geometryType: "point", relay: true,
    fields: { name: "BUSINESS_NAME", address: "ADDRESS1", city: "CITY", category: "CLCC_CLEANUP_CATEGORY_KEY", status: "RSC2_REMEDIATION_STATUS_KEY" },
  }),
  brownfieldFl: FL("brownfieldFl", {
    label: "Brownfield areas (Florida DEP)",
    provider: "Florida Department of Environmental Protection — Division of Waste Management (locally designated Brownfield Areas)",
    serviceUrl: "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/BROWNFIELD_AREAS/MapServer/0",
    geometryType: "polygon", relay: true,
    fields: { name: "AREA_NAME", city: "CITY", acres: "ACREAGE", resolution: "RESOLUTION_NUMBER", resolved: "RESOLUTION_DATE" },
  }),
  icrFl: FL("icrFl", {
    label: "Institutional controls (Florida DEP)",
    provider: "Florida Department of Environmental Protection — Institutional Controls Registry",
    serviceUrl: "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/DWM_WASTE_ICR_BACKG/MapServer/12",
    geometryType: "polygon", relay: true,
    fields: { site: "PRIMARY_SITE_NAME", address: "PRIMARY_SITE_ADDRESS_LINE_1", city: "PRIMARY_SITE_CITY", restriction: "DESCRIPTION", begin: "BEGIN_DATE" },
  }),
  subsidenceFl: FL("subsidenceFl", {
    label: "Subsidence incident reports (Florida Geological Survey)",
    provider: "Florida Department of Environmental Protection — Florida Geological Survey",
    serviceUrl: "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/FGS_SUBSIDENCE/MapServer/0",
    geometryType: "point", relay: true,
    fields: { ref: "REF_NUM", county: "COUNTY", trueSink: "TRUE_SINK" },
  }),
  sinkholeAreasFl: FL("sinkholeAreasFl", {
    label: "Sinkhole type areas (Florida Geological Survey)",
    provider: "Florida Department of Environmental Protection — Florida Geological Survey",
    serviceUrl: "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/FGS_PUBLIC/MapServer/5",
    geometryType: "polygon", relay: true,
    fields: { area: "AREA_DESC", cover: "DESC_1", behaviour: "DESC_2" },
  }),
  ofwFl: FL("ofwFl", {
    label: "Outstanding Florida Waters (Florida DEP)",
    provider: "Florida Department of Environmental Protection — Division of Environmental Assessment and Restoration",
    serviceUrl: "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/OFW/MapServer/0",
    geometryType: "polygon", relay: true,
    fields: { name: "NAME", type: "TYPE", designated: "OFW_DATE" },
  }),
  pantherFl: FL("pantherFl", {
    label: "Florida panther consultation area (USFWS)",
    provider: "U.S. Fish & Wildlife Service, South Florida Ecological Services Office (hosted by Florida DEP)",
    serviceUrl: "https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/PANTHER_CONSULT_AREA/MapServer/0",
    geometryType: "polygon", relay: true,
    fields: { acres: "ACRES" },
    coverage: "southwest",
  }),
  eagleFl: FL("eagleFl", {
    label: "Bald eagle nesting areas, 1998–2017 (FWC)",
    provider: "Florida Fish and Wildlife Conservation Commission",
    serviceUrl: "https://gis.myfwc.com/hosting/rest/services/Open_Data/Eagle_Nesting_Locations_Florida_1998___2017/MapServer/14",
    geometryType: "polygon", relay: true,
    fields: { first: "MinOfSurve", last: "MaxOfSurve" },
  }),
  fllNoise: FL("fllNoise", {
    label: "Airport noise contours (Fort Lauderdale–Hollywood International)",
    provider: "Broward County Aviation Department",
    serviceUrl: "https://bcgishub.broward.org/server/rest/services/BCAD/FLLNoise2020Contours/MapServer/0",
    geometryType: "line", relay: true,
    fields: { dnl: "CONTOURVAL", name: "NAME" },
    coverage: "broward",
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
  udbMdc: ["regional", "The Urban Development Boundary exists only in Miami-Dade (32 line segments from the north county line to the south); fixtures probe its north and south reaches (~33 km apart)."],
  canalsSfwmd: ["regional", "SFWMD's canal network covers its 16-county district; fixtures are two district-sized bboxes ~60 km apart (Broward and Lee/Collier)."],
  rowPermitsSfwmd: ["regional", "SFWMD's right-of-way permits cover its district; fixtures are Broward and western Palm Beach / Glades bboxes."],
  conEasementsSfwmd: ["regional", "SFWMD's conservation easements cover its district; fixtures are Broward and Lee County bboxes."],
  pantherFl: ["regional", "USFWS's South Florida panther consultation area covers southwest Florida (Collier / Lee / Hendry / Glades / Charlotte …); fixtures probe Immokalee, LaBelle and Lehigh Acres (>15 km apart)."],
  fllNoise: ["local", "Contours exist only around Fort Lauderdale–Hollywood International (8 lines); fixtures probe two points ~5 km apart on opposite sides of the field."],
  naturalLandsBroward: ["regional", "Broward County's natural-lands inventory covers Broward only; fixtures probe Tradewinds Park and Weston (~29 km)."],
};
