/* County parcel data sources.
 *
 * Each entry points at a public Esri ArcGIS REST endpoint. You can give either:
 *   - layerUrl:   a specific feature layer (".../MapServer/0" or ".../FeatureServer/3")
 *   - serviceUrl: a service root (".../MapServer" or ".../FeatureServer"); the app
 *                 fetches its layer list and auto-picks the parcels (polygon) layer.
 *
 * idField / addrField are *hints*. At query time the app reads the layer's live
 * field list and auto-detects the account and address fields, falling back to
 * these only if detection comes up empty. So if a county renames a field, the
 * lookup keeps working without a code change. Anything here is also editable in
 * the UI (the "Service / layer URL" box) so you can paste a corrected endpoint.
 *
 * Endpoints found from each district's public GIS (verify in-browser — county
 * servers move occasionally):
 *   Harris   — HCAD Parcels layer 0 on the Harris County GIS server
 *   Fort Bend— FBCAD parcels served from Esri's ArcGIS Online cloud (reliable +
 *              CORS-open), NOT FBCAD's chronically-down self-hosted gis.fbcad.org
 *   Chambers — CCAD's OWN live public MapServer (ChambersCADPublic, Pandai-hosted,
 *              /query enabled, no token). This is the SAME service the CCAD website's
 *              map draws, so Planyr's parcels match what an owner sees on the CAD site —
 *              the statewide TxGIO harvest lagged it (B787). TxGIO stays the outage
 *              fallback (statewideFallbackFor), never the primary.
 *   Waller   — no public CAD of its own → rides the statewide TxGIO layer scoped to Waller.
 */

// NAD83 / Texas South Central (US survey feet) — the State Plane zone covering
// Harris, Fort Bend and Chambers. Requesting geometry in this SR means returned
// x/y are already in feet, so on-screen distances are true (no Web-Mercator stretch).
import { siteState } from "./siteRegion.js";
import { situsKey } from "./appraisal.js";
/* B209502 — the point-in-polygon county answer. Pure + synchronous once its asset is resident;
 * every query before that returns a `pending` verdict, so nothing here ever trades a rectangle's
 * guess for a real answer. See countyPolygons.js for why the geometry is bundled rather than
 * fetched on demand. */
import { resolveCounty, loadCountyPolygons, countyPolygonsReady, countyRoster } from "./countyPolygons.js";
/* NEW-4 — county ROUTING KEYS are normalised at the map itself, not at each call site.
 * See shared/gis/countyKeys.js for why (a raw `MAP[county]` missed the two production rows
 * spelled "Harris", silently). */
import { byCountyKey, countyKeySet, normCountyKey } from "../../../shared/gis/countyKeys.js";
/* CITY-SCOPED SOURCES (B1583296) — a point-in-city-polygon check that runs BEFORE the nationwide
 * county geometry. See cityScopes.js's own header for why this is a genuine resolution tier, not a
 * config line: a county whose only real parcel source covers just one city inside it cannot be
 * expressed at county granularity without silently misrouting every OTHER place in that county. */
import { cityScopeAnswer } from "./cityScopes.js";

export { loadCountyPolygons, countyPolygonsReady };

export const FEET_WKID = 2278;

// The TxGIO (Texas statewide) parcel MapServer layer — one public, CORS-open layer
// covering all 254 counties. It is the UNIVERSAL outage fallback for every county: its
// own /query is disabled upstream (B627), so it renders as a server /export image and
// clicks route through /identify. Referenced by the `txgio_statewide` COUNTIES_MAP entry
// (the statewide display/click source, decoupled from Chambers in B787 when Chambers got
// its own CCAD source), by any county that has no CAD of its own (Waller), and by
// STATEWIDE_PARCEL_LAYER / statewideFallbackFor. One const so all references stay identical.
const TXGIO_STATEWIDE_LAYER =
  "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0";

/* NEW-5 — COLORADO'S TxGIO ANALOGUE. The Colorado Public Parcels composite, aggregated from the
 * counties by the Governor's Office of Information Technology GIS team and published as one
 * statewide, queryable, key-free layer scoped by `countyName`.
 *
 * This matters more than it looks: the brief assumed Colorado has "no equivalent middle or bottom
 * tier" to Texas's H-GAC → TxGIO chain. That is half wrong, and the half that is wrong is the
 * important half — there IS a statewide bottom tier, so a Colorado county server outage degrades
 * to the same honest statewide backup a Texas one does, rather than to nothing. (There is no clean
 * MIDDLE tier: the regional bodies are partial — DRCOG for the metro, PPACG for El Paso — so
 * Planyr does not model one. See docs/incidents/COLORADO-AUDIT.md §3.) */
const CO_STATEWIDE_LAYER =
  "https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0";

/* Four of the nine Colorado counties ride the statewide composite until their own endpoint is
 * probed (V511), and each was repeating the same ~130-character help string verbatim. One builder
 * instead of five literals — the same words, a fraction of the bytes on the Site route's bundle.
 * (Bundle budget, 2026-07-29: deduplication, not abbreviation. Nothing was shortened.)
 * NEW-1, 2026-08-03 — Larimer was the fifth and is now PROMOTED to its own live-probed service. */
const compositeHelp = (county) =>
  `Colorado statewide parcels (state OIT composite) — searches are limited to ${county} County until the county's own endpoint is confirmed.`;

/* NEW-1 — the honest reason a county is STILL on the composite after the 2026-08-03 re-probe, in
 * the help string rather than only in a code comment, because it is the user who is looking at a
 * statewide-backup badge and wondering why. One shared clause (bundle bytes), appended per row. */
const publishedButUnprobed =
  " Its own county service is published but is not reachable from our build environment, so it stays unverified.";

/* The four counties whose OWN parcel service is live-verified share one help shape too. */
const ownHelp = (source, idKind) => `${source}. Search by ${idKind} or a site address.`;

