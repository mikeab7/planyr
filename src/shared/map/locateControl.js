/* The ONE "my location" control for every Leaflet map in the app (NEW-1/NEW-2). A map calls
 * `addLocateControl(L, map, hooks)`; nothing about the button, the marker, the heading cone or the
 * permission handling is copied per map. Today the only Leaflet map with a locate control is the
 * Site tab's browse map (MapFinder) — a new map gets the identical control by calling this.
 *
 * Marker: Apple-style blue dot + white ring, an accuracy circle in real ground metres
 * (`L.circle`, so it scales with zoom), and a soft heading cone ONLY when a real heading exists.
 * Button: navigation-arrow icon — idle (outline gray) · following (solid blue) · located-but-panned-
 * away (outline blue). Pure pieces: locateHeading.js · locateButtonState.js · locateGeometry.js ·
 * locateMe.js (availability + honest messages). */
import {
  shouldShowAccuracyCircle, formatAccuracyFt, locateErrorMessage,
  isAccuracyUsable, garbageAccuracyMessage, locateAvailability, locateUnavailableTooltip,
} from "./locateMe.js";
import { headingFromOrientation, resolveHeading, smoothHeading } from "./locateHeading.js";
import { nextLocateState, tapAction } from "./locateButtonState.js";
import { accuracyCircleVisible } from "./locateGeometry.js";

// Tabler "navigation": outline when idle/located, filled when following (CSS flips fill per state).
const ARROW_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l18 -8l-8 18l-2 -8l-8 -2z"/></svg>';

const FIRST_FIX_TIMEOUT_MS = 10000;
const WATCHDOG_MS = 12000;
const HEADING_THROTTLE_MS = 80;
const GLIDE_MS = 600;

/* hooks: { onNotice(msg), onError(msg), onFix(e), onStateChange(state), isAlive() }
 * returns { button, getState, destroy } */
