/* NEW-1/NEW-4 — the GIS registry's VERIFICATION payload, split out of the runtime registry.
 *
 * WHY THIS IS ITS OWN MODULE, and the rule it follows: coverage fixtures are ASSERTIONS, not
 * endpoint facts. Nothing in the app reads them — they exist for the weekly drift verifier
 * (gis-verify/gis-source-coverage-verify.mjs) and the unit guards. But `sources.js` IS on the
 * Site route's critical path, so every fixture label, bbox and expected count was being shipped
 * to every browser that opens a plan. Adding Colorado (fourteen rows, forty-one fixtures) made
 * that measurable: the Site-route chunk went past its perf ceiling.
 *
 * This is the repo's existing "split by tier, don't hope for tree-shaking" precedent
 * (`sheetFurniture.js` → `sheetFurnitureLayout.js`): a module imported by BOTH the boot path and
 * a tooling path gets hoisted whole into the bundle, because shaking drops unused EXPORTS, never
 * unused PROPERTIES of an object that is used. So the fixtures move to a module the app never
 * imports, and `sources.js` keeps only what the running app actually reads.
 *
 * ⛔ Do NOT re-inline these into the rows to "keep it all in one place". The registry is still
 * the single source of truth for every ENDPOINT fact; this is the test fixture beside it, and
 * `auditRegistry` fails any row that has no entry here — so the two cannot drift apart silently.
 *
 * Keyed by the registry key. Shapes are unchanged:
 *   fixtures[]       — { label, point|bbox, expectMinCount, layer? }  (a /query count)
 *   sampleFixtures[] — { label, point, expectValueRange|expectNoData, serviceUrl? }  (a raster probe)
 */
