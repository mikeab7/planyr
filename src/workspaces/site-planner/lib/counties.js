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

export const COUNTIES = {
  harris: {
    state: "TX",
    verifiedOn: "2026-07-29", // re-probed: 1,548,457 parcel polygons
    label: "Harris County · HCAD",
    layerUrl:
      "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0",
    idField: "HCAD_NUM",
    addrField: "LocAddr",
    help: "Search by HCAD account number (13 digits) or a site address.",
  },
  fortbend: {
    state: "TX",
    verifiedOn: "2026-07-29", // re-probed: 385,648 parcel polygons
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
    verifiedOn: null,
    verifiedNote:
      "Live-verified at the B787 CCAD repoint, and it is the same service the CCAD website's own map " +
      "draws. It could NOT be re-probed on 2026-07-29 because gisdata.pandai.com is blocked by this " +
      "build environment's egress policy — a sandbox limitation, not a sign the endpoint moved. Kept " +
      "as the primary: demoting a working Texas source to the statewide composite would be a " +
      "behaviour change, which the Colorado work is not permitted to make.",
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
    verifiedOn: "2026-07-29",
    idField: "PIN",
    addrField: "concataddr1",
    help: "Adams County parcels (county GIS, Esri-hosted). Search by PIN / parcel number or a site address.",
  },
  co_denver: {
    state: "CO",
    label: "City &amp; County of Denver, CO",
    // VERIFIED LIVE 2026-07-29: 240,360 parcels; the layer id is 245, not 0 (Denver's open-data
    // catalogue keeps one service per table with the catalogue's own id). Native SR is EPSG:2877 —
    // NAD83(HARN) / Colorado CENTRAL (ftUS), independent confirmation of the NEW-3 zone assignment.
    layerUrl: "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_PROP_PARCELS_A/FeatureServer/245",
    verifiedOn: "2026-07-29",
    idField: "SCHEDNUM",
    addrField: "SITUS_ADDRESS_LINE1",
    help: "Denver parcels (city & county open data). Search by schedule number or a site address.",
  },
  co_weld: {
    state: "CO",
    label: "Weld County, CO",
    // VERIFIED LIVE 2026-07-29: 163,685 parcels, county open-data FeatureServer.
    layerUrl: "https://services.arcgis.com/ewjSqmSyHJnkfBLL/arcgis/rest/services/Parcels_open_data/FeatureServer/0",
    verifiedOn: "2026-07-29",
    idField: "ACCOUNTNO",
    addrField: "SITUS",
    help: "Weld County parcels (county open data). Search by account number or a site address.",
  },
  co_broomfield: {
    state: "CO",
    label: "City &amp; County of Broomfield, CO",
    // VERIFIED LIVE 2026-07-29: 27,531 parcels. Native SR is EPSG:2876 — NAD83(HARN) / Colorado
    // NORTH (ftUS). That is the evidence behind the NEW-3 Broomfield zone DECISION: the statute
    // (C.R.S. 38-52-101) predates the county and never names it, but the county's own GIS works in
    // Colorado North. See src/shared/coordinates/statePlane.js.
    layerUrl: "https://services1.arcgis.com/vXSRPZbyyOmH9pek/arcgis/rest/services/Parcels/FeatureServer/0",
    verifiedOn: "2026-07-29",
    idField: "PARCELNUMBER",
    addrField: "SITUS_FULL_ADDRESS",
    help: "Broomfield parcels (city & county open data). Search by parcel/account number or a site address.",
  },
  co_arapahoe: {
    state: "CO",
    label: "Arapahoe County, CO",
    layerUrl: CO_STATEWIDE_LAYER,
    candidateUrl: "https://gis.arapahoegov.com/arcgis/rest/services/OpenDataService/FeatureServer/0",
    candidateProvenance: "ArcGIS Online item 'Parcels - Arapahoe County' (owner gis@mhfd); host gis.arapahoegov.com blocked by build-environment egress policy — probe pending (V507).",
    verifiedOn: null,
    idField: "parcel_id",
    addrField: "situsAdd",
    scopeWhere: "countyName='Arapahoe'",
    help: "Colorado statewide parcels (state OIT composite) — searches are limited to Arapahoe County until the county's own endpoint is confirmed.",
  },
  co_larimer: {
    state: "CO",
    label: "Larimer County, CO",
    layerUrl: CO_STATEWIDE_LAYER,
    candidateUrl: "https://maps1.larimer.org/arcgis/rest/services/MapServices/Parcels/MapServer/3",
    candidateProvenance: "ArcGIS Online item 'Larimer County Tax Parcels' (owner ftc_geoevent); host maps1.larimer.org blocked by build-environment egress policy — probe pending (V507).",
    verifiedOn: null,
    idField: "parcel_id",
    addrField: "situsAdd",
    scopeWhere: "countyName='Larimer'",
    help: "Colorado statewide parcels (state OIT composite) — searches are limited to Larimer County until the county's own endpoint is confirmed.",
  },
  co_jefferson: {
    state: "CO",
    label: "Jefferson County, CO",
    // No county assessor parcel endpoint could be FOUND at all (as opposed to found-but-unprobed):
    // the Jeffco services that surface publicly are open-space land boundaries and one-off project
    // layers, not the parcel fabric. Rather than ship a plausible-looking guessed URL, Jefferson
    // rides the statewide composite outright — exactly what Waller does in Texas.
    layerUrl: CO_STATEWIDE_LAYER,
    verifiedOn: null,
    idField: "parcel_id",
    addrField: "situsAdd",
    scopeWhere: "countyName='Jefferson'",
    help: "Colorado statewide parcels (state OIT composite) — searches are limited to Jefferson County. Jefferson publishes no public parcel service of its own that we could locate.",
  },
  co_elpaso: {
    state: "CO",
    label: "El Paso County, CO",
    layerUrl: CO_STATEWIDE_LAYER,
    candidateUrl: "https://gisservices.elpasoco.com/arcgis2/rest/services/HubPublic/Parcels/MapServer",
    candidateProvenance: "ArcGIS Online item 'Parcels' (owner BaileyG, El Paso County); host gisservices.elpasoco.com blocked by build-environment egress policy — probe pending (V507). A regional alternative WAS verified live 2026-07-29 — PPACG Parcels (2025), https://services1.arcgis.com/0plDVQODvYjBRQXP/arcgis/rest/services/PPACG_Parcels/FeatureServer/0, native SR EPSG:2232 — but it is the MPO's derived planning layer, not the assessor's fabric, so it is not shipped as a parcel source.",
    verifiedOn: null,
    idField: "parcel_id",
    addrField: "situsAdd",
    scopeWhere: "countyName='El Paso'",
    help: "Colorado statewide parcels (state OIT composite) — searches are limited to El Paso County until the county's own endpoint is confirmed.",
  },
  co_boulder: {
    state: "CO",
    label: "Boulder County, CO",
    layerUrl: CO_STATEWIDE_LAYER,
    candidateUrl: "https://maps.bouldercounty.org/arcgis/rest/services/PARCELS/PARCELS_OWNER/FeatureServer/0",
    candidateProvenance: "ArcGIS Online item 'Parcels - Boulder County' (owner gis@mhfd); host maps.bouldercounty.org blocked by build-environment egress policy — probe pending (V507).",
    verifiedOn: null,
    idField: "parcel_id",
    addrField: "situsAdd",
    scopeWhere: "countyName='Boulder'",
    help: "Colorado statewide parcels (state OIT composite) — searches are limited to Boulder County until the county's own endpoint is confirmed.",
  },
};

