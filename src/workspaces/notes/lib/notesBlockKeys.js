/* notesBlockKeys — BACKSPACE AT THE START OF A BLOCK TAKES ONE PREDICTABLE STEP, AT EVERY
 * BLOCK BOUNDARY (B36051, and B291536 which is the one that made it true everywhere rather
 * than in one place).
 *
 * THE ORIGINAL REPORT, in the owner's words, from a real note (project Silvestri, page
 * "Utility"): *"if I press backspace when I'm right in front of Simon Sequeira, it moves the
 * entire… it was like a whole chunk that moves to the left, not just Simon's name. It also
 * moved the line above it to the left. It makes no sense."*
 *
 * ⛔ WHAT WAS ACTUALLY HAPPENING, read out of his live document rather than guessed. An
 * Outlook signature had pasted into a list item, and one paragraph of it — the name — carried
 * `text-align: right` while every sibling around it did not. Backspace at position 0 of a
 * block runs ProseMirror's `joinBackward`, which MERGES that block into the one before it (a
 * spacer paragraph of `&nbsp;`). The merged paragraph keeps ONE alignment for both, so the
 * name and the line above it both reflow left in a single keystroke — a multi-block
 * restructuring, from a key that should take one small step.
 *
 * ⛔ THE RECURRENCE, and the sentence that reframed the whole file: *"the backspace still
 * acts funny in certain spots."* B36051 fixed ONE node type — a paragraph carrying an odd
 * alignment — and left every other boundary to whatever the default keymap happened to do.
 * In LISTS that default is three separate structural changes from one press:
 *   · at the start of a NESTED bullet it un-nested the item AND merged it into its parent, so
 *     "bullet one" and "bullet two" became one item reading "bullet onebullet two";
 *   · at the start of a TOP-LEVEL bullet it merged the item into the paragraph above, left an
 *     EMPTY orphan bullet behind, and promoted a child he had never touched.
 * And the boundary nobody had looked at was worse than either: **one press at the start of a
 * paragraph that follows a PICTURE deleted the picture** (`joinBackward` removes a leaf it
 * cannot join into) — the same destructive shape B1392 ×2 found on Tab, at a different key.
 *
 * ⛔ SO THE FIX IS NOT ANOTHER SPECIAL CASE. This file now STATES what Backspace does at
 * every block boundary, `blockStartAction` decides which row applies (pure, unit-tested in
 * test/notesBlockKeys.test.js), and `ui-audit/verify-notes-backspace.mjs` drives every row
 * against the real built app and asserts the resulting DOCUMENT TREE — node types, nesting
 * depth, child counts, and that no empty node appeared.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * WHAT BACKSPACE DOES AT POSITION ZERO. This table is the specification.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   the very first position in the document   nothing at all
 *   plain paragraph after a paragraph         the ordinary join                    (unchanged)
 *   paragraph after a heading                 the ordinary join                    (unchanged)
 *   a block carrying an ODD ALIGNMENT         the alignment comes off, and stops   (B36051)
 *   a HEADING                                 becomes a plain paragraph; the join is press 2
 *   a CODE BLOCK                              becomes a plain paragraph; its code never
 *                                             merges into the prose above
 *   first block of a BLOCKQUOTE               leaves the quote; the rest of the quote stays
 *   NESTED list item                          OUTDENTS one level, and does nothing else
 *   TOP-LEVEL list item                       becomes a plain paragraph, keeping its text;
 *                                             the join is press 2
 *   a later block INSIDE a list item          the ordinary join, within that item
 *   paragraph after a LIST or a QUOTE         its words join the LAST LINE of it — it does
 *                                             NOT quietly become a bullet or a quoted line
 *   first block of a TABLE CELL               nothing — cells never merge into each other
 *   paragraph after a TABLE                   the caret steps into the last cell; the table
 *                                             is not selected and not one press from deletion
 *   paragraph after a PICTURE or a SKETCH     the picture is SELECTED, never deleted
 *
 * ⛔ TWO PROPERTIES THAT ARE THE POINT, not side effects:
 * (1) **ONE VISIBLE STEP.** Nothing here changes more than one thing, and nothing re-levels a
 *     block the user did not have the caret in. Where a destructive join is the eventual
 *     answer it is always the SECOND press, by which time the two blocks already look alike
 *     and the join is visible rather than a surprise. This is Word's own behaviour.
 * (2) **NO LITTER.** No step may leave an empty list item, an empty list, or a stray blank
 *     paragraph behind.
 *
 * ⛔ AND ONE THING THIS FILE FIXES BY EXISTING. Tiptap's `ListKeymap` runs its Backspace
 * handler ONCE PER LIST TYPE — `listItem` then `taskItem` — over a `forEach` that does not
 * stop at the first one to act. On a document that mixes a checklist with a bulleted list,
 * pass two runs against the state pass one already changed, and its `hasListBefore` branch is
 * a `cut(...).joinForward()` — a genuinely multi-block restructure. Claiming the key here, at
 * a priority ABOVE that keymap, means position zero is decided by the table above and by
 * nothing else. `ListKeymap` still owns Delete, Mod-Backspace and every press that is not at
 * position zero.
 */
