/* NEW-1 / NEW-2 (Texas city zoning, 2026-11-12) — the VERIFICATION payload of the Texas city zoning rows (`sourcesTxCityZoning.js`), off the app bundle like every other row's fixtures.
 * PROVISIONAL (Webster only in this cut): the two points are the city's centre and a point ~2.5 km east on the same developed grid, NOT vertices of a measured polygon — they are replaced by
 * measured vertices once the layer has been read through the relay (the next change). */

export const TX_CITY_ZONING_FIXTURES = {
  websterZoning: { fixtures: [
    { label: "Webster city centre (PROVISIONAL)", point: [-95.1183, 29.5379], expectMinCount: 1 },
    { label: "East Webster, NASA Road 1 area (PROVISIONAL)", point: [-95.0933, 29.5379], expectMinCount: 1 },
  ] },
};

export const TX_CITY_ZONING_DOCS = {
  websterZoning: { notes: "The City of Webster's zoning layer (Landbase/Zoning/MapServer/0), read through the /gis-proxy relay. PROVISIONAL: not yet measured — fields and fixtures are filled in from a relay measurement in the next change." },
};
