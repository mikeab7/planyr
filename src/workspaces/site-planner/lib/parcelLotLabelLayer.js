/* lib/parcelLotLabelLayer.js — NEW-1 (owner decision 2026-10-04): the Leaflet half of Planyr's own lot
 * NUMBERS. `parcelLotNumbers.js` is the pure half (which field, what it reads as, where it goes).
 *
 * `attachLotNumbers(layer, opts)` hangs a number layer off a county's vector outline layer
 * (`makeParcelLayer`): it
 *   1. holds the layer's first requests until the service's own field list has answered, so the
 *      number's field can be asked for BY ITS EXACT NAME (a joined CAD publishes only table-prefixed
 *      names, and an invalid outField would fail the WHOLE outline query, not just the number);
 *   2. re-lays the numbers out after every move / zoom / load with the shared label collision engine
 *      and draws one small marker per number that fit. A number that cannot be placed inside its own
 *      lot without touching another number or the Site planner's own parcel chip is simply not drawn.
 * Pure DOM markers (no per-lot cost beyond the placed ones, capped at LOT_NO_MAX_LABELS) so nothing
 * here can reintroduce B1976336's tens-of-thousands-of-nodes class. */
import L from "leaflet";
import { bestMeasurer } from "../../../shared/markup/textWrap.js";
import { lotNumberItem, solveLotNumberItems, clipRingToRect, lotNumberText, resolveLotNumberField, lotBoxCanHost, LOT_NO_FONT_PX } from "./parcelLotNumbers.js";
import { PARCEL_OUTLINE_COLOR } from "./parcelDisplayZoom.js";
import { featureBbox } from "./parcelSnapshot.js";

const RELAYOUT_DEBOUNCE_MS = 90;
const LABEL_HALO = "#fff"; // design-exempt: a number's halo must be white over ANY basemap and theme — no token models "readable over a photo"
const VIEW_INSET = 6; // keep a number off the very edge of the map

/* A feature's OUTER ring as [{x,y}] in WORLD PIXELS at zoom `z` (pan-independent, so the interior
 * fit that `interiorFitter` caches by ring identity survives a pan). Cached on the feature per zoom. */
const ringCache = new WeakMap(); // feature -> { z, ring }
function worldRing(map, feature, z) {
  const c = ringCache.get(feature);
  if (c && c.z === z) return c.ring;
  const g = feature && feature.geometry;
  if (!g) return null;
  let rings = null;
  if (g.type === "Polygon") rings = [g.coordinates[0]];
  else if (g.type === "MultiPolygon") rings = g.coordinates.map((p) => p[0]);
  if (!rings || !rings.length) return null;
  // The largest part carries the number (a lot split by a road is two parts of one parcel).
  let best = null, bestArea = -1;
  for (const r of rings) {
    if (!Array.isArray(r) || r.length < 3) continue;
    const pts = r.map(([lng, lat]) => map.project(L.latLng(lat, lng), z)).map((p) => ({ x: p.x, y: p.y }));
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    a = Math.abs(a / 2);
    if (a > bestArea) { bestArea = a; best = pts; }
  }
  ringCache.set(feature, { z, ring: best });
  return best;
}

/* Yield to the event loop between slices with a MessageChannel macrotask (the terrainLayers.js idiom): unlike rAF it
 * is not folded into the frame it was asked from, so the browser paints between slices. */
const yieldTask = (() => {
  if (typeof MessageChannel === "undefined") return (fn) => setTimeout(fn, 0);
  const ch = new MessageChannel();
  const q = [];
  ch.port1.onmessage = () => { const fn = q.shift(); if (fn) fn(); };
  return (fn) => { q.push(fn); ch.port2.postMessage(0); };
})();
/** Per-slice budget (ms) for preparing lots — B2092656 ×3. */
export const LOT_NO_SLICE_MS = 6;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/* The shared layout + draw core: `forEachFeature(cb)` hands it every GeoJSON feature that may be in view
 * (the live outline layer's own, or the saved copy's); it keeps the ones with a number, lays them out with
 * the collision engine and draws one marker per placed number into `group`.
 *
 * ⛔ B2092656 ×3 — IT RUNS AS A SLICED JOB, NOT ONE TASK. On real parcel geometry (Waller's recorded saved copy at Katy,
 * z15 — rural lots big enough to hold a number) preparing every lot (ring projection, clip, text measure, the interior
 * fit) was ~100 ms of one task. Lots are now prepared a few at a time under LOT_NO_SLICE_MS, yielding between slices;
 * the collision pass and the draw run once all are prepared. The previous numbers stay up until the new ones are
 * drawn (no flash), and a newer relayout cancels an older job. Positions are converted with the zoom and pixel origin
 * the job STARTED with (`map.unproject`), so a pan while it runs cannot shift them. Returns { cancel }. */