const COUNTIES_RAW = {
  harris: {
    state: "TX",
    label: "Harris County · HCAD",
    layerUrl:
      "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0",
    idField: "HCAD_NUM",
    addrField: "LocAddr",
    help: "Search by HCAD account number (13 digits) or a site address.",
  },
  fortbend: {
    state: "TX",
    label: "Fort Bend · FBCAD",
    // FBCAD's OWN parcel data, served from Esri's ArcGIS Online cloud (services*.
    // arcgis.com) — reliable, CORS-open, no key — instead of FBCAD's self-hosted
    // gis.fbcad.org server, which is chronically down (503s / TLS resets — the whole
    // Fort Bend trouble history B137/B244/B382) and has already migrated servers once
    // ("serverarcgis2"). This hosted "FBCAD Public Parcel Data" layer carries all ~385k
    // county parcels, is refreshed daily, is natively EPSG:2278 (State Plane feet, our
    // coordinate spine), and has the full appraisal schema (owner, land/imp/total value,
    // situs, legal, acreage, land use). The statewide TxGIO layer stays the automatic
    // outage fallback (statewideFallbackFor). Old self-hosted URL retired as primary:
    //   https://gis.fbcad.org/serverarcgis2/rest/services/Public/MapServer
    layerUrl:
      "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0",
    idField: "QUICKREFID",
    addrField: "SITUS",
    help: "FBCAD public parcels (Esri-hosted). Search by account (R-number / QuickRef ID) or a site address.",
  },
  chambers: {
    state: "TX",
    label: "Chambers County · CCAD",
    // CCAD's OWN live public parcel service (ChambersCADPublic, Pandai-hosted). This is the
    // exact MapServer the CCAD website's map draws, so Planyr's Chambers parcels match what
    // an owner sees on the CAD site — B787 repoint off the lagged statewide TxGIO harvest.
    // /query IS enabled here (no token/auth), so unlike the TxGIO source: ID/address text
    // SEARCH works again, outlines render as a queryable vector layer (which also backs the
    // instant client-side click highlight), and clicks select via /query — no scopeWhere
    // needed (this layer is Chambers-only). If CCAD is unreachable, the parcelQuery search
    // path auto-falls-back to TxGIO scoped to Chambers, and the display/click paths lean on
    // the always-present statewide TxGIO outlines (statewideFallbackFor / STATEWIDE_KEYS) —
    // so a CCAD outage degrades to the old behavior, never a blank map.
    // Field hints (idField/addrField) are self-healing fallbacks: at query time the app reads
    // the layer's live field list and auto-detects, using these only if detection is empty.
    // CCAD's situs is split across Prop_Street_Number/Dir/Suffix + Prop_Street, so Prop_Street
    // (the name) is the addr hint (the ADDR_RE auto-detect finds no situs-style column here).
    layerUrl:
      "https://gisdata.pandai.com/pamaps02/rest/services/Chambers/ChambersCADPublic/MapServer/0",
    idField: "Parcel_Id",
    addrField: "Prop_Street",
    help: "Chambers CAD public parcels (CCAD's own live service). Search by parcel/account ID or a street name.",
  },
  waller: {
    state: "TX",
    label: "Waller County · WCAD",
    // Waller CAD publishes no public parcel GIS of its own, so it rides the statewide TxGIO
    // layer scoped to WALLER (TxGIO /query+/find disabled 2026-07-03 → outlines via /export,
    // clicks via /identify). Waller is one of the B629 snapshot-cached counties
    // (SNAPSHOT_COUNTIES), so a Drive snapshot backs it when TxGIO is down. Because its
    // primary IS the statewide layer, statewideFallbackFor(waller) returns null (no separate
    // backup) — same self-referential case Chambers used to be before its B787 CCAD repoint.
    layerUrl: TXGIO_STATEWIDE_LAYER,
    idField: "prop_id",
    addrField: "situs_addr",
    scopeWhere: "county='WALLER'",
    help: "Texas statewide parcels (TxGIO) — searches are limited to Waller County.",
  },

  /* ═══ B209503 — THE HOUSTON METRO IS NINE COUNTIES; THIS REGISTRY HELD FOUR ══════════════════
   *
   * Harris, Fort Bend, Chambers and Waller were the whole of it, so a click at Conroe, Pearland
   * or Texas City had NO parcel source of any kind — not even the statewide backup, because
   * `TXGIO_COUNTY_NAME` listed the same four. Every county below carries active industrial
   * development the owner works in.
   *
   * WHAT "VERIFIED" MEANS ON EACH ROW — the same contract the Colorado rows established: the
   * endpoint was QUERIED and answered. Every row below records its live parcel COUNT, the
   * count-query time and the point-identify time, measured 2026-08-06 from this build. No row
   * here is a guessed URL; the two that could not be probed are not shipped at all.
   *
   * A NOTE ON THE THREE "CADWebService" ROWS: Brazoria, Liberty and Austin are all published by
   * BIS Consulting on Esri's ArcGIS Online cloud with an IDENTICAL schema (prop_id / file_as_name
   * / situs_num+situs_street / legal_acreage). That is a convenience, not a coincidence to rely
   * on — each row is verified independently and each names its own service, so one vendor's
   * outage or reorganisation cannot silently take three counties with it. */
  montgomery: {
    state: "TX",
    label: "Montgomery County · MCAD",
    // VERIFIED LIVE 2026-08-06: 336,769 parcel polygons · count query 1,212 ms · point identify
    // 172–596 ms. Published by Montgomery County's own GIS org (AGOL owner GIS.Data_MOCO), so
    // this is the county's data rather than a republication. Note the situs column is lowercase
    // `situs` and the OWNER's mailing address is a separate `ownerAddress` — the SITUS ladder in
    // appraisal.js must win here (naming a plan after a mailing address is the B-NEW-2 trap).
    layerUrl: "https://services1.arcgis.com/PRoAPGnMSUqvTrzq/arcgis/rest/services/Tax_Parcel_view/FeatureServer/0",
    idField: "pid",
    addrField: "situs",
    help: "Montgomery CAD tax parcels (county GIS, Esri-hosted). Search by property ID or a site address.",
  },
  brazoria: {
    state: "TX",
    label: "Brazoria County · BCAD",
    // VERIFIED LIVE 2026-08-06: 280,226 parcel polygons · count query 156 ms · point identify
    // 224 ms (returned the real lot at Pearland — prop_id 517005, CITY OF PEARLAND, 0.43 ac).
    // Pearland is the site whose wrong-county answer produced this whole work item.
    layerUrl: "https://services6.arcgis.com/j94FvPaik4etwHFk/arcgis/rest/services/BrazoriaCADWebService/FeatureServer/0",
    idField: "prop_id",
    addrField: "situs_street",
    help: "Brazoria CAD public parcels (Esri-hosted). Search by property ID or a street name.",
  },
  galveston: {
    state: "TX",
    label: "Galveston County · GCAD",
    // VERIFIED LIVE 2026-08-06: 188,679 parcel polygons · count query 128 ms · point identify
    // 594 ms (returned the real lot at Texas City — GEOID 6847-0000-0026-000).
    // ⛔ REJECTED CANDIDATE, recorded so nobody re-picks it: a second AGOL layer
    // (services7.arcgis.com/2iAOv9D7729Bn31m/…/GCAD_Parcels_MGO_view) also answers at Texas City
    // but holds only 26,094 features against this one's 188,679 — a PARTIAL republication, and
    // exactly the B369 clip trap (a source that answers your test point while being silently
    // incomplete everywhere else). Count the features before trusting a hit.
    layerUrl: "https://services2.arcgis.com/uGo7PKALPg93ZiO2/arcgis/rest/services/Galveston_County_Appraisal_District_Parcels_and_Lot_Lines/FeatureServer/2",
    idField: "ID",
    addrField: "SITUS",
    help: "Galveston CAD parcels (Esri-hosted). Search by account ID or a site address.",
  },
  liberty: {
    state: "TX",
    label: "Liberty County · LCAD",
    // VERIFIED LIVE 2026-08-06: 155,826 parcel polygons · count query 133 ms · point identify
    // 144 ms (returned the real lot at Dayton — prop_id 73270, CALTEX & ASSOCIATE LTD).
    layerUrl: "https://services3.arcgis.com/LbQai106UcFy2LlR/arcgis/rest/services/LibertyCADWebService/FeatureServer/0",
    idField: "prop_id",
    addrField: "situs_street",
    help: "Liberty CAD public parcels (Esri-hosted). Search by property ID or a street name.",
  },
  austintx: {
    state: "TX",
    label: "Austin County · ACAD",
    /* KEY IS `austintx`, NOT `austin`, ON PURPOSE. Austin County (Bellville / Sealy, on I-10 west)
     * is not the City of Austin, and `countyKeyForName` slugs a display name straight to a key —
     * so a key of `austin` would let the string "Austin" from a city or ETJ layer resolve to this
     * county. The keys in this map are also persisted in saved plans, so the collision has to be
     * impossible rather than merely unlikely — the same reasoning behind the `co_` prefix.
     * VERIFIED LIVE 2026-08-06: 22,630 parcel polygons · count query 221 ms · point identify
     * 137–233 ms (returned real lots at both Sealy and Bellville). */
    layerUrl: "https://services7.arcgis.com/rNakmFefTO1XjYg4/arcgis/rest/services/AustinCADWebService/FeatureServer/0",
    idField: "prop_id",
    addrField: "situs_street",
    help: "Austin County CAD public parcels (Esri-hosted). Search by property ID or a street name.",
  },

  /* ═══ COLORADO (NEW-5) ═══════════════════════════════════════════════════════════════════
   * Nine counties. Keys are `co_`-PREFIXED deliberately: Texas and Colorado both have an
   * El Paso County and a Jefferson County, and the existing Texas keys are persisted in saved
   * plans, so they could not be renamed. The prefix makes the collision impossible instead of
   * merely unlikely.
   *
   * WHAT "VERIFIED" MEANS ON EACH ROW, because this is the thing a guessed URL hides:
   *   verifiedOn  — the endpoint was QUERIED and answered: layer metadata read, geometry type and
   *                 native spatial reference confirmed, and a live feature COUNT returned.
   *   candidateUrl — a URL with real provenance (a registered ArcGIS Online item: owner, item id,
   *                 extent) that could NOT be probed from the build environment, whose egress policy
   *                 blocks self-hosted county hosts. It is recorded, NOT shipped as a primary. Those
   *                 five counties ride the Colorado statewide composite until the endpoint is probed
   *                 from an unblocked network — the same pattern Waller already uses in Texas.
   * Promotion is a one-line change per row once V507 confirms the endpoint. */
  co_adams: {
    state: "CO",
    label: "Adams County, CO",
    // VERIFIED LIVE 2026-07-29: 188,723 parcel polygons, ArcGIS-Online hosted (CORS-open, no key).
    layerUrl: "https://services3.arcgis.com/4PNQOtAivErR7nbT/arcgis/rest/services/Parcels/FeatureServer/0",
    idField: "PIN",
    addrField: "concataddr1",
    help: ownHelp("Adams County parcels (county GIS, Esri-hosted)", "PIN / parcel number"),
  },
  co_denver: {
    state: "CO",
    label: "City & County of Denver, CO",
    // VERIFIED LIVE 2026-07-29: 240,360 parcels; the layer id is 245, not 0 (Denver's open-data
    // catalogue keeps one service per table with the catalogue's own id). Native SR is EPSG:2877 —
    // NAD83(HARN) / Colorado CENTRAL (ftUS), independent confirmation of the NEW-3 zone assignment.
    layerUrl: "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_PROP_PARCELS_A/FeatureServer/245",
    idField: "SCHEDNUM",
    addrField: "SITUS_ADDRESS_LINE1",
    help: ownHelp("Denver parcels (city & county open data)", "schedule number"),
  },
  co_weld: {
    state: "CO",
    label: "Weld County, CO",
    // VERIFIED LIVE 2026-07-29: 163,685 parcels, county open-data FeatureServer.
    layerUrl: "https://services.arcgis.com/ewjSqmSyHJnkfBLL/arcgis/rest/services/Parcels_open_data/FeatureServer/0",
    idField: "ACCOUNTNO",
    addrField: "SITUS",
    help: ownHelp("Weld County parcels (county open data)", "account number"),
  },
  co_broomfield: {
    state: "CO",
    label: "City & County of Broomfield, CO",
    // VERIFIED LIVE 2026-07-29: 27,531 parcels. Native SR is EPSG:2876 — NAD83(HARN) / Colorado
    // NORTH (ftUS). That is the evidence behind the NEW-3 Broomfield zone DECISION: the statute
    // (C.R.S. 38-52-101) predates the county and never names it, but the county's own GIS works in
    // Colorado North. See src/shared/coordinates/statePlane.js.
    layerUrl: "https://services1.arcgis.com/vXSRPZbyyOmH9pek/arcgis/rest/services/Parcels/FeatureServer/0",
    idField: "PARCELNUMBER",
    addrField: "SITUS_FULL_ADDRESS",
    help: ownHelp("Broomfield parcels (city & county open data)", "parcel/account number"),
  },
  co_arapahoe: {
    state: "CO",
    label: "Arapahoe County, CO",
    layerUrl: CO_STATEWIDE_LAYER,
    idField: "parcel_id",
    addrField: "situsAdd",
    scopeWhere: "countyName='Arapahoe'",
    // RE-PROBED 2026-08-03 (NEW-1) and deliberately NOT promoted. The county's own service
    // (gis.arapahoegov.com) is still egress-blocked here. The only Arapahoe parcel layer this
    // environment CAN reach is an AGOL copy (services1.arcgis.com/Ezk9fcjSUkeadg6u, 214,375
    // features, 250 ms) owned by `jklier_uagis` — a 2017 personal/coursework account whose other
    // items are a GIS-class exercise. A nine-year-old third-party copy is WORSE than the composite
    // (which the state refreshes), so it is recorded here and not shipped.
    help: compositeHelp("Arapahoe") + publishedButUnprobed,
  },
  co_larimer: {
    state: "CO",
    label: "Larimer County, CO",
    // VERIFIED LIVE 2026-08-03: 181,035 tax parcels; capabilities Map,Query,Data; count query
    // 108 ms; point identify 87 ms; maxRecordCount 1000. idField PARCELNUM, addrField LOCADDRESS
    // (NAME carries the owner). A point identify at -104.985, 40.44 — I-25 at E County Road 30 /
    // Fairgrounds Ave — returns PARCELNUM 8634109901, LOCADDRESS "5260 ARENA CIR" (the Larimer
    // County Fairgrounds), the SAME parcel the statewide composite returns for that point.
    // This layer is Larimer-only, so it takes NO scopeWhere.
    //
    // WHY THIS ROW MATTERS MORE THAN THE OTHER PROMOTIONS (NEW-1): parking Larimer on the
    // composite meant every draw and every click over Larimer ground ran against every parcel in
    // Colorado. Measured the same moment, same browser: Weld's own county layer answered a count
    // in 67 ms and a point identify in 55 ms, while ONE view-sized bbox against the composite took
    // 1,466 ms and came back with exactly 2000 features and exceededTransferLimit = true. So the
    // composite was not only slow, it was drawing an INCOMPLETE parcel fabric (NEW-3).
    layerUrl: "https://maps1.larimer.org/arcgis/rest/services/MapServices/Parcels/MapServer/3",
    idField: "PARCELNUM",
    addrField: "LOCADDRESS",
    help: ownHelp("Larimer County parcels (county GIS — Tax Parcels)", "parcel number"),
  },
  co_jefferson: {
    state: "CO",
    label: "Jefferson County, CO",
    // ⚠ CORRECTION, 2026-08-03 (NEW-1). B1111 recorded that "no county assessor parcel endpoint
    // could be FOUND at all" for Jefferson. That was WRONG, and the re-probe found the record:
    // ArcGIS Online item "Parcel", owner `Jeffco` (the county's own org), serving
    // https://gisportal.jeffco.us/server2/rest/services/Parcel/FeatureServer — plus a sibling
    // "Parcel Split" service on the same host. Jefferson is therefore the same case as the other
    // three, not a special one: found, egress-blocked here, unpromoted.
    // The two Jeffco parcel copies this environment CAN reach are both STALE, and provably so:
    // the City of Lakewood's hosted copy (248,974 features) last edited 2018-05-08 and the
    // county's own 2022 snapshot service disagree on the OWNER of the same PIN 49-061-03-003.
    // Neither is fit to price a deal against, so neither ships.
    layerUrl: CO_STATEWIDE_LAYER,
    idField: "parcel_id",
    addrField: "situsAdd",
    scopeWhere: "countyName='Jefferson'",
    help: compositeHelp("Jefferson") + publishedButUnprobed,
  },
  co_elpaso: {
    state: "CO",
    label: "El Paso County, CO",
    layerUrl: CO_STATEWIDE_LAYER,
    idField: "parcel_id",
    addrField: "situsAdd",
    scopeWhere: "countyName='El Paso'",
    // RE-PROBED 2026-08-03 (NEW-1), decision UNCHANGED and now on stronger evidence. The county's
    // own service (gisservices.elpasoco.com) is still egress-blocked. The regional PPACG layer IS
    // reachable and is genuinely fresh (268,356 features, 326 ms, last edited 2026-07-25) — but it
    // is the MPO's TAZ-joined planning derivative (LandUse / PlaceType / NumHU columns), it drops
    // right-of-way parcels, and it spans Teller County too. B1111 rejected it for that reason and
    // this re-probe confirms the reason rather than overturning it: the parcel fabric a deal is
    // priced against must be the assessor's, not a travel-demand model's.
    help: compositeHelp("El Paso") + publishedButUnprobed,
  },
  co_boulder: {
    state: "CO",
    label: "Boulder County, CO",
    layerUrl: CO_STATEWIDE_LAYER,
    idField: "parcel_id",
    addrField: "situsAdd",
    scopeWhere: "countyName='Boulder'",
    // RE-PROBED 2026-08-03 (NEW-1) and deliberately NOT promoted. The county's own live service
    // (maps.bouldercounty.org) is still egress-blocked. Boulder County's OWN AGOL copy is
    // reachable — "Boulder County Parcel / Address Look Up" (services3.arcgis.com/0jWpHMuhmHsukKE3,
    // native SR EPSG:2876, 259 ms) — but it carries only 30,803 features against a county fabric
    // several times that size, and its own `Updated` column reads 2/14/2020. A partial, six-year-old
    // extract would show a lot as MISSING rather than as slow, which is the worse failure.
    help: compositeHelp("Boulder") + publishedButUnprobed,
  },

  /* ═══ B1455633 — IDAHO IS 13 COUNTIES, NEVER A STATEWIDE ENTRY ══════════════════════════════
   * Keys are `id_`-PREFIXED for the same reason Colorado's are `co_`-prefixed: a bare county name
   * risks colliding with a Texas county derived nationwide by `derivedTxCounties()` (Washington
   * County exists in both Idaho and Texas) — the prefix makes the collision impossible rather than
   * merely unlikely.
   *
   * "Public Idaho Parcels" (State of Idaho, Office of Information Technology Services) has TWO
   * layers on one service and the wrong one is the one most searches would find first:
   *   layer 0 — "Idaho Parcels Public Centroids" — esriGeometryPoint (parcel CENTROIDS, unusable
   *             for this app's polygon-outline click routing — confirmed live from this sandbox).
   *   layer 7 — "Parcels Public" — esriGeometryPolygon, 381,144 features (task's own count:
   *             380,988; the ~150-parcel drift is same-day edit churn, not a different layer) —
   *             THIS is what's wired below.
   * MEASURED FROM THIS SANDBOX (services1.arcgis.com is reachable here): layer 7 metadata read
   * live, `County` distinct-values query returned EXACTLY these 13 names (verbatim, spaces and
   * all — Idaho's own field values, not a normalized slug): Ada, Bear Lake, Boise, Camas, Gooding,
   * Jerome, Lincoln, Minidoka, Nez Perce, Oneida, Teton, Valley, Washington. `extentCoverageCheck`
   * (`ui-audit/lib/statewideCoverage.mjs`) against the whole state confirms it is NOT statewide —
   * lat 66% / lon 104% of Idaho's own bbox — the same partial-extent shape that produced the
   * Nebraska defect (B1332016); a Boise envelope query answered in 1,682ms (2000 features,
   * capped), well inside the app's 8s budget, but Coeur d'Alene/Sandpoint/Idaho Falls/Twin Falls
   * are all OUTSIDE the 13 participating counties and must report NO source, never a silent zero.
   * All 13 ride the ONE shared layer, scoped per county via `scopeWhere` on the `County` field —
   * the same shape Waller rides TxGIO — so `sharedLayerUrlConflicts()` requires every sharer to
   * carry its OWN distinct scope (never a bare shared URL); see that function's header. */
  id_ada: {
    state: "ID", label: "Ada County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Ada'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Ada County (Boise). Search by parcel ID or a site address.",
  },
  id_bearlake: {
    state: "ID", label: "Bear Lake County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Bear Lake'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Bear Lake County. Search by parcel ID or a site address.",
  },
  id_boise: {
    state: "ID", label: "Boise County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Boise'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Boise County (Idaho City — not the city of Boise, which sits in Ada County). Search by parcel ID or a site address.",
  },
  id_camas: {
    state: "ID", label: "Camas County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Camas'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Camas County. Search by parcel ID or a site address.",
  },
  id_gooding: {
    state: "ID", label: "Gooding County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Gooding'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Gooding County. Search by parcel ID or a site address.",
  },
  id_jerome: {
    state: "ID", label: "Jerome County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Jerome'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Jerome County. Search by parcel ID or a site address.",
  },
  id_lincoln: {
    state: "ID", label: "Lincoln County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Lincoln'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Lincoln County. Search by parcel ID or a site address.",
  },
  id_minidoka: {
    state: "ID", label: "Minidoka County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Minidoka'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Minidoka County. Search by parcel ID or a site address.",
  },
  id_nezperce: {
    state: "ID", label: "Nez Perce County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Nez Perce'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Nez Perce County (Lewiston). Search by parcel ID or a site address.",
  },
  id_oneida: {
    state: "ID", label: "Oneida County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Oneida'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Oneida County. Search by parcel ID or a site address.",
  },
  id_teton: {
    state: "ID", label: "Teton County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Teton'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Teton County (Driggs). Search by parcel ID or a site address.",
  },
  id_valley: {
    state: "ID", label: "Valley County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Valley'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Valley County (Cascade/McCall). Search by parcel ID or a site address.",
  },
  id_washington: {
    state: "ID", label: "Washington County, ID",
    layerUrl: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7",
    idField: "PARCEL_ID", addrField: "SITE_ADD", scopeWhere: "County='Washington'",
    help: "Idaho statewide parcel service (State of Idaho OITS) — searches are limited to Washington County (Weiser, ID — not Washington County, TX). Search by parcel ID or a site address.",
  },

  /* ═══ B1455634 — 21 MEASURED COUNTY ENDPOINTS ACROSS 12 STATES (one, Hinds MS, excluded — see
   * below) ═══════════════════════════════════════════════════════════════════════════════════
   * Each row's provenance/verification detail lives in `countiesProvenance.js` (COUNTY_VERIFICATION)
   * rather than a wall of prose here, per that module's own header. Keys are `<state>_`-prefixed —
   * two of these 21 counties are BOTH literally named "Jefferson" (KY and AL), which makes the
   * prefix load-bearing, not merely tidy. */
  il_cook: {
    state: "IL", label: "Cook County, IL",
    layerUrl: "https://gis.cookcountyil.gov/traditional/rest/services/parcelHistorical/MapServer/2025",
    // idField is a confident guess (Cook County's own PIN convention); addrField is unconfirmed —
    // gis.cookcountyil.gov is blocked from this build environment, so the live field list could
    // not be read. Both are hints only; the app's own live field auto-detect corrects a wrong one.
    idField: "PIN",
    help: "Cook County parcels (county GIS). Search by PIN (Property Index Number) or a site address.",
  },
  il_dupage: {
    state: "IL", label: "DuPage County, IL",
    layerUrl: "https://gis.dupageco.org/arcgis/rest/services/DuPage_County_IL/ParcelsWithRealEstateCC/FeatureServer/0",
    idField: "PIN", // unconfirmed — gis.dupageco.org is blocked from this build environment.
    help: "DuPage County parcels with real-estate detail (county GIS). Search by PIN or a site address.",
  },
  il_will: {
    state: "IL", label: "Will County, IL",
    layerUrl: "https://gis.willcountyillinois.com/hosting/rest/services/Basemap/Parcels_LY_V/MapServer/0",
    idField: "PIN", // unconfirmed — gis.willcountyillinois.com is blocked from this build environment.
    help: "Will County parcels (county GIS). Search by PIN or a site address.",
  },
  pa_allegheny: {
    state: "PA", label: "Allegheny County, PA",
    layerUrl: "https://gisdata.alleghenycounty.us/arcgis/rest/services/EGIS/Web_Parcels/MapServer/0",
    idField: "PIN", // unconfirmed — gisdata.alleghenycounty.us is blocked from this build environment.
    help: "Allegheny County parcels (county GIS). Search by PIN or a site address.",
  },
  pa_northampton: {
    // VERIFIED LIVE 2026-09-10 from this sandbox (services2.arcgis.com is reachable): 122,379
    // parcel polygons, count query 275ms, 57 populated fields.
    state: "PA", label: "Northampton County, PA",
    layerUrl: "https://services2.arcgis.com/NlbUAihbvA50xxJw/arcgis/rest/services/Northampton_Parcels/FeatureServer/0",
    idField: "PARCEL_ID", addrField: "LOCATION",
    help: "Northampton County parcels (county GIS, Esri-hosted). Search by parcel ID or a site address.",
  },
  pa_cumberland: {
    // VERIFIED LIVE 2026-09-10 from this sandbox: 104,637 parcel polygons, count query 496ms,
    // 41 populated fields.
    state: "PA", label: "Cumberland County, PA",
    layerUrl: "https://services1.arcgis.com/1Cfo0re3un0w6a30/arcgis/rest/services/Tax_Parcels/FeatureServer/0",
    idField: "PIN", addrField: "SITUS",
    help: "Cumberland County tax parcels (county GIS, Esri-hosted). Search by PIN or a site address.",
  },
  ga_gwinnett: {
    // VERIFIED LIVE 2026-09-10 from this sandbox: 309,658 parcel polygons, count query 304ms,
    // 16 populated fields.
    state: "GA", label: "Gwinnett County, GA",
    layerUrl: "https://services3.arcgis.com/RfpmnkSAQleRbndX/arcgis/rest/services/Property_and_Tax/FeatureServer/0",
    idField: "PIN", addrField: "ADDRESS",
    help: "Gwinnett County property & tax parcels (county GIS, Esri-hosted). Search by PIN or a site address.",
  },
  mi_oakland: {
    // Oakland County's parcel service on gisservices.oakgov.com resolves to "OC Tax Parcels
    // (Public)" — layer 1 of the county's EnterpriseOpenParcelDataMapService, NOT layer 0 (Site
    // Address) or layer 2 (Right of Way) on the same service — confirmed via the county's own
    // (OCAGOAdmin) ArcGIS Online item listing. gisservices.oakgov.com is blocked from this build
    // environment, so the field list could not be independently re-read here; PIN/
    // SITESTREETADDRESS come directly from the dispatch's live browser measurement.
    state: "MI", label: "Oakland County, MI",
    layerUrl: "https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1",
    idField: "PIN", addrField: "SITESTREETADDRESS",
    help: "Oakland County tax parcels (county GIS). Search by PIN or a site address.",
  },
  ks_wyandotte: {
    // VERIFIED LIVE 2026-09-10 from this sandbox: 68,993 parcel polygons, count query 289ms.
    // Attribute-light by design — id + acreage only, no owner/situs/value fields on this layer
    // (the same standing this file already gives Utah/Delaware/North Dakota).
    state: "KS", label: "Wyandotte County, KS",
    layerUrl: "https://services1.arcgis.com/Qo2HHQp8vgPs2wg3/arcgis/rest/services/parcel_py/FeatureServer/0",
    idField: "PARCEL_NBR",
    help: "Wyandotte County parcels (county GIS, Esri-hosted). Search by parcel number or a site address.",
  },
  mo_platte: {
    // VERIFIED LIVE 2026-09-10 from this sandbox: 45,149 parcel polygons, count query 744ms.
    // Attribute-light by design — id/legal/acreage/zoning only, no owner/situs/value fields.
    state: "MO", label: "Platte County, MO",
    layerUrl: "https://services.arcgis.com/KP64F8Xif9MkUwD4/arcgis/rest/services/Current_Parcels/FeatureServer/0",
    idField: "PARCELNUM",
    help: "Platte County current parcels (county GIS, Esri-hosted). Search by parcel number or a site address.",
  },
  or_multnomah: {
    // VERIFIED LIVE 2026-09-10 from this sandbox: 284,349 parcel polygons, count query 585ms,
    // 49 populated fields.
    state: "OR", label: "Multnomah County, OR",
    layerUrl: "https://services5.arcgis.com/x7DNZL1YqNQVNykA/arcgis/rest/services/Multnomah_County_Taxlot_Parcels/FeatureServer/0",
    idField: "PROPID", addrField: "SITUSADDR",
    help: "Multnomah County taxlot parcels (county GIS, Esri-hosted). Search by property ID or a site address.",
  },
  or_clackamas: {
    // ⛔ CORRECTED — the originally-measured URL (services2.arcgis.com/…/Taxlot_additional_
    // records_public/FeatureServer/2, "Taxlot Additional Records Public") is a supplementary
    // POINT table with only 3,470 features, not the county's parcel fabric — confirmed live from
    // this sandbox. The real candidate is Clackamas County's OWN GIS org account (CCGISWebService,
    // not the regional OregonMetro.RLIS account that publishes the additional-records table):
    // "Taxlots", 163,927 parcel polygons, count query verified live, 7 fields (id-only schema —
    // PARCEL_NUMBER/TLNO/SITUS/TAXCODE, no owner/value). 3-point spread confirmed real data at
    // Oregon City, Milwaukie and Molalla — all three ends of the county.
    state: "OR", label: "Clackamas County, OR",
    layerUrl: "https://services3.arcgis.com/I2eWXOndpF9m8oKC/arcgis/rest/services/Taxlots/FeatureServer/0",
    idField: "PARCEL_NUMBER", addrField: "SITUS",
    help: "Clackamas County taxlots (county GIS, Esri-hosted). Search by parcel number or a site address.",
  },
  ky_jefferson: {
    state: "KY", label: "Jefferson County, KY",
    layerUrl: "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataPVA/MapServer/1",
    idField: "PARCELID", // unconfirmed — gis.lojic.org is blocked from this build environment.
    help: "Jefferson County (Louisville) PVA parcels (LOJIC open data). Search by parcel ID or a site address.",
  },
  ms_desoto: {
    // VERIFIED LIVE 2026-09-10 from this sandbox: 80,950 parcel polygons, count query 830ms,
    // 55 populated fields.
    state: "MS", label: "DeSoto County, MS",
    layerUrl: "https://services5.arcgis.com/nbwtrV1EDhKfIQhm/arcgis/rest/services/DESOTO_PARCELS/FeatureServer/0",
    idField: "PARNO", addrField: "SITEADD",
    help: "DeSoto County parcels (county GIS, Esri-hosted). Search by parcel number or a site address.",
  },
  /* ⛔ MS HINDS — DELIBERATELY NOT WIRED, correcting the dispatch. The given URL
   * (services8.arcgis.com/dXKNoCSoFLBzx24o/.../Parcels/FeatureServer/0) is published by a Jackson
   * State University student account (`J00937011@students.jsums.edu_OneJSU`), not the county, and
   * holds only 188 features against a county of ~250,000 people — objectively too small to be the
   * real parcel fabric, confirmed live from this sandbox. The county's own candidates (gisweb.co.
   * hinds.ms.us, gis.cmpdd.org) are both blocked from this sandbox and unconfirmed. Recorded in
   * docs/STATEWIDE-PARCELS.md rather than silently dropped — see COUNTY_VERIFICATION in
   * countiesProvenance.js for the full reasoning. */
  ok_oklahoma: {
    // VERIFIED LIVE 2026-09-10 from this sandbox: 337,029 parcel polygons, count query 149ms,
    // 45 populated fields.
    state: "OK", label: "Oklahoma County, OK",
    layerUrl: "https://services8.arcgis.com/euhkr1dAJeQBIjV0/arcgis/rest/services/TaxParcelsPublics_view/FeatureServer/0",
    idField: "accountno", addrField: "location",
    help: "Oklahoma County tax parcels (county assessor, Esri-hosted). Search by account number or a site address.",
  },
  ok_tulsa: {
    // Tulsa County's own Assessor service (asps0305.tulsacounty.org, AGOL owner tca_cperkins —
    // the Tulsa County Assessor's own org, confirmed via that account's public item listing) is
    // the resolved candidate for "122 populated fields, densest in the set" — the originally-cited
    // services3.arcgis.com host carries only ancillary tables (Building Permit, Historical
    // Parcels, Records) under this same account, none matching that description. Blocked from this
    // build environment, so the field list could not be independently re-read here.
    state: "OK", label: "Tulsa County, OK",
    layerUrl: "https://asps0305.tulsacounty.org/arcgis/rest/services/TCA_Mapping_Application/Parcels/MapServer/161",
    idField: "PARCEL_ID",
    help: "Tulsa County Assessor parcels (county GIS). Search by parcel ID or a site address.",
  },
  la_eastbatonrouge: {
    // VERIFIED LIVE 2026-09-10 from this sandbox: 205,820 parcel polygons, count query 563ms,
    // 13 populated fields.
    state: "LA", label: "East Baton Rouge Parish, LA",
    layerUrl: "https://services.arcgis.com/KYvXadMcgf0K1EzK/arcgis/rest/services/Tax_Parcels_2026/FeatureServer/0",
    idField: "ASSESSMENT_NUM", addrField: "PHYSICAL_ADDRESS",
    help: "East Baton Rouge Parish tax parcels (parish GIS, Esri-hosted). Search by assessment number or a site address.",
  },
  /* ⛔ LOUISIANA HAS PARISHES, NOT COUNTIES — and that is not only a labelling matter. The
   * nationwide geometry asset names this row "Orleans Parish", and until B1574257 (below, same
   * session) `countyKeyForName` stripped only the word "County" from a display name, so NO
   * Louisiana point could ever be turned back into its configured key: `la_eastbatonrouge` was
   * already unreachable by name, silently, and this row would have joined it. The key, the label
   * and every user-facing string here say PARISH; the slug drops the designation exactly the way
   * a Texas key drops "County" (`la_orleans`, not `la_orleansparish`). */
  la_orleans: {
    // B1574256 — MEASURED LIVE from Michael's own browser 2026-09-11 evening Central (this
    // sandbox's egress policy blocks gis.nola.gov — CONNECT tunnel rejected, 403; see
    // countiesProvenance.js). Layer 0 "parcels" is the ONLY layer on the ParcelSearch service;
    // capabilities "Map,Query,Data". Three points spread across the whole parish all answered with
    // real, distinct parcels: New Orleans CBD (114ms, 357 features, PARCELID 41036654, "826 UNION
    // ST, LA", OWNERNME1 "CONDO MASTER"), Algiers across the river (94ms, 246 features, PARCELID
    // 41001272, "1306 PACIFIC AVE, LA, 70114") and Lakeview (65ms, 224 features, PARCELID 41011510,
    // "6198 MILNE BLVD, LA, 70124"). This is the parish's OWN authoritative GIS host.
    state: "LA", label: "Orleans Parish, LA",
    layerUrl: "https://gis.nola.gov/arcgis/rest/services/ParcelSearch/MapServer/0",
    idField: "PARCELID", addrField: "SITEADDRESS",
    help: "Orleans Parish (New Orleans) parcels (parish GIS). Search by parcel ID or a site address.",
  },
  al_jefferson: {
    state: "AL", label: "Jefferson County, AL",
    layerUrl: "https://jccgis.jccal.org/server/rest/services/Basemap/Parcels/MapServer/0",
    idField: "PARCELID", // unconfirmed — jccgis.jccal.org is blocked from this build environment.
    help: "Jefferson County (Birmingham) parcels (county GIS). Search by parcel ID or a site address.",
  },
  /* ═══ B1551617 — Tier 1 (Hillwood-market) counties, discovered + verified LIVE from this sandbox
   * 2026-09-11 by ui-audit/discover-county-parcels.mjs (routes: ArcGIS Hub dataset API / ArcGIS
   * Online item search — both *.arcgis.com, reachable here). Every one passed the harness's
   * acceptance test: a point query inside the 8s timing budget, ownership-shaped attributes with a
   * REAL populated value, and three geometry-verified spread points across the whole county (not
   * just its seat). Full detail (chosen candidate + every rejected one + why) in
   * docs/STATEWIDE-PARCELS.md's "Tier 1" table. ═══ */
  ga_fulton: {
    // VERIFIED LIVE 2026-09-11 from this sandbox: 373,296 parcel polygons, count query 616ms,
    // 28 fields. Replaces the previously-declined `Tax_Parcels2018` (2018 vintage, stale).
    state: "GA", label: "Fulton County, GA",
    layerUrl: "https://services1.arcgis.com/AQDHTHDrZzfsFsB5/arcgis/rest/services/Tax_Parcels/FeatureServer/0",
    idField: "ParcelID", addrField: "Address",
    help: "Fulton County tax parcels (county GIS, Esri-hosted). Search by parcel ID or a site address.",
  },
  ga_chatham: {
    // VERIFIED LIVE 2026-09-11 from this sandbox: 126,490 parcel polygons, count query 708ms,
    // 47 fields. Previously "not found" (docs/STATEWIDE-PARCELS.md, routes 1-2 only, 2026-09-10).
    state: "GA", label: "Chatham County, GA",
    layerUrl: "https://services5.arcgis.com/CEpuXecVrKGiDoOH/arcgis/rest/services/Parcels/FeatureServer/0",
    idField: "PIN", addrField: "PropAddres",
    help: "Chatham County (Savannah) parcels (county GIS, Esri-hosted). Search by PIN or a site address.",
  },
  /* ⛔ B1339920 (2026-09-12) — THIS ENTRY WAS PREVIOUSLY THE ONLY AZ ROW, AND ITS BBOX REACHES
   * PHOENIX. `az_pinal`'s bbox is Pinal's own measured data extent (32.5–33.47 lat), which overlaps
   * the southern edge of Maricopa County — Phoenix (33.4484, -112.0740) falls inside it, so with no
   * `az_maricopa` entry ever configured, every Phoenix click routed here and queried a service that
   * genuinely has no Phoenix parcels (measured live: zero features). The bbox itself is correct for
   * Pinal (Casa Grande / Apache Junction still resolve here, both verified below) — the missing
   * piece was Maricopa's OWN entry, added immediately after this one, so Phoenix/Mesa/Surprise/
   * Buckeye route to the county that actually holds their parcels instead. See `az_maricopa` below. */
  az_pinal: {
    // VERIFIED LIVE 2026-09-11 from this sandbox: 286,959 parcel polygons, count query 523ms,
    // 74 fields. Published by the City of Maricopa's own GIS account (owner CityOfMaricopa) —
    // confirmed to cover the WHOLE county, not just the city, by three geometry-verified spread
    // points 50-80 miles apart (Casa Grande / Apache Junction area / San Tan Valley area) all
    // returning real parcels with real owner names.
    state: "AZ", label: "Pinal County, AZ",
    layerUrl: "https://services7.arcgis.com/MlfUGd2UJYefAS7v/arcgis/rest/services/TaxParcel_8_26/FeatureServer/0",
    idField: "PARCELID", addrField: "SITEADDRES",
    help: "Pinal County tax parcels (Esri-hosted). Search by parcel ID or a site address.",
  },
  az_maricopa: {
    // B1339920 — MEASURED LIVE from Michael's own browser 2026-09-11 evening Central (this
    // sandbox's egress policy blocks gis.maricopa.gov — see countiesProvenance.js). 1,760,396
    // parcel polygons, capabilities "Map,Query,Data". Layer 1 ("Parcel") — layer 0 ("Subdivision")
    // is a different layer, not the parcel fabric, do not wire it. Four spread points across the
    // whole county all answered with real parcels: Phoenix (221ms, APN 11221001), Mesa (108ms, APN
    // 13837006A), Surprise (110ms, APN 50118550), Buckeye (102ms, APN 40022114, "705 E EDISON AVE").
    // This is the county's OWN authoritative GIS host, not a third-party republication.
    state: "AZ", label: "Maricopa County, AZ",
    layerUrl: "https://gis.maricopa.gov/arcgis/rest/services/IndividualService/Parcel/MapServer/1",
    idField: "APN", addrField: "PropertyFullStreetAddress",
    help: "Maricopa County (Phoenix) tax parcels (county GIS). Search by APN or a site address.",
  },
  mo_clay: {
    // VERIFIED LIVE 2026-09-11 from this sandbox: 98,112 parcel polygons, count query 570ms,
    // 40 fields.
    state: "MO", label: "Clay County, MO",
    layerUrl: "https://services7.arcgis.com/3c8lLdmDNevrTlaV/arcgis/rest/services/ClayCountyParcelService/FeatureServer/0",
    idField: "parcel_id", addrField: "situs_display",
    help: "Clay County parcels (county GIS, Esri-hosted). Search by parcel ID or a site address.",
  },
  sc_greenville: {
    // VERIFIED LIVE 2026-09-11 from this sandbox: 215,484 parcel polygons, count query 387ms,
    // 55 fields. Replaces the previously-declined `Parcel_Sizes_2018_WFL1` (2018 vintage AND a
    // derived-acreage layer, not the parcel layer itself).
    state: "SC", label: "Greenville County, SC",
    layerUrl: "https://services.arcgis.com/zTM0LZtJeE1HzO09/arcgis/rest/services/kx_greenville_county_sc_tax_parcel_SHP/FeatureServer/0",
    idField: "PIN",
    help: "Greenville County tax parcels (Esri-hosted). Search by PIN or a site address.",
  },
  ia_polk: {
    // VERIFIED LIVE 2026-09-11 from this sandbox: 219,672 parcel polygons, count query 291ms,
    // 49 fields. Previously "not found" (docs/STATEWIDE-PARCELS.md, routes 1-2 only, 2026-09-10).
    state: "IA", label: "Polk County, IA",
    layerUrl: "https://services.arcgis.com/lcU85Lh3UvDs5Naw/arcgis/rest/services/PolkParcelsValues5_28_2026/FeatureServer/0",
    idField: "PIN",
    help: "Polk County (Des Moines) parcels (county GIS, Esri-hosted). Search by PIN or a site address.",
  },
  pa_lehigh: {
    // VERIFIED LIVE 2026-09-11 from this sandbox: 127,043 parcel polygons ("Parcel Boundaries",
    // layer 1), count query 451ms, 21 fields. Replaces the previously-declined `ATestParcel` —
    // same underlying ArcGIS service CONTAINER (a publisher naming quirk, confirmed by inspecting
    // the service directly): layer 0 is an unrelated "Owner" POINT layer; layer 1, wired here, is
    // a real, current, 127,043-feature POLYGON parcel layer whose own AGOL item is titled "Parcels
    // - PA - Lehigh County", not "ATestParcel".
    state: "PA", label: "Lehigh County, PA",
    layerUrl: "https://services1.arcgis.com/XWDNR4PQlDQwrRCL/ArcGIS/rest/services/ATestParcel/FeatureServer/1",
    idField: "PIN", addrField: "SITUS_ADDR_NUM",
    help: "Lehigh County parcels (Esri-hosted). Search by PIN or a site address.",
  },
  nm_bernalillo: {
    // VERIFIED LIVE 2026-09-11 from this sandbox: 257,283 parcel polygons, count query 304ms,
    // 16 fields. Published by the City of Albuquerque's GIS (owner agis_CABQ) for the county's
    // own use. Previously "not found" (docs/STATEWIDE-PARCELS.md, routes 1-2 only, 2026-09-10).
    state: "NM", label: "Bernalillo County, NM",
    layerUrl: "https://services.arcgis.com/CWv1abTnC3urn4bV/arcgis/rest/services/berncoparcels_forIDO/FeatureServer/0",
    idField: "UPC", addrField: "SITUSADD",
    help: "Bernalillo County (Albuquerque) parcels (Esri-hosted). Search by UPC (Uniform Parcel Code) or a site address.",
  },
  il_kane: {
    // VERIFIED LIVE 2026-09-11 from this sandbox: 187,336 parcel polygons, count query 336ms,
    // 48 fields.
    state: "IL", label: "Kane County, IL",
    layerUrl: "https://services1.arcgis.com/oRKmdBXD6EbdmVgJ/arcgis/rest/services/KaneCo_IL_Parcels_LegalDescription/FeatureServer/0",
    idField: "PIN", addrField: "SiteAddress",
    help: "Kane County parcels (county GIS, Esri-hosted). Search by PIN or a site address.",
  },

  /* ═══ B1583296 — CITY OF DETROIT, city-scoped (see cityScopes.js) ═══════════════════════════
   * `Detroit_MP_Parcel_Authoritative` was correctly REJECTED as a Wayne County candidate
   * (docs/STATEWIDE-PARCELS.md, B1551617/B1574258): it is the City of Detroit only and would
   * silently return nothing across most of the county. Wayne County itself has no county-wide
   * source wired (three discovery routes found none — same doc), so this key is reached ONLY via
   * `cityScopeAnswer`'s point-in-Detroit-boundary test, never via a bbox/name match on "Wayne."
   * VERIFIED LIVE 2026-09-11 evening Central (Michael's own browser): a point query at downtown
   * Detroit (42.3314, -83.0458) returned a real parcel with 46 populated fields. Field list
   * confirmed live from this sandbox 2026-09-12 (services2.arcgis.com is reachable here):
   * `parcel_id` and `address` are real fields on the layer. */
  mi_detroit: {
    state: "MI", label: "City of Detroit, MI",
    layerUrl: "https://services2.arcgis.com/PpbvckyUgaYqseNQ/arcgis/rest/services/Detroit_MP_Parcel_Authoritative/FeatureServer/0",
    idField: "parcel_id", addrField: "address",
    help: "City of Detroit parcels (city GIS, Esri-hosted) — searches are limited to the city limits, not all of Wayne County. Search by parcel ID or a site address.",
  },
};

