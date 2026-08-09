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

/* NEW-1 (2026-08-05) — AVAILABILITY is ORTHOGONAL to tier, and the registry needs both.
 * `tier` answers "is this the authoritative agency's production endpoint" (a design fact).
 * `availability` answers "does it ANSWER right now" (an operational fact). Conflating them
 * is how `hcfcdMaapnext` sat at tier "production" for weeks while timing out at every point,
 * including its own home county:
 *   • "live"     — answers. The default; no extra fields.
 *   • "degraded" — answers, but unreliably (intermittent 429/timeout). Requires `outage`.
 *   • "down"     — does NOT answer. Requires `outage`. The app must SAY SO (never a silent
 *                  null on a flood analysis), and the weekly verifier asserts it is STILL
 *                  down — a row that starts answering again is reported as a PROBLEM
 *                  ("recovered, flip it back to live"), so a recovery can't go unnoticed
 *                  and CI isn't permanently red for an outage we already know about.
 * `outage` = { since, symptom, evidence, impact, replacement } — all strings; `replacement`
 * names what the app falls through to (or "none"). */
export const VALID_AVAILABILITY = ["live", "degraded", "down"];
export const availabilityOf = (entry) => (entry && entry.availability) || "live";

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
    // NEW-3 — `firm` (DFIRM_ID) rides along so a readout can say WHOSE study answered by county
    // name rather than a bare id, and so a site whose extent spans two studies (a county-line
    // site: FIRM panels stop at the county line) can be flagged instead of silently reporting
    // whichever one a point landed in. Decoded by lib/floodZone.js `firmStudy`.
    fields: { zone: "FLD_ZONE", subtype: "ZONE_SUBTY", elev: "STATIC_BFE", vdatum: "V_DATUM", depth: "DEPTH", firm: "DFIRM_ID" },
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
    /* ⛔ B209505 (2026-08-06) — RE-CHECKED AND THE EXCEPTION STANDS; the layer is NOT dead.
     *
     * Reported as "0 at all six, including Texas City on Galveston Bay — this is not 'no wetlands',
     * it is broken", with the ask to repoint at the production NWI endpoint. Both halves were
     * measured and both come out the other way:
     *   • The LAYER ANSWERS. Queried at the six Houston-area audit sites with the drift verifier's
     *     own ~1 km envelope: 71 · 63 · 12 · 33 · 30 · 24 polygons. It also answers in Dallas, San
     *     Antonio, Denver, Grand Junction and Chicago. Nothing is broken here — a screening query
     *     against a PARCEL-sized footprint legitimately returns 0 when no NWI polygon touches that
     *     parcel, and a bare point is a parcel-sized footprint.
     *   • THERE IS STILL NO PRODUCTION ALTERNATIVE. `…/services/Wetlands/MapServer` re-probed
     *     2026-08-06: it still returns an EMPTY `layers` array — a display/cache service, not a
     *     queryable one — and its sublayers 0/1/2 error. The whole services directory was
     *     enumerated (Areas_of_Interest · Data_Source · HUCs · Riparian · Wetlands_Raster ·
     *     Wetlands_Status · Wetlands); none is a drop-in queryable replacement. So the /Test/ folder
     *     remains the only queryable NWI, and this stays a monitored exception.
     * THE REAL TRAP, found while checking: sublayer 0 ("Wetlands", the combined one) returns ZERO at
     * every one of the six points, while sublayer 2 (CONUS West) returns the counts above. Anyone
     * "simplifying" `layerId` from [1, 2] to 0 would silently kill this layer nationwide. Keep the
     * pair. B209505 also gives the row fixtures at six separated points instead of one. */
    serviceUrl: "https://fwsprimary.wim.usgs.gov/server/rest/services/Test/Wetlands_gdb_split/MapServer",
    layerId: [1, 2], // 1 = CONUS East, 2 = CONUS West (Texas is West); joined layers — NEVER 0, see above
    geometryType: "polygon",
    fields: { type: "WETLAND_TYPE", attr: "ATTRIBUTE", acres: "ACRES" },
    outFields: ["*"], // joined layers report table-qualified field names that differ per sublayer
    coverage: "national",
    tier: "monitored-exception",
    lastVerified: "2026-06-21",
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
  },

  // ---- Utility-service CCN screening sources (public-data screening PHASE 1) ----
  // "Who holds the certificate to serve this site." A CCN (Certificate of Convenience &
  // Necessity) is the PUC of Texas retail monopoly to provide water / sewer in a bounded
  // area. A parcel INSIDE a CCN polygon → that utility is the one obligated (and entitled)
  // to serve it; a parcel in NO CCN → there is no certificated provider (city-served, a
  // private well/septic, or a petition/new-CCN is needed). Screening only — the STATUS field
  // distinguishes an approved cert from one still in a pending docket; confirm with the utility
  // and the PUC. NB: these polygon layers answer POINT-in-polygon via an ENVELOPE / parcel-ring
  // intersect (how the screen + the drift verifier query them); a bare x,y point /query on the
  // Harris MapServer can silently return 0 (older ArcMap host quirk) — never query them with a
  // naked point.
  ccnWater: {
    key: "ccnWater",
    label: "Water CCN service area",
    provider: "Public Utility Commission of Texas (via TWDB)",
    // The authoritative STATEWIDE water-CCN polygons, hosted by the Texas Water Development
    // Board on ArcGIS Online (Dec-2023 PUCT edition; 3,844 polygons statewide, CORS-clean).
    // Chosen over the Harris-County re-serve (regional, ~301 polys — the B369 clip trap) for the
    // same reason wells/pipelines use the statewide RRC service, not the Harris republication.
    serviceUrl: "https://services3.arcgis.com/O0h7Kr4STkhD6uiU/arcgis/rest/services/PUC_CCN_2023Dec_FeatureLayer/FeatureServer/0",
    layerId: null, // url already includes the layer index (FeatureServer/0)
    geometryType: "polygon",
    // No field encodes the utility KIND (city / MUD / WSC …) — that is inferred from the
    // UTILITY name string in lib/ccnClassify.js. CCN_TYPE is the service-area class
    // ("Bounded Service Area"), NOT the utility kind.
    fields: { utility: "UTILITY", ccnType: "CCN_TYPE", status: "STATUS", ccnNo: "CCN_NO" },
    coverage: "statewide",
    tier: "production",
    lastVerified: "2026-07-18",
  },
  ccnSewer: {
    key: "ccnSewer",
    label: "Sewer CCN service area",
    provider: "Public Utility Commission of Texas (via Harris County GIS)",
    // There is NO statewide sewer-CCN REST endpoint (PUCT publishes sewer CCN only as a
    // periodic shapefile download; TWDB serves water CCN but not sewer). Harris County GIS
    // re-serves the PUCT CCN in EPSG:2278 (Planyr's spine) with BOTH water (layer 1) and
    // sewer (layer 2) — a PRODUCTION host, but its coverage is the Houston metro region, not
    // statewide. Documented regional here (the target market is the Houston MSA); upgrading to a
    // statewide/authoritative sewer source is tracked as a live-verify follow-up (VERIFICATION.md).
    serviceUrl: "https://www.gis.hctx.net/arcgishcpid/rest/services/State/PUC_CCN_Sewer_Water/MapServer",
    layerId: 2, // 2 = CCN Sewer Service Areas (1 = water, 0 = water facility lines)
    geometryType: "polygon",
    fields: { utility: "UTILITY", ccnType: "CCN_TYPE", status: "STATUS", ccnNo: "CCN_NO" },
    coverage: "Houston metro region (Harris County GIS re-serve of the PUCT CCN; no statewide sewer-CCN REST exists)",
    tier: "production",
    lastVerified: "2026-07-18",
  },

  // ---- Environmental contamination pre-screen (public-data screening PHASE 2) ----
  // Proximity sources: the screen buffers the parcel and reports count + nearest distance
  // + names. A Phase I ESA PRE-SCREEN — never a substitute for a Phase I ESA.
  lpst: {
    key: "lpst",
    label: "TCEQ leaking petroleum storage tank (LPST) sites",
    provider: "Texas Commission on Environmental Quality (TCEQ)",
    // TCEQ's dedicated LEAKING-tank layer (a documented release from a petroleum UST) — NOT the
    // all-tanks PST layer (whose LPST_ID is unpopulated). Point layer; the screen buffers the
    // parcel with a server-side `distance` query (supported here) and measures nearest in EPSG:2278.
    serviceUrl: "https://gisweb.tceq.texas.gov/arcgis/rest/services/Public/LPST/MapServer",
    layerId: 0,
    geometryType: "point",
    fields: { name: "SITE_NAME", program: "REM_PROG", lpstId: "LPST_ID", city: "CITY", county: "COUNTY", addr: "PHYS_ADDR" },
    coverage: "statewide",
    tier: "production",
    lastVerified: "2026-07-18",
  },
  epaCleanups: {
    key: "epaCleanups",
    label: "EPA Superfund (NPL) + RCRA cleanup sites",
    provider: "U.S. EPA (Cleanups in My Community — FRS-derived)",
    // EPA's unified cleanup point layer: Superfund (NPL + non-NPL) AND RCRA corrective-action in
    // one service; MAP_SYMBOL_CODE splits the program (S = NPL, SN = Superfund non-NPL, R = RCRA,
    // combinations + E). AGOL-hosted by EPA's official org (CORS-clean); server-side `distance` works.
    serviceUrl: "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Cleanups_in_my_Community_Sites/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "PRIMARY_NAME", symbol: "MAP_SYMBOL_CODE", sfName: "SF_SITE_NAME", city: "CITY_NAME", county: "COUNTY_NAME" },
    coverage: "national",
    tier: "production",
    /* B209505 (2026-08-06) — the row that motivated the whole fixture-method fix, and the one whose
     * verdict is most easily misread. Reported as "0 at all six industrial sites while its Pasadena
     * fixture passes — a passing fixture is not proving coverage". The first half is TRUE, the
     * second is the important part, and the conclusion is not "the layer is dead":
     *   • 64,000 features nationally; it answers in Dallas (19), San Antonio (5), El Paso (13),
     *     Denver (6), Chicago (8), Atlanta (14), Newark (8) and Phoenix (3).
     *   • It returns 0 within the screen's 1-mile buffer at all six Houston sites because the
     *     nearest EPA cleanup point genuinely is further than a mile from each of them — at ~3 mi
     *     the same six read 1 · 0 · 3 · 3 · 2 · 11. Texas City is the sharpest case: refineries
     *     ~2.4 km south of the audit coordinate, just outside a 1-mile ring.
     * So "absent within 1 mi" was the honest answer. What was NOT honest was the fixture set: one
     * Pasadena point could never have distinguished this from a genuinely dead layer, which is
     * exactly the owner's point. This row now carries separated fixtures on three continents' worth
     * of separation; the reach rule lives in `fixtureReachProblems`. */
    lastVerified: "2026-08-06",
  },

  // ---- Active surface growth faults (public-data screening PHASE 3) ----
  growthFaults: {
    key: "growthFaults",
    label: "Houston-area active surface faults",
    provider: "USGS (Shah & Lanning-Rush, SIM 2874) — via University of Houston GIS republication",
    // Houston growth-fault surface traces (slow-slip faults that crack foundations/pavement).
    serviceUrl: "https://services1.arcgis.com/euMKmvUChvyJxWq2/arcgis/rest/services/Fault_Houston/FeatureServer/0",
    layerId: null,
    geometryType: "line",
    fields: { name: "Name", type: "Type", orientation: "Orientatio" },
    coverage: "Houston metropolitan area (USGS SIM 2874 study extent)",
    // ACKNOWLEDGED EXCEPTION: the authoritative dataset (USGS SIM 2874, "Principal faults in the
    // Houston metropolitan area", Shah & Lanning-Rush) is published as a map/shapefile DOWNLOAD
    // only — there is no authoritative live REST endpoint, and the USGS-derived AGOL republication
    // is token-gated. This University of Houston GIS republication of that same dataset is the best
    // anonymously-queryable live service. It is the COMPLETE study dataset (not a clipped subset),
    // but community-hosted, so it's an acknowledged exception — screening only.
    tier: "monitored-exception",
    lastVerified: "2026-07-18",
  },

  // ---- Power / grid screening (public-data screening PHASE 5) ----
  // Two HIFLD (Homeland Infrastructure Foundation-Level Data) electric layers. A transmission
  // line crossing the parcel is a real easement constraint; the distance to the nearest
  // substation is a service / interconnect proxy for a heavy-power industrial user. Both are
  // proximity sources (the screen buffers the parcel + measures nearest in EPSG:2278 feet).
  transmission: {
    key: "transmission",
    label: "Electric transmission lines (HIFLD)",
    provider: "HIFLD (Homeland Infrastructure Foundation-Level Data) — U.S. electric transmission",
    // HIFLD national transmission polylines, hosted on Esri's Living Atlas org (services2). Distinct
    // from the DOE/NETL transmission layer the map overlay renders (hifld_tx) — both are HIFLD-derived
    // transmission; this one supports a server-side `distance` buffer query for the proximity screen.
    serviceUrl: "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0",
    layerId: null, // url already includes the layer index (FeatureServer/0)
    geometryType: "line",
    fields: { owner: "OWNER", voltage: "VOLTAGE", voltClass: "VOLT_CLASS", status: "STATUS", type: "TYPE" },
    coverage: "national",
    tier: "production",
    lastVerified: "2026-07-18",
  },
  substations: {
    key: "substations",
    label: "Electric substations (HIFLD)",
    provider: "HIFLD (Homeland Infrastructure Foundation-Level Data) — U.S. electric substations",
    // HIFLD national substation POINTS. Chosen over the regional subsets some HIFLD republications
    // carry (one candidate held only ~68 South-Texas points — the B369 clip trap) — this is the full
    // continental-US layer (extent -130..-67 lon), server-side `distance` query works.
    serviceUrl: "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Electric_Substations/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    // NAME is anonymized ("UNKNOWN#####") on redacted records; MAX_VOLTAG is the max voltage (kV),
    // 0 where withheld. powerScreen.js cleans both for display.
    fields: { name: "NAME", city: "CITY", state: "STATE", voltage: "MAX_VOLTAG" },
    coverage: "national",
    tier: "production",
    lastVerified: "2026-07-18",
  },

  // ---- Access tier (public-data screening PHASE 6) ----
  // Three "how good is the access here" datasets, all proximity sources (buffer the parcel,
  // measure nearest in EPSG:2278 feet). INFO facts for a deal, not pass/fail constraints.
  aadt: {
    key: "aadt",
    label: "TxDOT traffic counts (AADT)",
    provider: "TxDOT — Annual Average Daily Traffic (AADT)",
    // TxDOT's public District/MPO AADT review layer — traffic-count POINTS with AADT_PRELIM
    // (the preliminary annual average daily traffic) + Located_On (the road) + County. The
    // screen reports the nearest counted road's volume as an access/visibility proxy.
    serviceUrl: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/District_and_MPO_AADT_Review_Layer_Public/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { aadt: "AADT_PRELIM", road: "Located_On", county: "County" },
    coverage: "statewide (Texas)",
    tier: "production",
    /* NEW-6 — MEASURED, not guessed. The owner's audit clocked this row at 4,657 ms against a
     * 166 ms median across all 43 sources and called it "28x slower than every other source".
     * Re-measured 2026-08-05, and the honest answer is more specific than that:
     *   • 4,657 ms was the SERVICE METADATA endpoint (`?f=json`, a 19 KB payload). The screening
     *     path never calls it — that number is a cold first connection to TxDOT's ArcGIS Online
     *     org, and it does not describe what a user waits for. Warm, it is 40–124 ms.
     *   • In the request the app ACTUALLY makes — the buffered proximity /query — this row is
     *     410 ms (median of three) against a 113 ms median for its six peers (lpst 94 · rail 112
     *     · airports 113 · epaCleanups 122 · substations 101 · transmission 219). So it IS the
     *     slowest, by about 3.6x, not 28x, and it is a large statewide point layer on a busy
     *     shared org rather than anything we are doing wrong.
     * The fix is therefore volume, not a rewrite: the redundant exact-count request is gone
     * (siteAnalysis.analyzeProximitySource), halving what this row asks for. It also gets its own
     * abort cap so the slowest source in the registry can never spend the shared 9 s budget and
     * stall the panel behind it — it degrades to an honest "unknown" instead. */
    timeoutMs: 6000,
    lastVerified: "2026-08-05",
  },
  rail: {
    key: "rail",
    label: "Rail lines (BTS/FRA North American Rail Network)",
    provider: "USDOT BTS / FRA — North American Rail Network (NTAD)",
    // BTS NTAD rail-network LINES (the FRA rail network). RROWNER1 = the owning railroad's
    // reporting mark (UP, BNSF, PTRA …); accessScreen.js expands the common marks. A line
    // crossing/adjacent to the site is a potential rail-served siding (an industrial plus).
    serviceUrl: "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_North_American_Rail_Network_Lines/FeatureServer/0",
    layerId: null,
    geometryType: "line",
    fields: { owner: "RROWNER1", owner2: "RROWNER2", net: "NET" },
    coverage: "national",
    tier: "production",
    lastVerified: "2026-07-18",
  },
  airports: {
    key: "airports",
    label: "FAA airports (Part 77 proximity proxy)",
    provider: "FAA — Aeronautical Information Services (airports)",
    // FAA airport POINTS (NAME / IDENT / TYPE_CODE / SERVCITY). Used as a PROXY for FAA Part 77
    // height-restriction surfaces — a site near a public-use (AD-type) airport may fall under Part
    // 77 imaginary surfaces that cap structure height. This is proximity only; the actual Part 77
    // surfaces are computed from runway geometry (a real determination is an FAA Form 7460 study).
    serviceUrl: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "NAME", ident: "IDENT", type: "TYPE_CODE", city: "SERVCITY", elev: "ELEVATION" },
    coverage: "national",
    tier: "production",
    lastVerified: "2026-07-18",
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
  },
  /* NEW-5 — the Colorado counterpart of `county`. Kept as its OWN row rather than widening the
   * Texas row, so the TxDOT source a Texas site resolves against is untouched; jurisdiction.js
   * routes by location exactly the way it already routes ETJ sources. VERIFIED LIVE 2026-07-29:
   * 64 county polygons, name field NAME20, ArcGIS-Online hosted (CORS-open, no key). */
  countyCo: {
    key: "countyCo",
    label: "County boundaries (Colorado)",
    provider: "Colorado statewide county boundaries (Esri-hosted)",
    serviceUrl: "https://services2.arcgis.com/fnCPHPvll1r80nFV/arcgis/rest/services/Colorado_Counties/FeatureServer/127",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "NAME20", fips: "GEOID20" },
    coverage: "colorado",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-07-29",
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
    lastVerified: "2026-08-05",
    // NEW-1 — this row had NO fixture, so the weekly drift job could not see it rot. Live
    // 2026-08-05: 101 roadway segments in a ~1 km envelope on the I-10 corridor at Katy.
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
    /* NEW-1 — H-GAC's ArcGIS-Online org runs on a metered request quota and was OVER IT during
     * the 2026-08-05 sweep (HTTP 200 carrying `{"error":{"code":429,"Unable to perform query.
     * Too many requests. API calls quota exceeded"}}`). It is not broken, but it is not
     * dependable either, and it had no fixture, so nothing ever said so. Marked degraded and
     * given a fixture; the verifier now reports a 429 as a real failure rather than silence. */
    availability: "degraded",
    outage: {
      since: "2026-08-05",
      symptom: "intermittent HTTP 429 'API calls quota exceeded' from the H-GAC ArcGIS Online org",
      evidence: "2026-08-05 sweep: three consecutive /query calls returned code 429 (9,010–10,939 request units over quota); the layer metadata itself answered normally.",
      impact: "the ETJ half of the merged 'City limits & ETJ' row can come back empty in the Houston region for reasons that have nothing to do with the site.",
      replacement: "none — there is no statewide Texas ETJ layer. City limits (the `city` row) still answer.",
    },
    lastVerified: "2026-08-05",
    // Katy / west Houston — inside the H-GAC ETJ mosaic.
    /* ⛔ NEW-1a — THIS LAYER DOES NOT COVER "ALL CITIES", AND THE CLAIM THAT IT DID IS WHY THE
     * OWNER'S BAYTOWN ETJ WAS INVISIBLE. Queried live 2026-08-09 with `returnDistinctValues`: it
     * carries exactly **34** cities. Baytown, Katy, Humble, La Porte, Deer Park, Friendswood,
     * League City, Galveston and Tomball are all absent. A site in a missing city's ETJ therefore
     * got the SAME empty answer as a site in no ETJ at all — the absence-vs-failure collapse
     * B209507 closed for a failed request, arriving instead through a request that succeeded and
     * had nothing to say. `etjRoster` is the honest bound, and `jurisdiction.js` reports a city
     * outside it as "ETJ not mapped", never as "no ETJ". Re-check with
     * `node ui-audit/audit-etj-coverage.mjs` — do not hand-edit this list. */
    roster: [
      "ARCOLA", "BEASLEY", "CLEVELAND", "CONROE", "CUT AND SHOOT", "EAST BERNARD", "FAIRCHILDS",
      "FULSHEAR", "HOUSTON", "HUNTSVILLE", "KENDLETON", "MAGNOLIA", "MISSOURI CITY", "MONTGOMERY",
      "NEEDVILLE", "OAK RIDGE", "ORCHARD", "PASADENA", "PEARLAND", "PLEAK", "RICHMOND",
      "ROMAN FOREST", "ROSENBERG", "SHENANDOAH", "SIMONTON", "SPLENDORA", "STAFFORD", "STAGECOACH",
      "SUGAR LAND", "TEXAS CITY", "THOMPSONS", "WESTON LAKES", "WILLIS", "WOODLOCH",
    ],
    rosterCheckedAt: "2026-08-09",
  },
  /* NEW-1a — the City of Baytown publishes its OWN city-limits and ETJ layers, and it has to be a
   * registry row because H-GAC's regional mosaic omits it. The owner's Goose Creek site is the
   * repro: 6 of its 14 tested parcels are inside Baytown's city limits and the other 8 are inside
   * Baytown's ETJ — not one is plain unincorporated — and the app could see none of it.
   * Verified live 2026-08-09 against every parcel of site `sms69x8rb2qk`. */
  etj_baytown: {
    key: "etj_baytown",
    label: "ETJ — City of Baytown",
    provider: "City of Baytown GIS",
    serviceUrl: "https://services8.arcgis.com/2iaYWEMdQLPv0ZUw/arcgis/rest/services/City_of_Baytown_Citizen_Map_WFL1/FeatureServer/11",
    layerId: 11,
    geometryType: "polygon",
    fields: { name: null },
    coverage: "city",
    tier: "production",
    availability: "live",
    lastVerified: "2026-08-09",
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
    lastVerified: "2026-08-05",
    /* NEW-1 — no fixture existed. NB an ETJ is the ring OUTSIDE the city limits, so a downtown
     * point reads 0 and is NOT a valid fixture (measured: downtown Austin = 0). This point sits
     * in the real "AUSTIN 2 MILE ETJ" polygon; live 2026-08-05: 4. */
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
    lastVerified: "2026-08-05",
    // NEW-1 — no fixture existed; same ETJ-is-outside-the-limits rule as Austin above.
    // Live 2026-08-05: 2 in the southern ETJ ring.
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
    layerId: 20, // the representative endpoint (the estimated-BFE RASTER); the sampler reads 20 + 24 via identify
    kind: "raster-identify", // MapServer raster layers — read by /identify, not /query or getSamples
    geometryType: "raster",
    /* ⛔ NEW-1 (2026-08-05) — THE ONE TRAP ON THIS SERVICE, and the reason the EBFE provider
     * had NEVER returned a value since B882 shipped. Layers 17 / 21 are MOSAIC LAYERS: an
     * ArcGIS mosaic layer is a GROUP (Boundary + Footprint + Image), and `identify` NEVER
     * reports the group id — it reports the SUBLAYERS. So `all:17,21` came back as layerId
     * 18/19/20 and 22/23/24, `foldIdentify`'s `r.layerId === 17` test matched nothing, and the
     * sampler resolved a permanent, silent `{ bfe1pctFt: null, wse02Ft: null }` — read
     * downstream as "outside InFRM coverage", everywhere, forever. Worse, result[0] is the
     * Boundary polygon whose `value` is a Shape_Length (17,141,870) — a fold that had merely
     * dropped the layerId test would have reported that as a flood elevation.
     * The RASTER sublayers are 20 ("1 Percent WSE Image") and 24 (".2 Percent WSE Image").
     * Live-proven through the app's own same-origin proxy 2026-08-05:
     *   Tsakiris (-95.89503, 29.77938) → 1% 154.8 ft · 0.2% 156.0 ft
     *   Waller   (-96.0,     30.05)    → 1% 206.5 ft · 0.2% 207.831 ft
     *   Houston / Katy / Baytown       → NoData (CORRECT: those are STUDIED, so BLE has no
     *                                    coverage there — InFRM maps the unstudied gaps).
     * Re-read /layers on any lastVerified refresh and keep the "… Image" suffix, not the index. */
    identifyLayers: { bfe1pct: 20, wse02: 24 },
    /* The attribute names this service actually returns on a raster identify. `pixelValueOf`
     * looked only for "Pixel Value" / "Stretched.Pixel Value" — neither is present here (the
     * mosaic reports "Service Pixel Value" + "Classify.Pixel Value"), the second half of the
     * same silent-null bug. Ordered: first hit wins. */
    pixelAttributes: ["Service Pixel Value", "Pixel Value", "Classify.Pixel Value", "Stretched.Pixel Value"],
    /* ⛔ Read through the app's OWN same-origin cache proxy (/api/gis-cache), never straight
     * from the browser. usgs.gov is already on the proxy's upstream allow-list. Two reasons,
     * both measured in the owner's 2026-08-04 audit: the direct call answered
     * "TypeError: Failed to fetch" at Katy (a cross-origin refusal — the browser never saw a
     * response) and TIMED OUT at Harris, while the identical request through the proxy answered
     * in 0.85–2.6 s from the same audit window. Point identifies use the proxy's `nostore` mode
     * so a per-site JSON answer never lands in the Drive imagery cache. */
    useProxy: true,
    fields: {},
    coverage: "FEMA Region 6 / USGS InFRM Base Level Engineering (Gulf-central; TX + neighbors — NOT nationwide)",
    tier: "production",
    availability: "live",
    lastVerified: "2026-08-05",
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
    /* NEW-1 (2026-08-05) — the WSE leaf names are NO LONGER PROVISIONAL. They were read from
     * HCFCD's own ArcGIS-Online item catalog (owner Matthew.Barr, items "Water Surface
     * Elevation - 100 Year" / "- 500 Year" / "- 10 Year"), which publishes the service URLs
     * even though the host itself is unreachable. So the config gap B882 left open is closed;
     * what remains is an OUTAGE, not missing configuration. */
    wseLayers: {
      wse1pct: "https://fximgservices.hcfcd.org/arcgis/rest/services/MAAPNext/WSE_100YR/ImageServer",
      wse02: "https://fximgservices.hcfcd.org/arcgis/rest/services/MAAPNext/WSE_500YR/ImageServer",
    },
    fields: {},
    coverage: "Harris County (HCFCD MAAPnext model results; ft-NAVD88)",
    tier: "production",
    /* ⛔ DOWN — measured, not assumed. The whole `fximgservices.hcfcd.org` host hangs and is then
     * refused; `www.hcfcd.org` on the same domain answers in ~1.3 s, so this is one image-server
     * host, not HCFCD. Nothing on ArcGIS Online replaces it: HCFCD publishes MAAPnext
     * FloodHazardZones and FloodRiskType there (classifications, not elevations) and county-wide
     * WSE rasters ONLY here. So there is no repoint to make — the honest move is to say so, keep
     * the (now-correct) endpoints ready, and let the weekly verifier tell us the day it returns. */
    availability: "down",
    outage: {
      since: "2026-08-04",
      symptom: "every request to fximgservices.hcfcd.org hangs ~20 s and is then refused",
      evidence:
        "Owner audit 2026-08-04 (real browser, production): metadata 'TypeError: Failed to fetch' " +
        "after 19,692 ms; identify TIMEOUT at Harris, Katy AND in Colorado. Re-measured 2026-08-05 " +
        "server-side through the app's own Cloudflare proxy: /arcgis/rest/services, " +
        "MAAPNext/GroundElevation, MAAPNext/WSE_100YR and MAAPNext/WSE_500YR each hung 19.4–20.5 s " +
        "and failed, while www.hcfcd.org answered in 1.3 s.",
      impact:
        "Harris County sites get no MAAPnext model WSE. MAAPnext usually runs HIGHER than the " +
        "effective FIRM and Harris reviewers enforce it, so the estimate a Harris site DOES get is " +
        "likely LOW. Never let this read as 'no flood data here'.",
      replacement:
        "none — no other public publication of the county-wide MAAPnext WSE rasters exists. The " +
        "resolver falls through to FEMA InFRM BLE (femaEbfe), which is a screening estimate from a " +
        "different model and does NOT carry MAAPnext's enforced elevations.",
    },
    lastVerified: "2026-08-05",
  },

  // -------------------------------------------------------------------------
  // NEW-1 (B1075) — the BROOKSHIRE–KATY DRAINAGE DISTRICT (BKDD) source family, hosted
  // by the district's engineer (Quiddity) on gisclient.quiddity.com. This is the FIRST
  // non-Harris drainage-authority family in the registry: before it, a Waller / BKDD site
  // read as "no drainage data" because HCFCD (correctly) returns n=0 outside Harris and
  // FEMA never maps channels at all — the exact silence the 2026-07-29 Tsakiris report hit.
  //
  // ALL rows below were live-probed 2026-07-29 from the owner's browser on the planyr.io
  // origin (CORS-clean, anonymous). Service SR is WKID 2278 (NAD83 / Texas South Central,
  // US survey feet — Planyr's own spine); the /export honours bboxSR=4326&imageSR=3857, so
  // a dynamicMapLayer paints them with no client-side reprojection.
  //
  // ⚠ TWO REGISTRY TRAPS, encoded deliberately:
  //   (a) LAYER NUMBERS ARE NOT GLOBAL. Layer 121 is "All Streams (TNRIS)" in
  //       Drainage_Information and "MUD boundary" in Boundaries. Every row therefore
  //       carries its FULL service path — never a bare layer number, and never a shared
  //       "BKDD layer id" constant.
  //   (b) STALE SIBLINGS EXIST. Layers 0 and 5 of Drainage_Information are named "…-OLD",
  //       and a sibling service `Easement_Current_updated/MapServer` lives on the same
  //       host. The authoritative easement layers are 109 + 107 ("BKDD Easements Current")
  //       inside Drainage_Information — confirmed live 2026-07-29 (n≥1 at Tsakiris, the
  //       70-ft easement with recorded exhibit WF-10.pdf). Re-confirm on any lastVerified
  //       refresh before repointing.
  //
  // COLD START (see B1079): BKDD's FIRST call to any of these services took 16.5–18.3 s
  // (ArcGIS Server instance spin-up); every call after was 72–88 ms. The 9 s shared default
  // would abort that first hit on every BKDD source forever, so each row sets timeoutMs:
  // 25000 and the map layers route through the same-origin cache proxy (which pays the
  // cold start once, server-side, under its own 25 s upstream bound).
  bkddStreams: {
    key: "bkddStreams",
    label: "BKDD major streams & channels",
    provider: "Brookshire–Katy Drainage District (via Quiddity)",
    serviceUrl: "https://gisclient.quiddity.com/server/rest/services/Drainage_Information/MapServer",
    layerId: 108, // Major Streams. 121 = All Streams (TNRIS) — the wider inventory, see notes.
    geometryType: "line",
    fields: { name: "streamname" },
    timeoutMs: 25000,
    coverage: "Brookshire–Katy Drainage District (Waller / Harris / Fort Bend)",
    tier: "production",
    lastVerified: "2026-07-29",
  },

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

  bkddEasements: {
    key: "bkddEasements",
    label: "BKDD drainage easements (current)",
    provider: "Brookshire–Katy Drainage District (via Quiddity)",
    serviceUrl: "https://gisclient.quiddity.com/server/rest/services/Drainage_Information/MapServer",
    layerId: 109, // "BKDD Easements Current". 107 is its companion (registered as bkddEasements107).
    geometryType: "polygon",
    // `file` names the RECORDED EXHIBIT (e.g. "WF-10.pdf") for the easement instrument — the
    // document that actually fixes the width on the ground. Surfaced in the feature popup.
    fields: { width: "width", file: "file" },
    timeoutMs: 25000,
    coverage: "Brookshire–Katy Drainage District (Waller / Harris / Fort Bend)",
    tier: "production",
    lastVerified: "2026-07-29",
  },

  bkddEasements107: {
    key: "bkddEasements107",
    label: "BKDD drainage easements (current, companion layer)",
    provider: "Brookshire–Katy Drainage District (via Quiddity)",
    serviceUrl: "https://gisclient.quiddity.com/server/rest/services/Drainage_Information/MapServer",
    layerId: 107,
    geometryType: "polygon",
    fields: { width: "width", file: "file" },
    timeoutMs: 25000,
    coverage: "Brookshire–Katy Drainage District (Waller / Harris / Fort Bend)",
    tier: "production",
    lastVerified: "2026-08-05",
    // NEW-1 — was fixture-less. Live 2026-08-05 through the app's own proxy: 16 at Tsakiris.
  },

  bkddSubwatersheds: {
    key: "bkddSubwatersheds",
    label: "BKDD sub-watersheds (Drainage Master Plan)",
    provider: "Brookshire–Katy Drainage District (via Quiddity)",
    serviceUrl: "https://gisclient.quiddity.com/server/rest/services/Drainage_Information/MapServer",
    layerId: 116,
    geometryType: "polygon",
    fields: { name: "subwatersh", sqMiles: "sq_miles" },
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

  bkddBoundary: {
    key: "bkddBoundary",
    label: "BKDD district boundary (Quiddity)",
    provider: "Brookshire–Katy Drainage District (via Quiddity)",
    serviceUrl: "https://gisclient.quiddity.com/server/rest/services/Boundaries/MapServer",
    layerId: 129,
    geometryType: "polygon",
    fields: {},
    outFields: ["*"],
    timeoutMs: 25000,
    coverage: "Brookshire–Katy Drainage District (Waller / Harris / Fort Bend)",
    tier: "production",
    lastVerified: "2026-07-29",
  },

  // ---- BKDD Drainage Master Plan — ADVISORY MODEL RESULTS, extent-gated -------------
  // Every DMP layer returned n=0 at Tsakiris because the DMP study area is WESTERN Waller
  // (Bucks Bayou / Cotton Creek / Hardeman Slough) — the tract sits outside it. That empty
  // is CORRECT and must never read as "no floodplain here"; `studyArea: true` marks the
  // family so the layer panel gates it on the service's published fullExtent and says
  // "outside this study area" instead (B1075 / B1076).
  bkddDmpFloodplain: {
    key: "bkddDmpFloodplain",
    label: "BKDD Drainage Master Plan floodplains (advisory)",
    provider: "Brookshire–Katy Drainage District (via Quiddity) — Drainage Master Plan",
    serviceUrl: "https://gisclient.quiddity.com/server/rest/services/Drainage_Master_Plan/MapServer",
    layerId: 19, // 100-yr Atlas-14 floodplain. 20 = Harvey, 17 = 10-yr (same service).
    geometryType: "polygon",
    fields: {},
    outFields: ["*"],
    timeoutMs: 25000,
    studyArea: true,
    /* ⚠ NEW-1 CORRECTION (2026-08-05): the study area is NOT "western Waller". The layer's own
     * published extent is EPSG:2278 x 2,927,931–2,969,195 · y 13,514,631–13,578,128, whose centre
     * reprojects to 28.961°N, −95.935° — the coastal-prairie country roughly 55 miles SOUTH of
     * Waller. The old comment's guess is why the "TODO: bake an in-extent fixture" never got done:
     * every candidate point was looked for in the wrong county. */
    coverage: "BKDD Drainage Master Plan study area — a coastal-prairie extent centred near 28.96°N, −95.93° (published extent in EPSG:2278), NOT the Waller uplands",
    tier: "production",
    lastVerified: "2026-08-05",
    // The TODO below is now DONE: the point is the reprojected centre of the layer's own
    // published extent. Live 2026-08-05 through the app's own proxy: 1.
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

  // -------------------------------------------------------------------------
  // NEW-4 (B1078) — USGS NHD national hydrography. The UNIVERSAL channel fallback: national
  // coverage means no site anywhere is left with an invisible channel just because its
  // drainage district publishes no GIS. Live-probed 2026-07-29 at Tsakiris: n=6 in 577 ms,
  // CORS-clean, ftype 336 / fcode 33600 = Canal/Ditch.
  //
  // ⚠ An INVENTORY, not a regulatory or engineering product: NHD says "there is a channel
  // here and this is roughly what kind," never how big, how deep, or what it can carry.
  //
  // ⚠ NOT the same row as `nhdFlowline` above, and deliberately not merged with it. That row
  // is NHDPlus HR (NHDPlus_HR/MapServer/3, NetworkNHDFlowline) — the ROUTED network used by
  // the outfall receiving-water screen, with UPPERCASE GNIS_NAME/FCODE and no `ftype`. This
  // family is the plain NHD service (nhd/MapServer), whose large-scale layers carry lowercase
  // gnis_name + the ftype classification the map popup decodes. Two different services with
  // two different schemas and two different jobs; collapsing them would break one of them.
  // -------------------------------------------------------------------------
  nhdHydro: {
    key: "nhdHydro",
    label: "USGS NHD flowlines (streams, canals & ditches)",
    provider: "U.S. Geological Survey — National Hydrography Dataset",
    serviceUrl: "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer",
    // 6 = "Flowline - Large Scale" (1:24k high-resolution NHD). 4 is the SMALL-scale
    // (1:100k) flowline — a coarser dataset that would silently under-report channels.
    // Layer list re-read live 2026-07-29 from /nhd/MapServer/layers.
    layerId: 6,
    geometryType: "line",
    fields: { name: "gnis_name", ftype: "ftype", fcode: "fcode" },
    coverage: "national",
    tier: "production",
    lastVerified: "2026-07-29",
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

  // ===========================================================================
  // NEW-2 (2026-08-05) — THE COLORADO FAMILY.
  //
  // Before this, a Colorado site was a Texas registry pointed at Colorado: 38 of 43 sources
  // returned zero at the owner's Commerce City tract (smsdsqdkl9i0), and the single Colorado
  // row (countyCo) meant the weekly drift job structurally could not see Colorado rot — there
  // was almost nothing there to rot. CCN is a Texas PUC construct, LPST is TCEQ, the RRC is
  // Texas, and the whole HCFCD / BKDD / FBCDD drainage tier is Texas. None of them have a
  // Colorado meaning, so widening a Texas row would have been a lie; each Colorado equivalent
  // is its OWN row, exactly like countyCo (B-NEW-5), and jurisdiction routing picks by location.
  //
  // EVERY row below was LIVE-PROBED 2026-08-05 from this build sandbox against the real service:
  // metadata read, statewide feature count taken, and counts taken at SEVEN real Colorado points
  // (Commerce City · Denver · Greeley/Weld · Fort Collins/Larimer · Aurora/Arapahoe · Broomfield ·
  // Colorado Springs/El Paso). The counts are recorded per row so a future clip regression is
  // provable, not argued — the same discipline the Weld and Broomfield county entries already use.
  //
  // ⛔ THE CLIP TRAP, CAUGHT LIVE AND NOT WIRED. Three ArcGIS-Online "COGCC / ECMC wells"
  // services are the obvious answer for Colorado oil & gas and ALL THREE are county copies:
  // Adams County's COGCC_Oil_and_Gas/9 reports 6,319 wells statewide with 711 in Weld;
  // Broomfield's COGCCOilGasWells 8,035 / 3,668; COGCC_VIEW is tank batteries. Colorado has on
  // the order of a hundred thousand wells and Weld alone has tens of thousands — these are the
  // Chambers-County-14-vs-8,014 failure exactly. The authoritative publisher is ECMC's own host
  // (ecmc.state.co.us), which this sandbox's egress policy blocks AND which is not on the app
  // proxy's upstream allow-list, so it could not be verified live. House rule: verify before you
  // wire. Colorado oil & gas is therefore DELIBERATELY UNWIRED and declared as a named gap
  // (coloradoRegions.CAPABILITIES.oilGasWells) so the panel says "we don't have this in Colorado"
  // instead of showing the Texas RRC row toggling on to an empty map.
  // ===========================================================================
  cityCo: {
    key: "cityCo",
    label: "City limits (Colorado)",
    provider: "Colorado DOLA, via the State of Colorado OIT GIS ArcGIS Online org",
    serviceUrl: "https://services3.arcgis.com/DgjqnJA1rgO92Soi/arcgis/rest/services/Municipal_Boundary/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "cityname", city: "city", county: "county", type: "type" },
    coverage: "colorado",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    // Live 2026-08-05: 1,911 polygons statewide (DOLA_Municipalities). Commerce City 9 ·
    // Denver 1 · Greeley 1 · Fort Collins 2 · Aurora 4 · Broomfield 1 · Colorado Springs 1.
  },

  isdCo: {
    key: "isdCo",
    label: "School districts (Colorado)",
    provider: "Colorado DOLA local-government registry, via the State of Colorado OIT GIS org",
    serviceUrl: "https://services3.arcgis.com/DgjqnJA1rgO92Soi/arcgis/rest/services/School_Districts/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    // The DOLA district services share ONE schema (DOLA_Districts) across school / water &
    // sanitation / metropolitan / fire — the DISTRICT KIND is which SERVICE you query, not a
    // field. `lgname` is the district's name; `lgtypeid` its DOLA type code.
    fields: { name: "lgname", abbrev: "abbrev_name", typeId: "lgtypeid", url: "url" },
    coverage: "colorado",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    // Live 2026-08-05: 178 districts statewide. Every one of the seven probe points ≥1.
  },

  waterDistrictCo: {
    key: "waterDistrictCo",
    label: "Water & sanitation districts (Colorado)",
    provider: "Colorado DOLA local-government registry, via the State of Colorado OIT GIS org",
    serviceUrl: "https://services3.arcgis.com/DgjqnJA1rgO92Soi/arcgis/rest/services/Water_and_Sanitation_Districts/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "lgname", abbrev: "abbrev_name", typeId: "lgtypeid", url: "url" },
    coverage: "colorado",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    /* ⛔ NOT a CCN, and the difference matters on a due-diligence screen. A Texas CCN is a PUC
     * retail MONOPOLY: inside it, that utility is obligated (and entitled) to serve. Colorado has
     * no CCN — a water & sanitation district is a special district under Title 32 with taxing and
     * service powers, and a site OUTSIDE every district is very often served by a MUNICIPALITY
     * instead (Denver Water, Aurora Water, Fort Collins Utilities). So an empty answer here means
     * "no special district" and NOT "no provider" — measured live 2026-08-05: 250 districts
     * statewide, but Denver 0 · Aurora 0 · Fort Collins 0 · Broomfield 0 · Colorado Springs 0
     * (all city-served) against Commerce City 1 · Greeley 1. Consumers must pair this with the
     * `cityCo` answer before saying anything about who serves a site. */
  },

  metroDistrictCo: {
    key: "metroDistrictCo",
    label: "Metropolitan districts (Colorado)",
    provider: "Colorado DOLA local-government registry, via the State of Colorado OIT GIS org",
    serviceUrl: "https://services3.arcgis.com/DgjqnJA1rgO92Soi/arcgis/rest/services/Metropolitan_Districts/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "lgname", abbrev: "abbrev_name", typeId: "lgtypeid", url: "url" },
    coverage: "colorado",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    /* The closest Colorado thing to a Texas MUD: a Title 32 metro district that issues debt and
     * levies a mill against the property to build and run infrastructure. On an industrial deal
     * that mill levy is a real carry cost, so this belongs on the screen. Live 2026-08-05: 2,231
     * statewide · Aurora 14 · Colorado Springs 6 · Broomfield 1; Commerce City / Denver / Greeley /
     * Fort Collins 0 at those points (correct — metro districts are development-specific, not
     * wall-to-wall). Fixtures therefore sit where districts genuinely are. */
  },

  roadCo: {
    key: "roadCo",
    label: "State highway routes (Colorado)",
    provider: "Colorado Department of Transportation (CDOT), ArcGIS Online",
    serviceUrl: "https://services.arcgis.com/yzB9WM8W0BO3Ql7d/arcgis/rest/services/Routes_gdb/FeatureServer/0",
    layerId: null,
    geometryType: "line",
    fields: { route: "ROUTE" },
    coverage: "colorado (CDOT on-system state highways only — NOT local streets)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    /* ⚠ DELIBERATELY NARROWER THAN THE TEXAS ROW, and the row label says so. The Texas `road`
     * row is the TxDOT Roadway Inventory: every street, with RDWAY_MAINT_AGCY naming the
     * maintainer outright. CDOT publishes no such statewide all-streets inventory on ArcGIS
     * Online — its Local Roads / Functional Class / Maintenance layers live on dtdapps.codot.gov,
     * which is blocked from this sandbox and unverifiable, so they are not wired. What this row
     * CAN answer honestly is the question that actually changes an industrial deal: is the
     * frontage a STATE HIGHWAY (CDOT permits the access) or not (city or county does). Live
     * 2026-08-05: 291 routes statewide — that is the size of the state highway system, not a clip. */
  },

  aadtCo: {
    key: "aadtCo",
    label: "CDOT traffic counts (AADT, Colorado)",
    provider: "Colorado Department of Transportation (CDOT), ArcGIS Online",
    serviceUrl: "https://services.arcgis.com/yzB9WM8W0BO3Ql7d/arcgis/rest/services/TraffonAllYrs_gdb/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { aadt: "AADT", road: "ROUTE", trucks: "AADTTRUCKS", year: "AADTYR", station: "COUNTSTATIONID" },
    coverage: "colorado (CDOT count stations on the state highway system)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    /* Live 2026-08-05: 3,261 count-station midpoints (Traffon2024_midpnt). Denver 8 ·
     * Broomfield 7 · Fort Collins 6 · Greeley 4 · Colorado Springs 1; Commerce City and Aurora 0
     * at those exact points — correct, because counts sit ON the state highway system and those
     * two probe points are off it. `AADTTRUCKS` is a bonus the Texas row has no equivalent for
     * and is worth surfacing on an industrial screen. */
  },

  cdpheCleanups: {
    key: "cdpheCleanups",
    label: "Colorado voluntary cleanup sites (VCUP)",
    provider: "Colorado Dept. of Public Health & Environment (CDPHE) — Hazardous Materials & Waste Management Division",
    serviceUrl: "https://services3.arcgis.com/66aUo8zsujfVXRIT/arcgis/rest/services/Voluntary_Cleanup_and_Redevelopment_Program_(VCUP)_new/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "Site", addr: "Address", city: "CityNam", status: "AppStatus", acres: "Acreage", vcupNo: "RV_Nmbr" },
    coverage: "colorado",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    /* The largest Colorado contaminated-site dataset by far and the one closest in SPIRIT to the
     * Texas LPST row: properties with a known or suspected release that entered CDPHE's voluntary
     * cleanup program. Live 2026-08-05: 1,697 statewide · Denver 32 · Colorado Springs 24 ·
     * Fort Collins 10 · Broomfield 5.
     * ⚠ It is NOT an LPST equivalent. Colorado's leaking petroleum storage-tank list is kept by
     * the Division of Oil & Public Safety (Dept. of Labor & Employment), which publishes no
     * verified public REST endpoint — so petroleum-tank releases specifically remain a named gap
     * (coloradoRegions.CAPABILITIES.petroleumTankReleases), not a silent absence. */
  },

  cdpheSuperfund: {
    key: "cdpheSuperfund",
    label: "Colorado Superfund sites (CDPHE)",
    provider: "Colorado Dept. of Public Health & Environment (CDPHE) — HMWMD",
    serviceUrl: "https://services3.arcgis.com/66aUo8zsujfVXRIT/arcgis/rest/services/CDPHE_Superfund/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "NAME", city: "CITY", status: "SiteStatus", pollutants: "POLLUTANTS", link: "CDPHE_LINK" },
    coverage: "colorado",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    /* Only 31 statewide — and that is the honest number, not a clip: Colorado has ~30 Superfund
     * sites. None of the seven probe points hit one (correct; they are rare and mostly rural),
     * so the fixtures use the sites' own BOUNDARIES rather than a city point. Unlike the point
     * layers this is a POLYGON layer, which is what makes it worth carrying alongside the
     * national `epaCleanups` row: an EPA point tells you a site is "near", this tells you whether
     * the parcel is INSIDE one. */
  },

  cdpheBrownfields: {
    key: "cdpheBrownfields",
    label: "Colorado brownfields (CDPHE)",
    provider: "Colorado Dept. of Public Health & Environment (CDPHE) — HMWMD",
    serviceUrl: "https://services3.arcgis.com/66aUo8zsujfVXRIT/arcgis/rest/services/CDPHE_Brownfield/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "Site", addr: "Address", city: "City", county: "County", status: "SitStts", acres: "AreAcrs", landUse: "LndUsTy" },
    coverage: "colorado",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    // Live 2026-08-05: 133 statewide · Fort Collins 2. Sparse by nature — a brownfield is a
    // specific designated property, so most points return 0 and that is the correct answer.
  },

  // ---- Mile High Flood District — the Colorado local drainage-authority tier -----------
  // The Colorado counterpart of the HCFCD / BKDD / FBCDD families. MHFD (formerly UDFCD) covers
  // Adams, Arapahoe, Boulder, Broomfield, Denver, Douglas and Jefferson — which is where the
  // owner's Commerce City, Arapahoe and Broomfield sites all sit. Larimer, Weld and El Paso are
  // deliberately OUTSIDE it and each run their own criteria (coloradoRegions.CO_COUNTY_REGIME
  // already encodes that, and the mhfdBoundary fixtures below PROVE it against the live service).
  mhfdBoundary: {
    key: "mhfdBoundary",
    label: "Mile High Flood District boundary",
    provider: "Mile High Flood District (MHFD, formerly UDFCD)",
    serviceUrl: "https://services3.arcgis.com/TCnvslgqrzhT2ZXG/arcgis/rest/services/BOUNDARY_(View)/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { areaAc: "area_ac", areaSqMi: "area_sqmi" },
    coverage: "Mile High Flood District (Adams, Arapahoe, Boulder, Broomfield, Denver, Douglas, Jefferson)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    /* The point-in-district test that decides which Colorado drainage regime governs — the exact
     * job `bkddBoundary` does in Texas. Live 2026-08-05, and it agrees with the county table
     * EXACTLY: Commerce City 1 · Denver 1 · Aurora 1 · Broomfield 1 (in); Greeley/Weld 0 ·
     * Fort Collins/Larimer 0 · Colorado Springs/El Paso 0 (out). The out-of-district fixtures are
     * as load-bearing as the in-district ones — a service that silently grew to cover Weld would
     * hand Weld sites MHFD criteria they are not subject to. */
  },

  mhfdStreams: {
    key: "mhfdStreams",
    label: "MHFD major drainageways",
    provider: "Mile High Flood District (MHFD)",
    serviceUrl: "https://services3.arcgis.com/TCnvslgqrzhT2ZXG/arcgis/rest/services/MHFD_StreamsLegacy/FeatureServer/0",
    layerId: null,
    geometryType: "line",
    fields: { name: "str_name", code: "udfcdcode", cls: "class", major: "major_stream" },
    coverage: "Mile High Flood District (Denver metro)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    // Live 2026-08-05: 965 statewide · Commerce City 8 · Aurora 4 · Broomfield 3 · Denver 1;
    // Weld / Larimer / El Paso 0 (outside the district — correct, and the nhdHydro national row
    // is what answers "is there a channel here" for those).
  },

  mhfdWatersheds: {
    key: "mhfdWatersheds",
    label: "MHFD watershed delineation",
    provider: "Mile High Flood District (MHFD)",
    serviceUrl: "https://services3.arcgis.com/TCnvslgqrzhT2ZXG/arcgis/rest/services/MHFDWatershedDelineation/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "UDFCD_NAM", id: "UDFCD_ID" },
    coverage: "Mile High Flood District (Denver metro)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    // Live 2026-08-05: 316 statewide · Commerce City 4 · Aurora 4 · Denver 3 · Broomfield 3.
  },

  mhfdChannels: {
    key: "mhfdChannels",
    label: "MHFD surface & open channels",
    provider: "Mile High Flood District (MHFD) — SWIMS infrastructure inventory",
    serviceUrl: "https://services3.arcgis.com/TCnvslgqrzhT2ZXG/arcgis/rest/services/INFRASTRUCTURE_(View)/FeatureServer/5",
    layerId: null,
    geometryType: "line",
    // `channel_maintainedby` / `channel_ownedby` are the reason this row is worth carrying next to
    // mhfdStreams: they name WHO is responsible for the channel a site would discharge into.
    fields: { name: "channel_name", ownedBy: "channel_ownedby", maintainedBy: "channel_maintainedby", jurisdiction: "channel_jurisdiction" },
    coverage: "Mile High Flood District (Denver metro)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    // Live 2026-08-05: 25,800 statewide · Aurora 13 · Commerce City 10 · Denver 10.
  },

  mhfdOutfalls: {
    key: "mhfdOutfalls",
    label: "MHFD storm outfalls",
    provider: "Mile High Flood District (MHFD) — SWIMS infrastructure inventory",
    serviceUrl: "https://services3.arcgis.com/TCnvslgqrzhT2ZXG/arcgis/rest/services/INFRASTRUCTURE_(View)/FeatureServer/10",
    layerId: null,
    geometryType: "point",
    fields: { name: "outfall_name", ownedBy: "outfall_ownedby", maintainedBy: "outfall_maintainedby", jurisdiction: "outfall_jurisdiction" },
    coverage: "Mile High Flood District (Denver metro)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    // Live 2026-08-05: 13,773 statewide · Commerce City 4. Sparse by nature (an outfall is a
    // structure, not a network), so the fixture sits where one genuinely is.
  },
};

/* NEW-2 — WHICH STATES A ROW CAN ANSWER IN.
 *
 * Why this exists: a user in Colorado who toggles "Traffic counts (AADT)" or "Leaking petroleum
 * tanks (LPST)" on and gets an empty map cannot tell "nothing here" from "we do not have this
 * here" — and on a due-diligence screen those are completely different facts. Every row must
 * therefore declare the states it can answer in, so a surface can say which one it is.
 *
 * A row may declare `states` on itself (every Colorado row above does). Everything else is
 * declared HERE, in one table, because stamping the same two-letter code onto forty pre-existing
 * rows would have buried the actual endpoint facts each row is supposed to carry. `null` means
 * NATIONAL — it genuinely answers anywhere (FEMA NFHL, NWI, HIFLD, EPA, BTS rail, FAA, NHD).
 *
 * `auditRegistry` FAILS on any row missing from both, so a new row cannot be added without
 * saying where it works. */
export const SOURCE_STATE_SCOPE = {
  // National — no state gate.
  flood: null, wetlands: null, epaCleanups: null, transmission: null, substations: null,
  rail: null, airports: null, nhdFlowline: null, nhdHydro: null, nhdHydroWaterbody: null,
  // Texas-only. Every one of these is a Texas institution with no Colorado counterpart at all
  // (the RRC, the PUC's CCN construct, TCEQ, TxDOT, TEA, TxGIO) or a Texas-region study.
  oilgas: ["TX"], pipelines: ["TX"], ccnWater: ["TX"], ccnSewer: ["TX"], lpst: ["TX"],
  growthFaults: ["TX"], aadt: ["TX"], county: ["TX"], city: ["TX"], road: ["TX"], isd: ["TX"],
  etj_hgac: ["TX"], etj_austin: ["TX"], etj_fortworth: ["TX"], etj_baytown: ["TX"], mud: ["TX"], bkdd: ["TX"],
  hcfcdChannels: ["TX"], hcfcdWatersheds: ["TX"], hcfcdMaapnext: ["TX"],
  fbcddWse02: ["TX"], fbcddWse100: ["TX"],
  bkddStreams: ["TX"], bkddAllStreams: ["TX"], bkddEasements: ["TX"], bkddEasements107: ["TX"],
  bkddSubwatersheds: ["TX"], bkddFloodplainBfe: ["TX"], bkddOutfalls: ["TX"], bkddBoundary: ["TX"],
  bkddDmpFloodplain: ["TX"], bkddDmpImprovements: ["TX"],
  // FEMA InFRM BLE is a REGION-6 product (Gulf-central). It is not national and it is not
  // Texas-only — it reaches into Louisiana, Arkansas and Oklahoma — but it does NOT reach
  // Colorado, which is what a Colorado site needs told. Measured 2026-08-05: NoData at
  // Commerce City, real values in Waller County.
  femaEbfe: ["TX", "LA", "AR", "OK"],
};

/* The states a row can answer in: its own `states` wins, else the table, else undefined (which
 * `auditRegistry` rejects). `null` = national. Pure. */
export function statesFor(entry) {
  if (!entry) return undefined;
  if (Array.isArray(entry.states)) return entry.states;
  if (entry.states === null) return null;
  return Object.prototype.hasOwnProperty.call(SOURCE_STATE_SCOPE, entry.key) ? SOURCE_STATE_SCOPE[entry.key] : undefined;
}

/* Can this row answer in `state` (a two-letter code, or null/unknown)? A national row always
 * can; an UNKNOWN state always can (the pre-Colorado world, where every site was Texas — the
 * gate fires on a POSITIVE mismatch, never on the absence of an answer). Pure. */
export function sourceCoversState(entry, state) {
  const scope = statesFor(entry);
  if (!scope) return true;               // national (or undeclared — audit catches that separately)
  if (!state) return true;               // unknown location → never hide anything
  return scope.includes(String(state).toUpperCase());
}

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
export function tierProblems(entry, docs = null) {
  const problems = [];
  // NEW-4 — `tierReason` moved to sourceFixtures.js (off the app bundle; see its header). The
  // RULE is unchanged and still enforced: a monitored exception must explain itself. Callers
  // that can import the docs pass them; `entry` remains accepted so nothing else has to change.
  const reason = docs ? docs.tierReason : entry.tierReason;
  if (!VALID_TIERS.includes(entry.tier)) {
    problems.push(`${entry.key}: invalid tier "${entry.tier}" (must be one of ${VALID_TIERS.join(", ")})`);
  }
  const nonProd = looksNonProduction(entry.serviceUrl);
  if (nonProd && entry.tier !== "monitored-exception") {
    problems.push(`${entry.key}: serviceUrl looks non-production (${entry.serviceUrl}) but tier is "${entry.tier}" — mark it "monitored-exception" with a tierReason, or repoint to a production endpoint.`);
  }
  if (entry.tier === "monitored-exception" && !reason) {
    problems.push(`${entry.key}: tier "monitored-exception" requires a tierReason explaining why no production endpoint is used.`);
  }
  if (!entry.serviceUrl || !/^https:\/\//.test(entry.serviceUrl)) {
    problems.push(`${entry.key}: serviceUrl must be an https:// URL.`);
  }
  return problems;
}

/* NEW-1 — EVERY ROW MUST CARRY AT LEAST ONE COVERAGE FIXTURE.
 *
 * This is the hole that let two production flood layers rot for weeks with a green weekly drift
 * job: a row with no fixture is INVISIBLE to gis-source-coverage-verify, because the only thing
 * the verifier can assert about it is that its metadata parsed. Twelve rows were in that state.
 * A fixture is a `fixtures[]` entry (a /query count) or a `sampleFixtures[]` entry (a raster
 * getSamples / identify probe) — whichever kind the row's `kind` implies. Pure. */
export function fixtureCount(entry, fixtures = null) {
  const rec = fixtures || entry || {};
  return ((rec.fixtures) || []).length + ((rec.sampleFixtures) || []).length;
}

/* ═══ B209505 — A FIXTURE SET THAT CANNOT FAIL IS NOT MEASURING ANYTHING ════════════════════════
 *
 * THE FINDING THAT PRODUCED THIS RULE. Every one of the registry's fixtures passed while the owner
 * ran 27 layers against six new Houston-area sites and reported five of them returning nothing.
 * The layers turned out to be alive (see the B209505 notes on the rows themselves) — but the audit
 * that was supposed to be able to tell us that could not have. 45 of 57 rows carried exactly ONE
 * fixture point, so each row's entire claim to work anywhere rested on one place. `epaCleanups`
 * is the cleanest illustration: its single Pasadena fixture passed continuously while the layer
 * returned nothing across six industrial sites, because Pasadena is the one place it was ever
 * asked about. A passing fixture was never evidence of coverage; it was evidence of one point.
 *
 * THE RULE. A row must be probed at points that are actually SEPARATED, and how separated is a
 * function of what the row CLAIMS to cover — a national layer proven only in Houston has proven
 * nothing about being national, while a single drainage district genuinely cannot be probed 200 km
 * apart. So the reach requirement is declared per class, and a row that cannot meet its class must
 * say why IN the registry rather than quietly sit at one point:
 *
 *   national  ≥3 points, ≥1000 km apart — must answer well outside Texas
 *   state     ≥3 points, ≥200 km apart  — must answer outside its one metro
 *   regional  ≥2 points, ≥15 km apart   — a metro / county / multi-county district
 *   local     ≥2 points, ≥2 km apart    — one small district; separation is all that is available
 *
 * Class is DERIVED from the state scope the row already declares (national when `states` is null,
 * state otherwise) and overridden only in `SOURCE_FIXTURE_REACH` below, where each override
 * carries a reason. Deriving it keeps a new row honest by default: it inherits the strictest
 * requirement its own scope implies, and weakening that is a deliberate, reviewed edit.
 *
 * WHAT THIS DOES NOT DO. It does not check that a fixture's expectation is CORRECT — only that the
 * row is asked about more than one place. Correctness comes from the counts having been measured
 * live (`scripts/probe-fixture-candidates.mjs`) rather than guessed. */
export const FIXTURE_REACH_CLASSES = {
  national: { minPoints: 3, minSpreadKm: 1000 },
  state: { minPoints: 3, minSpreadKm: 200 },
  regional: { minPoints: 2, minSpreadKm: 15 },
  local: { minPoints: 2, minSpreadKm: 2 },
};

/* Per-row class overrides. A row appears here ONLY when its real coverage is narrower than its
 * state scope implies, and the value is `[class, reason]` so the audit can require the reason.
 * A row absent from this table takes the class its state scope derives. */
export const SOURCE_FIXTURE_REACH = {
  // Houston-region drainage/utility districts — a county or a metro, not a state.
  ccnSewer: ["regional", "Harris County GIS re-serve of the PUCT CCN; its coverage is the Houston metro region, not the state (no statewide sewer-CCN REST endpoint exists)."],
  growthFaults: ["regional", "The USGS SIM 2874 study extent IS the Houston metropolitan area — there are no growth-fault traces to probe outside it."],
  hcfcdChannels: ["regional", "Harris County Flood Control District — one county by definition."],
  hcfcdWatersheds: ["regional", "Harris County Flood Control District — one county by definition."],
  hcfcdMaapnext: ["regional", "HCFCD MAAPnext model results cover Harris County only."],
  etj_hgac: ["regional", "The H-GAC 13-county region; probing it in Dallas would assert a guaranteed zero."],
  etj_austin: ["regional", "One city's 2-mile ETJ ring."],
  etj_fortworth: ["regional", "One city's ETJ."],
  // NEW-1a — Baytown's own ETJ ring, added because H-GAC's regional mosaic omits Baytown. It is one
  // city's ETJ, a few km across; two points inside it (one also inside the city limits, one not) is
  // the most separation this layer HAS, exactly as with the Austin and Fort Worth rows.
  etj_baytown: ["local", "One city's ETJ ring, a few km across — there is no wider extent to probe."],
  // The BKDD tier — ONE drainage district, roughly 20 km across. `local` is the honest class:
  // two separated points inside the district is the most separation that exists to buy.
  bkdd: ["local", "The Brookshire–Katy Drainage District is a single district ~20 km across."],
  bkddStreams: ["local", "Single BKDD district."],
  bkddAllStreams: ["local", "Single BKDD district."],
  bkddEasements: ["local", "Single BKDD district."],
  bkddEasements107: ["local", "Single BKDD district."],
  bkddSubwatersheds: ["local", "Single BKDD district."],
  bkddFloodplainBfe: ["local", "Single BKDD district."],
  bkddOutfalls: ["local", "Single BKDD district."],
  bkddBoundary: ["local", "Single BKDD district — one boundary polygon."],
  bkddDmpFloodplain: ["local", "BKDD Drainage Master Plan study area."],
  bkddDmpImprovements: ["local", "BKDD Drainage Master Plan study area."],
  // Fort Bend county WSE rasters.
  fbcddWse02: ["regional", "Fort Bend County drainage district rasters — one county."],
  fbcddWse100: ["regional", "Fort Bend County drainage district rasters — one county."],
  // The MHFD tier — the Denver metro flood district, six counties.
  mhfdBoundary: ["regional", "Mile High Flood District — the Denver metro, six counties."],
  mhfdStreams: ["regional", "Mile High Flood District — the Denver metro."],
  mhfdWatersheds: ["regional", "Mile High Flood District — the Denver metro."],
  mhfdChannels: ["regional", "Mile High Flood District — the Denver metro."],
  mhfdOutfalls: ["regional", "Mile High Flood District — the Denver metro."],
  // Two Colorado rows whose PROGRAM is statewide but whose FEATURES cluster in the Denver metro.
  // Measured 2026-08-06 by asking each layer where its own features are: the water/metro district
  // layers' farthest sampled pair does not clear 200 km, so `state` would demand a separation the
  // data does not contain. (cdpheSuperfund and cdpheBrownfields DO clear it — 377 km and 593 km —
  // and are deliberately NOT listed here.)
  waterDistrictCo: ["regional", "Colorado water districts in this layer cluster in the Denver metro / Front Range."],
  metroDistrictCo: ["regional", "Colorado metropolitan districts cluster along the Front Range."],
  // FEMA InFRM BLE is Region 6, and deliberately publishes NOTHING over studied areas, so its
  // fixtures are a mix of in-coverage values and by-design no-data points.
  femaEbfe: ["regional", "FEMA Region 6 Base Level Engineering — published only over UNSTUDIED reaches, so most of the state is no-data by design."],
};

/* ⛔ ROWS WHOSE REACH CANNOT BE WIDENED FROM THIS BUILD ENVIRONMENT, and why.
 *
 * A fixture has to be MEASURED against the live service, and twelve rows sit on three hosts this
 * sandbox's egress policy blocks outright (`txgeo.usgs.gov`, `fximgservices.hcfcd.org`,
 * `gisclient.quiddity.com` — every request returns "Host not in allowlist", not a service answer).
 * Their existing single fixtures were written when someone could reach them; adding more from here
 * would mean inventing counts, which is precisely the failure B209505 exists to end.
 *
 * So the requirement is DEFERRED, never dropped, and never silently: each row names the host that
 * blocks it and the V# that closes it. `auditRegistry` still enforces everything else about these
 * rows, and the entry is required to carry a reason — an empty one is itself a problem. This is
 * the same shape as `countiesProvenance.js`'s `candidateUrl`: record the gap in the registry
 * rather than let a green check imply coverage nobody verified.
 *
 * ⚠ A guard that becomes an outage is worse than the gap it covers (the check-mint precedent), so
 * this list may only SHRINK: when a host becomes reachable, widen that row's fixtures and delete
 * its row here in the same commit. */
export const SOURCE_FIXTURE_REACH_PENDING = {
  femaEbfe: "txgeo.usgs.gov is blocked by this build environment's egress policy (verified 2026-08-06: every request returns 'Host not in allowlist'). Its four sampleFixtures were measured live on 2026-08-05 from an unblocked network and are kept. → V17706.",
  hcfcdMaapnext: "fximgservices.hcfcd.org unreachable (this row is already `availability: down` with an outage record, so its fixtures deliberately assert the OUTAGE). → V17706.",
  bkddStreams: "gisclient.quiddity.com blocked by egress policy. → V17706.",
  bkddAllStreams: "gisclient.quiddity.com blocked by egress policy. → V17706.",
  bkddEasements: "gisclient.quiddity.com blocked by egress policy. → V17706.",
  bkddEasements107: "gisclient.quiddity.com blocked by egress policy. → V17706.",
  bkddSubwatersheds: "gisclient.quiddity.com blocked by egress policy. → V17706.",
  bkddFloodplainBfe: "gisclient.quiddity.com blocked by egress policy. → V17706.",
  bkddOutfalls: "gisclient.quiddity.com blocked by egress policy. → V17706.",
  bkddBoundary: "gisclient.quiddity.com blocked by egress policy. → V17706.",
  bkddDmpFloodplain: "gisclient.quiddity.com blocked by egress policy. → V17706.",
  bkddDmpImprovements: "gisclient.quiddity.com blocked by egress policy. → V17706.",
};

/* The reach class for a row, derived from its state scope unless overridden. Pure. */
export function fixtureReachClassFor(entry) {
  const o = SOURCE_FIXTURE_REACH[entry && entry.key];
  if (o) return o[0];
  return statesFor(entry) === null ? "national" : "state";
}

/* Great-circle km between two [lng, lat] points. Pure. */
export function haversineKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Every fixture's representative point ([lng, lat]) — a point fixture's own point, or a bbox
 * fixture's centre. Pure. */
export function fixturePoints(fx) {
  const all = [...((fx && fx.fixtures) || []), ...((fx && fx.sampleFixtures) || [])];
  return all
    .map((f) => (f.point ? f.point : f.bbox ? [(f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2] : null))
    .filter(Boolean);
}

/* The widest separation between any two of a row's fixture points, in km. Pure. */
export function fixtureSpreadKm(fx) {
  const pts = fixturePoints(fx);
  let max = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) max = Math.max(max, haversineKm(pts[i], pts[j]));
  return max;
}

/* Does this row's fixture set actually reach across what the row claims to cover? Pure. */
export function fixtureReachProblems(entry, fx) {
  const problems = [];
  const pending = SOURCE_FIXTURE_REACH_PENDING[entry && entry.key];
  if (pending !== undefined) {
    // Deferred, but the DEFERRAL itself is audited: an entry with no stated reason is a problem,
    // because "we couldn't check" has to be distinguishable from "we didn't bother".
    if (!String(pending || "").trim()) {
      problems.push(`${entry.key}: SOURCE_FIXTURE_REACH_PENDING entry must state which host blocks it and the V# that closes it.`);
    }
    return problems;
  }
  const cls = fixtureReachClassFor(entry);
  const rule = FIXTURE_REACH_CLASSES[cls];
  if (!rule) return [`${entry.key}: unknown fixture reach class "${cls}".`];
  const override = SOURCE_FIXTURE_REACH[entry.key];
  if (override && !String(override[1] || "").trim()) {
    problems.push(`${entry.key}: SOURCE_FIXTURE_REACH override must carry a REASON — a narrowed requirement with no justification is how a row goes back to being unfalsifiable.`);
  }
  const pts = fixturePoints(fx);
  if (pts.length < rule.minPoints) {
    problems.push(
      `${entry.key}: only ${pts.length} fixture point(s); a "${cls}" row needs ≥${rule.minPoints}. ` +
      `One point proves the service answers THERE, never that it covers what the row claims — that is ` +
      `exactly how epaCleanups passed its Pasadena fixture while returning nothing across six other sites.`
    );
  }
  const spread = fixtureSpreadKm(fx);
  if (pts.length >= 2 && spread < rule.minSpreadKm) {
    problems.push(
      `${entry.key}: fixture points span only ${spread.toFixed(0)} km; a "${cls}" row needs ≥${rule.minSpreadKm} km. ` +
      `Clustered fixtures re-test one place several times.`
    );
  }
  return problems;
}

/* Validate one row's availability/outage integrity. Pure. */
export function availabilityProblems(entry) {
  const problems = [];
  const av = availabilityOf(entry);
  if (!VALID_AVAILABILITY.includes(av)) {
    problems.push(`${entry.key}: invalid availability "${av}" (must be one of ${VALID_AVAILABILITY.join(", ")}).`);
    return problems;
  }
  if (av === "live") {
    if (entry.outage) problems.push(`${entry.key}: availability "live" must not carry an outage record — clear it, or set availability to "degraded"/"down".`);
    return problems;
  }
  const o = entry.outage;
  if (!o) {
    problems.push(`${entry.key}: availability "${av}" REQUIRES an outage record { since, symptom, evidence, impact, replacement } — a row that doesn't answer must say so in the registry, not silently return nothing.`);
    return problems;
  }
  for (const f of ["since", "symptom", "evidence", "impact", "replacement"]) {
    if (!o[f]) problems.push(`${entry.key}: outage.${f} is required (availability "${av}").`);
  }
  if (o.since && !/^\d{4}-\d{2}-\d{2}$/.test(o.since)) problems.push(`${entry.key}: outage.since must be a YYYY-MM-DD date.`);
  return problems;
}

/* Validate the whole registry (shape + tier + availability + fixture coverage + state scope).
 * Returns { problems[] }. Pure. */
export function auditRegistry(sources = GIS_SOURCES, sourceFixtures = null, sourceDocs = null) {
  const problems = [];
  for (const [key, entry] of Object.entries(sources)) {
    // NEW-4 — the fixtures live in `sourceFixtures.js` (off the runtime bundle; see that
    // module's header). Callers that can afford to import it — the weekly verifier and the unit
    // guards — pass it here so the fixture-completeness rule is still enforced; a caller that
    // does not pass one is only auditing the endpoint facts.
    const fx = sourceFixtures ? (sourceFixtures[key] || {}) : entry;
    if (entry.key !== key) problems.push(`${key}: entry.key "${entry.key}" doesn't match its map key.`);
    if (!entry.provider) problems.push(`${key}: missing provider (the authoritative agency).`);
    if (!entry.lastVerified || !/^\d{4}-\d{2}-\d{2}$/.test(entry.lastVerified)) {
      problems.push(`${key}: lastVerified must be a YYYY-MM-DD date.`);
    }
    if (fixtureCount(entry, fx) === 0) {
      problems.push(
        `${key}: NO coverage fixture. Every row must carry at least one \`fixtures\` (query count) or ` +
        `\`sampleFixtures\` (raster probe) entry at a real point — a fixture-less row is invisible to ` +
        `the weekly drift job, which is exactly how hcfcdMaapnext and femaEbfe rotted unnoticed.`
      );
    }
    if (statesFor(entry) === undefined) {
      problems.push(
        `${key}: no state scope. Declare \`states: ["XX", …]\` on the row, or add it to ` +
        `SOURCE_STATE_SCOPE (\`null\` = national) — otherwise a user outside its coverage can't ` +
        `tell "nothing here" from "we don't have this here".`
      );
    }
    // B209505 — one fixture point is not coverage. Only enforced when the caller supplied the
    // fixture module (the weekly verifier and the unit guards); a caller auditing endpoint facts
    // alone has nothing to measure reach against.
    if (sourceFixtures && fixtureCount(entry, fx) > 0) problems.push(...fixtureReachProblems(entry, fx));
    problems.push(...tierProblems(entry, sourceDocs ? (sourceDocs[key] || {}) : null));
    problems.push(...availabilityProblems(entry));
  }
  return { problems };
}
