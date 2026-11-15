/* NEW-1 / NEW-3 (Metro Nashville zoning sweep, 2026-11-12) — the VERIFICATION payload of the Nashville registry rows (`sourcesNashville.js`), off the app bundle exactly like every other row's
 * fixtures (see sourceFixtures.js). Spread into SOURCE_FIXTURES / SOURCE_DOCS there with one line each.
 *
 * Every point sits ON a real feature (a polygon centroid, re-queried to confirm it intersects) and every count is what a point query returned on 2026-11-12 against Metro's org
 * (services2.arcgis.com/HdTo6HJqh92wn4D8, read directly — CORS open). The Community Character Policy row is the exception, said on the row. */

const ELM_HILL = [-86.715502, 36.148911]; // Elm Hill Pike — zoned IR (Industrial Restrictive), ordinance O73-650, 1974-12-24; also in the Airport Impact overlay

export const NASHVILLE_FIXTURES = {
  nashZoning: { fixtures: [
    { label: "Elm Hill Pike (IR)", point: ELM_HILL, expectMinCount: 1 }, // live 2026-11-12: 1
    { label: "Downtown Nashville", point: [-86.7816, 36.1627], expectMinCount: 1 }, // live: 1
    { label: "Antioch", point: [-86.66, 36.06], expectMinCount: 1 }, // live: 1
    { label: "Madison", point: [-86.71, 36.26], expectMinCount: 1 }, // live: 1
  ] },
  nashOverlays: { fixtures: [
    { label: "Vultee Blvd (Airport Impact)", point: [-86.7176, 36.1222], expectMinCount: 1 }, // live 2026-11-12: 1
    { label: "Elm Hill Pike (Airport Impact)", point: ELM_HILL, expectMinCount: 1 }, // live: 1
    { label: "Downtown Nashville", point: [-86.7742, 36.1581], expectMinCount: 1 }, // live: 3
  ] },
  nashDtc: { fixtures: [
    { label: "Sulphur Dell", point: [-86.78472, 36.17218], expectMinCount: 1 }, // live 2026-11-12: 1
    { label: "Lafayette", point: [-86.77418, 36.15267], expectMinCount: 1 }, // live: 1
    { label: "Core", point: [-86.78275, 36.16238], expectMinCount: 1 }, // live: 1
  ] },
  nashPud: { fixtures: [
    { label: "Bellevue area PUD", point: [-86.80306, 36.12486], expectMinCount: 1 }, // live 2026-11-12: 1
    { label: "Antioch area PUD", point: [-86.64596, 36.08605], expectMinCount: 1 }, // live: 1
    { label: "Southwest Davidson PUD", point: [-86.92079, 36.07988], expectMinCount: 1 }, // live: 1
  ] },
  nashSatellite: { fixtures: [
    { label: "Belle Meade", point: [-86.85619, 36.09902], expectMinCount: 1 }, // live 2026-11-12: 1
    { label: "Goodlettsville", point: [-86.71659, 36.31435], expectMinCount: 1 }, // live: 1
    { label: "Oak Hill", point: [-86.78569, 36.07366], expectMinCount: 1 }, // live: 1
  ] },
  nashCcm: { fixtures: [
    // NOT measured in this build: maps.nashville.gov is refused by the build environment's egress. The sweep (2026-11-01) read a Conservation ("CO") policy at the Elm Hill Pike site; the policy
    // layer covers the whole county (33,105 polygons), so the downtown point is expected to answer too. SOURCE_FIXTURE_REACH_PENDING names V2115889, which measures both through the deployed relay.
    { label: "Elm Hill Pike (CO — Conservation)", point: ELM_HILL, expectMinCount: 1 },
    { label: "Downtown Nashville", point: [-86.7816, 36.1627], expectMinCount: 1 },
  ] },
};

export const NASHVILLE_DOCS = {
  nashZoning: { notes: "Metro's zoning districts (6,027 polygons, 92 distinct codes; edited 2026-11-12). ZONE_DESC is the code only — district names are NOT in the data and come from Title 17, 17.08.010 (lib/nashvilleZoningNames.js). SP polygons carry the specific plan's name in NAME. Land in a satellite city reads \"Satellite City\": that city zones it, not Metro." },
  nashOverlays: { notes: "Metro's overlay districts (332 polygons, 19 values in use). ZONE_DESC is already a plain-words name; SUBDISTRICT, IMPACT_ZONE and NAME add detail on some. Overlays add to the base zoning, they do not replace it." },
  nashDtc: { notes: "The Downtown Code's 17 named subdistricts in five use areas (18 polygons). The DTC base zone itself is the \"DTC\" code in the zoning layer." },
  nashPud: { notes: "Planned unit developments (876 polygons). The PUD's own plan, not the underlying base zone, sets what is allowed; ZONE_DESC is shown exactly as typed." },
  nashSatellite: { notes: "The six satellite cities (8 polygons). Used to name the city a site falls in, never drawn as a zoning layer." },
  nashCcm: { notes: "NashvilleNext Community Character Manual policy polygons (33,105): PolicyCode, PolicyDesc, Transect, DateAdopted. A planning policy, not zoning. Read through the /gis-proxy relay (maps.nashville.gov)." },
};
