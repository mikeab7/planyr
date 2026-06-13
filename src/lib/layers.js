/* Shared map-layer system — the single source of truth for overlay layers,
 * used by BOTH the map finder and the site planner so a layer added here shows
 * up on both surfaces with no duplication.
 *
 * - STATEWIDE: overlays that apply anywhere (FEMA, NWI, TxRRC).
 * - JURISDICTION_LAYERS (from counties.js): local utility/district layers listed
 *   per county when that county is in view.
 * - ALL_LAYERS: the flattened id→config map the sync helper manages.
 * - syncOverlayLayers(): add/remove/opacity esri dynamicMapLayers on a Leaflet
 *   map to match an `overlays` state object. Both pages call this same function.
 *
 * Every endpoint is a free, keyless public ArcGIS REST service rendered
 * server-side (export image) so each agency's standard symbology comes through.
 */
import * as EL from "esri-leaflet";
import { JURISDICTION_LAYERS } from "./counties.js";

export { JURISDICTION_LAYERS };

export const STATEWIDE = {
  fema: {
    label: "FEMA flood zones",
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer",
    layers: [27, 28], // flood hazard boundaries + zones (standard NFHL symbology)
    note: null,
    opacity: 0.55,
  },
  wetlands: {
    label: "Wetlands (NWI)",
    url: "https://www.fws.gov/wetlandsmapservice/rest/services/Wetlands/MapServer",
    layers: [0],
    note: "NWI is for screening only — not a jurisdictional determination.",
    opacity: 0.55,
  },
  txrrc_pipe: {
    label: "Pipelines (TxRRC)",
    // Texas Railroad Commission T-4 pipelines, mirrored on the Harris County GIS
    // server the app already uses (reliable, keyless). Verify live — RRC moves services.
    url: "https://www.gis.hctx.net/arcgishcpid/rest/services/TXRRC/Pipelines/MapServer",
    layers: null,
    note: "RRC T-4 permit routes — schematic, not surveyed locations.",
    opacity: 0.9,
  },
  txrrc_wells: {
    label: "Oil & gas wells (TxRRC)",
    url: "https://www.gis.hctx.net/arcgishcpid/rest/services/TXRRC/Wells/MapServer",
    layers: null, // surface + bottom-hole + connectors; RRC symbology shows status
    note: "Well symbols show status — active, plugged, dry hole, injection, etc.",
    opacity: 0.9,
  },
};

// Flatten the per-jurisdiction registry into id→config (tagged with its county),
// then merge with the statewide overlays. The sync helper manages every layer by
// id, so a layer keeps its toggle state across county switches; the sidebar only
// LISTS the ones for the current jurisdiction.
export const JLAYERS = {};
Object.entries(JURISDICTION_LAYERS).forEach(([cty, j]) =>
  Object.entries(j.layers || {}).forEach(([id, cfg]) => { JLAYERS[id] = { ...cfg, county: cty }; }));

export const ALL_LAYERS = { ...STATEWIDE, ...JLAYERS };

// Fresh per-layer UI state (all off, each at its default opacity).
export const defaultOverlayState = () => {
  const o = {};
  Object.entries(ALL_LAYERS).forEach(([k, cfg]) => { o[k] = { on: false, opacity: cfg.opacity ?? 0.8 }; });
  return o;
};

export const jurisdictionFor = (county) => JURISDICTION_LAYERS[county] || null;

/* Reconcile the live esri layers on `map` with the `overlays` state. `refs` is a
 * plain object (id→layer) the caller owns across renders. Creates a dedicated
 * pane above the imagery tiles but below vector/SVG content. */
export function syncOverlayLayers(map, overlays, refs, { pane = "envpane", paneZ = 350, onError } = {}) {
  if (!map) return;
  if (!map.getPane(pane)) map.createPane(pane).style.zIndex = paneZ;
  Object.entries(ALL_LAYERS).forEach(([k, cfg]) => {
    const st = overlays[k], cur = refs[k];
    if (!st) return;
    if (st.on && !cur) {
      const opts = { url: cfg.url, opacity: st.opacity, pane, f: "image" };
      if (cfg.layers) opts.layers = cfg.layers; // omit → server shows all sub-layers
      const lyr = EL.dynamicMapLayer(opts);
      if (onError) lyr.on("requesterror", () => onError(cfg));
      lyr.addTo(map);
      refs[k] = lyr;
    } else if (!st.on && cur) {
      try { map.removeLayer(cur); } catch (_) {}
      refs[k] = null;
    } else if (cur) {
      cur.setOpacity(st.opacity);
    }
  });
}