/* The counties whose full parcel fabric is snapshot-cached to Google Drive (B629) so the map keeps
 * working when the live county server is down. Chambers + Waller ride the flaky State/TxGIO service
 * (the actual pain); Fort Bend is included as reliable-source insurance (Phase 2, tiled). Harris is
 * deliberately EXCLUDED (1.5M parcels — too big for the browser). Kept in lockstep with the
 * parcel-cache Function's allowlist (functions/api/parcel-cache/_handler.js). */
export const SNAPSHOT_COUNTIES = countyKeySet(["chambers", "waller", "fortbend"]);

const ID_RE =
  /(hcad_?num|^acct|account|parcel_?id|prop_?id|^pid$|quick_?ref|geo_?id|^pin$|^gid$)/i;
/* NEW-2 — the field an address SEARCH runs against is picked by the shared situs LADDER
 * (lib/appraisal.js), not by a flat alternation: searching "4050 County Road 50" must query the
 * column that holds the land's address, never the one that holds the owner's mailing address. */

/* Taxing-jurisdiction + rate resolver — ONE place to wire each county's tax-unit /
 * rate source as endpoints are confirmed. No public per-parcel rate endpoint is
 * wired for any county yet, so this mines the parcel attributes for any taxing-
 * unit codes the CAD already returns and otherwise degrades gracefully. It NEVER
 * fabricates a rate. Returns { units:[{name,value}], rates|null, total|null,
 * connected:boolean, note }. When a rate endpoint is added for a county, fill in
 * rates/total and set connected:true.
 *
 * NEW-1 — Harris is wired, real, and dated: `resolveHarrisTaxRates` (lazy-imported so the
 * planner's boot chunk never carries it) combines the Texas Comptroller's own published annual
 * rates (via `/api/taxrates`, functions/api/taxrates.js) with the SAME live city/school-district
 * spatial lookup the header jurisdiction badge uses. See that module's header for exactly what a
 * Harris total does and doesn't cover. `lng`/`lat` are the parcel's own centroid — omit them and
 * Harris degrades to "not connected" (LOUD-FAILURE: a spatial lookup needs a point). Every other
 * county keeps the pre-existing graceful degrade unchanged. */
export const TAX_RATE_SOURCES = { harris: "comptroller-live", fortbend: null, chambers: null };
export async function resolveTaxRates(county, attrs, { lng, lat } = {}) {
  const units = [];
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === "") continue;
    if (/(tax_?unit|jurisd|taxing|school|_isd$|^isd|\bmud\b|\besd\b|college|^city$|^cnty|county_?nm)/i.test(k))
      units.push({ name: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), value: String(v) });
  }
  const src = TAX_RATE_SOURCES[county];
  if (!src) return { units, rates: null, total: null, connected: false, note: `Rate source not connected for ${county || "this county"}.` };
  if (county === "harris") {
    if (lng == null || lat == null) return { units, rates: null, total: null, connected: false, note: "Location unavailable — can't look up taxing jurisdictions." };
    try {
      const { resolveHarrisTaxRates } = await import("./harrisTaxRates.js");
      return await resolveHarrisTaxRates({ lng, lat });
    } catch (e) {
      return { units, rates: null, total: null, connected: false, note: `Rate source unavailable right now: ${e && e.message ? e.message : "fetch failed"}.` };
    }
  }
  return { units, rates: null, total: null, connected: false, note: "Rate source returned no data." };
}

/* ------------------------------------------------------------------------
 * Jurisdiction-aware layer registry.
 *
 * Statewide overlays (FEMA, NWI, TxRRC) live in MapFinder; this registry adds
 * the LOCAL utility / district layers that only exist inside one jurisdiction.
 * Keyed by the same county keys as COUNTIES_MAP. When a county is in view (or an
 * active parcel sits in it), MapFinder lists that jurisdiction's layers in the
 * sidebar. Where a jurisdiction publishes no public GIS, `layers` is empty and
 * `note` explains why (we never fabricate an endpoint).
 *
 * Each layer: { label, url (MapServer root, rendered server-side as an image
 * overlay — no CORS needed), layers (visible sub-layer ids, or null = all),
 * note, opacity }. Endpoints are public ArcGIS REST services found from each
 * agency's GIS site; county servers move occasionally, so a layer that 404s can
 * be re-pointed here. Several are flagged provisional where not live-verified.
 * ----------------------------------------------------------------------- */

/* ═══ B853712 — THE STATEWIDE-DERIVED TIER: ALL 254 TEXAS COUNTIES, WITHOUT 254 LITERALS ═══════
 *
 * A hand-written row above marks a county with its OWN probed appraisal-district service — the
 * DIALED-IN tier (harris/fortbend/chambers/waller/montgomery/brazoria/galveston/liberty/austintx).
 * Every OTHER Texas county rides the universal statewide fallback (`TXGIO_STATEWIDE_LAYER`) exactly
 * the way Waller already does — so this DERIVES that same shape for the other ~245 counties from
 * `public/geo/county-polygons.json`, the asset `resolveCounty` already fetches for point-in-polygon
 * geometry (B209502). Nothing new is fetched and nothing is hand-typed: the derivation reuses the
 * asset's own name/state/fips/bbox, which is why it costs the Site route's bundle nothing beyond
 * this function — 254 literal rows at the measured ~162 bytes/row Colorado's compact form averages
 * would have added ~40 KB to a route this repo has spent real effort keeping under its ceiling
 * (`/CLAUDE.md` → the B414480/B1064 bundle-baseline history).
 *
 * WHY THIS IS SAFE TO SKIP A COUNTY THAT ALREADY HAS A DIALED-IN ROW: derivation runs AFTER
 * `COUNTIES_RAW` is fully declared and checks it BY KEY before adding anything, so a promoted
 * county's literal row always wins — asserted in `test/counties.test.js` ("the dialed-in tier is
 * never shadowed").
 *
 * WHY THIS DOESN'T NEED A KEY→NAME REVERSE TABLE: every consumer that reaches a derived entry does
 * so through `countyKeyForName(name, state)` or `geometryCountyKey`, both of which already HOLD the
 * real county name (from `resolveCounty`'s answer or a boundary layer's own field) before asking —
 * the derivation only has to turn a known-real name into a key and a record, never guess one.
 *
 * WHAT THIS DOES NOT CHANGE: `candidateCountiesForPoint`'s bbox pre-filter and its statewide-append
 * still enumerate only the LITERAL entries (`Object.entries(COUNTIES_MAP)` — this proxy leaves that
 * unaffected, since it adds no `ownKeys` override) — a click over a derived county already finds its parcel via
 * the `txgio_statewide` candidate that's unconditionally appended for every Texas point (unscoped,
 * so it needs no per-county wiring to answer a spatial click). Adding the derived key to that
 * candidate list too would just double-query the identical TxGIO endpoint under two names. The
 * derivation's job is narrower and load-bearing anyway: making a DIRECT lookup
 * (`COUNTIES_MAP[key]` / `COUNTIES[key]`) answer correctly for any of the 254, which is exactly
 * what `countyIdentity()` needs to stop reporting "no parcel data wired here yet" for a county that
 * in fact has the same statewide coverage Waller does.
 *
 * VERIFICATION, stated honestly (owner instruction, 2026-08-29): this is ONE service (TxGIO) whose
 * COVERAGE is what's under test, not 254 independent endpoints — so this ships on a live-probed
 * SAMPLE, not a claim of 254 verified rows. Probed 2026-08-29 via `/identify` against the real
 * production endpoint, reproduced by the shipped code in `ui-audit/verify-dallas-metro-parcels.mjs`:
 * all nineteen counties within 50 miles of downtown Dallas (edge distance, per-county polygon, not
 * centroid) PLUS a spread sample outside that radius — Hartley (Panhandle), Webb (border), Nacogdoches
 * (Piney Woods), Calhoun (Gulf coast) — every one answered with a real parcel at a real point inside
 * it. That is a sample, not exhaustive coverage of all 254; a county this sample didn't reach could
 * still expose a TxGIO gap (a data hole, a name spelled differently than expected) that only a probe
 * of that specific county would catch. */
