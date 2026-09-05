/* dashboardLayout.js — pure mutators over a Dashboard card-board layout array
 * (`[{ id, width }]`, width one of "sm"/"md"/"lg" = 1/2/3 grid columns in the 3-column board).
 *
 * B1196305 (NEW-2) — Customize mode drives all four mutations here (reorder via drag OR the
 * keyboard Move-left/Move-right buttons, width step, remove, add). Keyboard reorder MUST share
 * the identical `moveCardToIndex` call drag uses — never a second reorder implementation, or the
 * two paths silently diverge (exactly the class of bug this repo's own rules warn about).
 *
 * ⛔ NO EMPTY LAYOUT MAY BE REACHABLE FROM ANY ENTRY POINT. `removeCard` refuses to drop the
 * last remaining card; the storage-side guarantee (an empty/malformed saved layout always
 * normalizes back to the full default board) lives in userPrefs.js, which owns the card catalog
 * these mutators operate over (`DASHBOARD_CARD_IDS`/`DEFAULT_DASHBOARD_LAYOUT`) — imported from
 * there rather than duplicated, so the two can never disagree on what a valid card id is.
 */
import { DASHBOARD_CARD_IDS, DEFAULT_DASHBOARD_LAYOUT } from "../../site-planner/lib/userPrefs.js";

export { DASHBOARD_CARD_IDS, DEFAULT_DASHBOARD_LAYOUT };

export const WIDTH_COLS = { sm: 1, md: 2, lg: 3 };
const WIDTH_ORDER = ["sm", "md", "lg"];

/* Pure: move the card with `id` to `newIndex` (clamped into range). Both drag-and-drop and the
 * keyboard Move-left/Move-right buttons call this SAME function — drag computes `newIndex` from
 * the drop target's own position, the buttons compute currentIndex ± 1. Identity-stable no-op
 * (returns the SAME array reference) when the id is absent or already at that index. */
export function moveCardToIndex(layout, id, newIndex) {
  const idx = layout.findIndex((c) => c.id === id);
  if (idx < 0) return layout;
  const clamped = Math.max(0, Math.min(layout.length - 1, newIndex));
  if (clamped === idx) return layout;
  const next = layout.slice();
  const [item] = next.splice(idx, 1);
  next.splice(clamped, 0, item);
  return next;
}

/** Move one step left (-1) or right (+1). A no-op at either edge (nothing to clamp into). */
export function moveCardBy(layout, id, direction) {
  const idx = layout.findIndex((c) => c.id === id);
  if (idx < 0) return layout;
  return moveCardToIndex(layout, id, idx + (direction < 0 ? -1 : 1));
}

/** Step a card's width through sm -> md -> lg -> sm. A no-op if the id is absent. */
export function cycleCardWidth(layout, id) {
  const idx = layout.findIndex((c) => c.id === id);
  if (idx < 0) return layout;
  const cur = layout[idx].width;
  const next = WIDTH_ORDER[(WIDTH_ORDER.indexOf(cur) + 1) % WIDTH_ORDER.length];
  const out = layout.slice();
  out[idx] = { ...out[idx], width: next };
  return out;
}

/** Set a card's width directly (used by a11y-labelled width controls, not just the cycle button). */
export function setCardWidth(layout, id, width) {
  if (!WIDTH_COLS[width]) return layout;
  const idx = layout.findIndex((c) => c.id === id);
  if (idx < 0 || layout[idx].width === width) return layout;
  const out = layout.slice();
  out[idx] = { ...out[idx], width };
  return out;
}

/* ⛔ THE LAST-CARD RULE — a first run with no cards is a worse landing than the map it replaced,
 * so removing the ONE remaining card is refused outright (a no-op, not an error — Customize mode
 * simply keeps that last card's remove control inert). */
export function removeCard(layout, id) {
  if (layout.length <= 1) return layout;
  if (!layout.some((c) => c.id === id)) return layout;
  return layout.filter((c) => c.id !== id);
}

/** Add a card back from the tray (any catalog id not already on the board), appended at the end,
 * default "md" width. A no-op for an unknown id or one already present. */
export function addCard(layout, id) {
  if (!DASHBOARD_CARD_IDS.includes(id) || layout.some((c) => c.id === id)) return layout;
  return [...layout, { id, width: "md" }];
}

/** Card ids in the catalog that are NOT currently on the board — the Add-card tray's contents. */
export function availableCardIds(layout) {
  const present = new Set(layout.map((c) => c.id));
  return DASHBOARD_CARD_IDS.filter((id) => !present.has(id));
}
