/* notesEnterInherit — A NEW LINE CONTINUES THE ONE ABOVE IT (NEW-ENTER-INHERIT).
 *
 * ⛔ HIS REPORT: *"it doesn't seem like when I start a new line, it carries the formatting (at
 * least the text size of what's directly above it)."*
 *
 * ⛔ AND HE CALLED THE CAUSE, WHICH IS WORTH RECORDING BECAUSE IT WAS RIGHT: *"the spacing work
 * added a BLOCK-LEVEL font-size attribute… Block attributes are not carried across a split unless
 * the split is told to carry them."* Measured on the real build before a line was written
 * (`ui-audit/audit-notes-enter-inherit.mjs`), and it is worse than he thought — BOTH tiers were
 * lost, not just the block one:
 *
 *     Enter at the END of a sized line:   block fontSize 22 → null
 *                                         run  fontSize 22px → null
 *                                         marks bold+textStyle → (none)
 *                                         colour #B8418C → null
 *
 * ⛔ AND THE SHAPE OF THE DEFECT IS WHY IT LOOKED INTERMITTENT: splitting in the MIDDLE of a line
 * keeps everything, and splitting at the START keeps everything. Only a split at the END loses
 * it — which is the one people do constantly. ProseMirror's `splitBlock` asks `defaultBlockAt`
 * for the new node when the caret is `atEnd`, and a default block has default attributes by
 * definition. Nothing was broken; the carry was never written.
 *
 * ⛔ WHY IT DECLINES SO OFTEN, and every clause is load-bearing. Enter is the most contested key
 * in the editor — the list keymap owns it, the code block owns it, and an EMPTY list item's Enter
 * means *leave the list*, which the owner named explicitly as a thing not to break. So this rule
 * only claims the press in the one case that actually loses formatting (a collapsed caret at the
 * end of a non-empty textblock) and hands every other case straight back. A rule that claimed
 * more would have to re-implement everything it displaced.
 *
 * ⛔ AND IT IS ONE TRANSACTION, VIA `chain()`. Splitting and then repairing in a second dispatch
 * would put TWO frames in the undo history for one keypress: the first Ctrl+Z would strip the
 * formatting off a line and leave it there, which is a worse bug than the one being fixed.
 */

/** Blocks whose Enter belongs to somebody else entirely. A code block's Enter is a newline. */
const NOT_OURS = new Set(["codeBlock"]);

/**
 * Should this Enter be the one we carry formatting across?
 *
 * PURE — it takes the few facts it needs rather than a ProseMirror state, so every clause is
 * unit-testable without an editor. `notesEnterInherit.test.js` walks the whole table.
 */
export function enterShouldInherit({
  empty = false,
  parentType = "paragraph",
  parentSize = 0,
  parentOffset = 0,
  isTextblock = true,
} = {}) {
  if (!empty) return false;                     // a RANGE split keeps the block's attrs already
  if (!isTextblock) return false;
  if (NOT_OURS.has(parentType)) return false;   // the code block's Enter is a newline
  /* ⛔ AN EMPTY BLOCK IS THE LIST-EXIT CASE AND MUST BE LEFT ALONE. Enter on an empty list item
   * means "leave the list", which the owner named as the exception to preserve. It is also the
   * `liftEmptyBlock` case in ordinary flow. There is nothing to inherit from an empty line
   * anyway, so declining costs nothing and protects a behaviour people rely on. */
  if (parentSize === 0) return false;
  /* ⛔ ONLY AT THE END. A split anywhere else already keeps the original node's attributes,
   * because ProseMirror only reaches for a DEFAULT block when the caret is `atEnd`. Claiming
   * those presses would mean re-implementing a split that is already correct. */
  return parentOffset === parentSize;
}

/** The attributes a new line inherits from the one it was split off. A copy, deliberately —
 *  handing ProseMirror the same object it already holds invites an in-place mutation later. */
export const inheritedAttrs = (attrs) => ({ ...(attrs || {}) });

/**
 * The Enter handler. Returns a Tiptap keyboard-shortcut function bound over the editor.
 *
 * The order below matters: the split has to be the one that WOULD have run — `splitListItem`
 * inside a list, `splitBlock` otherwise — or Enter in a list would stop making list items.
 */
export function enterInheritHandler({ editor }) {
  const { state } = editor;
  const { selection } = state;
  const { $from, empty } = selection;
  const parent = $from.parent;

  if (!enterShouldInherit({
    empty,
    parentType: parent.type.name,
    parentSize: parent.content.size,
    parentOffset: $from.parentOffset,
    isTextblock: parent.isTextblock,
  })) return false;

  const attrs = inheritedAttrs(parent.attrs);
  /* The marks in force at the caret. `storedMarks` is what a toggle just set and has not been
   * typed into yet; `$from.marks()` is what the text around the caret carries. Stored wins,
   * because it is the more recent statement of intent. */
  const marks = state.storedMarks || $from.marks();

  return editor.chain()
    .command(({ commands }) => commands.first([
      () => commands.splitListItem("taskItem"),
      () => commands.splitListItem("listItem"),
      () => commands.splitBlock(),
    ]))
    /* ⛔ THE REPAIR, IN THE SAME TRANSACTION. `tr` already holds the split, so `tr.selection` is
     * the caret in the NEW block — which is the node whose attributes were just defaulted. */
    .command(({ tr, dispatch }) => {
      if (!dispatch) return true;
      const $now = tr.selection.$from;
      if (!$now.parent.isTextblock) return true;
      const pos = $now.before($now.depth);
      tr.setNodeMarkup(pos, undefined, { ...$now.parent.attrs, ...attrs });
      /* ⛔ AND THE INLINE MARKS, which plain `splitBlock` also drops. Without this the new line
       * is the right SIZE and not bold, which is a stranger result than losing both. */
      if (marks && marks.length) tr.setStoredMarks(marks);
      return true;
    })
    .run();
}

export default enterInheritHandler;
