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
  pane.appendChild(img);

  let corners = null, imgW = 0, imgH = 0, clickHandler = null;

  const update = () => {
    if (!corners || !imgW || !imgH) return;
    const p0 = map.latLngToLayerPoint(corners.topLeft);
    const p1 = map.latLngToLayerPoint(corners.topRight);
    const p2 = map.latLngToLayerPoint(corners.bottomLeft);
    const a = (p1.x - p0.x) / imgW, b = (p1.y - p0.y) / imgW;
    const c = (p2.x - p0.x) / imgH, d = (p2.y - p0.y) / imgH;
    img.style.width = `${imgW}px`;
    img.style.height = `${imgH}px`;
    img.style.transform = `matrix(${a},${b},${c},${d},${p0.x},${p0.y})`;
  };

  map.on("move zoom viewreset", update);

  const onImgClick = (e) => {
    if (!clickHandler) return;
    L.DomEvent.stop(e); // consume it — the plan is the target, not the map underneath
    clickHandler(map.mouseEventToLatLng(e));
  };
  img.addEventListener("click", onImgClick);

  return {
    setImage(url) { img.src = url || ""; },
    setCorners(c) { corners = c; update(); },
    setSize(w, h) { imgW = w; imgH = h; update(); },
    setOpacity(op) { img.style.opacity = String(op == null ? 1 : op); },
    setVisible(v) { img.style.display = v === false ? "none" : ""; },
    setClickable(fn) { clickHandler = fn || null; img.style.pointerEvents = fn ? "auto" : "none"; img.style.cursor = fn ? "crosshair" : ""; },
    destroy() {
      map.off("move zoom viewreset", update);
      img.removeEventListener("click", onImgClick);
      if (img.parentNode) img.parentNode.removeChild(img);
    },
  };
}
