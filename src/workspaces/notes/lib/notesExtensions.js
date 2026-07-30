/* notesExtensions — the ONE declaration of what a note may contain.
 *
 * Everything downstream reads its truth from here: the toolbar only offers what this list
 * admits, the Markdown exporter has a case for every node and mark it produces (asserted
 * in test/notesModule.test.js via ProseMirror's own `getSchema`, so adding an extension
 * without teaching the exporter about it fails the build rather than silently exporting a
 * blank), and the document model that persists is exactly this schema's JSON.
 *
 * ⛔ THIS FILE PULLS IN THE EDITOR ENGINE. It must only ever be reached from
 * components/NoteEditor.jsx, which the workspace root loads behind React.lazy — so the
 * notebook tree paints before ~460 KB of engine downloads. test/notesModule.test.js
 * source-scans the workspace and fails if anything on the Notes route's static path
 * imports `@tiptap/*` directly.
 *
 * WHY A LIBRARY AT ALL, per the repo's dependency rule (CLAUDE.md → "Dependency notes").
 * A rich-text engine is not a contenteditable div. Selection across nested lists and table
 * cells, undo over compound transactions, Word/Outlook paste normalisation, and a
 * serialisable document model are a multi-month build with a permanent bug tail — and the
 * owner's ask was explicitly functionality-first ("all the same formatting features as
 * Word and OneNote… tables too"). Tiptap is headless: it ships the engine and NO styling
 * or chrome, which is what lets every visible surface here be hand-rolled on Planyr theme
 * tokens. All packages are MIT, all are bundled (nothing is fetched from a CDN at runtime),
 * and the whole set rides the lazy editor chunk, never the initial bundle.
 *
 * We hand-roll the entire UI. We never hand-roll the engine.
 */
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { TableKit } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";

/** Headings stop at 4. A note is a document, not a spec: levels 5–6 are indistinguishable
 *  from body text at reading size and only add choices to the block-style menu. */
export const HEADING_LEVELS = [1, 2, 3, 4];

export const NOTE_EXTENSIONS = [
  // Document · paragraph · text · bold · italic · strike · code · codeBlock · heading ·
  // blockquote · bullet/ordered lists · hardBreak · horizontalRule · underline · link ·
  // undo/redo · drop+gap cursors · list keymap · trailing node.
  StarterKit.configure({
    heading: { levels: HEADING_LEVELS },
    // Clicking a link while editing should place the caret, not navigate away mid-sentence.
    link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } },
  }),

  // textStyle + color + fontFamily + fontSize. `backgroundColor` and `lineHeight` are
  // switched OFF deliberately: highlight already owns background (with its own multicolor
  // swatch), and neither has a toolbar control, so admitting them would put constructs into
  // the schema that the exporter would have to guess at.
  TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),

  // Resizable columns — dragging a column edge is the first thing anyone tries.
  TableKit.configure({ table: { resizable: true, allowTableNodeSelection: true } }),

  TaskList,
  TaskItem.configure({ nested: true }),

  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
];

/** An empty note's document model — one empty paragraph, which is what the editor would
 *  normalise to anyway. Written explicitly so a never-typed page still round-trips through
 *  storage as a real document rather than as `null`. */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
