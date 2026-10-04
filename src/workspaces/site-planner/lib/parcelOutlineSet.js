/* parcelOutlineSet — which parcel-outline layers the Site planner's "Click a lot on the map" mode
 * keeps on the basemap, and when it swaps one for another. (B2024624; the Site-planner twin
 * of B1976336's Map-finder fix.)
 *
 * WHAT WAS WRONG, measured live on Grand Port: entering the mode mounted one full-viewport image per
 * parcel service in the COUNTRY (36–39 <img> overlays). Only Chambers and the TxGIO statewide
 * composite drew anything, so the owner saw GOLD statewide outlines whenever the Chambers image was
 * reloading, then BLUE Chambers on top — and doubled lines while both showed.
 *
 * THE RULE (same as the Map finder): ONE source per area. The set follows the VIEW —
 * `displaySourcesForView` — and a statewide composite is added for a state only while a county source
 * under that view has actually FAILED (error, or no first draw inside `timeoutMs`). A slow-but-alive
 * county source is never swapped out, so nothing flashes to a second dataset during a reload; the
 * previous image stays until the new one has loaded (esri-leaflet's own swap-on-load).
 *
 * Dependency-injected (no Leaflet, no React) so the policy is unit-testable. Pure of side effects
 * beyond the callbacks it is handed. */

export const OUTLINE_LOAD_TIMEOUT_MS = 8000;

/** The sources to draw for a view: the view's own sources, plus the statewide composite(s) backing
 *  any of those whose live layer is down. Pure. */
export function outlineKeysForView({ bounds, down = new Set(), sourcesForView, statewideKeysForState, stateOf }) {
  const want = new Set(sourcesForView(bounds));
  down.forEach((k) => {
    if (want.has(k)) statewideKeysForState(stateOf(k)).forEach((sk) => want.add(sk));
  });
  return want;
}

export function createOutlineSet({
  getMap,            // () => leaflet map | null
  boundsOf,          // (map) => {south, west, north, east}
  resolveUrl,        // (key) => Promise<url|null>
  makeLayer,         // (url) => layer
  sourcesForView,    // (bounds) => key[]
  statewideKeysForState,
  stateOf,           // (key) => state code
  isStatewideUrl,    // (url) => bool — the universal fallback is never pulled on a hiccup
  timeoutMs = OUTLINE_LOAD_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onDown = () => {},
}) {
  const urls = {};            // key -> resolved url (null = none)
  const asking = new Set();   // keys whose url resolve is in flight
  const down = new Set();     // county keys whose live layer failed
  const byUrl = new Map();    // url -> { layer, keys:Set, timer }
  const keyUrl = {};          // key -> url it is mounted under
  let disposed = false;

  const unmountUrl = (url) => {
    const e = byUrl.get(url);
    if (!e) return;
    if (e.timer) { clearTimer(e.timer); e.timer = null; }
    try { const m = getMap(); if (m) m.removeLayer(e.layer); } catch (_) { /* detached already */ }
    e.keys.forEach((k) => { delete keyUrl[k]; });
    byUrl.delete(url);
  };
  const release = (key) => {
    const url = keyUrl[key];
    if (url == null) return;
    const e = byUrl.get(url);
    delete keyUrl[key];
    if (!e) return;
    e.keys.delete(key);
    if (!e.keys.size) unmountUrl(url);
  };

  const markDown = (url) => {
    const e = byUrl.get(url);
    if (!e || disposed) return;
    const keys = [...e.keys];
    unmountUrl(url);
    keys.forEach((k) => { down.add(k); onDown(k); });
    sync();
  };

  const wire = (url, layer, e) => {
    const arm = () => { if (!e.timer) e.timer = setTimer(() => { e.timer = null; markDown(url); }, timeoutMs); };
    const ok = () => { if (e.timer) { clearTimer(e.timer); e.timer = null; } };
    const hook = (target, kind) => {
      if (!target || typeof target.on !== "function") return;
      target.on(kind === "image" ? "loading" : "requeststart", arm);
      target.on("load", ok);
      target.on(kind === "image" ? "error" : "requesterror", () => markDown(url));
    };
    if (layer._isAdaptive) { hook(layer._vectorLayer, "vector"); hook(layer._imageLayer, "image"); }
    else hook(layer, "vector");
  };

  const mount = (key, url) => {
    const map = getMap();
    if (!map || !url) return;
    const twin = byUrl.get(url);
    if (twin) { twin.keys.add(key); keyUrl[key] = url; return; }
    const layer = makeLayer(url);
    const e = { layer, keys: new Set([key]), timer: null };
    byUrl.set(url, e);
    keyUrl[key] = url;
    if (!isStatewideUrl(url)) wire(url, layer, e); // listeners BEFORE addTo — onAdd fires the first request
    layer.addTo(map);
  };

  function sync() {
    if (disposed) return false;
    const map = getMap();
    if (!map) return false;
    const want = outlineKeysForView({ bounds: boundsOf(map), down, sourcesForView, statewideKeysForState, stateOf });
    Object.keys(keyUrl).forEach((k) => { if (!want.has(k) || down.has(k)) release(k); });
    want.forEach((k) => {
      if (keyUrl[k] != null || down.has(k)) return;
      if (k in urls) { if (urls[k]) mount(k, urls[k]); return; }
      if (asking.has(k)) return;
      asking.add(k);
      Promise.resolve().then(() => resolveUrl(k)).then((u) => { asking.delete(k); urls[k] = u || null; sync(); })
        .catch(() => { asking.delete(k); urls[k] = null; if (!disposed) { down.add(k); onDown(k); sync(); } });
    });
    return true;
  }

  return {
    sync,
    markDown: (key) => { const u = keyUrl[key]; if (u != null) markDown(u); },
    mounted: () => Object.keys(keyUrl),
    dispose() {
      disposed = true;
      [...byUrl.keys()].forEach(unmountUrl);
    },
  };
}
