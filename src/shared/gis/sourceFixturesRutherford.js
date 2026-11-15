/* NEW-1 (Rutherford County TN zoning, 2026-11-12) — the VERIFICATION payload of the Rutherford zoning rows (`sourcesRutherford.js`), off the app bundle exactly like every other row's fixtures.
 *
 * Every point is a spot the layer is KNOWN to answer, and every count is what the verifier's ±0.01° box returned on 2026-11-12 against the service itself (with the row's own `where`):
 * Capital Way (parcel 156-027.00-000, Christiana) sits in the county's 164-acre EAC polygon; 1975 Joe B Jackson Pkwy (parcel 126-050.12-000) in a Murfreesboro L-I polygon (GenZoning IND);
 * -86.52, 35.98 in a Smyrna R-1 polygon (ZONING_DIST 11); the two La Vergne points are on I-1 polygons. */

export const RUTHERFORD_FIXTURES = {
  rutherfordCountyZoning: { fixtures: [
    { label: "Capital Way, Christiana (EAC)", point: [-86.3254, 35.7208], expectMinCount: 1 }, // live: 22
    { label: "Western Rutherford (Light Industrial)", point: [-86.57461, 35.84943], expectMinCount: 1 }, // live: 17
  ] },
  murfreesboroZoning: { fixtures: [
    { label: "1975 Joe B Jackson Pkwy (L-I)", point: [-86.36112, 35.78075], expectMinCount: 1 }, // live: 23
    { label: "Downtown Murfreesboro (CBD)", point: [-86.39232, 35.84769], expectMinCount: 1 }, // live: 282
  ] },
  smyrnaZoning: { fixtures: [
    { label: "Smyrna (R-1)", point: [-86.52, 35.98], expectMinCount: 1 }, // live: 222
    { label: "Smyrna, airport side (I-1)", point: [-86.48718, 35.95042], expectMinCount: 1 }, // live: 46
  ] },
  lavergneZoning: { fixtures: [
    { label: "La Vergne, north (I-1)", point: [-86.5383, 36.00183], expectMinCount: 1 }, // live: 24
    { label: "La Vergne, east (I-1)", point: [-86.57473, 36.0166], expectMinCount: 1 }, // live: 120
  ] },
};

export const RUTHERFORD_DOCS = {
  rutherfordCountyZoning: { notes: "Rutherford County Planning's zoning (2,065 polygons, edited 2026-10-28). 258 of them are CITY / ANNEXED fill for incorporated ground — a hole in the county's zoning, never a district — and are filtered out. The table lags annexations: some 'district' polygons now sit inside a city's limits." },
  murfreesboroZoning: { notes: "The City of Murfreesboro's zoning (layer 45 of its dated-snapshot service; 4,346 polygons, edited 2024-04-09). The 1,555 street right-of-way polygons (ParcelType r) are not drawn. Its URL column holds the ordinance link but also a REST address and local file paths — only a murfreesborotn.gov DocumentCenter link is offered." },
  smyrnaZoning: { notes: "The Town of Smyrna's zoning (1,296 polygons, edited 2024-03-06). ZONING_DIST is an integer with a 24-value domain; codes 26–30 are in the data but not in the domain and show as Unlisted. The sibling ZONE_ID domain disagrees with ZONING_DIST on 13 polygons; the card shows both." },
  lavergneZoning: { notes: "The City of La Vergne's zoning (579 polygons, edited 2024-03-06). Zoning_Typ's coded-value domain carries the district names." },
};
