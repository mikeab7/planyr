/* NEW-1 (Oklahoma screening, owner 2026-10-29) — THE OKLAHOMA GIS REGISTRY ROWS.
 *
 * Every row is `states: ["OK"]`, production tier, probed 2026-10-29. Spread into `GIS_SOURCES` (sources.js) — one line there — so this block does not
 * share a patch hunk with any other state's rows. Fixtures and notes live in `sourceFixturesOk.js` (off the app bundle, same rule as every other row).
 *
 * THREE WAYS IN, all MEASURED:
 *   · ArcGIS Online orgs the agencies run themselves (ODOT `okdot`, OWRB `OWRB`, the Cherokee Nation, the Corporation Commission's `OCCOKC`, Esri's mirror of the
 *     Census' federal files) — public, `access-control-allow-origin: *`, read straight from the browser.
 *   · The Corporation Commission (gis.occ.ok.gov), DEQ (gis.deq.ok.gov) and the Water Resources Board (owrb.csa.ou.edu) run their own ArcGIS Enterprise servers.
 *     The build sandbox's egress blocks all three (403 on CONNECT) and none sends an `Access-Control-Allow-Origin` header, so they are read through the
 *     same-origin /gis-proxy relay (functions/gis-proxy — the three hosts are in its ALLOWED_HOSTS), and their field lists, record counts and answers were
 *     MEASURED through that relay on the PR preview. `serviceUrl` stays the agency's real https address (the drift verifier reads it from CI); the layer rows in
 *     lib/oklahomaLayers.js derive their relay path from it so the two cannot disagree.
 *   · Federal files the Georgia rows already use (NPS National Register, USGS GNIS cemeteries, USFWS critical habitat), re-declared here with an Oklahoma scope.
 *
 * NOT built, with the reason (the owner asked for the list):
 *   · OCC pipelines — the Commission's PIPELINE folder answers "Token Required" (499): not public. The EIA approximations (every state but Texas) already cover OK.
 *   · OCC injection (UIC) wells / induced-seismicity areas of interest — published, but they bind disposal operators, not surface development.
 *   · OG&E / PSO transmission — no utility publishes it; HIFLD (the national power-line row) already draws Oklahoma.
 *   · American burying beetle — NE Oklahoma's headline species, but the USFWS publishes no live service for its range (only a ScienceBase download); IPaC is the authority.
 *   · Osage Mineral Estate — the Census' Osage Reservation shape (in `okTribal`) is the only public polygon; the Osage Minerals Council publishes no boundary service.
 *   · Muscogee (Creek) / Choctaw / Chickasaw / Seminole / Osage nation reservation files — the Nations' services are "limited usage" (utility.arcgis.com), a
 *     third-party university copy, or absent; the Census OTSA layer in `okTribal` covers every Nation consistently.
 *   · (Scenic Rivers and the Outstanding Resource / High Quality / Nutrient-Limited / Sensitive Water Supply watersheds ARE built — OWRB's Water Quality Standards MapServer, found by the adversarial review; an earlier draft wrongly said they were unpublished.)
 *   · Fault lines (OWRB, 26,000 lines) — published, but a geologic-map fault is not a development constraint at screening scale (the Texas growth-fault layer exists because Houston faults move; Oklahoma's mapped faults are not that).
 *   · SHPO Landmarks Inventory / archaeological sites — restricted; the National Register points (okNrhp) are the public part.
 *   · Karst / gypsum sinkholes, abandoned coal mines — the Geological Survey publishes no service; ODOT's "Coal_Mines" file states no provenance and is a 1979 vintage.
 *   · NFIP community participation (OWRB) — city POINTS only, not an area; FEMA's flood row already answers the question a site-wide lender asks.
 *   · Tier II chemical facilities, CAFOs, NPDES dischargers, biosolid sites — neighbour data of low day-one value; DEQ publishes them if a later pass wants them.
 *   · NRCS watershed dams (DEQ "OtherAgencyData") — already in the OWRB dam inventory (`okDams` carries the NRCS-built dams with their hazard class). */

