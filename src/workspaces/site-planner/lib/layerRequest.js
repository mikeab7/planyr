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
import { pipeSizeLabel } from "./desotoLayers.js"; // NEW-1 (DeSoto / Olive Branch) — the default formatter for a `lineLabel` row

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

/* The circleMarker options a POINT feature is drawn with (NEW-1). Pure — the leaflet
 * `pointToLayer` that consumes this lives in mapSymbols.js, which is the only module allowed
 * to import leaflet here.
 *
 * A point in a vector overlay MUST be given an explicit symbol. Left to Leaflet's default
 * (`L.marker` + `L.Icon.Default`) it paints the browser's broken-image glyph and the alt text
 * "Marker" — the owner's "Mark" artefact where the HIFLD substations should be. A filled disc
 * in the source's own colour is also the right cartography: it matches how evidenceLayers.js
 * already draws OSM power points, and it reads as a deliberate symbol rather than a pin
 * dropped by the user.
 *
 * `fillOpacity` tracks `opacity` so the panel's slider dims the whole symbol together, and a
 * `radius` a registry row may override (`cfg.pointRadius`) keeps a dense national point layer
 * from turning the view into confetti. */
export function pointSymbolOptions(cfg = {}, opacity = 1, props = null) {
  /* NEW-1 (Mississippi): a POINT row may colour each marker by its attributes through `pointStyleFn(props) → { color, radius? }` (an open-release tank is red, a plugged well grey). The
   * flat `cfg.color` stays the fallback and the colour of a row that declares no function, so every existing row draws exactly as before. Screen, hover restyle, the opacity setter and
   * the print path all pass the feature's properties here — one rule, so the legend and the map cannot disagree. */
  const ps = props && typeof cfg.pointStyleFn === "function" ? (cfg.pointStyleFn(props) || {}) : {};
  const color = ps.color || cfg.color || "#b91c1c";
  return {
    radius: ps.radius || cfg.pointRadius || 4,
    color,
    weight: cfg.weight || 2,
    opacity,
    fillColor: color,
    fillOpacity: opacity * 0.85,
  };
}

/* esri featureLayer (vector FeatureServer) options. The style closure carries the
 * current opacity; nothing here filters features. A layer may supply a PER-FEATURE
 * `styleFn(props, opacity)` (e.g. road authority colored by maintainer) — then the
 * style is derived per feature from its attributes; otherwise a single flat style.
 * `cfg.fields` (optional) limits the attributes fetched (smaller payload for a dense
 * statewide layer); `cfg.minZoom` gates a dense layer so it never paints at metro scale.
 *
 * `opts` (NEW-1/NEW-2), both supplied by layers.js's buildFeatureLayer:
 *   pointToLayer — REQUIRED in practice: without it a POINT feature falls back to Leaflet's
 *                  broken default marker (see pointSymbolOptions). Pure code can't build one
 *                  (it needs leaflet), so it is injected; `test/pointSymbology.test.js` locks
 *                  down that every live call site passes one.
 *   interactive  — enable pointer events so the hover identify can fire on the features. */
/* The label printed on a line (NEW-1, DeSoto / Olive Branch): the row's `lineLabel.field` read through `lineLabel.format` (default `pipeSizeLabel`, which cleans the
 * city's hand-typed sizes), or null when there is nothing worth printing. Pure. */
/* B2507064 (NEW-9) — THE DRAW BUDGET: no layer may freeze the tab. esri-leaflet asks a service for FULL-precision geometry and hands every vertex to Leaflet,
 * which builds one SVG path per feature; the Discover DeSoto layer was 12 polygons holding 707,071 vertices (one polygon 634,514; a 28 MB answer), and turning it
 * on zoomed out left Chrome on "Page Unresponsive" (measured live, ui-audit/verify-layer-no-freeze.mjs: the tab did not answer for the whole 160 s wait).
 * Work that is already inside Leaflet cannot be interrupted, so the guard sits BEFORE it: `countVertices` is a cheap walk over the GeoJSON that stops at `cap`, and
 * `layers.buildFeatureLayer` declines to draw a batch over `FEATURE_VERTEX_BUDGET` (and a layer whose batches together pass `FEATURE_VERTEX_TOTAL`) — the layer then
 * reports a plain "too detailed to draw at this zoom" failure (status dot "failed") instead of hanging. A row that really needs more declares `vertexBudget`. */
export const FEATURE_VERTEX_BUDGET = 120000;
export const FEATURE_VERTEX_TOTAL = 300000;
export function countVertices(features, cap = Infinity) {
  let n = 0;
  const walk = (c) => {
    if (n > cap) return;
    if (typeof c[0] === "number") { n += 1; return; }
    for (let i = 0; i < c.length && n <= cap; i++) walk(c[i]);
  };
  for (const f of features || []) {
    const g = f && f.geometry;
    if (!g) continue;
    if (g.type === "GeometryCollection") { for (const gg of g.geometries || []) if (gg && gg.coordinates) walk(gg.coordinates); }
    else if (g.coordinates) walk(g.coordinates);
    if (n > cap) break;
  }
  return n;
}

export function lineLabelText(cfg, props) {
  const ll = cfg && cfg.lineLabel;
  if (!ll || !ll.field || !props) return null;
  const fmt = typeof ll.format === "function" ? ll.format : pipeSizeLabel;
  const t = fmt(props[ll.field]);
  return t ? String(t) : null;
}