const TX_COUNTY_KEY_ALIAS = { austin: "austintx" }; // mirrors countyKeyForName's TX_ALIAS below — one
// county (Austin, Bellville/Sealy) whose real name collides with the City of Austin's slug, so its
// literal row is keyed `austintx`; the derivation must recognise that BEFORE the shadow-check below,
// or it would derive a redundant "austin" entry duplicating a service already wired.

let derivedTxCountiesCache = null; // Map<key, {name, mapEntry, cfgEntry}> | null (asset not yet resident)
const round2 = (n) => Math.round(n * 100) / 100;

function derivedTxCounties() {
  if (derivedTxCountiesCache) return derivedTxCountiesCache;
  const roster = countyRoster();
  if (!roster) return null; // asset not resident yet — same "ask again later" contract as resolveCounty
  const out = new Map();
  const PAD = 0.02; // the same shared-border pad every bbox in this file already uses
  for (const c of roster) {
    if (c.state !== "TX") continue;
    const rawKey = normCountyKey(c.name);
    const key = rawKey && (TX_COUNTY_KEY_ALIAS[rawKey] || rawKey);
    if (!key || COUNTIES_RAW[key]) continue; // a dialed-in row always wins — never shadowed
    const [minLng, minLat, maxLng, maxLat] = c.bbox;
    const NAME_UPPER = c.name.toUpperCase();
    out.set(key, {
      name: c.name,
      mapEntry: {
        state: "TX",
        center: [round2((minLat + maxLat) / 2), round2((minLng + maxLng) / 2)],
        zoom: 10,
        bbox: [round2(minLat - PAD), round2(minLng - PAD), round2(maxLat + PAD), round2(maxLng + PAD)],
        mapServer: null,
        layerUrl: TXGIO_STATEWIDE_LAYER,
        statewideDerived: true,
      },
      cfgEntry: {
        state: "TX",
        label: `${c.name} County`,
        layerUrl: TXGIO_STATEWIDE_LAYER,
        idField: "prop_id",
        addrField: "situs_addr",
        scopeWhere: `county='${NAME_UPPER}'`,
        help: `Texas statewide parcels (TxGIO) — searches are limited to ${c.name} County.`,
        statewideDerived: true,
      },
    });
  }
  derivedTxCountiesCache = out;
  return out;
}

/* Wraps a literal (`byCountyKey`-normalised) county-config Proxy with the derived-tier fallback:
 * an unrecognised key checks `derivedTxCounties()` before answering `undefined`. `pick` selects
 * which shape a caller wants (`COUNTIES` reads `.cfgEntry`, `COUNTIES_MAP` reads `.mapEntry`) off
 * the SAME cached derivation, so building it is never paid for twice. */
function withStatewideDerivation(literalProxy, pick) {
  return new Proxy(literalProxy, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (v !== undefined || typeof prop !== "string") return v;
      const derived = derivedTxCounties();
      const rec = derived && derived.get(normCountyKey(prop));
      return rec ? pick(rec) : undefined;
    },
    has(target, prop) {
      if (Reflect.has(target, prop)) return true;
      if (typeof prop !== "string") return false;
      const derived = derivedTxCounties();
      return !!(derived && derived.has(normCountyKey(prop)));
    },
  });
}

export const COUNTIES = withStatewideDerivation(byCountyKey(COUNTIES_RAW), (rec) => rec.cfgEntry);

const JURISDICTION_LAYERS_RAW = {
  // B898: Harris's direct-agency layers (drainage channels, storm sewer, water/wastewater
  // mains) moved OUT of this per-county nesting into the flat `AHJ_LAYERS` registry in
  // layers.js (same `county` tag convention as EVIDENCE.coh_hydrants) — they now render
  // inside the decision-first Flood & drainage / Utilities groups instead of a standalone
  // "Harris County · City of Houston" provider heading. This entry is kept (empty) so a
  // future county-specific layer has an obvious home, matching the chambers/waller pattern.
  harris: {
    label: "Harris County · City of Houston",
    layers: {},
    note: "No county-specific overlay group — its layers now live in the Flood & drainage and Utilities groups above (auto-scoped, not a standalone Houston heading).",
  },
  fortbend: {
    label: "Fort Bend County",
    layers: {
      // NOTE: MUD/WCID/water-district boundaries live in the global "Jurisdictions"
      // overlay group (lib/layers.js JURISDICTIONS.jur_mud, B176) — now a STATEWIDE TCEQ
      // source (covers Fort Bend + Harris + everywhere), available regardless of which
      // county is in view. The old Fort-Bend-only layer was removed here to avoid a dupe.
      fb_contours: {
        // B469/B691 — explicit dynamic (server-rendered export-image) layer. Its host
        // (arcgisweb.fortbendcountytx.gov) sends no CORS headers: a direct ?f=json probe can never
        // be read AND prints an uncatchable red console error per attempt, so `noCors: true` makes
        // probeService health-check through the same-origin B445 cache proxy ONLY (see layers.js).
        // Proxy disabled/undeployed/unreachable → the same optimistic add a direct CORS failure
        // produced (never a hard dependency on the proxy); the f=image export already proxies and
        // renders via a CORS-exempt <img>.
        kind: "dynamic",
        noCors: true,
        // B762: folds into the Basemap group under the USGS contour row (Fort Bend is a
        // single-layer county, so it no longer gets its own dropdown). Label names the county
        // + authority since it sits next to the statewide USGS contours there.
        label: "1-ft contours (Fort Bend DD)",
        url: "https://arcgisweb.fortbendcountytx.gov/arcgis/rest/services/FLOODZONE/Contours_1Foot/MapServer",
        layers: null,
        // NEW-4 — the ONE acknowledged unpinned-sublayer exception (lib/layerWeight.js). Every
        // other server-rendered layer now pins its data sublayers so an agency cannot paint its
        // own LABEL sublayer over the plan. This host sends no CORS headers and its services
        // catalog is unreachable from the build sandbox, so the sublayer ids cannot be READ —
        // and inventing them would silently blank the layer, which is worse than an annotation
        // risk on a contour service that publishes hairlines rather than point labels.
        // Re-check on the next live pass with a browser that can reach the county host.
        sublayersUnpinned: "county host sends no CORS headers; its sublayer catalog cannot be read from here — pin the ids on the next live pass",
        note: "Fort Bend Drainage District 1-foot contours. Exists ONLY in Fort Bend County — the statewide USGS contour layer above covers everywhere else. Health checked via the same-origin proxy (county host sends no CORS headers).",
        // NEW-1 stacking role (lib/mapStack.js): contour hairlines — they draw OVER the site
        // elements, so a building placed on the plan never hides the ground it sits on.
        role: "line",
        opacity: 0.7,
      },
    },
  },
  chambers: {
    label: "Chambers County",
    layers: {},
    note: "No public utility/infrastructure GIS is published for Chambers County — parcels only. FEMA, wetlands and TxRRC layers above still apply.",
  },
  waller: {
    label: "Waller County",
    layers: {},
    note: "No public GIS is published for Waller County. FEMA, wetlands and TxRRC layers above still apply.",
  },
};

// Find the field whose name looks like an id or address field. The address side walks the shared
// SITUS ladder in rung order — every field is tested against rung 1 before any is tested against
// rung 2 — so a service that lists its mailing column first can no longer win the search field.
export function detectField(fields, kind) {
  const names = (fields || []).map((x) => x && x.name).filter(Boolean);
  if (kind === "id") { const f = names.find((n) => ID_RE.test(n)); return f || null; }
  // situsKey resolves over an attribute BAG, so present the field names as one (value = the name,
  // which is non-empty by construction — this asks "which key wins", not "what does it hold").
  return situsKey(Object.fromEntries(names.map((n) => [n, n])));
}

/* Map-view config per county: where to center the slippy map, and which ArcGIS
 * service to draw parcel lines from.
 *   - mapServer: a MapServer root used as a dynamic image overlay (renders all
 *     parcel lines across the view, scales to the whole county). Preferred.
 *   - layerUrl:  a specific feature layer, used both to render (when there's no
 *     MapServer) and to query the parcel under a click.
 *   - bbox:      approximate county extent [latMin, lonMin, latMax, lonMax] (WGS84),
 *     padded a touch so clicks near a shared border still include the neighbour.
 *     Used only to PRE-FILTER which CAD service(s) to identify against for a click —
 *     it is a coarse screen, never authoritative; the parcel service that actually
 *     returns a lot is the source of truth. Overlap at borders is intentional so a
 *     straddle click queries both counties. (No precise boundary polygons bundled.)
 * If layerUrl is null it's resolved from mapServer at runtime. */
