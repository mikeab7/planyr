/* keyboardInset — how much of the bottom of the LAYOUT viewport the on-screen keyboard covers.
 *
 * iOS Safari does not resize the layout viewport when the keyboard opens: `window.innerHeight`
 * stays put and only `window.visualViewport` shrinks (and may scroll, `offsetTop` > 0). A
 * `position: fixed; bottom: 0` sheet therefore sits UNDER the keyboard, hiding the field being
 * typed into and the Save button. The covered height is the gap between the layout viewport's
 * bottom and the visual viewport's bottom. Below `MIN_KEYBOARD_PX` it is browser chrome (the
 * collapsing toolbar, pinch-zoom), not a keyboard, and is ignored so the sheet doesn't twitch. */
export const MIN_KEYBOARD_PX = 80;

export function keyboardInset({ innerHeight, vvHeight, vvOffsetTop = 0 }) {
  if (![innerHeight, vvHeight, vvOffsetTop].every(Number.isFinite)) return 0;
  const covered = innerHeight - vvHeight - vvOffsetTop;
  return covered > MIN_KEYBOARD_PX ? Math.round(covered) : 0;
}

/** Read the live numbers off `window.visualViewport` (absent -> 0, i.e. no keyboard handling). */
export function currentKeyboardInset(win = typeof window !== "undefined" ? window : null) {
  const vv = win?.visualViewport;
  if (!vv) return 0;
  return keyboardInset({ innerHeight: win.innerHeight, vvHeight: vv.height, vvOffsetTop: vv.offsetTop });
}