export function featureLayerOptions(cfg, opacity, pane, opts = {}) {
  const o = { url: cfg.url, pane, minZoom: cfg.minZoom ?? 10, interactive: !!opts.interactive };
  if (cfg.fields) o.fields = cfg.fields;
  // B2081249 — a row may narrow its service with a SQL `where` (the National Network layer must draw only NN = 1).
  if (cfg.where) o.where = cfg.where;
  // B2507064 (NEW-9): a row whose polygons are far more detailed than any screen can show (Future Land Use: 14 polygons, 308 k vertices, a ~2 s stall to draw) asks the SERVER to generalise to ~`simplifyFactor` pixels; layers.buildFeatureLayer re-asks when the zoom moves 2 levels so a zoomed-in view never keeps the coarse copy.
  if (cfg.simplifyFactor) o.simplifyFactor = cfg.simplifyFactor;
  // NEW-1 (Mississippi): a row on a pre-10.7 ArcGIS Server asks for plain JSON, not GeoJSON — that server's GeoJSON answer ignores maxAllowableOffset (a 195,577-vertex cell stays 195,577) and answers HTTP 400 for a few large polygons (MDEQ Dam Safety), while its JSON honours both.
  if (cfg.forceJson) o.isModern = false;
  // NEW-1 (Georgia): a layer whose service answers one HUGE feature for any cell (DCA's protected mountains: one multipolygon, 536k vertices) asks for ONE big cell per view instead of six 512 px ones (each re-downloaded the whole feature, 11 MB apiece) and coarser coordinate text.
  if (cfg.cellSize) o.cellSize = cfg.cellSize;
  if (cfg.precision != null) o.precision = cfg.precision;
  if (typeof opts.pointToLayer === "function") o.pointToLayer = opts.pointToLayer;
  // NEW-1 (DeSoto / Olive Branch): a row's `lineLabel` ({ field, minZoom }) puts a short text (the pipe size) on each line; the Leaflet half (`layers.buildFeatureLayer`) binds it.
  if (cfg.lineLabel && typeof opts.onLabel === "function") {
    o.onEachFeature = (feature, layer) => { const t = lineLabelText(cfg, feature && feature.properties); if (t) opts.onLabel(layer, t); };
  }
  // A LINE-role row never fills: a polyline answered by a service as one long ring must not paint as a solid wedge.
  const noFill = cfg.role === "line" ? { fill: false } : null;
  o.style = typeof cfg.styleFn === "function"
    ? (feature) => (noFill ? { ...noFill, ...cfg.styleFn(feature && feature.properties, opacity) } : cfg.styleFn(feature && feature.properties, opacity))
    : () => featureBaseStyle(cfg, opacity);
  return o;
}

/* The flat path style of a `esriFeature` row with no per-feature `styleFn`. ONE definition, read by
 * the layer's construction (`featureLayerOptions`) AND by its opacity setter in layers.js. NEW-2
 * (EIA pipelines): the setter used to restyle with a bare `{ opacity }`, and esri-leaflet keeps the
 * LAST style handed to `setStyle` as the style for every feature it loads afterwards — so every
 * line fetched after the first opacity write was born with Leaflet's default stroke (the default blue,
 * weight 3) and only the first batch kept the row's colour. */
export function featureBaseStyle(cfg, opacity) {
  return { color: cfg.color || "#b91c1c", weight: cfg.weight || 2, opacity, fillOpacity: 0, ...(cfg.role === "line" ? { fill: false } : {}) };
}

/* Can this layer's service answer an ArcGIS `/identify` at a point (NEW-2)?
 *
 * Lives HERE, not in rasterIdentify.js, purely so that asking the question costs nothing: layers.js
 * needs this predicate on the boot path to decide which layers are even eligible, and importing it
 * from rasterIdentify.js dragged that whole module's state machine into the planner's boot chunk —
 * which `ui-audit/perf-bundle-audit.mjs` charges for. rasterIdentify.js re-exports it, so the
 * identify code still reads as if it owns its own gate.
 *
 * It DECLINES anything it cannot honestly answer:
 *   • a FeatureServer — `/identify` is a MapServer operation; those layers paint as vectors and get
 *     the featureHover.js tooltip path instead;
 *   • an ImageServer (`kind: "esriImage"` — elevation shading) — identify returns a PIXEL, not a
 *     feature, and elevation under the cursor already has its own honest readout;
 *   • a registry row that opts out (`identify: false`). */
const VECTOR_KINDS = new Set(["esriFeature", "vector", "vectorLine", "pipelineCorridor",
  "overpass", "mapillary", "contours", "flowdir", "sdaBedrock"]);

export function identifyCapable(cfg) {
  if (!cfg || !cfg.url) return false;
  if (cfg.identify === false) return false;
  if (VECTOR_KINDS.has(cfg.kind)) return false;
  if (cfg.kind === "esriImage") return false;
  return /\/MapServer$/i.test(String(cfg.url).replace(/\/+$/, ""));
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
  // ⛔ B1933584 — gated on isActive() like every other late-arriving callback in this function
  // (the stall watchdog above, the requesterror handler below). Without it, an export request still
  // in flight when the layer is toggled off/released reports "loaded" for a layer that no longer
  // exists the moment its underlying <img> finishes downloading — a LOUD-FAILURE violation (a
  // status claiming a torn-down layer is live) this was the one exception to.
  layer.on("load", () => { if (!isActive()) return; settled = true; clearStall(); onStatus(k, "loaded"); if (proxy) reportAge(); });
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
