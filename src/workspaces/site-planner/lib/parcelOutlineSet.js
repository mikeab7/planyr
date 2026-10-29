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

import { layerInDrawRange } from "./parcelDisplayZoom.js";

export const OUTLINE_LOAD_TIMEOUT_MS = 8000;

/** The sources to draw for a view: the view's own sources, plus the statewide composite(s) backing
 *  any of those whose live layer is down. Pure. */
export function outlineKeysForView({ bounds, down = new Set(), sourcesForView, statewideKeysForState, stateOf, coversCounty = () => true }) {
  const want = new Set(sourcesForView(bounds));
  down.forEach((k) => {
    // NEW-2 (2026-10-28) — only a state layer that really holds the failed county stands in for it (New York's and Tennessee's declare the counties they lack).
    if (want.has(k)) statewideKeysForState(stateOf(k)).filter((sk) => coversCounty(sk, k)).forEach((sk) => want.add(sk));
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
  coversCounty = () => true, // (statewideKey, failedCountyKey) => bool — does that state layer hold the failed county? (parcelFallbacks.stateLayerCoversCounty)
  scopeFor = null,   // (statewideKey, baseSources, downKeys) => county names | null — what a statewide BACKUP draws
  onChange = () => {}, // () => void — the set's status() may have changed (a layer started/finished loading, the view moved)
  now = Date.now,
}) {
  const urls = {};            // key -> resolved url (null = none)
  const asking = new Set();   // keys whose url resolve is in flight
  const down = new Set();     // county keys whose live layer failed
  const byUrl = new Map();    // url -> { layer, keys:Set, timer }
  const keyUrl = {};          // key -> url it is mounted under
  let disposed = false;
  let settleAt = 0;           // when the last layer finished loading — "empty" is only believed after the ingest queue has had a beat
  let settleTimer = null;

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
    /* The guard only means anything while the layer is in the zoom range it can draw in — see
     * `layerInDrawRange` (V1475200). Below the floor a healthy layer reads its metadata, asks for no cells
     * and never "loads"; arming then pulled a working county and mounted the statewide picture instead.
     * Re-checked when the timer fires too: the view may have left the range while it was running. */
    const arm = () => {
      if (e.timer || !layerInDrawRange(layer)) return;
      e.timer = setTimer(() => { e.timer = null; if (layerInDrawRange(layer)) markDown(url); }, timeoutMs);
    };
    const ok = () => { if (e.timer) { clearTimer(e.timer); e.timer = null; } };
    const hook = (target, kind) => {
      if (!target || typeof target.on !== "function") return;
      target.on(kind === "image" ? "loading" : "requeststart", () => { e.busy = true; arm(); notify(); });
      target.on("load", () => { ok(); e.busy = false; settleAt = now(); notify(); });
      target.on(kind === "image" ? "error" : "requesterror", () => markDown(url));
    };
    hook(layer, "vector"); // NEW-1 (2026-10-04): a queryable CAD is one plain vector layer; the image-only source never reaches wire()
  };

  const mount = (key, url) => {
    const map = getMap();
    if (!map || !url) return;
    const twin = byUrl.get(url);
    if (twin) { twin.keys.add(key); keyUrl[key] = url; return; }
    const layer = makeLayer(url);
    const e = { layer, keys: new Set([key]), timer: null, busy: !isStatewideUrl(url) }; // a queryable layer is busy from the moment it is added (its first request is on its way); the statewide image is not wired, so it is never tracked
    byUrl.set(url, e);
    keyUrl[key] = url;
    if (!isStatewideUrl(url)) wire(url, layer, e); // listeners BEFORE addTo — onAdd fires the first request
    applyScope(map); // …and the scope too, so the very first request is already scoped
    layer.addTo(map);
  };

  /* A statewide backup draws only the counties whose own source failed, never the whole view — so a healthy
   * neighbour (Harris beside a failed Chambers) is not painted twice. A layer without `setCountyScope` (a
   * queryable statewide vector composite) is left alone. */
  const applyScope = (map) => {
    if (typeof scopeFor !== "function") return;
    const base = sourcesForView(boundsOf(map));
    byUrl.forEach((e) => {
      const l = e.layer;
      if (!l || typeof l.setCountyScope !== "function") return;
      const key = [...e.keys].find((k) => !isStatewideUrl || isStatewideUrl(urls[k])) ?? [...e.keys][0];
      if (key == null) return;
      l.setCountyScope(scopeFor(key, base, [...down]));
    });
  };

  const SETTLE_MS = 400;
  function notify() { if (!disposed) { try { onChange(); } catch (_) { /* a listener must never break the set */ } } }
  /* What the owner is looking at, in one word — the Parcels panel reads this (and nothing else) for its status line.
   *   "loading" — a layer's first request is out, or a source's url is still resolving
   *   "drawn"   — at least one lot is on the map
   *   "empty"   — every in-range layer answered and holds no lots
   *   "zoom"    — layers are mounted but the view is below every one's draw floor (they ask for nothing there)
   *   "none"    — nothing mounted for this view
   * `floor` is the lowest zoom at which the in-view layers draw (null when unknown). */
  function status() {
    const map = getMap();
    if (!map || disposed) return { phase: "none", lots: 0, floor: null };
    const z = typeof map.getZoom === "function" ? map.getZoom() : NaN;
    let inRange = 0, below = 0, lots = 0, busy = false, floor = null;
    byUrl.forEach((e) => {
      const l = e.layer;
      const f = Number(l && l.options && l.options.minZoom);
      if (Number.isFinite(f)) floor = floor == null ? f : Math.min(floor, f);
      if (Number.isFinite(z) && Number.isFinite(f) && z < f) { below++; return; }
      inRange++;
      if (e.busy) busy = true;
      if (l && l._layers) lots += Object.keys(l._layers).length;
      else if (!e.busy) lots += 1; // an image-only source cannot be counted — a loaded one counts as drawn
    });
    let phase;
    if (lots > 0) phase = "drawn";
    else if (asking.size || busy) phase = "loading";
    else if (inRange > 0) phase = now() - settleAt >= SETTLE_MS ? "empty" : "loading";
    else phase = below > 0 ? "zoom" : "none";
    if (phase === "loading" && !busy && !asking.size && inRange > 0 && !settleTimer) settleTimer = setTimer(() => { settleTimer = null; notify(); }, SETTLE_MS + 20);
    return { phase, lots, floor, zoom: Number.isFinite(z) ? z : null };
  }

  function sync() {
    if (disposed) return false;
    const map = getMap();
    if (!map) return false;
    const want = outlineKeysForView({ bounds: boundsOf(map), down, sourcesForView, statewideKeysForState, stateOf, coversCounty });
    Object.keys(keyUrl).forEach((k) => { if (!want.has(k) || down.has(k)) release(k); });
    want.forEach((k) => {
      if (keyUrl[k] != null || down.has(k)) return;
      if (k in urls) { if (urls[k]) mount(k, urls[k]); return; }
      if (asking.has(k)) return;
      asking.add(k);
      Promise.resolve().then(() => resolveUrl(k)).then((u) => { asking.delete(k); urls[k] = u || null; sync(); })
        .catch(() => { asking.delete(k); urls[k] = null; if (!disposed) { down.add(k); onDown(k); sync(); } });
    });
    applyScope(map);
    notify();
    return true;
  }

  return {
    sync,
    status,
    markDown: (key) => { const u = keyUrl[key]; if (u != null) markDown(u); },
    mounted: () => Object.keys(keyUrl),
    /* NEW-1 (2026-10-04) — ask every mounted layer to re-lay out its lot numbers. The Site planner calls
     * this when something a number must clear (its own parcel chips) has moved without the map moving. */
    relayoutLabels: () => { byUrl.forEach((e) => { const ln = e.layer && e.layer._lotNumbers; if (ln && typeof ln.relayout === "function") ln.relayout(); }); },
    dispose() {
      disposed = true;
      if (settleTimer) { clearTimer(settleTimer); settleTimer = null; }
      [...byUrl.keys()].forEach(unmountUrl);
    },
  };
}
