/* toolbarPlan — the PURE half of the shared priority toolbar (NEW-2, 2026-10-05).
 *
 * THE RULE the owner asked for: a toolbar never wraps to a second row, never clips, never needs
 * sideways scrolling on a desktop. As its OWN box narrows it degrades in a fixed order:
 *   1. text labels drop to icon-only (the label survives as tooltip + aria-label);
 *   2. then the lowest-priority items move into one "More" menu at the end of the row, in their
 *      original order, with full labels.
 *
 * THE LADDER. The degradation is a single total order of small steps — "icon-ify the lowest-priority
 * labelled item", "icon-ify the next", …, "move the lowest-priority item to the menu", "move the next",
 * … — and a plan is just HOW MANY STEPS HAVE BEEN APPLIED (`step`). One integer. That is what makes the
 * hysteresis honest: an item cannot flicker in and out at a boundary width because the only thing that
 * can change is one number, and it only moves back down once the room clears the cost by a margin.
 *
 * No DOM here: widths in, plan out. `test/toolbarPlan.test.js` pins every rule below.
 */

export const TOOLBAR_GAP = 4;        // px between visible items (matches the header's own cluster gap)
export const MORE_WIDTH = 30;        // the "…" button (icon-only, one control-height square)
export const HYSTERESIS_PX = 10;     // spare room required before a collapsed item comes back

/** An item, as the planner sees it.
 *   id          stable string
 *   priority    number — HIGHER = kept longest (lowest collapses first). Ties break by later position first.
 *   widthFull   measured px with its text label
 *   widthIcon   measured px icon-only (omit / equal to widthFull when it has no label to drop)
 *   collapsible may it go icon-only / into the menu at all? default true
 *   ghost       reserves its width while shown but is invisible & absent from the menu (a state-dependent
 *               control kept mounted so its siblings never shift) — it is the first thing to give up room
 */

/** Pure: the ordered list of degradation actions for a set of items. */
export function buildLadder(items) {
  const order = items.map((it, i) => ({ it, i }))
    .filter(({ it }) => it.collapsible !== false)
    // lowest priority first; among equals the LATER item goes first (the row reads left-to-right,
    // and the trailing end is where the More button will appear)
    .sort((a, b) => (a.it.priority - b.it.priority) || (b.i - a.i));
  const ladder = [];
  // ghosts give up their reserved room before anything visible does
  for (const { it } of order) if (it.ghost) ladder.push({ id: it.id, to: "menu" });
  for (const { it } of order) if (!it.ghost && hasLabel(it)) ladder.push({ id: it.id, to: "icon" });
  for (const { it } of order) if (!it.ghost) ladder.push({ id: it.id, to: "menu" });
  return ladder;
}
const hasLabel = (it) => Number.isFinite(it.widthIcon) && it.widthIcon < it.widthFull - 0.5;

/** Pure: what each item looks like after `step` ladder actions. */
export function stateAt(items, ladder, step) {
  const mode = new Map(items.map((it) => [it.id, "full"]));
  for (let k = 0; k < Math.min(step, ladder.length); k++) mode.set(ladder[k].id, ladder[k].to);
  return mode;
}

/** Pure: total width of the bar (items + gaps + the More button when something is in the menu). */
export function widthAt(items, mode, { gap = TOOLBAR_GAP, moreWidth = MORE_WIDTH } = {}) {
  let n = 0, w = 0, menu = 0;
  for (const it of items) {
    const m = mode.get(it.id);
    if (m === "menu") { if (!it.ghost) menu++; continue; }
    w += m === "icon" ? (it.widthIcon ?? it.widthFull) : it.widthFull;
    n++;
  }
  if (menu > 0) { w += moreWidth; n++; }
  return w + Math.max(0, n - 1) * gap;
}

/** Pure: the smallest step whose width fits `available` (the last step when nothing does). */
export function stepFor(items, ladder, available, opts) {
  for (let k = 0; k <= ladder.length; k++) {
    if (widthAt(items, stateAt(items, ladder, k), opts) <= available) return k;
  }
  return ladder.length;
}

/** Pure: the next step, with hysteresis. Collapse the instant it is needed; expand only when it fits
 *  with `hysteresis` px to spare. */
export function nextStep(prevStep, items, ladder, available, opts = {}) {
  const hyst = opts.hysteresis ?? HYSTERESIS_PX;
  const need = stepFor(items, ladder, available, opts);
  if (need > prevStep) return need;
  if (need === prevStep) return prevStep;
  const roomy = stepFor(items, ladder, available - hyst, opts);
  return Math.min(prevStep, roomy);
}

/** Pure: everything the component renders, from widths + a budget + the previous step. */
export function planToolbar({ items, available, prevStep = 0, opts }) {
  const ladder = buildLadder(items);
  const step = Number.isFinite(available) ? nextStep(Math.min(prevStep, ladder.length), items, ladder, available, opts) : 0;
  const mode = stateAt(items, ladder, step);
  const menuIds = items.filter((it) => mode.get(it.id) === "menu" && !it.ghost).map((it) => it.id);
  return {
    step, ladderLength: ladder.length, mode,
    iconIds: items.filter((it) => mode.get(it.id) === "icon").map((it) => it.id),
    menuIds,                                    // original order — the menu lists them as the bar did
    barIds: items.filter((it) => mode.get(it.id) !== "menu").map((it) => it.id),
    width: widthAt(items, mode, opts),
    overflowing: widthAt(items, mode, opts) > available + 0.5, // true only when even the floor does not fit
  };
}

/* ---- module-tab strip: the same ladder with one extra rule ----------------------------------- */

/** Priorities for a module tab strip: the ACTIVE tab is never collapsible (you must always see where you
 *  are); the rest keep their left-to-right order (rightmost goes first). */
export function tabItems(tabs, activeId) {
  return tabs.map((t, i) => ({
    id: t.id, widthFull: t.widthFull, widthIcon: t.widthIcon,
    priority: t.id === activeId ? 1000 : 100 - i,
    collapsible: t.id !== activeId,
  }));
}
