/* City / town names on the map finder — the lazily-loaded half (NEW-2, 2026-09-29).
 *
 * ⛔ NOTHING ON THE BOOT PATH MAY STATIC-IMPORT THIS FILE. It is reached only through
 * `placeNamesGate.js`'s dynamic import (same rule as `adminBoundaryLayer.js`); the datasets
 * are public/ assets, charged against no JS budget and requested only when this runs:
 * `geo/place-names.json` (worldwide backbone, ~200 KB) always, `geo/place-names-towns.json`
 * (US small towns, ~870 KB) only once the map is at zoom >= TOWNS_MIN_ZOOM.
 *
 * ONE CANVAS in its own pane at z-index 260: above the imagery tiles (200) and the state
 * outlines (250), BELOW the vector overlay pane (400) and every marker — so a plan, a parcel
 * or a pin is never occluded by a name. `pointer-events: none` throughout (the B98 rule), so
 * a label can never take a click. The canvas covers the viewport and is redrawn every `move`
 * frame (rAF-coalesced), and every animation frame of a zoom — see the zoom-animation note in
 * `attachPlaceNames`: Leaflet does not animate a custom canvas, so this layer does its own — drawing ≤ 90 labels is cheap and keeps names
 * pinned to their places while dragging.
 *
 * Text is light with a dark halo — the same "white hairline over a soft dark casing" the
 * state outlines use — because both finder basemaps are imagery. `setTone("light")` flips to
 * dark text / light halo for a plain light background.
 */
import L from "leaflet";
import { reportClientEvent } from "../telemetry/clientErrors.js";
import { PLACE_NAMES_MAX_ZOOM, setPlaceNamesShown, placeNameKey } from "./placeNamesGate.js";
import { decodePlaces, placesForZoom, placeNamesOpacity, layoutLabels, labelFont, placeKey, stepScalar, stepFade, TOWNS_MIN_ZOOM } from "./placeNamesData.js";
import { createZoomTracker } from "./zoomTracker.js";

const BACKBONE = "geo/place-names.json";
const TOWNS = "geo/place-names-towns.json";
const PANE = "placenames";
const PANE_Z = 260;

const cache = new Map();
function loadPlaces(asset) {
  if (!cache.has(asset)) {
    const url = new URL(asset, document.baseURI).href;
    cache.set(asset, fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(decodePlaces)
      .catch((e) => {
        cache.delete(asset); // LOUD-FAILURE: report, and let a later zoom retry
        try { reportClientEvent("place-names-unavailable", `City names could not load (${asset}): ${e && e.message}`, { url }); } catch (_) { /* never let telemetry throw */ }
        throw e;
      }));
  }
  return cache.get(asset);
}

const attached = new WeakMap();

