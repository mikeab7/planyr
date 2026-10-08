/* propertiesSheet.js — pure geometry + decisions for the phone Properties bottom sheet
 * (B1215682/NEW-1, "Properties panel becomes a bottom sheet on phone-sized screens"). No DOM,
 * no React — unit-tested in test/propertiesSheet.test.js. The host (SitePlanner.jsx) owns the
 * React state, the drag wiring, and the map-pan side effect; this module owns the math so both
 * the live drag path and the tests exercise the same code (the `floatingPanel.js` split this
 * mirrors).
 *
 * SCOPE: this is the phone Properties panel ONLY. It does not touch, and is not read by, any
 * other panel (Land/Analysis/Yield/Standards/References) or the desktop-docked inspector — see
 * the owner brief's "ONE SURFACE, do not generalise" instruction. If this pattern is repeated for
 * another surface later, that is a new, deliberate item, not an extension of this file.
 */
import { layoutViewportHeight } from "../../../shared/ui/layoutViewport.js";

// Bottom-sheet mode needs BOTH a narrow width (the existing 760px phone/tablet breakpoint) AND a
// coarse (touch) pointer — width alone is not enough. An iPad in landscape is as wide as a laptop
// and still finger-operated the other way: a narrow DESKTOP browser window with a mouse must not
// turn the Properties panel into a bottom sheet just because it's narrow. Width drives layout;
// pointer type drives control sizing/presentation (the owner brief's own ruled-out approach #4).
export function isPhoneSheetMode({ narrow, coarsePointer }) {
  return !!narrow && !!coarsePointer;
}

// Two detents, as a fraction of the viewport height. `half` is the default open height (the sheet
// must not cover the whole screen by default — seeing the map while editing is the point); `tall`
// is the taller detent a drag can reach, capped well short of 100% so the map is never fully hidden
// even at the tall detent.
export const SHEET_SNAPS = { half: 0.5, tall: 0.85 };

export function heightForSnap(snap, viewportH) {
  const frac = SHEET_SNAPS[snap] ?? SHEET_SNAPS.half;
  return Math.max(0, Math.round(frac * (viewportH || 0)));
}

// Given the live drag height and the two snap heights, which snap does the drag resolve to on
// release? Below `dismissBelowPx` it dismisses (drag down to close, per the brief).
export function resolveDragSnap({ heightPx, halfPx, tallPx, dismissBelowPx }) {
  if (heightPx < dismissBelowPx) return "dismiss";
  const mid = (halfPx + tallPx) / 2;
  return heightPx >= mid ? "tall" : "half";
}

// The space the on-screen keyboard covers, in CSS px, read from `visualViewport`. iOS Safari
// shrinks `visualViewport.height` (never `window.innerHeight`) when the keyboard raises, so a
// sheet anchored to `window.innerHeight` alone would sit UNDER the keyboard — the "keyboard buries
// the field" failure the brief names as the second thing that kills this pattern. `win` is
// injected (not read from a module-scope `window`) so this stays unit-testable with no DOM.
// ⛔ B2088384 — the layout height is MEASURED (shared/ui/layoutViewport.js), never innerHeight: on iOS
// innerHeight moves with the keyboard (both ways — see that file's header), which read here as "no
// keyboard" (the sheet stayed under it) or "a bigger keyboard" (a gap of map above it). Same defect,
// same fix as the Food sheet (B2046224 ×2/×3).
export function keyboardInsetPx(win) {
  const vv = win && win.visualViewport;
  if (!vv) return 0;
  const innerH = layoutViewportHeight(win) || 0;
  const inset = innerH - (vv.height + vv.offsetTop);
  return inset > 1 ? Math.round(inset) : 0;
}

// The keyboard's own HEIGHT — layout minus the visible height, WITHOUT the visual viewport's scroll. `keyboardInsetPx` above
// subtracts offsetTop too (the sheet's bottom must sit on the visible band's bottom, wherever iOS has scrolled it); for SIZING that
// is wrong: `layout − inset` = visible height + scroll, so on a scrolled viewport the sheet could stand taller than the band and its
// top rows end up above the top of the screen (NEW-1, 2026-10-06, measured on WebKit). The height is also stable while iOS scrolls.
export function keyboardHeightPx(win) {
  const vv = win && win.visualViewport;
  if (!vv) return 0;
  const h = (layoutViewportHeight(win) || 0) - vv.height;
  return h > 1 ? Math.round(h) : 0;
}

// The tallest the sheet may stand while a keyboard is up: the visible height minus the top margin — a CEILING (CSS max-height,
// which has no transition, so it bites at once instead of mid-way through the sheet's own 220 ms height animation, which
// the page's field-reveal would measure half-done). null = no keyboard, the caller keeps its normal max-height.
export function sheetMaxHeightForKeyboard(viewportH, kbHeight, topMargin = 24, minH = 120) {
  if (!(kbHeight > 0)) return null;
  return Math.max(minH, (viewportH || 0) - kbHeight - topMargin);
}

// The sheet's rendered height must never push its TOP edge above the visible viewport once the
// keyboard has taken `kbInset` px off the bottom — otherwise "rise above the keyboard" becomes
// "run off the top of the screen". Clamps to at least `minH` so the sheet never collapses to
// nothing on a very short visual viewport.
export function clampSheetHeightForKeyboard(heightPx, viewportH, kbInset, topMargin = 24, minH = 120) {
  const available = Math.max(minH, (viewportH || 0) - (kbInset || 0) - topMargin);
  return Math.max(minH, Math.min(heightPx || 0, available));
}

// How far (px) the drawing needs to move UP so a selection currently covered by the sheet clears
// its top edge, with `margin` px of daylight — the brief's hard acceptance criterion: "when the
// sheet opens over the selected object, the map must shift so the selection stays visible."
// Returns 0 when nothing is covered (already visible, or unknown geometry). Never asked to push
// the selection above the true viewport top — `room` bounds the shift to what the selection's own
// top edge can give up.
export function selectionCoverDeltaPx({ selTop, selBottom, sheetTopY, margin = 16, viewportTop = 0 }) {
  if (selBottom == null || sheetTopY == null) return 0;
  const overlap = selBottom + margin - sheetTopY;
  if (overlap <= 0) return 0;
  const room = selTop != null ? Math.max(0, selTop - viewportTop - margin) : overlap;
  return Math.min(overlap, room);
}
