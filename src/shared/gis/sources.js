/* GIS Source Registry (B369) — the SINGLE, versioned source of truth for every GIS
 * service the Site Analysis screen + the jurisdiction identify reads. ALL endpoint
 * facts (URL, layer id, the exact fields we read, the authoritative provider, the
 * coverage extent, the production/exception tier, and known-truth coverage fixtures)
 * live HERE — never inline in a connector. Screening / identify code imports the row
 * and never hardcodes a service URL of its own.
 *
 * WHY this exists (the two failure modes it guards against):
 *   1) WE mis-wire it — pointing at a `/Test/` staging folder (the old NWI bug) or a
 *      county-clipped republication that looks right where it was first tested but is
 *      silently ~99.8% incomplete elsewhere (the Wells/Pipelines-on-Harris-GIS bug:
 *      Chambers County read 14 wells instead of 8,014 — a false "all clear" on a
 *      Mont Belvieu industrial site). The `tier` field + the CI tier-guard catch (1a),
 *      and the `fixtures` (known minimum counts at real bboxes/points) catch (1b) — a
 *      county-clipped or non-authoritative source fails its fixture immediately.
 *   2) AGENCIES move / rename / retire services, or silently rename a field. The
 *      schema + reachability + drift checks (gis-verify/gis-source-coverage-verify.mjs,
 *      run weekly by .github/workflows/gis-drift.yml) catch that before a customer does.
 *
 * Tier rule (machine-enforced by ui-audit/gis-source-audit.mjs + test/gisSources.test.js):
 *   • `tier: "production"` — the authoritative agency's production endpoint. The default.
 *   • `tier: "monitored-exception"` — a non-production / staging endpoint we depend on
 *     ONLY because no production equivalent exists yet. REQUIRES `tierReason` + a
 *     tracking note; the CI guard allows ONLY these acknowledged rows on a non-prod URL
 *     and fails the build on any other `/Test/`, `/staging/`, `geogimstest`, … URL.
 *
 * Plain JS (the stack is plain JS/JSX — the brief's `.ts` sketch maps to .js here).
 */

// Patterns that mark a NON-production / staging / test endpoint. A serviceUrl matching
// any of these must be a `monitored-exception` (with a reason), or the CI guard fails.
export const NON_PRODUCTION_URL_PATTERNS = [
  /\/test\//i,
  /\/staging\//i,
  /geogimstest/i,
  /\bdev\b/i,
  /sandbox/i,
];

export const VALID_TIERS = ["production", "monitored-exception"];