export function attachPlaceNames(map) {
  if (!map) return null;
  const existing = attached.get(map);
  if (existing) return existing;

  if (!map.getPane(PANE)) {
    const pane = map.createPane(PANE);
    pane.style.zIndex = String(PANE_Z);
    pane.style.pointerEvents = "none";
  }
  const pane = map.getPane(PANE);
  const canvas = L.DomUtil.create("canvas", "", pane);
  canvas.style.pointerEvents = "none";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  const widths = new Map();
  let backbone = [], towns = [], townsRequested = false, destroyed = false, raf = 0, tone = "imagery", enabled = true;

  const measure = (name, font) => {
    const k = `${font.px}${font.weight}${name}`;
    let w = widths.get(k);
    if (w == null) { ctx.font = `${font.weight} ${font.px}px system-ui, -apple-system, "Segoe UI", sans-serif`; w = ctx.measureText(name).width; widths.set(k, w); }
    return w;
  };

  /* Labels are TRACKED across frames (key → { p: place, a: 0..1 }) so they fade in and out instead
   * of popping, and so a label already showing can be given hysteresis in the collision pass.
   * `wanted` is what the latest layout chose; anything tracked but not wanted fades out where it
   * is (re-projected every frame, so it still rides the map). */
  const tracked = new Map();
  let wanted = new Set(), layerA = 0, lastTs = 0, dirty = true, lastShownKey = "";
  /* Zoom animation: see zoomTracker.js. Leaflet does not animate a hand-drawn canvas — it moves its
   * state to the end view at once — so each frame we project every place through the tracker, which
   * lerps start view → end view on the tiles' own transition clock. Names stay on the ground for
   * the whole zoom, and the text is never scaled (the canvas is never transformed). */
  const tracker = createZoomTracker(map, pane, {
    onStart: (e) => {
      const size = map.getSize();
      layout(e.center, e.zoom, size); // decide once for where we are heading; held = what shows now
      animAlpha = enabled ? placeNamesOpacity(e.zoom) : 0;
      schedule();
    },
    onEnd: () => { dirty = true; schedule(); },
  });
  let animAlpha = 0;
  const boundsFor = (center, zoom, size) => {
    const c = map.project(center, zoom), hx = size.x * 0.55, hy = size.y * 0.55;
    return L.latLngBounds(map.unproject([c.x - hx, c.y + hy], zoom), map.unproject([c.x + hx, c.y - hy], zoom));
  };

  /* Choose the labels for a view (center, zoom) and mark them wanted. */
  const layout = (center, zoom, size) => {
    const target = enabled ? placeNamesOpacity(zoom) : 0;
    if (target <= 0) { wanted = new Set(); return []; }
    const all = towns.length ? backbone.concat(towns) : backbone;
    const b = boundsFor(center, zoom, size);
    const proj = tracker.viewAt(center, zoom);
    const cands = [];
    for (const p of placesForZoom(all, zoom)) {
      if (!b.contains([p.lat, p.lng])) continue;
      const pt = proj([p.lat, p.lng]);
      cands.push({ name: p.name, x: pt.x, y: pt.y, minZoom: p.minZoom, lat: p.lat, lng: p.lng, key: placeKey(p), p });
    }
    const laid = layoutLabels(cands, measure, size.x, size.y, { held: wanted });
    wanted = new Set(laid.map((l) => l.key));
    for (const l of laid) if (!tracked.has(l.key)) tracked.set(l.key, { p: l.p, a: 0 });
    return laid;
  };

  const draw = (ts) => {
    raf = 0;
    if (destroyed) return;
    const now = typeof ts === "number" ? ts : performance.now();
    const dt = lastTs ? Math.min(100, now - lastTs) : 0;
    lastTs = now;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.x * dpr) || canvas.height !== Math.round(size.y * dpr)) {
      canvas.width = Math.round(size.x * dpr); canvas.height = Math.round(size.y * dpr);
      canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
      dirty = true;
    }
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);

    const f = tracker.frame(now);
    const at = f.at;

    if (!f.animating && dirty) { dirty = false; layout(map.getCenter(), map.getZoom(), size); }
    const targetA = f.animating ? animAlpha : (enabled ? placeNamesOpacity(map.getZoom()) : 0);
    layerA = stepScalar(layerA, targetA, dt);
    const busy = stepFade(tracked, wanted, dt) || layerA !== targetA || f.animating;

    const shownNow = [];
    if (layerA > 0) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      const onImagery = tone === "imagery";
      for (const [key, e] of tracked) {
        const pt = at([e.p.lat, e.p.lng]);
        if (pt.x < -80 || pt.x > size.x + 80 || pt.y < -20 || pt.y > size.y + 20) continue;
        const font = labelFont(e.p.minZoom);
        ctx.globalAlpha = layerA * e.a;
        ctx.font = `${font.weight} ${font.px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = onImagery ? "rgba(0,0,0,0.62)" : "rgba(255,255,255,0.85)";
        ctx.strokeText(e.p.name, pt.x, pt.y);
        ctx.fillStyle = onImagery ? "#fff" : "#1f2937";
        ctx.fillText(e.p.name, pt.x, pt.y);
        shownNow.push({ key, name: e.p.name, lat: e.p.lat, lng: e.p.lng, x: pt.x, y: pt.y, px: font.px, a: layerA * e.a });
      }
    }
    ctx.globalAlpha = 1;
    /* Mirror of what was drawn, for headless checks (the adminBoundaryLayer `data-levels` trick).
     * `count`/`names` describe the CHOSEN set; `pane.__drawn` is the per-label screen position and
     * type size of this very frame. */
    pane.dataset.count = String(wanted.size);
    pane.dataset.names = [...wanted].map((k) => (tracked.get(k) ? tracked.get(k).p.name : "")).join("|");
    pane.dataset.zoom = String(map.getZoom());
    pane.__drawn = shownNow;
    /* Publish which names are actually on screen (visible enough to read), so the city-limits overlay does not
     * draw a second copy. Only fires on a CHANGE — the set is tiny and settles between frames. */
    const shownKey = shownNow.filter((l) => l.a > 0.05).map((l) => placeNameKey(l.name)).sort().join("|");
    if (shownKey !== lastShownKey) {
      lastShownKey = shownKey;
      setPlaceNamesShown(map, shownNow.filter((l) => l.a > 0.05).map((l) => placeNameKey(l.name)));
    }
    if (busy) schedule();
  };
  const schedule = () => { if (!raf && !destroyed) raf = requestAnimationFrame(draw); };

  const ensureTowns = () => {
    if (townsRequested || map.getZoom() < TOWNS_MIN_ZOOM || map.getZoom() > PLACE_NAMES_MAX_ZOOM) return;
    townsRequested = true;
    loadPlaces(TOWNS).then((p) => { towns = p; dirty = true; schedule(); }, () => { townsRequested = false; });
  };
  const onMove = () => { ensureTowns(); dirty = true; schedule(); };
  map.on("move zoom moveend zoomend resize", onMove);

  const controller = {
    redraw: schedule,
    drawSync(ts) { if (raf) { cancelAnimationFrame(raf); raf = 0; } draw(ts); }, // headless checks: draw NOW, on the caller's frame
    setTone(t) { tone = t === "light" ? "light" : "imagery"; schedule(); },
    setEnabled(on) { enabled = !!on; dirty = true; schedule(); },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      map.off("move zoom moveend zoomend resize", onMove); tracker.destroy();
      setPlaceNamesShown(map, []);   // the city-limits labels take their names back
      try { canvas.remove(); } catch (_) { /* map already torn down */ }
      attached.delete(map);
    },
  };
  attached.set(map, controller);
  pane.__placeNames = controller; // test-only handle (ui-audit/verify-place-names.mjs); nothing in the app reads it
  loadPlaces(BACKBONE).then((p) => { backbone = p; dirty = true; ensureTowns(); schedule(); }, () => { controller.destroy(); }); // already reported; the next zoom-in re-attaches and retries
  return controller;
}
