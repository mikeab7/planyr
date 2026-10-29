/* NEW-1 (DeSoto County MS, B2507059) — the pure Mississippi jurisdiction facts: where to ask, and what the label may say.
 *
 * Mississippi is wired for ONE county here (DeSoto, whose GIS publishes its own County Outline and Municipalities layers). Outside DeSoto County nothing changes — the app
 * knows no Mississippi county or city layer, so a Mississippi site elsewhere still shows no jurisdiction (never a guessed one).
 *
 * The routing box is a hint, not an answer: it overlaps Tennessee's along the state line (Southaven and Horn Lake sit within a mile of Shelby County), so a point in both asks
 * BOTH states' county layers and the one that names a county decides. Mississippi has NO ETJ and outside the five cities (Olive Branch, Southaven, Horn Lake, Hernando, Walls)
 * the county governs — the label reads "Unincorporated DeSoto County, MS". */
export const MS_DESOTO_ENVELOPE = { latMin: 34.68, latMax: 35.01, lonMin: -90.35, lonMax: -89.65 };
export const inDeSotoEnvelope = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= MS_DESOTO_ENVELOPE.latMin && lat <= MS_DESOTO_ENVELOPE.latMax && lng >= MS_DESOTO_ENVELOPE.lonMin && lng <= MS_DESOTO_ENVELOPE.lonMax;

const RELAY = "/gis-proxy/gis.desotocountyms.gov/arcgis/rest/services/BaseLayers/MapServer";
export const MS_COUNTY_URL = `${RELAY}/8`;   // "County Outline" — one polygon, COUNTY = "DeSoto"
export const MS_CITY_URL = `${RELAY}/4`;     // "Municipalities" — five polygons, NAME = OLIVE BRANCH · SOUTHAVEN · HORN LAKE · HERNANDO · WALLS
export const MS_COUNTY_GOVERNS_NOTE = "Mississippi has no ETJ: outside a city's limits the county governs.";
