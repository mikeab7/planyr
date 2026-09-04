/* Harness for B849841/NEW-2 — "the site plan does not track the map during zoom". Drives the REAL
 * production code (rotatedImageLayer.js, unmodified import) against a bare Leaflet map — no React
 * app, no Supabase, no auth — because the defect and its fix live entirely inside that one module's
 * relationship with Leaflet's own zoom-animation events. See verify-siteplan-overlay-zoom-anim.mjs
 * for how this is driven and what it asserts.
 *
 * Ground truth is Leaflet's OWN canonical zoom-animated element — an `L.marker` placed at the exact
 * same latLng as the overlay's top-left corner. Leaflet's Marker is the reference implementation of
 * "track a georeferenced point through an animated zoom" (Marker.js `_animateZoom`); if our custom
 * image layer stays coincident with it throughout the animation, it is correctly participating in
 * the same mechanism, not just correct at rest.
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { createRotatedImageLayer } from "/src/workspaces/site-planner/lib/rotatedImageLayer.js";

const map = L.map("map", {
  zoomAnimation: true,
  fadeAnimation: false,
  center: [29.9539, -95.4132], // near Airtex, north Houston — matches the owner's real plan's area
  zoom: 16,
});

// A 1×1 transparent PNG — only the transform matrix is under test, never actual pixels.
const TRANSPARENT_PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const topLeft = L.latLng(29.958, -95.418);
const topRight = L.latLng(29.958, -95.408);
const bottomLeft = L.latLng(29.950, -95.418);
const IMG_W = 1000, IMG_H = 1000;

const layer = createRotatedImageLayer(map);
layer.setCorners({ topLeft, topRight, bottomLeft });
layer.setSize(IMG_W, IMG_H);
layer.setImage(TRANSPARENT_PX);
layer.setOpacity(1);
layer.setVisible(true);

const refIcon = L.divIcon({ className: "ref-marker", iconSize: [1, 1], iconAnchor: [0, 0], html: "" });
const marker = L.marker(topLeft, { icon: refIcon, interactive: false, zIndexOffset: 10000 }).addTo(map);

function readXY(el) {
  if (!el) return null;
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return null;
  const m = new DOMMatrixReadOnly(t);
  return { x: m.e, y: m.f };
}

function overlayImgEl() {
  const pane = map.getPane("sitePlanOverlayPane");
  return pane ? pane.querySelector("img") : null;
}

/** Runs a real, animated `map.setZoom`, sampling the overlay's rendered anchor position against
 * the reference marker's on every animation frame, and returns every sample plus the worst
 * (largest) error in pixels. `durationMs` must comfortably exceed Leaflet's own ~250ms zoom
 * transition so the settle frame is captured too. */
async function runZoom(targetZoom, durationMs = 500) {
  const samples = [];
  let raf = null;
  const overlayImg = overlayImgEl();
  const markerEl = marker.getElement();
  const tick = () => {
    const a = readXY(overlayImg);
    const b = readXY(markerEl);
    if (a && b) samples.push({ t: performance.now(), ax: a.x, ay: a.y, bx: b.x, by: b.y, err: Math.hypot(a.x - b.x, a.y - b.y) });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  map.setZoom(targetZoom, { animate: true });
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  cancelAnimationFrame(raf);
  const worst = samples.reduce((m, s) => Math.max(m, s.err), 0);
  return { samples, worst, count: samples.length, startZoom: map.getZoom() };
}

window.__zoomAnimHarness = { ready: true, runZoom, getZoom: () => map.getZoom(), setZoom: (z) => map.setZoom(z, { animate: false }) };
