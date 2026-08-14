/* notesListIndent — TAB CHANGES THE LEVEL OF THE CURRENT ITEM; IT NEVER CREATES A NODE THE
 * USER DID NOT TYPE. (NEW-TAB, owner decision 2026-08-13.)
 *
 * ⛔ THE RULE, and it is the whole of this file in one sentence. **Tab changes the LEVEL of
 * the current item. It never creates a node the user did not type.** Shift+Tab returns that
 * item to the level it came from and leaves nothing behind.
 *
 * ⛔ WHAT IT REPLACES, and why the old answer was defensible and still wrong. A `listItem`'s
 * content spec is `paragraph block*`, so ProseMirror nests a bullet by making it a CHILD of
 * the bullet above it — and the first bullet of a list has no bullet above it. `sinkListItem`
 * therefore declines, and `ui-audit/audit-notes-tab.mjs` measured that as three rows of
 * `nothing`: the first top-level bullet, the first bullet of a nested list, and a range whose
 * start is a first item. The module said so out loud — *"a bullet tucks under the bullet above
 * it; the first bullet has nothing to tuck under"* — which is a true statement about the
 * structure and a bad answer for the person pressing the key. He has twice asked for this to
 * behave like OneNote, where the list simply renders one level deeper and no bullet appears
 * that you did not type.
 *
 * ⛔ THE OPTION THAT WAS REFUSED, named here so it is not re-proposed: mint an empty parent
 * bullet and sink into it. It gets the picture right and puts a bullet with no words in it
 * into the document — which then has to be exported, printed, counted, outlined, searched and
 * eventually deleted by hand. This module has spent six rounds removing exactly that kind of
 * litter. His constraint was explicit: *"No empty parent node in the document, ever."*
 *
 * ⛔ SO THE INDENT IS AN ATTRIBUTE ON THE ITEM, NOT A CHANGE OF SHAPE. `indent` is a small
 * integer on `listItem` / `taskItem`. The tree is untouched: same nodes, same order, same
 * parents, one number different. That makes every one of his constraints true by construction
 * rather than by care —
 *   • nothing is created, so there is no empty parent to assert the absence of;
 *   • Shift+Tab is `n − 1`, so returning to the original level is exact rather than a repair;
 *   • at `n === 0` the attribute renders NOTHING, so an indent/outdent pair round-trips
 *     byte-identical through storage, Markdown and the print sheet.
 *
 * ⛔ AND IT DOES NOT REPLACE REAL NESTING — it fills the hole real nesting cannot reach. When
 * `sinkListItem` CAN act (any item with a sibling above it) it still does, and the result is a
 * real nested list exactly as before. This runs only where that command declines, which is why
 * it asks `can()` first and returns false rather than guessing. Two mechanisms with one
 * boundary, and the boundary is a question the editor answers, not a rule written down here.
 *
 * ⛔ PDF-PARITY: the level is written into the MARKUP (a margin on the item), so the print
 * sheet and the HTML export carry it with no second stylesheet to keep in step — the same
 * choice `notesSpacing.js` made, for the same reason. Markdown carries it as indentation,
 * which is how Markdown spells nesting anyway, so the export is not lossy.
 */
import { Extension } from "@tiptap/core";

/* ⛔ THE PURE HALF LIVES NEXT DOOR, in lib/notesIndentLevel.js, and that split is load-bearing
 * rather than tidiness: this file imports the editor engine, and lib/notesMarkdown.js — which
 * needs the same `readIndent` — is on the Notes route's STATIC path and may not. Same shape as
 * lib/notesFileMeta.js. */
import { INDENTABLE, MAX_INDENT, indentAttrs, parseIndent, readIndent } from "./notesIndentLevel.js";

export { INDENTABLE, INDENT_STEP_EM, MAX_INDENT, indentAttrs, readIndent } from "./notesIndentLevel.js";

/** ⛔ THE ITEMS THE SELECTION IS ACTUALLY IN — WHICH IS **NOT** WHAT `nodesBetween` RETURNS
 *  (NEW-OUTDENT, reported by the owner with a screenshot).
 *
 *  THE BUG THIS REPLACES, because the shape is subtle enough to be re-introduced. The first
 *  version asked `doc.nodesBetween(from, to)` for every `listItem` and moved all of them.
 *  `nodesBetween` visits every node whose range CONTAINS the position — so for a caret sitting in
 *  a level-three bullet it returns that bullet **and its level-two parent and its level-one
 *  grandparent**. Every ancestor moved with it, and an ancestor moving takes its ENTIRE subtree,
 *  including branches that sit above and beside the line the user pressed on.
 *
 *  MEASURED on his outline (`ui-audit/diagnose-notes-outdent.mjs`): Tab on "Active" — one line,
 *  caret collapsed — indented "Active" AND its untouched parent "MUD 377", so the whole MUD 377
 *  branch shifted. His report was Shift+Tab on "MUD ATTORNEY" dragging "Dustin O'Neal" and its
 *  two children; those are not its descendants, they are its NEPHEWS, which is the tell that an
 *  ancestor moved rather than a sibling being captured.
 *
 *  THE RULE, and it answers the ancestor question and the range question in one pass: **an item
 *  moves when the selection is inside ITS OWN text, not merely somewhere beneath it.** So the walk
 *  collects TEXTBLOCKS in the range and maps each to its NEAREST indentable ancestor. A collapsed
 *  caret yields exactly one item; a range across two bullets yields both; a range that genuinely
 *  spans a parent's text and its child's text yields both, which is right because both lines were
 *  selected. An ancestor whose own words the user never touched is never in the set.
 *
 *  ⛔ STRUCTURE ONLY, NEVER GEOMETRY — he asked for this explicitly, having noticed that the odd
 *  line out in his outline carries a smaller font. Nothing here reads a rendered size, a position
 *  or a box; it walks the document. */
