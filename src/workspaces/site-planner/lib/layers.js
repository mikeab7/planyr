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
    // NFHL sublayers 27 (Flood Hazard Boundaries) + 28 (Flood Hazard Zones), standard
    // symbology. Both are scale-gated AT THE SOURCE (minScale ~1:36,112), so they only
    // draw once zoomed in to roughly neighbourhood level (~zoom 14+); at city-wide zoom
    // the export is a blank transparent PNG — that's expected, not a failure. Verified
    // rendering in a real browser 2026-06-17: teal AE floodplain / orange floodway / red
    // boundaries paint correctly along the bayous, and the host is CORS-clean (an
    // Access-Control-Allow-Origin header is present on both metadata and /export).
    layers: [27, 28],
    note: "Flood zones appear once you zoom in to about street level — hidden at city-wide zoom.",
    opacity: 0.55,
  },
  wetlands: {
    kind: "esriImage", label: "Wetlands (NWI)",
    // NWI moved hosts mid-2026. The old vector endpoint
    // (fwspublicservices.wim.usgs.gov/wetlandsmapservice/.../Wetlands/MapServer) went down
    // 2026-06 with a hard HTTP 500 across its WHOLE catalog — metadata, /export, /query, even
    // the REST root — an agency-side OUTAGE, not a CORS issue (B129). As of 2026-06-17 it is
    // still 500. The live data that the official USFWS Wetlands Mapper actually draws lives on
    // the sibling host fwsprimary.wim.usgs.gov — but at a DIFFERENT path AND as a pre-rendered
    // RASTER image service, NOT the old dynamic vector MapServer (B130's "same path, different
    // host" hunch was wrong on both counts): /server/rest/services/Wetlands_Raster/ImageServer.
    // So this is an esri imageMapLayer (kind:"esriImage"), like 3DEP — NOT a dynamicMapLayer
    // with layers:[0] (fwsprimary's vector MapServer/export returns an HTML interstitial and
    // its /query 500s; only the raster renders). Verified 2026-06-17 in a real headless browser:
    // esri-leaflet's imageMapLayer paints the standard NWI symbology (navy open water, greens
    // for vegetated wetlands) over Sheldon Lake, the exportImage request returns HTTP 200
    // image/png, and the host is CORS-clean for planyr.io (echoes Access-Control-Allow-Origin:
    // https://planyr.io), so it loads cross-site fine. Like FEMA, it's source-scale-gated — zoom
    // in (~14+) to see polygons. Raster = screening picture only, no click-identify (wetlands was
    // never queried). If fwsprimary ever refuses or dies, the honest "service unavailable" path
    // (B129) still applies; the durable fix is a /server proxy through our own origin.
    url: "https://fwsprimary.wim.usgs.gov/server/rest/services/Wetlands_Raster/ImageServer",
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

// Retry failed basemap tiles (429/5xx/transient) up to `max` times with backoff,
// by re-assigning the tile's src. Attach to any L.tileLayer.
export function withTileRetry(layer, max = 2) {
  layer.on("tileerror", (e) => {
    const t = e && e.tile; if (!t) return;
    const n = t._pfTries || 0; if (n >= max) return;
    t._pfTries = n + 1;
    setTimeout(() => { const s = t.src; t.src = ""; t.src = s; }, 500 * (n + 1));
  });
  return layer;
}

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
    // The fetch threw — we couldn't even reach the service to health-check it (CORS,
    // network, or timeout). Flag `unreachable` so a caller can still optimistically add
    // an image layer: its f=image export renders via a CORS-exempt <img>, which loads
    // even when a cross-origin fetch is refused. A truly-down service surfaces via the
    // layer's own requesterror instead.
    result = { ok: false, unreachable: true, error: /failed to fetch|networkerror|load failed/i.test(String(e?.message)) ? "network / CORS error" : (e?.message || "request failed") };
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
      const report = (s, msg, extra) => onStatus && onStatus(k, s, msg, extra); // extra carries data-age {ts,stale} for B75
      if (cfg.kind === "overpass") {
        const lyr = overpassLayer(cfg.query, report);
        lyr.setOpacity(st.opacity); lyr.addTo(map); refs[k] = lyr;
      } else if (cfg.kind === "mapillary") {
        if (!mapillaryToken()) { fail(k, cfg, "Add a Mapillary token to enable this layer."); return; }
        const lyr = mapillaryLayer(report);
        lyr.setOpacity(st.opacity); lyr.addTo(map); refs[k] = lyr;
      } else {
        // image / feature service — probe health first
        probeService(cfg.url).then(({ ok, error, unreachable }) => {
          if (refs[k] !== "pending") return; // toggled off while probing
          // A service that RESPONDED with an error truly failed → drop it. But if we
          // merely couldn't reach it to check (CORS/network → `unreachable`), add the
          // layer anyway: the f=image export renders via a CORS-exempt <img>, and a
          // genuinely-down service still surfaces through the layer's own requesterror.
          if (!ok && !unreachable) return fail(k, cfg, `${cfg.label}: ${error}`);
          if (!map || !map._loaded) { refs[k] = null; return; } // map torn down mid-probe — don't addTo a dead map (B55)
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
          // A requesterror is often a NON-fatal hiccup — e.g. a CORS-blocked metadata /
          // service-info fetch while the f=image export still renders via a CORS-exempt
          // <img>. Surface a quiet per-layer status, but DON'T drop the layer or fire the
          // alarming toast; the 'load' event below flips it back to "loaded" if the image
          // lands. (A genuinely-down service simply shows its quiet "failed" dot.)
          // esri's own requesterror text wrongly fingers "CORS" / "could not parse JSON"
          // even when the real cause is the agency host being down (a plain HTTP 500), so
          // surface a plain, honest status instead of esri's misleading message (verified
          // against NWI's 2026-06-17 outage). This is NOT necessarily fatal: the picture
          // loads via a CORS-exempt <img>, and the 'load' handler below flips the dot back
          // to "loaded" if it lands — so this message only persists for a service that is
          // genuinely unavailable.
          lyr.on("requesterror", () => onStatus && onStatus(k, "failed", `${cfg.label}: the map service is not responding — it may be temporarily unavailable (screening only).`));
          lyr.on("load", () => onStatus && onStatus(k, "loaded"));
          if (lyr.setOpacity) lyr.setOpacity(st.opacity);
          lyr.addTo(map); refs[k] = lyr; onStatus && onStatus(k, "loaded");
        }).catch((e) => { if (refs[k] === "pending") fail(k, cfg, `${cfg.label}: ${(e && e.message) || "probe failed"}`); }); // don't leak an unhandled rejection (B55)
      }
    } else if (!st.on && cur) {
      if (cur !== "pending") { try { map.removeLayer(cur); } catch (_) {} }
      refs[k] = null; onStatus && onStatus(k, null);
    } else if (cur && cur !== "pending" && cur.setOpacity) {
      cur.setOpacity(st.opacity);
    }
  });
}
