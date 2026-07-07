/* Pure request-shaping + transient-retry policy for the shared map layers.
 *
 * Split out of layers.js so it carries NO leaflet / esri-leaflet import and is
 * unit-testable in the node test env. layers.js (which owns the live leaflet layers)
 * imports from here.
 *
 * HARD RULE (NEW-1/B283): the option builders take a layer config + opacity and NOTHING
 * about coverage. Coverage is a PICKER-ONLY signal — it can never narrow a turned-on
 * layer's sublayers / bbox / where. A City-of-Houston utility layer always requests its
 * FULL pinned sublayer set for the whole view, in or out of coverage. There is no
 * coverage parameter here by construction; test/coverage.test.js locks it down.
 */
import { proxyServiceUrl } from "../../../shared/gis/gisProxyCore.js";

// Route a service URL through the same-origin Drive-backed cache proxy (B445) when asked. This
// is a pure TRANSPORT swap — the layer still requests its full pinned sublayer set for the whole
// view; the proxy only adds a durable copy + outage fallback in front (and fails open to the same
// upstream). Off → the original direct-to-agency URL, exactly as before.
const layerUrl = (cfg, proxy) => (proxy ? proxyServiceUrl(cfg.url) : cfg.url);

// The transient HTTP statuses worth a retry — 429 (rate-limited) + 5xx (server blips).
// One definition shared by fetchWithRetry (the ?f=json probe), withTileRetry (raster
// tiles), and the FeatureServer query retry (NEW-5/B287), so "what counts as a blip" is
// consistent across raster, metadata, and vector requests.
export const TRANSIENT_STATUS = [429, 500, 502, 503, 504];
export const isTransientStatus = (code) => TRANSIENT_STATUS.includes(Number(code));

/* esri dynamicMapLayer (server-rendered f=image export) options. The pinned `layers`
 * set is passed through WHOLE — never trimmed by anything (incl. coverage). */
export function dynamicLayerOptions(cfg, opacity, pane, { proxy = false } = {}) {
  const o = { url: layerUrl(cfg, proxy), opacity, f: "image" };
  if (pane) o.pane = pane;
  if (cfg.layers) o.layers = cfg.layers;
  return o;
}

/* esri imageMapLayer (ImageServer) options. `cfg.rendering` is either the NAME of a
 * server-published rasterFunction template (string — must match rasterFunctionInfos[].name
 * exactly, see the B603 warning in layers.js) or a WHOLE rendering-rule object (B703 —
 * a custom raster-function chain, e.g. the view-relative DRA stretch; passed through
 * verbatim, esri-leaflet JSON-serializes it into the exportImage request). */
export function imageLayerOptions(cfg, opacity, pane, { proxy = false } = {}) {
  const o = { url: layerUrl(cfg, proxy), opacity };
  if (pane) o.pane = pane;
  if (cfg.rendering) {
    o.renderingRule = typeof cfg.rendering === "string"
      ? { rasterFunction: cfg.rendering }
      : cfg.rendering;
  }
  return o;
}

/* esri featureLayer (vector FeatureServer) options. The style closure carries the
 * current opacity; nothing here filters features. A layer may supply a PER-FEATURE
 * `styleFn(props, opacity)` (e.g. road authority colored by maintainer) — then the
 * style is derived per feature from its attributes; otherwise a single flat style.
 * `cfg.fields` (optional) limits the attributes fetched (smaller payload for a dense
 * statewide layer); `cfg.minZoom` gates a dense layer so it never paints at metro scale. */
export function featureLayerOptions(cfg, opacity, pane) {
  const o = { url: cfg.url, pane, minZoom: cfg.minZoom ?? 10, interactive: false };
  if (cfg.fields) o.fields = cfg.fields;
  o.style = typeof cfg.styleFn === "function"
    ? (feature) => cfg.styleFn(feature && feature.properties, opacity)
    : () => ({ color: cfg.color || "#b91c1c", weight: cfg.weight || 2, opacity, fillOpacity: 0 });
  return o;
}

/* Retry policy for a FeatureServer `requesterror` (NEW-5/B287). esri-leaflet issues its
 * own GeoJSON queries with no retry, so a transient 5xx/429 (or a codeless network/CORS
 * blip) on a jurisdiction vector service would otherwise drop the layer on one hiccup.
 * Given the error's HTTP code (or null for a codeless blip) and how many retries already
 * happened, decide whether to retry and after what exponential backoff. A hard 4xx
 * (404/400) is permanent → no retry. Pure. */
export function featureRetryDecision(code, tries, max = 3) {
  const retryable = code == null || isTransientStatus(code);
  if (retryable && tries < max) return { retry: true, delayMs: 400 * 2 ** tries };
  return { retry: false, delayMs: 0 };
}