// ---------------------------------------------------------------------------
// The registry. One row per layer. `fields` is the named field map (internal key →
// the source's column); `outFields` is derived from it unless overridden (joined
// layers need "*"). `fixtures` are known-truth assertions the live verifier checks.
//   bbox  fixture: [minLng, minLat, maxLng, maxLat] (EPSG:4326) → expect ≥ expectMinCount
//   point fixture: [lng, lat] → a ~1 km envelope around it → expect ≥ expectMinCount
// ---------------------------------------------------------------------------
export const GIS_SOURCES = {
  // ---- Site Analysis screening sources ----
  flood: {
    key: "flood",
    label: "FEMA flood zones",
    provider: "FEMA (National Flood Hazard Layer)",
    serviceUrl: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer",
    layerId: 28, // Flood Hazard Zones (S_Fld_Haz_Ar) — the canonical queryable SFHA polygons
    geometryType: "polygon",
    fields: { zone: "FLD_ZONE", subtype: "ZONE_SUBTY", elev: "STATIC_BFE", vdatum: "V_DATUM", depth: "DEPTH" },
    // NEW-2/B789: a per-source screening-fetch timeout that OVERRIDES the 9 s default
    // (GIS_FETCH_TIMEOUT_MS). FEMA's NFHL answered flood /query in ~9.5 s during the
    // 2026-07-11 slowdown, so all three 9 s attempts lost the same race by ~0.5 s. ~20 s
    // rescues the marginal-slow case (flood data changes slowly, so a longer wait is cheap).
    // Live evidence: FEMA's own gateway still dropped some responses at ~10 s, so pair this
    // with the SWR cache proxy (B445) — it is not the whole fix on its own.
    timeoutMs: 20000,
    coverage: "national",
    tier: "production",
    lastVerified: "2026-06-21",
    fixtures: [
      // Galveston/Bolivar coast — wall-to-wall SFHA, a robust national-service sanity check.
      { label: "Galveston coast SFHA", bbox: [-94.85, 29.28, -94.70, 29.40], expectMinCount: 1 },
    ],
    notes: "Robust national service; the app's flood overlay rides the same MapServer.",
  },

  wetlands: {
    key: "wetlands",
    label: "USFWS NWI wetlands",
    provider: "U.S. Fish & Wildlife Service (National Wetlands Inventory)",
    // KNOWN EXCEPTION: this is the USFWS "Test" (staging) folder. The production root
    // `…/Wetlands/MapServer` returns an empty /layers array and 500s on /query (it's a
    // display/cache service, not a queryable one), so there is no drop-in production
    // queryable NWI endpoint today. We keep the Test service as an acknowledged,
    // monitored exception and lean on the SWR cache (B367) — rather than silently
    // shipping a `/Test/` URL with no guard (the failure mode B369 exists to prevent).
    serviceUrl: "https://fwsprimary.wim.usgs.gov/server/rest/services/Test/Wetlands_gdb_split/MapServer",
    layerId: [1, 2], // 1 = CONUS East, 2 = CONUS West (Texas is West); joined layers
    geometryType: "polygon",
    fields: { type: "WETLAND_TYPE", attr: "ATTRIBUTE", acres: "ACRES" },
    outFields: ["*"], // joined layers report table-qualified field names that differ per sublayer
    coverage: "national",
    tier: "monitored-exception",
    tierReason:
      "USFWS publishes NWI polygon-query only on this 'Test' folder; the production " +
      "Wetlands/MapServer root has an empty /layers and 500s on /query. Re-check for a " +
      "production queryable NWI endpoint periodically (tracked in BACKLOG / VERIFICATION).",
    lastVerified: "2026-06-21",
    fixtures: [
      // Sheldon Lake State Park, NE Harris Co. — known dense NWI polygons (≈58 confirmed live).
      { label: "Sheldon Lake wetlands", bbox: [-95.18, 29.84, -95.10, 29.90], layer: 2, expectMinCount: 1 },
    ],
    notes: "Desktop screen only — NOT a jurisdictional delineation.",
  },

  oilgas: {
    key: "oilgas",
    label: "Oil & gas well surface locations",
    provider: "Railroad Commission of Texas (RRC) — statewide",
    // AUTHORITATIVE statewide RRC service (replaces the Harris-County GIS republication
    // that was ~99.8% incomplete outside Harris — the Chambers Co. 14-vs-8,014 false-clean).
    serviceUrl: "https://gis.rrc.texas.gov/server/rest/services/rrc_public/RRC_Public_Viewer_Srvs/MapServer",
    layerId: 1, // Well Locations (point)
    geometryType: "point",
    fields: {
      api: "API",
      status: "SYMNUM",
      symbol: "GIS_SYMBOL_DESCRIPTION", // producing / plugged / dry / injection …
      wellNo: "GIS_WELL_NUMBER",
    },
    coverage: "statewide",
    tier: "production",
    lastVerified: "2026-06-21",
    fixtures: [
      // The centerpiece guard: a county-clipped source FAILS these immediately.
      { label: "Chambers County wells", bbox: [-94.92, 29.40, -94.40, 29.95], expectMinCount: 1000 },
      { label: "Mont Belvieu (Grand Port) wells", point: [-94.886, 29.846], expectMinCount: 1 },
    ],
    notes:
      "RRC well points are schematic; historic/orphaned wells can be inaccurate or unmapped. " +
      "Load-tested to 20 concurrent polygon queries with 0 failures (more robust than the retired " +
      "Harris-County host). Retired source: www.gis.hctx.net/arcgishcpid/…/TXRRC/Wells.",
  },

  pipelines: {
    key: "pipelines",
    label: "Pipelines (RRC T-4)",
    provider: "Railroad Commission of Texas (RRC) — statewide",
    serviceUrl: "https://gis.rrc.texas.gov/server/rest/services/rrc_public/RRC_Public_Viewer_Srvs/MapServer",
    layerId: 13, // Pipelines (polyline). NB: the service also exposes 12 "QPipelines" + 14 "Pipelines";
                 // 13 is the brief-verified choice (3,549 in Chambers Co.). Revisit if product intent shifts.
    geometryType: "line",
    fields: {
      operator: "OPERATOR",
      commodity: "COMMODITY_DESCRIPTION",
      diameter: "DIAMETER",
      status: "STATUS",
      system: "SYSTEM_NAME",
      county: "COUNTY_NAME",
    },
    coverage: "statewide",
    tier: "production",
    lastVerified: "2026-06-21",
    fixtures: [
      { label: "Chambers County pipelines", bbox: [-94.92, 29.40, -94.40, 29.95], expectMinCount: 1000 },
    ],
    notes:
      "RRC T-4 permit routes are SCHEMATIC, deliberately low-resolution — never a surveyed " +
      "alignment. Retired source: www.gis.hctx.net/arcgishcpid/…/TXRRC/Pipelines.",
  },

  // ---- Jurisdiction / road identify sources (B93/B94; shared by the screen) ----
  county: {
    key: "county",
    label: "County boundaries",
    provider: "TxDOT TPP (statewide)",
    serviceUrl: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/Texas_County_Boundaries/FeatureServer/0",
    layerId: null, // url already includes the layer index (FeatureServer/0)
    geometryType: "polygon",
    fields: { name: "CNTY_NM", fips: "FIPS_ST_CNTY_CD" },
    coverage: "statewide",
    tier: "production",
    lastVerified: "2026-06-16",
    fixtures: [{ label: "Harris County", point: [-95.37, 29.76], expectMinCount: 1 }],
  },
  city: {
    key: "city",
    label: "City limits",
    provider: "TxGIO (statewide)",
    serviceUrl: "https://feature.geographic.texas.gov/arcgis/rest/services/City_Boundaries/Texas_City_Boundaries/MapServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "city_name" },
    coverage: "statewide",
    tier: "production",
    lastVerified: "2026-06-16",
    fixtures: [{ label: "City of Houston", point: [-95.37, 29.76], expectMinCount: 1 }],
  },
  road: {
    key: "road",
    label: "Road maintenance authority",
    provider: "TxDOT Roadway Inventory",
    serviceUrl: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Roadway_Inventory/FeatureServer/0",
    layerId: null,
    geometryType: "line",
    // name = local-street name (STE_NAM); hwy = coded on-system route (HWY); toll =
    // toll-facility name — added for B94 per-road rows (a road's human-readable name).
    fields: { route: "RIA_RTE_ID", name: "STE_NAM", hwy: "HWY", toll: "TOLL_NM", system: "HSYS", authority: "RDWAY_MAINT_AGCY", funcClass: "F_SYSTEM" },
    coverage: "statewide",
    tier: "production",
    lastVerified: "2026-06-29",
    fixtures: [],
  },
  isd: {
    key: "isd",
    label: "School districts (ISD)",
    provider: "Texas Education Agency (TEA)",
    // Authoritative statewide school-district boundaries, published by the TEA GIS admin
    // (owner GISAdmin_TEA_Texas) on ArcGIS Online. Layer index is in the URL (FeatureServer/0
    // = "SchoolDistricts_SY2223"). Verified live 2026-07-11: 1,018 districts statewide, CORS
    // `*` (clean from any origin), NAME already carries the "ISD"/"CISD"/"Consolidated ISD"
    // suffix, DISTRICT_N = the TEA district number. Native SR is NAD83 Texas Lambert (meters),
    // so a query MUST pass inSR/outSR 4326 + a geometry spatialReference (both the identify and
    // the vector pull already do) — a bare x,y with no spatialReference returns nothing.
    serviceUrl: "https://services2.arcgis.com/5MVN2jsqIrNZD4tP/arcgis/rest/services/Current_Districts_2023/FeatureServer/0",
    layerId: null, // url already includes the layer index
    geometryType: "polygon",
    fields: { name: "NAME", number: "DISTRICT_N" },
    coverage: "statewide",
    tier: "production",
    lastVerified: "2026-07-11",
    fixtures: [
      // Coverage sanity — a county-clipped or wrong source fails these immediately.
      { label: "Goose Creek CISD (Baytown)", point: [-94.977, 29.735], expectMinCount: 1 },
      { label: "Houston ISD (downtown)", point: [-95.37, 29.76], expectMinCount: 1 },
      { label: "Katy ISD", point: [-95.79, 29.79], expectMinCount: 1 },
    ],
    notes:
      "TEA school-district boundaries (SY 2022-23 edition), a TAXING / attendance boundary — " +
      "NOT a service network. Approximate, for general information; updated ~annually by TEA.",
  },

  etj_hgac: {
    key: "etj_hgac",
    label: "ETJ — Houston-Galveston (H-GAC)",
    provider: "H-GAC (Houston-Galveston Area Council)",
    serviceUrl: "https://services.arcgis.com/su8ic9KbA7PYVxPS/arcgis/rest/services/HGAC_City_ETJ_Boundaries/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "CITY" },
    coverage: "regional",
    tier: "production",
    lastVerified: "2026-06-17",
    fixtures: [],
  },
  etj_austin: {
    key: "etj_austin",
    label: "ETJ — Austin",
    provider: "City of Austin GIS",
    serviceUrl: "https://services1.arcgis.com/PuB3FWUAxkScvfQy/arcgis/rest/services/COA_Jurisdiction/FeatureServer/20",
    layerId: null,
    geometryType: "polygon",
    fields: { name: null },
    coverage: "metro",
    tier: "production",
    lastVerified: "2026-06-17",
    fixtures: [],
  },
  etj_fortworth: {
    key: "etj_fortworth",
    label: "ETJ — Fort Worth",
    provider: "City of Fort Worth GIS",
    serviceUrl: "https://services3.arcgis.com/dViPBrlsejmXK64z/arcgis/rest/services/Fort_Worth_ETJ/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: null },
    coverage: "metro",
    tier: "production",
    lastVerified: "2026-06-17",
    fixtures: [],
  },

  // ---- Drainage / detention resolver sources (B629) ----
  mud: {
    key: "mud",
    label: "MUD / water districts (TCEQ)",
    provider: "TCEQ Water Districts (hosted by HARC)",
    serviceUrl: "https://harcags.harcresearch.org/arcgisserver/rest/services/Boundaries/TCEQ_Water_Districts/MapServer",
    layerId: 0,
    geometryType: "polygon",
    fields: { name: "NAME", type: "TYPE", typeDesc: "TYPE_DESCRIPTION", county: "COUNTY", status: "STATUS_DESCRIPTION", districtId: "DISTRICT_ID" },
    coverage: "statewide",
    tier: "production",
    lastVerified: "2026-07-03",
    fixtures: [
      // Bridgeland/Cypress — dense MUD country; ≥1 district polygon at any envelope here.
      { label: "Cypress-area water districts", point: [-95.69, 29.97], expectMinCount: 1 },
    ],
    notes:
      "District BOUNDARY, not proof of service. NB the layer also carries county-blanket " +
      "authorities (Coastal Water Authority, Port of Houston, river authorities) — consumers " +
      "must filter TYPE to the parcel-review district kinds (MUD/WCID/LID/DD/FWSD/SUD/WID) " +
      "or every Harris point reads as 'in a district'. detentionRules.js owns that filter. " +
      "Same service the jur_mud map overlay renders (layers.js reads this row).",
  },
  bkdd: {
    // B861 (chat NEW-2) — the Brookshire–Katy Drainage District boundary. A single
    // polygon (EPSG:2278, Planyr's spine) published by Waller County GIS on ArcGIS Online
    // (item a6befac4c0f84e6ab066ff8716076239, access: public, anonymous Query). Membership
    // is ADDITIVE to the county — the district's drainage/detention criteria ALSO apply; it
    // never replaces the county floodplain regime. detentionRules.js queries it as the
    // DETENTION_SOURCES.bkdd tier (server-side esriSpatialRelIntersects, like the MUD tier).
    key: "bkdd",
    label: "Brookshire–Katy Drainage District boundary",
    provider: "Waller County GIS (ArcGIS Online, hosted)",
    serviceUrl: "https://services1.arcgis.com/BqVKz0o32DERqyE4/arcgis/rest/services/Brookshire_Katy_Drainage_District1/FeatureServer",
    layerId: 54,
    geometryType: "polygon",
    fields: { name: "Name" },
    coverage: "Brookshire–Katy Drainage District (Waller / Harris / Fort Bend; ~47k ac, EPSG:2278)",
    tier: "production",
    lastVerified: "2026-07-16",
    fixtures: [
      // A point well inside the district near Katy/Brookshire → the single boundary polygon.
      { label: "Inside BKDD (near Katy)", point: [-95.9, 29.82], expectMinCount: 1 },
    ],
    notes:
      "Single DISTRICT BOUNDARY polygon — a taxing/authority extent, not proof of service. " +
      "Additive to the county (district drainage/detention criteria ALSO apply); never a " +
      "replacement for the county floodplain ordinance. Boundary-source failure is an honest " +
      "'district membership unverified', never a silent no. Same feature the BKDD Quiddity " +
      "WebGIS viewer draws; the county-published AGOL layer is used because it's anonymously " +
      "queryable (the Quiddity Enterprise portal requires auth).",
  },
  hcfcdChannels: {
    key: "hcfcdChannels",
    label: "HCFCD channels",
    provider: "Harris County Flood Control District (via Harris County GIS)",
    serviceUrl: "https://www.gis.hctx.net/arcgishcpid/rest/services/HCFCD/Channels/MapServer",
    layerId: 0,
    geometryType: "line",
    fields: { unitNo: "UNIT_NO", name: "CHAN_NAME", type: "TYPE", ditType: "DIT_TYPE" },
    coverage: "county",
    tier: "production",
    lastVerified: "2026-07-03",
    fixtures: [
      // Buffalo Bayou through downtown — unit W100-00-00, multiple segments in any 1-km envelope.
      { label: "Buffalo Bayou downtown", point: [-95.37, 29.76], expectMinCount: 1 },
    ],
    notes:
      "HCFCD unit centerlines (UNIT_NO like 'W100-00-00'). Harris County only. Used by the " +
      "detention resolver as a nearest-channel ADJACENCY screen — proximity to a unit, never " +
      "a traced discharge path (that upgrade is B634).",
  },
  hcfcdWatersheds: {
    key: "hcfcdWatersheds",
    label: "HCFCD watershed boundaries",
    provider: "Harris County Flood Control District (via Harris County GIS)",
    serviceUrl: "https://www.gis.hctx.net/arcgishcpid/rest/services/HCFCD/Watershed/MapServer",
    layerId: 1, // 1 = Watershed polygons (0 = the finer Catchment sub-basins)
    geometryType: "polygon",
    fields: { name: "WTSHNAME", unit: "WTSHUNIT" },
    coverage: "county",
    tier: "production",
    lastVerified: "2026-07-03",
    fixtures: [
      { label: "Buffalo Bayou watershed", point: [-95.37, 29.76], expectMinCount: 1 },
    ],
    notes:
      "The 22 HCFCD watershed polygons (WTSHNAME e.g. 'BUFFALO BAYOU', WTSHUNIT 'W'). Feeds " +
      "the B635 watershed-keyed overlay rules (Addicks/Barker + Upper Cypress retention " +
      "context). The precise Upper-Cypress overflow boundary is a separate service " +
      "(HCFCD/CypressCreekOverflow) — flagged in detentionRules.js as the exact-boundary follow-up.",
  },

  fbcddWse02: {
    key: "fbcddWse02",
    label: "FBCDD Atlas-14 watershed-study 0.2% (500-yr) WSE — DRAFT",
    provider: "Fort Bend County Drainage District (FBCDD) watershed studies",
    // County-wide 500-yr WSE MOSAIC raster (F32 pixels, feet, SR 2278 / EPSG:102740) on the
    // county portal's Image Server — NOT a FeatureServer layer/field (the V279 discovery
    // corrected the old assumption). Consumed point-wise via getSamples (the 3DEP pattern);
    // an out-of-coverage sample returns an empty value → honest null. CORS-clean from
    // planyr.io (verified in-browser 2026-07-11; re-verified by direct fetch 2026-07-12).
    // Source-of-truth portal item: web map 0d4791f2c9d143eeb62696850ce27e45 ("Fort Bend County
    // Watershed Study Inundation Map All - 100YR and 500YR (Draft Results)").
    // ⚠ The study results are DRAFT — every derived value must carry the draft-study
    // screening label, never read as an effective/published elevation.
    // (The 100-yr rasters have NO county-wide mosaic — per-watershed services only; they are
    // wired via the `fbcddWse100` row below and its `multiplex` routing table, B807.)
    // ⚠ B827 — this mosaic has HOLES (live-proven at Bain Ditch / Willow Fork): the sampler is
    // mosaic-FIRST, and an EMPTY mosaic answer falls back to the per-watershed 500YR rasters via
    // the `multiplex` table below (provisional seed — see its comment).
    serviceUrl: "https://gisportal.fortbendcountytx.gov/image/rest/services/500YR_WSE/ImageServer",
    layerId: null,
    kind: "raster", // getSamples, not /query — the drift verifier branches on this
    geometryType: "raster",
    fields: {},
    coverage: "Fort Bend County (published extent in SR 2278; value range ~24–167 ft NAVD88)",
    tier: "production",
    lastVerified: "2026-07-12",
    // Raster fixtures: point getSamples with an expected value range (in-coverage) or an
    // expected NO-DATA empty value (out-of-coverage) — the raster analog of expectMinCount.
    sampleFixtures: [
      { label: "Oyster Creek reach (in coverage)", point: [-95.62, 29.55], expectValueRange: [60, 90] }, // live 2026-07-11/12: 72.6968
      { label: "NE of the county (out of coverage)", point: [-95.0, 30.2], expectNoData: true },
      {
        label: "Bain Ditch reach — mosaic HOLE, per-watershed 500YR fallback (B827)",
        point: [-95.850035, 29.769820],
        expectValueRange: [130, 150], // live 2026-07-13 (owner's browser): 139.514 (Willow_500YR_Existing_WSE)
        serviceUrl: "https://gisportal.fortbendcountytx.gov/image/rest/services/Willow_Creek/Willow_500YR_Existing_WSE/ImageServer",
      },
      // Pins the county mosaic's EMPTY answer at the same point (the B827 hole). If the county
      // ever fills the hole this flips to a value → the weekly verifier flags it — the signal
      // to re-check whether the per-watershed fallback is still needed. No serviceUrl: mosaic.
      { label: "Bain Ditch reach — the 500YR_WSE mosaic hole itself (B827)", point: [-95.850035, 29.769820], expectNoData: true },
    ],
    fixtures: [], // no /query fixtures — raster (see sampleFixtures above)
    // B827 — per-watershed 500YR fallback routing for mosaic HOLES. The county-wide 500YR_WSE
    // mosaic (serviceUrl above) has gaps where a studied watershed's raster never made it into
    // the mosaic (live-proven: Bain Ditch / Willow Fork area — mosaic EMPTY, the per-watershed
    // Willow_500YR_Existing_WSE answers 139.514 ft). The sampler goes MOSAIC-FIRST, then routes
    // an EMPTY mosaic answer through this table (same bbox+seam-pad router as the 100YR row).
    // ⚠ PROVISIONAL (provisional: true): the 500YR sibling family cannot be enumerated from this
    // sandbox (the county's services directory 403s automated fetches), so the table is seeded
    // with the ONE live-proven service. Live recon TODO: walk restBase folders for leaves matching
    // `include` (the siblings follow the 100YR naming rule — <Watershed>_500YR_Existing_WSE /
    // *_500YR_WSEL) and bake each with its published fullExtent. The weekly verifier reports
    // live-not-in-table diffs as NOTES (not failures) while provisional.
    multiplex: {
      restBase: "https://gisportal.fortbendcountytx.gov/image/rest/services",
      include: /500yr.*_wsel?$/i, // *_500YR_Existing_WSE + *_500YR_WSEL; never 100YR/LOS/Depth/DxV
      exclude: /_LOS_/i,
      provisional: true,
      services: [
        // Extent = the Willow 100YR twin's published extent (identical grid; SR 6588 = NAD83(2011)
        // ftUS twin of 2278). Live-proven 139.514 ft at 29.769820, −95.850035; F32.
        { name: "Willow_Creek/Willow_500YR_Existing_WSE", extent2278: [2933472, 13810320, 3034389, 13890879] },
      ],
    },
    notes:
      "Feeds the drainage check's derivedWse02Ft (0.2% WSE engine seam, B770; code label B763) for " +
      "Fort Bend sites — screening only, DRAFT watershed-study values. B827: mosaic-first, " +
      "per-watershed fallback where the mosaic has a hole. Sampler: site-planner/lib/fbcdWse.js.",
  },

  // ---- Receiving-water / outfall screen (NEW-A5) ----
  nhdFlowline: {
    key: "nhdFlowline",
    label: "USGS NHDPlus HR flowlines (receiving waters)",
    provider: "USGS / EPA National Hydrography Dataset Plus High Resolution",
    // The National Map's NHDPlus HR MapServer. Layer 3 = NetworkNHDFlowline — the routed
    // stream network (the actual receiving waters an outfall discharges to), each carrying
    // GNIS_NAME + an FCODE (stream/river vs canal/ditch vs artificial path). Queried near the
    // pond's outfall point for the nearest named receiving water + distance; NO receiving
    // water within the adjacency threshold is surfaced as an outfall-easement risk (the
    // pond has to convey its release somewhere — an off-site conveyance easement). Screening
    // only — never a surveyed alignment or a confirmed drainage right. CORS clean from the
    // browser (public federal service; re-verify live). Consumed via /query (feature layer),
    // the identifySource pattern; sampler is site-planner/lib/receivingWater.js.
    serviceUrl: "https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer",
    layerId: 3, // NetworkNHDFlowline
    geometryType: "line",
    fields: { name: "GNIS_NAME", fcode: "FCODE", lengthKm: "LENGTHKM" },
    coverage: "national",
    tier: "production",
    lastVerified: "2026-07-18",
    fixtures: [
      // Willow Fork / Cane Island near Katy — dense named flowlines in any ~1 km envelope.
      { label: "Willow Fork (Katy)", point: [-95.83, 29.78], expectMinCount: 1 },
    ],
    notes:
      "NetworkNHDFlowline (routed network). GNIS_NAME may be empty on unnamed reaches / artificial " +
      "paths — the sampler keeps the nearest with a name AND the nearest overall. Screening adjacency, " +
      "never a surveyed outfall alignment or a legal drainage easement.",
  },

  fbcddWse100: {
    key: "fbcddWse100",
    label: "FBCDD Atlas-14 watershed-study 1% (100-yr) WSE — DRAFT",
    provider: "Fort Bend County Drainage District (FBCDD) watershed studies",
    // Unlike the 0.2% row above there is NO county-wide 100-yr mosaic — the study publishes
    // per-watershed ImageServers (19 WSE rasters live 2026-07-13, several naming shapes:
    // *_100YR_Existing_WSE, *_100Yr_WSE, *_100YR_WSEL; 100YR/100Yr/100yr case varies). The
    // `multiplex` table below is the routing index: service name + published fullExtent in
    // SR 2278 ftUS (Willow_Creek publishes SR 6588 = NAD83(2011) South Central ftUS — the
    // same grid to screening precision). The sampler bbox-tests the site point against each
    // extent2278 (padded for watershed seams), samples every candidate in parallel, and takes
    // the MAX finite value (governing WSE). LOS variants (*_100YR_LOS_WSE — a level-of-service
    // product, different study basis) and Depth/DxV products are EXCLUDED — they are not the
    // existing-conditions 1% water surface.
    // serviceUrl = the Oyster watershed raster as the REPRESENTATIVE endpoint (the drift
    // verifier's metadata probe needs one concrete ImageServer; per-fixture serviceUrl
    // overrides exercise other watersheds, and the catalog parity check walks the live
    // directory against `multiplex.services`). Same source-of-truth portal item as the 0.2%
    // row (web map 0d4791f2c9d143eeb62696850ce27e45); same DRAFT caveat: screening only,
    // never an effective/published elevation. CORS-clean from planyr.io (same host as 0.2%).
    serviceUrl: "https://gisportal.fortbendcountytx.gov/image/rest/services/Oyster/Oyster_100YR_Existing_WSE/ImageServer",
    layerId: null,
    kind: "raster", // getSamples, not /query — the drift verifier branches on this
    geometryType: "raster",
    fields: {},
    coverage: "Fort Bend County, per-watershed (19 rasters; value range ~24–191 ft NAVD88)",
    tier: "production",
    lastVerified: "2026-07-13",
    sampleFixtures: [
      { label: "Oyster Creek reach (in coverage)", point: [-95.6895, 29.648], expectValueRange: [70, 95] }, // live 2026-07-13: 82.08
      {
        label: "Willow Fork reach (in coverage, the SR-6588 service)",
        point: [-95.8776, 29.7971],
        expectValueRange: [145, 170], // live 2026-07-13: 156.48
        serviceUrl: "https://gisportal.fortbendcountytx.gov/image/rest/services/Willow_Creek/Willow_100YR_Existing_WSE/ImageServer",
      },
      { label: "NE of the county (out of coverage)", point: [-95.0, 30.2], expectNoData: true },
    ],
    fixtures: [], // no /query fixtures — raster (see sampleFixtures above)
    // Routing index for the per-watershed multiplex (read by lib/fbcdWse.js AND the drift
    // verifier's catalog parity check). A live catalog leaf name belongs to this source iff
    // it matches `include` and not `exclude`. Extents captured live 2026-07-13.
    multiplex: {
      restBase: "https://gisportal.fortbendcountytx.gov/image/rest/services",
      include: /100yr.*_wsel?$/i,
      exclude: /_LOS_/i,
      services: [
        { name: "Bessies_Creek/BessiesCreek_100YR_Existing_WSE", extent2278: [2900325, 13785724, 2961165, 13833208] },
        { name: "BigCreek/BigCreek_100YR_Existing_WSE", extent2278: [2922657, 13676513, 3083955, 13791101] },
        { name: "Brays_Bayou/BraysBayou_100YR_Existing_WSE", extent2278: [3018306, 13810128, 3026721, 13820820] },
        { name: "BriscoeDitch/BriscoeDitch_100YR_Existing_WSE", extent2278: [2972910, 13775454, 2998209, 13796907] },
        { name: "BZ_River_Mapping/100YR_WSE", extent2278: [2811449, 13628028, 3106805, 13990068] },
        { name: "Cedar_Buffalo/Cedar_Buffalo_100Yr_Existing_WSE", extent2278: [2949303, 13644821, 2995140, 13711538] },
        { name: "Clear_Creek/Clear_Creek_100YR_Existing_WSE", extent2278: [3077664, 13757940, 3106314, 13781595] },
        { name: "Cow_Turkey_Bee/Cow_Turkey_Bee_100Yr_WSE", extent2278: [3001878, 13656785, 3057012, 13698527] },
        { name: "Dry_Turkey_Snake/Dry_Turkey_Snake_100Yr_WSE", extent2278: [2901780, 13673934, 2983545, 13787550] },
        { name: "Guy_Mound/Guy_Mound_100Yr_Existing_WSE", extent2278: [2976626, 13635910, 3019160, 13705570] },
        { name: "Jones_Creek/Jones_Creek_100yr_WSE", extent2278: [2945100, 13777617, 3011160, 13834350] },
        { name: "Keegans_Bayou/Keegans_Bayou_100YR_Existing_WSE", extent2278: [3017944, 13798276, 3044404, 13814166] },
        { name: "Oyster/Oyster_100YR_Existing_WSE", extent2278: [2989565, 13722515, 3110777, 13823219] },
        { name: "Pleasant_Gully/Pleasant_Gully_100YR_Existing_WSE", extent2278: [2979071, 13759941, 2998301, 13774593] },
        { name: "Rabbs_Bayou/Rabbs_Bayou_100YR_WSEL", extent2278: [2986543, 13752209, 3041275, 13784684] },
        { name: "Robinowitz_Ditch/Robinowitz_Ditch_100YR_Existing_WSE", extent2278: [2946678, 13761732, 2982096, 13771473] },
        { name: "San_Bernard/San_Bernard_River_100yr_WSE", extent2278: [2750599, 13507280, 3147823, 13897106] },
        { name: "Sims_Bayou/Sims_Bayou_100YR_Existing_WSE", extent2278: [3069807, 13773798, 3096387, 13789260] },
        { name: "Willow_Creek/Willow_100YR_Existing_WSE", extent2278: [2933472, 13810320, 3034389, 13890879] }, // SR 6588 (NAD83(2011) ftUS — same grid)
      ],
    },
    notes:
      "Feeds the drainage check's derivedWse1pctFt (1% WSE engine seam, B807) for Fort Bend " +
      "sites — the unstudied-Zone-A pricing path. Screening only, DRAFT watershed-study values, " +
      "precedence LAST (never outranks effective-model data). Sampler: site-planner/lib/fbcdWse.js.",
  },

  // B882 — FEMA/USGS InFRM Estimated BFE (Base Level Engineering). The estimated-BFE
  // source for FEMA Zone A / unstudied "no published BFE" areas, REPLACING the old
  // grade-@-Zone-A-boundary heuristic where InFRM has coverage. This is a MapServer whose
  // sublayers are RASTERS, so the sampler reads a point value with the ArcGIS `identify`
  // operation (MapServer raster layers support neither /query nor ImageServer getSamples):
  //   • layer 17 = "1 Percent Water Surface Elevation (ft)"  → the ESTIMATED BFE (ft-NAVD88)
  //   • layer 21 = "0.2 Percent (500-yr) WSE" (ft)           → fills the blank 0.2% field
  // InFRM Base Level Engineering is a REGIONAL SCREENING product (FEMA Region 6 / Gulf-
  // central — NOT nationwide), an engineering ESTIMATE, never a regulatory / published BFE;
  // a sealed H&H study and the reviewing agency set the final value. Every consumer labels
  // it accordingly (EST_EBFE_NOTE in floodplainMitigation.js). An out-of-coverage point (the
  // service returns no result / "NoData") reads as an honest null → the caller falls back to
  // the grade-based estimate; an HTTP/service error THROWS (LOUD-FAILURE — the caller records
  // a failed state and falls back, never a fabricated value). Sampler: site-planner/lib/ebfe.js.
  femaEbfe: {
    key: "femaEbfe",
    label: "FEMA InFRM Estimated BFE (Base Level Engineering) — 1% + 0.2% WSE (screening)",
    provider: "FEMA / USGS InFRM (Interagency Flood Risk Management), Region 6",
    serviceUrl: "https://txgeo.usgs.gov/arcgis/rest/services/FEMA_EBFE/EBFE/MapServer",
    layerId: 17, // the representative endpoint (the estimated-BFE raster); the sampler reads both 17 + 21 via identify
    kind: "raster-identify", // MapServer raster layers — read by /identify, not /query or getSamples
    geometryType: "raster",
    // The two raster sublayers the sampler identifies at the site's representative point.
    identifyLayers: { bfe1pct: 17, wse02: 21 },
    fields: {},
    coverage: "FEMA Region 6 / USGS InFRM Base Level Engineering (Gulf-central; TX + neighbors — NOT nationwide)",
    tier: "production",
    // ⚠ Endpoint facts recorded from the owner's authoritative task spec 2026-07-18; a LIVE
    // reachability + value probe is PENDING (V363) — this sandbox's egress policy blocks
    // txgeo.usgs.gov (403), so the identify round-trip is verified on the deployed app.
    lastVerified: "2026-07-18",
    sampleFixtures: [
      // Houston/Katy area — expected to be inside InFRM Region-6 coverage (provisional range,
      // confirmed live in V363). Out-of-region point returns no data → the grade fallback.
      { label: "Houston metro (in coverage, provisional)", point: [-95.75, 29.78], expectValueRange: [1, 500], provisional: true },
      { label: "far outside Region 6 (out of coverage)", point: [-110.0, 44.0], expectNoData: true },
    ],
    fixtures: [], // raster — see sampleFixtures (identify probe)
    notes:
      "B882 — the estimated-BFE source for FEMA Zone A / unstudied 'no published BFE' areas, " +
      "replacing the grade-@-Zone-A-boundary heuristic where InFRM covers the site (Region 6 only; " +
      "elsewhere the sampler returns null and the caller falls back to grade). Layer 17 = estimated " +
      "1% BFE, layer 21 = 0.2% (500-yr) WSE. SCREENING ONLY — an estimate, never a regulatory/" +
      "published BFE; a sealed H&H (Atlas-14) study + the reviewing agency set the final value. " +
      "Read by /identify (not /query). Sampler: site-planner/lib/ebfe.js. Live probe pending V363.",
  },

  // B882 (scope note 2) — HCFCD MAAPnext model WSE (Harris County local-district provider).
  // MAAPnext model elevations often run HIGHER than the effective FIRM and Harris-area
  // reviewers ENFORCE them, so in Harris County this WSE OUTRANKS FBCDD-style effective data
  // AND FEMA InFRM EBFE (precedence in site-planner/lib/wseProviders.js). Still a SCREENING
  // value in Planyr — an estimate, never a regulatory/published BFE.
  //   serviceUrl = the CONFIRMED GroundElevation ImageServer (the one MAAPNext endpoint proven
  //   reachable in the recon). The companion 1% / 0.2% WSE rasters live in the same MAAPNext
  //   folder but their exact leaf names must be read from the LIVE services directory — the
  //   build sandbox blocks fximgservices.hcfcd.org (403), so `wseLayers` is PROVISIONAL (null)
  //   and the sampler (site-planner/lib/hcfcdWse.js) is a no-op until V363 fills the endpoints.
  hcfcdMaapnext: {
    key: "hcfcdMaapnext",
    label: "HCFCD MAAPnext model WSE — 1% + 0.2% (screening, Harris County)",
    provider: "Harris County Flood Control District (HCFCD) — MAAPnext",
    serviceUrl: "https://fximgservices.hcfcd.org/arcgis/rest/services/MAAPNext/GroundElevation/ImageServer",
    layerId: null,
    kind: "raster", // ImageServer getSamples (same as FBCDD) — the drift verifier probes serviceUrl
    geometryType: "raster",
    // ⚠ PROVISIONAL — the 1% / 0.2% WSE ImageServer URLs are unconfirmed (sandbox egress blocks
    // the host). V363 walks the MAAPNext folder, confirms the WSE leaf names, and fills these in;
    // until then the sampler returns null (provider absent) and the resolver falls through to EBFE.
    wseLayers: { wse1pct: null, wse02: null, provisional: true },
    fields: {},
    coverage: "Harris County (HCFCD MAAPnext model results; ft-NAVD88)",
    tier: "production",
    lastVerified: "2026-07-18",
    sampleFixtures: [
      // GroundElevation is the reachable, confirmed endpoint; a value probe belongs to V363.
      { label: "central Harris (GroundElevation reachable — confirm WSE siblings live)", point: [-95.37, 29.76], provisional: true },
    ],
    fixtures: [],
    notes:
      "B882 — Harris County local-district estimated-WSE provider; OUTRANKS EBFE + effective-style " +
      "data in Harris (MAAPnext is enforced there). Screening only. GroundElevation ImageServer " +
      "confirmed; 1% / 0.2% WSE ImageServer endpoints PROVISIONAL (wseLayers null) pending the live " +
      "directory probe (V363). Sampler: site-planner/lib/hcfcdWse.js; resolver: lib/wseProviders.js.",
  },
};