const OK = (key, o) => ({ key, coverage: "oklahoma", states: ["OK"], tier: "production", lastVerified: "2026-10-29", layerId: null, ...o });

const ODOT = "https://services6.arcgis.com/RBtoEUQ2lmN0K3GY/arcgis/rest/services";
const OCC = "https://gis.occ.ok.gov/server/rest/services/Hosted";
const DEQ_LAND = "https://gis.deq.ok.gov/server/rest/services/LandWeb/MapServer";
const OWRB_STD = "https://owrb.csa.ou.edu/server/rest/services/Surface_Water/Standards/MapServer";
const DEQ_WATER = "https://gis.deq.ok.gov/server/rest/services/WaterQWeb/MapServer";
const CHEROKEE = "https://services3.arcgis.com/jmdMqrrIb2yaWJJ6/arcgis/rest/services";

export const OK_SOURCES = {
  /* ---- Jurisdictions ---- */
  okCounty: OK("okCounty", {
    label: "County boundaries (Oklahoma)",
    provider: "Oklahoma Department of Transportation (ODOT) — GIS Management Branch, County Boundaries",
    serviceUrl: `${ODOT}/County_Boundaries/FeatureServer/0`,
    geometryType: "polygon", fields: { name: "COUNTY_NAME", fips: "COUNTY_FIPS_NO" }, dataLastEdited: "2026-08-11",
  }),
  okCity: OK("okCity", {
    label: "City limits (Oklahoma)",
    provider: "Oklahoma Department of Transportation (ODOT) — GIS Management Branch, City Limits (from the Oklahoma Tax Commission)",
    serviceUrl: `${ODOT}/Cities/FeatureServer/0`,
    // The layer holds municipal limits and nothing else — one polygon, one government (the cityLimitClass rule).
    fullPurposeOnly: true,
    geometryType: "polygon", fields: { name: "CITY_NAME", pop: "POPULATION" }, dataLastEdited: "2026-10-05",
  }),
  okRoad: OK("okRoad", {
    label: "State highways & turnpikes (Oklahoma)",
    provider: "Oklahoma Department of Transportation (ODOT) — Roadways (Linear Referencing System)",
    serviceUrl: `${ODOT}/Roadways/FeatureServer/0`,
    where: "ODOTROUTECLASS IN ('I','U','S','T')", // the state-system classes only — the layer also holds ~80,000 county and city streets
    geometryType: "line", fields: { name: "STREETNAME", route: "ROUTE_ID", cls: "ODOTROUTECLASS", aadt: "AADT", maint: "MAINTENANCERESPONSIBILITY", truck: "TRUCKROUTE" }, dataLastEdited: "2026-10-26",
  }),
  okTribal: OK("okTribal", {
    label: "Tribal areas (U.S. Census, Oklahoma)",
    provider: "U.S. Census Bureau — American Indian / Alaska Native / Native Hawaiian Areas (via Esri U.S. Federal Datasets)",
    serviceUrl: "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/AIANNHA_v1/FeatureServer/0",
    // Oklahoma's rows only: the Oklahoma Tribal Statistical Areas (every name ends "OTSA", joint-use areas included), the Osage Reservation and the Shawnee trust land.
    where: "NAME LIKE '%OTSA%' OR NAME = 'Osage Reservation' OR NAME = 'Shawnee Trust Land'",
    geometryType: "polygon", fields: { name: "NAME", kind: "LSADC", legal: "FUNCSTAT" }, dataLastEdited: "2026-10-28",
  }),
  okCherokeeRes: OK("okCherokeeRes", {
    label: "Cherokee Nation reservation (Cherokee Nation)",
    provider: "Cherokee Nation — Cherokee Nation Reservation (published by the Nation on its ArcGIS Online org)",
    serviceUrl: `${CHEROKEE}/Cherokee_Nation_Reservation/FeatureServer/0`,
    geometryType: "polygon", fields: { acres: "Acres" }, dataLastEdited: "2026-09-24",
  }),
  okCherokeeLand: OK("okCherokeeLand", {
    label: "Cherokee Nation tribal land tracts (Cherokee Nation)",
    provider: "Cherokee Nation — Tribal Land (published by the Nation on its ArcGIS Online org)",
    serviceUrl: `${CHEROKEE}/Tribal_Land/FeatureServer/0`,
    geometryType: "polygon", fields: { county: "COUNTY", tract: "Tract_ID", acres: "Acres" }, dataLastEdited: "2026-09-21",
  }),

  /* ---- Oil & gas, tanks (Corporation Commission) ---- */
  okWells: OK("okWells", {
    label: "Oil & gas wells (Oklahoma Corporation Commission)",
    provider: "Oklahoma Corporation Commission — Oil & Gas Conservation Division, RBDMS wells",
    serviceUrl: `${OCC}/RBDMS_WELLS/FeatureServer/2`,
    geometryType: "point", fields: { name: "well_name", operator: "operator", cls: "symbol_class", type: "welltype", county: "county", status: "wellstatus" }, dataLastEdited: "2026-10-29",
  }),
  okPst: OK("okPst", {
    label: "Petroleum storage tank facilities (Oklahoma Corporation Commission)",
    provider: "Oklahoma Corporation Commission — Petroleum Storage Tank Division, PST facilities",
    serviceUrl: `${OCC}/Facilities/FeatureServer/0`,
    geometryType: "point", fields: { name: "facility_name", type: "facility_type", status: "facility_status", city: "city", county: "county" }, dataLastEdited: "2026-10-28",
  }),
  okBrownfieldOcc: OK("okBrownfieldOcc", {
    label: "Brownfield program sites (Oklahoma Corporation Commission)",
    provider: "Oklahoma Corporation Commission — Brownfields Program (OCC's own ArcGIS Online org)",
    serviceUrl: "https://services3.arcgis.com/MUsqg3LXXXYe8gDP/arcgis/rest/services/Brownfield_Sites_20210603/FeatureServer/0",
    geometryType: "point", fields: { name: "SiteName", status: "Status", city: "City", county: "County", type: "Type" }, dataLastEdited: "2026-10-26",
  }),

  /* ---- Cleanup programs (DEQ Land Protection — LandWeb) ---- */
  okSuperfund: OK("okSuperfund", {
    label: "Superfund sites (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Land Protection, Site Remediation (Superfund)",
    serviceUrl: DEQ_LAND, layerId: 1, geometryType: "point", fields: { name: "NPL_SITE", epa: "EPA_ID", link: "Link" },
  }),
  okRcra: OK("okRcra", {
    label: "RCRA corrective-action sites (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Land Protection, RCRA Corrective Action",
    serviceUrl: DEQ_LAND, layerId: 0, geometryType: "point", fields: { name: "Facility_N", city: "City", county: "Cty", link: "DEQWeblink" },
  }),
  okInstControl: OK("okInstControl", {
    label: "Land-use restrictions on cleanup sites (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Land Protection, Remediation Institutional Controls",
    serviceUrl: DEQ_LAND, layerId: 3, geometryType: "point", fields: { name: "FacilityNa", program: "Program", county: "County", filed: "DateFiled", restriction: "Land_Use_Restrictions", doc: "Link_to_Do" },
  }),
  okVcp: OK("okVcp", {
    label: "Voluntary Cleanup Program sites (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Land Protection, Voluntary Cleanup Program",
    serviceUrl: DEQ_LAND, layerId: 4, geometryType: "point", fields: { name: "Facility_Name", county: "County" },
  }),
  okScap: OK("okScap", {
    label: "Site Cleanup Assistance Program sites (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Land Protection, Site Cleanup Assistance Program",
    serviceUrl: DEQ_LAND, layerId: 8, geometryType: "point", fields: { name: "Site_Name", type: "Site_Type", city: "City" },
  }),
  okBrownfieldDeq: OK("okBrownfieldDeq", {
    label: "Brownfield sites (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Land Protection, Brownfields",
    serviceUrl: DEQ_LAND, layerId: 11, geometryType: "point", fields: { name: "Site_Name", status: "Status", type: "Type_of_Site", contam: "Nature_of_Contamination", use: "Allowable_Use" },
  }),
  okSolidWaste: OK("okSolidWaste", {
    label: "Solid-waste facilities and landfills (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Land Protection, Solid Waste Facilities",
    serviceUrl: DEQ_LAND, layerId: 7, geometryType: "point", fields: { name: "Facility_Name", type: "Facility_Type", city: "City", county: "Cty" },
  }),
  okHazWaste: OK("okHazWaste", {
    label: "Hazardous-waste permit sites (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Land Protection, Hazardous Waste Permit Sites",
    serviceUrl: DEQ_LAND, layerId: 6, geometryType: "point", fields: { name: "Facility_N", type: "Facility_Type", city: "City", county: "County" },
  }),

  /* ---- Water supply and protected waters (DEQ Water Quality — WaterWeb) ---- */
  okWhpa: OK("okWhpa", {
    label: "Wellhead protection areas (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Water Quality, Wellhead Protection Areas (modelled)",
    serviceUrl: DEQ_WATER, layerId: 8, geometryType: "polygon", fields: { zone: "ZONE" },
  }),
  okWellBuffer: OK("okWellBuffer", {
    label: "Public water-supply well 300-ft buffers (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Water Quality, WHPA 300-ft Buffer (OAC 252:626-7-4)",
    serviceUrl: DEQ_WATER, layerId: 11, geometryType: "polygon", fields: { system: "SYSTEM", source: "SOURCE_NAM", type: "SOURCE_TYP", pop: "POP_SERVED", county: "COUNTY" },
  }),
  okPwsIntake: OK("okPwsIntake", {
    label: "Public water-supply surface-water intakes (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Water Quality, PWS Surface Water Intakes",
    serviceUrl: DEQ_WATER, layerId: 5, geometryType: "point", fields: { system: "SYSTEM", facility: "FACILITY" },
  }),
  okAppendixBArea: OK("okAppendixBArea", {
    label: "Appendix B protected-water areas (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Water Quality Standards, Appendix B Areas (OAC 252:730)",
    serviceUrl: DEQ_WATER, layerId: 15, geometryType: "polygon", fields: { name: "NAME", sub: "SUBNAME", table: "AB_TABLE", owner: "OWNER", type: "TYPE" },
  }),
  okAppendixBLine: OK("okAppendixBLine", {
    label: "Appendix B protected streams (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Water Quality Standards, Appendix B Lines (OAC 252:730)",
    serviceUrl: DEQ_WATER, layerId: 16, geometryType: "line", fields: { name: "NAME", appb: "APXB_NAME", table: "AB_TABLE", species: "SPECIES" },
  }),
  okSensitiveWaters: OK("okSensitiveWaters", {
    label: "Stormwater sensitive watersheds (Oklahoma DEQ, OKR10)", provider: "Oklahoma Department of Environmental Quality — Water Quality, Sensitive Waters and Watersheds (OKR10 Construction General Permit)",
    serviceUrl: DEQ_WATER, layerId: 1, geometryType: "polygon", fields: { name: "NAME", huc: "HUC11" },
  }),
  ok303d: OK("ok303d", {
    label: "Impaired waters, 2024 303(d) list (Oklahoma DEQ)", provider: "Oklahoma Department of Environmental Quality — Water Quality, 2024 Integrated Report 303(d) waterbodies",
    serviceUrl: DEQ_WATER, layerId: 19, geometryType: "line", fields: { name: "Name", cat: "Category" },
  }),

  /* ---- Water Resources Board ---- */
  okDams: OK("okDams", {
    label: "Dams by hazard class (Oklahoma Water Resources Board)", provider: "Oklahoma Water Resources Board — Dam Safety Program, Oklahoma Dam Inventory",
    serviceUrl: "https://services2.arcgis.com/fI5CUOPa2wdhkCHV/arcgis/rest/services/Dam_Hazard_Classification_AGOL/FeatureServer/0",
    geometryType: "point", fields: { name: "dam_name", hazard: "hazard", owner: "owner_name", ownerType: "owner_type", county: "county", river: "river", year: "year_completed", height: "dam_height", kind: "gis_type" }, dataLastEdited: "2026-09-22",
  }),
  okScenicRivers: OK("okScenicRivers", {
    label: "Scenic Rivers (Oklahoma Water Resources Board)", provider: "Oklahoma Water Resources Board — Water Quality Standards, Scenic Rivers",
    serviceUrl: OWRB_STD, layerId: 0, geometryType: "line", fields: { name: "name", wqs: "wqs_name", remark: "remark" },
  }),
  okSpecialWatersheds: OK("okSpecialWatersheds", {
    label: "Special-provision watersheds (Oklahoma Water Resources Board)", provider: "Oklahoma Water Resources Board — Water Quality Standards, Special Provision Watersheds (detail)",
    serviceUrl: OWRB_STD, layerId: 9, geometryType: "polygon", fields: { name: "name", type: "type", def: "type_def" },
  }),
  okWaterSystems: OK("okWaterSystems", {
    label: "Public water-system service areas, approximate (Oklahoma Water Resources Board)", provider: "Oklahoma Water Resources Board — Public Water Supply Approximate System Service Areas",
    serviceUrl: "https://owrb.csa.ou.edu/server/rest/services/Water_Supply/Water_Systems/MapServer", layerId: 0, geometryType: "polygon", fields: { name: "name", pwsid: "pwsid", county: "county" },
  }),

  /* ---- Federal files re-declared with an Oklahoma scope ---- */
  okNrhp: OK("okNrhp", {
    label: "National Register of Historic Places (Oklahoma)", provider: "National Park Service — National Register of Historic Places (via Esri Federal Data)",
    serviceUrl: "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/nrhp_points_v1/FeatureServer/0",
    geometryType: "point", fields: { name: "RESNAME", type: "ResType", city: "City", county: "County", listed: "CertDate" },
  }),
  okCemeteries: OK("okCemeteries", {
    label: "Cemeteries (USGS / GNIS, Oklahoma)", provider: "U.S. Geological Survey — National Map Structures (GNIS cemeteries)",
    serviceUrl: "https://carto.nationalmap.gov/arcgis/rest/services/structures/MapServer/37",
    geometryType: "point", fields: { name: "NAME", city: "CITY", state: "STATE" },
  }),
  okCritHabitat: OK("okCritHabitat", {
    label: "USFWS critical habitat (Oklahoma)", provider: "U.S. Fish & Wildlife Service — Final Critical Habitat",
    serviceUrl: "https://services.arcgis.com/QVENGdaPbd4LUkLV/ArcGIS/rest/services/USFWS_Critical_Habitat/FeatureServer/0",
    geometryType: "polygon", fields: { name: "comname", sci: "sciname", status: "listing_status", unit: "unitname" },
  }),
};

/* The reach class of the rows whose real extent is narrower than "the state" (sources.js `SOURCE_FIXTURE_REACH`, `[class, reason]`). */
export const OK_FIXTURE_REACH = {
  okCherokeeRes: ["regional", "One polygon: the Cherokee Nation's reservation (northeast Oklahoma) — probing it in Guymon would assert a guaranteed zero."],
  okCherokeeLand: ["regional", "Cherokee Nation tribal land tracts — the Nation's fourteen-county area in northeast Oklahoma."],
  okAppendixBLine: ["regional", "Fourteen stream lines in all (DEQ Appendix B Table 1/2 streams), clustered in the Ouachita and Osage hills — there is no statewide spread to probe."],
  okScenicRivers: ["regional", "OWRB's Scenic Rivers are the Illinois River, Barren Fork, Flint Creek, Little Lee Creek and the Upper Mountain Fork — all in the east of the state; there is no statewide spread to probe."],
  okSensitiveWaters: ["regional", "Fifty-two HUC-11 watersheds, all in the east-central half of the state — the fixtures sit on two of them, far apart."],
};
