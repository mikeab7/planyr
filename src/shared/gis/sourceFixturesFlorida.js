/* NEW-1 (Florida, B2452976, 2026-10-29) — the coverage FIXTURES + DOCS for the Florida rows in `sourcesFlorida.js`, spread into `SOURCE_FIXTURES` / `SOURCE_DOCS`
 * (sourceFixtures.js). Off the app bundle for the same reason that module is: nothing in the app reads a fixture; the weekly verifier and the unit guards do.
 *
 * Every count was MEASURED 2026-10-29 with the verifier's own query (an envelope ~1 km around the point, or the bbox as written) — against the agency's server
 * directly, or through planyr.io's /gis-proxy relay for the hosts the build sandbox cannot reach. `expectMinCount` is a floor, never the measured number.
 *   state-wide rows  → 3 points ≥ 200 km apart (Miami · Tampa/Orlando · Jacksonville …)
 *   county / district rows → `FLORIDA_FIXTURE_REACH` (sourcesFlorida.js) declares them "regional": 2 points ≥ 15 km apart inside the area they serve. */
export const FLORIDA_FIXTURES = {
  countyFl: {
    fixtures: [
      { label: "Miami (Miami-Dade)", point: [-80.19, 25.77], expectMinCount: 1 }, // live: 1
      { label: "Tampa (Hillsborough)", point: [-82.46, 27.95], expectMinCount: 1 }, // live: 1
      { label: "Jacksonville (Duval)", point: [-81.66, 30.33], expectMinCount: 1 }, // live: 1
    ],
  },
  cityFl: {
    fixtures: [
      { label: "Miami", point: [-80.19, 25.77], expectMinCount: 1 }, // live: 1
      { label: "Orlando", point: [-81.38, 28.54], expectMinCount: 1 }, // live: 1
      { label: "Jacksonville", point: [-81.66, 30.33], expectMinCount: 1 }, // live: 1
    ],
  },
  wmdFl: {
    fixtures: [
      { label: "Miami (SFWMD)", point: [-80.19, 25.77], expectMinCount: 1 }, // live: 1
      { label: "Tampa (SWFWMD)", point: [-82.46, 27.95], expectMinCount: 1 }, // live: 1
      { label: "Jacksonville (SJRWMD)", point: [-81.66, 30.33], expectMinCount: 1 }, // live: 1
    ],
  },
  evacZonesFl: {
    fixtures: [
      { label: "Miami Beach", point: [-80.13, 25.79], expectMinCount: 1 }, // live: 1
      { label: "Clearwater Beach", point: [-82.83, 27.98], expectMinCount: 1 }, // live: 1
      { label: "Jacksonville Beach", point: [-81.4, 30.29], expectMinCount: 1 }, // live: 1
    ],
  },
  conservationLandsFl: {
    fixtures: [
      { label: "Everglades National Park", point: [-80.9, 25.4], expectMinCount: 1 }, // live: 1
      { label: "Ocala National Forest", point: [-81.7, 29.25], expectMinCount: 1 }, // live: 1
      { label: "Jacksonville (Little Talbot / Big Talbot area)", point: [-81.43, 30.45], expectMinCount: 1 }, // live: 2
    ],
  },
  udbMdc: {
    fixtures: [
      { label: "UDB, Medley / Miami Lakes reach", bbox: [-80.45, 25.85, -80.35, 25.95], expectMinCount: 1 }, // live: 7
      { label: "UDB, south county reach", bbox: [-80.5, 25.55, -80.4, 25.65], expectMinCount: 1 }, // live: 2
    ],
  },
  canalsSfwmd: {
    fixtures: [
      { label: "Broward canals", bbox: [-80.45, 25.95, -80.1, 26.35], expectMinCount: 100 }, // live: 9,979
      { label: "Lee / Collier canals", bbox: [-82.0, 26.0, -81.5, 26.8], expectMinCount: 100 }, // live: 18,368
    ],
  },
  rowPermitsSfwmd: {
    fixtures: [
      { label: "Broward right-of-way permits", bbox: [-80.45, 25.95, -80.1, 26.35], expectMinCount: 50 }, // live (reviewStatus = 'FINAL'): 3,990
      { label: "Western Palm Beach / Glades right-of-way permits", bbox: [-81.2, 26.4, -80.5, 26.9], expectMinCount: 50 }, // live (reviewStatus = 'FINAL'): 627
    ],
  },
  conEasementsSfwmd: {
    fixtures: [
      { label: "Broward conservation easements", bbox: [-80.45, 25.95, -80.1, 26.35], expectMinCount: 20 }, // live: 337
      { label: "Lee County conservation easements", bbox: [-82.2, 26.3, -81.6, 26.9], expectMinCount: 20 }, // live: 1,506
    ],
  },
  cleanupFl: {
    fixtures: [
      { label: "Miami", point: [-80.19, 25.77], expectMinCount: 1 }, // live: 2
      { label: "Tampa", point: [-82.46, 27.95], expectMinCount: 1 }, // live: 7
      { label: "Jacksonville", point: [-81.66, 30.33], expectMinCount: 1 }, // live: 6
    ],
  },
  brownfieldFl: {
    fixtures: [
      { label: "Golden Glades (Miami-Dade)", point: [-80.2, 25.917], expectMinCount: 1 }, // live: 1
      { label: "Tampa", point: [-82.45, 27.96], expectMinCount: 1 }, // live: 3
      { label: "Jacksonville", point: [-81.66, 30.33], expectMinCount: 1 }, // live: 2
    ],
  },
  icrFl: {
    fixtures: [
      { label: "Sunrise — Springtree golf-course site (near NW 44th St & Hiatus Rd)", point: [-80.2554, 26.1666], expectMinCount: 1 }, // live: 2
      { label: "Tampa", point: [-82.46, 27.95], expectMinCount: 1 }, // live: 1
      { label: "Jacksonville", point: [-81.66, 30.33], expectMinCount: 1 }, // live: 6
    ],
  },
  subsidenceFl: {
    fixtures: [
      { label: "Panhandle (Tallahassee area)", bbox: [-87.0, 30.2, -85.0, 31.0], expectMinCount: 5 }, // live: 69
      { label: "Sarasota / Manatee / Hardee area", bbox: [-82.5, 26.8, -81.5, 27.6], expectMinCount: 5 }, // live: 45
      { label: "Jacksonville area", bbox: [-81.8, 30.0, -81.0, 30.6], expectMinCount: 3 }, // live: 16
    ],
  },
  sinkholeAreasFl: {
    fixtures: [
      { label: "Tampa Bay (Hillsborough)", point: [-82.46, 28.15], expectMinCount: 1 }, // live: 1
      { label: "Gainesville", point: [-82.32, 29.65], expectMinCount: 1 }, // live: 2
      { label: "Tallahassee", point: [-84.28, 30.44], expectMinCount: 1 }, // live: 1
    ],
  },
  ofwFl: {
    fixtures: [
      { label: "Oleta River (Miami-Dade)", point: [-80.14, 25.92], expectMinCount: 1 }, // live: 2
      { label: "Wekiva River (Orange / Lake)", point: [-81.45, 28.75], expectMinCount: 1 }, // live: 2
      { label: "Biscayne Bay", point: [-80.2, 25.6], expectMinCount: 1 }, // live: 1
    ],
  },
  pantherFl: {
    fixtures: [
      { label: "Immokalee (Collier)", point: [-81.42, 26.42], expectMinCount: 1 }, // live: 1
      { label: "LaBelle (Hendry)", point: [-81.43, 26.76], expectMinCount: 1 }, // live: 1
      { label: "Lehigh Acres (Lee)", point: [-81.62, 26.6], expectMinCount: 1 }, // live: 1
    ],
  },
  eagleFl: {
    fixtures: [
      { label: "North Florida (Gainesville / Jacksonville)", bbox: [-82.5, 29.0, -81.5, 30.5], expectMinCount: 20 }, // live: 561
      { label: "Central Florida", bbox: [-82.0, 27.5, -81.0, 28.8], expectMinCount: 20 }, // live: 915
      { label: "South Florida", bbox: [-81.5, 25.8, -80.0, 26.8], expectMinCount: 5 }, // live: 62
    ],
  },
  fllNoise: {
    fixtures: [
      { label: "FLL, west of the field", point: [-80.2, 26.07], expectMinCount: 1 }, // live: 1
      { label: "FLL, east of the field", point: [-80.12, 26.05], expectMinCount: 1 }, // live: 1
    ],
  },
  sisHighwaysFl: {
    fixtures: [
      { label: "I-95 Miami", point: [-80.2, 25.79], expectMinCount: 1 }, // live: 3
      { label: "I-4 Orlando", point: [-81.38, 28.53], expectMinCount: 1 }, // live: 5
      { label: "I-75 Tampa", point: [-82.34, 28.0], expectMinCount: 1 }, // live: 1
    ],
  },
  drainageBroward: {
    fixtures: [
      { label: "Coral Springs drainage district", point: [-80.25, 26.27], expectMinCount: 1 }, // live: 1
      { label: "Weston (Indian Trace / South Broward)", point: [-80.4, 26.1], expectMinCount: 1 }, // live: 1
    ],
  },
  wellfieldBroward: {
    fixtures: [
      { label: "Sunrise — Springtree wellfield (NW 44th St & Hiatus Rd area)", point: [-80.2554, 26.1666], expectMinCount: 1 }, // live: 44
      { label: "Hollywood wellfield", point: [-80.18, 26.0], expectMinCount: 1 }, // live: 1
    ],
  },
  wellfieldMdc: {
    fixtures: [
      { label: "Northwest / Medley wellfield area", bbox: [-80.6, 25.6, -80.25, 26.0], expectMinCount: 5 }, // live: 32
      { label: "South Dade wellfield area", bbox: [-80.55, 25.5, -80.35, 25.7], expectMinCount: 5 }, // live: 45
    ],
  },
  erpSfwmd: {
    fixtures: [
      { label: "Sunrise (Broward)", point: [-80.2554, 26.1666], expectMinCount: 1 }, // live: 22
      { label: "West Palm Beach", point: [-80.07, 26.71], expectMinCount: 1 }, // live: 17
      { label: "Fort Myers (Lee)", point: [-81.87, 26.64], expectMinCount: 1 }, // live: 38
    ],
  },
  wetlandsBroward: {
    fixtures: [
      { label: "Pembroke Pines area", point: [-80.3, 25.99], expectMinCount: 1 }, // live: 3
      { label: "Coral Springs north", point: [-80.25, 26.3], expectMinCount: 1 }, // live: 1
    ],
  },
  naturalLandsBroward: {
    fixtures: [
      { label: "Tradewinds Park area", point: [-80.2, 26.27], expectMinCount: 1 }, // live: 3
      { label: "Weston", point: [-80.42, 26.05], expectMinCount: 1 }, // live: 1
    ],
  },
};

