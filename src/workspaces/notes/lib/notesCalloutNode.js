/* notesCalloutNode — a callout: a coloured block that says "this bit matters" (NEW-7).
 *
 * ⛔ THE TONE IS A NAME, NOT A COLOUR. The node stores `tone: "info" | "tip" | "important"
 * | "warning" | "danger"` and NOTHING else. It never stores a hex, a class list, or an
 * icon character. Three surfaces then draw that one name their own way — the screen from
 * theme tokens (so a callout themes with the app), paper from print ink (so it does not
 * print a dark box), and Markdown from GitHub's own alert syntax. Storing a colour would
 * have frozen the first of those three into the document forever.
 *
 * ⛔ AND THAT IS WHY THE ICON IS CSS, NOT CONTENT. Every glyph is a `::before` keyed on
 * `data-callout`, in components/NoteEditor.jsx (screen) and lib/notesPrint.js (paper). An
 * icon inserted as a text node would be selectable, deletable, exportable and wrong — and
 * it would ride into the Markdown as a stray emoji on top of the `[!NOTE]` marker that
 * already says the same thing.
 *
 * THE FIVE TONES ARE GITHUB'S FIVE, deliberately: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`,
 * `> [!WARNING]`, `> [!CAUTION]` are a real, rendered syntax in GitHub-flavoured Markdown,
 * so the export is not a lossy approximation — it is the same construct with a different
 * spelling. Adding a sixth tone means inventing a Markdown fallback for it; don't, without
 * deciding what that fallback is first.
 */
import { Node, mergeAttributes } from "@tiptap/core";

/** The tones, in the order the tone picker offers them. `md` is the GFM alert marker the
 *  exporter writes; `label` is what the picker's tooltip says. */
export const CALLOUT_TONES = [
  { id: "info", label: "Note", md: "NOTE" },
  { id: "tip", label: "Tip", md: "TIP" },
  { id: "important", label: "Important", md: "IMPORTANT" },
  { id: "warning", label: "Warning", md: "WARNING" },
  { id: "danger", label: "Caution", md: "CAUTION" },
];

export const CALLOUT_TONE_IDS = CALLOUT_TONES.map((t) => t.id);
export const DEFAULT_CALLOUT_TONE = "info";

const normalizeTone = (t) => (CALLOUT_TONE_IDS.includes(t) ? t : DEFAULT_CALLOUT_TONE);

export const NoteCallout = Node.create({
  name: "noteCallout",
  group: "block",
  // `block+`, not `paragraph+`: a callout that cannot hold a bulleted list is a callout you
  // stop using the moment you have two things to say.
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: DEFAULT_CALLOUT_TONE,
        parseHTML: (el) => normalizeTone(el.getAttribute("data-callout")),
        renderHTML: (attrs) => ({ "data-callout": normalizeTone(attrs.tone) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ class: "planyr-callout" }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      /** Wrap the block the caret is in. `wrapIn` keeps the content, which is the point:
       *  writing a paragraph and then deciding it is a warning must not retype it. */
      setNoteCallout: (tone = DEFAULT_CALLOUT_TONE) => ({ commands }) =>
        commands.wrapIn(this.name, { tone: normalizeTone(tone) }),

      /** Change an existing callout's tone in place. Separate from `setNoteCallout` so the
       *  picker cannot accidentally nest one callout inside another. */
      setNoteCalloutTone: (tone) => ({ commands }) =>
        commands.updateAttributes(this.name, { tone: normalizeTone(tone) }),

      unsetNoteCallout: () => ({ commands }) => commands.lift(this.name),

      toggleNoteCallout: (tone = DEFAULT_CALLOUT_TONE) => ({ editor, commands }) =>
        (editor.isActive(this.name)
          ? commands.lift(this.name)
          : commands.wrapIn(this.name, { tone: normalizeTone(tone) })),
    };
  },
});

export default NoteCallout;
