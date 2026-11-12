/* NEW-1 / NEW-2 (Texas city zoning — Richmond, Fulshear, Stafford, Webster; 2026-11-12) — THE GIS REGISTRY ROWS of the Texas city zoning layers.
 *
 * THIS FIRST CUT CARRIES ONLY WEBSTER'S ROW, and it is provisional on purpose. Webster's zoning lives on the city's own ArcGIS Server (www1.cityofwebster.com), which sends no CORS header and
 * which the build sandbox's egress refuses (403 on CONNECT; the host does not resolve for WebFetch), so its fields, polygon count and CORS could not be read from a build sandbox. The
 * same-origin /gis-proxy relay can reach it only once the host is on ALLOWED_HOSTS — and the relay suite requires a registry row that reads a listed host — so the host and this row land
 * first, the layer is MEASURED through planyr.io/gis-proxy, and the layer's fields, fixtures and counts are filled in from that measurement in the next change. Until then `fields` is empty and
 * the fixtures are a city-centre guess marked PROVISIONAL (the weekly drift verifier will say if they are wrong; nothing draws this row yet). */

export const WEBSTER_ZONING_URL = "https://www1.cityofwebster.com/arcgis/rest/services/Landbase/Zoning/MapServer/0";

const base = { states: ["TX"], tier: "production", lastVerified: "2026-11-12", layerId: null, geometryType: "polygon" };

export const TX_CITY_ZONING_SOURCES = {
  websterZoning: {
    key: "websterZoning", label: "Zoning districts (City of Webster)", provider: "City of Webster — Planning (zoning districts)",
    serviceUrl: WEBSTER_ZONING_URL, relay: true, coverage: "webster", fields: {},
    ...base,
    // PROVISIONAL 2026-11-12: layer 0 of Landbase/Zoning/MapServer ("Zoning", per the 2026-10-30 sweep; layers 0 and 1 are both named Zoning). Not yet measured from here.
  },
};

/* Every row's real coverage is one city's limits — a "local" fixture class (≥2 points, ≥2 km apart), not the state class a Texas scope implies. */
const CITY_ONLY = (what, city) => ["local", `${what} — the City of ${city} only; probing it in Dallas or elsewhere in Houston would assert a guaranteed zero.`];
export const TX_CITY_ZONING_FIXTURE_REACH = Object.fromEntries(Object.entries(TX_CITY_ZONING_SOURCES).map(([k, s]) => [k, CITY_ONLY(s.label, /Richmond|Fulshear|Stafford|Webster/.exec(s.label)[0])]));
