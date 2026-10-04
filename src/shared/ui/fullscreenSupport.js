/* NEW-1 (B-fullscreen-gate) — the ONE answer to "can a full-screen control do anything here?".
 *
 * Feature detection only, never user-agent sniffing. iPhone Safari exposes neither
 * `document.fullscreenEnabled` nor `webkitFullscreenEnabled` for page elements, so a control that
 * offers full screen there is a dead button; iPad Safari and desktop browsers report it, and keep
 * the control. An installed home-screen app (or any page already running with no browser chrome)
 * has nothing further to expand into, so it is also "unavailable".
 *
 * Every full-screen control in the app reads this (today: the AppHeader button, the only one —
 * the map, Notes, Schedule and Review have no full-screen control of their own; they inherit the
 * header's, and the `F` shortcut routes through the same header toggle). Dependency-free: it
 * lands in the entry chunk every route downloads.
 */
import { useEffect, useState } from "react";

const DISPLAY_MODES = ["(display-mode: standalone)", "(display-mode: fullscreen)"];

function mq(q) {
  try { return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q) : null; }
  catch (_) { return null; }
}

/* True when the page is already chromeless: an installed app, or iOS's `navigator.standalone`. */
export function runningChromeless() {
  if (typeof navigator !== "undefined" && navigator.standalone === true) return true;
  return DISPLAY_MODES.some((q) => { const m = mq(q); return !!(m && m.matches); });
}

/* The browser says full screen is permitted AND the target element can be asked for it. */
export function fullscreenApiAvailable(doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return false;
  const enabled = doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
  if (!enabled) return false;
  const el = doc.documentElement;
  return !!(el && (el.requestFullscreen || el.webkitRequestFullscreen));
}

export function fullscreenAvailable() {
  return fullscreenApiAvailable() && !runningChromeless();
}

/* Reactive: re-reads when the display mode flips (entering full screen sets
 * `display-mode: fullscreen` in Chromium; callers keep their control up while active). */
export function useFullscreenAvailable() {
  const [ok, setOk] = useState(fullscreenAvailable);
  useEffect(() => {
    const on = () => setOk(fullscreenAvailable());
    on();
    const ms = DISPLAY_MODES.map(mq).filter(Boolean);
    ms.forEach((m) => (m.addEventListener ? m.addEventListener("change", on) : m.addListener && m.addListener(on)));
    return () => ms.forEach((m) => (m.removeEventListener ? m.removeEventListener("change", on) : m.removeListener && m.removeListener(on)));
  }, []);
  return ok;
}
