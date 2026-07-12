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
 *              the statewide TxGIO harvest lagged it (B784). TxGIO stays the outage
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
// (the statewide display/click source, decoupled from Chambers in B784 when Chambers got
// its own CCAD source), by any county that has no CAD of its own (Waller), and by
// STATEWIDE_PARCEL_LAYER / statewideFallbackFor. One const so all references stay identical.
const TXGIO_STATEWIDE_LAYER =
  "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0";

export const COUNTIES = {
  harris: {
    label: "Harris County · HCAD",
    layerUrl:
      "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0",
    idField: "HCAD_NUM",
    addrField: "LocAddr",
    help: "Search by HCAD account number (13 digits) or a site address.",
  },
  fortbend: {
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
    label: "Chambers County · CCAD",
    // CCAD's OWN live public parcel service (ChambersCADPublic, Pandai-hosted). This is the
    // exact MapServer the CCAD website's map draws, so Planyr's Chambers parcels match what
    // an owner sees on the CAD site — B784 repoint off the lagged statewide TxGIO harvest.
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
    label: "Waller County · WCAD",
    // Waller CAD publishes no public parcel GIS of its own, so it rides the statewide TxGIO
    // layer scoped to WALLER (TxGIO /query+/find disabled 2026-07-03 → outlines via /export,
    // clicks via /identify). Waller is one of the B629 snapshot-cached counties
    // (SNAPSHOT_COUNTIES), so a Drive snapshot backs it when TxGIO is down. Because its
    // primary IS the statewide layer, statewideFallbackFor(waller) returns null (no separate
    // backup) — same self-referential case Chambers used to be before its B784 CCAD repoint.
    layerUrl: TXGIO_STATEWIDE_LAYER,
    idField: "prop_id",
    addrField: "situs_addr",
    scopeWhere: "county='WALLER'",
    help: "Texas statewide parcels (TxGIO) — searches are limited to Waller County.",
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
  harris: {
    label: "Harris County · City of Houston",
    layers: {
      hcfcd_row: {
        label: "HCFCD channels & ROW",
        url: "https://www.gis.hctx.net/arcgishcpid/rest/services/HCFCD/ROW_FC/MapServer",
        layers: null,
        note: "Flood-control channel right-of-way (HCFCD).",
        opacity: 0.8,
      },
      // City of Houston water/wastewater/storm. The mycity2/pubgis02 HPW host was
      // stale (intermittent "service not started"); geogimsprod runs only the
      // Geocortex viewer (no /arcgis/rest — 404). The real source the City's public
      // viewer pulls from is geogimstest.houstontx.gov/arcgis/rest — CONFIRMED live,
      // 200 + metadata, and CORS-open to https://mikeab7.github.io (probe + export
      // both work). Folders HW (Water_gx, WasteWater_gx) and TDO (UN_Stormwater).
      // The network sublayers are default-OFF and/or scale-gated, so we pin the
      // pipe/main sublayer IDs via `layers` (→ export `layers=show:…`) or the export
      // paints blank. IDs verified from each service's /MapServer/layers. Coverage is
      // CITY OF HOUSTON ONLY (transparent outside the city — a real boundary, not a
      // bug). Trunk lines (Gravity Main 2, Pipe 22) are minScale ~1:40k → only at
      // site-plan zoom. Caveat: it's the *test* host (only confirmed CORS source);
      // swap to a prod host later if the City exposes one.
      coh_ww: {
        label: "Houston wastewater",
        url: "https://geogimstest.houstontx.gov/arcgis/rest/services/HW/WasteWater_gx/MapServer",
        layers: [2, 6], // 2 Gravity Main (≥~1:40k), 6 Force Main
        note: "City of Houston sanitary sewer (geogimstest). COH only — blank outside the city. Zoom in (~1:40k) to see gravity mains.",
        opacity: 0.85,
      },
      coh_storm: {
        label: "Houston storm sewer",
        url: "https://geogimstest.houstontx.gov/arcgis/rest/services/TDO/UN_Stormwater/MapServer",
        layers: [22, 23, 24, 904], // Pipe (≥~1:40k), Open Channel, Culvert, Linear Drain
        note: "City of Houston storm drainage (geogimstest). COH only — blank outside the city. Zoom in (~1:40k) to see pipes.",
        opacity: 0.85,
      },
      coh_water: {
        label: "Houston water lines",
        url: "https://geogimstest.houstontx.gov/arcgis/rest/services/HW/Water_gx/MapServer",
        layers: [0, 1], // 0 Water Lines, 1 Water Main (both draw at any zoom)
        note: "City of Houston potable water (geogimstest). COH only — blank outside the city.",
        opacity: 0.85,
      },
    },
  },
  fortbend: {
    label: "Fort Bend County",
    layers: {
      // NOTE: MUD/WCID/water-district boundaries live in the global "Jurisdictions"
      // overlay group (lib/layers.js JURISDICTIONS.jur_mud, B176) — now a STATEWIDE TCEQ
      // source (covers Fort Bend + Harris + everywhere), available regardless of which
      // county is in view. The old Fort-Bend-only layer was removed here to avoid a dupe.
      fb_contours: {
        // B469/NEW-6 — explicit dynamic (server-rendered export-image) layer. Its host
        // (arcgisweb.fortbendcountytx.gov) sends no CORS headers, so its ?f=json health probe is
        // routed through the same-origin B445 cache proxy (see probeService); the f=image export
        // already proxies and renders via a CORS-exempt <img>.
        kind: "dynamic",
        // B762: folds into the Basemap group under the USGS contour row (Fort Bend is a
        // single-layer county, so it no longer gets its own dropdown). Label names the county
        // + authority since it sits next to the statewide USGS contours there.
        label: "1-ft contours (Fort Bend DD)",
        url: "https://arcgisweb.fortbendcountytx.gov/arcgis/rest/services/FLOODZONE/Contours_1Foot/MapServer",
        layers: null,
        note: "Fort Bend Drainage District 1-foot contours. Exists ONLY in Fort Bend County — the statewide USGS contour layer above covers everywhere else.",
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
    center: [29.76, -95.37],
    zoom: 11,
    bbox: [29.49, -95.96, 30.17, -94.90],
    mapServer: "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer",
    layerUrl: "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0",
  },
  fortbend: {
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
    center: [29.7, -94.66],
    zoom: 11,
    bbox: [29.36, -94.92, 29.92, -94.39],
    mapServer: null,
    // CCAD's own live public parcel layer (see COUNTIES.chambers) — B784 repoint off the
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
  // The statewide TxGIO parcel source, as its OWN key (decoupled from Chambers in B784 once
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
    center: [31.0, -99.2], // Texas centroid — only used if this key is ever "picked" (it isn't; not in the search dropdown)
    zoom: 6,
    mapServer: null,
    statewide: true,
    layerUrl: TXGIO_STATEWIDE_LAYER,
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
export function candidateCountiesForPoint(lat, lng) {
  const entries = Object.entries(COUNTIES_MAP);
  const within = entries
    .filter(([, c]) => { const b = c.bbox; return b && lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3]; })
    .map(([k]) => k);
  if (!within.length) return entries.map(([k]) => k); // outside every bbox → try all (harris-first; incl. the statewide source)
  const statewide = entries.filter(([, c]) => c.statewide).map(([k]) => k).filter((k) => !within.includes(k));
  return [...within, ...statewide];
}

// The county keys whose parcel source is the STATEWIDE TxGIO layer (covers all 254
// Texas counties). The circuit breaker must never skip these (they're the universal
// fallback), and a hit FROM one of them standing in for a real-CAD county is what the
// honest "statewide backup" badge keys off (B244).
export const STATEWIDE_KEYS = Object.entries(COUNTIES_MAP).filter(([, c]) => c.statewide).map(([k]) => k);

// The statewide TxGIO parcel layer URL (all of Texas) — the search/click fallback for
// any county whose own CAD endpoint is down. Decoupled from COUNTIES.chambers in B784
// (Chambers now has its own CCAD source); this is the dedicated statewide layer const.
export const STATEWIDE_PARCEL_LAYER = TXGIO_STATEWIDE_LAYER;

// The value of TxGIO's `county` attribute for each configured county — used to SCOPE a
// statewide-backup ID/address search to that one county, so an account number or street
// name can't match a like-named parcel in another county (the Chambers caveat applied
// to every county that falls back, B244). Click-to-select is a point query and needs no
// scope (it can only hit one lot).
const TXGIO_COUNTY_NAME = { harris: "HARRIS", fortbend: "FORT BEND", chambers: "CHAMBERS", waller: "WALLER" };

/* The statewide-backup parcel source for a county whose primary CAD is unavailable,
 * or null when there's no stand-in. Returns null for a county that has NO statewide
 * scope wired, and for one whose PRIMARY is already the statewide layer (Waller — it
 * has no separate fallback). Chambers, since its B784 CCAD repoint, now DOES get a
 * TxGIO backup here (its primary is no longer the statewide layer). The returned
 * `scopeWhere` confines the search to that county on the all-Texas layer (B244). */
export function statewideFallbackFor(county) {
  const name = TXGIO_COUNTY_NAME[county];
  if (!name) return null;
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