export function addLocateControl(L, map, hooks = {}) {
  const onNotice = hooks.onNotice || (() => {});
  const onError = hooks.onError || (() => {});
  const onFix = hooks.onFix || (() => {});
  const onStateChange = hooks.onStateChange || (() => {});
  const isAlive = hooks.isAlive || (() => true);

  let state = "idle";
  let availability = "ready";
  let latest = null;            // { latlng, accuracy, coords }
  let orientHeading = null;     // compass heading (smoothed)
  let lastHeadingAt = 0;
  let marker = null, circle = null, pane = null, glideTimer = null, watchdog = null;
  let listening = false;

  const container = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-locate");
  const btn = L.DomUtil.create("a", "", container);
  btn.href = "#"; btn.setAttribute("role", "button"); btn.setAttribute("data-testid", "locate-me-btn");
  btn.innerHTML = ARROW_SVG;
  L.DomEvent.disableClickPropagation(container);

  const render = () => {
    const blocked = availability !== "ready";
    const tip = blocked ? locateUnavailableTooltip(availability) : ({
      idle: "Find my location", locating: "Finding your location…", following: "Following your location — tap to stop",
      located: "Re-center on my location",
    }[state] || "Find my location");
    btn.title = tip;
    btn.setAttribute("aria-label", blocked ? `Find my location — ${tip}` : tip);
    btn.setAttribute("data-locate-state", state === "idle" && blocked ? "blocked" : state);
    btn.setAttribute("aria-pressed", state === "following" ? "true" : "false");
    btn.style.opacity = blocked ? "0.4" : "";
    btn.style.cursor = blocked ? "default" : "pointer";
    btn.style.animation = state === "locating" ? "locate-pulse 1s ease-in-out infinite" : "";
  };
  const setState = (event) => {
    const next = nextLocateState(state, event);
    if (next === state) return;
    state = next; render(); onStateChange(state);
  };
  const applyAvailability = (a) => { availability = a; render(); };

  const clearWatchdog = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };

  // ---- marker ----
  const ensurePane = () => {
    if (pane) return;
    pane = map.getPane("locatePane") || map.createPane("locatePane");
    pane.style.zIndex = 645;          // above parcel outlines (overlay 400) and site pins (marker 600)
    pane.style.pointerEvents = "none"; // never steals a tap from a parcel beneath
  };
  const currentHeading = () => resolveHeading({ orientationHeading: orientHeading, coords: latest && latest.coords });
  const paintCone = () => {
    if (!marker) return;
    const el = marker.getElement();
    const cone = el && el.querySelector(".locate-cone");
    if (!cone) return;
    const h = currentHeading();
    if (h == null) { cone.style.display = "none"; cone.removeAttribute("data-heading"); return; }
    cone.style.display = "block";
    cone.setAttribute("data-heading", String(Math.round(h)));
    cone.style.transform = `rotate(${h}deg)`;
  };
  const syncCircle = () => {
    if (!latest) return;
    const show = shouldShowAccuracyCircle(latest.accuracy) && accuracyCircleVisible(latest.accuracy, latest.latlng.lat, map.getZoom());
    if (show && !circle) {
      circle = L.circle(latest.latlng, { radius: latest.accuracy, pane: "locatePane", className: "locate-accuracy", weight: 1, interactive: false }).addTo(map);
    } else if (show) {
      circle.setLatLng(latest.latlng); circle.setRadius(latest.accuracy);
    } else if (circle) { map.removeLayer(circle); circle = null; }
  };
  const placeMarker = (first) => {
    ensurePane();
    if (!marker) {
      marker = L.marker(latest.latlng, {
        pane: "locatePane", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "locate-marker", iconSize: [64, 64], iconAnchor: [32, 32],
          html: '<div class="locate-cone" style="display:none"></div><div class="locate-dot" data-testid="locate-dot"></div>' }),
      }).addTo(map);
    } else {
      const el = marker.getElement();
      if (el && !first) { el.classList.add("locate-glide"); clearTimeout(glideTimer); glideTimer = setTimeout(() => el.classList.remove("locate-glide"), GLIDE_MS); }
      marker.setLatLng(latest.latlng);
    }
    syncCircle(); paintCone();
  };
  const clearMarker = () => {
    clearTimeout(glideTimer);
    if (marker) { map.removeLayer(marker); marker = null; }
    if (circle) { map.removeLayer(circle); circle = null; }
    latest = null; orientHeading = null;
  };

  // ---- heading sources ----
  const onOrientation = (e) => {
    const now = Date.now();
    if (now - lastHeadingAt < HEADING_THROTTLE_MS) return;
    // deviceorientationabsolute is north-referenced by definition; a plain event only counts when it says so.
    const h = headingFromOrientation({ webkitCompassHeading: e.webkitCompassHeading, alpha: e.alpha, absolute: e.absolute === true || e.type === "deviceorientationabsolute" });
    if (h == null) return;
    lastHeadingAt = now;
    orientHeading = smoothHeading(orientHeading, h);
    paintCone();
  };
  const listen = () => {
    if (listening || typeof window === "undefined") return;
    listening = true;
    window.addEventListener("deviceorientationabsolute", onOrientation);
    window.addEventListener("deviceorientation", onOrientation);
  };
  const unlisten = () => {
    if (!listening) return;
    listening = false;
    window.removeEventListener("deviceorientationabsolute", onOrientation);
    window.removeEventListener("deviceorientation", onOrientation);
  };
  // iOS gates compass data behind a permission that MUST be requested from a user gesture (this tap).
  // Denied or unavailable → silently no cone.
  const requestCompass = () => {
    try {
      const DOE = typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null;
      if (DOE && typeof DOE.requestPermission === "function") {
        const p = DOE.requestPermission();
        if (p && p.then) p.then((r) => { if (r === "granted") listen(); }).catch(() => {});
        return;
      }
    } catch (_) { /* silent — the cone is an enhancement */ }
    listen();
  };

  // ---- lifecycle ----
  const stopTracking = (event) => {
    clearWatchdog();
    try { map.stopLocate(); } catch (_) {}
    unlisten();
    clearMarker();
    setState(event);
  };
  const stopLocatingKeepIdle = () => { clearWatchdog(); try { map.stopLocate(); } catch (_) {} unlisten(); setState("stop"); };

  const onFound = (e) => {
    if (state === "idle" || state === "blocked") return; // stale result after a cancel/stop — ignore
    const first = state === "locating";
    if (first) clearWatchdog();
    if (!isAccuracyUsable(e.accuracy)) {
      if (first) { stopTracking("error"); onError(garbageAccuracyMessage(e.accuracy)); }
      return; // a vague mid-track update is simply not drawn
    }
    latest = { latlng: e.latlng, accuracy: e.accuracy, coords: { heading: e.heading, speed: e.speed } };
    placeMarker(first);
    if (first) {
      const zoom = Math.min(map.getBoundsZoom(e.latlng.toBounds(e.accuracy * 2)), 17);
      map.setView(e.latlng, zoom);
      setState("found");
      if (!shouldShowAccuracyCircle(e.accuracy)) {
        const acc = formatAccuracyFt(e.accuracy);
        onError(acc ? `Location is approximate (accuracy ${acc}) — this looks like a network-based guess, not a GPS fix.` : "Location found, but its accuracy couldn't be read — treat it as approximate.");
      }
      onFix(e);
    } else if (state === "following") {
      map.panTo(e.latlng, { animate: true, duration: 0.5 });
    }
  };
  const onLocError = (e) => {
    if (state === "idle" || state === "blocked") return;
    // Once tracking, a timeout (3) or a momentary "position unavailable" (2 — a tunnel, a GPS blip)
    // is not a failure: the browser's watch keeps retrying. Only a revoked permission (1) ends it.
    if (state !== "locating" && e && (e.code === 3 || e.code === 2)) return;
    stopTracking("error");
    onError(locateErrorMessage(e && e.code));
  };
  // Panning away (a real drag, never our own panTo) drops "following" to "located".
  const onDragStart = () => { if (state === "following") setState("panned"); };

  L.DomEvent.on(btn, "click", (e) => {
    L.DomEvent.stop(e);
    const action = tapAction(state);
    if (action === "cancel") { stopLocatingKeepIdle(); return; }   // 2nd press while a fix is in flight cancels it
    if (action === "stop") { stopTracking("tap"); return; }       // 2nd tap while following = tracking off
    if (action === "recenter") {
      if (latest) { map.setView(latest.latlng, Math.max(map.getZoom(), Math.min(map.getBoundsZoom(latest.latlng.toBounds(latest.accuracy * 2)), 17))); }
      setState("tap");
      return;
    }
    if (availability !== "ready") { onNotice(locateUnavailableTooltip(availability)); return; }
    requestCompass(); // from the tap itself — iOS requires the gesture
    setState("tap"); // idle → locating
    try {
      // Explicit finite timeout (PositionOptions default is Infinity = a spinner that never ends) +
      // the independent watchdog below; maximumAge 0 never accepts an hours-old cached fix.
      map.locate({ watch: true, enableHighAccuracy: true, maxZoom: 17, timeout: FIRST_FIX_TIMEOUT_MS, maximumAge: 0 });
    } catch (_) {
      stopLocatingKeepIdle(); onError(locateErrorMessage()); return;
    }
    watchdog = setTimeout(() => {
      if (state !== "locating") return;
      stopLocatingKeepIdle(); onError(locateErrorMessage(3));
    }, WATCHDOG_MS);
  });

  const ctrl = L.control({ position: "bottomleft" });
  ctrl.onAdd = () => container;
  ctrl.addTo(map);
  map.on("locationfound", onFound);
  map.on("locationerror", onLocError);
  map.on("dragstart", onDragStart);
  map.on("zoomend", syncCircle);

  // ---- availability (best-effort precheck; the click path's timeout+watchdog is the real defence) ----
  const readEnv = (permissionState) => ({
    isSecureContext: typeof window === "undefined" || window.isSecureContext !== false,
    hasGeolocation: typeof navigator !== "undefined" && !!navigator.geolocation,
    permissionState,
  });
  applyAvailability(locateAvailability(readEnv(undefined)));
  let detachPerm = () => {};
  if (typeof navigator !== "undefined" && navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "geolocation" }).then((status) => {
      if (!isAlive()) return;
      const onChange = () => applyAvailability(locateAvailability(readEnv(status.state)));
      onChange();
      if (status.addEventListener) status.addEventListener("change", onChange); else status.onchange = onChange;
      detachPerm = () => { try { status.removeEventListener ? status.removeEventListener("change", onChange) : (status.onchange = null); } catch (_) {} };
    }).catch(() => {});
  }

  render();
  return {
    button: btn,
    getState: () => state,
    destroy() {
      clearWatchdog(); detachPerm(); unlisten(); clearTimeout(glideTimer);
      try { map.stopLocate(); } catch (_) {}
      map.off("locationfound", onFound); map.off("locationerror", onLocError);
      map.off("dragstart", onDragStart); map.off("zoomend", syncCircle);
    },
  };
}
