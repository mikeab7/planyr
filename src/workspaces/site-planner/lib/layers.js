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
import { JURISDICTION_SOURCES, ETJ_SOURCES, roadAuthorityStyle, ROAD_AUTHORITY_LEGEND } from "./jurisdiction.js";
import { overpassLayer, mapillaryLayer } from "./evidenceLayers.js";
import {
  isTransientStatus, dynamicLayerOptions, imageLayerOptions, featureLayerOptions, featureRetryDecision,
} from "./layerRequest.js";
import { proxyServiceUrl } from "../../../shared/gis/gisProxyCore.js";

export { JURISDICTION_LAYERS };

/* Should raster (export-image) layers go through the same-origin Drive-backed cache proxy
 * (B445)? Default ON; an explicit VITE_GIS_PROXY=0/false/off is the kill switch. Safe to leave
 * on everywhere: the proxy fails open (302 → agency) and the client also one-shot falls back to
 * the direct agency URL if the proxy isn't serving (e.g. not deployed), so a layer always renders
 * — caching is a pure enhancement on top. */
function gisProxyEnabled() {
  try {
    const v = import.meta.env && import.meta.env.VITE_GIS_PROXY;
    return v !== "0" && v !== "false" && v !== "off";
  } catch (_) { return true; }
}

/* Best-effort "as of Xm ago" age for a proxied raster layer: read the image's current proxy
 * export URL, ask the proxy's ?meta=1 sidecar how old the cached copy is, and surface it through
 * the same onStatus {ts, stale} channel the panel already renders. Never throws; if the proxy
 * isn't serving or internals are unavailable, the layer just shows no age (no regression). */
