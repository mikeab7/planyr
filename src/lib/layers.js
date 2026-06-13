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
import { overpassLayer, mapillaryLayer } from "./evidenceLayers.js";

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

/* Utility-evidence layers — power & hydrant evidence from crowd/agency sources,
 * for siting around overhead electric and fire protection. LIVE, view-driven
 * (OSM/Mapillary refetch as you pan); HIFLD/COH are agency image services. Each
 * declares a `kind` the sync helper dispatches on. Shown on both pages. */
export const EVIDENCE = {
  osm_power: {
    kind: "overpass", label: "Power lines & poles (OSM)", opacity: 0.9,
    query: { lines: true, poles: true, substations: true },
    note: "OpenStreetMap — transmission solid, distribution dashed; poles/towers as dots. Loads at zoom ≥ 14.",
  },
  osm_hydrants: {
    kind: "overpass", label: "Fire hydrants (OSM)", opacity: 0.9,
    query: { hydrants: true },
    note: "OpenStreetMap fire hydrants. Loads at zoom ≥ 14.",
  },
  mapillary: {
    kind: "mapillary", label: "Street-level detections (Mapillary)", opacity: 0.95,
    note: "Crowdsourced pole/hydrant detections — needs a free Mapillary token (set below). Loads at zoom ≥ 16.",
  },
  hifld_tx: {
    kind: "esriFeature", label: "Transmission lines (HIFLD)",
    // US DOE / NETL hosted HIFLD transmission lines (layer 18) — vector, crisp at
    // any zoom, on a federal-government server. Loads zoomed in (national dataset).
    url: "https://arcgis.netl.doe.gov/server/rest/services/Hosted/Energy_Transition_Atlas_493d6/FeatureServer/18",
    minZoom: 10, color: "#b91c1c", weight: 2.4, opacity: 0.9,
    note: "HIFLD ≥69 kV electric transmission (US DOE/NETL). Loads at zoom ≥ 10; verify live.",
  },
  coh_hydrants: {
    kind: "dynamic", label: "Fire hydrants (City of Houston)",
    url: "https://mycity2.houstontx.gov/pubgis02/rest/services/HoustonMap/Public_safety/MapServer",
    layers: [9], opacity: 0.95, county: "harris",
    note: "City of Houston Public Works fire hydrants.",
  },
  elevation: {
    kind: "esriImage", label: "Elevation / hillshade (USGS 3DEP)",
    url: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer",
    rendering: "Elevation Tinted Hillshade", opacity: 0.55,
    note: "USGS 3DEP LiDAR bare-earth DEM — screening only, verify with survey. The cross-section tool samples it.",
  },
};

// Flatten the per-jurisdiction registry into id→config (tagged with its county),
// then merge with the statewide overlays. The sync helper manages every layer by
// id, so a layer keeps its toggle state across county switches; the sidebar only
// LISTS the ones for the current jurisdiction.
export const JLAYERS = {};
Object.entries(JURISDICTION_LAYERS).forEach(([cty, j]) =>
  Object.entries(j.layers || {}).forEach(([id, cfg]) => { JLAYERS[id] = { ...cfg, county: cty }; }));

export const ALL_LAYERS = { ...STATEWIDE, ...EVIDENCE, ...JLAYERS };

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
      let lyr;
      if (cfg.kind === "overpass") lyr = overpassLayer(cfg.query);
      else if (cfg.kind === "mapillary") lyr = mapillaryLayer();
      else if (cfg.kind === "esriImage") { // esri ImageServer (e.g. 3DEP elevation, hillshade)
        const opts = { url: cfg.url, opacity: st.opacity, pane };
        if (cfg.rendering) opts.renderingRule = { rasterFunction: cfg.rendering };
        lyr = EL.imageMapLayer(opts);
        if (onError) lyr.on("requesterror", () => onError(cfg));
      }
      else if (cfg.kind === "esriFeature") { // vector feature service (crisp, attribute-rich)
        lyr = EL.featureLayer({
          url: cfg.url, pane, minZoom: cfg.minZoom ?? 10, interactive: false,
          style: () => ({ color: cfg.color || "#b91c1c", weight: cfg.weight || 2, opacity: st.opacity, fillOpacity: 0 }),
        });
        lyr.setOpacity = (o) => { try { lyr.setStyle({ opacity: o }); } catch (_) {} };
        if (onError) lyr.on("requesterror", () => onError(cfg));
      } else { // image overlay (esri dynamic MapServer)
        const opts = { url: cfg.url, opacity: st.opacity, pane, f: "image" };
        if (cfg.layers) opts.layers = cfg.layers; // omit → server shows all sub-layers
        lyr = EL.dynamicMapLayer(opts);
        if (onError) lyr.on("requesterror", () => onError(cfg));
      }
      if (lyr.setOpacity) lyr.setOpacity(st.opacity);
      lyr.addTo(map);
      refs[k] = lyr;
    } else if (!st.on && cur) {
      try { map.removeLayer(cur); } catch (_) {}
      refs[k] = null;
    } else if (cur && cur.setOpacity) {
      cur.setOpacity(st.opacity);
    }
  });
}
