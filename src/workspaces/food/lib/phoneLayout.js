/* phoneLayout — Food on a phone held SIDEWAYS (B2046224 ×4). One place that decides what "a landscape
 * phone" is and where the place card and the visible map are, so the card, the map's centring, the
 * header and the help button never each keep their own idea of it.
 *
 * ⛔ WHY THE QUERY IS HEIGHT-BASED, NOT WIDTH-BASED. The module's other breakpoint is `max-width:
 * 760px` ("phone"), but a phone turned sideways is 568–734 wide (bottom sheet today) and the biggest
 * ones 814 wide (already the desktop rail). What they share is HEIGHT: under ~500 CSS px of room, a
 * bottom sheet that is a third of the screen leaves a sliver of map, so the card docks to the SIDE
 * instead. `pointer: coarse` keeps a short desktop window on the desktop layout (a mouse user who
 * shrinks a window is not on a phone). Upright phones and desktops never match.
 *
 * Pure helpers below take plain numbers so they are unit-tested without a DOM
 * (test/foodLandscapeLayout.test.js); the browser proof is ui-audit/verify-food-landscape.mjs. */
import { useEffect, useState } from "react";

export const LANDSCAPE_PHONE_QUERY = "(orientation: landscape) and (max-height: 500px) and (pointer: coarse)";

/** The side card's width: a third-ish of a small screen, the desktop rail's 340 at most. */
export const SIDE_CARD_MAX = 340;
export const SIDE_CARD_VW_SHARE = 0.44;
export const SIDE_CARD_CSS_WIDTH = `min(${SIDE_CARD_MAX}px, ${SIDE_CARD_VW_SHARE * 100}vw)`;

/** How far inside the visible map a selected pin must sit before the map leaves it alone. */
export const PIN_EDGE_MARGIN = 40;

export function isLandscapePhone(win = typeof window !== "undefined" ? window : null) {
  try { return !!win?.matchMedia?.(LANDSCAPE_PHONE_QUERY).matches; } catch (_) { return false; }
}

/** Reactive read of the query (same shape as AppHeader's `useNarrow`). */
export function useLandscapePhone() {
  const [on, setOn] = useState(() => isLandscapePhone());
  useEffect(() => {
    let mq; try { mq = window.matchMedia(LANDSCAPE_PHONE_QUERY); } catch (_) { return undefined; }
    const change = () => setOn(mq.matches);
    change();
    mq.addEventListener ? mq.addEventListener("change", change) : mq.addListener(change);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", change) : mq.removeListener(change); };
  }, []);
  return on;
}

/** The part of the map a person can actually see, in map-container pixels: the container minus the side
 *  card on the right (or a bottom sheet) and minus the notch inset on the left. */
export function visibleMapBox({ width, height, cardPx = 0, sheetPx = 0, insetLeft = 0, insetTop = 0 }) {
  const left = Math.max(0, insetLeft), top = Math.max(0, insetTop);
  const right = Math.max(left, width - Math.max(0, cardPx));
  const bottom = Math.max(top, height - Math.max(0, sheetPx));
  return { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

/** The pan that puts `point` at the centre of `box`, or null when it is already comfortably inside
 *  (so a user who panned a pin near the edge on purpose is never dragged back). */
export function centringPan({ point, box, margin = PIN_EDGE_MARGIN }) {
  if (!point || !box || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const inside = point.x >= box.left + margin && point.x <= box.right - margin
    && point.y >= box.top + margin && point.y <= box.bottom - margin;
  if (inside) return null;
  return { dx: point.x - box.cx, dy: point.y - box.cy };
}
