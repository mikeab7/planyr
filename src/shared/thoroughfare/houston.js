/* City of Houston Major Thoroughfare & Freeway Plan (MTFP) ingestion config (B721) — ONE config
 * per jurisdiction. B722 generalizes this exact shape to the surrounding jurisdictions. The pure
 * transform (ingestTransform.js) reads this; the runnable adapter is server/ingest/thoroughfare.mjs.
 *
 * ⚠ VERIFY-LIVE (V274): the org egress policy blocks houstontx.gov from the build sandbox, so the
 * field names, the ROW_STATUS / HIER_TABLE / ST_STATUS domain VALUES, and the Chapter-42 ROW widths
 * below are the DOCUMENTED spec, not yet reconciled against the live layer. The live run must fetch
 * the layer metadata (`?f=json`), confirm/adjust the field map + crosswalk against the real coded
 * domains, seed the verified width table, then load segments. */

export const HOUSTON = {
  jurisdiction: "coh", // matches the jurisdictions registry seed (B720)
  serviceUrl:
    "https://mycity2.houstontx.gov/pubgis02/rest/services/HoustonMap/Transportation/MapServer/1",
  sourceUrl: "https://www.houstontx.gov/planning/transportation/MTFP.html",
  planName: "City of Houston Major Thoroughfare & Freeway Plan (MTFP)",
  planAdoptedDate: null, // read from the layer / plan metadata at ingest (B726 tracks vintage)
  where: "1=1",
  idField: "OBJECTID", // ArcGIS objectIdField → the idempotency key (verify the real name live)

  // Field candidates (first present wins). Documented mapping — verify against the live layer.
  fieldMap: {
    street_name: ["FULL_NAME", "NAME"],
    classification: ["HIER_TABLE", "ROW_STATUS"], // functional hierarchy → our class
    status: ["ST_STATUS"], // existing / proposed
  },

  // Houston hierarchy value → canonical class. Keys are lowercased (normalizeClassification
  // lowercases + trims the raw value before lookup). Best-effort domain values pending V274.
  classificationCrosswalk: {
    freeway: "freeway",
    "freeway/expressway": "freeway",
    expressway: "freeway",
    transitway: "freeway",
    "major thoroughfare": "major_thoroughfare",
    "principal thoroughfare": "major_thoroughfare",
    thoroughfare: "major_thoroughfare",
    "transit corridor": "transit_corridor",
    "transit corridor street": "transit_corridor",
    "major collector": "collector_major",
    collector: "collector_major",
    "collector street": "collector_major",
    "minor collector": "collector_minor",
  },
};

/* Houston Chapter-42 / MTFP minimum ROW by classification → seeds jurisdiction_row_standards (B720).
 *
 * major_thoroughfare = 100 ft is CONFIRMED: Houston Code of Ordinances §42-122 requires the lesser
 * of 100 ft or the width the MTFP street-hierarchy classification specifies. The other classes are
 * left NULL on purpose — their exact widths come from the official "MTFP Minimum ROW Width by Street
 * Classification" table, which the sandbox is egress-blocked from fetching. The live run (V274)
 * fills them; a null width means "not yet established" (B724 flags it rather than guessing).
 * building_line_ft is left null everywhere until confirmed. */
export const HOUSTON_ROW_STANDARDS = [
  {
    classification: "major_thoroughfare",
    ultimate_row_ft: 100,
    building_line_ft: null,
    source: "Houston Code of Ordinances §42-122 (major thoroughfare ROW = lesser of 100 ft or MTFP hierarchy) — confirmed 2026-07 via municode",
  },
  {
    classification: "freeway",
    ultimate_row_ft: null,
    building_line_ft: null,
    source: "MTFP — freeway ROW varies (TxDOT controlled-access); PROVISIONAL, verify vs official table (V274)",
  },
  {
    classification: "transit_corridor",
    ultimate_row_ft: null,
    building_line_ft: null,
    source: "MTFP min ROW by classification — PROVISIONAL, verify vs official table (V274)",
  },
  {
    classification: "collector_major",
    ultimate_row_ft: null,
    building_line_ft: null,
    source: "MTFP min ROW by classification — PROVISIONAL, verify vs official table (V274)",
  },
  {
    classification: "collector_minor",
    ultimate_row_ft: null,
    building_line_ft: null,
    source: "MTFP min ROW by classification — PROVISIONAL, verify vs official table (V274)",
  },
];

// classification → { ultimate_row_ft, building_line_ft } map the transform reads to stamp each
// segment's resolved widths with the SAME numbers seeded into the jurisdiction_row_standards table.
HOUSTON.standards = Object.fromEntries(
  HOUSTON_ROW_STANDARDS.map((s) => [
    s.classification,
    { ultimate_row_ft: s.ultimate_row_ft, building_line_ft: s.building_line_ft },
  ]),
);
