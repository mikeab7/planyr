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
  // NEW-1 (2026-11-06) — the water and sewer network (CDM Smith's public copy). Each point is a vertex of a real feature; the count is the ±0.01° box on 2026-11-06.
  slWaterLines: { fixtures: [
    { label: "Academy site", point: [-95.6593, 29.60832], expectMinCount: 1 }, // live 2026-11-06: 370
    { label: "City Hall / Town Square", point: [-95.62623, 29.62596], expectMinCount: 1 }, // live 2026-11-06: 877
    { label: "South-east Sugar Land", point: [-95.597, 29.57525], expectMinCount: 1 }, // live 2026-11-06: 1209
  ] },
  slSewerGravity: { fixtures: [
    { label: "Academy site", point: [-95.66001, 29.60802], expectMinCount: 1 }, // live 2026-11-06: 148
    { label: "City Hall / Town Square", point: [-95.64267, 29.61572], expectMinCount: 1 }, // live 2026-11-06: 535
    { label: "South-east Sugar Land", point: [-95.60969, 29.58212], expectMinCount: 1 }, // live 2026-11-06: 890
  ] },
  slSewerLaterals: { fixtures: [
    { label: "Academy site", point: [-95.65979, 29.60491], expectMinCount: 1 }, // live 2026-11-06: 30
    { label: "City Hall / Town Square", point: [-95.62525, 29.61281], expectMinCount: 1 }, // live 2026-11-06: 131
    { label: "South-east Sugar Land", point: [-95.60034, 29.58358], expectMinCount: 1 }, // live 2026-11-06: 123
  ] },
  slSewerForce: { fixtures: [
    { label: "City Hall / Town Square", point: [-95.63951, 29.62213], expectMinCount: 1 }, // live 2026-11-06: 16
    { label: "South-east Sugar Land", point: [-95.59477, 29.57272], expectMinCount: 1 }, // live 2026-11-06: 7
  ] },
  slWaterValves: { fixtures: [
    { label: "Academy site", point: [-95.66054, 29.60786], expectMinCount: 1 }, // live 2026-11-06: 128
    { label: "City Hall / Town Square", point: [-95.6363, 29.62859], expectMinCount: 1 }, // live 2026-11-06: 551
    { label: "South-east Sugar Land", point: [-95.59414, 29.58993], expectMinCount: 1 }, // live 2026-11-06: 666
  ] },
  slWaterControlValves: { fixtures: [
    { label: "Real feature 1", point: [-95.61947, 29.58638], expectMinCount: 1 }, // live 2026-11-06: 6
    { label: "Real feature 2", point: [-95.65281, 29.62756], expectMinCount: 1 }, // live 2026-11-06: 4
    { label: "Real feature 3", point: [-95.61906, 29.63394], expectMinCount: 1 }, // live 2026-11-06: 4
  ] },
  slManholes: { fixtures: [
    { label: "Academy site", point: [-95.65952, 29.60819], expectMinCount: 1 }, // live 2026-11-06: 149
    { label: "City Hall / Town Square", point: [-95.62833, 29.62959], expectMinCount: 1 }, // live 2026-11-06: 429
    { label: "South-east Sugar Land", point: [-95.59412, 29.58847], expectMinCount: 1 }, // live 2026-11-06: 844
  ] },
  slCleanouts: { fixtures: [
    { label: "Real feature 1", point: [-95.61195, 29.65543], expectMinCount: 1 }, // live 2026-11-06: 32
    { label: "Real feature 2", point: [-95.58369, 29.61015], expectMinCount: 1 }, // live 2026-11-06: 10
    { label: "Real feature 3", point: [-95.59492, 29.57949], expectMinCount: 1 }, // live 2026-11-06: 29
  ] },
  slLiftStations: { fixtures: [
    { label: "City Hall / Town Square", point: [-95.63495, 29.62955], expectMinCount: 1 }, // live 2026-11-06: 12
    { label: "South-east Sugar Land", point: [-95.59475, 29.57272], expectMinCount: 1 }, // live 2026-11-06: 8
  ] },
  slWwtp: { fixtures: [
    { label: "Real feature 1", point: [-95.69606, 29.57712], expectMinCount: 1 }, // live 2026-11-06: 1
    { label: "Real feature 2", point: [-95.68774, 29.54707], expectMinCount: 1 }, // live 2026-11-06: 2
    { label: "Real feature 3", point: [-95.594, 29.55495], expectMinCount: 1 }, // live 2026-11-06: 1
  ] },
  slWaterPlants: { fixtures: [
    { label: "Real feature 1", point: [-95.60658, 29.64129], expectMinCount: 1 }, // live 2026-11-06: 2
    { label: "Real feature 2", point: [-95.5945, 29.59178], expectMinCount: 1 }, // live 2026-11-06: 2
    { label: "Real feature 3", point: [-95.68731, 29.5592], expectMinCount: 1 }, // live 2026-11-06: 5
  ] },
  slWaterWells: { fixtures: [
    { label: "Real feature 1", point: [-95.61653, 29.62782], expectMinCount: 1 }, // live 2026-11-06: 4
    { label: "Real feature 2", point: [-95.61944, 29.58636], expectMinCount: 1 }, // live 2026-11-06: 3
    { label: "Real feature 3", point: [-95.68413, 29.56546], expectMinCount: 1 }, // live 2026-11-06: 2
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
  slWaterLines: { notes: "The water mains (32,175; IWRP - Pressurized Main, layer 17): drinking, raw, reclaimed and chemical-feed lines. Newest install date Jan 2017; layer last edited 2025-11-20. Removed lines are left out; abandoned ones are drawn grey." },
  slSewerGravity: { notes: "The gravity sewer mains (16,049; IWRP - Gravity Main, layer 20). Newest install date Jan 2017; layer last edited 2025-12-23. Proposed lines, removed lines and the 11 typed Storm are left out." },
  slSewerLaterals: { notes: "Sewer service laterals (8,260; IWRP - Lateral Line, layer 19). Newest install date Jan 2017; layer last edited 2021-11-10." },
  slSewerForce: { notes: "Sewer force mains (189; IWRP - Pressurized Mains, layer 18 — every one WaterType Sewage; the WATER pressure mains are layer 17). Layer last edited 2021-11-10." },
  slWaterValves: { notes: "Water system valves (14,648; IWRP - System Valve, layer 2). Layer last edited 2021-11-10." },
  slWaterControlValves: { notes: "Water control valves (51; IWRP - Control Valve, layer 9)." },
  slManholes: { notes: "Sewer manholes (15,135; IWRP - Manhole, layer 13). Layer last edited 2021-11-10." },
  slCleanouts: { notes: "Sewer clean-outs (1,065; IWRP - Clean Out, layer 16)." },
  slLiftStations: { notes: "Sewer lift stations (116; Lift Stations, layer 23)." },
  slWwtp: { notes: "Wastewater treatment plants (5; WWTP, layer 22). The Latitude / Longitude attributes read 0; the geometry is correct." },
  slWaterPlants: { notes: "Water plant facilities (78; layer 21)." },
  slWaterWells: { notes: "Water production wells (22; IWRP - Production Wells, layer 4)." },
};