import { Extension } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";

/** Above Tiptap's default (100) so this is asked before `joinBackward` AND before
 *  `ListKeymap`, and nowhere near `notesTabKey`'s deliberately LOW priority. */
export const BLOCK_KEYS_PRIORITY = 160;

/** Alignments that are a real, visible difference from the surrounding text. `null` and
 *  `"left"` are the default and are not worth a keystroke of their own. */
const MEANINGFUL_ALIGN = new Set(["center", "right", "justify"]);

const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);

/** ProseMirror's own `findCutBefore`, restated here because the decision needs it and
 *  prosemirror-commands does not export it. It walks up from the caret while it is at the
 *  start of each ancestor and returns the boundary the join would happen across — or null
 *  when there is nothing before it, either because this is the start of the document or
 *  because an ISOLATING node (a table cell) walls it off. That single null is what makes
 *  "the first block of a cell does nothing" fall out of the model instead of being a
 *  hand-written exception. */
function cutBefore($pos) {
  if ($pos.parent.type.spec.isolating) return null;
  for (let d = $pos.depth - 1; d >= 0; d -= 1) {
    if ($pos.index(d) > 0) return $pos.doc.resolve($pos.before(d + 1));
    if ($pos.node(d).type.spec.isolating) return null;
  }
  return null;
}

/**
 * WHICH ROW OF THE TABLE APPLIES — pure, and the whole decision. Takes a ProseMirror state,
 * returns `{ action, ... }` or `null` for "this press is not ours, let the ordinary keymap
 * have it".
 *
 * `null` and `{ action: "join" }` are deliberately different: `null` means we never looked
 * (a selection-delete, a caret mid-line), while `join` means the table's answer for this
 * boundary IS the ordinary join and we run it ourselves so no other keymap can turn it into
 * something else.
 */
