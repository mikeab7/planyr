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

/* ─── NESTED LIST MARKERS STEP THROUGH THE OUTLINE CONVENTION (NEW-2) ─────────────────────
 *
 * Reported from the owner's own screenshot: a first-level "1. Utility Facilities" with a
 * second-level item that ALSO rendered "1.", the two distinguishable only by indentation.
 * That is plain browser default behaviour — every `<ol>`, nested or not, starts its own
 * counter at 1 with `list-style-type: decimal` unless told otherwise — so it was never a bug
 * to fix in the schema or the editor, only a missing stylesheet rule.
 *
 * ⛔ THE CONVENTION, STATED (so it is a decision, not an accident): decimal → lower-alpha →
 * lower-roman for numbered lists, cycling every third level; disc → circle → square for
 * bulleted lists, the same cycle length Word/Google Docs both use. A CHECKLIST is deliberately
 * NOT part of this: `ul[data-type="taskList"]` already renders `list-style: none` (the
 * checkbox IS the marker), so there is no glyph left to step — nesting there is communicated
 * by indentation alone, unchanged.
 *
 * ⛔ TWO INDEPENDENT MECHANISMS DECIDE HOW DEEP AN ITEM IS (see `lib/notesListIndent.js`'s own
 * header): REAL structural nesting (`sinkListItem`, a genuine `<li><ol>…` inside the item
 * above it) and the FLAT `indent` attribute (the fallback for an item with no sibling to sink
 * under — the "Tab again" case named in the brief). This function steps each independently
 * rather than trying to sum them into one combined level:
 *   • Real nesting cycles by DOM DEPTH — pure descendant-selector chains, so a genuinely
 *     nested `<ol>`/`<ul>` gets the right marker with no attribute involved at all, and mixed
 *     nesting (a bulleted sub-list inside a numbered one) still counts one level per list
 *     ancestor regardless of the ANCESTOR's own type (`:is(ol, ul)`).
 *   • The flat `indent` attribute cycles by ITS OWN VALUE, scoped to the enclosing list's
 *     type, independent of any real ancestor depth the same item might also carry.
 *   Summing the two into one true combined level is possible but combinatorial (every real
 *   depth × every indent value × two list types) for a case — an item that is BOTH really
 *   nested AND flat-indented on top — rare enough that this file accepts the small,
 *   documented inaccuracy: such an item's marker steps by whichever mechanism this rule
 *   checks second in the cascade, not by their sum. Neither mechanism ever loses information
 *   about the actual nesting (that is `margin-left`'s job, unchanged); this only affects which
 *   of three marker glyphs is drawn.
 *
 * Specificity does the ordering for free: each added `:is(ol,ul) ` hop is one more type
 * selector, so a rule generated for depth `d+1` always outranks depth `d`'s rule for an item
 * that satisfies both (a rule with more ancestor hops is inherently more specific) — no `!important`,
 * no source-order dependency. */
const ORDERED_CYCLE = ["decimal", "lower-alpha", "lower-roman"];
const BULLET_CYCLE = ["disc", "circle", "square"];

/** ⛔ A CHECKLIST IS NOT A BULLETED LIST FOR THIS RULE'S PURPOSES, AND IT MUST BE NAMED OUT
 *  EXPLICITLY. `ul[data-type="taskList"]` already sets `list-style: none` so the checkbox is
 *  the only marker — but that `none` is INHERITED by its `<li>` children, and inheritance
 *  loses to ANY rule that targets the element directly, however that rule's specificity
 *  compares to the ancestor's own. A bare `ul` in either table below would therefore have put
 *  a bullet glyph back in front of every checkbox. Every place this module matches "a
 *  bulleted list" — as a STYLING TARGET or as an ANCESTOR HOP being counted for depth — reads
 *  this constant instead of the bare tag. */
const PLAIN_UL = 'ul:not([data-type="taskList"])';

/** How many list-ancestor hops of real nesting this generates rules for. Past this depth an
 *  item keeps the deepest generated rule's marker rather than continuing the cycle — an
 *  outline this deep is far past anything a person writes by hand, so the (harmless) cap
 *  trades perfect cycling at extreme depth for a stylesheet that stays a stylesheet. */
export const MAX_MARKER_DEPTH = 6;

/** `d` real list-ancestor hops (d===0 is the empty string — no ancestor required, which is
 *  what makes the depth-0 rule also match a DEEPER item unless a more specific, deeper rule
 *  exists to outrank it).
 *
 *  ⛔ THE HOP ORDER IS `:is(ol,ul) > li > `, NOT `li > :is(ol,ul) > ` — read the direct-child
 *  chain from the wrapping list DOWN to the target, one real nesting level at a time. A
 *  nested list is a DIRECT CHILD of the `<li>` that owns it (`li > ol`, the same relationship
 *  `EDITOR_CSS`'s own `li > ul, li > ol` spacing rule already depends on), so one level of
 *  real nesting is the pair "an outer list, then the `<li>` that carries the next list" —
 *  `:is(ol,ul) > li >` — immediately followed by that next list and the target item itself.
 *  A checklist ancestor is excluded (`PLAIN_UL`, not bare `ul`) so nesting a plain list inside
 *  a checklist item does not count a "level" against a marker glyph that was never drawn. */
const ancestorHops = (d) => `:is(ol, ${PLAIN_UL}) > li > `.repeat(d);

/** The rule table for REAL nesting depth, one selector per depth per list type. `itemSelector`
 *  is the scope prefix (`.planyr-note .ProseMirror` or `.note-body`), matching every other
 *  generated table in this module. */
function structuralMarkerRules(itemSelector) {
  const rows = [];
  for (let d = 0; d <= MAX_MARKER_DEPTH; d += 1) {
    const hops = ancestorHops(d);
    rows.push(`${itemSelector} ${hops}ol > li { list-style-type: ${ORDERED_CYCLE[d % 3]}; }`);
    rows.push(`${itemSelector} ${hops}${PLAIN_UL} > li { list-style-type: ${BULLET_CYCLE[d % 3]}; }`);
  }
  return rows;
}

/** The rule table for the FLAT `data-indent` attribute, scoped per enclosing list type so a
 *  numbered outline's flat fallback still cycles through letters/numerals and a bulleted
 *  one through shapes. Level 0 (no attribute) needs no rule — `indentAttrs` already renders
 *  nothing at zero, and an unindented item is exactly the structural depth-0 case above. */
function attributeMarkerRules(itemSelector) {
  const rows = [];
  for (let n = 1; n <= MAX_INDENT; n += 1) {
    rows.push(`${itemSelector} ol li[data-indent="${n}"] { list-style-type: ${ORDERED_CYCLE[n % 3]}; }`);
    rows.push(`${itemSelector} ${PLAIN_UL} li[data-indent="${n}"] { list-style-type: ${BULLET_CYCLE[n % 3]}; }`);
  }
  return rows;
}

/** The public entry, mirrored verbatim by the editor's own stylesheet and the print sheet
 *  (PDF-PARITY) — see `NoteEditor.jsx`'s `EDITOR_CSS` and `lib/notesPrint.js`'s `PRINT_CSS`. */
export function listMarkerCssRules(itemSelector) {
  return [...structuralMarkerRules(itemSelector), ...attributeMarkerRules(itemSelector)].join("\n");
}
