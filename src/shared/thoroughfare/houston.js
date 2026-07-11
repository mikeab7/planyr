/* City of Houston Major Thoroughfare & Freeway Plan (MTFP) ingestion config (B721) — ONE config
 * per jurisdiction. B722 generalizes this exact shape to the surrounding jurisdictions. The pure
 * transform (ingestTransform.js) reads this; the runnable adapter is server/ingest/thoroughfare.mjs.
 *
 * ✅ RECONCILED AGAINST THE LIVE LAYER (V274, 2026-07-11). The endpoint served 26,699 features. Two
 * corrections vs. the original documented guess:
 *   1. The clean classification is `ST_TYPE` (values below), NOT `HIER_TABLE`. HIER_TABLE is a
 *      design-hierarchy CODE that encodes lanes + a per-segment ROW width (e.g. "MJ-4-80",
 *      "P-6-120", "TCS-2-varies(80-90)") — messy, with ranges/typos/blanks — so it maps everything
 *      to 'other'. ST_TYPE has 10 clean values that cover 100% of the features.
 *      (HIER_TABLE's per-segment ultimate ROW is a future enhancement for B724's exact dedication
 *      math; the schema deliberately resolves width from the standards lookup, not the feature.)
 *   2. No coded-value domains exist on any field — the classification/status fields are free-text
 *      strings, so the crosswalk keys below are the ACTUAL live values (lowercased). */

export const HOUSTON = {
  jurisdiction: "coh", // matches the jurisdictions registry seed (B720)
  serviceUrl:
    "https://mycity2.houstontx.gov/pubgis02/rest/services/HoustonMap/Transportation/MapServer/1",
  sourceUrl: "https://www.houstontx.gov/planning/transportation/MTFP.html",
  // 2018 MTFP base plan; MTFP Policy Statement last amended December 2024; per-segment amendments
  // (LastMTFPA) run through 2025 — the vintage note B726 keys freshness off.
  planName:
    "City of Houston 2018 Major Thoroughfare & Freeway Plan (MTFP), amended through 2025",
  planAdoptedDate: "2024-12-01", // MTFP Policy Statement amended December 2024 (defensible as-of)
  where: "1=1",
  idField: "OBJECTID", // confirmed live: esriFieldTypeOID → the idempotency key

  // Field candidates (first present wins). Confirmed against the live layer 2026-07-11.
  fieldMap: {
    street_name: ["FULL_NAME", "NAME"], // FULL_NAME = "Westheimer Rd"; NAME = "WESTHEIMER"
    classification: ["ST_TYPE"], // the clean functional class → our canonical class
    status: ["ST_STATUS"], // existing / proposed
  },

  // Houston ST_TYPE value → canonical class. Keys are lowercased (normalizeClassification
  // lowercases + trims the raw value before lookup). These are the ACTUAL live domain values;
  // together they cover all 26,699 features. Anything else (only "N/A", 2 rows) → 'other'.
  //   Freeway / Tollway / Frontage → freeway (all controlled-access; ROW is TxDOT-set, not MTFP).
  //   Thoroughfare / Principal Thoroughfare / Major Thoroughfare → major_thoroughfare (the MTFP
  //     width table's own header groups all three as "Major Thoroughfare", 100').
  classificationCrosswalk: {
    freeway: "freeway",
    tollway: "freeway",
    frontage: "freeway",
    "major thoroughfare": "major_thoroughfare",
    "principal thoroughfare": "major_thoroughfare",
    thoroughfare: "major_thoroughfare",
    "transit corridor street": "transit_corridor",
    "major collector": "collector_major",
    "minor collector": "collector_minor",
  },
};

/* Houston MTFP minimum ROW by classification → seeds jurisdiction_row_standards (B720).
 *
 * ✅ VERIFIED 2026-07-11 (V274) against the City's published "Major Thoroughfare and Freeway Plan
 * Minimum Right-of-Way Width by Street Classification" table
 * (houstontx.gov/planning/transportation/MTFP_21/...), cross-checked with §42-122:
 *   • Major Thoroughfare (incl. Thoroughfare + Principal Thoroughfare) = 100'
 *   • Major Collector = 80'
 *   • Minor Collector = 60'
 *   • Transit Corridor Street = "No specific ROW minimum" → null (not guessed)
 *   • Freeway = not in the table (TxDOT controlled-access, ROW varies) → null
 * building_line_ft is null everywhere — the min-ROW table specifies no building line. A null width
 * means "no fixed MTFP minimum" (B724 flags it rather than guessing). */
export const HOUSTON_ROW_STANDARDS = [
  {
    classification: "major_thoroughfare",
    ultimate_row_ft: 100,
    building_line_ft: null,
    source: "Houston MTFP Minimum ROW Width by Street Classification (Major Thoroughfare = 100') + §42-122 — verified 2026-07-11 (V274)",
  },
  {
    classification: "collector_major",
    ultimate_row_ft: 80,
    building_line_ft: null,
    source: "Houston MTFP Minimum ROW Width by Street Classification (Major Collector = 80') — verified 2026-07-11 (V274)",
  },
  {
    classification: "collector_minor",
    ultimate_row_ft: 60,
    building_line_ft: null,
    source: "Houston MTFP Minimum ROW Width by Street Classification (Minor Collector = 60') — verified 2026-07-11 (V274)",
  },
  {
    classification: "transit_corridor",
    ultimate_row_ft: null,
    building_line_ft: null,
    source: "Houston MTFP Minimum ROW Width by Street Classification (Transit Corridor Street = 'No specific ROW minimum') — verified 2026-07-11 (V274)",
  },
  {
    classification: "freeway",
    ultimate_row_ft: null,
    building_line_ft: null,
    source: "MTFP — freeway/tollway ROW varies (TxDOT controlled-access; not in the MTFP min-ROW table) — verified 2026-07-11 (V274)",
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
