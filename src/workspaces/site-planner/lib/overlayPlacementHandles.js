/* Direct-manipulation chrome for a site-plan overlay on the real Leaflet map — move / corner
 * scale / rotate, mirroring the Site Planner's own on-canvas reference-image handles exactly
 * (SitePlanner.jsx `overlayChrome` + its ovScale/ovRotate/moveSheetOverlay drag modes), per the
 * owner's correction (B848496 NEW-2): "just mimic the way it works on the site planner module
 * for references... no wizard, no questions asked before he can see the thing."
 *
 * Only ONE overlay is ever "active" (armed for editing) at a time — a dashed rotated-rectangle
 * outline, 4 corner squares (uniform scale about the fixed center) and a rotate handle+line
 * above the top edge, all recomputed from the overlay's CURRENT placement on every map
 * move/zoom. All three gestures are computed in Leaflet CONTAINER-pixel space (screen pixels
 * relative to the map's own container), which is why the drag math needs no unit conversion:
 * Web Mercator is angle-preserving and north-up, so a screen-pixel distance ratio equals the
 * real-world scale ratio, and a screen-pixel rotation angle equals a true-north rotation.
 *
 * During a gesture the placement updates LIVE via `onLive` (so the image layer's corners track
 * the pointer every frame, no React re-render needed) and commits ONCE via `onCommit` on
 * release (so the caller persists exactly one write per gesture, not one per pointermove).
 */
import L from "leaflet";
import { overlayCornersFromPlacement, scalePlacement, rotatePlacement } from "../../../shared/sitePlans/lib/overlayGeoref.js";
import { compMarkerColor } from "../../../shared/comps/lib/compMarkerIcon.js";
import { PALETTES } from "../../../shared/theme/palette.js";

const PANE = "sitePlanHandlesPane";
const NS = "http://www.w3.org/2000/svg";
// Matches MapFinder's own COMP_ACCENT — the leasing-comp map marker's "building sale" blue —
// reused from its one real source (compMarkerIcon.js) rather than a second hardcoded literal.
const ACCENT = compMarkerColor("building_sale");
const ON_ACCENT = PALETTES.light.onAccent; // white — palette.js is the theme-token JS mirror; SVG attrs can't use var()