export const SOURCE_FIXTURES = {
  flood: {
  fixtures: [
    // Galveston/Bolivar coast — wall-to-wall SFHA, a robust national-service sanity check.
    { label: "Galveston coast SFHA", bbox: [-94.85, 29.28, -94.70, 29.40], expectMinCount: 1 },
  ],
  },
  wetlands: {
  fixtures: [
    // Sheldon Lake State Park, NE Harris Co. — known dense NWI polygons (≈58 confirmed live).
    { label: "Sheldon Lake wetlands", bbox: [-95.18, 29.84, -95.10, 29.90], layer: 2, expectMinCount: 1 },
  ],
  },
  oilgas: {
  fixtures: [
    // The centerpiece guard: a county-clipped source FAILS these immediately.
    { label: "Chambers County wells", bbox: [-94.92, 29.40, -94.40, 29.95], expectMinCount: 1000 },
    { label: "Mont Belvieu (Grand Port) wells", point: [-94.886, 29.846], expectMinCount: 1 },
  ],
  },
  pipelines: {
  fixtures: [
    { label: "Chambers County pipelines", bbox: [-94.92, 29.40, -94.40, 29.95], expectMinCount: 1000 },
  ],
  },
  ccnWater: {
  fixtures: [
    // Cypress — dense CCN country (same point the `mud` fixture uses); a county-clipped or
    // dead source fails this. Queried as a ~1 km envelope by the drift verifier.
    { label: "Cypress-area water CCN", point: [-95.69, 29.97], expectMinCount: 1 },
  ],
  },
  ccnSewer: {
  fixtures: [
    { label: "Cypress-area sewer CCN", point: [-95.69, 29.97], expectMinCount: 1 },
  ],
  },
  lpst: {
  fixtures: [
    // Pasadena / Ship Channel — dense LPST country (24 within a mile, live 2026-07-18).
    { label: "Pasadena LPST cluster", point: [-95.21, 29.72], expectMinCount: 1 },
  ],
  },
  epaCleanups: {
  fixtures: [
    // Pasadena Refining area — NPL/RCRA sites present (live 2026-07-18).
    { label: "Pasadena refining cleanups", point: [-95.21, 29.72], expectMinCount: 1 },
  ],
  },
  growthFaults: {
  fixtures: [
    // NW Houston — dense growth-fault country (25 traces in this envelope, live 2026-07-18).
    { label: "NW Houston fault traces", bbox: [-95.60, 29.75, -95.40, 29.95], expectMinCount: 1 },
  ],
  },
  transmission: {
  fixtures: [
    // Katy / west Houston — dense transmission country (≥1 line in any ~1 km envelope; live 2026-07-18).
    { label: "West Houston transmission", bbox: [-95.70, 29.75, -95.55, 29.85], expectMinCount: 1 },
  ],
  },
  substations: {
  fixtures: [
    // Downtown Houston — dense substation country (18 within 3 mi, live 2026-07-18). A regional
    // subset (e.g. the South-Texas-only republication) reads 0 here and fails immediately.
    { label: "Downtown Houston substations", point: [-95.36, 29.76], expectMinCount: 1 },
  ],
  },
  aadt: {
  fixtures: [
    // West Houston / Katy — dense count network (≥1 station in any ~1 km envelope; live 2026-07-18,
    // AADT ~45k on I-10 corridor). A dead/clipped source fails this.
    { label: "West Houston AADT", point: [-95.75, 29.78], expectMinCount: 1 },
  ],
  },
  rail: {
  fixtures: [
    // Downtown Houston — dense rail country (90 segments within 2 mi, live 2026-07-18; UP-owned).
    { label: "Downtown Houston rail", bbox: [-95.40, 29.73, -95.33, 29.79], expectMinCount: 1 },
  ],
  },
  airports: {
  fixtures: [
    // Hobby Airport (HOU) area — a public-use airport + nearby heliports (live 2026-07-18).
    { label: "Houston Hobby area airports", point: [-95.28, 29.65], expectMinCount: 1 },
  ],
  },
  county: {
  fixtures: [{ label: "Harris County", point: [-95.37, 29.76], expectMinCount: 1 }],
  },
  countyCo: {
  fixtures: [{ label: "Denver County", point: [-104.9903, 39.7392], expectMinCount: 1 }],
  },
  city: {
  fixtures: [{ label: "City of Houston", point: [-95.37, 29.76], expectMinCount: 1 }],
  },
  road: {
  fixtures: [{ label: "I-10 corridor at Katy", point: [-95.79, 29.78], expectMinCount: 1 }],
  },
  isd: {
  fixtures: [
    // Coverage sanity — a county-clipped or wrong source fails these immediately.
    { label: "Goose Creek CISD (Baytown)", point: [-94.977, 29.735], expectMinCount: 1 },
    { label: "Houston ISD (downtown)", point: [-95.37, 29.76], expectMinCount: 1 },
    { label: "Katy ISD", point: [-95.79, 29.79], expectMinCount: 1 },
  ],
  },
  etj_hgac: {
  fixtures: [{ label: "Katy-area ETJ (H-GAC region)", point: [-95.79, 29.79], expectMinCount: 1 }],
  },
  etj_austin: {
  fixtures: [{ label: "Austin 2-mile ETJ (NW of the city)", point: [-97.8963, 30.3916], expectMinCount: 1 }],
  },
  etj_fortworth: {
  fixtures: [{ label: "Fort Worth ETJ (south)", point: [-97.2384, 32.6382], expectMinCount: 1 }],
  },
  mud: {
  fixtures: [
    // Bridgeland/Cypress — dense MUD country; ≥1 district polygon at any envelope here.
    { label: "Cypress-area water districts", point: [-95.69, 29.97], expectMinCount: 1 },
  ],
  },
  bkdd: {
  fixtures: [
    // A point well inside the district near Katy/Brookshire → the single boundary polygon.
    { label: "Inside BKDD (near Katy)", point: [-95.9, 29.82], expectMinCount: 1 },
  ],
  },
  hcfcdChannels: {
  fixtures: [
    // Buffalo Bayou through downtown — unit W100-00-00, multiple segments in any 1-km envelope.
    { label: "Buffalo Bayou downtown", point: [-95.37, 29.76], expectMinCount: 1 },
  ],
  },
  hcfcdWatersheds: {
  fixtures: [
    { label: "Buffalo Bayou watershed", point: [-95.37, 29.76], expectMinCount: 1 },
  ],
  },
  fbcddWse02: {
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
  },
  nhdFlowline: {
  fixtures: [
    // Willow Fork / Cane Island near Katy — dense named flowlines in any ~1 km envelope.
    { label: "Willow Fork (Katy)", point: [-95.83, 29.78], expectMinCount: 1 },
  ],
  },
  fbcddWse100: {
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
  },
  femaEbfe: {
  sampleFixtures: [
    // Live-measured 2026-08-05 (see the identifyLayers note). These are REAL values now, not
    // a provisional guess — a repointed/renumbered raster fails them immediately.
    { label: "Tsakiris tract, Waller (in BLE coverage)", point: [-95.89503, 29.77938], expectValueRange: [140, 170] },
    { label: "north Waller County (in BLE coverage)", point: [-96.0, 30.05], expectValueRange: [190, 220] },
    // Houston is STUDIED, so BLE deliberately has no surface there. This fixture pins that
    // distinction: a service that starts answering here has changed what it publishes.
    { label: "downtown Houston (studied — BLE no-data by design)", point: [-95.37, 29.76], expectNoData: true },
    { label: "far outside Region 6 (out of coverage)", point: [-110.0, 44.0], expectNoData: true },
  ],
  fixtures: [], // raster — see sampleFixtures (identify probe)
  },
  hcfcdMaapnext: {
  sampleFixtures: [
    // While `availability: "down"` these assert the OUTAGE (the verifier expects the probe to
    // fail). The moment the host answers again the verifier reports it LOUDLY as a recovery,
    // and these become the real value fixtures. Range = plausible Harris ft-NAVD88 ground/WSE.
    { label: "central Harris 1% WSE (expected once the host returns)", point: [-95.37, 29.76], expectValueRange: [0, 200], serviceUrl: "https://fximgservices.hcfcd.org/arcgis/rest/services/MAAPNext/WSE_100YR/ImageServer" },
    { label: "central Harris 0.2% WSE (expected once the host returns)", point: [-95.37, 29.76], expectValueRange: [0, 200], serviceUrl: "https://fximgservices.hcfcd.org/arcgis/rest/services/MAAPNext/WSE_500YR/ImageServer" },
  ],
  fixtures: [],
  },
  bkddStreams: {
  fixtures: [
    // The Tsakiris tract — the site whose "nothing shows" report produced this family.
    { label: "Tsakiris (Waller, in BKDD)", point: [-95.89503, 29.77938], expectMinCount: 1 },
  ],
  },
  bkddAllStreams: {
  fixtures: [
    { label: "Tsakiris (Waller, in BKDD)", point: [-95.89503, 29.77938], expectMinCount: 1 },
  ],
  },
  bkddEasements: {
  fixtures: [
    // The 70-ft easement + recorded exhibit WF-10.pdf found at the Tsakiris tract.
    { label: "Tsakiris BKDD easement", point: [-95.89503, 29.77938], expectMinCount: 1 },
  ],
  },
  bkddEasements107: {
  fixtures: [{ label: "Tsakiris BKDD easement (companion layer)", point: [-95.89503, 29.77938], expectMinCount: 1 }],
  },
  bkddSubwatersheds: {
  fixtures: [
    { label: "Tsakiris sub-watershed", point: [-95.89503, 29.77938], expectMinCount: 1 },
  ],
  },
  bkddFloodplainBfe: {
  fixtures: [{ label: "BKDD BFE line (Willow Fork reach)", point: [-95.85905, 29.76404], expectMinCount: 1 }],
  },
  bkddOutfalls: {
  fixtures: [{ label: "Tsakiris-area outfalls", point: [-95.89503, 29.77938], expectMinCount: 1 }],
  },
  bkddBoundary: {
  fixtures: [
    // The point-in-district test that drives district auto-selection (B1076 / B1080).
    { label: "Tsakiris inside BKDD", point: [-95.89503, 29.77938], expectMinCount: 1 },
  ],
  },
  bkddDmpFloodplain: {
  fixtures: [{ label: "inside the DMP study extent (extent centre)", point: [-95.9347, 28.9615], expectMinCount: 1 }],
  },
  bkddDmpImprovements: {
  fixtures: [{ label: "a proposed DMP improvement (in study extent)", point: [-95.89622, 29.01859], expectMinCount: 1 }],
  },
  nhdHydro: {
  fixtures: [
    // The Tsakiris tract — the channel the owner could see but the app never drew.
    // Re-verified live from the build sandbox 2026-07-29: n=1, gnis_name "Willow Fork",
    // ftype 336 / fcode 33600 (canal/ditch).
    { label: "Tsakiris flowlines (Willow Fork, ftype 336 canal/ditch)", point: [-95.89503, 29.77938], expectMinCount: 1 },
    { label: "Buffalo Bayou downtown", point: [-95.37, 29.76], expectMinCount: 1 },
  ],
  },
  nhdHydroWaterbody: {
  fixtures: [{ label: "Addicks Reservoir waterbodies", point: [-95.62, 29.79], expectMinCount: 1 }],
  },
  cityCo: {
  fixtures: [
    { label: "Commerce City limits", point: [-104.9209, 39.8683], expectMinCount: 1 },
    { label: "City & County of Denver", point: [-104.9903, 39.7392], expectMinCount: 1 },
    { label: "Greeley (Weld)", point: [-104.7091, 40.4233], expectMinCount: 1 },
    { label: "Fort Collins (Larimer)", point: [-105.0844, 40.5853], expectMinCount: 1 },
  ],
  },
  isdCo: {
  fixtures: [
    { label: "Commerce City school district", point: [-104.9209, 39.8683], expectMinCount: 1 },
    { label: "Weld (Greeley) school district", point: [-104.7091, 40.4233], expectMinCount: 1 },
    { label: "Larimer (Fort Collins) school district", point: [-105.0844, 40.5853], expectMinCount: 1 },
  ],
  },
  waterDistrictCo: {
  fixtures: [
    { label: "Commerce City water & sanitation district", point: [-104.9209, 39.8683], expectMinCount: 1 },
    { label: "Weld (Greeley) water & sanitation district", point: [-104.7091, 40.4233], expectMinCount: 1 },
  ],
  },
  metroDistrictCo: {
  fixtures: [
    { label: "Aurora-area metro districts", point: [-104.7319, 39.7294], expectMinCount: 1 },
    { label: "Colorado Springs-area metro districts", point: [-104.8214, 38.8339], expectMinCount: 1 },
  ],
  },
  roadCo: {
  fixtures: [
    { label: "Commerce City state highway", point: [-104.9209, 39.8683], expectMinCount: 1 },
    { label: "Weld (Greeley) state highway", point: [-104.7091, 40.4233], expectMinCount: 1 },
    { label: "Broomfield state highway", point: [-105.0866, 39.9205], expectMinCount: 1 },
  ],
  },
  aadtCo: {
  fixtures: [
    { label: "Denver AADT stations", point: [-104.9903, 39.7392], expectMinCount: 1 },
    { label: "Fort Collins (Larimer) AADT stations", point: [-105.0844, 40.5853], expectMinCount: 1 },
    { label: "Greeley (Weld) AADT stations", point: [-104.7091, 40.4233], expectMinCount: 1 },
  ],
  },
  cdpheCleanups: {
  fixtures: [
    { label: "Denver VCUP sites", point: [-104.9903, 39.7392], expectMinCount: 1 },
    { label: "Colorado Springs VCUP sites", point: [-104.8214, 38.8339], expectMinCount: 1 },
    { label: "Fort Collins (Larimer) VCUP sites", point: [-105.0844, 40.5853], expectMinCount: 1 },
  ],
  },
  cdpheSuperfund: {
  fixtures: [
    // Rocky Flats / Standley Lake area, Jefferson–Broomfield line — the state's best-known site.
    { label: "Rocky Flats area Superfund extent", bbox: [-105.25, 39.85, -105.05, 39.94], expectMinCount: 1 },
    // Commerce City — the owner's own market, and it is ringed by Superfund: Rocky Mountain
    // Arsenal, Sand Creek, Woodbury Chemical and ASARCO Globeville all sit here. This is the
    // single most decision-relevant Colorado environmental fixture in the registry.
    { label: "Commerce City Superfund cluster (RMA / Sand Creek / Woodbury)", bbox: [-104.98, 39.78, -104.78, 39.86], expectMinCount: 1 },
  ],
  },
  cdpheBrownfields: {
  fixtures: [
    { label: "Fort Collins (Larimer) brownfields", point: [-105.0844, 40.5853], expectMinCount: 1 },
  ],
  },
  mhfdBoundary: {
  fixtures: [
    { label: "Commerce City inside MHFD", point: [-104.9209, 39.8683], expectMinCount: 1 },
    { label: "Denver inside MHFD", point: [-104.9903, 39.7392], expectMinCount: 1 },
    { label: "Broomfield inside MHFD", point: [-105.0866, 39.9205], expectMinCount: 1 },
  ],
  },
  mhfdStreams: {
  fixtures: [
    { label: "Commerce City drainageways", point: [-104.9209, 39.8683], expectMinCount: 1 },
    { label: "Aurora drainageways", point: [-104.7319, 39.7294], expectMinCount: 1 },
  ],
  },
  mhfdWatersheds: {
  fixtures: [
    { label: "Commerce City watershed", point: [-104.9209, 39.8683], expectMinCount: 1 },
    { label: "Denver watershed", point: [-104.9903, 39.7392], expectMinCount: 1 },
  ],
  },
  mhfdChannels: {
  fixtures: [
    { label: "Commerce City channels", point: [-104.9209, 39.8683], expectMinCount: 1 },
    { label: "Denver channels", point: [-104.9903, 39.7392], expectMinCount: 1 },
  ],
  },
  mhfdOutfalls: {
  fixtures: [
    { label: "Commerce City outfalls", point: [-104.9209, 39.8683], expectMinCount: 1 },
  ],
  },
};

