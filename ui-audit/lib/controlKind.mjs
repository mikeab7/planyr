/* controlKind.mjs — the pure decision behind ui-inventory.mjs's isolatedKindMismatches()
 * (NEW-2, B1176976).
 *
 * WHY THIS EXISTS. nestingMismatches() validates a rounded control's radius against its
 * CONTAINER; siblingMismatches() validates it against a rounded ROW PEER. Neither has anything to
 * say about a control with NEITHER — no rounded ancestor to walk up to, no flex-row sibling to
 * compare against. Measured live against the real app (BASE_URL=http://localhost:4173, the map
 * landing page surface, untouched pre-fix build): HelpReportControl.jsx's floating help/report
 * button reports in nestingMismatches()'s "no ancestor found" bucket and siblingMismatches()'s "no
 * row found" bucket, never in either check's `findings` array — so a `borderRadius: RADIUS.pill`
 * on that standalone button (999, a container-only token per docs/DESIGN.md's shape rule) is a
 * legal value on the RADIUS scale (invisible to design-drift-audit.mjs too) that is invisible to
 * BOTH geometric checks by construction, not by an oversight in either one's logic.
 * alignmentMismatches() does enter this control in its position:fixed/rounded candidate pool, but
 * that check only ever compares top-offset and height between peers in the same band — it never
 * reads radius at all, so it was never going to catch a wrong TOKEN either way, peer or no peer.
 *
 * A control this isolated still has a KIND, and docs/DESIGN.md's shape rule already names the
 * kinds: a CONTAINER that holds other controls (a segmented shell, a toggle bar whose height IS
 * its shape) is `pill`; a SURFACE that contains other things (a floating panel, a menu, a dialog)
 * is `lg`; every STANDALONE actionable control (a button, a text field, a chip sitting on the map
 * by itself) is `md`. This file is that rule made mechanical, from facts a DOM crawl can measure:
 * how many separately-interactive descendants a candidate has, whether they sit in one row or are
 * stacked, and the candidate's own rendered height.
 *
 * Kept a plain, DOM-free module — unlike `nestedIn()` (radius.js), which ui-inventory.mjs must
 * duplicate INLINE because it runs inside `page.evaluate`'s separate JS realm with no module
 * graph, this decision runs in the Node realm that already imports it: isolatedKindMismatches()
 * only needs the BROWSER to gather raw facts (see that function's own header for the DOM half);
 * the decision itself is plain arithmetic and belongs here, where it can be unit-tested directly
 * (test/controlKind.test.js) without launching Chromium.
 */
import { RADIUS } from "../../src/shared/ui/radius.js";

// A genuine "surface that contains other things" (docs/DESIGN.md's `lg` step) is taller than a
// single control row — CONTROL_H.lg (designTokens.js) is 30px. This is generous headroom above
// that, not a tight measurement: the exact height of some future panel is never the point, only
// distinguishing a segmented BAR (one row, control-ish height) from a PANEL (stacked rows, several
// times that).
export const SURFACE_HEIGHT_THRESHOLD_PX = 40;

// How far apart two descendants' vertical centers may sit and still count as "one row" rather
// than "stacked" — mirrors the sub-pixel/antialiasing tolerances the sibling checks already use
// elsewhere in this file family (SIBLING_VCENTER_TOL_PX in ui-inventory.mjs).
export const ROW_ALIGN_TOLERANCE_PX = 6;

/**
 * Classify an ISOLATED rounded, actionable control (no rounded ancestor, no rounded row-peer —
 * the caller has already established both) and say which RADIUS step it should be using.
 *
 * @param {object} facts
 * @param {number} facts.interactiveDescendantCount - separately-interactive descendants inside
 *   the candidate (buttons/inputs/etc a person can act on independently of the candidate itself).
 * @param {boolean} facts.descendantRowAligned - true when those descendants' vertical centers all
 *   sit within ROW_ALIGN_TOLERANCE_PX of each other (a single row), false when they're stacked.
 * @param {number} facts.height - the candidate's own rendered height in CSS px.
 * @param {number} facts.radius - the candidate's actual computed border-radius.
 * @returns {{ kind: string, expectedRadius: number, compliant: boolean }}
 */
export function classifyIsolatedControl({ interactiveDescendantCount, descendantRowAligned, height, radius }) {
  let kind, expectedRadius;
  if (interactiveDescendantCount >= 2) {
    if (descendantRowAligned && height <= SURFACE_HEIGHT_THRESHOLD_PX) {
      kind = "segmented-container"; // "a segmented shell... a toggle bar whose height IS its shape"
      expectedRadius = RADIUS.pill;
    } else {
      kind = "surface"; // "a floating panel, a menu, a dialog"
      expectedRadius = RADIUS.lg;
    }
  } else {
    kind = "standalone-control"; // "a button, a text field, a chip sitting on the map by itself"
    expectedRadius = RADIUS.md;
  }
  return { kind, expectedRadius, compliant: radius === expectedRadius };
}
