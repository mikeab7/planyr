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
 * a label can never take a click. The canvas covers the viewport and is re-anchored + redrawn
 * on every `move` frame (rAF-coalesced) — drawing ≤ 90 labels is cheap and keeps names
 * pinned to their places while dragging.
 *
 * Text is light with a dark halo — the same "white hairline over a soft dark casing" the
 * state outlines use — because both finder basemaps are imagery. `setTone("light")` flips to
 * dark text / light halo for a plain light background.
 */
import L from "leaflet";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { PLACE_NAMES_MAX_ZOOM } from "./placeNamesGate.js";
import { decodePlaces, placesForZoom, placeNamesOpacity, layoutLabels, TOWNS_MIN_ZOOM } from "./placeNamesData.js";

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

  const draw = () => {
    raf = 0;
    if (destroyed) return;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.x * dpr) || canvas.height !== Math.round(size.y * dpr)) {
      canvas.width = Math.round(size.x * dpr); canvas.height = Math.round(size.y * dpr);
      canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
    }
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    const z = map.getZoom();
    const alpha = enabled ? placeNamesOpacity(z) : 0;
    let shown = 0, names = "";
    if (alpha > 0) {
      const all = towns.length ? backbone.concat(towns) : backbone;
      const b = map.getBounds().pad(0.05);
      const inView = placesForZoom(all, z).filter((p) => b.contains([p.lat, p.lng]));
      inView.sort((a, c) => a.minZoom - c.minZoom); // stable: keeps the build's name order within a tier
      const projected = inView.map((p) => { const pt = map.latLngToContainerPoint([p.lat, p.lng]); return { name: p.name, x: pt.x, y: pt.y, minZoom: p.minZoom }; });
      const laid = layoutLabels(projected, measure, size.x, size.y);
      ctx.globalAlpha = alpha; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      const onImagery = tone === "imagery";
      for (const l of laid) {
        ctx.font = `${l.font.weight} ${l.font.px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = onImagery ? "rgba(0,0,0,0.62)" : "rgba(255,255,255,0.85)";
        ctx.strokeText(l.name, l.x, l.y);
        ctx.fillStyle = onImagery ? "#fff" : "#1f2937";
        ctx.fillText(l.name, l.x, l.y);
      }
      shown = laid.length;
      names = laid.map((l) => l.name).join("|");
    }
    ctx.globalAlpha = 1;
    /* Mirror of what was drawn, for headless checks (the adminBoundaryLayer `data-levels` trick). */
    pane.dataset.count = String(shown);
    pane.dataset.names = names;
    pane.dataset.zoom = String(z);
  };
  const schedule = () => { if (!raf && !destroyed) raf = requestAnimationFrame(draw); };

  const ensureTowns = () => {
    if (townsRequested || map.getZoom() < TOWNS_MIN_ZOOM || map.getZoom() > PLACE_NAMES_MAX_ZOOM) return;
    townsRequested = true;
    loadPlaces(TOWNS).then((p) => { towns = p; schedule(); }, () => { townsRequested = false; });
  };
  const onMove = () => { ensureTowns(); schedule(); };
  map.on("move zoom moveend zoomend resize", onMove);

  const controller = {
    redraw: schedule,
    setTone(t) { tone = t === "light" ? "light" : "imagery"; schedule(); },
    setEnabled(on) { enabled = !!on; schedule(); },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      map.off("move zoom moveend zoomend resize", onMove);
      try { canvas.remove(); } catch (_) { /* map already torn down */ }
      attached.delete(map);
    },
  };
  attached.set(map, controller);
  loadPlaces(BACKBONE).then((p) => { backbone = p; ensureTowns(); schedule(); }, () => { controller.destroy(); }); // already reported; the next zoom-in re-attaches and retries
  return controller;
}
