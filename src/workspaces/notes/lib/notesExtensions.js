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
// `@tiptap/extensions` is now an EXPLICIT dependency rather than a transitive one: this file
// imports from it directly, and a direct import of a package you have not declared is a
// version you do not control (per the repo's dependency rule). It adds no new bytes — it was
// already installed as StarterKit's own dependency, and it rides the lazy editor chunk.
import { Placeholder } from "@tiptap/extensions";
import NoteImage from "./notesImageNode.js";
import NoteSketch from "./notesSketchNode.js";
import NoteTabKey from "./notesTabKey.js";
import NotePastePlain from "./notesPastePlain.js";
import NoteBlockKeys from "./notesBlockKeys.js";
import NoteSearchHighlight from "./notesSearchHighlight.js";

/** Headings stop at 4. A note is a document, not a spec: levels 5–6 are indistinguishable
 *  from body text at reading size and only add choices to the block-style menu. */
export const HEADING_LEVELS = [1, 2, 3, 4];

/** What an empty page says (B1313). A new page used to be a blank white void with no
 *  starting cue at all. AUDIT-FIRST correction to the report that raised this: the CSS rule
 *  for `p.is-editor-empty::before` was NOT already present either — neither half of the
 *  placeholder existed, so this landed as the extension AND its style rule (in
 *  components/NoteEditor.jsx's EDITOR_CSS), together, in one commit. One short line: a
 *  prompt is a nudge, not an instruction manual. */
export const NOTE_PLACEHOLDER = "Start typing — or paste a picture straight in.";

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

  // A picture, held by ID. The bytes are in IndexedDB — see lib/notesImageNode.js.
  NoteImage,

  // SKETCH MODE: a chart drawn from an indented outline. It is a NODE IN THIS SCHEMA rather
  // than a canvas store bolted alongside, and that is what makes it persist, sync, print and
  // export with no new plumbing anywhere — see lib/notesSketchNode.js for the full argument.
  NoteSketch,

  // Presentation-only search marking. It writes nothing into the document.
  NoteSearchHighlight,

  // Tab belongs to the DOCUMENT while the caret is in it (B1392). Registered at a low
  // priority ON PURPOSE, so the table's and the list's own Tab handlers are asked first —
  // see lib/notesTabKey.js for which cases each of them already claimed and which ones were
  // falling through to Chrome's toolbar.
  NoteTabKey,

  // PASTE JUST THE TEXT (B36051). It WATCHES the paste rather than intercepting it — the
  // default Ctrl+V is deliberately unchanged — so the "Keep text only" option can be offered
  // afterwards, the way Word's is. See lib/notesPastePlain.js.
  NotePastePlain,

  // Backspace at the START of a block undoes a formatting difference before it restructures
  // anything (B36051). Registered ABOVE the default keymap so it is asked before joinBackward
  // — see lib/notesBlockKeys.js for the whole-chunk-moves report it closes.
  NoteBlockKeys,

  Placeholder.configure({ placeholder: NOTE_PLACEHOLDER }),
];

/** The extension list for ONE live editor. Same set as `NOTE_EXTENSIONS` (which stays the
 *  canonical declaration the schema guard reads), with the two extensions that need to
 *  know WHICH page they are serving re-configured for it.
 *
 *  `imageContext` is a FUNCTION on purpose: the notebook a picture is charged against gains
 *  and loses pages while the editor is open, so a value captured at mount goes stale. */
export function noteExtensions({ imageContext = null, onSearchMatches = null, onPasted = null } = {}) {
  return NOTE_EXTENSIONS.map((ext) => {
    if (ext.name === "noteImage") return NoteImage.configure({ imageContext });
    if (ext.name === "noteSearchHighlight") return NoteSearchHighlight.configure({ onMatches: onSearchMatches });
    if (ext.name === "notePastePlain") return NotePastePlain.configure({ onPasted });
    return ext;
  });
}

/** An empty note's document model — one empty paragraph, which is what the editor would
 *  normalise to anyway. Written explicitly so a never-typed page still round-trips through
 *  storage as a real document rather than as `null`. */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
