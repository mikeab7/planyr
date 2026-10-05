/* keyboardInset — is the on-screen keyboard up, and how much of the LAYOUT viewport does it cover?
 *
 * iOS Safari does not resize the layout viewport when the keyboard opens: position:fixed elements
 * stay attached to it, so a `position: fixed; bottom: 0` sheet sits UNDER the keyboard. Only
 * `window.visualViewport` shrinks (and may pan, `offsetTop` > 0). Below `MIN_KEYBOARD_PX` the
 * difference is browser chrome (the collapsing toolbar, pinch-zoom), not a keyboard.
 *
 * ⛔ THIS IS NOW A DETECTOR ONLY (B2046224 ×3, 2026-10-04). It used to also PLACE the sheet
 * (`bottom: inset`), which made the sheet's position depend on the layout height being right — and
 * the owner's iPhone showed a band of map between the sheet and the keyboard. BottomSheet now pins
 * itself to the visual viewport's own box (`offsetTop` + `height`), so no estimate of the layout
 * height can open a gap. Layout height: src/shared/ui/layoutViewport.js (never innerHeight alone —
 * see its header for the telemetry that shows innerHeight moving BOTH ways on iOS). */
import { layoutViewportHeight } from "../../../shared/ui/layoutViewport.js";

export { layoutViewportHeight };
export const MIN_KEYBOARD_PX = 80;

export function keyboardInset({ layoutHeight, vvHeight, vvOffsetTop = 0 }) {
  if (![layoutHeight, vvHeight, vvOffsetTop].every(Number.isFinite)) return 0;
  const covered = layoutHeight - vvHeight - vvOffsetTop;
  return covered > MIN_KEYBOARD_PX ? Math.round(covered) : 0;
}

/** Read the live numbers off `window.visualViewport` (absent -> 0, i.e. no keyboard handling). */
export function currentKeyboardInset(win = typeof window !== "undefined" ? window : null) {
  const vv = win?.visualViewport;
  if (!vv) return 0;
  return keyboardInset({ layoutHeight: layoutViewportHeight(win), vvHeight: vv.height, vvOffsetTop: vv.offsetTop });
}

/** The visual viewport's own box in layout coordinates — where the sheet pins itself while typing. */
export function visualViewportBox(win = typeof window !== "undefined" ? window : null) {
  const vv = win?.visualViewport;
  if (!vv || !Number.isFinite(vv.height) || !Number.isFinite(vv.offsetTop)) return null;
  return { top: Math.round(vv.offsetTop), height: Math.round(vv.height) };
}
