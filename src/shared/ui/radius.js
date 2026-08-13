/* B427411 — THE CORNER-RADIUS SCALE. One place, four values, and a rule for nesting.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
 * Owner: "the background color and the chip itself have different edge shapes for the Find a
 * site one, and the other things should all match. And even the Michael Butler at the top, that
 * chip has different radii for its corners. Everything should be matching."
 *
 * He is describing the absence of a scale, not a handful of wrong numbers. Before this file,
 * `MapFinder.jsx` alone used EIGHT different radii — 8 (×9), 6 (×7), 99 (×7), 5 (×2), 10 (×2),
 * 7, 4, 12 — and `AppHeader.jsx` added its own set (the account chip 10, a sibling control 7,
 * others 8 and 6). Every one was picked at its own call site, months apart, by eye. Nothing was
 * wrong individually; the disagreement is what he can see.
 *
 * ⛔ So this is fixed as a SYSTEM. Do not add a fifth step because a particular component "wants"
 * one — that is exactly how the eight got there. If something genuinely does not fit, the honest
 * move is to argue the scale should change, here, for everything.
 *
 * ─── THE SCALE ───────────────────────────────────────────────────────────────────────────────
 *   pill  fully rounded — status dots, toggle chips, and any bar whose height IS its shape
 *   sm    a control nested INSIDE another rounded surface (an input in a panel, a button in a
 *         banner). Smaller than its parent on purpose — see the nesting rule below.
 *   md    a standalone control — a button, a text field, a chip that sits on the map by itself
 *   lg    a surface that CONTAINS other things — floating panel, menu, dialog
 *
 * ─── THE NESTING RULE, which is the half that was actually broken ────────────────────────────
 * A rounded thing inside another rounded thing looks wrong unless their curves are CONCENTRIC:
 * the inner radius should be the outer radius minus the gap between them. Two shapes that merely
 * both "look rounded" read as a mistake, which is what the owner is pointing at — the search bar
 * is a 42px-tall PILL and its buttons were `borderRadius: 6`, so a boxy chip sat inside a fully
 * round container with 6px of space around it.
 *
 * `nestedIn(outer, gap)` computes it. The special case matters most: inside a PILL, a control
 * that runs the height of the bar is itself a pill — there is no radius that looks deliberate
 * against a fully-round edge except another fully-round edge.
 *
 * Values are NUMBERS (px), because every consumer here styles inline in JS. The CSS mirror is
 * `--radius-*` in `src/index.css`; keep the two in step, the way `palette.js` and its tokens are.
 */

export const RADIUS = {
  pill: 999,
  sm: 6,
  md: 8,
  lg: 12,
};

/* ⚠ THESE NUMBERS ARE NOT INVENTED — they are the tree's own dominant values, promoted.
 * `8` was already the single most common radius in `MapFinder.jsx` (9 of its 23 sites) and
 * `shared/ui/controls.jsx` already declared `{ control: 8, pill: 999, panel: 12 }` — a partial
 * scale that covered three cases and was never adopted beyond that file and the Notes workspace.
 * Picking a rounder-looking 10/14 would have been a fourth opinion; adopting what most of the
 * chrome already agreed on makes this a consolidation rather than a restyle, and keeps the
 * existing `controls.jsx` ↔ Notes contract (guarded by test/notesModule.test.js) intact. */

/* The concentric-corner rule, as a function so a call site states its intent rather than a
 * number. `outer` is the container's radius, `gap` the padding between the two edges.
 *
 *   nestedIn(RADIUS.pill, …) → RADIUS.pill   a pill's children are pills
 *   nestedIn(RADIUS.lg, 6)   → RADIUS.sm     a control inset by 6 inside an `lg` surface
 *
 * Floored at 2: below that a "rounded" corner is indistinguishable from a square one, and
 * pretending otherwise just puts another arbitrary number in the tree. */
export function nestedIn(outer, gap = 0) {
  if (outer >= RADIUS.pill) return RADIUS.pill;
  return Math.max(2, Math.round(outer - gap));
}
