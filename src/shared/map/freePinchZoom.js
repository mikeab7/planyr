/* NEW-1 (B2016112) — free pinch zoom for the browse maps (Map Finder, Dashboard locations map,
 * Food map). Leaflet's default `zoomSnap: 1` rounds EVERY gesture to a whole level on release, so a
 * pinch could only settle at fixed steps. These maps now run `zoomSnap: 0` (a touch pinch lands
 * exactly where the fingers stop) and this module keeps the DISCRETE inputs stepping one full level:
 *
 *   touch pinch ........ Leaflet's own touchZoom, now unsnapped
 *   trackpad pinch ..... a `wheel` event with ctrlKey and a small delta → continuous zoom here, moved like a touch pinch
 *                        (`_move` per frame, one settle animation at the end — never a view reset per frame, B2426464 ×2)
 *   mouse wheel notch .. exactly ±1 level per notch (Leaflet's built-in wheel handler would turn a
 *                        notch into a fraction once the snap is 0)
 *   +/− buttons, double-click zoom ... unchanged: `zoomDelta` stays 1
 *
 * The site-plan backdrop map (SitePlanner.jsx) already ran `zoomSnap: 0` and is not touched. */

export const FREE_ZOOM_OPTIONS = Object.freeze({
  zoomSnap: 0,
  zoomDelta: 1,
  scrollWheelZoom: false, // replaced by attachFreeWheelZoom — Leaflet's would fractionalise a mouse notch
});

export const WHEEL_DEBOUNCE_MS = 40;       // Leaflet's default accumulation window
export const PINCH_LEVELS_PER_DELTA_PX = 0.01;
const PINCH_MAX_DELTA_PX = 50; // a ctrl+MOUSE notch reports ≥ ~100; a trackpad pinch reports small fractions

/** True when a wheel event is a trackpad pinch (browsers synthesise ctrl+wheel for it). */
export function isPinchWheel(e) {
  return !!e.ctrlKey && (e.deltaMode || 0) === 0 && Math.abs(e.deltaY || 0) < PINCH_MAX_DELTA_PX;
}

/** Zoom levels one pinch wheel event is worth (positive = zoom in). */
export function pinchLevels(e) {
  return -(e.deltaY || 0) * PINCH_LEVELS_PER_DELTA_PX;
}

/** Whole levels one debounced run of mouse-wheel delta is worth: exactly ±1 per notch, whatever
 *  the device's pixel scale (Leaflet's own sigmoid gave 1 or 2 depending on browser/OS pixel factor).
 *  `deltaPx` is Leaflet's normalised delta (positive = scroll up = zoom in). */
export function notchLevels(deltaPx) {
  return deltaPx ? Math.sign(deltaPx) : 0;
}

/** Install the wheel/trackpad handler on `map` (created with FREE_ZOOM_OPTIONS). Returns a detach fn. */
export function attachFreeWheelZoom(L, map) {
  const el = map.getContainer();
  let accum = 0;
  let timer = null;
  let anchor = null;
  let pinchPending = 0;
  let pinchFrame = 0;

  /* B2426464 ×2 — a trackpad pinch moves the map the way Leaflet's own TOUCH pinch does: `_move(…, { pinch: true })` per frame, one
   * `zoomanim` to settle when the fingers stop. It used to call `setZoomAround` with the animation switched off, per frame, which is a full view
   * reset: every tiled layer (the imagery included) threw away all its tiles and rebuilt them, every frame of the gesture, and every
   * `zoomend`/`moveend` listener (parcel stages, labels, requests) ran per frame too. Measured on composited frames
   * (ui-audit/measure-parcel-zoom-slide.mjs): 31–45 frames of a 50-frame pinch showed lines over no imagery. */
  let pinching = false, pinchEnd = null;
  const PINCH_SETTLE_MS = 140; // no pinch event for this long = the fingers stopped
  const endPinch = () => {
    pinchEnd = null;
    if (!pinching) return;
    if (map._animatingZoom) { pinchEnd = setTimeout(endPinch, 40); return; }
    pinching = false;
    const c = map.getCenter(), z = map.getZoom();
    if (map.options.zoomAnimation && map._zoomAnimated) map._animateZoom(c, z, true, map.options.zoomSnap);
    else map._resetView(c, z);
  };
  const flushPinch = () => {
    pinchFrame = 0;
    if (map._animatingZoom) { if (pinchPending) pinchFrame = requestAnimationFrame(flushPinch); return; } // a zoom is still settling
    const d = pinchPending; pinchPending = 0;
    if (!d || !anchor) return;
    const z0 = map.getZoom();
    const z = map._limitZoom(z0 + d);
    if (z === z0) return;
    if (!pinching) { map._stop && map._stop(); map._moveStart(true, false); pinching = true; }
    // keep the ground under the pointer still (Leaflet's own setZoomAround maths)
    const scale = map.getZoomScale(z, z0);
    const half = map.getSize().divideBy(2);
    const center = map.containerPointToLatLng(half.add(anchor.subtract(half).multiplyBy(1 - 1 / scale)));
    map._move(center, z, { pinch: true, round: false });
    if (pinchEnd) clearTimeout(pinchEnd);
    pinchEnd = setTimeout(endPinch, PINCH_SETTLE_MS);
  };
  const flushNotch = () => {
    timer = null;
    if (pinching) { accum = 0; return; } // a stray plain wheel event inside a pinch is part of the pinch, not a notch
    const lv = notchLevels(accum); accum = 0;
    if (!lv || !anchor) return;
    map._stop && map._stop();
    const z = map._limitZoom(map.getZoom() + lv);
    if (z !== map.getZoom()) map.setZoomAround(anchor, z);
  };
  const onWheel = (e) => {
    if (e.deltaX && !e.deltaY) return;
    anchor = map.mouseEventToContainerPoint(e);
    if (isPinchWheel(e)) {
      pinchPending += pinchLevels(e);
      if (!pinchFrame) pinchFrame = requestAnimationFrame(flushPinch);
    } else {
      accum += L.DomEvent.getWheelDelta(e);
      if (!timer) timer = setTimeout(flushNotch, WHEEL_DEBOUNCE_MS);
    }
    e.preventDefault();
    e.stopPropagation();
  };
  el.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    el.removeEventListener("wheel", onWheel);
    if (timer) clearTimeout(timer);
    if (pinchFrame) cancelAnimationFrame(pinchFrame);
    if (pinchEnd) clearTimeout(pinchEnd);
  };
}
