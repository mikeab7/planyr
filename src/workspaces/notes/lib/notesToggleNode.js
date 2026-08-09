/* notesToggleNode — a section that folds away (NEW-7).
 *
 * TWO NODES, and the split is what makes it a real construct rather than a styled div:
 *   noteToggle       →  <details>   the whole thing, carrying the open/closed state
 *   noteToggleTitle  →  <summary>   the one line that stays visible when it is folded
 *
 * ⛔ IT IS THE BROWSER'S OWN `<details>`, ON PURPOSE. Folding is then a thing the browser
 * does — no measuring, no animation frame, no height cache to go stale, and (the part that
 * matters here) a printed sheet inherits the same element. Hand-rolling the fold would have
 * meant a second implementation on paper, which is exactly how a screen and its export
 * drift apart (PDF-PARITY).
 *
 * ⛔ NO NODE VIEW. The open/closed state lives in the document as an attribute and is
 * rendered by `renderHTML`, so ProseMirror owns the DOM outright. A node view here would
 * have to re-implement content rendering for a node whose whole job is to contain other
 * blocks. What it costs instead is one small plugin below: a press on the summary's
 * disclosure area updates the ATTRIBUTE rather than letting the browser flip a DOM property
 * ProseMirror would overwrite on the next render.
 *
 * ⛔ A COLLAPSED TOGGLE PRINTS AND EXPORTS EXPANDED. Paper has no disclosure triangle, so a
 * folded section on paper is simply missing text — the worst possible export bug, because
 * it is invisible. `docToHtml` opens every `<details>` before it serialises for print
 * (lib/notesDocHtml.js), and the Markdown exporter writes `<details open>`. The screen is
 * the only surface where a toggle is ever closed.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

export const TOGGLE_TITLE_PLACEHOLDER = "Toggle";

/** The visible line. Its own node type so the schema — not a convention — guarantees a
 *  toggle always has exactly one summary, in first position. */
export const NoteToggleTitle = Node.create({
  name: "noteToggleTitle",
  content: "inline*",
  defining: true,
  selectable: false,
  parseHTML() { return [{ tag: "summary" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["summary", mergeAttributes({ class: "planyr-toggle-title" }, HTMLAttributes), 0];
  },
});

export const toggleClickKey = new PluginKey("noteToggleClick");

export const NoteToggle = Node.create({
  name: "noteToggle",
  group: "block",
  // A title, then at least one block — so a new toggle arrives with somewhere to type.
  content: "noteToggleTitle block+",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.hasAttribute("open"),
        renderHTML: (attrs) => (attrs.open ? { open: "" } : {}),
      },
    };
  },

  parseHTML() { return [{ tag: "details" }]; },

  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes({ class: "planyr-toggle" }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      /** Insert a toggle, taking the current block's text as its title when there is any —
       *  so typing a line and then folding it does not make you retype the line, and
       *  leaving the caret IN the title so the next thing typed names the section.
       *
       *  ⛔ IT READS `tr.selection`, NOT `state.selection`, AND THAT IS THE WHOLE BUG FIX.
       *  The slash menu runs this at the end of a chain that has already deleted the typed
       *  `/toggle`; `state` is the state as it was BEFORE that chain, so positions taken
       *  from it are stale by exactly the length of the command the user typed. The headless
       *  harness caught it as a toggle with an empty title and the title's words in its
       *  body — a wrong result, from a command that reported success. */
      setNoteToggle: () => ({ state, tr, dispatch }) => {
        const { $from } = tr.selection;
        if (!$from.parent.isTextblock) return false;
        const text = $from.parent.textContent;
        const from = $from.before($from.depth);
        const to = $from.after($from.depth);
        const { noteToggle, noteToggleTitle, paragraph } = state.schema.nodes;
        const node = noteToggle.create({ open: true }, [
          noteToggleTitle.create(null, text ? state.schema.text(text) : null),
          paragraph.create(),
        ]);
        if (dispatch) {
          tr.replaceWith(from, to, node);
          // `from + 2` is inside the summary: past the toggle's own open token and past the
          // title's. `TextSelection.near` is the safe way to land there whatever the content.
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from + 2, tr.doc.content.size))));
          tr.scrollIntoView();
        }
        return true;
      },

      /** Fold / unfold the toggle the caret is inside. Bound to the summary press below and
       *  available from the keyboard, because a control only a mouse can reach is one half
       *  of a control. */
      toggleNoteToggleOpen: () => ({ editor, commands }) => {
        if (!editor.isActive(this.name)) return false;
        return commands.updateAttributes(this.name, { open: !editor.getAttributes(this.name).open });
      },
    };
  },

  addProseMirrorPlugins() {
    const type = this.name;
    return [new Plugin({
      key: toggleClickKey,
      props: {
        /* The browser would happily flip `details.open` itself — and ProseMirror would put
         * it back on the next render, so the fold would spring open a moment later. Claim
         * the press, write the ATTRIBUTE, and the document is the single source of truth
         * for whether a section is folded (which is also what makes it persist and sync). */
        handleDOMEvents: {
          mousedown(view, event) {
            const el = event.target instanceof Element ? event.target.closest("summary") : null;
            if (!el) return false;
            // Only the marker area folds. A press on the WORDS has to place the caret, or
            // the title would be the one line in the document you cannot edit.
            const box = el.getBoundingClientRect();
            if (event.clientX > box.left + 22) return false;
            const pos = view.posAtDOM(el, 0);
            if (pos == null || pos < 0) return false;
            const $pos = view.state.doc.resolve(pos);
            for (let d = $pos.depth; d > 0; d -= 1) {
              const node = $pos.node(d);
              if (node.type.name !== type) continue;
              event.preventDefault();
              view.dispatch(view.state.tr.setNodeMarkup($pos.before(d), null, { ...node.attrs, open: !node.attrs.open }));
              return true;
            }
            return false;
          },
        },
      },
    })];
  },
});

export default NoteToggle;