const itemsInSelection = (state) => {
  const { from, to } = state.selection;
  const hits = new Map();                       // keyed by position, so an item is counted once
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const $at = state.doc.resolve(pos);
    for (let d = $at.depth; d > 0; d -= 1) {
      if (!INDENTABLE.includes($at.node(d).type.name)) continue;
      const owner = $at.before(d);
      if (!hits.has(owner)) hits.set(owner, { node: $at.node(d), pos: owner });
      break;                                    // NEAREST ancestor only — never its parents
    }
    return true;
  });
  return [...hits.values()];
};

/** Which list-item type the caret is in, or null. */
const activeItemType = (editor) => INDENTABLE.find((t) => editor.isActive(t)) || null;

/** The one mutation this file makes: every indentable item under the selection moves by
 *  `delta` levels, clamped. Nothing is inserted, removed or re-parented.
 *
 *  ⛔ EXPORTED AS A PLAIN PROSEMIRROR COMMAND so the guards can drive the REAL code path with
 *  no DOM — this repo's unit runner is node-only. That matters more than it sounds: a test
 *  that re-implemented "add one to the attribute" would be testing its own copy, and the
 *  claim being made here is about what happens to the STORED document. The browser half (a
 *  real Tab keystroke, per SYNTHETIC-KEYS-DONT-EDIT) is `ui-audit/audit-notes-tab.mjs`. */
export const shiftIndent = (delta) => ({ state, tr, dispatch }) => {
  const hits = itemsInSelection(state);
  if (!hits.length) return false;
  let changed = false;
  for (const { node, pos } of hits) {
    const now = readIndent(node.attrs);
    const next = Math.max(0, Math.min(MAX_INDENT, now + delta));
    if (next === now) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
    changed = true;
  }
  if (changed && dispatch) dispatch(tr);
  return changed;
};

const shift = (editor, delta) => editor.commands.command(shiftIndent(delta));

/** True when at least one item under the selection still has a level to give back. Asked
 *  BEFORE the list keymap gets Shift+Tab, because `liftListItem` would otherwise lift a
 *  first item clean out of its list while it still owes an outdent. */
const hasIndent = (editor) => itemsInSelection(editor.state).some(({ node }) => readIndent(node.attrs) > 0);

/* ⛔ ABOVE THE LIST KEYMAP, DELIBERATELY, AND IT IS THE ONLY REASON THIS IS A SEPARATE
 * EXTENSION FROM `notesTabKey`. That one is a FALLBACK at priority 50 — it sees a press only
 * after the list and table keymaps have turned it down, which is exactly right for Tab. It is
 * exactly wrong for Shift+Tab: an item sitting at level 2 by attribute is, to ProseMirror, an
 * ordinary first item, so `liftListItem` would happily lift it out of the list entirely while
 * it still had two levels to give back. So this sits ABOVE the list keymap and declines
 * (returns false) whenever the list can do the real thing. */
export const LIST_INDENT_PRIORITY = 200;

const NoteListIndent = Extension.create({
  name: "noteListIndent",
  priority: LIST_INDENT_PRIORITY,

  addGlobalAttributes() {
    return [{
      types: INDENTABLE,
      attributes: {
        indent: { default: 0, parseHTML: parseIndent, renderHTML: indentAttrs },
      },
    }];
  },

  addCommands() {
    return {
      indentListItem: () => shiftIndent(+1),
      outdentListItem: () => shiftIndent(-1),
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const type = activeItemType(this.editor);
        if (!type) return false;                                  // not in a list — not ours
        // Real nesting first, always. `can()` is the editor's own answer to "is there a
        // bullet above this one", which is the whole boundary between the two mechanisms.
        if (this.editor.can().sinkListItem(type)) return false;   // let the list keymap nest
        return shift(this.editor, +1);
      },

      "Shift-Tab": () => {
        if (!activeItemType(this.editor)) return false;
        // A level owed is given back before the list is allowed to lift anything.
        if (!hasIndent(this.editor)) return false;
        return shift(this.editor, -1);
      },
    };
  },
});

export default NoteListIndent;