const COUNTIES_MAP_RAW = {
  harris: {
    state: "TX",
    center: [29.76, -95.37],
    zoom: 11,
    bbox: [29.49, -95.96, 30.17, -94.90],
    mapServer: "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer",
    layerUrl: "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0",
  },
  fortbend: {
    state: "TX",
    center: [29.53, -95.77],
    zoom: 11,
    bbox: [29.25, -96.13, 29.85, -95.51],
    // Hosted FBCAD parcels (see COUNTIES.fortbend) — a single queryable Esri
    // FeatureServer layer that BOTH renders the outlines and answers a click, so there's
    // no separate MapServer to resolve.
    mapServer: null,
    layerUrl:
      "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0",
  },
  chambers: {
    state: "TX",
    center: [29.7, -94.66],
    zoom: 11,
    bbox: [29.36, -94.92, 29.92, -94.39],
    mapServer: null,
    // CCAD's own live public parcel layer (see COUNTIES.chambers) — B787 repoint off the
    // lagged statewide TxGIO harvest so displayed parcels match the CCAD website. /query is
    // enabled, so this draws as a queryable vector layer and answers clicks directly. It is
    // NO LONGER the `statewide` universal source — that role moved to the dedicated
    // `txgio_statewide` entry below (STATEWIDE_KEYS), which still paints the all-Texas
    // outline backdrop and is the appended click fallback everywhere. A Chambers point now
    // matches this entry's own bbox (a real CAD), with txgio_statewide appended after it.
    layerUrl:
      "https://gisdata.pandai.com/pamaps02/rest/services/Chambers/ChambersCADPublic/MapServer/0",
  },
  waller: {
    state: "TX",
    center: [30.0, -95.86],
    zoom: 11,
    bbox: [29.75, -96.05, 30.20, -95.62],
    mapServer: null,
    // Waller has no CAD of its own, so the statewide TxGIO layer is its live source (outlines
    // via /export, clicks via /identify). Its B629 Drive snapshot backs it when TxGIO is down.
    // NOT flagged `statewide` — `txgio_statewide` is the single universal fallback source, and
    // a second statewide key would just double the TxGIO query on every click.
    layerUrl: TXGIO_STATEWIDE_LAYER,
  },
  /* B209503 — the five counties that complete the Houston metro. These bboxes are the REAL county
   * extents, read from the committed county-polygon asset (which is itself built from the state's
   * own boundary layer), padded 0.02° so a click near a shared line still queries both neighbours.
   * They are a click PRE-FILTER and nothing more: since B209502 the geometry decides the answer, so
   * an overlapping rectangle here can no longer hand a site the wrong county's rules. */
  montgomery: {
    state: "TX", center: [30.33, -95.46], zoom: 11, bbox: [30.01, -95.85, 30.65, -95.08],
    mapServer: null, layerUrl: COUNTIES.montgomery.layerUrl,
  },
  brazoria: {
    state: "TX", center: [29.21, -95.47], zoom: 10, bbox: [28.80, -95.89, 29.62, -95.04],
    mapServer: null, layerUrl: COUNTIES.brazoria.layerUrl,
  },
  galveston: {
    state: "TX", center: [29.34, -94.80], zoom: 11, bbox: [29.06, -95.25, 29.62, -94.35],
    mapServer: null, layerUrl: COUNTIES.galveston.layerUrl,
  },
  liberty: {
    state: "TX", center: [30.19, -94.80], zoom: 10, bbox: [29.87, -95.19, 30.51, -94.42],
    mapServer: null, layerUrl: COUNTIES.liberty.layerUrl,
  },
  austintx: {
    state: "TX", center: [29.85, -96.31], zoom: 11, bbox: [29.58, -96.64, 30.12, -95.98],
    mapServer: null, layerUrl: COUNTIES.austintx.layerUrl,
  },

  // The statewide TxGIO parcel source, as its OWN key (decoupled from Chambers in B787 once
  // Chambers got its live CCAD source). `statewide:true` makes it the UNIVERSAL parcel source:
  // its /export image layer paints parcel outlines anywhere you zoom in (backing the visible
  // lines wherever a county's own CAD is down/unconfigured), and `candidateCountiesForPoint`
  // appends it as a click fallback everywhere so a click can always select an outline it can
  // see (the B130 fix — e.g. a Fort Bend lot with FBCAD down). It has NO bbox on purpose: it
  // must never match a click BY bbox (that would tag a real-county click as statewide) — it is
  // only ever appended as the trailing fallback. Kept LAST so candidate[0] stays a real county
  // (harris when away from all bboxes — the jurisdiction-resolver default). The answering
  // county of a statewide hit is corrected post-hit via `countyAtPoint` (B36a).
  txgio_statewide: {
    state: "TX",
    center: [31.0, -99.2], // Texas centroid — only used if this key is ever "picked" (it isn't; not in the search dropdown)
    zoom: 6,
    mapServer: null,
    statewide: true,
    layerUrl: TXGIO_STATEWIDE_LAYER,
  },

  /* ═══ COLORADO (NEW-5) ═══════════════════════════════════════════════════════════════════
   * bboxes are the REAL county extents, read live from the state's own Colorado Counties layer
   * (services2.arcgis.com/fnCPHPvll1r80nFV, 64 features) on 2026-07-29 — not eyeballed. Like the
   * Texas ones they are a coarse click PRE-FILTER, never authoritative; the parcel service that
   * returns a lot is the source of truth. Padded a touch so a click near a shared line queries
   * both neighbours (Denver's box is genuinely that wide — the airport annexation strip). */
  co_adams: { state: "CO", center: [39.87, -104.34], zoom: 10, bbox: [39.73, -105.07, 40.01, -103.69], mapServer: null, layerUrl: COUNTIES.co_adams.layerUrl },
  co_denver: { state: "CO", center: [39.74, -104.99], zoom: 11, bbox: [39.60, -105.12, 39.92, -104.59], mapServer: null, layerUrl: COUNTIES.co_denver.layerUrl },
  co_arapahoe: { state: "CO", center: [39.65, -104.34], zoom: 10, bbox: [39.55, -105.07, 39.75, -103.69], mapServer: null, layerUrl: COUNTIES.co_arapahoe.layerUrl },
  co_larimer: { state: "CO", center: [40.63, -105.57], zoom: 10, bbox: [40.24, -106.21, 41.01, -104.93], mapServer: null, layerUrl: COUNTIES.co_larimer.layerUrl },
  co_weld: { state: "CO", center: [40.50, -104.32], zoom: 9, bbox: [39.99, -105.07, 41.01, -103.56], mapServer: null, layerUrl: COUNTIES.co_weld.layerUrl },
  co_jefferson: { state: "CO", center: [39.52, -105.22], zoom: 10, bbox: [39.12, -105.41, 39.93, -105.03], mapServer: null, layerUrl: COUNTIES.co_jefferson.layerUrl },
  co_elpaso: { state: "CO", center: [38.83, -104.56], zoom: 10, bbox: [38.50, -105.09, 39.14, -104.04], mapServer: null, layerUrl: COUNTIES.co_elpaso.layerUrl },
  co_boulder: { state: "CO", center: [40.08, -105.37], zoom: 10, bbox: [39.90, -105.71, 40.27, -105.04], mapServer: null, layerUrl: COUNTIES.co_boulder.layerUrl },
  co_broomfield: { state: "CO", center: [39.95, -105.06], zoom: 12, bbox: [39.88, -105.18, 40.06, -104.95], mapServer: null, layerUrl: COUNTIES.co_broomfield.layerUrl },

  /* Colorado's statewide composite as its own key — the exact counterpart of `txgio_statewide`.
   * Same contract: NO bbox (it must never win a click by extent), appended as the trailing
   * fallback so a click can always select something it can see, and kept LAST within its state. */
  co_statewide: {
    state: "CO",
    center: [39.0, -105.55], // Colorado centroid — only used if this key were ever "picked" (it isn't)
    zoom: 7,
    mapServer: null,
    statewide: true,
    layerUrl: CO_STATEWIDE_LAYER,
  },

  /* ═══ NEW-1 (2026-09-08) — statewide composites for every OTHER state a free service could be
   * found for, following the exact `txgio_statewide` / `co_statewide` shape: no bbox (never wins a
   * click by extent, only ever appended as the state-scoped fallback), `statewide: true` (excludes
   * it from the per-county provenance audit — see `ui-audit/gis-source-audit.mjs` header, which
   * exempts these composite pseudo-keys the same way it already exempts the two above), no
   * idField/addrField hints (the app's own live field auto-detect handles it, same as every other
   * statewide entry). Unlike Texas/Colorado, none of these states has ANY county-level entry of its
   * own here — so for a site in, say, Montana, this is the state's ONLY parcel source, not a
   * fallback behind a real county CAD. Full research trail, per-state field lists, license/coverage
   * caveats, and every state that was probed and did NOT pass: `docs/STATEWIDE-PARCELS.md`
   * (generated by `ui-audit/probe-statewide-parcels.mjs`, `npm run probe:parcels`).
   *
   * ⛔ CORRECTED (B1361425, 2026-09-08) — county boundary POLYGONS are now NATIONWIDE, not TX + CO
   * only. Every wiring pass through this file up to and including B1361424's VA/WV addendum had
   * flagged the TX/CO-only limit on this same line and recorded it as a "real, separate 25-state
   * research project" — that premise was WRONG, caught by the owner before this shipped: there is
   * ONE national source (Esri's `USA_Counties_Generalized_Boundaries`, built from Census TIGER,
   * already generalized for national-scale drawing — measured before committing to it: San
   * Bernardino County CA, the largest county in the contiguous US, is 64 vertices at that source's
   * own resolution, before this file's Douglas–Peucker pass even runs). `scripts/build-county-
   * polygons.mjs`'s `US` source (skipping TX/CO, which keep their own dedicated, higher-fidelity
   * state sources) now covers all 3,144 US counties/county-equivalents in ONE build pass. The real
   * open question was never "where is the data" — it was PAYLOAD SIZE, and that was measured, not
   * assumed: 1,063 KB uncompressed / 379 KB gzipped, a `public/` asset fetched lazily and charged
   * against ZERO JS bundle budget (confirmed against `ui-audit/perf-bundle-audit.mjs`'s own
   * documented rule for this exact asset), comfortably inside Cloudflare Pages' 25 MiB per-file cap.
   * `candidateCountiesForPoint`'s geometry-first hoist (`geometryCountyKey`) and `countyForView`'s
   * jurisdiction badge needed NO changes — both were already fully state-agnostic (verified live,
   * not assumed, against Virginia/Louisiana/Alaska points before shipping this). The one real code
   * fix this required: `noParcelSourceNote` (below) hardcoded "append ' County' unless Colorado",
   * which would have misnamed every non-Texas, non-Colorado no-source county whose real designation
   * isn't "County" — "Orleans Parish County", "Denali Borough County" — now fixed to be TX-only.
   *
   * Five of these (AR/DE/IN/NJ/NC) sit on hosts this build environment's egress policy blocks —
   * `Verify: live` items, named per-host below, per the same evidence bar Chambers/Larimer already
   * set in `countiesProvenance.js`: an official ArcGIS Online item's own cached schema (fields,
   * feature count), reachable via the allowlisted arcgis.com API even when the origin service
   * itself is not, is enough to ship on — never a guessed URL with no independent confirmation. */
  ak_statewide: {
    state: "AK", center: [64.0, -152.0], zoom: 4, mapServer: null, statewide: true,
    layerUrl: "https://services1.arcgis.com/7HDiw78fcUiM2BWn/arcgis/rest/services/AK_Parcels/FeatureServer/0",
  },
  ar_statewide: {
    // Verify: live — gis.arkansas.gov is blocked in this build environment; shipped on the
    // strength of the official item's cached schema/feature count (docs/STATEWIDE-PARCELS.md).
    state: "AR", center: [34.9, -92.4], zoom: 7, mapServer: null, statewide: true,
    layerUrl: "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6",
  },
  /* NEW-1 (2026-09-08) — CALIFORNIA and RHODE ISLAND, both of which this repo had on record as
   * `no-free-source` with `Candidate: none found`, and both of which are REAL. The doc's own
   * claims about them ("only a static 2014 file-geodatabase, 51 of 58 counties" for California;
   * "RIGIS publishes standards and a per-town tracker, not a merged statewide layer" for Rhode
   * Island) were WRONG, not merely incomplete — they are retracted outright in
   * docs/STATEWIDE-PARCELS.md rather than softened.
   *
   * ⛔ THE BLIND SPOT THAT PRODUCED BOTH, because it is the reusable lesson and NEW-2 is the fix:
   * every earlier pass resolved a state's candidate from that STATE'S OWN `.gov` GIS host plus
   * whatever a web search surfaced. This sandbox reaches `*.arcgis.com` and cannot reach most
   * state `.gov` domains — so a state that publishes the SAME dataset to its own ArcGIS Online
   * ORGANIZATIONAL ACCOUNT was reachable all along and was never looked for. New York was already
   * saved by exactly that route (see `ny_statewide` above, which says so in its own comment) and
   * it was treated as a one-off workaround for one state instead of as the default second pass for
   * all fifty. A hand-run of that second pass over 13 `no-free-source` states returned these two.
   * `ui-audit/probe-statewide-parcels.mjs` now runs that AGOL pass systematically (NEW-2). */
  ca_statewide: {
    // MEASURED FROM THIS SANDBOX (HTTP 200): 13,138,000 parcels, polygon, 21 fields. Published by
    // ITS.CALFIRE — the California Dept. of Forestry & Fire Protection, a state agency — as a
    // public Feature Service view. Attribute-light: PARCEL_APN, FIPS_CODE, PARCEL_DMP_ID,
    // COUNTYNAME, SITE_ADDR/CITY/STATE/ZIP, FullStreetAddress, Search_PARCELAPN. NO owner field
    // and NO appraised-value field — both stay ABSENT, never zero and never an empty string, the
    // same standing this file already gives Hawaii's, New Hampshire's and Virginia's thin schemas.
    // ⛔ SIZE: at 13.1M parcels this is the largest source in the file (~21% above Florida's
    // 10.8M, already wired). That is safe because NOTHING here ever fetches a layer whole — the
    // display layer is an esri-leaflet featureLayer gated at PARCEL_MINZOOM and queried per map
    // viewport (parcelDisplay.js), and a truncated draw is reported LOUDLY via
    // `responseWasTruncated` rather than silently drawn short. Feature count scales the SERVER's
    // index, not the client's payload.
    state: "CA", center: [37.2, -119.5], zoom: 6, mapServer: null, statewide: true,
    layerUrl: "https://bz1uwWPKUInZBK94.svcs5.arcgis.com/bz1uwWPKUInZBK94/arcgis/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0",
  },
  ct_statewide: {
    state: "CT", center: [41.6, -72.7], zoom: 9, mapServer: null, statewide: true,
    layerUrl: "https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_State_Parcel_Layer_2023/FeatureServer/0",
  },
  /* B1455632 (2026-09-10) — DISTRICT OF COLUMBIA, corrected. This file's own prior finding
   * (docs/STATEWIDE-PARCELS.md) called DC `shape-mismatch`: a real attribute table (ITSPE,
   * arcgis.com-hosted) joined to a separate Tax Lots geometry layer by an SSL key, on the
   * reasoning that the app's single-`layerUrl` shape can't wire a two-service join. That candidate
   * is retired — layer 40 below is ONE service with both the geometry AND the rich attribute set,
   * no join required, so the shape-mismatch objection doesn't apply to it.
   * ⛔ LAYER 40 ("Owner Polygons / Common Ownership Layer"), NOT layer 33 ("Parcel Lots") on the
   * same service — 33 carries only 1,124 features and returns ZERO downtown, the same wrong-scope
   * trap as Nebraska's original wiring. MEASURED FROM THE OWNER'S OWN BROWSER 2026-09-10 (this
   * sandbox's egress policy blocks maps2.dcgis.dc.gov, a DC .gov host, same signature as every
   * other Verify:live state below) — 137,400 features, 632ms, richest attribute set of anything
   * wired in this file: OWNERNAME, owner mailing address, PREMISEADD, LANDAREA, PROPTYPE, USECODE,
   * NEWLAND/NEWIMPR/NEWTOTAL assessed values, SALEPRICE, SALEDATE, ASSESSMENT, ANNUALTAX, TAXRATE,
   * NBHDNAME. Verify: live — maps2.dcgis.dc.gov is blocked in this build environment. */
  dc_statewide: {
    state: "DC", center: [38.9072, -77.0369], zoom: 12, mapServer: null, statewide: true,
    layerUrl: "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/FeatureServer/40",
  },
  de_statewide: {
    // Verify: live — enterprise.firstmap.delaware.gov is blocked in this build environment.
    // This is the "without Ownership Information" public copy: id + acreage only, by design.
    state: "DE", center: [39.0, -75.5], zoom: 9, mapServer: null, statewide: true,
    layerUrl: "https://enterprise.firstmap.delaware.gov/arcgis/rest/services/PlanningCadastre/DE_StateParcels/FeatureServer/0",
  },
  fl_statewide: {
    state: "FL", center: [27.8, -81.7], zoom: 6, mapServer: null, statewide: true,
    layerUrl: "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0",
  },
  /* NEW-1 (2026-09-08, continuing B1332016) — Hawaii, Maryland, Nebraska and New Hampshire were
   * measured live from the OWNER'S OWN BROWSER, not this sandbox (every host below 403s here —
   * the same egress-allowlist policy block that already applies to AR/DE/IN/NJ/NC). Full field
   * lists, the layer-id traps (Hawaii layer 25, not 0/5/9/11/30; New Hampshire layer 1, not 0)
   * and the measurement provenance are in docs/STATEWIDE-PARCELS.md's per-state notes — this
   * comment only flags the two id traps inline, since a future re-probe that "corrects" either
   * layer id back to 0 would silently swap a polygon layer for a group layer or a point layer. */
  hi_statewide: {
    // Verify: live — geodata.hawaii.gov is blocked in this build environment; measured from the
    // owner's own browser 2026-09-08. ⛔ LAYER 25 ("Statewide TMKs"), NOT 0 (a group layer with
    // zero fields) and NOT the per-county layers 5/9/11/30. No owner, no value fields.
    state: "HI", center: [20.7, -156.4], zoom: 7, mapServer: null, statewide: true,
    layerUrl: "https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/25",
  },
  in_statewide: {
    // Verify: live — gisdata.in.gov is blocked in this build environment. No owner/value fields
    // in this layer at all (confirmed via item metadata, not just unreachable here).
    state: "IN", center: [39.9, -86.3], zoom: 7, mapServer: null, statewide: true,
    layerUrl: "https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0",
  },
  ma_statewide: {
    state: "MA", center: [42.3, -71.8], zoom: 8, mapServer: null, statewide: true,
    layerUrl: "https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0",
  },
  /* B1455632 (2026-09-10) — MAINE, corrected. The prior finding called this `shape-mismatch`: the
   * "Maine Parcels Organized Towns" mosaic needs joining to a separate ADB ownership/value table.
   * ⛔ LAYER 10 IS THE ONLY LAYER ON THIS SERVICE — NOT layer 0, which does not exist here; the
   * task's own field list (TOWN, COUNTY, STATE_ID, MAP_BK_LOT, PROP_LOC) already comes off THIS
   * layer with no join needed for id/situs. Owner/value still require the ADB join and stay absent.
   * MEASURED FROM THIS SANDBOX (HTTP 200, reachable — services1.arcgis.com): 708,382 features,
   * esriGeometryPolygon, 158–174ms, extent covers 98% lat / 102% lon of Maine's bbox (real
   * `extentCoverageCheck`, `ui-audit/lib/statewideCoverage.mjs`), a ~7-mile envelope query at
   * Portland answered in 378ms (2000 features, capped) — well inside the app's 8s budget.
   * ⛔ "ORGANIZED TOWNS" EXCLUDES MAINE'S UNORGANIZED TERRITORY — roughly half the state's LAND
   * AREA (the North Woods) but almost none of its parcels (a handful of people, no municipal
   * government). Documented plainly in docs/STATEWIDE-PARCELS.md — never implied as full coverage.
   * The publisher's own notice ("no complete statewide parcel data layer for Maine… data for many
   * towns is more than fifteen years old") still applies to the ORGANIZED-town data this DOES
   * carry, so currency is uneven by town even within the covered footprint. */
  me_statewide: {
    state: "ME", center: [45.2, -69.3], zoom: 7, mapServer: null, statewide: true,
    layerUrl: "https://services1.arcgis.com/RbMX0mRVOFNTdLzd/ArcGIS/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/10",
  },
  md_statewide: {
    // Verify: live — mdgeodata.md.gov is blocked in this build environment; measured from the
    // owner's own browser 2026-09-08. Owner NAME is absent on this layer — only the owner's
    // MAILING ADDRESS (OWNADD1 etc). Leave owner absent; never fabricate it from the mailing fields.
    state: "MD", center: [39.0, -76.7], zoom: 8, mapServer: null, statewide: true,
    layerUrl: "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0",
  },
  mn_statewide: {
    // Opt-in coverage — counties choose to participate quarterly, so completeness varies.
    state: "MN", center: [46.0, -94.6], zoom: 6, mapServer: null, statewide: true,
    layerUrl: "https://utility.arcgis.com/usrsvcs/servers/1627519e8d3f42bcb55532d48e9a61e5/rest/services/OpenParcels/plan_parcels_open/MapServer/0",
  },
  mt_statewide: {
    state: "MT", center: [47.0, -109.6], zoom: 6, mapServer: null, statewide: true,
    layerUrl: "https://services.arcgis.com/qnjIrwR8z5Izc0ij/ArcGIS/rest/services/Montana_Cadastral_Framework/FeatureServer/1",
  },
  nc_statewide: {
    // Verify: live — services.nconemap.gov is blocked in this build environment. The URL's own
    // "/secure/" path segment is ambiguous (the item's own `access` field reads public) — confirm
    // it isn't a login wall as part of the live check, not just host reachability.
    state: "NC", center: [35.6, -79.4], zoom: 7,
    mapServer: "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer",
    statewide: true,
    layerUrl: "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/0",
  },
  nd_statewide: {
    // Owner/situs/value live on a separate joinable TaxRoll table (layer 1) — not joined here;
    // this layer alone carries id + acreage, the same attribute-light shape as Utah/Delaware.
    state: "ND", center: [47.5, -100.5], zoom: 7, mapServer: null, statewide: true,
    layerUrl: "https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Parcels/FeatureServer/0",
  },
  ne_statewide: {
    // ⛔ CORRECTED 2026-09-09 (NEW-1, continuing B1332016). The PRIOR wiring here —
    // gis.ne.gov/Agency/rest/services/TaxParcelsDED/MapServer/0 — was NOT statewide despite
    // carrying `statewide: true`: its own layer extent converts to roughly 40.98–41.21°N /
    // -96.34 to -95.84°W, which is Douglas/Sarpy/Cass/Saunders counties (the Omaha metro) PLUS
    // Pottawattamie/Mills counties across the state line in Iowa — 75,394 features, and a query
    // at Omaha's own coordinates (41.2565, -95.9345) returned ZERO because Omaha sits just north
    // of that layer's own covered extent. Found by the first real spatial (point-in-envelope)
    // query run against every wired state, 2026-09-09 — every earlier pass had only checked this
    // layer's METADATA (capabilities, field list), never asked it a question at a real coordinate.
    // Verify: live — gis.ne.gov is blocked in this build environment; the layer below and every
    // fact about it were measured from the owner's own browser, 2026-09-09. "Nebraska Statewide
    // Parcels External" (NE OCIO Enterprise portal — note the path is /Enterprise/, not the old
    // /Agency/), 1,154,898 features, esriGeometryPolygon, capabilities Query,Extract,
    // maxRecordCount 2000. Fields: State_PID, Parcel_ID, Situs_Address, Ph_Full_Address,
    // Legal_Description, Twn, Sect, Rng, Acres_Deeded, GIS_Acres, Subdivision, County_ID. Verified
    // GENUINELY statewide by five point probes spread across Nebraska, each returning a real
    // parcel with a DISTINCT county: Omaha (Douglas, 055), Scottsbluff in the far western
    // panhandle (Scotts Bluff, 157), Norfolk in the north (Madison, 119), McCook in the southwest
    // (Red Willow, 145), and Lincoln (Lancaster, 109) — the same five-point spread this file's own
    // NEW-2 extent-coverage check now runs automatically for every wired state.
    state: "NE", center: [41.5, -99.8], zoom: 7, mapServer: null, statewide: true,
    layerUrl: "https://gis.ne.gov/Enterprise/rest/services/StatewideParcelsExternal/FeatureServer/0",
  },
  nh_statewide: {
    // Verify: live — nhgeodata.unh.edu is blocked in this build environment; measured from the
    // owner's own browser 2026-09-08. ⛔ LAYER 1 ("Parcels"), NOT 0 ("Parcel Points" — POINT
    // geometry, unusable for the app's polygon click routing). No owner, no value fields.
    state: "NH", center: [43.7, -71.6], zoom: 8, mapServer: null, statewide: true,
    layerUrl: "https://nhgeodata.unh.edu/nhgeodata/rest/services/CAD/ParcelMosaic/MapServer/1",
  },
  nj_statewide: {
    // Verify: live — maps.nj.gov is blocked in this build environment. Owner-name values are
    // reported redacted for many records under NJ's Daniel's Law privacy statute.
    state: "NJ", center: [40.1, -74.7], zoom: 8, mapServer: null, statewide: true,
    layerUrl: "https://maps.nj.gov/arcgis/rest/services/Framework/Cadastral/MapServer/0",
  },
  /* B1455632 (2026-09-10) — NEVADA, corrected. The prior finding declined Nevada on a LEGAL basis
   * (the state demographer/DCNR mosaic is restricted from public redistribution under NRS 250) —
   * that verdict stands for THAT layer, and is a different service from this one. This is a
   * SEPARATE, previously-unfound candidate published by the Nevada DIVISION OF WATER RESOURCES —
   * every earlier search targeted the state GIS office and its own demographer's org, which is
   * exactly why a water-agency-published statewide parcel mosaic was missed. No public-record
   * restriction is stated on this item; MEASURED FROM THE OWNER'S OWN BROWSER 2026-09-09/10 —
   * arcgis.water.nv.gov is a Nevada .gov host this build environment's egress policy blocks (same
   * signature as every other Verify:live state here). Fields: APN, County, SiteCity, Acres,
   * SourceDate, Website. `Website` is a per-parcel deep link to that county assessor's own record —
   * no other wired source carries this field; surfaced as a clickable "View record ↗" row
   * (`appraisal.js`'s "County record" field mapping + `ParcelInfoCard.jsx`'s link-value row). Clark
   * and Washoe counties' own per-county layers are therefore superseded by this statewide layer and
   * are deliberately NOT wired separately (`countiesProvenance.js`).
   *
   * ⛔ B1455632 (2026-09-11) — THE ORIGINAL `County_Parcels_in_Nevada` SERVICE WENT EMPTY AND WAS
   * SWAPPED FOR ITS SIBLING. The service above was healthy at 8:50 PM Central on 2026-09-10 (the
   * 1,394,188-feature count and the five-point spread verified at that time) and by 10:57 PM the
   * SAME service was reporting zero layers, with `/0` answering "404 Layer not found" — not a
   * throttle (an earlier note here blamed rate-limiting after heavy testing; that explanation is
   * RETRACTED — a throttle cannot empty a service's own layer list). The state republished the same
   * data one service name over, on the same `arcgis.water.nv.gov` host, and left the old service
   * name as an empty shell: `BaseLayers/County_Parcels_In_Nevada_Yellow/MapServer/0` ("County
   * Parcels Yellow"), re-verified 2026-09-11 morning Central — 1,394,188 features (IDENTICAL to the
   * pre-outage count), esriGeometryPolygon, maxRecordCount 2000, capabilities "Map,Query,Data", same
   * field list. Five spread probes confirmed real parcels: Las Vegas 132ms (APN 16217899002, Clark),
   * Reno 203ms (APN 1105125, 0.495 ac, Washoe), Elko 147ms (APN 006090, 1.111 ac, Elko), Carson City
   * 103ms (APN 420301, 3.920 ac, Carson City), Pahrump 178ms (APN 3529121, 8.129 ac, Nye).
   * ⛔ WIRING NOTE: this service REJECTS `resultRecordCount` outright with "Pagination is not
   * supported" — it accepts `returnCountOnly`. Nothing in this app's own query paths sends
   * `resultRecordCount` against a `COUNTIES_MAP` entry (point identify is a plain intersect query;
   * esri-leaflet's display FeatureLayer only sends `resultOffset`/`resultRecordCount` when
   * `fetchAllFeatures` is set, which this layer's config does not set) — confirmed against the
   * vendored esri-leaflet 3.0.12 source before relying on it. Any NEW query built against this URL
   * (a probe, a discovery/health-sweep script, a future feature) must not add one either.
   * Verify: live — arcgis.water.nv.gov is blocked in this sandbox. */
  nv_statewide: {
    state: "NV", center: [39.5, -117.0], zoom: 7, mapServer: null, statewide: true,
    layerUrl: "https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_In_Nevada_Yellow/MapServer/0",
  },
  ny_statewide: {
    // The publicly-cited host (gisservices.its.ny.gov) is blocked here — this wires NY's OWN
    // official ArcGIS Online mirror (org account NYSGIS_GPO, not a third party) instead, the
    // same "prefer the reliable AGOL copy" call this file already made for Fort Bend (FBCAD).
    // Covers the counties+NYC that opted in; a companion Footprint layer (not wired) names which.
    state: "NY", center: [42.9, -75.5], zoom: 6, mapServer: null, statewide: true,
    layerUrl: "https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1",
  },
  oh_statewide: {
    // Owner name and appraised value are deliberately absent from this privacy-scrubbed public
    // view (a MailAddressAll field exists as a mailing-address proxy).
    state: "OH", center: [40.4, -82.8], zoom: 7, mapServer: null, statewide: true,
    layerUrl: "https://services2.arcgis.com/MlJ0G8iWUyC7jAmu/arcgis/rest/services/OhioStatewidePacels_full_view/FeatureServer/0",
  },
  ri_statewide: {
    // Verify: live — risegis.ri.gov is a state `.gov` host this build environment's egress
    // allowlist blocks (confirmed: the CONNECT tunnel never opens). MEASURED FROM THE OWNER'S OWN
    // BROWSER 2026-09-08, never this sandbox: "Tax Parcels", polygon, 394,167 parcels, published
    // by RIGIS_ADMIN — the Rhode Island state GIS clearinghouse ITSELF, not a town and not a
    // third-party rehost. Fields: PlatLot (Rhode Island's own parcel identifier — RI abolished
    // county government in 1842 and each of its 39 towns keys parcels by plat + lot), Acres, E911
    // and E911_Type (address), TownCode, IMP_sqft, Last_UPD. NO owner, NO appraised value — both
    // absent, never zero or blank.
    state: "RI", center: [41.68, -71.55], zoom: 10, mapServer: null, statewide: true,
    layerUrl: "https://risegis.ri.gov/hosting/rest/services/RIDEM/Tax_Parcels/MapServer/0",
  },
  tn_statewide: {
    // Covers 86 of 95 counties (9 use non-state assessment systems and are excluded).
    state: "TN", center: [35.9, -86.4], zoom: 7, mapServer: null, statewide: true,
    layerUrl: "https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0",
  },
  ut_statewide: {
    // Attribute-light by design: id + situs only. Owner/value need the per-county CAMA system.
    state: "UT", center: [39.4, -111.7], zoom: 6, mapServer: null, statewide: true,
    layerUrl: "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0",
  },
  /* NEW-1 (2026-09-08, continuing B1332016/B1345824) — Virginia and West Virginia were declined
   * in B1345824 round 1 on "the only reachable copy is a third-party rehost" reasoning that was
   * WRONG: it traced to this sandbox never being able to reach either state's own official host at
   * all (both sit on a `.gov`-class domain the egress allowlist blocks), not to the official host
   * being genuinely unreachable from a real browser. Measured live from the owner's OWN browser
   * 2026-09-08 — a real, unrestricted network, never this sandbox — both official hosts answer.
   * Same evidence bar as the HI/MD/NE/NH continuation above: their per-entry comments below name
   * the blocked host and the exact live-measured field list. */
  va_statewide: {
    // Verify: live — vginmaps.vdem.virginia.gov is blocked in this build environment; measured
    // from the owner's own browser 2026-09-08. This IS VGIN's own official host — not a
    // third-party rehost, correcting B1345824 round 1's declined finding. Attribute-light BY
    // DESIGN: 9 fields (PARCELID, VGIN_QPID, FIPS, LOCALITY, LASTUPDATE, PTM_ID, OBJECTID,
    // Shape__Area, Shape__Length) — no owner, no value, no acreage field (only Shape__Area),
    // the same standing this file already gives Hawaii's and New Hampshire's thin schemas.
    state: "VA", center: [37.5, -78.7], zoom: 7, mapServer: null, statewide: true,
    layerUrl: "https://vginmaps.vdem.virginia.gov/arcgis/rest/services/VA_Base_Layers/VA_Parcels/FeatureServer/0",
  },
  vt_statewide: {
    state: "VT", center: [44.0, -72.7], zoom: 8, mapServer: null, statewide: true,
    layerUrl: "https://services.arcgis.com/XG15cJAlne2vxtgt/ArcGIS/rest/services/VT_Parcel/FeatureServer/665",
  },
  wi_statewide: {
    state: "WI", center: [44.6, -89.9], zoom: 6, mapServer: null, statewide: true,
    layerUrl: "https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0",
  },
  wv_statewide: {
    // Verify: live — services.wvgis.wvu.edu is blocked in this build environment; measured from
    // the owner's own browser 2026-09-08. This IS the WV GIS Technical Center's own official
    // host — not a third-party rehost, correcting B1345824 round 1's declined finding, same as
    // Virginia above. "WVParcels", 21 fields: CleanParcelID, FullOwnerName, OWNER1, OWNER2,
    // FullPhysicalAddress, CALC_ACRE, COUNTY, Map, Parcel, Dist, CountyID. No appraised-value
    // field on this layer — left absent, never zero or a blank string. ⛔ LAYER 0 is the
    // parcels; sibling layers on the same service are 1 (Districts) and 5 (Site Address Points).
    state: "WV", center: [38.6, -80.6], zoom: 7, mapServer: null, statewide: true,
    layerUrl: "https://services.wvgis.wvu.edu/arcgis/rest/services/Planning_Cadastre/WV_Parcels/MapServer/0",
  },
  wy_statewide: {
    state: "WY", center: [43.0, -107.6], zoom: 6, mapServer: null, statewide: true,
    layerUrl: "https://services3.arcgis.com/r0iJ85SKZ4zAzz3P/arcgis/rest/services/Wyoming_Parcels_for_2026/FeatureServer/0",
  },

  /* ═══ B1455633 — IDAHO'S 13 PARTICIPATING COUNTIES ══════════════════════════════════════════
   * bboxes are generous estimates from public county geography (padded — a coarse click
   * PRE-FILTER, never authoritative, same convention as every bbox in this file). Not statewide:
   * a click in any of Idaho's other 31 counties must find NO source here, never a silent zero —
   * these bboxes are deliberately NOT unioned into one Idaho-wide fallback. `scopeWhere` matches
   * the COUNTIES_RAW entry above so the shared-URL exemption in `sharedLayerUrlConflicts()` (every
   * sharer of a non-statewide URL must carry its own distinct scope) holds for the map registry too. */
  id_ada: { state: "ID", center: [43.6150, -116.2023], zoom: 11, bbox: [43.25, -116.65, 43.85, -115.75], mapServer: null, layerUrl: COUNTIES.id_ada.layerUrl, scopeWhere: "County='Ada'" },
  id_bearlake: { state: "ID", center: [42.2266, -111.4001], zoom: 10, bbox: [41.95, -111.65, 42.70, -111.00], mapServer: null, layerUrl: COUNTIES.id_bearlake.layerUrl, scopeWhere: "County='Bear Lake'" },
  id_boise: { state: "ID", center: [43.8285, -115.8317], zoom: 10, bbox: [43.70, -116.40, 44.40, -115.10], mapServer: null, layerUrl: COUNTIES.id_boise.layerUrl, scopeWhere: "County='Boise'" },
  id_camas: { state: "ID", center: [43.3457, -114.7358], zoom: 10, bbox: [43.15, -115.40, 43.85, -114.60], mapServer: null, layerUrl: COUNTIES.id_camas.layerUrl, scopeWhere: "County='Camas'" },
  id_gooding: { state: "ID", center: [42.9383, -114.7133], zoom: 10, bbox: [42.70, -115.15, 43.35, -114.30], mapServer: null, layerUrl: COUNTIES.id_gooding.layerUrl, scopeWhere: "County='Gooding'" },
  id_jerome: { state: "ID", center: [42.7241, -114.5178], zoom: 10, bbox: [42.40, -114.60, 43.00, -113.90], mapServer: null, layerUrl: COUNTIES.id_jerome.layerUrl, scopeWhere: "County='Jerome'" },
  id_lincoln: { state: "ID", center: [42.9366, -114.4041], zoom: 10, bbox: [42.70, -114.40, 43.40, -113.50], mapServer: null, layerUrl: COUNTIES.id_lincoln.layerUrl, scopeWhere: "County='Lincoln'" },
  id_minidoka: { state: "ID", center: [42.6169, -113.6772], zoom: 10, bbox: [42.30, -113.95, 43.00, -113.05], mapServer: null, layerUrl: COUNTIES.id_minidoka.layerUrl, scopeWhere: "County='Minidoka'" },
  id_nezperce: { state: "ID", center: [46.4165, -117.0177], zoom: 10, bbox: [46.00, -117.10, 46.70, -116.30], mapServer: null, layerUrl: COUNTIES.id_nezperce.layerUrl, scopeWhere: "County='Nez Perce'" },
  id_oneida: { state: "ID", center: [42.1913, -112.2502], zoom: 10, bbox: [41.95, -113.10, 42.60, -112.00], mapServer: null, layerUrl: COUNTIES.id_oneida.layerUrl, scopeWhere: "County='Oneida'" },
  id_teton: { state: "ID", center: [43.7229, -111.1108], zoom: 10, bbox: [43.65, -111.55, 44.20, -110.90], mapServer: null, layerUrl: COUNTIES.id_teton.layerUrl, scopeWhere: "County='Teton'" },
  id_valley: { state: "ID", center: [44.5163, -116.0410], zoom: 9, bbox: [44.30, -116.25, 45.35, -115.05], mapServer: null, layerUrl: COUNTIES.id_valley.layerUrl, scopeWhere: "County='Valley'" },
  id_washington: { state: "ID", center: [44.2513, -116.9693], zoom: 10, bbox: [44.05, -117.10, 44.85, -116.30], mapServer: null, layerUrl: COUNTIES.id_washington.layerUrl, scopeWhere: "County='Washington'" },

  /* ═══ B1455634 — 21 MEASURED COUNTY ENDPOINTS (Hinds MS excluded — see COUNTIES_RAW above) ═══
   * bboxes are generous estimates from public county geography — a coarse click pre-filter only. */
  il_cook: { state: "IL", center: [41.8781, -87.6298], zoom: 10, bbox: [41.47, -88.30, 42.15, -87.35], mapServer: null, layerUrl: COUNTIES.il_cook.layerUrl },
  il_dupage: { state: "IL", center: [41.8661, -88.0834], zoom: 11, bbox: [41.70, -88.30, 42.05, -87.85], mapServer: null, layerUrl: COUNTIES.il_dupage.layerUrl },
  il_will: { state: "IL", center: [41.5250, -88.0817], zoom: 10, bbox: [41.20, -88.30, 41.72, -87.52], mapServer: null, layerUrl: COUNTIES.il_will.layerUrl },
  pa_allegheny: { state: "PA", center: [40.4406, -79.9959], zoom: 10, bbox: [40.15, -80.35, 40.65, -79.65], mapServer: null, layerUrl: COUNTIES.pa_allegheny.layerUrl },
  pa_northampton: { state: "PA", center: [40.6884, -75.2107], zoom: 10, bbox: [40.60, -75.55, 40.95, -75.05], mapServer: null, layerUrl: COUNTIES.pa_northampton.layerUrl },
  pa_cumberland: { state: "PA", center: [40.2010, -77.1997], zoom: 10, bbox: [39.95, -77.60, 40.35, -76.85], mapServer: null, layerUrl: COUNTIES.pa_cumberland.layerUrl },
  ga_gwinnett: { state: "GA", center: [33.9562, -83.9880], zoom: 10, bbox: [33.79, -84.20, 34.06, -83.68], mapServer: null, layerUrl: COUNTIES.ga_gwinnett.layerUrl },
  mi_oakland: { state: "MI", center: [42.6389, -83.2910], zoom: 10, bbox: [42.35, -83.70, 42.90, -83.00], mapServer: null, layerUrl: COUNTIES.mi_oakland.layerUrl },
  ks_wyandotte: { state: "KS", center: [39.1141, -94.6275], zoom: 11, bbox: [39.02, -94.95, 39.20, -94.55], mapServer: null, layerUrl: COUNTIES.ks_wyandotte.layerUrl },
  mo_platte: { state: "MO", center: [39.3595, -94.7803], zoom: 10, bbox: [39.15, -95.05, 39.50, -94.55], mapServer: null, layerUrl: COUNTIES.mo_platte.layerUrl },
  or_multnomah: { state: "OR", center: [45.5152, -122.6784], zoom: 10, bbox: [45.40, -123.20, 45.65, -122.35], mapServer: null, layerUrl: COUNTIES.or_multnomah.layerUrl },
  or_clackamas: { state: "OR", center: [45.3573, -122.6068], zoom: 9, bbox: [44.95, -122.85, 45.55, -121.75], mapServer: null, layerUrl: COUNTIES.or_clackamas.layerUrl },
  ky_jefferson: { state: "KY", center: [38.2527, -85.7585], zoom: 10, bbox: [38.05, -85.95, 38.40, -85.45], mapServer: null, layerUrl: COUNTIES.ky_jefferson.layerUrl },
  ms_desoto: { state: "MS", center: [34.8259, -89.9926], zoom: 10, bbox: [34.62, -90.18, 35.00, -89.65], mapServer: null, layerUrl: COUNTIES.ms_desoto.layerUrl },
  ok_oklahoma: { state: "OK", center: [35.4676, -97.5164], zoom: 10, bbox: [35.20, -97.83, 35.65, -97.20], mapServer: null, layerUrl: COUNTIES.ok_oklahoma.layerUrl },
  ok_tulsa: { state: "OK", center: [36.1540, -95.9928], zoom: 10, bbox: [35.95, -96.20, 36.35, -95.70], mapServer: null, layerUrl: COUNTIES.ok_tulsa.layerUrl },
  la_eastbatonrouge: { state: "LA", center: [30.4515, -91.1871], zoom: 10, bbox: [30.30, -91.35, 30.70, -90.85], mapServer: null, layerUrl: COUNTIES.la_eastbatonrouge.layerUrl },
  // B1574256 — center/bbox read directly from public/geo/county-polygons.json (the same nationwide
  // asset resolveCounty uses, same convention as the B1551617/B1339920 rows below), never
  // hand-typed: raw extent [-180269,59766,-179299,60327] at scale 2000, rounded to 2 dp.
  la_orleans: { state: "LA", center: [30.0233, -89.8920], zoom: 11, bbox: [29.88, -90.13, 30.16, -89.65], mapServer: null, layerUrl: COUNTIES.la_orleans.layerUrl },
  al_jefferson: { state: "AL", center: [33.5207, -86.8025], zoom: 10, bbox: [33.25, -87.15, 33.80, -86.45], mapServer: null, layerUrl: COUNTIES.al_jefferson.layerUrl },
  // B1551617 — Tier 1 counties (see the matching COUNTIES block above); bbox/center read directly
  // from public/geo/county-polygons.json (the same nationwide asset resolveCounty uses), never
  // hand-typed.
  ga_fulton: { state: "GA", center: [33.8453, -84.4772], zoom: 10, bbox: [33.50, -84.84, 34.19, -84.12], mapServer: null, layerUrl: COUNTIES.ga_fulton.layerUrl },
  ga_chatham: { state: "GA", center: [31.9823, -81.1400], zoom: 10, bbox: [31.73, -81.39, 32.24, -80.89], mapServer: null, layerUrl: COUNTIES.ga_chatham.layerUrl },
  az_pinal: { state: "AZ", center: [32.9940, -111.3275], zoom: 9, bbox: [32.51, -112.21, 33.48, -110.45], mapServer: null, layerUrl: COUNTIES.az_pinal.layerUrl },
  // B1339920 — bbox/center read directly from public/geo/county-polygons.json (same convention as
  // the B1551617 Tier 1 rows above), never hand-typed: [-226663,65023,-222085,68098] / scale 2000.
  az_maricopa: { state: "AZ", center: [33.2803, -112.1870], zoom: 8, bbox: [32.51, -113.33, 34.05, -111.04], mapServer: null, layerUrl: COUNTIES.az_maricopa.layerUrl },
  mo_clay: { state: "MO", center: [39.2843, -94.4153], zoom: 10, bbox: [39.11, -94.61, 39.46, -94.22], mapServer: null, layerUrl: COUNTIES.mo_clay.layerUrl },
  sc_greenville: { state: "SC", center: [34.8448, -82.4562], zoom: 10, bbox: [34.48, -82.77, 35.21, -82.14], mapServer: null, layerUrl: COUNTIES.sc_greenville.layerUrl },
  ia_polk: { state: "IA", center: [41.6782, -93.5747], zoom: 10, bbox: [41.49, -93.82, 41.86, -93.33], mapServer: null, layerUrl: COUNTIES.ia_polk.layerUrl },
  pa_lehigh: { state: "PA", center: [40.6038, -75.6195], zoom: 10, bbox: [40.42, -75.89, 40.79, -75.34], mapServer: null, layerUrl: COUNTIES.pa_lehigh.layerUrl },
  nm_bernalillo: { state: "NM", center: [35.0490, -106.6593], zoom: 10, bbox: [34.87, -107.18, 35.23, -106.14], mapServer: null, layerUrl: COUNTIES.nm_bernalillo.layerUrl },
  il_kane: { state: "IL", center: [41.9385, -88.4257], zoom: 10, bbox: [41.72, -88.61, 42.16, -88.24], mapServer: null, layerUrl: COUNTIES.il_kane.layerUrl },

  /* B1583296 — city-scoped, not a county. `bbox` is Detroit's own extent (matches cityScopes.js's
   * CITY_SCOPES bbox exactly — coarse pre-filter only, the ring geometry there decides). `cityScoped:
   * true` is REQUIRED on every entry a city scope resolves to: it is what keeps this key out of
   * candidateCountiesForPoint's blind per-state fallback (a point elsewhere in Michigan with no
   * bbox/geometry match must never be handed a source that can only ever answer inside Detroit) —
   * see that function's own comment. Test-guarded in test/cityScopes.test.js. */
  mi_detroit: {
    state: "MI", center: [42.35, -83.07], zoom: 11,
    bbox: [42.2550, -83.2877, 42.4504, -82.9103],
    cityScoped: true,
    mapServer: null, layerUrl: COUNTIES.mi_detroit.layerUrl,
  },
};