function reportCacheAge(lyr, k, onStatus) {
  try {
    const u = lyr && lyr._currentImage && lyr._currentImage._url;
    if (!u || u.indexOf("/api/gis-cache/") === -1) return;
    const metaUrl = u + (u.indexOf("?") === -1 ? "?" : "&") + "meta=1";
    fetch(metaUrl)
      .then((r) => (r && r.ok ? r.json() : null))
      .then((m) => { if (m && m.cached && typeof m.ts === "number" && lyr && lyr._map) onStatus && onStatus(k, "loaded", null, { ts: m.ts, stale: !!m.stale }); }) // B557: lyr._map guard — don't report age on a since-removed layer
      .catch(() => {});
  } catch (_) { /* age is optional */ }
}

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
    kind: "dynamic", label: "Wetlands (NWI)",
    // CRISP VECTOR NWI — the look of the official USFWS Wetlands Mapper (true polygon outlines +
    // Cowardin class labels like PFO1A / PSS1A / PUBH), NOT a coarse raster. History: the old vector
    // host (fwspublicservices.wim.usgs.gov/wetlandsmapservice/…/Wetlands/MapServer) went down 2026-06
    // with a hard HTTP 500 across its whole catalog (B129) and is STILL 500. The new host
    // fwsprimary.wim.usgs.gov is mid-migration: its public /server/…/Wetlands/MapServer is an empty
    // dynamic shell (export + query both 500), and its Wetlands_Raster/ImageServer renders but is a
    // 100-m-per-pixel raster — it paints wetlands as ugly ~100 m BLOCKS, not real shapes (B133 shipped
    // that by mistake; B134 fixes it). The actual crisp vector polygons live in the staging service
    // Test/Wetlands_gdb_split/MapServer: layer 0 ("Wetlands") is empty; the data is split into layer
    // 1 = Wetlands_CONUS_East and layer 2 = Wetlands_CONUS_West, so we request layers:[1,2] (covers
    // the whole lower-48; Texas is in West). It's a dynamicMapLayer (esri /export f=image), like FEMA
    // — verified 2026-06-17 in a real browser: the layers=show:1,2 export returns HTTP 200 image/png
    // with true-shape polygons + labels over Sheldon Lake, and the host is CORS-clean (echoes
    // Access-Control-Allow-Origin: https://planyr.io). Source-scale-gated (layer minScale ~1:250k) —
    // like FEMA, zoom in to about city level to see polygons. CAVEAT: "Test/" is a USFWS STAGING path
    // during their host migration; it may be renamed/removed when the production Wetlands/MapServer is
    // repopulated (revisit then, or if fwspublicservices recovers). If it dies, the honest "service
    // unavailable" path (B129) still applies; the durable fix is a /server proxy through our own origin.
    url: "https://fwsprimary.wim.usgs.gov/server/rest/services/Test/Wetlands_gdb_split/MapServer",
    layers: [1, 2],
    note: "NWI is for screening only — not a jurisdictional determination.",
    opacity: 0.55,
  },
  txrrc_pipe: {
    label: "Pipelines (TxRRC)",
    // B517: repointed to the AUTHORITATIVE statewide RRC service — matches the GIS source
    // registry (sources.js `pipelines`) and the Site Analysis count path. The old Harris-County
    // republication (www.gis.hctx.net/.../TXRRC/Pipelines) is ~99.8% incomplete outside Harris,
    // so the MAP overlay silently under-painted (a false all-clear on Chambers/Gulf-coast sites)
    // while the analysis panel queried the right host — they now agree.
    url: "https://gis.rrc.texas.gov/server/rest/services/rrc_public/RRC_Public_Viewer_Srvs/MapServer",
    layers: [13], // Pipelines (polyline) — the registry's brief-verified sublayer
    note: "RRC T-4 permit routes — schematic, not surveyed locations.",
    opacity: 0.9,
  },
  txrrc_wells: {
    label: "Oil & gas wells (TxRRC)",
    // B517: authoritative statewide RRC service (see txrrc_pipe). Was the Harris-clipped host.
    url: "https://gis.rrc.texas.gov/server/rest/services/rrc_public/RRC_Public_Viewer_Srvs/MapServer",
    layers: [1], // Well Locations (point); RRC symbology shows status
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
    // NEW-3/B285: plain-language name; the "Mapillary" brand is demoted to a small
    // source/attribution note (`source`) since the brand wasn't recognized.
    // B308: served for every visitor via the same-origin /api/mapillary proxy (token
    // held server-side), so it works with NO per-user token — `needsSetup` is gone.
    // If the proxy has no token (e.g. a preview deploy) the layer degrades gracefully.
    kind: "mapillary", label: "Poles & hydrants from street imagery",
    sublabel: "Detected in crowdsourced street-level photos.",
    source: "Mapillary", opacity: 0.95,
    note: "Pole & fire-hydrant detections from crowdsourced street-level photos. Loads at zoom ≥ 16.",
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

/* Jurisdiction BOUNDARY overlays (B176) — toggleable district lines for screening:
 * county, city limits, city ETJ, and MUD / water districts. County / city / ETJ reuse
 * the SAME verified endpoints the jurisdiction *identify* uses (lib/jurisdiction.js), so
 * a boundary you see is the boundary the identify reports — one source of truth.
 *
 * ⚠ A boundary means the district HAS JURISDICTION there (it can tax / regulate) — it
 * does NOT mean the district physically serves or connects water/sewer to a parcel.
 * Service area ≠ taxing/authority boundary. Labelled so a MUD outline never reads as
 * "a MUD provides water here." Screening only — verify with the district. */
const HGAC_ETJ = ETJ_SOURCES.find((s) => s.id === "etj_hgac");
export const JURISDICTIONS = {
  jur_county: {
    kind: "esriFeature", label: "County boundaries",
    url: JURISDICTION_SOURCES.county.url, minZoom: 6, color: "#374151", weight: 2.4, opacity: 0.85,
    note: "Texas county lines (TxDOT). A has-jurisdiction boundary, not a service area. Screening only — verify with the jurisdiction.",
  },
  jur_city: {
    kind: "esriFeature", label: "City limits",
    url: JURISDICTION_SOURCES.city.url, minZoom: 9, color: "#1d4ed8", weight: 1.8, opacity: 0.85,
    note: "Texas city limits (TxGIO). Inside = in the city; a parcel in no city is unincorporated. The boundary is jurisdiction, NOT proof of utility service. Screening only.",
  },
  jur_etj: {
    kind: "esriFeature", label: "City ETJ (Houston region)",
    url: HGAC_ETJ.url, minZoom: 9, color: "#7c3aed", weight: 1.6, opacity: 0.85,
    note: "City extraterritorial jurisdiction across the H-GAC 13-county region (blank elsewhere — there is no statewide ETJ layer). ETJ = a city's reach OUTSIDE its limits; not annexation and not utility service. Screening only.",
  },
  jur_mud: {
    // Statewide MUD / WCID / water-district boundaries from TCEQ (the agency with
    // supervisory authority over Texas water districts), republished by HARC (Houston
    // Advanced Research Center) — this is the data behind TCEQ's public Water Districts
    // Map Viewer (tceq.texas.gov/gis/iwudview.html), so it covers Harris + Fort Bend +
    // statewide, not just one county. A `dynamic` image export renders via a CORS-exempt
    // <img>, so it paints even where the probe can't reach the host; the probe + per-layer
    // status still flag a genuine outage honestly. (harcresearch.org on the env egress
    // allowlist since 2026-06-19; MUD tile paint verified headless from a fresh session
    // 2026-06-19 — V44 PASS, see VERIFICATION.md.)
    kind: "dynamic", label: "MUD / water districts (TCEQ, statewide)",
    url: "https://harcags.harcresearch.org/arcgisserver/rest/services/Boundaries/TCEQ_Water_Districts/MapServer", layers: null, opacity: 0.55,
    note: "Texas water-district BOUNDARIES — MUD / WCID / etc. (TCEQ, via HARC). Statewide coverage incl. Harris & Fort Bend. A boundary is a TAXING / authority district, NOT proof that water or sewer is connected to a parcel. Screening only — verify against the district / tax statement.",
  },
  jur_road_authority: {
    // NEW-2/B571 — the road-authority overlay: the actual fronting roads drawn and
    // COLORED BY MAINTAINER, so the Site Analysis "Road authority" card's call can be
    // confirmed against the map. Same TxDOT Roadway Inventory FeatureServer the identify
    // reads (one source of truth), drawn client-side as vector features (esriFeature) so
    // each segment is individually styled via roadAuthorityStyle — the SAME roadAuthority()
    // decode the card uses, no parallel mapping. Dense statewide data, so it's gated to
    // minZoom 14 (never paints at metro scale) and fetches only the two style fields;
    // esri-leaflet does its own viewport-bbox tiled fetching on top. Display-only screening
    // overlay on the EPSG:4326 basemap — never feeds the editable layer / measurements / the
    // 2278 site frame.
    kind: "esriFeature", label: "Road maintenance authority",
    url: JURISDICTION_SOURCES.road.url, minZoom: 14, weight: 3, opacity: 0.95,
    fields: ["OBJECTID", "RDWAY_MAINT_AGCY", "HSYS"],
    styleFn: roadAuthorityStyle, legend: ROAD_AUTHORITY_LEGEND,
    note: "Who maintains each road, from the TxDOT Roadway Inventory — City / County / State (TxDOT) / Toll / Federal, with an honest Unknown where the data can't classify it. Loads zoomed in to about street level (zoom ≥ 14). Screening only — verify the access/ROW desk with the jurisdiction.",
  },
};

// Flatten the per-jurisdiction registry into id→config (tagged with its county),
// then merge with the statewide overlays. The sync helper manages every layer by
// id, so a layer keeps its toggle state across county switches; the sidebar only
// LISTS the ones for the current jurisdiction.
export const JLAYERS = {};
Object.entries(JURISDICTION_LAYERS).forEach(([cty, j]) =>
  Object.entries(j.layers || {}).forEach(([id, cfg]) => { JLAYERS[id] = { ...cfg, county: cty }; }));

export const ALL_LAYERS = { ...STATEWIDE, ...JURISDICTIONS, ...EVIDENCE, ...JLAYERS };

/* NEW-5 (B236): per-layer SOURCE VINTAGE — the data's own effective / publication
 * date or maintenance cadence, as documented by the provider. This is the
 * decision-relevant "current as of" stamp, and is DELIBERATELY DISTINCT from
 * "last refreshed" (when WE pulled the copy — that rides the gisCache age, and
 * only becomes meaningful once caching lands; until then a fetch is effectively
 * live). Honest by rule: where a source has no single date — per-panel FIRMs,
 * per-area LiDAR, continuously-maintained registries — we SAY SO rather than
 * invent one, and a layer with no entry here renders "vintage unknown" (an honest
 * state, never a fabricated date). Keyed by layer id, so the per-county utility
 * layers (spread into JLAYERS) are covered too. When the GIS-cache work (B96)
 * lands, fold this together with the refreshed-age stamp into one surface. */
export const LAYER_VINTAGE = {
  // Statewide overlays
  fema: "Effective date varies by FIRM panel",
  wetlands: "Survey date varies by NWI project area",
  txrrc_pipe: "RRC permit data — continuously updated",
  txrrc_wells: "RRC permit data — continuously updated",
  // Utility evidence
  osm_power: "OpenStreetMap — community-edited, live",
  osm_hydrants: "OpenStreetMap — community-edited, live",
  mapillary: "Capture date varies by street",
  hifld_tx: "HIFLD (US DOE/NETL) — periodically updated",
  coh_hydrants: "City of Houston Public Works — current edition",
  elevation: "LiDAR collection varies by county (USGS 3DEP)",
  // Jurisdiction boundaries
  jur_county: "TxDOT county boundaries — current edition",
  jur_city: "TxGIO city limits — current edition",
  jur_etj: "H-GAC ETJ — current edition",
  jur_mud: "TCEQ water districts (via HARC) — current edition",
  jur_road_authority: "TxDOT Roadway Inventory — current edition",
  // Per-county utility layers
  hcfcd_row: "HCFCD channels & ROW — current edition",
  coh_ww: "City of Houston GIS (test host) — current edition",
  coh_storm: "City of Houston GIS (test host) — current edition",
  coh_water: "City of Houston GIS (test host) — current edition",
  fb_contours: "Fort Bend Drainage District — current edition",
};
// A layer's vintage: an explicit per-config override wins; else the central map;
// else null → the UI shows the honest "vintage unknown".
export const layerVintage = (id, cfg) => (cfg && cfg.vintage) || LAYER_VINTAGE[id] || null;

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
      if (r.ok || !isTransientStatus(r.status) || i >= tries - 1) return r;
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
// One ?f=json read of a service root → a typed health result. Pulled out of probeService so the
// SAME parse can run against the direct URL or the proxy URL (B469/NEW-6). Never throws.
async function probeOnce(probeUrl) {
  try {
    const r = await fetchWithRetry(probeUrl, {}, 3);
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const j = await r.json().catch(() => ({}));
    return j && j.error
      ? { ok: false, error: j.error.message || `service error ${j.error.code || ""}`.trim() }
      // Capture the service's own data extent (fullExtent, or `extent` on a FeatureServer/layer)
      // straight from the health probe — the coverage engine (NEW-1/B283) reprojects it to test
      // whether this layer's data reaches the view. No extra request: it's in this same response.
      : { ok: true, error: null, fullExtent: (j && (j.fullExtent || j.extent)) || null };
  } catch (e) {
    // The fetch threw — we couldn't even reach the service to health-check it (CORS, network, or
    // timeout). Flag `unreachable` so a caller can still optimistically add an image layer: its
    // f=image export renders via a CORS-exempt <img>, which loads even when a cross-origin fetch
    // is refused. A truly-down service surfaces via the layer's own requesterror instead.
    return { ok: false, unreachable: true, error: /failed to fetch|networkerror|load failed/i.test(String(e?.message)) ? "network / CORS error" : (e?.message || "request failed") };
  }
}
export async function probeService(url) {
  const key = trimUrl(url);
  const hit = _probeCache.get(key);
  if (hit && Date.now() - hit.ts < PROBE_TTL) return hit;
  let result = await probeOnce(`${key}?f=json`);
  // B469/NEW-6 — a county/agency host that omits CORS headers (e.g. Fort Bend FLOODZONE,
  // arcgisweb.fortbendcountytx.gov) makes the DIRECT probe throw, so the layer's health + coverage
  // extent could never be read. Retry through the same-origin B445 cache proxy, which fetches the
  // service server-side (no CORS wall) and returns the JSON same-origin. Direct-FIRST so the many
  // CORS-clean hosts take no extra hop and never depend on the proxy being deployed; the proxy
  // retry fires ONLY on an actual unreachable/CORS failure (so dev, where the proxy 404s, safely
  // keeps the direct unreachable result and the layer is still added optimistically).
  if (gisProxyEnabled() && !result.ok && result.unreachable) {
    const viaProxy = await probeOnce(`${proxyServiceUrl(key)}?f=json`);
    if (viaProxy.ok) result = viaProxy;
  }
  result.ts = Date.now();
  _probeCache.set(key, result);
  return result;
}

/* esri-leaflet FeatureLayer retry/backoff (NEW-5/B287). Wires the pure retry policy
 * (featureRetryDecision in layerRequest.js) onto a live FeatureLayer: esri-leaflet
 * issues its own GeoJSON queries with no retry of its own, so a single transient
 * 5xx/429 (or a codeless network/CORS blip) on a jurisdiction vector service — City ETJ
 * (H-GAC), County boundaries (TxDOT) — would otherwise drop the whole layer to "failed"
 * (both threw transient 503s live 2026-06-20). Re-issue via refresh() with exponential
 * backoff; hold the dot at "loading" while retrying; report "failed" only once we give
 * up; a successful 'load' resets the counter. */
export function attachFeatureRetry(lyr, k, cfg, onStatus, max = 3) {
  let tries = 0, timer = null;
  // B557: clear a pending retry timer when the layer is removed (toggled off), so a backoff
  // setTimeout can't fire refresh() on a detached layer. Wrap onRemove (Leaflet calls it on
  // map.removeLayer) and chain the original. Matches the evidenceLayers.js onRemove cleanup pattern.
  const origOnRemove = lyr.onRemove;
  lyr.onRemove = function (map) { clearTimeout(timer); if (origOnRemove) return origOnRemove.call(this, map); };
  lyr.on("load", () => { tries = 0; onStatus && onStatus(k, "loaded"); });
  lyr.on("requesterror", (e) => {
    const code = e && e.error && (e.error.code ?? e.error.httpStatus);
    const { retry, delayMs } = featureRetryDecision(code, tries, max);
    if (retry) {
      tries += 1;
      onStatus && onStatus(k, "loading", `${cfg.label}: service hiccup — retrying (${tries}/${max})…`);
      clearTimeout(timer);
      timer = setTimeout(() => { try { lyr.refresh(); } catch (_) {} }, delayMs);
    } else {
      onStatus && onStatus(k, "failed", `${cfg.label}: the map service is not responding — it may be temporarily unavailable (screening only).`);
    }
  });
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
        // B308: served via the same-origin /api/mapillary proxy (token held server-side),
        // so the layer loads for every visitor with NO per-user token. mapillaryLayer
        // reports a quiet "unconfigured" (gray) only if the proxy itself has no server
        // token (e.g. a preview deploy) — never a hard failure, never an error toast.
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
          if (cfg.kind === "esriFeature") {
            lyr = EL.featureLayer(featureLayerOptions(cfg, st.opacity, pane));
            // A per-feature-styled layer (road authority) must re-derive its WHOLE style on an
            // opacity change — re-applying the style function (not a flat {opacity}) so the
            // per-maintainer colors survive AND newly fetched tiles keep them. A flat-styled
            // layer just merges the new opacity.
            lyr.setOpacity = typeof cfg.styleFn === "function"
              ? (oo) => { try { const sf = (f) => cfg.styleFn(f && f.properties, oo); lyr._originalStyle = sf; lyr.setStyle(sf); } catch (_) {} }
              : (oo) => { try { lyr.setStyle({ opacity: oo }); } catch (_) {} };
            // FeatureServer GeoJSON queries get retry/backoff (NEW-5/B287): esri-leaflet
            // won't retry its own request, so a transient 5xx/blip on City ETJ or County
            // boundaries would otherwise drop the layer on a single hiccup.
            attachFeatureRetry(lyr, k, cfg, onStatus);
            if (lyr.setOpacity) lyr.setOpacity(st.opacity);
            lyr.addTo(map); refs[k] = lyr; onStatus && onStatus(k, "loaded");
          } else {
            // Raster export-image layer (FEMA/wetlands/utilities). Route it through the B445
            // cache proxy by default; build a direct-to-agency layer as the fallback.
            const useProxy = gisProxyEnabled();
            const buildRaster = (proxy) => (cfg.kind === "esriImage"
              ? EL.imageMapLayer(imageLayerOptions(cfg, st.opacity, pane, { proxy }))
              : EL.dynamicMapLayer(dynamicLayerOptions(cfg, st.opacity, pane, { proxy })));
            const wireRaster = (l, proxy) => {
              let fellBack = false;
              // 'load' = the export <img> landed → loaded; ask the proxy how old the copy is.
              l.on("load", () => { onStatus && onStatus(k, "loaded"); if (proxy) reportCacheAge(l, k, onStatus); });
              // A requesterror on an image/dynamic layer is often a NON-fatal hiccup — e.g. a
              // CORS-blocked metadata fetch while the f=image export still renders via a
              // CORS-exempt <img>. If we're on the proxy and it isn't serving here (e.g. not
              // deployed), fall back ONCE to the direct agency URL — harmless (= prior behavior),
              // and the cache simply doesn't apply in that environment. Otherwise surface a quiet
              // per-layer status without dropping the layer (esri's own text wrongly fingers
              // "CORS"/"could not parse JSON" even when the host is just down — so we stay plain).
              l.on("requesterror", () => {
                if (proxy && !fellBack && refs[k] === l) {
                  fellBack = true;
                  try { map.removeLayer(l); } catch (_) {}
                  const direct = buildRaster(false);
                  wireRaster(direct, false);
                  if (direct.setOpacity) direct.setOpacity(st.opacity);
                  direct.addTo(map); refs[k] = direct; onStatus && onStatus(k, "loaded");
                  return;
                }
                onStatus && onStatus(k, "failed", `${cfg.label}: the map service is not responding — it may be temporarily unavailable (screening only).`);
              });
            };
            lyr = buildRaster(useProxy);
            wireRaster(lyr, useProxy);
            if (lyr.setOpacity) lyr.setOpacity(st.opacity);
            lyr.addTo(map); refs[k] = lyr; onStatus && onStatus(k, "loaded");
          }
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
