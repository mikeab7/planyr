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
 *   Chambers — CCAD hosted parcels feature service (marked experimental)
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
    layerUrl:
      "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Hosted_Parcels_Test_WebMer_20201016/FeatureServer/0",
    idField: null,
    addrField: null,
    experimental: true,
    help: "Chambers CAD hosted parcels (endpoint is provisional — edit below if it 404s).",
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
      // Caveat: it's the *test* environment (the only host serving these utility-
      // network services with CORS). Swap to a prod host later if the City exposes
      // one — low-risk now that layers fail loudly with a reason.
      coh_ww: {
        label: "Houston wastewater",
        url: "https://geogimstest.houstontx.gov/arcgis/rest/services/HW/WasteWater_gx/MapServer",
        layers: null,
        note: "City of Houston sanitary sewer (geogimstest — City's published source).",
        opacity: 0.85,
      },
      coh_storm: {
        label: "Houston storm sewer",
        url: "https://geogimstest.houstontx.gov/arcgis/rest/services/TDO/UN_Stormwater/MapServer",
        layers: null,
        note: "City of Houston storm drainage (geogimstest — City's published source).",
        opacity: 0.85,
      },
      coh_water: {
        label: "Houston water lines",
        url: "https://geogimstest.houstontx.gov/arcgis/rest/services/HW/Water_gx/MapServer",
        layers: null,
        note: "City of Houston potable water (geogimstest — City's published source).",
        opacity: 0.85,
      },
    },
  },
  fortbend: {
    label: "Fort Bend County",
    layers: {
      fb_water: {
        label: "Water / MUD districts",
        url: "https://gisweb.fortbendcountytx.gov/arcgis/rest/services/General/Water_Districts/MapServer",
        layers: null,
        note: "MUD / WCID / drainage district boundaries (Fort Bend County GIS).",
        opacity: 0.7,
      },
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
 * If layerUrl is null it's resolved from mapServer at runtime. */
export const COUNTIES_MAP = {
  harris: {
    center: [29.76, -95.37],
    zoom: 11,
    mapServer: "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer",
    layerUrl: "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0",
  },
  fortbend: {
    center: [29.53, -95.77],
    zoom: 11,
    mapServer: "https://gis.fbcad.org/serverarcgis2/rest/services/Public/MapServer",
    layerUrl: null,
  },
  chambers: {
    center: [29.7, -94.66],
    zoom: 11,
    mapServer: null,
    layerUrl:
      "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Hosted_Parcels_Test_WebMer_20201016/FeatureServer/0",
  },
};
