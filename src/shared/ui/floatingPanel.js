/**
 * Pure geometry + decisions for the poppable / floating Site Planner panels (NEW-1).
 * No DOM, no React — unit-tested in test/floatingPanel.test.js. The host (SitePlanner)
 * owns the React state and wiring; this module owns the math + the docked-only decision,
 * so both the live drag path and the tests exercise the same code.
 */

// Single source for the docked-only breakpoint: at or below this window width, floating is
// disabled and panels stay docked. Mirrors the app's existing 760px "narrow" phone breakpoint
// (SitePlanner.jsx) — build that media query from THIS constant so the two can't drift.
export const FLOAT_MIN_WIDTH = 760;

// Default card footprint (px) used to clamp a panel's FIRST open, before the real DOM size is
// known. The live card re-clamps against its measured size on every drag / resize.
export const FLOAT_SIZE = { w: 340, h: 420 };

/**
 * Clamp a card's top-left `pos` so the WHOLE card (`size` = {w,h}) stays inside `bounds`
 * (a viewport rect: {left, top, width, height}), inset by margin `M` on every side. If the
 * card is larger than the bounds on an axis, it is pinned to that axis's min edge (never a
 * negative or NaN offset). Mirrors AnchoredMenu's viewport clamp (AnchoredMenu.jsx:62-63).
 */
export function clampToBounds(pos, size, bounds, M = 8) {
  if (!bounds) return pos;
  const w = (size && size.w) || 0;
  const h = (size && size.h) || 0;
  const minX = bounds.left + M;
  const minY = bounds.top + M;
  const maxX = bounds.left + bounds.width - w - M;
  const maxY = bounds.top + bounds.height - h - M;
  return {
    x: Math.max(minX, Math.min(pos.x, Math.max(minX, maxX))),
    y: Math.max(minY, Math.min(pos.y, Math.max(minY, maxY))),
  };
}

/**
 * First-open position for a newly-detached panel: near the bounds' top-left, cascaded by
 * `index` (28px per step) so several cards opened in a row don't land exactly on top of each
 * other. Always clamped in-bounds. Falls back to a fixed spot when bounds are unknown.
 */
export function initialFloatPos(bounds, index = 0, size = FLOAT_SIZE, M = 16, step = 28) {
  if (!bounds) return { x: 24, y: 96 };
  const raw = { x: bounds.left + M + index * step, y: bounds.top + M + index * step };
  return clampToBounds(raw, size, bounds, M);
}

/**
 * When the window narrows past FLOAT_MIN_WIDTH we force docked-only mode: dock ONE panel and
 * close the rest (a phone can't host floating cards). Keep an already-docked panel if there is
 * one; otherwise adopt the first floating id as the docked panel. Returns the next
 * { leftPanel, floating } — floating is always emptied.
 */
export function reconcileForNarrow({ floatingIds, leftPanel }) {
  const ids = floatingIds || [];
  if (!ids.length) return { leftPanel, floating: {} };
  const nextDocked = leftPanel || ids[0];
  return { leftPanel: nextDocked, floating: {} };
}
