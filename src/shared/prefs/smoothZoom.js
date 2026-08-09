/* NEW-1 — THE SMOOTH-ZOOM PREFERENCE, LIFTED OUT OF THE PLANNER SO SETTINGS CAN OWN IT.
 *
 * This is a RELOCATION of the control, not a re-implementation of the setting. B1449 shipped the
 * toggle into the plan menu; B286000 moved it to the on-canvas View ▾ menu, and the owner still
 * could not find it ("I don't know where the option went for it"). View ▾ is a per-DRAWING display
 * menu — dock doors, column grid, dimensions, areas, grid size, snap — and smooth zoom is an
 * INTERFACE preference that follows the DEVICE across every plan and every project. So its one home
 * is now Settings → Interface, beside the display theme.
 *
 * ⛔ THREE THINGS THE OWNER SAID NOT TO CHANGE, and they are pinned by value in
 * test/smoothZoomHome.test.js: the storage key (`planarfit:smoothZoom`), the default (ON), and the
 * disarm-on-turn-off. The key keeps the `planarfit:` prefix every other planner preference carries —
 * renaming it would silently reset the setting for anyone who has already turned it off, and the
 * repo-wide `planarfit:` → `planyr:` rename is a deliberate, migrated job of its own (/CLAUDE.md →
 * DEFERRED).
 *
 * ⛔ AND THE REASON THIS IS A MODULE RATHER THAN A PROP: the control now lives OUTSIDE the planner
 * (in the account Settings modal, and in the signed-out header gear), while the behaviour it drives
 * lives INSIDE it. There is no component boundary the two share — the Settings modal is mounted by
 * the Shell, above every workspace. So the persisted value is the shared spine and the planner
 * SUBSCRIBES to it. What the planner keeps is the half only it can do: `disarmViewAnchor()` on
 * turn-off, without which the last gesture's scaled frame is left on screen with nothing to re-bake
 * it. That split is what keeps ONE place deciding the persisted value and ONE place reacting to it.
 *
 * Dependency-free and DOM-only (no React, no workspace imports) — it lands in the shared entry
 * chunk every route downloads, so it stays small by construction.
 */

export const SMOOTH_ZOOM_KEY = "planarfit:smoothZoom";
export const SMOOTH_ZOOM_DEFAULT = true;

/* One event name for same-tab listeners. `storage` only fires in OTHER tabs, so a page that
 * changes the value never hears its own write — which is exactly the case here (the Settings modal
 * and the planner canvas are the same document). */
const EVENT = "planyr:smoothzoom";

export function readSmoothZoom() {
  try {
    const v = localStorage.getItem(SMOOTH_ZOOM_KEY);
    return v == null ? SMOOTH_ZOOM_DEFAULT : v !== "0";
  } catch (_) {
    return SMOOTH_ZOOM_DEFAULT; // a blocked store must never change what the app DOES
  }
}

export function writeSmoothZoom(on) {
  const nx = !!on;
  // A full or blocked store must never break a toggle — but it must not swallow the CHANGE either,
  // so the notification fires regardless and the session still honours the new value.
  try { localStorage.setItem(SMOOTH_ZOOM_KEY, nx ? "1" : "0"); } catch (_) { /* see above */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: nx })); } catch (_) { /* no window (SSR/test) */ }
  return nx;
}

/* Subscribe to changes from anywhere — this tab (the custom event) or another tab on the same
 * device (the native `storage` event, which is what makes a per-DEVICE preference behave like one).
 * Returns an unsubscribe function. */
export function subscribeSmoothZoom(fn) {
  if (typeof window === "undefined") return () => {};
  const onCustom = (e) => fn(typeof e.detail === "boolean" ? e.detail : readSmoothZoom());
  const onStorage = (e) => { if (!e.key || e.key === SMOOTH_ZOOM_KEY) fn(readSmoothZoom()); };
  window.addEventListener(EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
