/* notesBlockKeys — BACKSPACE AT THE START OF A BLOCK TAKES ONE PREDICTABLE STEP (B36051).
 *
 * THE REPORT, in the owner's words, from a real note (project Silvestri, page "Utility"):
 * *"if I press backspace when I'm right in front of Simon Sequeira, it moves the entire… it
 * was like a whole chunk that moves to the left, not just Simon's name. It also moved the
 * line above it to the left. It makes no sense."*
 *
 * ⛔ WHAT WAS ACTUALLY HAPPENING, read out of his live document rather than guessed. An
 * Outlook signature had pasted into a list item, and one paragraph of it — the name — carried
 * `text-align: right` while every sibling around it did not. Backspace at position 0 of a
 * block runs ProseMirror's `joinBackward`, which MERGES that block into the one before it (a
 * spacer paragraph of `&nbsp;`). The merged paragraph keeps ONE alignment for both, so the
 * name and the line above it both reflow left in a single keystroke — a multi-block
 * restructuring, from a key that should take one small step. "It makes no sense" is exactly
 * right: nothing on screen suggested those two lines were about to become one.
 *
 * ⛔ THE RULE: **a formatting difference is undone BEFORE any structural change.** Backspace
 * at the start of a block that carries a non-default alignment CLEARS THE ALIGNMENT and stops
 * there. Press it again and you get the ordinary join, which is now visibly a join because
 * the two blocks already look alike. This is Word's own behaviour (Backspace at the start of
 * a formatted paragraph removes the formatting first) and it makes the destructive step the
 * SECOND one rather than the first.
 *
 * Registered ABOVE the default keymap so it is asked first, and it returns `false` in every
 * case it does not claim — so ordinary Backspace, selection-delete, list outdent and the
 * table's own handling are all untouched.
 */
import { Extension } from "@tiptap/core";

/** Above Tiptap's default (100) so this is asked before `joinBackward`, and nowhere near
 *  `notesTabKey`'s deliberately LOW priority. */
export const BLOCK_KEYS_PRIORITY = 160;

/** Alignments that are a real, visible difference from the surrounding text. `null` and
 *  `"left"` are the default and are not worth a keystroke of their own. */
const MEANINGFUL = new Set(["center", "right", "justify"]);

const NoteBlockKeys = Extension.create({
  name: "noteBlockKeys",
  priority: BLOCK_KEYS_PRIORITY,

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { editor } = this;
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;              // a selection-delete is not this
        const { $from } = selection;
        if ($from.parentOffset !== 0) return false;      // only AT THE START of a block
        const parent = $from.parent;
        if (!parent?.isTextblock) return false;
        const align = parent.attrs?.textAlign;
        if (!MEANINGFUL.has(align)) return false;        // nothing to undo — let the join run

        /* One step: this block stops being the odd one out. The next Backspace joins, and by
         * then the join is visible rather than a surprise. */
        return editor.commands.updateAttributes(parent.type.name, { textAlign: null }) || true;
      },
    };
  },
});

export default NoteBlockKeys;