// Keys grouped by the surface that consumes them (handy for the audit + tests).
export const ANALYSIS_KEYS = ["flood", "wetlands", "oilgas", "pipelines"];
export const JURISDICTION_KEYS = ["county", "city", "road", "isd", "etj_hgac", "etj_austin", "etj_fortworth"];
export const DETENTION_KEYS = ["mud", "hcfcdChannels", "hcfcdWatersheds"]; // B629 drainage resolver

/* Look a row up by key (throws on a typo so a bad reference fails fast, not silently). */
export function gisSource(key) {
  const s = GIS_SOURCES[key];
  if (!s) throw new Error(`[gis-sources] unknown source key "${key}"`);
  return s;
}

/* The outFields string for a row: an explicit override (joined layers → "*"), else the
 * named field map's columns joined, else "*". Pure. */
export function outFieldsFor(entry) {
  if (entry.outFields && entry.outFields.length) return entry.outFields.join(",");
  const cols = Object.values(entry.fields || {}).filter(Boolean);
  return cols.length ? cols.join(",") : "*";
}

/* Does a URL look like a non-production / staging endpoint? Pure. */
export function looksNonProduction(url) {
  return NON_PRODUCTION_URL_PATTERNS.some((re) => re.test(String(url || "")));
}

/* Validate one registry row's tier/exception integrity. Returns a list of problem
 * strings (empty = OK). Pure — the CI guard + the unit test both call this. */
