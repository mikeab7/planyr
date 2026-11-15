/* NEW-1 / NEW-2 (Texas city zoning, 2026-11-12; Webster 2026-11-15) — the VERIFICATION payload of the city zoning rows (`sourcesTxCityZoning.js`), off the app bundle like every other row's fixtures.
 *
 * Every point sits ON a real polygon of that layer (read from the layer's own geometry, WGS84): a vertex near the city's core (Richmond, Fulshear, Stafford) or the DEEPEST point of a polygon
 * (Webster, read through the relay), so the verifier's ±0.01° box around it holds that polygon (expectMinCount 1) by construction; the "bbox" counts are how many polygons' bounding boxes reach
 * that box, an upper bound on the verifier's own count. */

export const TX_CITY_ZONING_FIXTURES = {
  richmondZoning: { fixtures: [
    { label: "Downtown Richmond", point: [-95.76094, 29.5822], expectMinCount: 1 }, // bbox: 55
    { label: "North-east Richmond", point: [-95.73781, 29.59805], expectMinCount: 1 }, // bbox: 6
  ] },
  fulshearZoning: { fixtures: [
    { label: "Fulshear downtown (FM 359 / FM 1093)", point: [-95.89986, 29.69419], expectMinCount: 1 }, // bbox: 38
    { label: "North Fulshear", point: [-95.88144, 29.72032], expectMinCount: 1 }, // bbox: 1
  ] },
  fulshearZoningNewer: { fixtures: [
    { label: "Fulshear downtown (FM 359 / FM 1093)", point: [-95.89986, 29.69419], expectMinCount: 1 }, // bbox: 7
    { label: "South-west Fulshear", point: [-95.92006, 29.67256], expectMinCount: 1 }, // bbox: 4
  ] },
  staffordZoning: { fixtures: [
    { label: "Stafford core", point: [-95.5574, 29.61618], expectMinCount: 1 }, // bbox: 10
    { label: "North-east Stafford", point: [-95.53772, 29.63347], expectMinCount: 1 }, // bbox: 5
  ] },
  websterZoning: { fixtures: [
    { label: "East Webster — industrial (M1)", point: [-95.10914, 29.5203], expectMinCount: 1 }, // bbox: 13
    { label: "West Webster — C3", point: [-95.13606, 29.53991], expectMinCount: 1 }, // bbox: 47
  ] },
  websterPlannedDev: { fixtures: [
    { label: "South Webster — planned development", point: [-95.1249, 29.51375], expectMinCount: 1 }, // bbox: 14
    { label: "North-east Webster — planned development", point: [-95.10681, 29.52948], expectMinCount: 1 }, // bbox: 21
  ] },
};

export const TX_CITY_ZONING_DOCS = {
  richmondZoning: { notes: "The City of Richmond's zoning districts (114): GR, SC, GC, PI, OT, MU, SR, DN, IN. Names are the layer's own descriptions; the 17 *_Standards fields are links into the city's online code (four are offered). Layer edited 2021-03-23." },
  fulshearZoning: { notes: "The City of Fulshear's earlier zoning layer (67). Overlaps the newer layer, which re-codes much of the same ground. Layer edited 2023-09-06." },
  fulshearZoningNewer: { notes: "The City of Fulshear's newer zoning layer (9): recent rezonings under the city's new district codes, plus two areas the earlier layer never covered. Layer edited 2026-10-26." },
  staffordZoning: { notes: "The City of Stafford's zoning designations (11). Names are the layer's own descriptions; CODE_LINK is a Municode link on ten (MU-2 holds an ordinance-number note instead). Layer edited 2024-04-10." },
  websterZoning: { notes: "The City of Webster's base zoning districts (226): C1, C2, C3, NP, O, M1, R1, R1A, R2. Names are the layer's own renderer labels. Same MapServer as the planned-development layer; read through /gis-proxy. Layer edited 2025-12-29." },
  websterPlannedDev: { notes: "The City of Webster's planned development districts (45; 17 with a named development guide). Do not overlap the base layer. PD_Guide_Hyperlink is typed with backslashes on most rows (mended before use). Layer edited 2025-12-29." },
};
