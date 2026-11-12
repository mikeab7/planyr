/* NEW-1 / NEW-2 (Texas city zoning, 2026-11-12) — the VERIFICATION payload of the city zoning rows (`sourcesTxCityZoning.js`), off the app bundle like every other row's fixtures
 * (see sourceFixtures.js). Spread into SOURCE_FIXTURES / SOURCE_DOCS there.
 *
 * Every point is a VERTEX of a real polygon of that layer (read from the layer's own geometry, WGS84, 2026-11-12) near the city's core, so the verifier's ±0.01° box around it holds that
 * polygon (expectMinCount 1) by construction; the "bbox" counts are how many polygons' bounding boxes reach that box, an upper bound on the verifier's own count. */

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
    { label: "Webster city centre (PROVISIONAL)", point: [-95.1183, 29.5379], expectMinCount: 1 },
    { label: "East Webster, NASA Road 1 area (PROVISIONAL)", point: [-95.0933, 29.5379], expectMinCount: 1 },
  ] },
};

export const TX_CITY_ZONING_DOCS = {
  richmondZoning: { notes: "The City of Richmond's zoning districts (114): GR, SC, GC, PI, OT, MU, SR, DN, IN. Names are the layer's own descriptions; the 17 *_Standards fields are links into the city's online code (four are offered). Layer edited 2021-03-23." },
  fulshearZoning: { notes: "The City of Fulshear's earlier zoning layer (67). Overlaps the newer layer, which re-codes much of the same ground. Layer edited 2023-09-06." },
  fulshearZoningNewer: { notes: "The City of Fulshear's newer zoning layer (9): recent rezonings under the city's new district codes, plus two areas the earlier layer never covered. Layer edited 2026-10-26." },
  staffordZoning: { notes: "The City of Stafford's zoning designations (11). Names are the layer's own descriptions; CODE_LINK is a Municode link on ten (MU-2 holds an ordinance-number note instead). Layer edited 2024-04-10." },
  websterZoning: { notes: "PROVISIONAL (NEW-2): not yet measured." },
};
