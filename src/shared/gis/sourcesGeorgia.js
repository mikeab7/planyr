/* Georgia (GA EPD / DNR / MRPA / county zoning) — GIS source rows, split out of sources.js (batch K stage 3, 2026-11-23, B2671306).
 * LOADS ON DEMAND, NOT in the Site route's first download: sourcePacks.js loads this pack with the lazy layer file(s) that read these rows (lazyLayerFiles.js `packs`),
 * and registers it into GIS_SOURCES (sources.js `registerSourcePack`). Rows are byte-identical to what sources.js held; nothing eager may read these keys
 * (test/sourcePacks.test.js sweeps for that). This file imports nothing so the dependency stays one-way. */

export const GEORGIA_SOURCES = {
  /* ═══ NEW-1 (Georgia due-diligence gaps, 2026-10-29) — the Georgia Part V / EPD / DCA / DNR layers. Every row is a STATE or FEDERAL AGENCY's own ArcGIS Online
   * feature service (hosted, CORS-open `access-control-allow-origin: *`, https), live-counted at real Georgia points 2026-10-29 (the counts are on the fixtures).
   * Georgia's own agency servers (EPD, DNR, GDOT `egis.dot.ga.gov`, `maps.itos.uga.edu`, Bartow County `bartowgis.org`) answer 403 at the build sandbox's egress, so a
   * layer that exists ONLY there is not wired (see the NEW-1 backlog item for the list). ═══ */
  /* The Part V groundwater-recharge screen. EPD's own org (`barbara.stitt_GAEPD2`, edited 2020-04-07): the 933 polygons of Hydrologic Atlas 18, "Most Significant Ground-Water Recharge Areas of Georgia" — the map Rule 391-3-16-.02 names as the definition of a significant recharge area. Coastal-plain aquifer outcrops plus the Piedmont/Valley thick-soil areas; the attribute `NAME` is the aquifer system. Live 2026-10-29: Albany 1 · Macon 1 · Adairsville 1 · Savannah 1. */
  gaRecharge: {
    key: "gaRecharge",
    label: "Significant groundwater recharge areas (Georgia EPD)",
    provider: "Georgia Environmental Protection Division — Georgia Geologic Survey Hydrologic Atlas 18 (1989), digitised 1996",
    serviceUrl: "https://services1.arcgis.com/p0dLjwtOaJHU8zq2/arcgis/rest/services/Most_Significant_Ground_Water_Recharge_Areas_of_Georgia/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "NAME", aquifer: "AQUIFER" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* Hydrologic Atlas 20 — the DRASTIC pollution-susceptibility map (LOW / AVERAGE / HIGH, plus WATER) that decides how strict Rule 391-3-16-.02's standards are INSIDE a significant recharge area. Same EPD org, edited 2020-04-07; 857 statewide polygons, ~590k vertices (so the row asks the server to generalise). Live 2026-10-29: Atlanta, Savannah, Albany, Rome, Cartersville all answered. */
  gaPollutionSusc: {
    key: "gaPollutionSusc",
    label: "Groundwater pollution susceptibility (Georgia EPD)",
    provider: "Georgia Environmental Protection Division — Georgia Geologic Survey Hydrologic Atlas 20 (1992), DRASTIC",
    serviceUrl: "https://services1.arcgis.com/p0dLjwtOaJHU8zq2/arcgis/rest/services/Ground_Water_Pollution_Susceptibility_Map_Of_Georgia_DRASTIC_Hydrologic_Atlas_20_1992/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { class: "CLASS", score: "SCORE" },
    // the layer's WATER polygons (lakes, rivers) carry no susceptibility class — withheld so a reservoir is not painted as a class
    where: "CLASS <> 'WATER'",
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* DCA's analysis (1:24,000 National Elevation Dataset, 2002) of land at or above 2,200 ft with slope of 25% or more over at least 500 ft horizontally — the statutory definition of a protected mountain. ONE multipolygon of ~536k vertices, so the row generalises server-side. North Georgia only (the Blue Ridge); live 2026-10-29: 1 over the Dahlonega–Blairsville box. */
  gaProtectedMountain: {
    key: "gaProtectedMountain",
    label: "Protected mountains (Georgia DCA)",
    provider: "Georgia Department of Community Affairs — Environmental Planning (protected mountains, O.C.G.A. 12-2-8 / Rule 391-3-16-.05)",
    serviceUrl: "https://services2.arcgis.com/Gqyymy5JISeLzyNM/arcgis/rest/services/EnvironmentalPlanning/FeatureServer/3",
    layerId: null,
    geometryType: "polygon",
    fields: { grid: "GRIDCODE" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* The karst screen. USGS's own org (`v01gqwM5QqNysAAi`), the national State Geologic Map Compilation (doi:10.5066/F7WH2N65); the row filters it to `STATE='GA' AND GENERALIZED_LITH='Sedimentary, carbonate'` — 133 polygons (Knox, Conasauga, Chickamauga, Shady Dolomite in the Valley & Ridge; Suwannee/Ocala Limestone on the coastal plain), ~54k vertices. Georgia publishes NO statewide sinkhole inventory, and the Georgia Geologic Survey's karst data is not on a reachable service, so carbonate bedrock at the surface is the honest proxy. State maps are ~1:500,000. Live 2026-10-29: Cartersville 2 · Adairsville 1 · Rome 2 · Albany 1. */
  gaCarbonate: {
    key: "gaCarbonate",
    label: "Carbonate bedrock — karst screen (USGS SGMC)",
    provider: "U.S. Geological Survey — State Geologic Map Compilation (SGMC), Georgia carbonate units",
    serviceUrl: "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/SB_5888bf4fe4b05ccb964bab9d_USGS_SGMC_feature/FeatureServer/3",
    layerId: null,
    geometryType: "polygon",
    fields: { unit: "UNIT_NAME", lith: "GENERALIZED_LITH" },
    // narrows the national compilation to Georgia's sedimentary carbonate units (133 polygons)
    where: "STATE = 'GA' AND GENERALIZED_LITH = 'Sedimentary, carbonate'",
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* EPD's solid-waste facility register (EPD org; 3,238 points: MSW / C&D / inert / industrial landfills, transfer stations, composting, thermal, material recovery, with `Operating_Status` and permit number). A landfill beside a site is a Phase I / odour / methane / airport-bird-hazard flag. Live 2026-10-29: Atlanta box 32 · Savannah 27 · Valdosta 16 · Adairsville 2. */
  gaSolidWaste: {
    key: "gaSolidWaste",
    label: "Solid waste facilities (Georgia EPD)",
    provider: "Georgia Environmental Protection Division — Land Protection Branch, solid waste facilities",
    serviceUrl: "https://services1.arcgis.com/p0dLjwtOaJHU8zq2/arcgis/rest/services/Solid_Waste_Facilities/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "Facility_Name", county: "County", type: "Interest_Type", status: "Operating_Status", permit: "Permit_Number" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* EPD Brownfield Program properties (EPD org, `Sara.Lips_GAEPD`, edited 2022-05-16; 1,257 points) with the Limitation-of-Liability issue date, the risk-reduction standard met and acreage. A site on this list has had a regulatory closeout (or is in the program) — the liability protection travels with the property. Live 2026-10-29: Atlanta box 478 · Savannah 42 · Augusta 15 · Griffin 5. */
  gaBrownfields: {
    key: "gaBrownfields",
    label: "Brownfield sites (Georgia EPD)",
    provider: "Georgia Environmental Protection Division — Brownfield Program (Georgia Hazardous Site Reuse and Redevelopment Act)",
    serviceUrl: "https://services1.arcgis.com/p0dLjwtOaJHU8zq2/arcgis/rest/services/Brownfields_coordinates/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "PropertyName", city: "City", county: "County", lol: "LOLIssueDate", acres: "Acreage" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* DNR WRD's statewide conservation-lands inventory (same DNR org as trout streams and gopher-tortoise soils; 6,194 polygons, ~1.2M vertices, so the row generalises server-side): fee-owned public lands, conservation EASEMENTS (with holder) and covenants. A protected parcel next door — or an easement over the site — is a hard constraint. Live 2026-10-29: Atlanta box 324 · Albany 63 · Savannah 45. */
  gaConservation: {
    key: "gaConservation",
    label: "Conservation lands (Georgia DNR)",
    provider: "Georgia Department of Natural Resources — Wildlife Resources Division, Georgia Conservation Lands (2023)",
    serviceUrl: "https://services6.arcgis.com/9QlSLDqa0P1cHLhu/arcgis/rest/services/Georgia_Conservation_Lands_23_proof_v2/FeatureServer/134",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "Unit_Nm", owner: "Own_Name", category: "Category", holder: "EsmtHldr", access: "Pub_Access" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* EPD's Safe Dams inventory of the CLASS I (probable loss of life if it fails) and CLASS II (significant economic loss) dams — 4,305 points, republished by GEMA from EPD's 22 Nov 2019 file (the layer was built 2022-01-15). Class III dams are not in it. Live 2026-10-29: Griffin box 33 · Tifton 36 · Rome 6. */
  gaDams: {
    key: "gaDams",
    label: "Regulated dams (Georgia EPD Safe Dams)",
    provider: "Georgia Environmental Protection Division — Safe Dams Program (Class I and II dams; via Georgia Emergency Management Agency GIS)",
    serviceUrl: "https://services1.arcgis.com/2iUE8l8JKrP2tygQ/arcgis/rest/services/GA_EPD_Safe_Dams_Inventory_Public_View/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "Dam_Name", county: "County", class: "Classification", height: "Dam_Height", storage: "Maximum_Storage" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* EPD's own 2024 Integrated Report stream layer (`tyler.parsons_GAEPD`, 2024-11-13; 2,987 reaches, ~1.7M vertices). The row shows only `Assessment='Not Supporting'` reaches (Categories 4a/4b/4c/5): a stream that does not meet its designated use. A site that discharges stormwater to a listed reach draws extra scrutiny (TMDL, NPDES stormwater, 401). Live 2026-10-29: Atlanta box 7 · Brunswick 13 · Rome 9. */
  gaImpaired: {
    key: "gaImpaired",
    label: "Impaired streams (Georgia EPD 303(d))",
    provider: "Georgia Environmental Protection Division — 2024 305(b)/303(d) List of Waters (streams and beaches)",
    serviceUrl: "https://services1.arcgis.com/p0dLjwtOaJHU8zq2/arcgis/rest/services/GA_2024_305b303d_StreamsBeaches_xmlalt/FeatureServer/0",
    layerId: null,
    geometryType: "line",
    fields: { name: "Name", category: "Category", cause: "Cause", assessment: "Assessment", uses: "Uses" },
    // only reaches that do NOT support their designated use (Categories 4a/4b/4c/5); Supporting and Assessment-Pending reaches are not drawn
    where: "Assessment = 'Not Supporting'",
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* The 260 Georgia census tracts designated Qualified Opportunity Zones (IRC 1400Z-1; DCA's own org, the 2017 designation). Live 2026-10-29: Atlanta box 30 · Albany 10 · Savannah 8. */
  gaOpportunityZones: {
    key: "gaOpportunityZones",
    label: "Opportunity zones (Georgia DCA)",
    provider: "Georgia Department of Community Affairs — Federal Opportunity Zones",
    serviceUrl: "https://services2.arcgis.com/Gqyymy5JISeLzyNM/arcgis/rest/services/Federal_Opportunity_Zones/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "NAMELSAD10", county: "County", geoid: "GEOIDn" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* DCA's 2026 ranking of all 159 counties into Tiers 1–4 (plus 'Bottom 40') for the Georgia job tax credit and related incentives (O.C.G.A. 48-7-40) — the tier sets the credit per job. Live 2026-10-29: every Georgia point answers (Atlanta, Savannah, Valdosta, Rome). */
  gaJobTaxCredit: {
    key: "gaJobTaxCredit",
    label: "Job tax credit tiers (Georgia DCA)",
    provider: "Georgia Department of Community Affairs — Job Tax Credit county tiers (2026)",
    serviceUrl: "https://services2.arcgis.com/Gqyymy5JISeLzyNM/arcgis/rest/services/JTC_Counties_2026/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "fullName", tier: "Tier26", rank: "Rank26", previous: "Tier25" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* The 50-ft natural (undisturbed) vegetative buffer the Act requires along the river and its impoundments inside the 2,000-ft corridor (ARC item text; the 50 / 35 / 150-ft figures are the corridor plan's, as Forsyth County and the City of Roswell restate them). 8 polygons, ~23k vertices. */
  gaMrpaVegBuffer: {
    key: "gaMrpaVegBuffer",
    label: "Chattahoochee 50-ft undisturbed buffer — MRPA (ARC)",
    provider: "Atlanta Regional Commission / Metropolitan North Georgia Water Planning District — MRPA undisturbed vegetative buffer",
    serviceUrl: "https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services/ChattVegetativeBuffer50ft/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: {},
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* The 150-ft setback for structures and impervious surfaces from the river (the corridor plan; ARC's service is named `ChattImperviousBuffer150ft`, its item text mislabels it 'undisturbed vegetative'). 1 polygon, ~24k vertices. */
  gaMrpaImpBuffer: {
    key: "gaMrpaImpBuffer",
    label: "Chattahoochee 150-ft impervious setback — MRPA (ARC)",
    provider: "Atlanta Regional Commission / Metropolitan North Georgia Water Planning District — MRPA impervious-surface buffer",
    serviceUrl: "https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services/ChattImperviousBuffer150ft/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: {},
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* The 35-ft undisturbed vegetative buffer along tributary streams inside the 2,000-ft corridor (ARC item text). (The service name carries ARC's own typo, `TributartBuffer35ft`.) */
  gaMrpaTributaryBuffer: {
    key: "gaMrpaTributaryBuffer",
    label: "Chattahoochee tributary 35-ft buffer — MRPA (ARC)",
    provider: "Atlanta Regional Commission / Metropolitan North Georgia Water Planning District — MRPA tributary buffer",
    serviceUrl: "https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services/TributartBuffer35ft/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: {},
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* The 22 small water supply watersheds (<100 sq mi upstream of a drinking-water intake or non-federal supply reservoir) inside the 15-county Metropolitan North Georgia Water Planning District, delineated by the District to show where Rule 391-3-16-.01(7)'s 50-ft undisturbed buffer and 75-ft impervious setback fall (item text). DISTRICT ONLY — elsewhere in Georgia local governments delineate their own. ~20k vertices. Live 2026-10-29: Henry County (-84.2138,33.349) · Fayette/Coweta (-84.6914,33.5207) · Rockdale/Gwinnett (-83.9401,33.7855). */
  gaSwsw: {
    key: "gaSwsw",
    label: "Small water supply watersheds (ARC / Metro North Georgia District)",
    provider: "Atlanta Regional Commission / Metropolitan North Georgia Water Planning District — small water supply watersheds (Rule 391-3-16-.01(7))",
    serviceUrl: "https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services/SWSW/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "NAME", system: "SYS_NAME", county: "County", sqmi: "areasqmi" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* The part of each small water supply watershed within 7 miles upstream of the intake (the 'protected' sub-area: 100-ft undisturbed buffer, 150-ft impervious setback — item text of the District's ProtectedStreamBuffers layer). 22 polygons, ~15k vertices. */
  gaSwswProtected: {
    key: "gaSwswProtected",
    label: "Protected water supply watersheds — 7 mi upstream (ARC / Metro North Georgia District)",
    provider: "Atlanta Regional Commission / Metropolitan North Georgia Water Planning District — protected small water supply watersheds (within 7 miles upstream of the intake)",
    serviceUrl: "https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services/ProtectedSWSW/FeatureServer/1",
    layerId: null,
    geometryType: "polygon",
    fields: { source: "DrH2Osrce", owner: "Ownop", county: "County" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* Spalding County's own zoning polygons (item `creagan_spalding`, edited 2025-08-11; 1,335 polygons, ~124k vertices). The unincorporated county AND the town of Orchard Hill (measured by the adversarial review: ~91% of the town's DCA municipal polygon is covered) — the City of Griffin zones itself and is not in it (downtown Griffin has no polygon; measured 0.1% coverage). Whether Sunny Side is in it was not testable (not in DCA's municipal layer). The county's `DESCRIPTION` field is inconsistent between records of one code (C2 reads both MANUFACTURING and MANUFACTURING--LIGHT), so only the code is shown. Live 2026-10-29: 5 points across the county all answered. */
  gaSpaldingZoning: {
    key: "gaSpaldingZoning",
    label: "Zoning — Spalding County (SCWA GIS)",
    provider: "Spalding County, GA — zoning GIS layer (managed by the Spalding County Water Authority GIS for the county)",
    serviceUrl: "https://services5.arcgis.com/IBG8fFojdkoiHAvQ/arcgis/rest/services/Spalding_County_Zoning_(public_view)/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { code: "LABEL" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* ═══ NEW-1 follow-up (Georgia due-diligence, 2026-10-29) — four rows on hosts the build sandbox cannot reach (403 at its egress) but planyr.io's /gis-proxy relay CAN: the Georgia GIS Data Clearinghouse at UGA ITOS (`maps.itos.uga.edu`: GDOT's own functional-class / ownership service, DNR's rare-species and the USGS mineral-resource records) and Bartow County's own ArcGIS Server. Each was MEASURED through the relay from planyr.io (live 2026-10-29 counts on the fixtures). `relay: true` marks them; layers read `/gis-proxy/<host>/…`, never the upstream. ═══ */
  /* GDOT's own statewide road-ownership layer (`GDOT/GDOT_FunctionalClass` layer 20 'Ownership', 'Ownership of roadways in Georgia, as of August 2022'): 210,656 segments, `Group_Name` = State Owned / County Owned / City Owned / Other (`OWNERSHIP` 1 = state, 2 = county, 3 = city, 24 = a unified / consolidated city-county government that GDOT files under County; every other code is 'Other' — parks, private, toll, airport, university, federal). `OWNERSHIP_ENTITY` is an unreadable numeric entity code and is never shown. The owner of the road fronting a site is who permits its driveway. Live 2026-10-29 (±0.01° box): Atlanta 141 · Savannah 181 · Albany 73 · Adairsville 85. */
  gaRoadOwnership: {
    key: "gaRoadOwnership",
    label: "Road ownership (Georgia DOT)",
    provider: "Georgia Department of Transportation — roadway ownership, as of August 2022 (published on the Georgia GIS Data Clearinghouse, UGA ITOS)",
    serviceUrl: "https://maps.itos.uga.edu/arcgis/rest/services/GDOT/GDOT_FunctionalClass/MapServer/20",
    relay: true, // sandbox-blocked host: the app reads it through the same-origin /gis-proxy relay (the https URL here is the upstream, which the weekly verifier reaches directly)
    layerId: null,
    geometryType: "line",
    fields: { route: "route_id", group: "Group_Name", ownership: "OWNERSHIP" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* DNR's generalised rare-species locations (`FrameWork/Conservation` layer 1): 11,964 records, each a quarter-quad cell (0.0625°, ~4 mi) — a RECORD OF OCCURRENCE in the cell, never a point or a habitat boundary, and several species share a cell. The row keeps only records with a federal status (`USESA` LE / LT / C) or state protection (`SPROT` E / T): 5,411. Live 2026-10-29 (point): Savannah 7 · Albany 12 · Rome 3 · Macon 2 · Adairsville 2. */
  gaRareSpecies: {
    key: "gaRareSpecies",
    label: "Rare species — DNR Natural Heritage (generalised)",
    provider: "Georgia Department of Natural Resources — Wildlife Resources Division, Georgia Natural Heritage Program rare-species locations (1:24,000 generalised; published on the Georgia GIS Data Clearinghouse)",
    serviceUrl: "https://maps.itos.uga.edu/arcgis/rest/services/FrameWork/Conservation/MapServer/1",
    relay: true, // sandbox-blocked host: the app reads it through the same-origin /gis-proxy relay (the https URL here is the upstream, which the weekly verifier reaches directly)
    layerId: null,
    geometryType: "polygon",
    fields: { species: "SNAME", common: "SCOMNAME", federal: "USESA", state: "SPROT", group: "GROUP_", gRank: "GRANK", sRank: "SRANK" },
    where: "USESA IN ('LE','LT','C') OR SPROT IN ('E','T')",
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* USGS MRDS / MAS-MILS records for Georgia (`FrameWork/PhysicalGeography` layer 0, 2005 digest): 2,670 points — mines, quarries, pits, plants, prospects and occurrences, with `dev_stat` (Producer · Past Producer · Plant · Prospect · Occurrence · Unknown) and up to three commodities. A past quarry or pit on or beside a site means fill, voids, blast-vibration limits or a reclamation obligation. A 2005 register, point per record, no boundary. Live 2026-10-29 (±0.1° box): Cartersville 328 · Adairsville 57 · Rome 26 · Augusta 17. */
  gaMineral: {
    key: "gaMineral",
    label: "Mineral resource sites (USGS MRDS via Georgia GIS Clearinghouse)",
    provider: "U.S. Geological Survey — Mineral Resources Data System / MAS-MILS, Georgia digest (2005; published on the Georgia GIS Data Clearinghouse)",
    serviceUrl: "https://maps.itos.uga.edu/arcgis/rest/services/FrameWork/PhysicalGeography/MapServer/0",
    relay: true, // sandbox-blocked host: the app reads it through the same-origin /gis-proxy relay (the https URL here is the upstream, which the weekly verifier reaches directly)
    layerId: null,
    geometryType: "point",
    fields: { name: "site_name", county: "county", status: "dev_stat", commodity: "commod1", commodity2: "commod2", type: "oper_type" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* Bartow County's own zoning layer: 31,627 parcel-level polygons, `STZONECODE` the district and `REZONING` the county's rezoning case reference (2,327 records, e.g. CU-2162-17, RZ-2289-19) and `ZONINGTEXT` its free-text note (377 records: 'w/ conditions', ordinance numbers, approved uses). INCORPORATED land is carried as the code 'Incorporated' — the cities (Adairsville, Cartersville, Emerson…) zone themselves and their zoning is NOT in this layer; the row says so on the card. The server answers point-geometry queries 500 intermittently, so fixtures use envelopes (what the map and the verifier send). Live 2026-10-29 (±0.01° box): Adairsville 902 · rural Bartow 79 and 28. */
  gaBartowZoning: {
    key: "gaBartowZoning",
    label: "Zoning — Bartow County (Bartow County GIS)",
    provider: "Bartow County, GA — Zoning Districts (the county's own ArcGIS Server, AGOServices/BartowZoning)",
    serviceUrl: "https://www.bartowgis.org/arcgis/rest/services/AGOServices/BartowZoning/MapServer/0",
    relay: true, // sandbox-blocked host: the app reads it through the same-origin /gis-proxy relay (the https URL here is the upstream, which the weekly verifier reaches directly)
    layerId: null,
    geometryType: "polygon",
    fields: { code: "STZONECODE", notes: "ZONINGTEXT", rezoning: "REZONING" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* NEW-2 (Bartow sweep, 2026-11-12): Bartow County Water Department's own pipe network (`Water/waterdepartmentapp` on the county's ArcGIS Server, the same host as the zoning row). Measured through the relay 2026-11-12:
   * layer 21 WaterPipe 62,770 lines — size and material are the STRING fields `SIZE_D` ("3/4"…"36") and `MAT_D` ("DIP", "PVC", "C900", "HDPE"…); the numeric `DIAMETER` / `MATERIAL` columns are NULL on every row, so nothing may read them. `DISPOSTN_D` is "EXIST" on every row (no abandoned pipe is carried).
   * Scope is the COUNTY water department only — Cartersville and Adairsville run their own systems and publish no GIS (the card says so). The point-query endpoint errors intermittently; fixtures use envelopes, like the zoning row. */
  gaBartowWater: {
    key: "gaBartowWater",
    label: "Water mains — Bartow County Water Department (Bartow County GIS)",
    provider: "Bartow County Water Department — water pipes (the county's own ArcGIS Server, Water/waterdepartmentapp layer 21)",
    serviceUrl: "https://www.bartowgis.org/arcgis/rest/services/Water/waterdepartmentapp/MapServer/21",
    relay: true, // sandbox-blocked host: the app reads it through the same-origin /gis-proxy relay (the https URL here is the upstream, which the weekly verifier reaches directly)
    layerId: null,
    geometryType: "line",
    fields: { size: "SIZE_D", material: "MAT_D" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-11-12",
  },
  /* NEW-2: the same department's sanitary sewer (`Water/waterdepartmentapp` layer 7): 13,111 lines; `SIZE_D` / `MAT_D` as above; `FORCEMAIN` = 'Y' (pressure main) / 'N' / 'None'. Same scope and caveats as gaBartowWater. */
  gaBartowSewer: {
    key: "gaBartowSewer",
    label: "Sanitary sewer — Bartow County Water Department (Bartow County GIS)",
    provider: "Bartow County Water Department — sanitary sewer pipes (the county's own ArcGIS Server, Water/waterdepartmentapp layer 7)",
    serviceUrl: "https://www.bartowgis.org/arcgis/rest/services/Water/waterdepartmentapp/MapServer/7",
    relay: true, // sandbox-blocked host: the app reads it through the same-origin /gis-proxy relay (the https URL here is the upstream, which the weekly verifier reaches directly)
    layerId: null,
    geometryType: "line",
    fields: { size: "SIZE_D", material: "MAT_D", forceMain: "FORCEMAIN" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-11-12",
  },
  /* NEW-3 (Bartow sweep, 2026-11-12): US Army Corps of Engineers, Mobile District — the Shoreline Management Program viewer (`SAD_Shoreline_Management_Web_Viewer`, AGOL org sdTb0lsRURdKFejG, CORS-open, no relay).
   * Layer 6 "Lake Boundary": per the service's own description, "the reservoir boundaries of projects participating in the SAD Shoreline Management Program. Polygons should portray Normal Pool water Levels" — i.e. the WATER, not the fee-owned land
   * around it. Allatoona Lake is RPSUID 167791 (3 polygons: the lake and two Lake Acworth pieces); the same service holds other Corps projects, so the row filters. Layer 5 "Shoreline Allocation Areas": the Corps-managed SHORE land
   * classified by `ZONECLASSIFICATION` (limitedDevelopment · prohibitedAccess · protected · publicRecreation · specialUse · tbd; 154 polygons for Allatoona, lastEdit 2026-08-28). NO flowage-easement layer is published. */
  gaAllatoonaLake: {
    key: "gaAllatoonaLake",
    label: "Allatoona Lake normal-pool boundary (USACE Mobile District)",
    provider: "U.S. Army Corps of Engineers, Mobile District — Shoreline Management Program, Lake Boundary (ArcGIS Online services2.arcgis.com/sdTb0lsRURdKFejG)",
    serviceUrl: "https://services2.arcgis.com/sdTb0lsRURdKFejG/arcgis/rest/services/SAD_Shoreline_Management_Web_Viewer/FeatureServer/6",
    layerId: null,
    where: "RPSUID=167791",
    geometryType: "polygon",
    fields: { name: "FEATURENAME", project: "RPSUID" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-11-12",
  },
  gaAllatoonaShoreline: {
    key: "gaAllatoonaShoreline",
    label: "Allatoona Lake shoreline allocation areas (USACE Mobile District)",
    provider: "U.S. Army Corps of Engineers, Mobile District — Shoreline Management Program, Shoreline Allocation Areas (ArcGIS Online services2.arcgis.com/sdTb0lsRURdKFejG)",
    serviceUrl: "https://services2.arcgis.com/sdTb0lsRURdKFejG/arcgis/rest/services/SAD_Shoreline_Management_Web_Viewer/FeatureServer/5",
    layerId: null,
    where: "RPSUID=167791",
    geometryType: "polygon",
    fields: { zone: "ZONECLASSIFICATION", name: "FEATURENAME", kind: "FEATUREDESCRIPTION", project: "RPSUID" },
    coverage: "georgia",
    states: ["GA"],
    tier: "production",
    lastVerified: "2026-11-12",
  },
};

/* Fixture-reach overrides for these rows stay in sources.js SOURCE_FIXTURE_REACH (an audit-only table); nothing to register here. */
export const GEORGIA_FIXTURE_REACH = {};
