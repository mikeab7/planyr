/* NEW-1 / NEW-2 / NEW-3 (Houston-metro sweep, 2026-11-12) — the coverage FIXTURES + DOCS for the three rows in `sourcesHoustonMetro.js`, spread into `SOURCE_FIXTURES` / `SOURCE_DOCS`
 * (sourceFixtures.js). Off the app bundle for the same reason that module is: nothing in the app reads a fixture; the weekly verifier and the unit guards do.
 *
 * Every count was MEASURED 2026-11-12 with the verifier's own query (an envelope of about ±0.01° round the point) against each agency's own server. `expectMinCount` is a floor, never the
 * measured number. Every point sits on a real feature (a vertex of it, or inside the polygon). A point that is correctly EMPTY (Katy for the airport tiers, Dallas for the evacuation zones) is
 * asserted by the layer tests, not here: a fixture is a place the service MUST answer. */

export const HOUSTON_METRO_FIXTURES = {
  harrisMtfp: { fixtures: [
    { label: "Aldine — Hardy Toll Rd (tollway, HCTRA)", point: [-95.36889590, 29.88597061], expectMinCount: 1 }, // live 2026-11-12: 23
    { label: "Houston — Westheimer Rd (thoroughfare, City)", point: [-95.38885436, 29.74451572], expectMinCount: 1 }, // live: 282
    { label: "West Houston — Westheimer Rd (principal thoroughfare, TxDOT)", point: [-95.56552999, 29.73684858], expectMinCount: 1 }, // live: 75
    { label: "South-east Houston — Beamer Rd (collector, City)", point: [-95.22826315, 29.60702263], expectMinCount: 1 }, // live: 51
  ] },
  hasAirspaceTiers: { fixtures: [
    { label: "Bush Intercontinental (GBIA Tier 1)", point: [-95.34, 29.99], expectMinCount: 1 }, // live: GBIA Tier 1
    { label: "Hobby (Hobby Tier 1)", point: [-95.277, 29.645], expectMinCount: 1 }, // live: Hobby Tier 1
    { label: "Ellington Field (Ellington-Tier 1)", point: [-95.159, 29.607], expectMinCount: 1 }, // live: Ellington-Tier 1
  ] },
  txEvacZones: { fixtures: [
    { label: "Anahuac south (Chambers, Zip-Zone A, 77514 S)", point: [-94.41881675, 29.58574519], expectMinCount: 1 }, // live: 2 (a boundary vertex: A and its neighbour)
    { label: "Winnie (Chambers, Zip-Zone B)", point: [-94.3, 29.77], expectMinCount: 1 }, // live: Zip-Zone B
    { label: "Baytown (Chambers / Harris, Zip-Zone B, 77523)", point: [-94.86, 29.74], expectMinCount: 1 }, // live: Zip-Zone B
    { label: "Galveston (Zip-Zone Coastal)", point: [-94.8, 29.3], expectMinCount: 1 }, // live: Zip-Zone Coastal
  ] },
};

export const HOUSTON_METRO_DOCS = {
  harrisMtfp: { notes: "The City of Houston's Major Thoroughfare and Freeway Plan (layer 0, 'COH MTFP' of Harris County's MTFP service). Per the service: approved by the Planning Commission Sept 18, 2025, adopted by City Council Oct 15, 2025, downloaded by Harris County GIS Jan 9, 2026. 26,699 segments, 26,656 drawn (ROW_STATUS 1-15 is what the City's own renderer paints). HIER_TABLE is a plan code read as class-lanes-right-of-way ('T-4-100'); it is blank on freeways and tollways." },
  hasAirspaceTiers: { notes: "Houston Airport System airspace tiers around Bush Intercontinental (GBIA), Hobby and Ellington Field — layer 7 'All Airport Tiers', nine polygons. The airport land-use ordinance is Houston Code Chapter 9, Articles VI (airport land use) and VII (airport hazard areas)." },
  txEvacZones: { notes: "Hurricane evacuation Zip-Zones for the Houston-Galveston coast (Brazoria, Chambers, Galveston, Harris, Matagorda), published by Harris County GIS: Zip-Zone A, B, C and Coastal. Layer edited 2026-07-10; its data last edited 2024-06-04. An evacuation order is issued by zone — this is not a flood zone." },
};
