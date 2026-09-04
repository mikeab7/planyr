/* A raster image, georeferenced by three corners (top-left, top-right, bottom-left), rendered
 * on a real Leaflet map — the rendering half of the site-plan-overlay feature (B848848).
 * Leaflet has no built-in rotated-image layer; this is the standard technique (the same one
 * third-party "rotated image overlay" plugins use): position a plain <img> inside a dedicated
 * pane and drive its CSS `transform: matrix(...)` from the three corners' current on-screen
 * position, recomputed on every pan/zoom. The GEOREFERENCING MATH lives in
 * shared/sitePlans/lib/overlayGeoref.js (which itself reuses the Site Planner's own
 * reference-overlay align-mode solver) — this module only turns three already-resolved
 * lat/lon corners into pixels on screen; it holds no georeferencing logic of its own.
 */
import L from "leaflet";

const PANE = "sitePlanOverlayPane";

function ensurePane(map) {
  let pane = map.getPane(PANE);
  if (!pane) {
    pane = map.createPane(PANE);
    // Above the tile panes (200) so the plan is visible over the aerial; below Leaflet's
    // default overlayPane (400) so drawn vector content (parcel outlines, identify
    // highlights) stays visible over the plan, and well below markerPane (600) so comp pins
    // always show. pointer-events off by default — a non-clickable overlay must never block
    // ordinary map panning/clicking; `setClickable` opts one overlay in explicitly.
    pane.style.zIndex = 399;
    pane.style.pointerEvents = "none";
  }
  return pane;
}

/** Creates one rotated-image layer on `map`, returns a handle:
 *  { setImage(url), setCorners({topLeft,topRight,bottomLeft}), setSize(w,h), setOpacity(op),
 *    setVisible(v), setClickable(onClick|null), destroy() }.
 * `corners`/`size` must both be set before anything paints. `onClick(latlng)` — when set, the
 * image becomes clickable and reports the map lat/lon under the click (used for the "pin a
 * comp here" / "measure this" interactions), consuming the click so the map's own click
 * handler doesn't also fire for it. */
