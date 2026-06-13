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
import { overpassLayer, mapillaryLayer, mapillaryToken } from "./evidenceLayers.js";

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
    // Canonical USFWS endpoint. The old www.fws.gov host redirects here, which
    // caused a double request every refresh — point straight at the real host.
    url: "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer",
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

const trimUrl = (u) => String(u || "").replace(/\/+$/, "");

// fetch with exponential backoff on transient failures (429/5xx + network errors).
export async function fetchWithRetry(url, opts = {}, tries = 3) {
  let delay = 400;
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok || ![429, 500, 502, 503, 504].includes(r.status) || i >= tries - 1) return r;
    } catch (e) {
      if (i >= tries - 1) throw e;
    }
    await new Promise((res) => setTimeout(res, delay));
    delay *= 2;
  }
}

/* Probe an ArcGIS service root for health. ArcGIS returns HTTP 200 with a JSON
 * error body when a service is missing/stopped, so we parse and treat a present
 * `.error` as a failure (surfacing the server's message). Cached with a short TTL
 * so re-probing is cheap and stopped services self-heal on the next probe. */
const PROBE_TTL = 40000;
const _probeCache = new Map(); // url -> { ok, error, ts }
export async function probeService(url) {
  const key = trimUrl(url);
  const hit = _probeCache.get(key);
  if (hit && Date.now() - hit.ts < PROBE_TTL) return hit;
  let result;
  try {
    const r = await fetchWithRetry(`${key}?f=json`, {}, 3);
    if (!r.ok) result = { ok: false, error: `HTTP ${r.status}` };
    else {
      const j = await r.json().catch(() => ({}));
      result = j && j.error
        ? { ok: false, error: j.error.message || `service error ${j.error.code || ""}`.trim() }
        : { ok: true, error: null };
    }
  } catch (e) {
    result = { ok: false, error: /failed to fetch|networkerror|load failed/i.test(String(e?.message)) ? "network / CORS error" : (e?.message || "request failed") };
  }
  result.ts = Date.now();
  _probeCache.set(key, result);
  return result;
}

/* Reconcile the live esri/vector layers on `map` with the `overlays` state. `refs`
 * is a plain object (id→layer) the caller owns across renders.
 *   onStatus(id, state, msg): "loading" | "loaded" | "empty" | "failed" | null(off)
 *   onError(cfg, msg): user-facing toast on any failure.
 * Image/feature layers are health-PROBED first (catches 200-with-error-body), and
 * nothing is added until the map has a real, non-zero size (kills the degenerate
 * zero-area export esri-leaflet fires before the map is ready). */
export function syncOverlayLayers(map, overlays, refs, opts = {}) {
  const { pane = "envpane", paneZ = 350, onError, onStatus } = opts;
  if (!map) return;
  // wait for a ready, non-zero-size map before adding raster layers
  if (!map._loaded) { map.whenReady(() => syncOverlayLayers(map, overlays, refs, opts)); return; }
  const sz = map.getSize ? map.getSize() : { x: 1, y: 1 };
  if (!sz.x || !sz.y) {
    if (!map.__overlayWait) {
      map.__overlayWait = true;
      const retry = () => { map.__overlayWait = false; map.off("resize", retry); syncOverlayLayers(map, overlays, refs, opts); };
      map.on("resize", retry);
    }
    return;
  }
  if (!map.getPane(pane)) map.createPane(pane).style.zIndex = paneZ;
  const fail = (k, cfg, msg) => { refs[k] = null; onStatus && onStatus(k, "failed", msg); onError && onError(cfg, msg); };

  Object.entries(ALL_LAYERS).forEach(([k, cfg]) => {
    const st = overlays[k], cur = refs[k];
    if (!st) return;
    if (st.on && !cur) {
      refs[k] = "pending";
      onStatus && onStatus(k, "loading");
      const report = (s, msg) => onStatus && onStatus(k, s, msg);
      if (cfg.kind === "overpass") {
        const lyr = overpassLayer(cfg.query, report);
        lyr.setOpacity(st.opacity); lyr.addTo(map); refs[k] = lyr;
      } else if (cfg.kind === "mapillary") {
        if (!mapillaryToken()) { fail(k, cfg, "Add a Mapillary token to enable this layer."); return; }
        const lyr = mapillaryLayer(report);
        lyr.setOpacity(st.opacity); lyr.addTo(map); refs[k] = lyr;
      } else {
        // image / feature service — probe health first
        probeService(cfg.url).then(({ ok, error }) => {
          if (refs[k] !== "pending") return; // toggled off while probing
          if (!ok) return fail(k, cfg, `${cfg.label}: ${error}`);
          let lyr;
          if (cfg.kind === "esriImage") {
            const o = { url: cfg.url, opacity: st.opacity, pane };
            if (cfg.rendering) o.renderingRule = { rasterFunction: cfg.rendering };
            lyr = EL.imageMapLayer(o);
          } else if (cfg.kind === "esriFeature") {
            lyr = EL.featureLayer({ url: cfg.url, pane, minZoom: cfg.minZoom ?? 10, interactive: false, style: () => ({ color: cfg.color || "#b91c1c", weight: cfg.weight || 2, opacity: st.opacity, fillOpacity: 0 }) });
            lyr.setOpacity = (oo) => { try { lyr.setStyle({ opacity: oo }); } catch (_) {} };
          } else {
            const o = { url: cfg.url, opacity: st.opacity, pane, f: "image" };
            if (cfg.layers) o.layers = cfg.layers;
            lyr = EL.dynamicMapLayer(o);
          }
          lyr.on("requesterror", (e) => fail(k, cfg, `${cfg.label}: ${e && e.message ? e.message : "request error"}`));
          lyr.on("load", () => onStatus && onStatus(k, "loaded"));
          if (lyr.setOpacity) lyr.setOpacity(st.opacity);
          lyr.addTo(map); refs[k] = lyr; onStatus && onStatus(k, "loaded");
        });
      }
    } else if (!st.on && cur) {
      if (cur !== "pending") { try { map.removeLayer(cur); } catch (_) {} }
      refs[k] = null; onStatus && onStatus(k, null);
    } else if (cur && cur !== "pending" && cur.setOpacity) {
      cur.setOpacity(st.opacity);
    }
  });
}
