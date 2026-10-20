/* The ONE file-drag tracker for the whole app (NEW-1/NEW-2, 2026-10-12).
 *
 * Two owner reports, one cause: every drop zone kept its OWN "a file is over me" flag, driven by
 * per-element dragenter/dragleave COUNTING. A drag that ends without a matching dragleave (released
 * outside the window, cancelled, a failed drop, an element unmounting under the cursor) strands the
 * counter above zero and pins the blue "Drop to add…" overlay on screen for good — and because
 * every workspace stays mounted behind `display:none`, a stuck flag in a hidden view surfaces later
 * in another one. And a drop that lands on any spot WITHOUT a handler (a header, a rail, empty space)
 * is the browser's own: Chrome downloads/opens the file instead.
 *
 * So this module owns both halves, once:
 *   · `fileDragActive()` / `useFileDragActive(visible)` — "is a file being dragged over the window
 *     right now", ONE answer for every surface. It is set only by a drag whose dataTransfer.types
 *     includes "Files" (a map-feature or text drag never raises it), and it is cleared by EVERYTHING
 *     that can end or invalidate a drag: the drag leaving the window, a drop anywhere, dragend,
 *     Escape, window blur, any mousemove / pointerdown (a real drag fires neither), the tab hiding, a
 *     view change, and a watchdog (a live drag fires dragover continuously; silence = no drag).
 *   · the bubble-phase preventDefault on dragover AND drop for a Files drag, at the window, so the
 *     browser can never open or download a dropped file anywhere in the app. A zone that accepts the
 *     drop still handles it first (it is deeper in the tree); this only catches what nobody did.
 *
 * Nothing here accepts or routes a file — each surface keeps its own drop handler.
 */
import { useSyncExternalStore } from "react";

/** A drag that carries OS files (vs. an in-page text/element/feature drag). */
export const isFileDrag = (e) => {
  try { return !!e && !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"); }
  catch (_) { return false; }
};

/** A real drag fires dragover every ~50–350 ms even with a still pointer; this much silence = over. */
export const DRAG_WATCHDOG_MS = 2000;
/** Chromium reports a null relatedTarget on some in-page transitions; a real exit stays quiet. */
export const LEAVE_GRACE_MS = 120;

let active = false;
let watchdog = null;
let leaveTimer = null;
const subs = new Set();
const notify = () => { subs.forEach((f) => { try { f(); } catch (_) { /* a subscriber must not break the tracker */ } }); };
const killTimers = () => {
  if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
};

export const fileDragActive = () => active;

/** Clear the tracker (every end-of-drag path funnels here). */
export function clearFileDrag() {
  killTimers();
  if (!active) return;
  active = false;
  notify();
}

function raise() {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
  if (watchdog) clearTimeout(watchdog);
  watchdog = setTimeout(clearFileDrag, DRAG_WATCHDOG_MS);
  if (active) return;
  active = true;
  notify();
}

export function subscribeFileDrag(fn) { subs.add(fn); return () => subs.delete(fn); }

/** True while a file is being dragged over the window AND `visible` (the surface is the one showing). */
export function useFileDragActive(visible = true) {
  const on = useSyncExternalStore(subscribeFileDrag, fileDragActive, () => false);
  return !!visible && on;
}

// A drop a surface has already routed (so a catch-all like the Library's can skip it).
const handled = new WeakSet();
export const markDropHandled = (e) => { if (e && typeof e === "object") handled.add(e); try { if (e?.nativeEvent) handled.add(e.nativeEvent); } catch (_) { /* */ } };
export const dropWasHandled = (e) => !!e && (handled.has(e) || (!!e.nativeEvent && handled.has(e.nativeEvent)));

let uninstall = null;

/** Arm the guard once for the page. Returns the disposer (tests); calling twice is a no-op. */
export function installFileDragGuard(win = typeof window !== "undefined" ? window : null) {
  if (!win || uninstall) return uninstall || (() => {});
  const doc = win.document;
  const on = [];
  const add = (t, type, fn, capture = false) => { const o = { capture }; t.addEventListener(type, fn, o); on.push(() => t.removeEventListener(type, fn, o)); };

  // CAPTURE phase for tracking: a zone's stopPropagation must never hide an event from the tracker.
  add(win, "dragenter", (e) => { if (isFileDrag(e)) raise(); }, true);
  add(win, "dragover", (e) => { if (isFileDrag(e)) raise(); }, true);
  add(win, "dragleave", (e) => {
    if (!active || e.relatedTarget != null) return; // moving between elements — not an exit
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(clearFileDrag, LEAVE_GRACE_MS); // a following dragover (in-page transition) cancels it in raise()
  }, true);
  add(win, "drop", () => clearFileDrag(), true);
  add(win, "dragend", () => clearFileDrag(), true);
  add(win, "keydown", (e) => { if (active && e.key === "Escape") clearFileDrag(); }, true);
  add(win, "blur", () => clearFileDrag());
  // A real drag fires neither of these, so seeing one while "active" proves the drag is over.
  add(win, "mousemove", () => { if (active) clearFileDrag(); }, true);
  add(win, "pointerdown", () => { if (active) clearFileDrag(); }, true);
  add(win, "pointermove", (e) => { if (active && e.pointerType !== "" && (e.buttons === 0 || e.buttons === undefined)) clearFileDrag(); }, true);
  add(win, "hashchange", () => clearFileDrag());
  add(win, "popstate", () => clearFileDrag());
  add(win, "pagehide", () => clearFileDrag());
  if (doc) add(doc, "visibilitychange", () => { if (doc.visibilityState !== "visible") clearFileDrag(); });

  // BUBBLE phase for the default action: every surface that wants the drop has already had it.
  // A dragover nobody claimed (not defaultPrevented by a surface that handles the drop) is a dead spot: show the
  // no-drop cursor there instead of the "copy" plus the browser would otherwise paint (cursor convention).
  add(win, "dragover", (e) => {
    if (!isFileDrag(e)) return;
    if (!e.defaultPrevented && e.dataTransfer) { try { e.dataTransfer.dropEffect = "none"; } catch (_) { /* read-only in some engines */ } }
    e.preventDefault();
  });
  add(win, "drop", (e) => { if (isFileDrag(e)) e.preventDefault(); });

  uninstall = () => { on.forEach((f) => f()); clearFileDrag(); uninstall = null; };
  return uninstall;
}
