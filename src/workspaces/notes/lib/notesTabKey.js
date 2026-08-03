/* notesTabKey — TAB BELONGS TO THE DOCUMENT WHILE THE CARET IS IN IT (B1392).
 *
 * THE BUG, in the owner's words: "when I press tab, sometimes Chrome grabs it, and it
 * doesn't hit tab on the notebook at all. It takes me to this dropdown on Chrome unrelated
 * to the web page." Tab is the browser's own focus key, so any press the document declines
 * falls through to the page chrome and then to the browser's toolbar — mid-sentence.
 *
 * "SOMETIMES" WAS THE WHOLE DIAGNOSIS, and it was measured in a real browser before a line
 * of this was written rather than guessed at. The editor's own extensions already claim Tab
 * in exactly two situations, and the escape happened in every other one:
 *
 *   in a table cell            TABLE handles it (next / previous cell)      — never escaped
 *   in a nested-able list item LIST handles it (indent / outdent)           — never escaped
 *   in the FIRST list item     list has nothing to indent INTO → declines   — ESCAPED
 *   in a plain paragraph       nobody claims it                             — ESCAPED
 *   in an empty document       nobody claims it                             — ESCAPED
 *
 * So this is a FALLBACK, not a blanket swallow: it is registered at a LOW PRIORITY, which
 * puts its keymap after the table's and the list's. Those still run first and still win
 * whenever they can act, and this only ever sees the presses they turned down. Indenting a
 * list, outdenting it, and stepping through a table's cells are untouched.
 *
 * ⛔ THE ESCAPE HATCH IS NOT OPTIONAL. A key that never leaves is a keyboard trap: someone
 * working without a mouse would be sealed inside the note with no way to reach the toolbar
 * or the rail. The convention every editor uses is ESCAPE THEN TAB, and that is what this
 * implements — one press of Escape releases the NEXT Tab (or Shift+Tab) to the browser, and
 * anything else you type takes it back. The editor's accessible name says so out loud, so
 * it is discoverable by screen reader rather than folklore.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/** One tab stop, as a real character in the document. It survives export (Markdown and the
 *  print sheet both carry text verbatim) and it round-trips through storage, which an
 *  indent faked with margin on the DOM node would not. */
export const TAB_CHAR = "\t";

/** Registered BELOW the default so the table and list keymaps are asked first — see the
 *  header. Any value under 100 (Tiptap's default) does it; this leaves room either side. */
export const TAB_PRIORITY = 50;

const releaseKey = new PluginKey("noteTabRelease");

/** In a list item, Tab means INDENT and the list extension has already had its turn. When it
 *  declined (the first item of a list, which has nothing to indent into) the honest answer
 *  is "nothing to do" — NOT a tab character wedged into a bullet, which is a document nobody
 *  asked for and cannot outdent again. */
const inList = (editor) => editor.isActive("listItem") || editor.isActive("taskItem");

const NoteTabKey = Extension.create({
  name: "noteTabKey",
  priority: TAB_PRIORITY,

  addStorage() {
    // One press of Escape arms this; the next Tab spends it and hands the key to the
    // browser. It is deliberately single-use — a released Tab must not stay released.
    return { released: false };
  },

  addKeyboardShortcuts() {
    const release = () => {
      if (!this.storage.released) return false;
      this.storage.released = false;
      return false;                       // false = "not handled" = the browser moves focus
    };

    return {
      Tab: () => {
        if (this.storage.released) return release();
        if (inList(this.editor)) return true;
        return this.editor.commands.insertContent(TAB_CHAR) || true;
      },

      "Shift-Tab": () => {
        if (this.storage.released) return release();
        if (inList(this.editor)) return true;
        // Outdent, in a plain paragraph, means take back the tab stop you just added.
        // With nothing to take back it still swallows the key: Shift+Tab is focus-BACKWARD
        // in the browser, so declining here would walk the caret out of the note just as
        // surely as Tab did.
        return this.editor.commands.command(({ tr, state, dispatch }) => {
          const { empty, from } = state.selection;
          if (!empty || from < 1) return true;
          const before = state.doc.textBetween(Math.max(0, from - 1), from, "\n", "\n");
          if (before !== TAB_CHAR) return true;
          if (dispatch) dispatch(tr.delete(from - 1, from));
          return true;
        });
      },

      // Escape ARMS the release and reports "not handled", so everything else that listens
      // for Escape here (clearing the find bar, closing a menu) still gets it.
      Escape: () => { this.storage.released = true; return false; },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        key: releaseKey,
        props: {
          // Typing anything else takes the release back: the hatch is for the moment you
          // meant to leave, not a mode you can forget you are in.
          handleKeyDown(_view, event) {
            if (event.key !== "Escape" && event.key !== "Tab") storage.released = false;
            return false;
          },
        },
      }),
    ];
  },
});

export default NoteTabKey;
