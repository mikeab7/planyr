// NEW-1 (2026-11-06) — "i want ctrl zoom to always work if im hovering over the schedule".
//
// The embedded Schedule (public/sequence/index.html, an iframe) turns its Ctrl+wheel zoom ON only while it KNOWS
// Ctrl/Cmd is down: a permanent blocking wheel listener there costs ~15 ms on EVERY wheel→scroll at every CPU speed
// (measured, B2644624 follow-up), and the owner just confirmed the scroll "works well". But a Ctrl press while keyboard
// focus is anywhere else in the app (the header, the project switcher, a panel) is delivered to THIS document and never
// to the frame — so with no listener the BROWSER zoomed the page. This forwards the modifier state to the frame:
//   · keydown / keyup on this window  → `planar:modifier-keys` {ctrl}, only when the state CHANGES;
//   · this window losing focus        → "up" (a keyup is never delivered after a blur).
// Dependency-free on purpose: the harness ui-audit/verify-schedule-ctrl-zoom-hover.mjs loads THIS file, so what it
// proves is the shipped forwarder, not a copy of it.
//
// win:       the shell window (anything with add/removeEventListener)
// getFrame:  () => the iframe's contentWindow, or null/undefined while it is not mounted
// origin:    the exact origin to post to (same-origin iframe — never "*")
export function installModifierForward(win, getFrame, origin) {
  let last = false;
  const send = (down) => {
    if (down === last) return;
    last = down;
    try {
      const f = getFrame();
      if (f) f.postMessage({ source: "planar-shell", type: "planar:modifier-keys", ctrl: down }, origin);
    } catch (_) { /* a frame that is mid-reload simply misses it; the next key event re-sends */ }
  };
  const onKey = (e) => send(!!(e.ctrlKey || e.metaKey));
  const onBlur = () => send(false);
  win.addEventListener("keydown", onKey, true);
  win.addEventListener("keyup", onKey, true);
  win.addEventListener("blur", onBlur);
  return () => {
    win.removeEventListener("keydown", onKey, true);
    win.removeEventListener("keyup", onKey, true);
    win.removeEventListener("blur", onBlur);
  };
}
