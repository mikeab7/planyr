/* notesMixedSelection — DOES A SELECTION AGREE ON ONE VALUE, OR IS IT MIXED? (B1139216)
 *
 * ⛔ HIS REPORT: *"when i highlight it all and try to click 11 it doesnt work, issue seems to be
 * that when i higlight it all it shows as text size 11 even though there are multiple sizes."*
 * Measured on planyr.io: three blocks at 24px/18px/9px, all three selected — the Font size box
 * read "24", the FIRST block's size, presented as the whole selection's. `editor.getAttributes()`
 * / `editor.isActive()` answer "what mark or node attribute sits at one position" (the selection's
 * `$from`, in practice) — that is exactly right for a caret, which by definition has one value,
 * and exactly wrong for a RANGE, which can honestly disagree with itself. The Line spacing control
 * already sidesteps this by never showing a value at all; Font size and Block style are different —
 * the whole point of putting Font size on the row (B1371) was so a person could SEE what size their
 * text is — so the fix is to compute agreement over the WHOLE range, not to give up on showing state.
 *
 * The decision is here, pure, so it can be unit-tested with plain arrays and a fake `doc` shaped
 * like ProseMirror's (a `nodesBetween(from, to, cb)` that calls back with node-shaped objects) —
 * the same split this module already uses for `notesEnterInherit.js` (a pure decision, exercised
 * for real by a browser harness — `ui-audit/verify-notes-mixed-format.mjs` here).
 */

/** Sentinel meaning "the values disagree" — never a real font size, heading level or block kind,
 *  so `=== MIXED` is unambiguous. A Symbol rather than a string/null so it can never collide with
 *  a real attribute value (including `null`, which is itself a real, meaningful answer: "every run
 *  in the selection agrees on having NO override"). */
export const MIXED = Symbol("notes-mixed-selection");

/** The one value every item in `values` shares, or MIXED the moment two disagree. An empty array
 *  is `null` (nothing there to disagree with), not MIXED — a selection that touches no text has no
 *  opinion, and treating "nothing found" as "conflicting" would blank the box when there is nothing
 *  wrong. */
export function uniformValue(values) {
  if (!values || !values.length) return null;
  const seen = values[0];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] !== seen) return MIXED;
  }
  return seen;
}

/** What a formatting control should DISPLAY: a caret has exactly one value by definition, so a
 *  collapsed selection always trusts `caretValue` (the editor's own `getAttributes`/`isActive`
 *  read, unchanged from before this fix — rule 1 in NoteToolbar.jsx's own header: every active
 *  state comes from the editor, never a second, mirrored source of truth). Only a real RANGE asks
 *  whether every touched run/block agrees. */
export function formatDisplayValue({ selectionEmpty, caretValue, rangeValues }) {
  if (selectionEmpty) return caretValue ?? null;
  return uniformValue(rangeValues);
}

/** Every text run's `textStyle.fontSize` touched by `[from, to)` — `null` for a run carrying no
 *  explicit override, so "every run in range agrees on no override" is a real, distinct uniform
 *  answer from "every run agrees on 18px". Non-text nodes (images, a table's cell borders, …)
 *  contribute nothing — they have no font size to disagree about. */
export function selectionFontSizes(doc, from, to) {
  const sizes = [];
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const mark = (node.marks || []).find((m) => m.type && m.type.name === "textStyle");
    sizes.push((mark && mark.attrs && mark.attrs.fontSize) || null);
  });
  return sizes;
}

/** Every textblock's "shape" touched by `[from, to)`, in the same two-way vocabulary the block-
 *  style control already offers: `h${level}` for a heading, `"p"` for everything else (an ordinary
 *  paragraph, a list item's paragraph, a blockquote's, a code block — the control itself only ever
 *  distinguishes heading-or-not, so a third bucket here would claim a precision the UI doesn't
 *  have). */
export function selectionBlockShapes(doc, from, to) {
  const shapes = [];
  doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return;
    shapes.push(node.type.name === "heading" ? `h${node.attrs.level}` : "p");
  });
  return shapes;
}

/** Every textblock's `lineHeight` attribute touched by `[from, to)` (NEW-SPACING-3) — the Line
 *  spacing control's own version of `selectionFontSizes`/`selectionBlockShapes`. `lineHeight`
 *  lives on both `paragraph` and `heading` (notesSpacing.js), so this walks every textblock,
 *  not one named type; `null` is a real, distinct answer ("this block carries no override"),
 *  the same convention `selectionFontSizes` uses. */
export function selectionLineHeights(doc, from, to) {
  const heights = [];
  doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return;
    heights.push(node.attrs?.lineHeight ?? null);
  });
  return heights;
}
