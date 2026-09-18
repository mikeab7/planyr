/* ⛔ IS THIS PRESS ON BLANK PAPER, OR ON SOMEBODY'S WRITING? (NEW-1, owner report 2026-09-18.)
 *
 * ⛔ THE REPORT, IN HIS WORDS: *"It's like anything to the right of a line picks up that there's a
 * line of text already. So even if — and I'm just going to use measurements so it makes sense —
 * let's say the line is five inches long. Even if I click a spot 10 inches out, as long as it's
 * horizontally aligned, it still goes to the original line. So it doesn't work at all."*
 *
 * ⛔ AND THE PREMISE THAT HID IT FOR FIVE ROUNDS, recorded here because the next reader will
 * otherwise inherit it. A project review stated as settled fact that *"double-clicking inside the
 * page body selects a word, which is correct text behaviour — so the create gesture only fires in
 * the grey mat outside the sheet."* Every prior round therefore fixed, reviewed or verified the
 * GREY-MAT path. He has been double-clicking INSIDE the white page the whole time, which is why
 * each round shipped something real and he kept saying it still did not work at all.
 *
 * ⛔ THE MECHANISM, and it is one missing axis. `NoteEditor.jsx`'s `pressIsBesideLine` asks
 * whether a press sits within one line-height of the nearest text position VERTICALLY, and never
 * looks at `clientX`. That is right for the case it was written for (B1368 — a press in the left
 * or right margin, level with a short line, belongs to that line) and it is wrong the moment the
 * press is a long way past where the writing actually ends: ProseMirror hands back the end of
 * that line because that is the nearest position it has, and the caret lands in his sentence.
 *
 * ⛔ WHAT THIS MODULE DOES *NOT* DO, deliberately: it does not make a SINGLE click behave
 * differently. A single click level with a line still puts the caret at that line's end, which is
 * what every editor does and what B1368 asked for. The distinction is the one Word already draws
 * with click-and-type: a single click is "put my caret somewhere sensible", a DOUBLE click on
 * blank paper is "start something here". Collapsing those two would reopen B1368.
 *
 * Pure on purpose — the DOM reading (which rectangles a line actually occupies) is the caller's,
 * so the decision itself can be unit-tested without a browser. See `test/notesBlankPaper.test.js`.
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

/**
 * ⛔ DID THIS PRESS LAND PAST THE END OF THE WRITING ON ITS OWN ROW?
 *
 * `rects` is what a DOM `Range` over the block's contents reports — ONE RECTANGLE PER RENDERED
 * LINE, which is the only reading that can answer this for a paragraph that wraps. The row is
 * picked by the press's own `y`, and then the question is purely horizontal: is `x` past that
 * row's right edge by more than a line's worth of slack?
 *
 * ⛔ THE SLACK IS THE LINE'S OWN HEIGHT, READ FROM THE BROWSER — not a number chosen to make a
 * case pass. It is the same quantity, from the same reasoning, that `pressIsBesideLine` already
 * uses for its vertical tolerance, so the two axes stay in step at any zoom and any type size
 * with nothing to keep manually aligned. It exists because clicking a hair past the last glyph of
 * a line is still that line to anybody typing — double-clicking there must go on selecting the
 * last word, exactly as it does today.
 *
 * ⛔ AND IT IS THE RIGHT-HAND SIDE ONLY. A press LEFT of where a line starts is the left-margin
 * case B1368 shipped for, it has its own harness (`verify-notes-left-margin-reachable.mjs`), and
 * he did not report it — "beyond the end of the rendered text on that row" is the right edge.
 * Widening this to the left margin is a separate product decision, not a tidier version of this
 * one.
 *
 * @param {Array<{top:number,bottom:number,left:number,right:number}>} rects one per rendered line
 * @param {number} clientX  the press
 * @param {number} clientY  the press
 * @returns {boolean} true when the press is on blank paper past that row's writing
 */
export function pressPastLineEnd(rects, clientX, clientY, { minSlack = 12 } = {}) {
  if (!Array.isArray(rects) || !rects.length) return false;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const row = rects.find((r) => r && clientY >= r.top && clientY < r.bottom);
  /* No row owns this height. That is NOT this function's case — a press below the last line is
   * already open page and is already handled by the callers above; saying "true" here would
   * claim a row that does not exist. */
  if (!row) return false;
  const slack = Math.max(minSlack, row.bottom - row.top);
  return clientX > row.right + slack;
}
