/* NEW-1 (B2016112) — free pinch zoom for the browse maps (Map Finder, Dashboard locations map,
 * Food map). Leaflet's default `zoomSnap: 1` rounds EVERY gesture to a whole level on release, so a
 * pinch could only settle at fixed steps. These maps now run `zoomSnap: 0` (a touch pinch lands
 * exactly where the fingers stop) and this module keeps the DISCRETE inputs stepping one full level:
 *
 *   touch pinch ........ Leaflet's own touchZoom, now unsnapped
 *   trackpad pinch ..... a `wheel` event with ctrlKey and a small delta → continuous zoom here
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

  const flushPinch = () => {
    pinchFrame = 0;
    const d = pinchPending; pinchPending = 0;
    if (!d || !anchor) return;
    map._stop && map._stop();
    const z = map._limitZoom(map.getZoom() + d);
    if (z !== map.getZoom()) map.setZoomAround(anchor, z, { animate: false });
  };
  const flushNotch = () => {
    timer = null;
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
  };
}
