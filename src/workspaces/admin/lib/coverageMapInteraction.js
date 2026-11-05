/* Admin parcel-coverage map — the pure interaction rules (NEW-1/NEW-2). No DOM, no React.
 *
 * WHEEL: a plain wheel / two-finger trackpad scroll over the map is the PAGE's, never the map's — the map had been
 * swallowing every wheel event, so once it filled the screen the page could not be scrolled back up. The map zooms
 * only with Ctrl/Cmd + wheel (a trackpad pinch arrives as a ctrl-wheel too), the +/− buttons, or a touch pinch.
 * TAP: a press that travels no further than TAP_SLOP is a click on the county under it; a real drag pans and must
 * never open the card. */

export const TAP_SLOP = 4; // summed |dx|+|dy| in screen px; the same budget the pan handler already used

/** "zoom" when the wheel event carries a zoom modifier (or is a trackpad pinch), otherwise "scroll". */
export const wheelIntent = (e) => (e && (e.ctrlKey || e.metaKey) ? "zoom" : "scroll");

/** Zoom factor for one ctrl/cmd-wheel (or pinch) event. A mouse notch is ~100 and a pinch tick a handful, so the
 * step is clamped: a notch is ~1.8x, a pinch tick ~1.05x. */
export function wheelZoomFactor(e) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; // lines / pages -> px
  const d = Math.max(-50, Math.min(50, e.deltaY * unit));
  return Math.exp(-d * 0.012);
}

/** Was this press a click (not a drag)? */
export const isTap = (moved) => moved <= TAP_SLOP;

/** The modifier word for the "zoom with the wheel" hint. */
export const zoomKeyWord = (platform) => (/mac|iphone|ipad/i.test(String(platform || "")) ? "Cmd" : "Ctrl");

/** Place a floating box (width w, height h) near an anchor point inside a container (cw x ch), preferring the
 * lower-right of the anchor, flipping to the other side when it would run off, and always staying inside. */
export function placeNear(anchor, size, container, gap = 14, pad = 8) {
  const fitX = anchor.x + gap + size.w <= container.w - pad;
  const fitY = anchor.y + gap + size.h <= container.h - pad;
  const x = fitX ? anchor.x + gap : anchor.x - gap - size.w;
  const y = fitY ? anchor.y + gap : anchor.y - gap - size.h;
  return {
    x: Math.max(pad, Math.min(container.w - size.w - pad, x)),
    y: Math.max(pad, Math.min(container.h - size.h - pad, y)),
  };
}

/** The tallest the map may be so the whole of it fits under what sits above it: the scroller's visible height
 * minus the map's natural offset inside the scroller's content, with a floor so a very short window scrolls the
 * page instead of crushing the map. */
export function mapHeightCap({ visibleHeight, offsetTop, bottomPad = 16, floor = 300 }) {
  return Math.max(floor, Math.floor(visibleHeight - offsetTop - bottomPad));
}
