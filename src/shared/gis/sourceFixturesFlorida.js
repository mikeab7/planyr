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
  sisHighwaysFl: { notes: "FDOT's Strategic Intermodal System highway corridors (902 segments, edited 2026-10-26) from FDOT's own ArcGIS Online org." },
  drainageBroward: { notes: "Broward County's 23 drainage / water control districts. One name carries a stray line break, cleaned for display." },
  wellfieldBroward: { notes: "Broward wellfield protection zones 1–3. Zone distances (250 / 500 / 1,320 ft for wells added after the 2001 map) are the county's own layer description of its ordinance; the mapped zones for earlier wells come from the Feb. 16, 2001 zones-of-influence map." },
  wellfieldMdc: { notes: "Miami-Dade wellfield protection areas as groundwater travel-time contours (TRAVELTIME 010/030/100/210 days; a few AVG/MAX/INT/OUTER helper polygons). The service only draws between roughly 1:1,155,000 and 1:1,100 scale." },
  erpSfwmd: { notes: "SFWMD approved Environmental Resource Permit footprints (all permit types), maintained by its Regulation permitting system. SFWMD territory only — the other four districts publish their own." },
  wetlandsBroward: { notes: "Broward County Aquatic & Wetland Resources wetland polygons ('Wetlands_noDER'). A county planning map with working-file attribute text — only the area is shown on the click card." },
  naturalLandsBroward: { notes: "Broward Protected Natural Lands inventory (322 polygons), last edited 2018-10-11." },
};