// Which configured CAD county/counties could contain a clicked point — used to
// route a parcel identify WITHOUT making the user pre-pick a county. Returns the
// county keys whose padded bbox contains the point (border overlaps mean a
// straddle click yields both, so the caller can query both and merge), with any
// STATEWIDE parcel source (TxGIO) appended LAST as a universal fallback.
//
// Why the statewide fallback (B130): the TxGIO layer paints parcel OUTLINES across
// every Texas county (it backs the visible lines wherever a county's own CAD is
// down or unconfigured). Querying it only inside its own bbox meant a click could
// see an outline it couldn't select — e.g. a Fort Bend lot showed a TxGIO outline,
// but the click queried only Harris (empty) + FBCAD (host down) and reported "no
// parcel right there." Making the statewide layer queryable everywhere keeps the
// hit-test aligned with what's drawn. It's appended AFTER the bbox matches so a
// county's own CAD still answers first (more authoritative, richer fields) and the
// statewide layer only catches clicks the county CAD didn't; the answering county
// is then corrected via `countyAtPoint` (B36a).
//
// NOTE on the first element: a second caller (MapFinder's Layers-panel jurisdiction
// resolver) reads candidate[0]. The out-of-bbox branch below therefore returns ALL
// counties in config order (harris first) — byte-identical to the pre-B130 fallback
// — so that default still lands on Harris when the view is away from every county;
// the statewide source is among them, so a click still gets its coverage there too.
// The statewide append only AUGMENTS the in-bbox case (where Fort Bend lives — it
// matches harris+fortbend but not the chambers bbox), so candidate[0] is unchanged.
/* NEW-5 — which state a point is in, for the out-of-every-county-bbox branch below. ONE definition,
 * shared with the Colorado capability guard (`siteRegion.js`) rather than a second copy here: two
 * envelopes that could drift apart would mean click routing and the guard disagreeing about what
 * state a site is in, which is precisely the failure this work exists to prevent.
 *
 * ⛔ TX/CO-ONLY — kept ONLY as the pre-geometry fallback `resolvedState` below uses while the
 * nationwide county-polygon asset hasn't landed yet. Do not call this directly from click routing
 * again (B1457152) — see that function's header for why. */
const stateForPoint = (lat, lng) => siteState({ lat, lng });

/* B209502 — the GEOMETRY answer for a point: `{ key, nearEdge }` for a county Planyr has a source
 * for, else null. `nearEdge` is B209502's own uncertainty flag (true within ~150 m of the resolved
 * county's line) so a caller can tell "the polygon is confident" from "the polygon picked a side,
 * but only barely"; `geometryCountyKey` is the key-only shorthand `countyForView` uses.
 *
 * ⛔ B1597232 — DERIVED FROM `countyIdentity`, NOT A SECOND COPY OF IT. This used to re-run the
 * city-scope test, `resolveCounty` and `countyKeyForName` itself — the same three steps
 * `countyIdentity` (below) already performs, reaching the same answer by the same route. Two
 * implementations of one question is the shape `docs/DATA.md` bans, and the duplication is what let
 * the two DIVERGE in the way that mattered: `countyIdentity` distinguishes "no county resolved"
 * from "a real county resolved and Planyr has NO source for it", and this function flattened both
 * to the same `null`. `candidateCountiesForPoint` therefore could not tell a genuine unknown from a
 * known gap, and treated the gap as licence to fall back to a neighbouring county's service — the
 * Wayne→Oakland defect its own comment now records. There is ONE resolver; this is its projection,
 * so click routing and the jurisdiction heading cannot disagree about which county a point is in
 * (two envelopes that could drift apart is precisely the failure NEW-5 already fought). */
function geometryCountyAnswer(lat, lng) {
  const id = countyIdentity(lat, lng);
  return id.status === "ok" ? { key: id.key, nearEdge: !!id.nearEdge } : null;
}
function geometryCountyKey(lat, lng) {
  const a = geometryCountyAnswer(lat, lng);
  return a ? a.key : null;
}

