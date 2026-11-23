/* Oklahoma rows that eager modules need WITHOUT loading oklahomaLayers.js (the lazy per-state layer file, batch K):
 * the volume tiers (layerWeight.js) and the two vector boundary sources (vectorLayers.js). Re-exported from oklahomaLayers.js. */
import { GIS_SOURCES } from "../../../shared/gis/sources.js";

/* The volume tier of every Oklahoma row (layerWeight.js LAYER_TIER — declared per layer, never inferred). Nothing here STOPS a build on its own: wells, tanks, cleanup
 * sites, dams and the protected-water layers are look-up facts (reference); the county / city lines are orientation (context). */
export const OK_LAYER_TIERS = {
  ok_county: "context", ok_city: "context", ok_road: "reference",
  ok_tribal: "reference", ok_cherokee_res: "reference", ok_cherokee_land: "reference",
  ok_wells: "reference", ok_pst: "reference",
  ok_deq_superfund: "reference", ok_deq_rcra: "reference", ok_deq_restrictions: "reference", ok_deq_vcp: "reference", ok_deq_scap: "reference", ok_deq_brownfields: "reference", ok_occ_brownfields: "reference", ok_pst_releases: "reference",
  ok_deq_solid_waste: "reference", ok_deq_haz_waste: "reference",
  ok_deq_whpa: "reference", ok_deq_well_buffers: "reference", ok_deq_intakes: "reference",
  ok_deq_appb_areas: "reference", ok_deq_appb_streams: "reference", ok_owrb_scenic: "reference", ok_owrb_special_ws: "reference", ok_deq_sensitive: "reference", ok_deq_303d: "reference",
  ok_dams: "reference", ok_nrhp: "reference", ok_cemeteries: "reference", ok_crit_habitat: "reference", ok_water_systems: "reference",
};

/* =============================================================== Vector sources (ok_county, ok_city) =============================================================== */
/* The Georgia pattern (vectorLayers.VECTOR_SOURCES): registered in the SAME commit as the layer rows (test/vectorLayerRegistered fails otherwise). Endpoints are the
 * registry rows'. Probed 2026-10-29: 77 counties in ONE statewide pull; 597 cities, so the city tier is bbox-cell only. */
export const OK_VECTOR_SOURCES = {
  ok_county: {
    id: "ok_county",
    label: "County boundaries (Oklahoma)",
    labelField: GIS_SOURCES.okCounty.fields.name,
    labelZoom: { min: 6, max: 11 },
    nameTemplate: "{name} County",
    stateAbbr: "OK", // the county label adds ", OK" only when the view is centred in a different state (B2507065)
    titleCaseLabel: true,
    identifyNote: "This county has jurisdiction here (it can tax/regulate) — outside city limits, ask it what land-use rules apply; Oklahoma counties vary. A boundary is not a utility service area. Screening only.",
    sourceName: "Oklahoma DOT",
    liveFallback: true,
    query: {
      url: GIS_SOURCES.okCounty.serviceUrl + "/query",
      outFields: [GIS_SOURCES.okCounty.fields.name, GIS_SOURCES.okCounty.fields.fips],
      where: "1=1",
      pageSize: 1000,
      maxFeatures: 4000,
      ttl: 30 * 24 * 3600 * 1000, // Oklahoma's 77-county roster has not changed since statehood
      minVectorZoom: 0,
      maxAreaDeg: Infinity,
      tiers: [
        { maxZoom: 11, scope: "all", offsetDeg: 0.002, precision: 4 },
        { scope: "bbox", offsetDeg: 0.0002, precision: 5, cellDeg: 0.25 },
      ],
    },
    note: "Oklahoma county lines (ODOT).",
  },
  ok_city: {
    id: "ok_city",
    label: "City limits (Oklahoma)",
    labelField: GIS_SOURCES.okCity.fields.name,
    labelZoom: { min: 10, max: 13 },
    nameTemplate: "{name} — city limits",
    titleCaseLabel: true,
    identifyNote: "Inside this line is in the city (it has jurisdiction — can tax/regulate); outside is unincorporated county. ETJ is not mapped for Oklahoma. NOT proof of utility service. Screening only.",
    sourceName: "Oklahoma DOT (Oklahoma Tax Commission)",
    liveFallback: true,
    query: {
      url: GIS_SOURCES.okCity.serviceUrl + "/query",
      outFields: [GIS_SOURCES.okCity.fields.name],
      where: "1=1",
      pageSize: 1000,
      maxFeatures: 4000,
      ttl: 14 * 24 * 3600 * 1000, // annexations move city limits occasionally
      minVectorZoom: 0,
      maxAreaDeg: Infinity,
      tiers: [
        { maxZoom: 10, scope: "bbox", offsetDeg: 0.003, precision: 3, cellDeg: 1 },
        { maxZoom: 12, scope: "bbox", offsetDeg: 0.001, precision: 4, cellDeg: 0.5 },
        { scope: "bbox", offsetDeg: 0.0002, precision: 5, cellDeg: 0.25 },
      ],
    },
    note: "Oklahoma city limits (ODOT, from the Oklahoma Tax Commission).",
  },
};
