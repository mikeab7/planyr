/* notesIndentLevel — WHAT A LIST ITEM'S OWN LEVEL IS, decided once (NEW-TAB).
 *
 * PURE, and deliberately dependency-free, because four surfaces have to agree about the same
 * number and must not drift: the editor's Tab key, the markup the screen renders, the print
 * sheet, and the Markdown export. A level that indents one way on screen and another way on
 * paper is a PDF-PARITY failure of the plainest kind.
 *
 * ⛔ IT LIVES OUTSIDE lib/notesListIndent.js ON PURPOSE, following lib/notesFileMeta.js's
 * precedent exactly. That file is a Tiptap `Extension` and so imports the editor engine;
 * lib/notesMarkdown.js is on the Notes route's STATIC path and may not. One tiny shared
 * module is what lets the exporter read a level without dragging the engine onto the rail's
 * first paint.
 *
 * The RULE this serves, and the reasoning behind it, is in lib/notesListIndent.js:
 * **Tab changes the level of the current item; it never creates a node the user did not type.**
 */

/** The node types a level can sit on. Both are list items; nothing else takes an indent. */
export const INDENTABLE = ["listItem", "taskItem"];

/** One level, in `em`, matching the `padding-left` the lists already use so a level made by
 *  this attribute and a level made by real nesting line up on screen and on paper. */
export const INDENT_STEP_EM = 1.5;

/** ⛔ A CEILING, because an unbounded level walks the text off the right edge of the page and
 *  off the print sheet, where there is no scrollbar to get it back. Ten is past any real
 *  outline and short of the damage. Shift+Tab always works, so a run into the cap is never a
 *  trap. */
export const MAX_INDENT = 10;

/** The level as a number, from anything. Absent, junk and negatives all read as 0 — the
 *  attribute's whole contract is that 0 is indistinguishable from never having been set. */
export function readIndent(attrs) {
  const n = Math.trunc(Number(attrs?.indent));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_INDENT) : 0;
}

/** ⛔ RENDERS NOTHING AT ZERO, and that is the clause the round-trip rests on. An attribute
 *  that wrote `data-indent="0"` or `margin-left: 0em` would make an outdented item different
 *  from an item that was never indented — in the stored document, in the HTML export and on
 *  the print sheet — and the owner's test is that an indent/outdent pair leaves the document
 *  byte-identical.
 *
 *  ⛔ `margin-left` ON THE ITEM, not padding on the list. Margin moves the BULLET with the
 *  text (an outside marker is laid out against the item's margin box), which is the whole
 *  point — padding would slide the words out from under their own marker. */
export function indentAttrs(attrs) {
  const n = readIndent(attrs);
  if (!n) return {};
  return { "data-indent": String(n), style: `margin-left: ${(n * INDENT_STEP_EM).toFixed(2)}em` };
}

/** Recover the level from rendered HTML — a reload, a paste, an import. */
export const parseIndent = (el) => readIndent({ indent: el?.getAttribute?.("data-indent") });
