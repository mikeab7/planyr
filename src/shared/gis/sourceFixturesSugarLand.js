/* NEW-1 (City of Sugar Land layers, 2026-11-02) — the VERIFICATION payload of the Sugar Land registry rows (`sourcesSugarLand.js`), off the app bundle exactly like every other row's
 * fixtures (see sourceFixtures.js). Spread into SOURCE_FIXTURES / SOURCE_DOCS there with one line each.
 *
 * Every point sits ON a real feature: it is a vertex of a feature found within the verifier's own ±0.01° box of an anchor — the Academy site (project "Academy", plan Concept A: 29.6122, -95.6693,
 * inside the city limits beside Sugar Land Regional Airport), City Hall / Town Square, or a point south-east of both — and every count is what that ±0.01° box returned on 2026-11-02 (the
 * city's own server measured through the PR preview's /gis-proxy relay; the org layers read directly). The exact Academy origin is a fixture of every row that has a feature in its box
 * (the case, TIRZ, available-site and development-project layers have none there — those anchor on City Hall instead). */

const ACADEMY = [-95.6693, 29.6122];

export const SUGARLAND_FIXTURES = {
  slThoroughfare: { fixtures: [
    { label: "Academy site", point: ACADEMY, expectMinCount: 1 }, // live 2026-11-02: 34
    { label: "Near the Academy site (Lexington / Hwy 6 area)", point: [-95.66553, 29.60662], expectMinCount: 1 }, // live: 62
    { label: "City Hall / Town Square", point: [-95.6352, 29.61977], expectMinCount: 1 }, // live: 182
    { label: "South-east Sugar Land", point: [-95.60006, 29.58022], expectMinCount: 1 }, // live: 174
  ] },
  slZoning: { fixtures: [
    { label: "Academy site", point: ACADEMY, expectMinCount: 1 }, // live: 14
    { label: "City Hall / Town Square", point: [-95.63527, 29.61951], expectMinCount: 1 }, // live: 53
    { label: "South-east Sugar Land", point: [-95.59596, 29.57929], expectMinCount: 1 }, // live: 12
  ] },
  slAirportZoning: { fixtures: [
    { label: "Academy site (AZ-01)", point: ACADEMY, expectMinCount: 1 }, // live: 3
    { label: "Airport edge", point: [-95.67404, 29.61224], expectMinCount: 1 }, // live: 1
    { label: "North-east of the airport", point: [-95.64011, 29.62194], expectMinCount: 1 }, // live: 2
  ] },
  slFlu: { fixtures: [
    { label: "Academy site (Light Industrial)", point: ACADEMY, expectMinCount: 1 }, // live: 6
    { label: "City Hall / Town Square", point: [-95.63508, 29.61959], expectMinCount: 1 }, // live: 10
    { label: "South-east Sugar Land", point: [-95.59607, 29.57964], expectMinCount: 1 }, // live: 5
  ] },
  slHydrants: { fixtures: [
    { label: "Academy site", point: ACADEMY, expectMinCount: 1 }, // live: 50
    { label: "City Hall / Town Square", point: [-95.63498, 29.61988], expectMinCount: 1 }, // live: 237
    { label: "South-east Sugar Land", point: [-95.59973, 29.58008], expectMinCount: 1 }, // live: 252
  ] },
  slCups: { fixtures: [
    { label: "City Hall / Town Square", point: [-95.63528, 29.61948], expectMinCount: 1 }, // live: 11
    { label: "South-east Sugar Land", point: [-95.60197, 29.57363], expectMinCount: 1 }, // live: 4
  ] },
  slSpecialExceptions: { fixtures: [
    { label: "Town Square area", point: [-95.63265, 29.61637], expectMinCount: 1 }, // live: 5
    { label: "South-east Sugar Land", point: [-95.60215, 29.58069], expectMinCount: 1 }, // live: 32
  ] },
  slVariances: { fixtures: [
    { label: "Academy site area", point: [-95.66088, 29.60425], expectMinCount: 1 }, // live: 2
    { label: "City Hall / Town Square", point: [-95.63435, 29.6193], expectMinCount: 1 }, // live: 19
    { label: "South-east Sugar Land", point: [-95.60681, 29.57993], expectMinCount: 1 }, // live: 15
  ] },
  slCip: { fixtures: [
    { label: "Academy site", point: ACADEMY, expectMinCount: 1 }, // live: 5
    { label: "City Hall / Town Square", point: [-95.63515, 29.62026], expectMinCount: 1 }, // live: 14
    { label: "South-east Sugar Land", point: [-95.60125, 29.58042], expectMinCount: 1 }, // live: 23
  ] },
  slRowLand: { fixtures: [
    { label: "Academy site", point: ACADEMY, expectMinCount: 1 }, // live: 72
    { label: "City Hall / Town Square", point: [-95.63508, 29.61959], expectMinCount: 1 }, // live: 167
    { label: "Greatwood (south-west)", point: [-95.70977, 29.52053], expectMinCount: 1 }, // live: 41
  ] },
  slTirz: { fixtures: [
    { label: "Imperial / Town Square", point: [-95.63512, 29.6197], expectMinCount: 1 }, // live: 2
    { label: "North Sugar Land", point: [-95.65179, 29.64455], expectMinCount: 1 }, // live: 1
  ] },
  slAvailableSites: { fixtures: [
    { label: "Imperial district", point: [-95.63849, 29.62192], expectMinCount: 1 }, // live: 13
    { label: "South of Town Square", point: [-95.64397, 29.57944], expectMinCount: 1 }, // live: 1
  ] },
  slDevProjects: { fixtures: [
    { label: "Town Square area", point: [-95.64191, 29.61584], expectMinCount: 1 }, // live: 6
    { label: "South-west Sugar Land", point: [-95.69229, 29.56513], expectMinCount: 1 }, // live: 1
  ] },
};