/* ⛔ B1457152 — WHICH STATE A POINT IS IN, ANSWERED BY THE SAME NATIONWIDE GEOMETRY, NOT THE
 * TX/CO-ONLY ENVELOPE. Read before touching `candidateCountiesForPoint`'s no-bbox-match branch.
 *
 * `stateForPoint` above only knows two rectangles (Texas, Colorado) — a relic of the app's first
 * two states. Every OTHER wired state (Nevada, DC, Maine, California, …) has ONLY a statewide
 * pseudo-county with no `bbox` at all (see the `_statewide` entries above), so a click there always
 * missed `within` AND `stateForPoint`, and fell to `candidateCountiesForPoint`'s last-resort branch.
 * That branch used to return literally EVERY configured source in the country for such a click — a
 * Las Vegas point fired 67+ `/query` requests, one per county from Harris to Connecticut, because
 * the routing code could not tell Nevada from nowhere (measured live 2026-09-10, B1457152/B1457153).
 *
 * The fix is to ask the SAME nationwide county-polygon asset `geometryCountyKey` already reads
 * (B209502, `public/geo/county-polygons.json` — every US county, not just TX/CO) for the point's
 * real state, independent of whether a specific per-county entry is configured for it — a
 * purely-statewide state like Nevada has no per-county row to hoist, but its `state` field on the
 * resolved county answer is still real and lets `candidateCountiesForPoint` narrow to just that
 * state's configured source(s) instead of guessing every state's. Falls back to the coarse TX/CO
 * envelope only while the asset has not landed yet (`resolveCounty` reports `pending`), so the very
 * first click after a cold boot still narrows to something real whenever it honestly can — and,
 * exactly as before, an unresolved point returns no candidates rather than every candidate (see the
 * call site's own comment for why "no candidates" is the safe answer, never "all of them"). */
function resolvedState(lat, lng) {
  const ans = resolveCounty(lat, lng);
  if (ans && ans.status === "ok" && ans.state) return ans.state;
  return stateForPoint(lat, lng);
}

/* NEW-1 — could the map's CURRENT VIEW plausibly reach this county's live parcel source at all?
 * A parcel-source-down notice naming a county the viewport is nowhere near is a confident, useless
 * answer — reported live: panned to Texarkana (Bowie County, far NE Texas) and told "Chambers
 * County's live parcel server is unavailable", Chambers being a Gulf Coast county ~300 miles away.
 * `MapFinder`'s outage banners (the hang-guard's `markDown` and its snapshot-swap twin) are keyed
 * to whichever county's DISPLAY LAYER happened to fail, with no check that the county is anywhere
 * near what's on screen — a real county layer stays mounted (and can therefore still time out)
 * however far the user has since panned, because every configured county's outline is loaded at
 * once in select mode (`Object.keys(layerUrlsRef.current).forEach(addDisplay)`).
 *
 * Pure axis-aligned overlap between the viewport bounds and the county's own `bbox` — the exact
 * same coarse screen `candidateCountiesForPoint` uses for click routing, just asked from the other
 * side (does the county reach the view, not does the view contain a point). The bbox is already
 * padded for border straddles (see COUNTIES_MAP_RAW's header), so this needs no extra margin. A
 * county with no bbox (never true for a real, addressable county — only the `statewide` composites
 * lack one, and they're never the ones named in a "such-and-such COUNTY" banner) stays plausible
 * rather than risk silencing a real notice over a data gap. `bounds` is a plain
 * `{south, west, north, east}` (Leaflet's LatLngBounds shape, kept out of this module on purpose —
 * pure/Node-testable, no Leaflet import). */
export function countyBboxIntersectsView(key, bounds) {
  const b = COUNTIES_MAP[key] && COUNTIES_MAP[key].bbox;
  if (!b || !bounds) return true;
  const [minLat, minLng, maxLat, maxLng] = b;
  return minLat <= bounds.north && maxLat >= bounds.south && minLng <= bounds.east && maxLng >= bounds.west;
}

export function candidateCountiesForPoint(lat, lng) {
  const entries = Object.entries(COUNTIES_MAP);
  const within = entries
    .filter(([, c]) => { const b = c.bbox; return b && lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3]; })
    .map(([k]) => k);

  /* B209502 — THE BBOX NARROWS, THE GEOMETRY DECIDES.
   *
   * The bbox pre-filter stays exactly as it was, and it is still the right tool for its real job:
   * deciding which parcel SERVICES are worth asking. Over-inclusion there is harmless — a
   * straddle click queries both neighbours and the service that returns a lot is the source of
   * truth — which is why this function keeps returning several keys.
   *
   * What was NOT harmless is the ORDER. `candidate[0]` is read as an answer to a different
   * question ("which county is this?"), and a rectangle answered it: Harris's box contains
   * Pearland, so a Brazoria site was handed Harris's flood-control district, detention criteria
   * and setbacks as a confident match. So when the polygon geometry knows the answer, the real
   * county is hoisted to the front and everything else stays behind it as a fallback. When the
   * geometry is not resident yet, the order is byte-identical to before — no guess is introduced,
   * the old behaviour simply persists until the asset lands. */
  /* B1597232 — ONE resolution, asked once. `countyIdentity` is the single answer function for "which
   * county is this point in, and does Planyr have a source for it"; `truthAns` is its key-only
   * projection (exactly what `geometryCountyAnswer` returns), read from the SAME call so the two
   * questions this function asks of the geometry can never be answered by two different resolves. */
  const identity = countyIdentity(lat, lng);
  const truthAns = identity.status === "ok" ? { key: identity.key, nearEdge: !!identity.nearEdge } : null;
  const truth = truthAns ? truthAns.key : null;
  const hoist = (keys) => (truth && keys.includes(truth) ? [truth, ...keys.filter((k) => k !== truth)] : keys);
  /* The statewide composite(s) that legitimately cover one state. A composite is coverage-of-last-
   * resort for EVERY county in its state (TxGIO paints all 254 Texas counties; `nv_statewide` is
   * Nevada's only parcel source at all), so it is never narrowed away by a county-level answer —
   * unlike a rival county's CAD, which can only ever answer inside its own lines. */
  const statewideFor = (st) => entries.filter(([, c]) => c.statewide && (!c.state || c.state === st)).map(([k]) => k);

  /* ⛔ B1597232 — A COUNTY PLANYR KNOWS, AND KNOWS IT HAS NO SOURCE FOR, IS AN ANSWER — NOT A GAP TO
   * PAPER OVER WITH THE NEAREST NEIGHBOUR THAT HAPPENS TO BE WIRED.
   *
   * MEASURED LIVE 2026-09-12 on the owner's own browser, twice: "23555 Goddard Rd, Taylor, MI"
   * (-83.263421, 42.224770) and "33000 Civic Center Dr, Livonia, MI" (-83.368074, 42.396293) are
   * both squarely in WAYNE County, and the only parcel query either fired went to OAKLAND County's
   * service. Oakland's southern line is 8 Mile Road, ~42.44°N; Taylor sits about fifteen miles
   * south of it. This was never a boundary-precision problem — it is the resolver treating "I know
   * the county and it has no source" as indistinguishable from "I don't know the county."
   *
   * THE TWO PATHS IT ARRIVED BY, because they look unrelated and are one cause:
   *   · TAYLOR matched NO bbox, so it fell to the blind per-state fallback below — "return every
   *     source in Michigan" — and Michigan's only county source is Oakland's.
   *   · LIVONIA DID match a bbox: Oakland's padded box reaches down to 42.35°N and Livonia is at
   *     42.396°N, so `within` was `[mi_oakland]`. The geometry knew it was Wayne, but Wayne has no
   *     configured key, so `truth` came back null — and with no truth there is nothing to hoist and
   *     nothing for NEW-6's confident-narrow to narrow to. The wrong county was the only candidate.
   * Neither path is reachable from the other, which is why a fix at either one alone would have
   * closed exactly half of a two-line bug report. The cause they share is upstream of both: the old
   * `geometryCountyAnswer` flattened "no county resolved" and "a real county resolved, with no
   * source" to the same `null`. `countyIdentity` has always distinguished them — it is what powers
   * the honest "Wayne County — no parcel data wired here yet" message the callers already show —
   * and reading it here is the whole fix.
   *
   * WHY THIS IS NOT NEW-6 AGAIN, in one line: NEW-6 narrows to the resolved county's own source
   * when it HAS one (Casa Grande → az_pinal alone). This is the case where it has none, which NEW-6
   * could not express, because it selects among candidates and the right answer here is no
   * candidate. Same class as the Pinal/Maricopa defect, opposite branch.
   *
   * `nearEdge` gates it exactly as it gates NEW-6: within ~150 m of the line the simplified polygon
   * is only picking a side, so a wired neighbour may genuinely own the point and the old
   * multi-candidate behaviour is kept. Statewide composites are never dropped — a point in an
   * unwired county of a state that HAS one (Clark County NV, Franklin County OH) is fully covered
   * by it, and those two keep returning exactly `["nv_statewide"]` / `["oh_statewide"]`. Michigan
   * has no composite, so Taylor and Livonia correctly return NOTHING — and `noParcelSourceNote`
   * turns that into the county-naming sentence at every call site. */
  if (identity.status === "no-source" && !identity.nearEdge) return statewideFor(identity.state);

  if (!within.length) {
    /* The geometry may know the county even when no bbox matched — Conroe and Texas City are
     * exactly that case. A configured county resolved here is a REAL answer, not a fallback, so
     * it leads and the rest of its state follows as coverage. */
    if (truth) {
      const st = COUNTIES_MAP[truth].state;
      /* ⛔ B1597232 — NEW-6's CONFIDENT NARROW APPLIES HERE TOO. Below, a confident geometry answer
       * makes the resolved county the ONLY real-CAD candidate; this branch never got the same
       * treatment, so it still answered a confidently-resolved point with every county in the
       * state. Measured on the same build as the Wayne report: one Huntsville, TX point (Walker
       * County, resolved confidently) returned TEN candidates — harris, fortbend, chambers, waller,
       * montgomery, brazoria, galveston, liberty, austintx and TxGIO — i.e. nine neighbouring
       * counties' CADs queried for a lot none of them can hold. Same rule, same `nearEdge` gate,
       * same reason: a neighbour's CAD cannot answer for this county, so asking it is cost without
       * coverage. The statewide composite still rides along, because it genuinely can answer.
       *
       * The one wrinkle is a county PARKED ON its state's composite — every statewide-derived Texas
       * county, and Waller. Its key and the composite key resolve to the SAME endpoint, so
       * returning both queries one URL twice under two names; the composite key is the one that is
       * never dropped by the circuit breaker (`filterHealthyCandidates`' `alwaysKeep`) and the one
       * `isStatewideBackup` reasons about, so it is the one kept. `scopeWhere` is not lost by this:
       * it applies only to TEXT search, never to a point identify (see MapFinder's own note). */
      const composites = statewideFor(st).filter((k) => k !== truth);
      if (truthAns && !truthAns.nearEdge && !COUNTIES_MAP[truth].statewide) {
        const parkedOnComposite = composites.length > 0 && isStatewideLayerUrl(COUNTIES_MAP[truth].layerUrl);
        return parkedOnComposite ? composites : [truth, ...composites];
      }
      // ⛔ B1583296 — a city-scoped sibling (mi_detroit) rides along here only when it IS the
      // resolved truth; a genuinely different same-state county (found by geometry, missed by
      // every bbox) must never additionally drag in a source that can only answer inside its own
      // city limits — see the per-state-fallback comment below for the shape of the same bug.
      const inState = entries.filter(([k, c]) => c.state === st && (!c.cityScoped || k === truth)).map(([k]) => k);
      return hoist(inState);
    }
    // Outside every county bbox. Pre-Colorado this returned EVERY configured county (harris-first),
    // which was right when every county was in one state. With two states it would hand a Texas
    // click nine Colorado servers to try — and, far worse, hand a COLORADO click `harris` as
    // candidate[0], which the Layers-panel jurisdiction resolver reads. A Colorado site inheriting
    // Harris County is precisely the wrong-but-plausible answer this work exists to prevent.
    // So the fallback is now scoped to the point's STATE, in config order. For a Texas point that
    // is byte-identical to the old list (the Texas keys are first and unchanged).
    //
    // ⛔ B1457152 — THE OLD FINAL FALLBACK ("no state resolved → return every configured county in
    // the country") IS GONE. With only Texas and Colorado wired it was a two-state guess with a
    // bounded blast radius; once every other state started carrying its own statewide source (B1332016
    // onward, now ~30 states and growing — Michael's own 2026-09-10 instruction is to wire every
    // remaining state county-by-county), "return everyone's" turned into "query the whole country for
    // one point" — measured at 67+ `/query` requests, most asking outFields=*/returnGeometry=true, for
    // a single Las Vegas click. `resolvedState` above answers from the SAME nationwide geometry asset
    // `geometryCountyKey` already reads, so a purely-statewide state (Nevada, DC, Maine, California, …)
    // — one with no per-county bbox of its own — now narrows to exactly its own configured source(s)
    // instead of being indistinguishable from "unknown". A point whose state genuinely can't be
    // resolved (the geometry asset hasn't landed yet, or the point is truly outside every US county)
    // now returns NO candidates rather than all of them — `resolveCandidates`/`candidatesAtPoint`
    // already handle an empty list with an honest "still loading, try again" message, and an honest
    // "nothing to try" is a vastly cheaper failure than silently fanning out to every wired state.
    // ⛔ B1583296 — a CITY-SCOPED entry (mi_detroit) must NEVER ride this blind "every source in
    // this state" fallback: unlike a purely-statewide composite (Nevada, DC, Maine, …), a
    // city-scoped source can only ever answer inside its own city limits, and this branch is
    // reached precisely because neither a bbox nor a confident geometry answer matched — i.e. the
    // point is somewhere else in the state. Handing it out here is exactly the "returns nothing
    // from a Detroit-only layer" failure the item that added mi_detroit was written to prevent
    // (verified: Livonia and Taylor, MI — both outside Detroit's bbox and outside Oakland's bbox —
    // must not include mi_detroit here). See cityScopes.js's header for why the flag lives on the
    // entry rather than being re-derived.
    const st = resolvedState(lat, lng);
    return st ? entries.filter(([, c]) => c.state === st && !c.cityScoped).map(([k]) => k) : [];
  }
  /* ⛔ NEW-6 — A CONFIDENT GEOMETRY ANSWER DECIDES *MEMBERSHIP*, NOT JUST ORDER.
   *
   * Two counties' padded bboxes can overlap far more than the counties themselves do — Pinal's
   * bbox is its own measured data extent and reaches well into Maricopa's southern edge, exactly
   * like Sugar Land's harris/fortbend overlap. For a real straddle (a click near the shared line,
   * `nearEdge: true`) that over-inclusion is the whole point: query both neighbours and let
   * whichever service answers own the lot. But a point solidly INSIDE one county — Casa Grande,
   * AZ, 32.8802/-111.7476, ~9 miles from the Pinal/Maricopa line — is not a straddle, and asking
   * BOTH counties' services for it is not "harmless redundancy": nothing guarantees which answers
   * first, so a wrong-county hit is one race condition away (measured live, 2026-09-11 evening —
   * Maricopa's service answered with a real Maricopa parcel for a Pinal address, and only lucked
   * into losing the race). `nearEdge` is exactly the flag B209502 built for this: false means the
   * simplified polygon is not merely picking a side, it is confident. So a confident, non-statewide
   * geometry answer narrows the REAL-CAD candidates to itself alone — every other bbox match is
   * dropped, not just demoted — while a genuine near-edge point (or no geometry yet) keeps the old
   * multi-candidate behaviour untouched. The statewide fallback tier is a different kind of source
   * (coverage-of-last-resort, not a rival county) and is never narrowed by this. */
  const confident = truthAns && !truthAns.nearEdge && COUNTIES_MAP[truthAns.key] && !COUNTIES_MAP[truthAns.key].statewide
    ? truthAns.key
    : null;
  /* The geometry's county leads even when several boxes matched — this is the Sugar Land case,
   * where harris and fortbend both contain the point and config order used to hand it to harris.
   * A geometry answer that is NOT among the bbox matches is still hoisted in front (it is the
   * correct county; the boxes simply do not reach it), with every bbox candidate kept behind it
   * so click coverage is never narrowed by this reorder — UNLESS the answer is confident, in which
   * case it is the only real-CAD candidate returned. */
  const ordered = confident
    ? [confident]
    : (truth && !within.includes(truth) && COUNTIES_MAP[truth] ? [truth, ...within] : hoist(within));
  // Append the STATEWIDE source(s) of the states already in play — never every state's. A Texas
  // click must not carry Colorado's composite along, and vice versa. Derived from `ordered` (not
  // the raw `within` bbox matches) so a confident narrow doesn't drag along a neighbour's state's
  // composite it no longer has a real-CAD candidate in.
  const states = new Set(ordered.map((k) => COUNTIES_MAP[k].state).filter(Boolean));
  const statewide = entries
    .filter(([k, c]) => c.statewide && !ordered.includes(k) && (!c.state || states.size === 0 || states.has(c.state)))
    .map(([k]) => k);
  return [...ordered, ...statewide.filter((k) => !ordered.includes(k))];
}

/* NEW-1 — the JURISDICTION shown for a map POSITION, which is a different question from
 * "which parcel services could answer a click here" and must not be answered by reading
 * `candidateCountiesForPoint(...)[0]`.
 *
 * That first element is deliberately harris-first for any point outside every county bbox
 * (a documented, tested contract — click routing depends on the order). Reading it as a
 * jurisdiction is what made the Layers panel say "Harris County" while the map sat over
 * Phoenix, Atlanta, or the whole continental US — the same hardcoded-Houston class of bug
 * as the landing view itself.
 *
 * The rule here: a real bbox hit wins; when several boxes overlap (they are padded on purpose,
 * so a click near a shared line queries both neighbours) the NEAREST county center wins rather
 * than config order — a point in downtown Denver must read Denver, not whichever neighbour was
 * declared first. With no bbox hit at all, fall back to the nearest configured county WITHIN
 * the point's own state when the point resolves to one, so a Colorado view can never inherit a
 * Texas county. Statewide pseudo-keys are never returned: they are parcel SOURCES, not
 * jurisdictions. Always returns a real key, so the panel always has an answer. Pure. */
export function countyForView(lat, lng) {
  // ⛔ B1583296 — a city-scoped entry (mi_detroit) is excluded from the bbox/nearest-center
  // fallback pool below, not just from the statewide filter. By the time that fallback runs, the
  // `truth` check just below has ALREADY tried the city-scope test and failed it (a real hit
  // returns immediately) — so a city-scoped key can never legitimately be the answer here, and
  // leaving it in `entries` let "nearest configured center, searched nationwide when the point's
  // state can't be resolved" (the very next branch) pick Detroit's center for a real Wayne County
  // city (Taylor, MI) that is provably NOT inside Detroit's own limits.
  const entries = Object.entries(COUNTIES_MAP).filter(([, c]) => !c.statewide && !c.cityScoped);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !entries.length) return "harris";
  /* B209502 — geometry first. The nearest-CENTER rule below is a real improvement on config order
   * but it is still not the county line: Conroe's nearest configured center was WALLER and Texas
   * City's was CHAMBERS, both simply wrong. When the polygon asset is resident and the point falls
   * in a county Planyr has configured, that IS the jurisdiction — no distance heuristic can
   * out-argue containment. Everything below stays as the pre-asset / unconfigured-county path. */
  const truth = geometryCountyKey(lat, lng);
  if (truth && COUNTIES_MAP[truth] && !COUNTIES_MAP[truth].statewide) return truth;
  const within = entries.filter(([, c]) => { const b = c.bbox; return b && lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3]; });
  let search = within;
  if (!search.length) {
    const st = stateForPoint(lat, lng);
    const inState = st ? entries.filter(([, c]) => c.state === st) : [];
    search = inState.length ? inState : entries;
  }
  // Planar squared distance on the county centers, with longitude scaled by cos(lat) so a
  // degree of longitude isn't over-weighted at these latitudes. Screening-grade on purpose:
  // this picks a panel heading, never a parcel.
  const kx = Math.cos((lat * Math.PI) / 180) || 1;
  let bestKey = search[0][0], bestD = Infinity;
  search.forEach(([k, c]) => {
    const ctr = c.center;
    if (!ctr) return;
    const dy = ctr[0] - lat, dx = (ctr[1] - lng) * kx;
    const d = dy * dy + dx * dx;
    if (d < bestD) { bestD = d; bestKey = k; }
  });
  return bestKey;
}

