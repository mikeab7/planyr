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
import { layoutLotNumbers, clipRingToRect, lotNumberText, resolveLotNumberField, LOT_NO_FONT_PX } from "./parcelLotNumbers.js";
import { PARCEL_OUTLINE_COLOR } from "./parcelDisplayZoom.js";

const RELAYOUT_DEBOUNCE_MS = 90;
const LABEL_HALO = "#fff"; // design-exempt: a number's halo must be white over ANY basemap and theme — no token models "readable over a photo"
const VIEW_INSET = 6; // keep a number off the very edge of the map

/* A feature's OUTER ring as [{x,y}] in WORLD PIXELS at zoom `z` (pan-independent, so the interior
 * fit that `interiorFitter` caches by ring identity survives a pan). Cached on the feature per zoom. */
function worldRing(map, lyr, z) {
  const c = lyr.__lotRing;
  if (c && c.z === z) return c.ring;
  const g = lyr.feature && lyr.feature.geometry;
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
  lyr.__lotRing = { z, ring: best };
  return best;
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
  const clear = () => { if (group) group.clearLayers(); };
  const relayout = () => {
    timer = null;
    if (!map || !group) return;
    clear();
    const z = map.getZoom();
    const floor = Number(layer.options && layer.options.minZoom) || 0;
    if (!field || !(z >= floor)) return;
    const min = map.getPixelBounds().min;
    const size = map.getSize();
    // `getInset`: a host whose map container is larger than what the person can see (the Site planner
    // over-scans its basemap so a pan never shows blank tile) says how much, so numbers sit in the VISIBLE part.
    let inset = VIEW_INSET;
    try { inset += Math.max(0, Number(getInset && getInset()) || 0); } catch (_) { /* default inset */ }
    const view = { x0: min.x + inset, y0: min.y + inset, x1: min.x + size.x - inset, y1: min.y + size.y - inset };
    const lots = [];
    layer.eachFeature((lyr) => {
      const f = lyr.feature;
      if (!f) return;
      const text = lotNumberText(f.properties, field);
      if (!text) return;
      const ring = worldRing(map, lyr, z);
      if (!ring) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of ring) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
      if (x1 < view.x0 || y1 < view.y0 || x0 > view.x1 || y0 > view.y1) return; // off-screen
      // A lot larger than the screen is numbered where you can SEE it: lay out against the visible part.
      const seen = (x0 < view.x0 || y0 < view.y0 || x1 > view.x1 || y1 > view.y1) ? clipRingToRect(ring, view) : ring;
      if (!seen) return;
      lots.push({ id: String(f.id != null ? f.id : lots.length), text, ring: seen });
    });
    if (!lots.length) return;
    let obstacles = [];
    try { obstacles = (getObstacles && getObstacles()) || []; } catch (_) { obstacles = []; }
    const placed = layoutLotNumbers({ lots, origin: { x: min.x, y: min.y }, measure, fontPx: LOT_NO_FONT_PX, obstacles });
    const esc = (t) => String(t).replace(/[&<>"']/g, "");
    for (const p of placed) {
      const ll = map.containerPointToLatLng(L.point(p.x, p.y));
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
    if (group && map) { try { map.removeLayer(group); } catch (_) { /* detached */ } }
    group = null; map = null;
  });

  return { relayout: sched, field: () => field };
}
