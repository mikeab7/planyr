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

/* NEW-1 (Add parcels, 2026-11-16 — Goose Creek, Harris County: "I tried to click lots on the map … no outline showed up").
 * A queryable MapServer CAD (HCAD) draws its own vector lots only from zoom 16 (`displayMinZoom`, the record-cap floor). The Map's
 * Select parcels has always drawn the LARGER lots two zoom steps further out (parcelWideLayer.js — a size cutoff the county server
 * never sees past, fixed tiles through the relay); the planner's click-a-lot mode never asked for it, so at a normal site-scale
 * zoom it drew NOTHING and said "Zoom in". `layerReach` is the one answer to "from what zoom does this layer draw anything?" —
 * the planner's status line, the hang-guard and the harness all read it. Pure. */
export function layerReach(layer) {
  const close = Number(layer && layer.options && layer.options.minZoom);
  const w = layer && layer._wide;
  const wf = w && Number.isFinite(Number(w.wideFloor)) ? Number(w.wideFloor) : null;
  const floor = wf != null && Number.isFinite(close) ? Math.min(wf, close) : close;
  return { close, floor, wide: wf != null };
}

/* The lot under a point, from lots a layer already holds ({ feature (GeoJSON), bbox [w,s,e,n] } ghosts). The tightest containing lot
 * wins (parity with MapFinder.optimisticHitAt). Even-odd on each outer ring; a hole is ignored — this only decides what to FLASH on a
 * click, the authoritative answer is still the county's own point query (B137). Pure. */
export function lotAtPoint(ghosts, lng, lat) {
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  let best = null, bestArea = Infinity;
  for (const g of ghosts || []) {
    const b = g && g.bbox;
    if (!b || lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    const geom = g.feature && g.feature.geometry;
    if (!geom || !geom.coordinates) continue;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    if (!polys.some((rings) => rings[0] && inRing(rings[0]))) continue;
    const area = (b[2] - b[0]) * (b[3] - b[1]);
    if (area < bestArea) { best = g; bestArea = area; }
  }
  return best ? best.feature : null;
}

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
  let lastSyncAt = 0;         // when the view last moved — a larger-lots band that holds nothing yet is "still loading" for a beat, not "zoom in"
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
    if (layer && typeof layer.on === "function") layer.on("widestate", () => { if (!(layer._wide && layer._wide.info && (layer._wide.info().loading > 0))) settleAt = now(); notify(); }); // NEW-1 (Add parcels) — the larger-lots band's own tiles: its progress is the status line's too
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
    if (!map || disposed) return { phase: "none", lots: 0, floor: null, refused: false };
    const z = typeof map.getZoom === "function" ? map.getZoom() : NaN;
    let inRange = 0, below = 0, lots = 0, busy = false, floor = null, filtered = 0, refused = false;
    byUrl.forEach((e) => {
      const l = e.layer;
      const reach = layerReach(l);
      if (Number.isFinite(reach.floor)) floor = floor == null ? reach.floor : Math.min(floor, reach.floor);
      if (Number.isFinite(z) && Number.isFinite(reach.floor) && z < reach.floor) { below++; return; }
      inRange++;
      /* Between the larger-lots floor and the layer's own close floor ONLY the wide/mid stage draws (the close layer is idle there — its
       * `busy` flag never clears because it never loads), so what it holds, and whether its tiles are on the way, is the wide stage's. */
      if (reach.wide && Number.isFinite(z) && z < reach.close) {
        filtered++;
        const w = l._wide;
        const wi = typeof w.info === "function" ? w.info() : {};
        if ((wi.loading || 0) > 0 || wi.busy) busy = true;
        if (wi.error) refused = true;
        const st = typeof w.stats === "function" ? w.stats() : null;
        lots += st && Number.isFinite(st.held) ? st.held : 0;
        return;
      }
      if (e.busy) busy = true;
      if (l && l._layers) lots += Object.keys(l._layers).length;
      else if (!e.busy) lots += 1; // an image-only source cannot be counted — a loaded one counts as drawn
    });
    let phase;
    if (lots > 0) phase = "drawn";
    else if (asking.size || busy) phase = "loading";
    /* A layer in its larger-lots band that holds nothing has hidden the SMALL lots, it has not found "no parcels" — say "zoom in", after a beat for its tiles to start. */
    else if (filtered > 0) phase = now() - Math.max(settleAt, lastSyncAt) >= SETTLE_MS ? "zoom" : "loading";
    else if (inRange > 0) phase = now() - settleAt >= SETTLE_MS ? "empty" : "loading";
    else phase = below > 0 ? "zoom" : "none";
    if (phase === "loading" && !busy && !asking.size && inRange > 0 && !settleTimer) settleTimer = setTimer(() => { settleTimer = null; notify(); }, SETTLE_MS + 20);
    return { phase, lots, floor, refused, zoom: Number.isFinite(z) ? z : null };
  }

  function sync() {
    if (disposed) return false;
    const map = getMap();
    if (!map) return false;
    lastSyncAt = now();
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
    /* NEW-1 (Add parcels) — the lot already DRAWN under this point (close stage or larger-lots band), or null. The planner flashes its
     * outline the instant a click lands, before the county's point query answers. Never an answer to "what is here" — only to "what is
     * drawn here". */
    featureAt: (lat, lng) => {
      const ghosts = [];
      byUrl.forEach((e) => {
        const l = e.layer;
        if (!l) return;
        if (typeof l.eachFeature === "function") { try { l.eachFeature((g) => ghosts.push(g)); } catch (_) { /* a layer mid-teardown */ } }
        if (l._wide && typeof l._wide.eachFeature === "function") l._wide.eachFeature((g) => ghosts.push(g));
      });
      return lotAtPoint(ghosts, lng, lat);
    },
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