/* The counties whose full parcel fabric is snapshot-cached to Google Drive (B629) so the map keeps
 * working when the live county server is down. Chambers + Waller ride the flaky State/TxGIO service
 * (the actual pain); Fort Bend is included as reliable-source insurance (Phase 2, tiled). Harris is
 * deliberately EXCLUDED (1.5M parcels — too big for the browser). Kept in lockstep with the
 * parcel-cache Function's allowlist (functions/api/parcel-cache/_handler.js). */
export const SNAPSHOT_COUNTIES = new Set(["chambers", "waller", "fortbend"]);

const ID_RE =
  /(hcad_?num|^acct|account|parcel_?id|prop_?id|^pid$|quick_?ref|geo_?id|^pin$|^gid$)/i;
const ADDR_RE =
  /(situs|site_?addr|prop_?addr|loc_?addr|location|^addr|str_?name|full_?addr|address)/i;

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
export const JURISDICTION_LAYERS = {
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
        note: "Fort Bend Drainage District 1-foot contours. Exists ONLY in Fort Bend County — the statewide USGS contour layer above covers everywhere else. Health checked via the same-origin proxy (county host sends no CORS headers).",
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

// Find the first field whose name looks like an id or address field.
export function detectField(fields, kind) {
  const re = kind === "id" ? ID_RE : ADDR_RE;
  const f = (fields || []).find((x) => re.test(x.name));
  return f ? f.name : null;
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
export const COUNTIES_MAP = {
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
/* NEW-5 — coarse STATE envelopes, used only by the out-of-every-county-bbox branch below.
 * Deliberately generous; a point in neither returns the pre-Colorado all-counties behaviour. */
const STATE_BOUNDS = {
  TX: [25.5, -107.0, 36.8, -93.3],
  CO: [36.9, -109.2, 41.1, -101.9],
};
const stateForPoint = (lat, lng) => {
  for (const [st, b] of Object.entries(STATE_BOUNDS)) {
    if (lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3]) return st;
  }
  return null;
};

export function candidateCountiesForPoint(lat, lng) {
  const entries = Object.entries(COUNTIES_MAP);
  const within = entries
    .filter(([, c]) => { const b = c.bbox; return b && lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3]; })
    .map(([k]) => k);
  if (!within.length) {
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
  return [...within, ...statewide];
}

// The county keys whose parcel source is the STATEWIDE TxGIO layer (covers all 254
// Texas counties). The circuit breaker must never skip these (they're the universal
// fallback), and a hit FROM one of them standing in for a real-CAD county is what the
// honest "statewide backup" badge keys off (B244).
export const STATEWIDE_KEYS = Object.entries(COUNTIES_MAP).filter(([, c]) => c.statewide).map(([k]) => k);

// The statewide TxGIO parcel layer URL (all of Texas) — the search/click fallback for
// any county whose own CAD endpoint is down. Decoupled from COUNTIES.chambers in B787
// (Chambers now has its own CCAD source); this is the dedicated statewide layer const.
export const STATEWIDE_PARCEL_LAYER = TXGIO_STATEWIDE_LAYER;

/* B792 — map a county DISPLAY NAME (e.g. the TxDOT boundary layer's "Fort Bend") onto the
 * app's routing key, but ONLY when that key is a real configured county (never a statewide
 * pseudo-key, never a guess). Returns null for anything unrecognized so a caller can never
 * make a stored county WORSE by writing an unknown key. Pure. */
/* NEW-5 — the optional `state` argument is what makes this safe across two states. Texas and
 * Colorado BOTH have an El Paso County and a Jefferson County, so an unqualified "El Paso" is
 * genuinely ambiguous. Called with no state (every existing caller — the TxDOT boundary layer only
 * ever names Texas counties) the behaviour is byte-identical to before: Texas keys only, and a
 * Colorado-only name still returns null. Pass a state to reach the Colorado keys. */
export function countyKeyForName(name, state = null) {
  if (!name) return null;
  const slug = String(name).toLowerCase().replace(/\bcounty\b/g, "").replace(/\b(city|and|of)\b/g, "").replace(/[^a-z]/g, "");
  const st = state ? String(state).toUpperCase() : null;
  const candidates = st === "CO" ? [`co_${slug}`] : st === "TX" ? [slug] : [slug];
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
const TXGIO_COUNTY_NAME = { harris: "HARRIS", fortbend: "FORT BEND", chambers: "CHAMBERS", waller: "WALLER" };

/* NEW-5 — the same idea for Colorado. The state composite scopes on `countyName`, spelled in
 * title case (not TxGIO's upper case), so the two states need their own maps rather than one
 * shared one with a case rule. */
const CO_COUNTY_NAME = {
  co_adams: "Adams", co_denver: "Denver", co_arapahoe: "Arapahoe", co_larimer: "Larimer",
  co_weld: "Weld", co_jefferson: "Jefferson", co_elpaso: "El Paso", co_boulder: "Boulder",
  co_broomfield: "Broomfield",
};

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

/* NEW-5 — the statewide parcel layer for a state, or null. Exported so a surface can NAME the
 * backup tier it fell through to rather than showing an unattributed outline. */
export const STATEWIDE_LAYER_BY_STATE = { TX: TXGIO_STATEWIDE_LAYER, CO: CO_STATEWIDE_LAYER };