/* The fixtures for one registry key (both kinds), or an empty record. Pure. */
export function fixturesFor(key) {
  return SOURCE_FIXTURES[key] || {};
}

/* NEW-4 — the registry's PROSE, split off the runtime bundle for the same reason as the
 * fixtures above. `notes` and `tierReason` are documentation for whoever next has to reason
 * about a source; nothing in the running app reads either, and together they were ~15 KB of
 * strings shipped to every browser that opens a plan.
 *
 * `tierReason` is still ENFORCED — `tierProblems` takes it as a parameter, so a
 * `monitored-exception` row with no reason still fails the audit. The words just no longer
 * travel to the browser to prove it. */
export const SOURCE_DOCS = {
  flood: {
  notes: "Robust national service; the app's flood overlay rides the same MapServer.",
  },
  wetlands: {
  tierReason:
    "USFWS publishes NWI polygon-query only on this 'Test' folder; the production " +
    "Wetlands/MapServer root has an empty /layers and 500s on /query. Re-check for a " +
    "production queryable NWI endpoint periodically (tracked in BACKLOG / VERIFICATION).",
  notes: "Desktop screen only — NOT a jurisdictional delineation.",
  },
  oilgas: {
  notes:
    "RRC well points are schematic; historic/orphaned wells can be inaccurate or unmapped. " +
    "Load-tested to 20 concurrent polygon queries with 0 failures (more robust than the retired " +
    "Harris-County host). Retired source: www.gis.hctx.net/arcgishcpid/…/TXRRC/Wells.",
  },
  pipelines: {
  notes:
    "RRC T-4 permit routes are SCHEMATIC, deliberately low-resolution — never a surveyed " +
    "alignment. Retired source: www.gis.hctx.net/arcgishcpid/…/TXRRC/Pipelines.",
  },
  ccnWater: {
  notes:
    "PUCT water-CCN retail monopoly boundaries (TWDB-hosted, Dec 2023). A site inside a polygon " +
    "has a certificated water provider (obligated to serve); no polygon → well or a new CCN/petition. " +
    "STATUS separates an approved cert from a pending docket. Screening only — confirm with the utility/PUC.",
  },
  ccnSewer: {
  notes:
    "PUCT sewer-CCN retail monopoly boundaries, Harris County GIS re-serve (EPSG:2278). Regional " +
    "(Houston MSA) coverage — a far-out site reads 'no sewer CCN' because the layer doesn't reach it, " +
    "so this screen's absent state is an honest INFO note, never a green all-clear. Statewide-source " +
    "upgrade tracked as a live-verify item. Same MapServer also hosts the water CCN (layer 1). Screening only.",
  },
  lpst: {
  notes:
    "TCEQ Leaking Petroleum Storage Tank sites (a documented petroleum-UST release; REM_PROG = the " +
    "remediation-program status). A Phase I ESA PRE-SCREEN — a Phase I ESA / TCEQ records review is the " +
    "authoritative check. Historic/closed cases can be inaccurate or unmapped.",
  },
  epaCleanups: {
  notes:
    "EPA 'Cleanups in My Community' — Superfund (NPL/non-NPL) + RCRA corrective-action sites, FRS-derived. " +
    "MAP_SYMBOL_CODE distinguishes the program. A Phase I ESA PRE-SCREEN — a Phase I ESA is the authoritative check.",
  },
  growthFaults: {
  tierReason:
    "USGS SIM 2874 (the authoritative Houston fault dataset) publishes as a DOWNLOAD only; no live " +
    "authoritative REST endpoint exists and the USGS-derived AGOL copy is token-gated. We depend on the " +
    "University of Houston GIS republication (the full dataset, anonymously queryable) until we ingest the " +
    "USGS SIM 2874 shapefile to self-host — tracked in VERIFICATION.",
  notes:
    "Houston-area growth-fault surface traces (aseismic slow-slip faults that damage foundations, slabs, " +
    "and pavement over time). Community-hosted republication of USGS SIM 2874 — screening only; a " +
    "geotechnical / fault-specific study is the authoritative check. Prefer self-hosting the USGS shapefile.",
  },
  transmission: {
  notes:
    "HIFLD electric transmission lines (≥69 kV). A line crossing the parcel is a transmission " +
    "easement — no building under it, and towers/guy-wires eat usable area. Routes are schematic; " +
    "OWNER/VOLTAGE are withheld (0 / 'NOT AVAILABLE') on some redacted lines. Screening only — the " +
    "utility and a survey are the authoritative check.",
  },
  substations: {
  notes:
    "HIFLD electric substation points. The distance to the nearest is a SERVICE / interconnect " +
    "proxy for a heavy-power user, not a constraint. NAME is anonymized on redacted records and " +
    "MAX_VOLTAG is 0 where withheld. Screening only — confirm service/capacity with the utility.",
  },
  aadt: {
  notes:
    "TxDOT preliminary AADT count points (AADT_PRELIM). The nearest counted road's volume is an " +
    "access / visibility proxy — high traffic = good access/exposure but also congestion. Located_On " +
    "(road name) is blank on some records. Screening only.",
  },
  rail: {
  notes:
    "BTS/FRA rail-network lines (RROWNER1 = owning railroad reporting mark). A line adjacent or " +
    "crossing the site is a potential rail-served siding — confirm service/rates with the railroad. " +
    "Screening only; not a surveyed alignment or a confirmed spur right.",
  },
  airports: {
  notes:
    "FAA airports (TYPE_CODE: AD = airport, HP = heliport …). Distance to the nearest is a PROXY " +
    "for FAA Part 77 height-restriction surfaces near a public-use airport — NOT the computed Part " +
    "77 surfaces. A tall structure near an airport may require an FAA Form 7460 determination. Screening only.",
  },
  isd: {
  notes:
    "TEA school-district boundaries (SY 2022-23 edition), a TAXING / attendance boundary — " +
    "NOT a service network. Approximate, for general information; updated ~annually by TEA.",
  },
  mud: {
  notes:
    "District BOUNDARY, not proof of service. NB the layer also carries county-blanket " +
    "authorities (Coastal Water Authority, Port of Houston, river authorities) — consumers " +
    "must filter TYPE to the parcel-review district kinds (MUD/WCID/LID/DD/FWSD/SUD/WID) " +
    "or every Harris point reads as 'in a district'. detentionRules.js owns that filter. " +
    "Same service the jur_mud map overlay renders (layers.js reads this row).",
  },
  bkdd: {
  notes:
    "Single DISTRICT BOUNDARY polygon — a taxing/authority extent, not proof of service. " +
    "Additive to the county (district drainage/detention criteria ALSO apply); never a " +
    "replacement for the county floodplain ordinance. Boundary-source failure is an honest " +
    "'district membership unverified', never a silent no. Same feature the BKDD Quiddity " +
    "WebGIS viewer draws; the county-published AGOL layer is used because it's anonymously " +
    "queryable (the Quiddity Enterprise portal requires auth).",
  },
  hcfcdChannels: {
  notes:
    "HCFCD unit centerlines (UNIT_NO like 'W100-00-00'). Harris County only. Used by the " +
    "detention resolver as a nearest-channel ADJACENCY screen — proximity to a unit, never " +
    "a traced discharge path (that upgrade is B634).",
  },
  hcfcdWatersheds: {
  notes:
    "The 22 HCFCD watershed polygons (WTSHNAME e.g. 'BUFFALO BAYOU', WTSHUNIT 'W'). Feeds " +
    "the B635 watershed-keyed overlay rules (Addicks/Barker + Upper Cypress retention " +
    "context). The precise Upper-Cypress overflow boundary is a separate service " +
    "(HCFCD/CypressCreekOverflow) — flagged in detentionRules.js as the exact-boundary follow-up.",
  },
  fbcddWse02: {
  notes:
    "Feeds the drainage check's derivedWse02Ft (0.2% WSE engine seam, B770; code label B763) for " +
    "Fort Bend sites — screening only, DRAFT watershed-study values. B827: mosaic-first, " +
    "per-watershed fallback where the mosaic has a hole. Sampler: site-planner/lib/fbcdWse.js.",
  },
  nhdFlowline: {
  notes:
    "NetworkNHDFlowline (routed network). GNIS_NAME may be empty on unnamed reaches / artificial " +
    "paths — the sampler keeps the nearest with a name AND the nearest overall. Screening adjacency, " +
    "never a surveyed outfall alignment or a legal drainage easement.",
  },
  fbcddWse100: {
  notes:
    "Feeds the drainage check's derivedWse1pctFt (1% WSE engine seam, B807) for Fort Bend " +
    "sites — the unstudied-Zone-A pricing path. Screening only, DRAFT watershed-study values, " +
    "precedence LAST (never outranks effective-model data). Sampler: site-planner/lib/fbcdWse.js.",
  },
  femaEbfe: {
  notes:
    "B882 — the estimated-BFE source for FEMA Zone A / unstudied 'no published BFE' areas, " +
    "replacing the grade-@-Zone-A-boundary heuristic where InFRM covers the site (Region 6 only; " +
    "elsewhere the sampler returns null and the caller falls back to grade). Layer 20 = estimated " +
    "1% BFE raster, layer 24 = 0.2% (500-yr) WSE raster (NOT the 17/21 mosaic GROUP ids — see the " +
    "trap note above). SCREENING ONLY — an estimate, never a regulatory/published BFE; a sealed " +
    "H&H (Atlas-14) study + the reviewing agency set the final value. Read by /identify (not " +
    "/query), through the same-origin proxy. Sampler: site-planner/lib/ebfe.js.",
  },
  hcfcdMaapnext: {
  notes:
    "B882 — Harris County local-district estimated-WSE provider; OUTRANKS EBFE + effective-style " +
    "data in Harris (MAAPnext is enforced there). Screening only. NEW-1: the 1% / 0.2% WSE " +
    "ImageServer endpoints are now CONFIRMED (read from HCFCD's own AGOL item catalog) but the " +
    "HOST IS DOWN — see `outage`. The sampler short-circuits on a down row and reports an honest " +
    "'provider unavailable', never a silent null. Sampler: site-planner/lib/hcfcdWse.js; " +
    "resolver: lib/wseProviders.js.",
  },
  bkddStreams: {
  notes:
    "District stream/channel centerlines. Layer 121 in this SAME service is 'All Streams " +
    "(TNRIS)' (fields ftype, fcode) — a wider inventory, registered as bkddAllStreams. Do NOT " +
    "confuse 121 here with Boundaries/121 (MUD boundary).",
  },
  bkddAllStreams: {
  notes:
    "The TNRIS-sourced stream inventory the district republishes — an INVENTORY, never a " +
    "regulatory or engineered alignment. ftype/fcode decode via NHD_FTYPE (nhdFlowline.js).",
  },
  bkddEasements: {
  notes:
    "A district drainage easement is a HARD BUILDABLE-AREA CONSTRAINT, not decoration — the " +
    "width AND the recorded exhibit reference must reach the user, never just a line on the " +
    "map. TRAP (b): layers 0 and 5 of this service are named '…-OLD', and a sibling service " +
    "Easement_Current_updated/MapServer exists on the same host; 109 (+107) are the live-" +
    "confirmed current layers as of lastVerified. Screening only — the recorded instrument governs.",
  },
  bkddEasements107: {
  notes:
    "The companion 'BKDD Easements Current' layer to 109 — the district publishes the set " +
    "across both. Queried together by the drainage-context easement screen so a parcel " +
    "touching only one of the two still reports its easement.",
  },
  bkddSubwatersheds: {
  notes:
    "The district's own sub-watershed delineation — the BKDD analogue of HCFCD's watershed " +
    "polygons; names the basin a site drains to (e.g. 'Willow Fork').",
  },
  bkddFloodplainBfe: {
  notes:
    "District-published BFE lines (a FEMA DFIRM republication: `elev` ft, `v_datum` NAVD88, " +
    "`dfirm_id` the FIRM study). Rendered only; NOT wired into any WSE provider — see the field " +
    "note above for why the datum question is settled for this layer but not for BKDD's forms.",
  },
  bkddOutfalls: {
  notes: "Permitted stormwater outfall points published by the district. Screening only.",
  },
  bkddBoundary: {
  notes:
    "The district's OWN boundary publication — the point-in-district test that picks which " +
    "local drainage authority governs a site (live n=1 at Tsakiris 2026-07-29). Distinct from " +
    "the `bkdd` row above, which is Waller County's AGOL republication of the same district " +
    "(kept as the detention-tier membership source it already feeds). TRAP (a): 121 in THIS " +
    "service is a MUD boundary, not All Streams.",
  },
  bkddDmpFloodplain: {
  notes:
    "ADVISORY MODEL RESULTS, never regulatory: an Atlas-14 master-plan floodplain is not the " +
    "effective FIRM SFHA and must never be styled like one. Live 2026-07-29: n=0 at Tsakiris — " +
    "CORRECT (outside the study area), which is exactly why this row is studyArea-gated. " +
    "Companion layers in the same service: 20 Harvey floodplain, 17 10-yr, 5 Conveyance " +
    "Channel, 6 Proposed Channel Improvements, 4/10 Proposed Detention, 27 LiDAR.",
  },
  bkddDmpImprovements: {
  notes:
    "PROPOSED (unbuilt) district improvements — a planning intent, never an existing facility " +
    "and never a regulatory line. studyArea-gated like the floodplain row above.",
  },
  nhdHydro: {
  notes:
    "National hydrography INVENTORY — screening only, never a regulatory floodplain nor an " +
    "engineered channel capacity. ftype decodes to plain English via NHD_FTYPE " +
    "(site-planner/lib/nhdFlowline.js). Tier-3 fallback in the Flood & drainage group: it " +
    "answers 'is there a channel at this site at all?' where no district GIS exists.",
  },
  nhdHydroWaterbody: {
  notes:
    "The waterbody companion to nhdHydro — screening inventory only. Sibling large-scale " +
    "layers in the same service: 9 Area (wide-channel polygons), 2 Line. USGS renumbers NHD " +
    "sublayers occasionally (the FEMA-NFHL caveat class) — re-read /layers on any " +
    "lastVerified refresh and check the '- Large Scale' suffix, not just the index.",
  },
  cityCo: {
  notes:
    "The Colorado counterpart of the `city` row (TxGIO). Inside a polygon = inside a municipality; " +
    "outside = unincorporated county. A boundary means the municipality HAS JURISDICTION — never " +
    "proof it serves or will connect utilities.",
  },
  isdCo: {
  notes:
    "The Colorado counterpart of the `isd` row (TEA). A TAXING / attendance boundary, not a " +
    "service network — the same caveat as Texas.",
  },
  waterDistrictCo: {
  notes:
    "Colorado Title 32 water and/or sanitation special districts. The nearest Colorado analogue " +
    "to the Texas CCN rows, but weaker: it is a district BOUNDARY, not a certificated monopoly, " +
    "and a city-served site sits in none. Screening only — confirm with the provider.",
  },
  metroDistrictCo: {
  notes:
    "Colorado Title 32 metropolitan districts (the MUD analogue): infrastructure financing " +
    "districts that levy a mill against property inside them. A boundary, not proof of service. " +
    "Absence is normal and is NOT an all-clear on district debt — confirm against the title " +
    "commitment and the county assessor's mill levy sheet.",
  },
  roadCo: {
  notes:
    "CDOT on-system state highway routes. A hit means CDOT is the access-permitting authority; " +
    "NO hit means the frontage is a city or county road, NOT that there is no road. Never read " +
    "an empty answer as 'unmaintained'.",
  },
  aadtCo: {
  notes:
    "CDOT AADT count stations, state highway system only. The nearest counted road's volume is " +
    "an access / visibility proxy. AADTTRUCKS gives the truck share directly. A site off the " +
    "state system has no nearby station — that is a data gap, not a low-traffic finding.",
  },
  cdpheCleanups: {
  notes:
    "CDPHE Voluntary Cleanup & Redevelopment Program sites. A Phase I ESA PRE-SCREEN — a Phase I " +
    "ESA and a CDPHE records review are the authoritative checks. Does NOT include petroleum " +
    "storage-tank releases (Division of Oil & Public Safety — not wired; see the note above).",
  },
  cdpheSuperfund: {
  notes:
    "CDPHE Superfund site BOUNDARIES (polygons — so a parcel can be tested for being inside one, " +
    "which the national EPA point layer cannot answer). A Phase I ESA PRE-SCREEN.",
  },
  cdpheBrownfields: {
  notes:
    "CDPHE brownfield properties — a known or perceived contamination constraint on redevelopment, " +
    "and often a grant/incentive opportunity. Screening only.",
  },
  mhfdBoundary: {
  notes:
    "The district's own boundary publication — a single polygon. Membership is what selects the " +
    "MHFD drainage regime (coloradoRegions.js). Additive to the county floodplain ordinance and " +
    "to the CWCB statewide floor; never a replacement for either.",
  },
  mhfdStreams: {
  notes:
    "MHFD's own drainageway centrelines — the Colorado analogue of the HCFCD channel row. " +
    "Screening adjacency, never a surveyed alignment or a conveyance capacity.",
  },
  mhfdWatersheds: {
  notes:
    "The district's own basin delineation — names the basin a site drains to. The MHFD analogue " +
    "of the HCFCD watershed polygons and of BKDD's sub-watersheds.",
  },
  mhfdChannels: {
  notes:
    "The district's built channel inventory, carrying owner / maintainer / jurisdiction per reach. " +
    "Screening only — the reviewing authority and a survey govern.",
  },
  mhfdOutfalls: {
  notes:
    "Existing storm outfall structures — the nearest one is where a site's release would " +
    "realistically tie in. The Colorado counterpart of the BKDD outfall row. Screening only.",
  },
};

export function docsFor(key) {
  return SOURCE_DOCS[key] || {};
}