export function createRotatedImageLayer(map) {
  const pane = ensurePane(map);
  const img = document.createElement("img");
  img.alt = "";
  img.style.position = "absolute";
  img.style.left = "0";
  img.style.top = "0";
  img.style.transformOrigin = "0 0";
  img.draggable = false;
  // B849841/NEW-2 — opts this element into Leaflet's own CSS-eased zoom animation, the same way
  // every built-in layer (ImageOverlay, Marker, the vector renderer) does: Leaflet flags its
  // `_mapPane` (an ancestor of every custom pane, this one included — createPane() with no
  // container argument appends under _mapPane) with `leaflet-zoom-anim` for the ~250ms of a zoom
  // gesture, and leaflet.css eases `transform` on any DESCENDANT carrying `leaflet-zoom-animated`
  // during that window. Without this class the transform below still ends up correct (the plain
  // "move zoom viewreset" listener sets it), but with no transition to ease into it just SNAPS
  // there the instant the gesture starts — see onZoomAnim below for why that instant write is
  // otherwise a jump, not a lag.
  img.classList.add("leaflet-zoom-animated");
  pane.appendChild(img);

  let corners = null, imgW = 0, imgH = 0, clickHandler = null;

  // B1134753 — TAP vs DRAG, for an INACTIVE (not-yet-armed) overlay's own click-to-select.
  // Before this, a mousedown on the image was never stopped, so a real pan-drag correctly
  // reached Leaflet's own dragging handler underneath — but the browser's native `click` event
  // still fires afterward (Leaflet's Draggable never suppresses it; confirmed against the
  // installed leaflet-src.js: `finishDrag` fires only its own `dragend`, no document-level click
  // guard), so the SAME gesture both panned the map AND selected the overlay — the owner's
  // "sometimes I click and drag and it just pans the map, and sometimes it actually grabs the
  // site plan, and there's no clear way to tell which." Deliberately still NOT stopping
  // pointerdown (an inactive overlay must let a real drag pan the map straight through it); this
  // only tracks whether the gesture stayed within tap-slop before deciding whether the trailing
  // `click` really means "select this."
  const TAP_SLOP_PX = 6;
  let downPt = null, moved = false;
  const onWindowMove = (e) => {
    if (!downPt) return;
    if (Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) > TAP_SLOP_PX) moved = true;
  };
  const onWindowUp = () => {
    window.removeEventListener("pointermove", onWindowMove);
    window.removeEventListener("pointerup", onWindowUp);
  };
  const onImgPointerDown = (e) => {
    if (!clickHandler) return;
    downPt = { x: e.clientX, y: e.clientY };
    moved = false;
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", onWindowUp);
  };

  // Shared affine-matrix math — `project` turns a corner latLng into a pane-local pixel point.
  // The resting case (`update`, below) projects at the map's CURRENT state; the animated case
  // (`onZoomAnim`) projects at the gesture's TARGET zoom/center via Leaflet's own private
  // `_latLngToNewLayerPoint` — the same helper every built-in Leaflet layer's own `_animateZoom`
  // uses (ImageOverlay, Marker, the vector renderer) for exactly this, so this is the sanctioned
  // technique for a custom pane layer, not a private-API workaround invented here.
  const matrixFor = (project) => {
    const p0 = project(corners.topLeft);
    const p1 = project(corners.topRight);
    const p2 = project(corners.bottomLeft);
    const a = (p1.x - p0.x) / imgW, b = (p1.y - p0.y) / imgW;
    const c = (p2.x - p0.x) / imgH, d = (p2.y - p0.y) / imgH;
    return `matrix(${a},${b},${c},${d},${p0.x},${p0.y})`;
  };

  const update = () => {
    if (!corners || !imgW || !imgH) return;
    img.style.width = `${imgW}px`;
    img.style.height = `${imgH}px`;
    img.style.transform = matrixFor((ll) => map.latLngToLayerPoint(ll));
  };

  // B849841/NEW-2 — without this, the overlay only ever repositions on "move zoom viewreset",
  // which (per `_animateZoom` in Leaflet's own Map.js) fires with the FINAL, post-animation
  // state already current — so `update()` above writes the correct RESTING transform the instant
  // a zoom gesture *starts*. On a plain element that write is an unexplained instant jump — the
  // reported "the plan stays fixed on screen … it snaps to its new position at the end" (it's
  // actually snapping at the START; the tiles then spend ~250ms visually catching up to it).
  // `leaflet-zoom-animated` (added above) turns that same instant write into an eased one, but
  // only for elements that are told the TARGET view during the `zoomanim` event Leaflet fires at
  // the start of the gesture (once per discrete zoom step, once per frame for a continuous pinch)
  // — hence this second, explicit handler rather than relying on `update()` alone.
  const onZoomAnim = (e) => {
    if (!corners || !imgW || !imgH) return;
    img.style.transform = matrixFor((ll) => map._latLngToNewLayerPoint(ll, e.zoom, e.center));
  };

  // B1134754 NEW-21 — non-destructive crop. `clip-path: inset(...)` is measured in the
  // element's OWN local pixel box, i.e. BEFORE the CSS transform above is applied — so clipping
  // in plain image-pixel coordinates and letting the SAME matrix transform carry both the image
  // and its clip means the visible crop rotates/scales/moves exactly with the placement, with
  // zero extra math here. This is display-only: it never touches `img.src`, so widening or
  // clearing the crop later needs no re-fetch or re-decode.
  const applyCrop = (crop) => {
    if (!crop || !(imgW > 0) || !(imgH > 0)) { img.style.clipPath = ""; return; }
    const top = Math.max(0, crop.y), left = Math.max(0, crop.x);
    const right = Math.max(0, imgW - crop.x - crop.w), bottom = Math.max(0, imgH - crop.y - crop.h);
    img.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
  };
  let pendingCrop = null;

  map.on("move zoom viewreset", update);
  map.on("zoomanim", onZoomAnim);

  const onImgClick = (e) => {
    if (!clickHandler) return;
    if (moved) return; // a real drag's trailing click — this was a pan, not a tap; never select
    L.DomEvent.stop(e); // consume it — the plan is the target, not the map underneath
    clickHandler(map.mouseEventToLatLng(e));
  };
  img.addEventListener("pointerdown", onImgPointerDown);
  img.addEventListener("click", onImgClick);

  return {
    setImage(url) { img.src = url || ""; },
    setCorners(c) { corners = c; update(); },
    setSize(w, h) { imgW = w; imgH = h; update(); applyCrop(pendingCrop); },
    setCrop(crop) { pendingCrop = crop || null; applyCrop(pendingCrop); },
    setOpacity(op) { img.style.opacity = String(op == null ? 1 : op); },
    setVisible(v) { img.style.display = v === false ? "none" : ""; },
    setClickable(fn) { clickHandler = fn || null; img.style.pointerEvents = fn ? "auto" : "none"; img.style.cursor = fn ? "crosshair" : ""; },
    destroy() {
      map.off("move zoom viewreset", update);
      map.off("zoomanim", onZoomAnim);
      img.removeEventListener("pointerdown", onImgPointerDown);
      img.removeEventListener("click", onImgClick);
      onWindowUp();
      if (img.parentNode) img.parentNode.removeChild(img);
    },
  };
}
