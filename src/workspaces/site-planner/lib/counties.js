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
 * Planyr does not model one. See docs/COLORADO-AUDIT.md §3.) */
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
 * rates/total and set connected:true. */
export const TAX_RATE_SOURCES = { harris: null, fortbend: null, chambers: null };
export async function resolveTaxRates(county, attrs) {
  const units = [];
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === "") continue;
    if (/(tax_?unit|jurisd|taxing|school|_isd$|^isd|\bmud\b|\besd\b|college|^city$|^cnty|county_?nm)/i.test(k))
      units.push({ name: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), value: String(v) });
  }
  const src = TAX_RATE_SOURCES[county];
  if (!src) return { units, rates: null, total: null, connected: false, note: `Rate source not connected for ${county || "this county"}.` };
  // (future) fetch per-unit rates from `src`, sum to total, set connected:true.
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
 * state a site is in, which is precisely the failure this work exists to prevent. */
const stateForPoint = (lat, lng) => siteState({ lat, lng });

/* B209502 — the GEOMETRY answer for a point, or null when the asset is not resident / the point is
 * outside both states. This is the ONE place `counties.js` asks; both public resolvers below read
 * it, so click routing and the jurisdiction heading cannot disagree about which county a point
 * is in (two envelopes that could drift apart is precisely the failure NEW-5 already fought). */
function geometryCountyKey(lat, lng) {
  const ans = resolveCounty(lat, lng);
  if (!ans || ans.status !== "ok") return null;
  return countyKeyForName(ans.name, ans.state);
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
  const truth = geometryCountyKey(lat, lng);
  const hoist = (keys) => (truth && keys.includes(truth) ? [truth, ...keys.filter((k) => k !== truth)] : keys);

  if (!within.length) {
    /* The geometry may know the county even when no bbox matched — Conroe and Texas City are
     * exactly that case. A configured county resolved here is a REAL answer, not a fallback, so
     * it leads and the rest of its state follows as coverage. */
    if (truth) {
      const st = COUNTIES_MAP[truth].state;
      const inState = entries.filter(([, c]) => c.state === st).map(([k]) => k);
      return hoist(inState);
    }
    // Outside every county bbox. Pre-Colorado this returned EVERY configured county (harris-first),
    // which was right when every county was in one state. With two states it would hand a Texas
    // click nine Colorado servers to try — and, far worse, hand a COLORADO click `harris` as
    // candidate[0], which the Layers-panel jurisdiction resolver reads. A Colorado site inheriting
    // Harris County is precisely the wrong-but-plausible answer this work exists to prevent.
    // So the fallback is now scoped to the point's STATE, in config order. For a Texas point that
    // is byte-identical to the old list (the Texas keys are first and unchanged); a point in
    // neither state's envelope keeps the old all-counties behaviour exactly.
    const st = stateForPoint(lat, lng);
    const inState = st ? entries.filter(([, c]) => c.state === st).map(([k]) => k) : [];
    return inState.length ? inState : entries.map(([k]) => k);
  }
  // Append the STATEWIDE source(s) of the states already in play — never every state's. A Texas
  // click must not carry Colorado's composite along, and vice versa.
  const states = new Set(within.map((k) => COUNTIES_MAP[k].state).filter(Boolean));
  const statewide = entries
    .filter(([k, c]) => c.statewide && !within.includes(k) && (!c.state || states.size === 0 || states.has(c.state)))
    .map(([k]) => k);
  /* The geometry's county leads even when several boxes matched — this is the Sugar Land case,
   * where harris and fortbend both contain the point and config order used to hand it to harris.
   * A geometry answer that is NOT among the bbox matches is still hoisted in front (it is the
   * correct county; the boxes simply do not reach it), with every bbox candidate kept behind it
   * so click coverage is never narrowed by this reorder. */
  const ordered = truth && !within.includes(truth) && COUNTIES_MAP[truth]
    ? [truth, ...within]
    : hoist(within);
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
  const entries = Object.entries(COUNTIES_MAP).filter(([, c]) => !c.statewide);
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
 * the qualifier. */
export function noParcelSourceNote(identity) {
  if (!identity || identity.status !== "no-source") return null;
  const suffix = identity.state === "CO" ? "" : " County";
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
export const STATEWIDE_LAYER_URLS = Object.freeze([TXGIO_STATEWIDE_LAYER, CO_STATEWIDE_LAYER].map(trimLayerUrl));
export const isStatewideLayerUrl = (url) => STATEWIDE_LAYER_URLS.includes(trimLayerUrl(url));

/* NEW-2 — the dev-time assertion that stops the next county parked on a composite from
 * reintroducing the double-add. Two config entries may share a layer URL ONLY when that URL is a
 * statewide composite, because the composite is the one endpoint whose display and health policy
 * are both keyed off the URL — so every key naming it gets ONE Leaflet layer and ONE policy. Any
 * OTHER shared URL means two keys the app will treat as two independent sources: two identical
 * layers over the same ground, double the requests, and two health verdicts that can disagree.
 * Pure, so `test/counties.test.js` asserts it and the module logs it once in dev (LOUD-FAILURE). */
export function sharedLayerUrlConflicts(map = COUNTIES_MAP) {
  const byUrl = new Map();
  for (const [key, cfg] of Object.entries(map)) {
    const url = trimLayerUrl(cfg && (cfg.layerUrl || cfg.mapServer));
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(key);
  }
  const conflicts = [];
  for (const [url, keys] of byUrl)
    if (keys.length > 1 && !isStatewideLayerUrl(url)) conflicts.push({ url, keys });
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
 * genuinely ambiguous. Called with no state (every existing caller — the TxDOT boundary layer only
 * ever names Texas counties) the behaviour is byte-identical to before: Texas keys only, and a
 * Colorado-only name still returns null. Pass a state to reach the Colorado keys. */
export function countyKeyForName(name, state = null) {
  if (!name) return null;
  const slug = String(name).toLowerCase().replace(/\bcounty\b/g, "").replace(/\b(city|and|of)\b/g, "").replace(/[^a-z]/g, "");
  const st = state ? String(state).toUpperCase() : null;
  /* B209503 — the one Texas county whose key is not its slug. Austin COUNTY (Bellville / Sealy)
   * keeps the key `austintx` so the far more common string "Austin" — the city, its ETJ, a TxDOT
   * district — can never resolve to it by accident. The alias is applied here, in the one place
   * a display name becomes a key, rather than at each call site — the SAME alias the statewide
   * derivation above uses, so the two can never disagree about what "Austin" means. */
  const txSlug = TX_COUNTY_KEY_ALIAS[slug] || slug;
  const candidates = st === "CO" ? [`co_${slug}`] : [txSlug];
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