export const FLORIDA_DOCS = {
  countyFl: { notes: "FDEM's 'Counties' polygon layer (67 counties, edited 2026-07-22) from the state emergency-management ArcGIS Online org — the county basemap its own Know Your Zone / SERT maps draw." },
  cityFl: { notes: "UF GeoPlan Center city limits compiled from the Department of Revenue's 2021 county tax-roll boundaries (411 polygons; each carries its source and date). Hosted on the FWC ArcGIS Online org; the county property appraisers are the underlying publishers. Annexations since 2021 are not in it — the registry says so on the layer's (i)." },
  wmdFl: { notes: "FDEP's boundary of the five water management districts, hosted by SFWMD. Generalised on the coast." },
  evacZonesFl: { notes: "FDEM Know Your Zone evacuation zones (statewide, edited 2026-07-24). A zone letter is a county-defined evacuation priority tied to SLOSH storm-surge modelling; zone A is the Category-1 surge area. Not the FEMA floodplain and not a county's adopted Coastal High Hazard Area map." },
  conservationLandsFl: { notes: "FNAI Florida Conservation Lands (managed areas), 3,435 polygons, edited 2026-10-06." },
  udbMdc: { notes: "Miami-Dade's Urban Development Boundary (32 polylines, edited 2025-08-19), from the county's ArcGIS Online org." },
  canalsSfwmd: { notes: "SFWMD's AHED HydroEdges (canals and streams) — 196,976 lines built from the 1:24,000 NHD and edited on District aerials. OWNER / OPER_MAINT are filled for only part of the network (most segments carry none). The service draws below ~1:72,000 scale." },
  rowPermitsSfwmd: { notes: "SFWMD Right of Way and Right of Way Occupancy permits (15,991 polygons). The LINK field is a generic permitting page, not a per-permit record, so the card prints the permit number instead." },
  conEasementsSfwmd: { notes: "SFWMD conservation easements (7,302 polygons) maintained in its regulation GIS; includes easements recorded in connection with regulatory permits." },
  cleanupFl: { notes: "FDEP Contamination Locator Map points (10,516): categories PETRO / OTHCU / BROWN / PFAS / SUPER / FED; statuses ACTIVE / OPEN / ONHOLD. At DEP's own coordinates (DATA_LOAD_DATE 2026-10-29). The registered-tank list (STCM, 72,510 facilities) is a different, larger layer and is not drawn." },
  brownfieldFl: { notes: "FDEP's polygons of locally designated Brownfield Areas (629), under the Brownfields Redevelopment Act (ss. 376.77–.85, F.S.)." },
  icrFl: { notes: "FDEP Institutional Controls Registry polygons (2,717): the property restrictions (groundwater use, land use, engineering controls) recorded for cleaned-up sites." },
  subsidenceFl: { notes: "FGS Subsidence Incident Reports (4,461): reported depressions, most never field-checked, so most are not confirmed sinkholes (the FGS's own statement)." },
  sinkholeAreasFl: { notes: "FGS 'Sinkhole Types' areas I–IV (8,935 polygons): bare or thinly covered limestone to >200 ft of cover, with the kind of sinkhole each area produces in the publisher's words." },
  ofwFl: { notes: "FDEP Outstanding Florida Waters boundaries (580 polygons) as described in s. 62-302.700, F.A.C. (OFW aquatic preserves, special OFWs, other OFWs)." },
  pantherFl: { notes: "USFWS South Florida Ecological Services panther consultation area (one multipart polygon over southwest Florida), as hosted by FDEP." },
  eagleFl: { notes: "FWC statewide aerial-survey bald eagle nesting areas 1998–2017 (3,551 polygons), each labelled with the first and last survey year a nest was confirmed. Historical, not a current nest list." },
  fllNoise: { notes: "Broward County Aviation Department DNL contours (60 / 65 / 70 / 75 dB) for Fort Lauderdale–Hollywood International; the sub-layer is titled 'Noise Contour_2020_Alt B1b' (a 2020 forecast scenario)." },
  sisHighwaysFl: { notes: "FDOT's Strategic Intermodal System highway corridors (902 segments, edited 2026-10-26) from FDOT's own ArcGIS Online org." },
  drainageBroward: { notes: "Broward County's 23 drainage / water control districts. One name carries a stray line break, cleaned for display." },
  wellfieldBroward: { notes: "Broward wellfield protection zones 1–3. Zone distances (250 / 500 / 1,320 ft for wells added after the 2001 map) are the county's own layer description of its ordinance; the mapped zones for earlier wells come from the Feb. 16, 2001 zones-of-influence map." },
  wellfieldMdc: { notes: "Miami-Dade wellfield protection areas as groundwater travel-time contours (TRAVELTIME 010/030/100/210 days; a few AVG/MAX/INT/OUTER helper polygons). The service only draws between roughly 1:1,155,000 and 1:1,100 scale." },
  erpSfwmd: { notes: "SFWMD approved Environmental Resource Permit footprints (all permit types), maintained by its Regulation permitting system. SFWMD territory only — the other four districts publish their own." },
  wetlandsBroward: { notes: "Broward County Aquatic & Wetland Resources wetland polygons ('Wetlands_noDER'). A county planning map with working-file attribute text — only the area is shown on the click card." },
  naturalLandsBroward: { notes: "Broward Protected Natural Lands inventory (322 polygons), last edited 2018-10-11." },
};