export function tierProblems(entry) {
  const problems = [];
  if (!VALID_TIERS.includes(entry.tier)) {
    problems.push(`${entry.key}: invalid tier "${entry.tier}" (must be one of ${VALID_TIERS.join(", ")})`);
  }
  const nonProd = looksNonProduction(entry.serviceUrl);
  if (nonProd && entry.tier !== "monitored-exception") {
    problems.push(`${entry.key}: serviceUrl looks non-production (${entry.serviceUrl}) but tier is "${entry.tier}" — mark it "monitored-exception" with a tierReason, or repoint to a production endpoint.`);
  }
  if (entry.tier === "monitored-exception" && !entry.tierReason) {
    problems.push(`${entry.key}: tier "monitored-exception" requires a tierReason explaining why no production endpoint is used.`);
  }
  if (!entry.serviceUrl || !/^https:\/\//.test(entry.serviceUrl)) {
    problems.push(`${entry.key}: serviceUrl must be an https:// URL.`);
  }
  return problems;
}

/* Validate the whole registry (shape + tier integrity). Returns { problems[] }. Pure. */
export function auditRegistry(sources = GIS_SOURCES) {
  const problems = [];
  for (const [key, entry] of Object.entries(sources)) {
    if (entry.key !== key) problems.push(`${key}: entry.key "${entry.key}" doesn't match its map key.`);
    if (!entry.provider) problems.push(`${key}: missing provider (the authoritative agency).`);
    if (!entry.lastVerified || !/^\d{4}-\d{2}-\d{2}$/.test(entry.lastVerified)) {
      problems.push(`${key}: lastVerified must be a YYYY-MM-DD date.`);
    }
    problems.push(...tierProblems(entry));
  }
  return { problems };
}
