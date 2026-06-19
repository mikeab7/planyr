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
 *   Fort Bend— FBCAD public map service (parcels layer auto-detected)
 *   Chambers — TxGIO (Texas Geographic Information Office) statewide parcels. The
 *              old CCAD-only hosted test layer went private (499 Token Required), so
 *              we use the public all-Texas service and scope searches to Chambers.
 */

// NAD83 / Texas South Central (US survey feet) — the State Plane zone covering
// Harris, Fort Bend and Chambers. Requesting geometry in this SR means returned
// x/y are already in feet, so on-screen distances are true (no Web-Mercator stretch).
export const FEET_WKID = 2278;

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
    serviceUrl:
      "https://gis.fbcad.org/serverarcgis2/rest/services/Public/MapServer",
    idField: null,
    addrField: null,
    help: "FBCAD public service — the parcels layer is auto-selected.",
  },
  chambers: {
    label: "Chambers County · CCAD",
    // TxGIO statewide parcel service — one public, CORS-open layer covering all 254
    // Texas counties. The old CCAD-only hosted layer went private (499 Token Required).
    // Because this layer is statewide, ID/address searches are confined to Chambers via
    // `scopeWhere`; click-to-select is a point query so it can only ever hit one parcel.
    layerUrl:
      "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0",
    idField: "prop_id",
    addrField: "situs_addr",
    scopeWhere: "county='CHAMBERS'",
    help: "Texas statewide parcels (TxGIO) — searches are limited to Chambers County.",
  },
};

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
      // NOTE: Fort Bend's MUD/WCID/water-district boundaries moved into the global
      // "Jurisdictions" overlay group (lib/layers.js JURISDICTIONS.jur_mud, B167) so the
      // MUD toggle is available regardless of which county is in view — not duplicated here.
      fb_contours: {
        label: "1-ft contours (drainage)",
        url: "https://arcgisweb.fortbendcountytx.gov/arcgis/rest/services/FLOODZONE/Contours_1Foot/MapServer",
        layers: null,
        note: "Fort Bend Drainage District 1-foot contours.",
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
    mapServer: "https://gis.fbcad.org/serverarcgis2/rest/services/Public/MapServer",
    layerUrl: null,
  },
  chambers: {
    center: [29.7, -94.66],
    zoom: 11,
    bbox: [29.36, -94.92, 29.92, -94.39],
    mapServer: null,
    // TxGIO statewide parcels (see COUNTIES.chambers) — one layer covering all 254
    // Texas counties. `statewide:true` marks it as the UNIVERSAL parcel source: its
    // display layer paints outlines anywhere you zoom in (so it backs the visible
    // lines wherever a county's own CAD is down/unconfigured), and `candidateCounties
    // ForPoint` therefore also makes it queryable everywhere — appended as a fallback
    // so a click can always select an outline it can see. Without that, a click over
    // a Fort Bend lot (TxGIO outline shown, but FBCAD host down) found nothing (B130).
    // The answering county is corrected post-hit via `countyAtPoint` (B36a).
    statewide: true,
    layerUrl:
      "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0",
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