function ensurePane(map) {
  let pane = map.getPane(PANE);
  if (!pane) {
    pane = map.createPane(PANE);
    pane.style.zIndex = 620; // above sitePlanOverlayPane(399) and Leaflet's own markerPane(600)
    pane.style.pointerEvents = "none";
  }
  return pane;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

const pointsAttr = (pts) => pts.map((p) => `${p.x},${p.y}`).join(" ");

/** Creates one placement-handles controller on `map`. `show(overlay, imgW, imgH, {onLive,
 * onCommit})` arms editing for one overlay; `hide()` disarms; `startMove(e)` begins a move
 * gesture from an externally-sourced pointerdown (the caller wires this to a click/press on the
 * overlay's own rendered image). `destroy()` tears everything down. */
export function createPlacementHandles(map) {
  const pane = ensurePane(map);
  const svg = svgEl("svg", { width: 0, height: 0, style: "position:absolute; left:0; top:0; overflow:visible; pointer-events:none;" });
  pane.appendChild(svg);

  const moveHit = svgEl("polygon", { fill: "transparent", style: "cursor:grab; pointer-events:auto;" });
  const boundary = svgEl("polygon", { fill: "none", stroke: ACCENT, "stroke-width": 1.5, "stroke-dasharray": "6 4", style: "pointer-events:none;" });
  const rotLine = svgEl("line", { stroke: ACCENT, "stroke-width": 1.5, style: "pointer-events:none;" });
  const rotHandle = svgEl("circle", { r: 6.5, fill: ON_ACCENT, stroke: ACCENT, "stroke-width": 1.5, style: "cursor:grab; pointer-events:auto;" });
  const cornerCursors = ["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"]; // [tl, tr, br, bl]
  const corners = cornerCursors.map((cur) => svgEl("rect", {
    width: 11, height: 11, rx: 2, fill: ON_ACCENT, stroke: ACCENT, "stroke-width": 1.5, style: `cursor:${cur}; pointer-events:auto;`,
  }));
  svg.append(moveHit, boundary, rotLine, ...corners, rotHandle);

  let current = null; // { overlay, imgW, imgH, onLive, onCommit }
  let gesture = false;
  let cancelGesture = null; // set while a gesture is in flight — destroy()'s safety net

  const containerCenter = (overlay) => map.latLngToContainerPoint(L.latLng(overlay.centerLat, overlay.centerLon));

  const redraw = () => {
    if (!current) { svg.style.display = "none"; return; }
    const c = overlayCornersFromPlacement(current.overlay, current.imgW, current.imgH);
    if (!c) { svg.style.display = "none"; return; }
    svg.style.display = "";
    const tl = map.latLngToLayerPoint(c.topLeft), tr = map.latLngToLayerPoint(c.topRight);
    const bl = map.latLngToLayerPoint(c.bottomLeft), br = map.latLngToLayerPoint(c.bottomRight);
    const ring = pointsAttr([tl, tr, br, bl]);
    moveHit.setAttribute("points", ring);
    boundary.setAttribute("points", ring);
    const topCenter = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
    const bottomCenter = { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 };
    let dx = topCenter.x - bottomCenter.x, dy = topCenter.y - bottomCenter.y;
    const len = Math.max(1e-6, Math.hypot(dx, dy));
    dx /= len; dy /= len;
    const rp = { x: topCenter.x + dx * 24, y: topCenter.y + dy * 24 };
    rotLine.setAttribute("x1", topCenter.x); rotLine.setAttribute("y1", topCenter.y);
    rotLine.setAttribute("x2", rp.x); rotLine.setAttribute("y2", rp.y);
    rotHandle.setAttribute("cx", rp.x); rotHandle.setAttribute("cy", rp.y);
    [tl, tr, br, bl].forEach((p, i) => { corners[i].setAttribute("x", p.x - 5.5); corners[i].setAttribute("y", p.y - 5.5); });
  };

  // B972512-HARDENING item 18 — which gesture owns the touch. `L.DomEvent.stop(e)` on the
  // handle's own pointerdown only stops THAT one pointer's event from reaching Leaflet — it does
  // nothing about a SECOND finger landing elsewhere on the map mid-gesture, which is exactly what
  // Leaflet's own TouchZoom handler is listening for to start a pinch. Unlike the Site Planner's
  // own reference-image handles this mirrors (a plain canvas, not a Leaflet map — it has no
  // competing gesture system to fight), THIS map has `dragging`/`touchZoom` enabled by default
  // (MapFinder's `L.map(...)` passes neither `dragging` nor `touchZoom`, so both default true) —
  // so a one-finger drag on a corner handle plus an incidental second finger anywhere else on the
  // screen could start Leaflet's own pinch-zoom AT THE SAME TIME as this module's own scale
  // gesture, both driving the same overlay's size from two different, uncoordinated inputs — the
  // same species of bug as the open pinch/marker-displacement issue elsewhere in this codebase,
  // just for this feature's own handles. Fixed the standard Leaflet way: explicitly own the map's
  // own gesture handlers for the duration of OUR gesture, never let both be live at once.
  const runGesture = (onMoveFn) => {
    gesture = true;
    const wasDragging = map.dragging && map.dragging.enabled();
    const wasTouchZoom = map.touchZoom && map.touchZoom.enabled();
    if (map.dragging) map.dragging.disable();
    if (map.touchZoom) map.touchZoom.disable();
    const onMove = (ev) => { onMoveFn(ev); redraw(); };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      gesture = false;
      cancelGesture = null;
      if (wasDragging && map.dragging) map.dragging.enable();
      if (wasTouchZoom && map.touchZoom) map.touchZoom.enable();
      const done = current;
      if (done) done.onCommit(done.overlay);
    };
    // destroy()'s safety net for a controller torn down mid-gesture (e.g. the map unmounts
    // while a finger is still down) — drops the in-flight commit rather than firing onCommit on
    // a caller that's gone, but always restores the map's own gesture handlers.
    cancelGesture = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      gesture = false;
      if (wasDragging && map.dragging) map.dragging.enable();
      if (wasTouchZoom && map.touchZoom) map.touchZoom.enable();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startMove = (e) => {
    if (!current) return;
    L.DomEvent.stop(e);
    const overlay0 = current.overlay;
    const grab = map.mouseEventToLatLng(e);
    const lat0 = overlay0.centerLat, lon0 = overlay0.centerLon;
    runGesture((ev) => {
      const p = map.mouseEventToLatLng(ev);
      current.overlay = { ...current.overlay, centerLat: lat0 + (p.lat - grab.lat), centerLon: lon0 + (p.lng - grab.lng) };
      current.onLive(current.overlay);
    });
  };

  const startScale = (e) => {
    if (!current) return;
    L.DomEvent.stop(e);
    const overlay0 = current.overlay;
    const centerPt = containerCenter(overlay0);
    const grabPt = map.mouseEventToContainerPoint(e);
    const grabDist = Math.max(1e-6, Math.hypot(grabPt.x - centerPt.x, grabPt.y - centerPt.y));
    const ftPerPx0 = overlay0.ftPerPx;
    runGesture((ev) => {
      const p = map.mouseEventToContainerPoint(ev);
      const d = Math.max(1e-6, Math.hypot(p.x - centerPt.x, p.y - centerPt.y));
      const next = scalePlacement({ ...current.overlay, ftPerPx: ftPerPx0 }, d / grabDist);
      current.overlay = { ...current.overlay, ftPerPx: next.ftPerPx };
      current.onLive(current.overlay);
    });
  };

  const startRotate = (e) => {
    if (!current) return;
    L.DomEvent.stop(e);
    const overlay0 = current.overlay;
    const centerPt = containerCenter(overlay0);
    const grabPt = map.mouseEventToContainerPoint(e);
    const a0 = (Math.atan2(grabPt.y - centerPt.y, grabPt.x - centerPt.x) * 180) / Math.PI;
    const rot0 = overlay0.rotationDeg || 0;
    runGesture((ev) => {
      const p = map.mouseEventToContainerPoint(ev);
      const a = (Math.atan2(p.y - centerPt.y, p.x - centerPt.x) * 180) / Math.PI;
      const next = rotatePlacement(current.overlay, rot0, a - a0);
      current.overlay = { ...current.overlay, rotationDeg: next.rotationDeg };
      current.onLive(current.overlay);
    });
  };

  moveHit.addEventListener("pointerdown", startMove);
  corners.forEach((el) => el.addEventListener("pointerdown", startScale));
  rotHandle.addEventListener("pointerdown", startRotate);

  map.on("move zoom viewreset", redraw);

  return {
    show(overlay, imgW, imgH, { onLive, onCommit }) {
      current = { overlay, imgW, imgH, onLive, onCommit };
      redraw();
    },
    hide() { if (!gesture) { current = null; redraw(); } },
    isActive(id) { return !!current && current.overlay.id === id; },
    startMove,
    destroy() {
      if (cancelGesture) cancelGesture();
      map.off("move zoom viewreset", redraw);
      if (svg.parentNode) svg.parentNode.removeChild(svg);
    },
  };
}
