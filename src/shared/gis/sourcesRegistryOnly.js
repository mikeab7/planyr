/* Registry rows no map layer or screen reads at runtime (kept for the weekly drift verifier and the audits) — GIS source rows, split out of sources.js (batch K stage 3, 2026-11-23, B2671306).
 * LOADS ON DEMAND, NOT in the Site route's first download: sourcePacks.js loads this pack with the lazy layer file(s) that read these rows (lazyLayerFiles.js `packs`),
 * and registers it into GIS_SOURCES (sources.js `registerSourcePack`). Rows are byte-identical to what sources.js held; nothing eager may read these keys
 * (test/sourcePacks.test.js sweeps for that). This file imports nothing so the dependency stays one-way. */

export const REGISTRY_ONLY_SOURCES = {

  bkddAllStreams: {
    key: "bkddAllStreams",
    label: "BKDD all streams (TNRIS inventory)",
    provider: "Brookshire–Katy Drainage District (via Quiddity; TNRIS data)",
    serviceUrl: "https://gisclient.quiddity.com/server/rest/services/Drainage_Information/MapServer",
    layerId: 121, // NB: 121 here = All Streams. Boundaries/121 = MUD boundary. Trap (a) above.
    geometryType: "line",
    fields: { ftype: "ftype", fcode: "fcode" },
    timeoutMs: 25000,
    coverage: "Brookshire–Katy Drainage District (Waller / Harris / Fort Bend)",
    tier: "production",
    lastVerified: "2026-07-29",
  },

  bkddFloodplainBfe: {
    key: "bkddFloodplainBfe",
    label: "BKDD floodplain BFE",
    provider: "Brookshire–Katy Drainage District (via Quiddity)",
    serviceUrl: "https://gisclient.quiddity.com/server/rest/services/Drainage_Information/MapServer",
    layerId: 112,
    geometryType: "line",
    /* NEW-1 — the field names ARE now confirmed (live feature read 2026-08-05): the layer is a
     * republication of the FEMA DFIRM BFE lines, carrying `elev` (140.6 ft on the first feature),
     * `v_datum` ("NAVD88"), `dfirm_id` ("48157C" = Waller Co.) and `bfe_ln_id`. That resolves the
     * datum question the old note left open FOR THIS LAYER — it is NAVD88 per feature — but the
     * layer stays render-only until a consumer is deliberately wired, because BKDD's own criteria
     * forms still carry the '1988 NGVD (2001 Adj.)' contradiction documented in detentionRules.js. */
    fields: { elev: "elev", datum: "v_datum", firm: "dfirm_id", lineId: "bfe_ln_id" },
    timeoutMs: 25000,
    coverage: "Brookshire–Katy Drainage District (Waller / Harris / Fort Bend)",
    tier: "production",
    lastVerified: "2026-08-05",
    // NEW-1 — was fixture-less. NB the Tsakiris point returns 0 (no BFE line crosses it), so it
    // is NOT a valid fixture; this point sits on a real published BFE line. Live: 3.
  },

  bkddOutfalls: {
    key: "bkddOutfalls",
    label: "BKDD NPDES outfalls",
    provider: "Brookshire–Katy Drainage District (via Quiddity)",
    serviceUrl: "https://gisclient.quiddity.com/server/rest/services/Drainage_Information/MapServer",
    layerId: 2,
    geometryType: "point",
    fields: {},
    outFields: ["*"],
    timeoutMs: 25000,
    coverage: "Brookshire–Katy Drainage District (Waller / Harris / Fort Bend)",
    tier: "production",
    lastVerified: "2026-08-05",
    // NEW-1 — was fixture-less. Live 2026-08-05: 5 outfalls at Tsakiris.
  },

  bkddDmpImprovements: {
    key: "bkddDmpImprovements",
    label: "BKDD Drainage Master Plan proposed improvements (advisory)",
    provider: "Brookshire–Katy Drainage District (via Quiddity) — Drainage Master Plan",
    serviceUrl: "https://gisclient.quiddity.com/server/rest/services/Drainage_Master_Plan/MapServer",
    layerId: 6, // Proposed Channel Improvements. 4/10 = Proposed Detention, 5 = Conveyance Channel.
    geometryType: "line",
    fields: {},
    outFields: ["*"],
    timeoutMs: 25000,
    studyArea: true,
    coverage: "BKDD Drainage Master Plan study area — a coastal-prairie extent centred near 28.96°N, −95.93°, NOT the Waller uplands (see the floodplain row's correction note)",
    tier: "production",
    lastVerified: "2026-08-05",
    // NEW-1 — was fixture-less. Point read off a real published feature. Live 2026-08-05: 1.
  },

  nhdHydroWaterbody: {
    key: "nhdHydroWaterbody",
    label: "USGS NHD waterbodies (ponds, lakes & reservoirs)",
    provider: "U.S. Geological Survey — National Hydrography Dataset",
    serviceUrl: "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer",
    // ⚠ 12 = "Waterbody - Large Scale". 10 is "Waterbody - SMALL Scale" (1:100k, a
    // different, coarser dataset) — reading 10 by mistake would silently serve the wrong
    // resolution. Layer list re-read live 2026-07-29 from /nhd/MapServer/layers.
    layerId: 12,
    geometryType: "polygon",
    fields: { name: "gnis_name", ftype: "ftype", fcode: "fcode" },
    coverage: "national",
    tier: "production",
    lastVerified: "2026-08-05",
    // NEW-1 — was fixture-less, which is exactly how a silent renumber from 12 ("Large Scale")
    // to 10 ("Small Scale") would have gone unnoticed. Live 2026-08-05: 14 waterbodies.
  },
};

/* Fixture-reach overrides for these rows stay in sources.js SOURCE_FIXTURE_REACH (an audit-only table); nothing to register here. */
export const REGISTRY_ONLY_FIXTURE_REACH = {};