export const SUGARLAND_DOCS = {
  slThoroughfare: { notes: "The city's Master Thoroughfare Plan layer (map document 2026), narrowed to the five classed values (FRWY, STATE, ARTERIAL, MAJ COLL, MIN COLL) and not Retired. Section codes are the city's cross-section names; the layer states no right-of-way width." },
  slZoning: { notes: "The city's zoning districts (339). The Interactive_Map copy of the same table returns no geometry; this root-level service does." },
  slAirportZoning: { notes: "Sugar Land Regional Airport zoning areas (8): AZ-01, AZ-02, ANID, avigation easement, airport property." },
  slFlu: { notes: "The adopted 2022 Future Land Use Map (20 classes). A comprehensive plan is not zoning (Tex. Local Gov't Code §213.005)." },
  slHydrants: { notes: "The city's hydrant inspection layer (5,919; last edited 2021-02-23). Only FacilityID and InstallDate are requested — the rest carry editor names and work orders." },
  slCups: { notes: "Conditional use permits (69). Same records as the city's Planning/CUPs service." },
  slSpecialExceptions: { notes: "Special exceptions (244), mostly setback relief. Same records as the city's Planning/Special_Exceptions service." },
  slVariances: { notes: "Variances (160, newest 2016). Same records as the city's Planning/Variances service." },
  slCip: { notes: "The 2024 capital project list, narrowed to projects not yet closed out. Manager, engineer, contractor and inspector fields are never requested." },
  slRowLand: { notes: "Publicly owned ground (6,448): road right-of-way, parcels, reserves, easements. Loads at close zoom." },
  slTirz: { notes: "The city's four tax increment reinvestment zones (TIRZ 2 is inactive)." },
  slAvailableSites: { notes: "Available sites the city's economic development office lists (23); last edited 2022-05-11." },
  slDevProjects: { notes: "The city's development project tracker (47). Contractor and superintendent contacts are never requested." },
};