export function blockStartAction(state) {
  const { selection } = state;
  if (!selection.empty) return null;                        // a selection-delete is not this
  const { $from } = selection;
  if ($from.parentOffset !== 0) return null;                // only AT THE START of a block
  const parent = $from.parent;
  if (!parent.isTextblock) return null;

  /* ── formatting comes off before anything structural happens ─────────────────────────── */
  if (MEANINGFUL_ALIGN.has(parent.attrs?.textAlign)) {
    return { action: "clear-align", type: parent.type.name };
  }

  const cut = cutBefore($from);

  if (parent.type.name === "heading") return { action: "heading-to-paragraph" };
  if (parent.type.name === "codeBlock") return { action: "codeblock-to-paragraph" };

  /* ── the block's own container: a list item, or a blockquote ─────────────────────────── */
  const containerDepth = $from.depth - 1;
  if (containerDepth >= 1 && $from.index(containerDepth) === 0) {
    const container = $from.node(containerDepth);
    if (LIST_ITEM_TYPES.has(container.type.name)) {
      const listDepth = containerDepth - 1;
      const grandparent = listDepth >= 1 ? $from.node(listDepth - 1) : null;
      const nested = !!grandparent && LIST_ITEM_TYPES.has(grandparent.type.name);
      return { action: nested ? "outdent-list-item" : "list-item-to-paragraph", itemType: container.type.name };
    }
    if (container.type.name === "blockquote") return { action: "lift-blockquote" };
  }

  /* ── nothing before it: the start of the document, or the first block of a table cell ── */
  if (!cut) return { action: "none" };

  const before = cut.nodeBefore;
  if (!before) return { action: "none" };

  /* ── a picture or a sketch: SELECT it, never delete it ───────────────────────────────── */
  if (before.isAtom && !before.isText) return { action: "select-node-before", pos: cut.pos - before.nodeSize };

  /* ── a table: step INTO its last cell rather than select the whole thing ─────────────── */
  if (before.type.name === "table") return { action: "into-table-cell", pos: cut.pos - 1 };

  /* ── a LIST or a QUOTE — a container, not a line. The plain `joinBackward` absorbs this
       paragraph INTO the container (it becomes a new bullet, or a new quoted line), which is
       a surprising thing to get from a key that deletes backwards. Joining the TEXTBLOCKS is
       the step everybody means: these words go onto the end of the last line above. It is
       also what stops ListKeymap's two-pass Backspace turning this boundary into a
       `cut(...).joinForward()` restructure. ─────────────────────────────────────────────── */
  if (!before.isTextblock) return { action: "join-textblock" };

  return { action: "join" };
}

/** Run the verdict. Every branch returns TRUE — the press is spent on exactly one step. */
function runBlockStartAction(editor, verdict) {
  switch (verdict.action) {
    case "none":
      return true;                                          // nothing above to step to
    case "clear-align":
      /* One step: this block stops being the odd one out. The next Backspace joins, and by
       * then the join is visible rather than a surprise. */
      return editor.commands.updateAttributes(verdict.type, { textAlign: null }) || true;
    case "heading-to-paragraph":
    case "codeblock-to-paragraph":
      return editor.commands.setNode("paragraph") || true;
    case "lift-blockquote":
      return editor.commands.lift("blockquote") || true;
    case "outdent-list-item":
    case "list-item-to-paragraph":
      /* ONE lift. `liftListItem` outdents a nested item and lifts a top-level one clean out
       * of the list — the same command, and which of the two it is depends only on where the
       * item already sits, so there is no branch here to get wrong. */
      return editor.commands.liftListItem(verdict.itemType) || true;
    case "select-node-before":
      return editor.commands.setNodeSelection(verdict.pos) || true;
    case "into-table-cell":
      /* The nearest real caret position going BACKWARDS from just inside the table's end —
       * which is the end of its last cell, whatever that cell happens to contain. */
      return editor.commands.command(({ tr, dispatch }) => {
        const near = Selection.near(tr.doc.resolve(verdict.pos), -1);
        if (near && dispatch) dispatch(tr.setSelection(near).scrollIntoView());
        return true;
      }) || true;
    case "join-textblock":
      return editor.commands.joinTextblockBackward() || true;
    case "join":
      return editor.commands.joinBackward() || true;
    default:
      return false;
  }
}

const NoteBlockKeys = Extension.create({
  name: "noteBlockKeys",
  priority: BLOCK_KEYS_PRIORITY,

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { editor } = this;
        /* ⛔ THE INPUT RULE KEEPS ITS FIRST REFUSAL. Typing "- " turns the line into a bullet
         * and the very next Backspace is universally understood to take that back — it must
         * not be read as "the caret is at the start of a list item" and outdent instead. */
        if (editor.commands.undoInputRule()) return true;
        const verdict = blockStartAction(editor.state);
        if (!verdict) return false;
        return runBlockStartAction(editor, verdict);
      },
    };
  },
});

export default NoteBlockKeys;
