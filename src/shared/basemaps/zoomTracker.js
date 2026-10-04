/* Zoom-animation tracker for our own canvas layers (NEW-1 amend, 2026-09-29).
 *
 * WHY THIS EXISTS. Leaflet animates imagery, markers and its own renderers on a zoom by CSS
 * transition, but a hand-drawn canvas is invisible to that machinery: Leaflet fires `zoomanim`,
 * moves its state to the FINAL view in the same tick, and lets the tiles slide there over 0.25 s.
 * A layer that redraws from map state snaps to the end position on frame one; one that Leaflet
 * scales (its stock canvas renderer) stays pinned to the ground but its bitmap — text and
 * hairlines included — is stretched by up to the zoom factor and then re-drawn crisp, which is
 * the "drifts, stretches, jumps" look. Google Maps does neither: features ride the ground and
 * their size on screen never changes.
 *
 * THE MATHS. CSS interpolates a translate+scale transform's components linearly in eased time, so
 * any ground point's screen position is EXACTLY lerp(position in the start view, position in the
 * end view, progress). Draw at that lerp, never scale the canvas, and the layer is pinned to the
 * ground with constant-size ink.
 *
 * THE CLOCK. Progress is not computed from a timer. A hidden element carrying Leaflet's own
 * `leaflet-zoom-animated` class is moved 0 → TRAVEL px in the `zoomanim` handler, so the SAME CSS
 * transition (duration, easing, start frame) runs on it as on the tiles; each frame its computed
 * transform IS the tiles' progress. (zoomanim can fire inside Leaflet's own rAF callback, a frame
 * ahead of ours — a clock started here was measured a frame late.) If the transform is unreadable
 * it falls back to the clock (`zoomEase`), at worst a frame of skew.
 *
 * Pure maths (`zoomEase`, `lerpPoint`) lives in placeNamesData.js and is unit-tested there. This
 * file needs Leaflet's map and a DOM; it is imported only by the two lazily-loaded layers
 * (`placeNamesLayer.js`, `adminBoundaryLayer.js`) — nothing on the boot path.
 */
import L from "leaflet";
import { zoomEase, lerpPoint, ZOOM_ANIM_MS } from "./placeNamesData.js";

const TRAVEL = 1000;
const TILE = 256; // Leaflet's default tile size — the EPSG:3857 world is TILE·2^z px wide

/* Unit web-mercator (x, y in 0..1, y down) for a [lat, lng] — computed ONCE per vertex by a layer;
 * screen = unit · TILE·2^zoom + offset, which makes a per-frame projection two multiplies. */
export function toUnit(map, ll) {
  const p = map.project(ll, 0);
  return [p.x / TILE, p.y / TILE];
}

export function createZoomTracker(map, host, { onStart, onEnd } = {}) {
  const sentinel = L.DomUtil.create("div", "leaflet-zoom-animated", host);
  sentinel.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;transform:translate3d(0,0,0)`;
  let anim = null;

  /* Screen offset of the world's top-left corner in a view → screen = unit·scale + offset. */
  const settledView = () => {
    const z = map.getZoom();
    const o = map.latLngToContainerPoint(map.unproject([0, 0], z)); // exact parity with the tiles (Leaflet's own rounding)
    return { z, scale: TILE * Math.pow(2, z), ox: o.x, oy: o.y };
  };
  const targetView = (center, zoom) => {
    const s = map.getSize(), c = map.project(center, zoom);
    return { z: zoom, scale: TILE * Math.pow(2, zoom), ox: s.x / 2 - c.x, oy: s.y / 2 - c.y };
  };

  const onZoomAnim = (e) => {
    if (e.noUpdate) return; // per-frame pinch events — the state is already truthful there
    anim = { t0: null, a: settledView(), b: targetView(e.center, e.zoom), center: e.center };
    void getComputedStyle(sentinel).transform;              // flush: start point committed, transition rule live
    sentinel.style.transform = `translate3d(${TRAVEL}px,0,0)`;
    if (onStart) onStart(e);
  };
  const onZoomEnd = () => {
    anim = null;
    sentinel.style.transform = "translate3d(0,0,0)";
    if (onEnd) onEnd();
  };
  map.on("zoomanim", onZoomAnim);
  map.on("zoomend", onZoomEnd);

  const progress = (now) => {
    const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(sentinel).transform || "");
    const e = m ? parseFloat(m[1].split(",")[4]) : NaN;
    if (Number.isFinite(e)) return Math.min(1, Math.max(0, e / TRAVEL));
    if (anim.t0 == null) anim.t0 = now;
    return zoomEase((now - anim.t0) / ZOOM_ANIM_MS);
  };

  return {
    get animating() { return !!anim; },
    /* Where the zoom is heading ({ center, zoom }) while animating, else null. */
    get target() { return anim ? { center: anim.center, zoom: anim.b.z } : null; },
    /* This frame's projection. `unit(ux, uy)` and `at([lat,lng])` both return a screen {x,y};
     * `zoom` is the view being DRAWN (the end view while animating — what style/opacity ramps use). */
    frame(now) {
      if (!anim) {
        const v = settledView();
        const unit = (ux, uy) => ({ x: ux * v.scale + v.ox, y: uy * v.scale + v.oy });
        return { zoom: v.z, animating: false, p: 1, unit, at: (ll) => { const q = map.latLngToContainerPoint(ll); return { x: q.x, y: q.y }; } };
      }
      const p = progress(now), { a, b } = anim;
      const unit = (ux, uy) => lerpPoint({ x: ux * a.scale + a.ox, y: uy * a.scale + a.oy }, { x: ux * b.scale + b.ox, y: uy * b.scale + b.oy }, p);
      const at = (ll) => { const [ux, uy] = toUnit(map, ll); return unit(ux, uy); };
      return { zoom: b.z, animating: true, p, unit, at };
    },
    /* Projection for an ARBITRARY view — what a layer lays out against ("where will things be"). */
    viewAt(center, zoom) {
      const v = targetView(center, zoom);
      return (ll) => { const [ux, uy] = toUnit(map, ll); return { x: ux * v.scale + v.ox, y: uy * v.scale + v.oy }; };
    },
    destroy() {
      map.off("zoomanim", onZoomAnim);
      map.off("zoomend", onZoomEnd);
      try { sentinel.remove(); } catch (_) { /* map already torn down */ }
    },
  };
}
