/* bottomSheetTracker — how tall is the currently-open mobile bottom sheet (Food's
 * `components/BottomSheet.jsx`), published as a tiny module-scope signal so a fixed,
 * bottom-anchored floating notice (FloatingNotice.jsx) can sit ABOVE it instead of under or
 * over it (NEW-1, docs/DESIGN.md "Floating notifications").
 *
 * Module scope rather than React context: the sheet lives inside one workspace (Food) and a
 * floating notice is shared app-level chrome that can mount from anywhere (AppHeader,
 * ProjectBreadcrumb, Shell, MapFinder) — there is no shared ancestor to hang a context provider
 * off without wiring one into every workspace root for a case that matters on exactly one of
 * them. Same shape as `prefs/smoothZoom.js`: one value, one publisher, a subscription.
 */
import { useEffect, useState } from "react";

let height = 0;
const subscribers = new Set();

/** Called by BottomSheet.jsx whenever its own height changes (mount, snap, drag, unmount → 0). */
export function publishBottomSheetHeight(px) {
  height = px > 0 ? px : 0;
  subscribers.forEach((fn) => fn(height));
}

export function currentBottomSheetHeight() {
  return height;
}

/** Plain (non-hook) subscribe, for anything that isn't a React component — and for unit tests to
 *  pin the publish/subscribe contract without a DOM. Returns an unsubscribe function. */
export function subscribeBottomSheetHeight(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** The live height of the open bottom sheet, or 0 when none is open. */
export function useBottomSheetHeight() {
  const [h, setH] = useState(height);
  useEffect(() => {
    const unsubscribe = subscribeBottomSheetHeight(setH);
    setH(height); // pick up any change that happened between render and effect
    return unsubscribe;
  }, []);
  return h;
}

// ── The side-docked place card (Food, phone held sideways — B2046224 ×4) ───────────────────────
// Same idea as the sheet height above, on the other axis: how wide the card down the RIGHT edge is,
// so the global help button (fixed bottom-right, mounted in the Shell with no path into Food) can
// step to the card's left edge instead of sitting on its "Log a visit" bar. 0 when no card is docked.
let sideWidth = 0;
const sideSubs = new Set();
export function publishSideDockWidth(px) {
  sideWidth = px > 0 ? px : 0;
  sideSubs.forEach((fn) => fn(sideWidth));
}
export function currentSideDockWidth() { return sideWidth; }
export function useSideDockWidth() {
  const [w, setW] = useState(sideWidth);
  useEffect(() => {
    sideSubs.add(setW);
    setW(sideWidth);
    return () => sideSubs.delete(setW);
  }, []);
  return w;
}
