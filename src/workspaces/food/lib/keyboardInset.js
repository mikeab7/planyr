/* keyboardInset — how much of the bottom of the LAYOUT viewport the on-screen keyboard covers.
 *
 * iOS Safari does not resize the layout viewport when the keyboard opens: position:fixed elements
 * stay attached to it, so a `position: fixed; bottom: 0` sheet sits UNDER the keyboard, hiding the
 * field being typed into and the Save button. Only `window.visualViewport` shrinks (and may pan,
 * `offsetTop` > 0). The covered height is the gap between the layout viewport's bottom and the
 * visual viewport's bottom. Below `MIN_KEYBOARD_PX` it is browser chrome (the collapsing toolbar,
 * pinch-zoom), not a keyboard, and is ignored so the sheet doesn't twitch.
 *
 * ⛔ NEVER READ THE LAYOUT HEIGHT FROM `window.innerHeight` (B2046224 recurrence ×2, 2026-10-04).
 * The first version did, and it read ≈ 0 on a real iPhone: WebKit's `innerHeight` is the
 * UNOBSCURED content rect (`LocalDOMWindow::innerHeight()` →
 * `unobscuredContentRectIncludingScrollbars()`), the same visible rect visualViewport is built
 * from, so on iOS it shrinks WITH the keyboard and `innerHeight − vv.height` cancels to nothing.
 * The fixed-position containing block is what the sheet is laid out against, so that is what is
 * measured: a zero-size-cost `position:fixed; top:0; bottom:0` probe's own height. Desktop and
 * Android, where innerHeight is the layout height, measure the same number either way. */
export const MIN_KEYBOARD_PX = 80;

export function keyboardInset({ layoutHeight, vvHeight, vvOffsetTop = 0 }) {
  if (![layoutHeight, vvHeight, vvOffsetTop].every(Number.isFinite)) return 0;
  const covered = layoutHeight - vvHeight - vvOffsetTop;
  return covered > MIN_KEYBOARD_PX ? Math.round(covered) : 0;
}

let probe = null;
/** Height of the layout viewport — the box `position: fixed` resolves against. */
export function layoutViewportHeight(win = typeof window !== "undefined" ? window : null) {
  const doc = win?.document;
  if (!doc?.body) return win?.innerHeight ?? 0;
  if (!probe || !probe.isConnected || probe.ownerDocument !== doc) {
    probe = doc.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.dataset.layoutViewportProbe = "";
    probe.style.cssText = "position:fixed;top:0;bottom:0;left:0;width:0;visibility:hidden;pointer-events:none;";
    doc.body.appendChild(probe);
  }
  const h = probe.offsetHeight;
  // Never smaller than innerHeight: where innerHeight IS the layout height (desktop, Android) the two
  // agree; where it is the visible height (iOS) the probe is the larger, correct one.
  return Math.max(h || 0, win.innerHeight || 0);
}

/** Read the live numbers off `window.visualViewport` (absent -> 0, i.e. no keyboard handling). */
export function currentKeyboardInset(win = typeof window !== "undefined" ? window : null) {
  const vv = win?.visualViewport;
  if (!vv) return 0;
  return keyboardInset({ layoutHeight: layoutViewportHeight(win), vvHeight: vv.height, vvOffsetTop: vv.offsetTop });
}