function paintLotNumbers({ map, group, field, floor, measure, getObstacles, getInset, forEachFeature }) {
  const z = map.getZoom();
  if (!field || !(z >= floor)) { group.clearLayers(); return { cancel() {} }; }
  const min = map.getPixelBounds().min;
  const size = map.getSize();
  // `getInset`: a host whose map container is larger than what the person can see (the Site planner
  // over-scans its basemap so a pan never shows blank tile) says how much, so numbers sit in the VISIBLE part.
  // A number insets every side alike; `{ left, top, right, bottom }` per side (the Site planner's container reaches
  // further under the docked left column than it over-scans elsewhere — NEW-2, `geoDockX`).
  const ins = { left: VIEW_INSET, top: VIEW_INSET, right: VIEW_INSET, bottom: VIEW_INSET };
  try {
    const g = getInset && getInset();
    const pos = (v) => Math.max(0, Number(v) || 0);
    if (g && typeof g === "object") for (const k of Object.keys(ins)) ins[k] += pos(g[k]);
    else for (const k of Object.keys(ins)) ins[k] += pos(g);
  } catch (_) { /* default inset */ }
  const view = { x0: min.x + ins.left, y0: min.y + ins.top, x1: min.x + size.x - ins.right, y1: min.y + size.y - ins.bottom };
  const origin = { x: min.x, y: min.y };
  const cands = [];
  forEachFeature((f, bbox) => { if (f) cands.push(f, bbox); });
  const items = [];
  let i = 0, n = 0, cancelled = false;
  const prepOne = (f, bbox) => {
    if (bbox) { // B2092656: reject on the lot's pixel box (two projections) before anything per-vertex
      const a = map.project(L.latLng(bbox[3], bbox[0]), z), b = map.project(L.latLng(bbox[1], bbox[2]), z);
      if (b.x < view.x0 || b.y < view.y0 || a.x > view.x1 || a.y > view.y1) return; // off-screen
      if (!lotBoxCanHost(b.x - a.x, b.y - a.y)) return; // too small to hold a number at this zoom
    }
    const text = lotNumberText(f.properties, field);
    if (!text) return;
    const ring = worldRing(map, f, z);
    if (!ring) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of ring) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    if (x1 < view.x0 || y1 < view.y0 || x0 > view.x1 || y0 > view.y1) return; // off-screen
    // A lot larger than the screen is numbered where you can SEE it: lay out against the visible part.
    const seen = (x0 < view.x0 || y0 < view.y0 || x1 > view.x1 || y1 > view.y1) ? clipRingToRect(ring, view) : ring;
    if (!seen) return;
    const it = lotNumberItem({ id: String(f.id != null ? f.id : n++), text, ring: seen }, { origin, measure, fontPx: LOT_NO_FONT_PX });
    if (it) items.push(it);
  };
  const draw = () => {
    group.clearLayers();
    if (!items.length) return;
    let obstacles = [];
    try { obstacles = (getObstacles && getObstacles()) || []; } catch (_) { obstacles = []; }
    const placed = solveLotNumberItems(items, { obstacles });
    const esc = (t) => String(t).replace(/[&<>"']/g, "");
    for (const p of placed) {
      const ll = map.unproject(L.point(p.x + origin.x, p.y + origin.y), z);
      const el = L.divIcon({
        className: "planyr-lot-no",
        iconSize: [p.w, p.h],
        iconAnchor: [p.w / 2, p.h / 2],
        html: `<span data-lot-no="${esc(p.text)}" style="display:block;width:${p.w}px;text-align:center;white-space:nowrap;pointer-events:none;`
          + `font:600 ${LOT_NO_FONT_PX}px/${p.h}px 'Inter',system-ui,sans-serif;color:${PARCEL_OUTLINE_COLOR};`
          + `text-shadow:0 0 2px ${LABEL_HALO},0 0 2px ${LABEL_HALO},0 0 3px ${LABEL_HALO},0 0 3px ${LABEL_HALO}">${esc(p.text)}</span>`,
      });
      L.marker(ll, { icon: el, interactive: false, keyboard: false, zIndexOffset: -500 }).addTo(group);
    }
  };
  const step = () => {
    if (cancelled) return;
    if (map.getZoom() !== z) return; // the view changed scale under the job; the zoomend relayout replaces it
    const t0 = now();
    while (i < cands.length) {
      prepOne(cands[i], cands[i + 1]);
      i += 2;
      if (now() - t0 >= LOT_NO_SLICE_MS) { yieldTask(step); return; } // the clock after EVERY lot: one big real lot's interior fit can take several ms on its own
    }
    draw();
  };
  step();
  return { cancel() { cancelled = true; } };
}

/* The SAVED COPY's numbers (owner decision 2026-10-05): the county's Drive snapshot draws its own lot
 * numbers from `field` — the same account the live CAD would show — so a lot reads the SAME number whether
 * the county server is up or down. `getFeatures()` is the snapshot's in-view features. Attached to the
 * snapshot's GeoJSON layer; returns { relayout }. */
export function attachSnapshotLotNumbers(layer, { field, getFeatures, getObstacles, getInset } = {}) {
  if (!layer || !field || typeof getFeatures !== "function") return { relayout() {}, clear() {} };
  const measure = bestMeasurer({ weight: 600 });
  let map = null, group = null, job = null;
  const relayout = () => {
    if (job) job.cancel();
    job = null;
    if (!map || !group) return;
    job = paintLotNumbers({ map, group, field, floor: 0, measure, getObstacles, getInset, forEachFeature: (cb) => getFeatures().forEach((f) => cb(f, featureBbox(f))) }); // NOT forEach(cb): its 2nd argument is the INDEX, which the live path uses as a bbox (B2092656 ×2). The bbox (memoised on the feature) lets the pixel-box reject skip a too-small lot before any per-vertex work (B2092656 ×3)
  };
  layer.on("add", () => { map = layer._map; if (map) group = L.layerGroup().addTo(map); });
  layer.on("remove", () => {
    if (group && map) { try { map.removeLayer(group); } catch (_) { /* detached */ } }
    group = null; map = null;
  });
  return { relayout, clear: () => { if (job) job.cancel(); job = null; if (group) group.clearLayers(); }, field: () => field };
}

export function attachLotNumbers(layer, { hint, getObstacles, getInset } = {}) {
  if (!layer || !hint) return { relayout() {}, field: () => null };
  const measure = bestMeasurer({ weight: 600 });
  let field = null;
  let map = null;
  let group = null;
  let timer = null;

  /* ── 1. hold the first requests until the field list has answered ─────────────────────────────── */
  const origRequest = layer._requestFeatures;
  if (typeof origRequest === "function" && typeof layer.metadata === "function") {
    let open = false, asked = false;
    const held = [];
    const release = () => {
      if (open) return;
      open = true;
      const todo = held.splice(0);
      if (layer._map) todo.forEach((a) => origRequest.apply(layer, a)); // a layer pulled meanwhile re-requests on its next add
    };
    layer._requestFeatures = function (...args) {
      if (open) return origRequest.apply(this, args);
      held.push(args);
      if (!asked) {
        asked = true;
        try {
          layer.metadata((err, meta) => {
            if (!err && meta && Array.isArray(meta.fields)) {
              const f = resolveLotNumberField(meta.fields, hint);
              if (f) {
                field = f;
                const have = Array.isArray(layer.options.fields) ? layer.options.fields : ["OBJECTID"];
                if (have[0] !== "*" && !have.includes(f)) layer.options.fields = [...have, f];
              }
            }
            release(); // a failed metadata read still releases — outlines never wait on numbers
          });
        } catch (_) { release(); }
      }
    };
    layer.on("remove", () => { open = false; asked = false; held.length = 0; field = null; }); // a re-add re-asks
  }

  /* ── 2. lay the numbers out ───────────────────────────────────────────────────────────────────── */
  let job = null;
  const relayout = () => {
    timer = null;
    if (job) job.cancel(); // the old numbers stay up until the new job draws (no flash between)
    job = null;
    if (!map || !group) return;
    const floor = Number(layer.options && layer.options.minZoom) || 0;
    job = paintLotNumbers({
      map, group, field, floor, measure, getObstacles, getInset,
      forEachFeature: (cb) => layer.eachFeature((lyr) => cb(lyr.feature, lyr.bbox)),
    });
  };
  const sched = () => { if (timer) clearTimeout(timer); timer = setTimeout(relayout, RELAYOUT_DEBOUNCE_MS); };

  layer.on("add", () => {
    map = layer._map;
    if (!map) return;
    group = L.layerGroup().addTo(map);
    map.on("moveend zoomend", sched);
    layer.on("load", sched);
    sched();
  });
  layer.on("remove", () => {
    if (map) map.off("moveend zoomend", sched);
    layer.off("load", sched);
    if (timer) { clearTimeout(timer); timer = null; }
    if (job) { job.cancel(); job = null; }
    if (group && map) { try { map.removeLayer(group); } catch (_) { /* detached */ } }
    group = null; map = null;
  });

  return { relayout: sched, field: () => field };
}
