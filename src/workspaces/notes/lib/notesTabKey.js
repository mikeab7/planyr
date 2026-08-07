/* notesTabKey — TAB BELONGS TO THE DOCUMENT WHILE THE CARET IS IN IT (B1392, and B1392 ×2
 * which is the one that made it true in EVERY context rather than usually).
 *
 * THE ORIGINAL BUG, in the owner's words: "when I press tab, sometimes Chrome grabs it, and
 * it doesn't hit tab on the notebook at all." Tab is the browser's own focus key, so any
 * press the document declines falls through to the page chrome and then to the browser's
 * toolbar — mid-sentence.
 *
 * ⛔ THE RECURRENCE, and the word that matters: *"the tab doesn't always work correctly."*
 * ALWAYS. B1392 fixed the contexts that existed when it was written and left the rest
 * undefined — and three of the surfaces it never saw (a selected node, the last cell of a
 * table, the page title, a sketch box's two fields) arrived afterwards. "Usually" is not a
 * specification, so this file now states what Tab does in EVERY context and the harness
 * drives every one of them.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * WHAT TAB DOES, EVERYWHERE. This table is the specification; the code below implements it
 * and `ui-audit/verify-notes.mjs` §26 asserts each row by its OUTCOME, not by whether a
 * handler ran.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *   plain paragraph               inserts a real tab character            (was: ✓)
 *   empty document                inserts a real tab character            (was: ✓)
 *   FIRST item of a list          nothing — a list has nothing to indent INTO, and a tab
 *                                 wedged into a bullet is a document nobody asked for
 *   nested / later list item      LIST indents (Shift+Tab outdents)       — never reached here
 *   table cell                    TABLE steps to the next cell            — never reached here
 *   LAST cell of a table          ⛔ NEW — adds a ROW and lands in its first cell, which is
 *                                 what Word and Google Docs do. It used to fall through to
 *                                 this fallback and wedge a tab character into the last cell.
 *   ⛔ A SELECTED NODE            ⛔ NEW, and this one was DESTRUCTIVE. With an image or a
 *   (image, sketch)               sketch selected, `insertContent` REPLACED THE SELECTION —
 *                                 pressing Tab deleted the picture and left a tab character
 *                                 where it had been. Tab now moves the caret to just after
 *                                 the node and changes nothing.
 *   page TITLE field              moves the caret INTO the document body (Shift+Tab goes
 *                                 back out to the toolbar) — handled in NoteEditor.jsx
 *   sketch box LABEL field        moves to that box's detail field        — notesSketchEditor
 *   sketch box DETAIL field       closes the box and returns to the document — same file
 *
 * So this is a FALLBACK, not a blanket swallow: it is registered at a LOW PRIORITY, which
 * puts its keymap after the table's and the list's. Those still run first and still win
 * whenever they can act, and this only ever sees the presses they turned down.
 *
 * ⛔ THE ESCAPE HATCH IS NOT OPTIONAL. A key that never leaves is a keyboard trap: someone
 * working without a mouse would be sealed inside the note with no way to reach the toolbar
 * or the rail. The convention every editor uses is ESCAPE THEN TAB, and that is what this
 * implements — one press of Escape releases the NEXT Tab (or Shift+Tab) to the browser, and
 * anything else you type takes it back. The editor's accessible name says so out loud, so
 * it is discoverable by screen reader rather than folklore.
 */
import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";

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

/** ⛔ A NON-TEXT SELECTION IS A NODE THE USER HAS SELECTED — a picture, a sketch. Inserting
 *  anything at all REPLACES it, so the old fallback's `insertContent(TAB_CHAR)` destroyed a
 *  picture on a stray Tab and left a tab character in the hole. Tab must never delete
 *  content it was not asked to delete. */
/*  ⛔ `instanceof`, NEVER `constructor.name`. The first version of this guard tested the
 *  class NAME — which is correct in development and MEANINGLESS in the shipped bundle,
 *  because the minifier renames the class. It would have passed every local check and
 *  destroyed pictures in production: exactly the "green here, broken in the field" shape
 *  that B1393 ×2 was about. The headless run against the real BUILT bundle caught it. */
const nodeSelected = (editor) => editor.state.selection instanceof NodeSelection;

/** In a table, `goToNextCell` declines at the LAST cell — the press then fell through here
 *  and wedged a tab character into that cell. Word and Google Docs add a row instead, which
 *  is the only reading of "next cell" that is ever wanted at the end of a table. */
const inTable = (editor) => editor.isActive("table");

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
        // The last cell of a table: grow the table rather than corrupt the cell.
        if (inTable(this.editor)) return this.editor.commands.addRowAfter() || true;
        // A selected picture or sketch: step past it. NEVER replace it.
        if (nodeSelected(this.editor)) {
          const to = this.editor.state.selection.to;
          return this.editor.chain().focus().setTextSelection(to).run() || true;
        }
        return this.editor.commands.insertContent(TAB_CHAR) || true;
      },

      "Shift-Tab": () => {
        if (this.storage.released) return release();
        if (inList(this.editor)) return true;
        if (inTable(this.editor)) return true;          // the table keymap already declined; do nothing
        if (nodeSelected(this.editor)) {
          const from = this.editor.state.selection.from;
          return this.editor.chain().focus().setTextSelection(from).run() || true;
        }
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
