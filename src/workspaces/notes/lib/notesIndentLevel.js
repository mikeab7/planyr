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
 *  that wrote `data-indent="0"` would make an outdented item different from an item that was
 *  never indented — in the stored document, in the HTML export and on the print sheet — and
 *  the owner's test is that an indent/outdent pair leaves the document byte-identical.
 *
 *  ⛔ NEVER AN INLINE `style` (B842949, reversing the original `margin-left: …em` inline write).
 *  `margin-left` on a list item is a normal CSS box property, and a real nested `<li>` (the kind
 *  `sinkListItem` builds) already carries ITS OWN `margin-left` for every real ancestor above it
 *  by inheriting that ancestor's shifted box — the browser does this whether the value came from
 *  an inline `style` or a stylesheet rule. An inline value read back and RE-WRITTEN whenever an
 *  item's own level changes is how a value meant for ONE item's own step silently doubled against
 *  a real ancestor's step (measured: a 22.5px step became 45px the moment a real-nested item's own
 *  `indent` attribute went from 0 to 1). Routing the same fixed step through `data-indent="<n>"`
 *  plus ONE stylesheet rule per level (`lib/notesListIndent.js`'s selector consumers) makes the
 *  step a constant looked up by level, never a number computed and stamped onto the element by
 *  hand — the actual double-counting is fixed at the SOURCE, in which items receive a level at
 *  all (see `itemsInSelection`'s header), but this half removes the mechanism that could let it
 *  happen again through some future direct write. */
export function indentAttrs(attrs) {
  const n = readIndent(attrs);
  if (!n) return {};
  return { "data-indent": String(n) };
}

/** Recover the level from rendered HTML — a reload, a paste, an import. */
export const parseIndent = (el) => readIndent({ indent: el?.getAttribute?.("data-indent") });

/** ⛔ THE ONE STYLESHEET TABLE FOR EVERY LEVEL, so the editor and the print sheet cannot drift
 *  (PDF-PARITY) — each calls this with its own selector prefix rather than each writing the same
 *  ten rules by hand. A plain CSS attribute selector, never an inline style: the step for level
 *  `n` is always `n * INDENT_STEP_EM`, looked up, never accumulated. */
export function indentCssRules(itemSelector) {
  const rows = [];
  for (let n = 1; n <= MAX_INDENT; n += 1) {
    rows.push(`${itemSelector}[data-indent="${n}"] { margin-left: ${(n * INDENT_STEP_EM).toFixed(2)}em; }`);
  }
  return rows.join("\n");
}
