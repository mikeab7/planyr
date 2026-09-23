/* ⛔ IS THIS THE SECOND PRESS OF A GENUINE DOUBLE-CLICK ON BLANK PAPER? (NEW-1, 2026-09-18,
 * amended 2026-09-22.)
 *
 * ⛔ HISTORY, kept because the mechanism it produced is still load-bearing even though the
 * question this file answers has narrowed. B1393's five rounds were all spent on one axis of
 * one question — "is this press beside a line of FLOW TEXT" — because a project review had
 * wrongly recorded as settled fact that the create gesture only fires in the grey mat outside
 * the sheet. `pressIsBesideLine`/`pressPastLineEnd` (both formerly in `NoteEditor.jsx`) were the
 * fix for THAT question, and both are gone (NEW-1, 2026-09-22, owner direction: "I just want the
 * double-click thing"): there is no flow text left on the page to be beside, so there is nothing
 * left for either function to test against. Deleted rather than kept unused — see
 * `docs/NOTES-CARRY-FORWARD.md` §5 family 19 for the retired mechanism's own record.
 *
 * ⛔ WHAT SURVIVES, AND WHY IT STILL MATTERS: every press on blank paper is now the SAME
 * question regardless of what (if anything) used to be near it — is this the first click of a
 * pair, or the second? `isBlankDoublePress` RECONSTRUCTS that pair rather than trusting a native
 * `dblclick` alone, because this repo has twice shipped a gesture that depended entirely on
 * native double-click recognition and silently did nothing when the browser did not raise one
 * (carry-forward traps 31/32) — including in the very sandbox this file's own tests and every
 * placement harness run in. `NoteEditor.jsx`'s blank-space handler ORs the two: whichever
 * notices first wins.
 *
 * Pure on purpose, so the pairing decision can be unit-tested without a browser. See
 * `test/notesBlankPaper.test.js`.
 */

/** How long after one press a second one still counts as the same gesture. Mirrors
 *  `notesSketchEditor.js`'s own `SKETCH_DBLTAP_MS` rather than importing across module
 *  boundaries — same reasoning that file gives for not reaching into the site planner. */
export const BLANK_DBLTAP_MS = 450;
/** How far the pointer may wander between the two presses and still be one double-click. */
export const BLANK_DBLTAP_PX = 6;

/**
 * ⛔ THE PAIR IS RECONSTRUCTED, NEVER LEFT TO THE BROWSER ALONE (carry-forward traps 31 and 32).
 * A native `dblclick` — and the `detail >= 2` that rides the second `mousedown` — is the fast
 * path and is used when it is there. But this repo has now twice shipped a gesture that depended
 * entirely on native recognition and silently did nothing when it did not happen, and the same
 * sandbox that verifies this cannot raise one from two separate down/up pairs at ANY gap between
 * 150ms and 700ms. So the caller ORs the two: whichever notices first wins.
 *
 * @param {{t:number,x:number,y:number}|null} prev the previous press on blank paper, if any
 * @param {{t:number,x:number,y:number}} next this press
 */
export function isBlankDoublePress(prev, next, { ms = BLANK_DBLTAP_MS, px = BLANK_DBLTAP_PX } = {}) {
  if (!prev || !next) return false;
  if (!Number.isFinite(prev.t) || !Number.isFinite(next.t)) return false;
  const dt = next.t - prev.t;
  if (!(dt >= 0) || !(dt < ms)) return false;
  return Math.abs(next.x - prev.x) <= px && Math.abs(next.y - prev.y) <= px;
}
