/* NEW-1 — HOW WIDE THE ROW-1 CENTRE SLOT MAY BE, so that it can be centred on the HEADER
 * rather than on whatever space the side groups happen to leave.
 *
 * THE REPORT (owner, 2026-08-09, right after the label grammar changed): "now the jurisdiction is
 * not centered." Measured on Clay & Porter at a 1600 px viewport (true centre x = 800): the chip
 * spanned 776 → 1012, centre x = 894 — 94 px right of the window's centre. It was PERFECTLY centred
 * inside its slot; the SLOT was off-centre, because it was `flex: 1 1 0%` and so occupied the
 * LEFTOVER space between the breadcrumb and the account controls, and the breadcrumb group is the
 * wider of the two by about that same amount.
 *
 * ⛔ NOT A REGRESSION FROM THE LABEL CHANGE. A leftover-space centre slot has ALWAYS positioned the
 * chip relative to the two side groups, so the chip's position has always been a function of how
 * long the project and plan names are. Changing the label text only made a long-standing offset
 * newly visible. (Confirmed by measurement: the offset tracks the breadcrumb, not the label — a
 * second site with a shorter breadcrumb shows a different offset with the same jurisdiction string.)
 *
 * WHY THIS SHAPE AND NOT AN EQUAL FLEX-BASIS ON THE TWO SIDE GROUPS. Equal bases hand each side the
 * same share regardless of what it holds — which is precisely the rule NEW-2/B371361 removed, after
 * it starved the breadcrumb (navigation) while the pill sat comfortably under its cap and ran over
 * the plan chip's ▾ caret. So the centre is taken OUT OF FLOW instead (absolutely positioned at the
 * header's midpoint): the side groups keep their natural widths and NAVIGATION WINS is untouched,
 * while the chip's position stops depending on either of them.
 *
 * The cost of going out of flow is that nothing stops the centre overlapping its neighbours — which
 * would be the B371361 defect straight back. This function is the bound that prevents it: the slot
 * is symmetric about the midpoint, so the half it may occupy is limited by the WIDER of the two side
 * groups, plus a breathing gap. Inside that width the pill truncates / abbreviates / collapses on
 * its own, exactly as it does today.
 */

// Clear space kept between the centre slot and the nearer side group. Small — its whole job is to
// stop the two reading as one run of text when the row is tight.
export const CENTER_SLOT_GAP = 12;

/* The narrowest a TRULY CENTRED slot is worth having. Below this the chip would be a sliver — a pin
 * and half a word — and the honest degradation is to hand the centre back the leftover space (where
 * it is at least readable and can abbreviate) rather than to show a stub or nothing at all. The
 * shortened pill ("Unincorporated") is about this wide, which is where the number comes from. */
export const CENTER_SLOT_MIN = 120;

/* The widest the centre slot may be while staying centred on the row AND clear of both side groups.
 *
 * Returns a number of CSS px, or **null** when the inputs cannot be trusted (a zero-width row, a
 * non-finite measurement — i.e. before the first layout, or in an environment with no box model).
 * A null is not a zero: the caller must fall back to the in-flow layout rather than render a
 * zero-width slot, because silently collapsing the chip is the failure this rule exists to avoid
 * (LOUD-FAILURE — an unmeasurable row shows the old, visible layout, never nothing).
 */
export function centerSlotMaxWidth({ rowW, leftW, rightW, gap = CENTER_SLOT_GAP }) {
  if (![rowW, leftW, rightW, gap].every((n) => Number.isFinite(n))) return null;
  if (rowW <= 0) return null;
  // The binding constraint is the WIDER side: the slot is symmetric about the midpoint, so it
  // reaches the nearer group first and both edges must clear.
  const side = Math.max(leftW, rightW, 0);
  return Math.max(0, rowW - 2 * (side + gap));
}

/* WHICH LAYOUT THE CENTRE SLOT SHOULD RUN, from one measurement. Three outcomes, all deliberate:
 *
 *   `centered`    — a true centre fits: the slot is pinned at the midpoint, `max` px wide at most.
 *   `tight`       — a true centre would leave a sliver (a wide breadcrumb in a narrow window), so
 *                   the slot goes back IN FLOW and takes the space that remains. Off-centre, but
 *                   readable and still able to abbreviate — an honest degradation rather than a
 *                   vanished chip. This is the ONLY case where the old behaviour is still correct.
 *   `unmeasured`  — nothing could be measured. Also in flow (LOUD-FAILURE: the visible old layout,
 *                   never a silent collapse), but kept DISTINCT from `tight` so a permanently
 *                   un-measuring header cannot hide behind a legitimate-looking verdict.
 */
export function centerSlotPlan({ rowW, leftW, rightW, gap = CENTER_SLOT_GAP, min = CENTER_SLOT_MIN }) {
  const max = centerSlotMaxWidth({ rowW, leftW, rightW, gap });
  if (max == null) return { mode: "unmeasured", max: null };
  if (max < min) return { mode: "tight", max: null };
  return { mode: "centered", max };
}
