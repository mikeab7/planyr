/* NEW-1 (Waller County layers, 2026-11-24) — the VERIFICATION payload of the Waller registry rows (`sourcesWaller.js`), off the app bundle exactly like every other row's fixtures
 * (see sourceFixtures.js). Spread into SOURCE_FIXTURES / SOURCE_DOCS there with one line each.
 *
 * ⛔ HONESTY ABOUT WHAT WAS MEASURED. The build sandbox's egress blocks the county's ArcGIS Online host (services1.arcgis.com answers "no rule allows this host"), so the only numbers here are the
 * ones the 2026-11-22 sweep recorded from an unblocked network: the COUNTYWIDE feature counts (242 proposed thoroughfares, 28 CCN polygons, 44 MUDs, 49 floodway-buffer polygons) and one named
 * point ("Waller County MUD 19" at -95.93, 29.785). Those are the `expectMinCount: 1` fixtures. The west-half / east-half boxes exist to satisfy the two-places-≥2-km-apart reach rule and
 * assert `expectMinCount: 0` — "the service ANSWERS a count query here" — because no per-area count was measured and none is invented (B209505). The two Conservancy rows carry no
 * measured count either, so both of their fixtures are 0. The live pass (V#) widens every fixture to the real per-area counts. (Service URLs and attribute names were later measured live — 2026-11-24, build a181f59 — and are pinned in sourcesWaller.js.) */

const COUNTY = [-96.19, 29.73, -95.8, 30.25]; // Waller County's bundled polygon extent, rounded outward
const WEST = [-96.19, 29.73, -95.99, 30.25];
const EAST = [-95.99, 29.73, -95.8, 30.25];
const halves = (what) => [
  { label: `${what} — western half of Waller County (answers a count query; count not yet measured)`, bbox: WEST, expectMinCount: 0 },
  { label: `${what} — eastern half of Waller County (answers a count query; count not yet measured)`, bbox: EAST, expectMinCount: 0 },
];

export const WALLER_FIXTURES = {
  wallerThoroughfare: { fixtures: [{ label: "Waller County, countywide (sweep 2026-11-22: 242 proposed lines)", bbox: COUNTY, expectMinCount: 1 }, ...halves("Proposed thoroughfares")] },
  wallerCpcEasements: { fixtures: halves("Katy Prairie Conservancy easements") },
  wallerCpcOwned: { fixtures: halves("Katy Prairie Conservancy owned land") },
  wallerCcn: { fixtures: [{ label: "Waller County, countywide (sweep 2026-11-22: 28 CCN polygons)", bbox: COUNTY, expectMinCount: 1 }, ...halves("CCN service areas")] },
  wallerMud: { fixtures: [
    { label: "Waller County MUD 19 (sweep 2026-11-22 named point)", point: [-95.93, 29.785], expectMinCount: 1 },
    { label: "Waller County, countywide (sweep 2026-11-22: 44 MUDs)", bbox: COUNTY, expectMinCount: 1 },
    ...halves("MUDs"),
  ] },
  wallerFloodwayBuffer: { fixtures: [{ label: "Waller County, countywide (sweep 2026-11-22: 49 buffer polygons)", bbox: COUNTY, expectMinCount: 1 }, ...halves("Floodway buffer")] },
};

export const WALLER_DOCS = {
  wallerThoroughfare: { notes: "Waller County's Major Thoroughfare Plan, proposed roadways (242 lines, edited 2025-12-11): ROW_CLASS, ProposeROW, StreetName, Status. A planned alignment, not surveyed right-of-way." },
  wallerCpcEasements: { notes: "Katy Prairie Conservancy conservation easements (CPC_Protected_Properties_2024): Name, CE_holder. Protected land." },
  wallerCpcOwned: { notes: "Land the Katy Prairie Conservancy owns outright (CPC_owned_2024)." },
  wallerCcn: { notes: "Certificated water / sewer service areas (CCN_Boundaries, 28 polygons): who serves the site. " },
  wallerMud: { notes: "Municipal utility districts in Waller County (44 polygons). The statewide TCEQ water-district row also draws MUDs; this is the county's own copy." },
  wallerFloodwayBuffer: { notes: "The county's own drawn 100-foot floodway buffer (49 polygons, 2023-11). Map layer only: the screening math keeps its modelled floodwayBufferFt." },
};
