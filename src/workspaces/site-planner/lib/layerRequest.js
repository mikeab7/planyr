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

/* Export-time request for a RASTER overlay (B739) — a dynamic MapServer `/export` or an
 * ImageServer `/exportImage`. Derived from the SAME option shapers the live layer uses
 * (dynamicLayerOptions / imageLayerOptions) so the printed image can never drift from the
 * on-screen render (PDF-PARITY). Returns the proxied-or-direct service ROOT, the direct-agency
 * root (a CORS fallback for the export inliner), the endpoint, the `layers=show:` param
 * (null ⇒ the server renders all sublayers, matching the `if (cfg.layers)` guard above), and
 * the renderingRule (esriImage only). Pure — no leaflet/esri import. */
export function overlayExportRequest(cfg, { proxy = false } = {}) {
  const isImage = cfg.kind === "esriImage";
  const url = layerUrl(cfg, proxy);
  const endpoint = isImage ? "exportImage" : "export";
  if (isImage) {
    const { renderingRule } = imageLayerOptions(cfg, 1, null, { proxy });
    return { url, direct: cfg.url, endpoint, layersParam: null, renderingRule: renderingRule ?? null };
  }
  const { layers } = dynamicLayerOptions(cfg, 1, null, { proxy });
  return { url, direct: cfg.url, endpoint, layersParam: layers ? `show:${layers.join(",")}` : null, renderingRule: null };
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

/* How long a toggled-on RASTER export waits for its <img> to actually land before the panel
 * tells the truth (NEW-3/B790). Generous, so a healthy-but-slow source (or a big first-ever
 * export) virtually always fires 'load' well under it — only a genuine stall (a degraded agency
 * that returns no bytes and, crucially, fires NO error event) trips it. Not a hard timeout: a
 * later 'load' still flips the row back to "loaded". */
export const RASTER_STALL_MS = 15000;

/* Honest per-layer status wiring for a raster export layer (NEW-3/B790), kept pure of
 * leaflet/esri so it unit-tests with a fake emitter + injected timer.
 *
 * THE BUG THIS FIXES: a raster overlay used to report "loaded" (blue dot) the instant it was
 * added — BEFORE the server-rendered <img> arrived. When the agency was degraded (FEMA's NFHL
 * held/killed exports for 20–30 s in the 2026-07-11 slowdown) the picture never came, esri-leaflet
 * fired NO error for the silent hang, and the row sat on a false "loaded" over a blank map — the
 * owner's exact complaint ("showing blue as if it's working, but it's not").
 *
 * The honest machine: start at "loading"; only a real 'load' event → "loaded"; a STALL WATCHDOG
 * flips to amber "slow" ("source slow or unavailable — data may be missing") when no 'load' lands
 * within `stallMs`; a real error event → "failed" (or, on the proxy, one proxy→direct fallback
 * first). Amber (not red) for a stall: RED is reserved for a genuine error, and a hang is "we don't
 * know yet — it's just too slow," which is retryable. A later 'load' clears "slow" back to "loaded".
 *
 *   layer     — a leaflet/esri layer (duck-typed: `.on(event, fn)` + a writable `.onRemove`).
 *   k, label  — the overlay id + user-facing label (for onStatus + the message).
 *   proxy     — is this the B445 cache-proxy layer (vs the direct-agency one)?
 *   onStatus(id, state, msg) — the panel status channel.
 *   reportAge()             — called after a proxy 'load' to surface the cached-copy age.
 *   onProxyFallback()       — called ONCE on a proxy requesterror to swap to the direct layer
 *                             (the leaflet-specific remove/build/add lives in the caller).
 *   isActive()              — true while `layer` is still the current ref for `k`; gates a late
 *                             watchdog/error callback so it can't touch a since-removed layer.
 *   stallMs, setTimer, clearTimer — injectable for tests (no real timers).
 */
export function wireRasterStatus(layer, {
  k, label, proxy = false, onStatus = () => {}, reportAge = () => {},
  onProxyFallback = null, isActive = () => true,
  stallMs = RASTER_STALL_MS, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let fellBack = false, settled = false, stall = null;
  const clearStall = () => { if (stall != null) { clearTimer(stall); stall = null; } };
  const armStall = () => {
    clearStall();
    stall = setTimer(() => {
      stall = null;
      if (isActive() && !settled) {
        onStatus(k, "slow", `${label}: source slow or unavailable — the map may be missing data here (screening only).`);
      }
    }, stallMs);
  };
  // Clear a pending watchdog when the layer is removed (toggled off / swapped out), so it can't
  // fire onStatus on a detached layer — the B557 onRemove-cleanup pattern.
  const origOnRemove = layer.onRemove;
  layer.onRemove = function (m) { clearStall(); if (origOnRemove) return origOnRemove.call(this, m); };
  // 'load' = the export <img> landed → loaded; ask the proxy how old the served copy is.
  layer.on("load", () => { settled = true; clearStall(); onStatus(k, "loaded"); if (proxy) reportAge(); });
  // esri-leaflet re-fires 'loading' when it re-requests (pan/zoom); re-arm the watchdog and drop
  // back to neutral "loading" so a stale "slow" can clear itself once the source recovers.
  layer.on("loading", () => { settled = false; onStatus(k, "loading"); armStall(); });
  // A requesterror on an image/dynamic layer is often a NON-fatal hiccup — e.g. a CORS-blocked
  // metadata fetch while the f=image export still renders via a CORS-exempt <img>. On the proxy,
  // fall back ONCE to the direct agency URL (harmless = prior behavior). Otherwise "failed"
  // (esri's own text wrongly fingers "CORS"/"could not parse JSON" even when the host is just
  // down — so we stay plain).
  layer.on("requesterror", () => {
    if (proxy && !fellBack && onProxyFallback && isActive()) {
      fellBack = true; clearStall();
      onProxyFallback();
      return;
    }
    settled = true; clearStall();
    onStatus(k, "failed", `${label}: the map service is not responding — it may be temporarily unavailable (screening only).`);
  });
  armStall();
  return { clearStall };
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