/* B209502 (second half) — NAMING THE WRONG COUNTY IS WORSE THAN ADMITTING A GAP.
 *
 * The bbox resolvers above always returned SOME configured key, because they had to: a rectangle
 * test has no way to express "this is a county I have never heard of". So a click in Walker or
 * Wharton County did not report Walker or Wharton — it reported whichever configured neighbour's
 * rectangle happened to reach, or plain `harris`. That is the same false-confidence failure as
 * Pearland, one level out: the app substituted a neighbour rather than admit a gap.
 *
 * With real geometry the gap is expressible, so this reports it. Returns:
 *
 *   { status: "ok",       key, name, state, nearEdge }   — resolved AND Planyr has a parcel source
 *   { status: "no-source", key: null, name, state }      — resolved, and there is NO parcel source
 *                                                          configured for this county. The NAME is
 *                                                          still correct and must be shown.
 *   { status: "pending" }                                — geometry not resident yet
 *   { status: "outside" }                                — not in a state Planyr covers
 *
 * The caller's contract for `no-source`: say the county, say there is no parcel data there, and do
 * NOT fall back to a neighbouring county's CAD. The statewide composite may still paint and answer
 * a click (it covers all 254 Texas counties) — that is coverage, not a jurisdiction claim, and it
 * reports its own county in its attributes.
 *
 * Pure. */
export function countyIdentity(lat, lng) {
  // City scope first (B1583296) — a point inside Detroit is a real, sourced answer, not a county
  // fallback. Everywhere else in Wayne County (or any other point) falls through unchanged to the
  // county-level answer below, which correctly reports "no-source" where nothing is wired.
  const cs = cityScopeAnswer(lat, lng);
  if (cs) return { status: "ok", key: cs.key, name: cs.name, state: cs.state, nearEdge: cs.nearEdge };
  const ans = resolveCounty(lat, lng);
  if (!ans || ans.status === "pending") return { status: "pending" };
  if (ans.status !== "ok") return { status: "outside" };
  const key = countyKeyForName(ans.name, ans.state);
  if (key && COUNTIES_MAP[key] && !COUNTIES_MAP[key].statewide) {
    return { status: "ok", key, name: ans.name, state: ans.state, nearEdge: !!ans.nearEdge };
  }
  return { status: "no-source", key: null, name: ans.name, state: ans.state, nearEdge: !!ans.nearEdge };
}

/* The owner-facing sentence for a resolved county with no parcel source, or null when there is
 * nothing to say. Kept here beside the resolver so the wording cannot drift from the verdict it
 * describes, and deliberately short (PANEL-BREVITY): the county name is the fact, the absence is
 * the qualifier.
 *
 * B1361425 — the suffix is TX-only, not "every state but Colorado". Texas's own source
 * (`Texas_County_Boundaries`) and Colorado's (`Colorado_Counties`) both publish BARE names
 * ("Harris", "Adams") — TX needs " County" appended, CO's own UI convention appends nothing.
 * Every OTHER state's geometry (the Esri `USA_Counties_Generalized_Boundaries` nationwide layer,
 * B1361425) already carries its own correct designation in the name itself — "Orleans Parish",
 * "Denali Borough", "Fairfax city", "District of Columbia" — so appending " County" there would
 * read "Orleans Parish County". Never assume "County" is the universal case; ask the source. */
export function noParcelSourceNote(identity) {
  if (!identity || identity.status !== "no-source") return null;
  const suffix = identity.state === "TX" ? " County" : "";
  return `${identity.name}${suffix} — no parcel data wired here yet.`;
}

// The county keys whose parcel source is the STATEWIDE TxGIO layer (covers all 254
// Texas counties). The circuit breaker must never skip these (they're the universal
// fallback), and a hit FROM one of them standing in for a real-CAD county is what the
// honest "statewide backup" badge keys off (B244).
/* NEW-4 — the county-keyed config maps, wrapped so EVERY lookup normalises its key (see
 * shared/gis/countyKeys.js). Declared here — after the three literals above and before the first
 * module-level consumer (`STATEWIDE_KEYS`, immediately below) — because a `const` is in its
 * temporal dead zone until its own line runs, so a wrapper placed at the end of the file would
 * throw on load. The `_RAW` literals stay private: nothing outside should hold the unwrapped map. */
/* B853712 — same statewide-derived fallback as `COUNTIES` above, reading the SAME cached
 * derivation (`derivedTxCounties()`), just the `.mapEntry` shape instead of `.cfgEntry`. */
export const COUNTIES_MAP = withStatewideDerivation(byCountyKey(COUNTIES_MAP_RAW), (rec) => rec.mapEntry);
export const JURISDICTION_LAYERS = byCountyKey(JURISDICTION_LAYERS_RAW);

export const STATEWIDE_KEYS = Object.entries(COUNTIES_MAP).filter(([, c]) => c.statewide).map(([k]) => k);

/* NEW-2 — ONE URL MUST NOT CARRY TWO HEALTH POLICIES.
 *
 * `STATEWIDE_KEYS` answers "is this KEY the statewide pseudo-county?", and for the hang-guard that
 * is the wrong question. The universal composite is exempt from the display hang-guard because
 * pulling it would leave the map with nothing to see or click — a property of the ENDPOINT, not of
 * whichever key happened to name it. A county parked on a composite (`co_larimer` before this item;
 * `waller` and the four remaining Colorado counties today) resolves to the same URL and so used to
 * get the OPPOSITE policy: the guard fired on the county-keyed copy, `markDown` pulled the layer,
 * the breaker opened, and the banner told the owner a server was slow while pointing him at that
 * exact server. Ask the URL, not the key. */
export const trimLayerUrl = (u) => String(u || "").trim().replace(/\/+$/, "");
/* NEW-1 (2026-09-08) — DERIVED from every `statewide:true` entry in COUNTIES_MAP, not a fixed
 * two-element literal. The literal form (`[TXGIO_STATEWIDE_LAYER, CO_STATEWIDE_LAYER]`) was exactly
 * the "ask the key, not the URL" bug this const exists to prevent, just one layer up: adding the 19
 * new state composites without updating it would have left every one of them fighting the display
 * hang-guard the exact way `co_larimer` used to — the new composite's OWN URL wouldn't have been
 * recognised as statewide by the one function whose job is to recognise statewide URLs. */
export const STATEWIDE_LAYER_URLS = Object.freeze(
  Object.values(COUNTIES_MAP).filter((c) => c.statewide).map((c) => trimLayerUrl(c.layerUrl)),
);
export const isStatewideLayerUrl = (url) => STATEWIDE_LAYER_URLS.includes(trimLayerUrl(url));

/* NEW-2 — the dev-time assertion that stops the next county parked on a composite from
 * reintroducing the double-add. Two config entries may share a layer URL ONLY when that URL is a
 * statewide composite, because the composite is the one endpoint whose display and health policy
 * are both keyed off the URL — so every key naming it gets ONE Leaflet layer and ONE policy. Any
 * OTHER shared URL means two keys the app will treat as two independent sources: two identical
 * layers over the same ground, double the requests, and two health verdicts that can disagree.
 * Pure, so `test/counties.test.js` asserts it and the module logs it once in dev (LOUD-FAILURE).
 *
 * B1455633 — A SECOND SANCTIONED SHARING SHAPE: a single state agency's ONE service genuinely
 * covering several (not all) counties, each reached by filtering the SAME url to its own rows —
 * Idaho's 13 participating counties all ride one "Public Idaho Parcels" layer via `scopeWhere`,
 * exactly the way Waller rides TxGIO, except there is no Idaho-wide composite to register the
 * exemption against (marking it `statewide:true` would be the Nebraska defect all over again —
 * the layer covers 13 of 44 counties, not the state). So a shared URL is ALSO exempt when every
 * entry sharing it carries its OWN non-empty, mutually DISTINCT `scopeWhere` — two counties each
 * filtered to their own subset of one endpoint is a different thing from two keys pointing at the
 * SAME unscoped copy of one endpoint, which is still exactly the double-add/double-health-check
 * defect this guard exists to catch (two entries with no scope, or the same scope, still conflict). */
export function sharedLayerUrlConflicts(map = COUNTIES_MAP) {
  const byUrl = new Map();
  for (const [key, cfg] of Object.entries(map)) {
    const url = trimLayerUrl(cfg && (cfg.layerUrl || cfg.mapServer));
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push({ key, scopeWhere: cfg && cfg.scopeWhere });
  }
  const conflicts = [];
  for (const [url, entries] of byUrl) {
    if (entries.length <= 1 || isStatewideLayerUrl(url)) continue;
    const scopes = entries.map((e) => e.scopeWhere).filter(Boolean);
    const everyEntryScoped = scopes.length === entries.length;
    const scopesDistinct = new Set(scopes).size === scopes.length;
    if (everyEntryScoped && scopesDistinct) continue;
    conflicts.push({ url, keys: entries.map((e) => e.key) });
  }
  return conflicts;
}

if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV) {
  const bad = sharedLayerUrlConflicts();
  if (bad.length)
    console.error(
      "[counties] Two county entries share a non-statewide parcel layer URL — the map will add the " +
      "same layer twice and can reach two different health verdicts for one endpoint:",
      bad,
    );
}

// The statewide TxGIO parcel layer URL (all of Texas) — the search/click fallback for
// any county whose own CAD endpoint is down. Decoupled from COUNTIES.chambers in B787
// (Chambers now has its own CCAD source); this is the dedicated statewide layer const.
export const STATEWIDE_PARCEL_LAYER = TXGIO_STATEWIDE_LAYER;

/* B792 — map a county DISPLAY NAME (e.g. the TxDOT boundary layer's "Fort Bend") onto the
 * app's routing key. Returns null for anything unrecognized so a caller can never make a stored
 * county WORSE by writing an unknown key — never a guess: a Texas answer is either a dialed-in
 * literal or the SAME statewide-derived tier `COUNTIES_MAP` itself answers from (B853712, so this
 * function and a direct `COUNTIES_MAP[key]` lookup can never disagree about which keys are real),
 * both backed by a real parcel source; a Colorado answer stays literal-only (no CO derivation).
 * Never a statewide PSEUDO-key (`txgio_statewide`/`co_statewide`) — those are excluded below. Pure. */
/* NEW-5 — the optional `state` argument is what makes this safe across two states. Texas and
 * Colorado BOTH have an El Paso County and a Jefferson County, so an unqualified "El Paso" is
 * genuinely ambiguous. Called with no state the behaviour is Texas keys only, and a Colorado-only
 * name returns null. Pass a state to reach the Colorado keys.
 *
 * ⛔ NEW-1 (adversarial review, 2026-09-08) — CALLING THIS WITHOUT A STATE IS NOW A DEFECT, AND
 * `test/countyStateQualifier.test.js` FAILS THE BUILD ON ONE. The note this replaces said the
 * unqualified form was safe because "the TxDOT boundary layer only ever names Texas counties" —
 * that stopped being true when `countyAtPoint` grew its offline floor (B209502), which answers
 * from a NATIONAL roster of 3,144 counties across 51 states. Texas shares a county name with
 * another state 200-plus times, so an unqualified "Montgomery", "Liberty", "Chambers" or "Harris"
 * resolved a Pennsylvania, Georgia or Alabama point to the TEXAS key of that name — a comp
 * labelled "Montgomery County, TX" in Norristown, and on a SITE that key also selects the drainage
 * authority, the detention criteria and the setbacks. Every caller already holds the state
 * (`countyAtPoint` and `resolveCounty` both return one); pass it. A name whose state has no
 * configured county returns null, which is the honest answer, never a same-named guess. */
/* B1455634 — GENERALIZED PAST CO/TX: a state-qualified call for any OTHER configured state tries
 * `${state}_${slug}` — the same `co_` shape Colorado already used, extended rather than
 * special-cased again. This is what makes the batch of non-TX/CO counties in this file (Idaho,
 * Illinois, Pennsylvania, Georgia, Michigan, Kansas, Missouri, Oregon, Kentucky, Mississippi,
 * Oklahoma, Louisiana, Alabama) actually REACHABLE by name+state — without it, a resolved
 * "Jefferson County, KY" and "Jefferson County, AL" would both try the bare, unprefixed slug
 * `jefferson` and collide with each other (and with Texas, which has no Jefferson of its own
 * configured, but the shape would still be wrong). TX/CO behavior is BYTE-IDENTICAL to before —
 * this only adds a candidate for every state that reaches neither of those two branches. */
/* ⛔ B1574257 (2026-09-12) — "COUNTY" IS NOT THE ONLY DESIGNATION, AND STRIPPING ONLY IT MADE EVERY
 * LOUISIANA PARISH UNREACHABLE BY NAME — SILENTLY, AND ALREADY IN PRODUCTION.
 *
 * The line below used to strip `\bcounty\b` and nothing else. The nationwide geometry asset
 * (B1361425) publishes each row with its own Census-standard designation — "Orleans Parish",
 * "Denali Borough", "Aleutians West Census Area", "Anchorage Municipality" — which is CORRECT and
 * is what `noParcelSourceNote` already leans on to avoid printing "Orleans Parish County". But the
 * routing KEYS in this file drop the designation (`harris`, not `harriscounty`), so a parish name
 * slugged to `orleansparish` and asked for `la_orleansparish`, a key that exists nowhere.
 *
 * WHAT THAT ACTUALLY COST, measured on the shipped code before the fix (not reasoned about):
 * `la_eastbatonrouge` — wired since B1455634 — was ALREADY unreachable this way. A Baton Rouge
 * point returned `countyKeyForName → null`, so `countyIdentity` reported `no-source` ("East Baton
 * Rouge Parish — no parcel data wired here yet") for a parish whose own parcel service was wired
 * and working, and `geometryCountyAnswer` returned null, so NEW-6's confident-narrowing — the
 * whole B1338896 Casa Grande fix — could never engage anywhere in Louisiana. Nothing threw; the
 * app simply substituted the padded-bbox/state fallback and said nothing. The only reason this had
 * not produced a WRONG parish is that Louisiana had exactly one row to fall back to.
 *
 * THE FIX IS THE DESIGNATION LIST, NOT A LOUISIANA SPECIAL CASE. Measured across all 3,144 rows in
 * the committed asset: widening the strip to county | parish | borough | census area | municipality
 * adds ZERO new key collisions (both before and after, the only same-state collapses are the six
 * pre-existing independent-city/county pairs — Baltimore MD, St. Louis MO, and Fairfax/Franklin/
 * Richmond/Roanoke VA — which the existing `\bcity\b` strip already produced, none of which is a
 * configured county today). Guarded by `test/counties.test.js`, which re-runs that collision count
 * against the real asset so a future widening cannot quietly introduce one. */
const COUNTY_DESIGNATION_RE = /\b(county|parish|borough|census area|municipality)\b/g;

export function countyKeyForName(name, state = null) {
  if (!name) return null;
  const slug = String(name).toLowerCase().replace(COUNTY_DESIGNATION_RE, "").replace(/\b(city|and|of)\b/g, "").replace(/[^a-z]/g, "");
  const st = state ? String(state).toUpperCase() : null;
  /* B209503 — the one Texas county whose key is not its slug. Austin COUNTY (Bellville / Sealy)
   * keeps the key `austintx` so the far more common string "Austin" — the city, its ETJ, a TxDOT
   * district — can never resolve to it by accident. The alias is applied here, in the one place
   * a display name becomes a key, rather than at each call site — the SAME alias the statewide
   * derivation above uses, so the two can never disagree about what "Austin" means. */
  const txSlug = TX_COUNTY_KEY_ALIAS[slug] || slug;
  const candidates = st === "CO" ? [`co_${slug}`] : st && st !== "TX" ? [`${st.toLowerCase()}_${slug}`] : [txSlug];
  for (const key of candidates) {
    const entry = COUNTIES_MAP[key];
    if (!entry || entry.statewide) continue;
    if (st && entry.state && entry.state !== st) continue;
    // Unqualified lookups stay Texas-only — see the note above.
    if (!st && entry.state && entry.state !== "TX") continue;
    return key;
  }
  return null;
}

/* The configured county keys for one state, in config order. */
export const countyKeysForState = (state) =>
  Object.entries(COUNTIES_MAP)
    .filter(([, c]) => c.state === String(state || "").toUpperCase() && !c.statewide)
    .map(([k]) => k);

/* The state a routing key belongs to ("TX" | "CO" | null). The one place other modules should ask,
 * so nobody re-derives it from a key prefix. */
export const stateForCountyKey = (key) => (COUNTIES_MAP[key] && COUNTIES_MAP[key].state) || null;

// The value of TxGIO's `county` attribute for each configured county — used to SCOPE a
// statewide-backup ID/address search to that one county, so an account number or street
// name can't match a like-named parcel in another county (the Chambers caveat applied
// to every county that falls back, B244). Click-to-select is a point query and needs no
// scope (it can only hit one lot).
/* B209503 — every configured Texas county needs a row here, not just the ones with a CAD, or the
 * statewide backup silently does not exist for them: `statewideFallbackFor` returns null and a
 * county whose own server is down degrades to nothing instead of to TxGIO. The five new counties
 * are added with the spelling TxGIO's own `county` column uses (upper case, spaces not
 * underscores) — verified against the live layer, which is why FORT BEND is two words. */
const TXGIO_COUNTY_NAME = byCountyKey({
  harris: "HARRIS", fortbend: "FORT BEND", chambers: "CHAMBERS", waller: "WALLER",
  montgomery: "MONTGOMERY", brazoria: "BRAZORIA", galveston: "GALVESTON", liberty: "LIBERTY",
  austintx: "AUSTIN",
});

/* NEW-5 — the same idea for Colorado. The state composite scopes on `countyName`, spelled in
 * title case (not TxGIO's upper case), so the two states need their own maps rather than one
 * shared one with a case rule. */
const CO_COUNTY_NAME = byCountyKey({
  co_adams: "Adams", co_denver: "Denver", co_arapahoe: "Arapahoe", co_larimer: "Larimer",
  co_weld: "Weld", co_jefferson: "Jefferson", co_elpaso: "El Paso", co_boulder: "Boulder",
  co_broomfield: "Broomfield",
});

/* The statewide-backup parcel source for a county whose primary CAD is unavailable,
 * or null when there's no stand-in. Returns null for a county that has NO statewide
 * scope wired, and for one whose PRIMARY is already the statewide layer (Waller — it
 * has no separate fallback). Chambers, since its B787 CCAD repoint, now DOES get a
 * TxGIO backup here (its primary is no longer the statewide layer). The returned
 * `scopeWhere` confines the search to that county on the all-Texas layer (B244). */
export function statewideFallbackFor(county) {
  const name = TXGIO_COUNTY_NAME[county];
  if (name) {
    if (COUNTIES[county]?.layerUrl === STATEWIDE_PARCEL_LAYER) return null; // already on TxGIO
    return {
      layerUrl: STATEWIDE_PARCEL_LAYER,
      scopeWhere: `county='${name}'`,
      idField: "prop_id",
      addrField: "situs_addr",
      countyName: name,
      label: "Statewide backup (TxGIO)",
    };
  }
  /* NEW-5 — Colorado's backup tier. Exactly the same contract, a different statewide layer: the
   * state OIT Colorado Public Parcels composite, scoped by `countyName`. This is the answer to
   * "what happens when a Colorado county server is down" — the same graceful degradation Texas
   * gets, not an empty map. The four counties whose PRIMARY already IS the composite return null
   * (no separate backup), the same self-referential case as Waller in Texas. */
  const coName = CO_COUNTY_NAME[county];
  if (!coName) return null;
  if (COUNTIES[county]?.layerUrl === CO_STATEWIDE_LAYER) return null; // already on the composite
  return {
    layerUrl: CO_STATEWIDE_LAYER,
    scopeWhere: `countyName='${coName}'`,
    idField: "parcel_id",
    addrField: "situsAdd",
    countyName: coName,
    label: "Statewide backup (Colorado OIT)",
  };
}

/* (A `STATEWIDE_LAYER_BY_STATE` map was dropped before shipping: no app code read it, and
 * speculative API has no business on the Site route's critical-path bundle. `statewideFallbackFor`
 * already NAMES the tier it returns via its `label`, which is what a surface actually needs.) */
