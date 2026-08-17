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
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { DEFAULT_DENSITY, blockFontSize, densityFor, spacingFromElement, spacingStyle } from "./notesSpacing.js";
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
import NoteAttachment from "./notesAttachNode.js";
import NoteCallout from "./notesCalloutNode.js";
import NoteToggle, { NoteToggleTitle } from "./notesToggleNode.js";
import NoteAnchor from "./notesAnchorNode.js";
import NoteSlashMenu from "./notesSlashMenu.js";
import NoteSketch from "./notesSketchNode.js";
import NoteTabKey from "./notesTabKey.js";
import NoteListIndent from "./notesListIndent.js";
import { enterInheritHandler } from "./notesEnterInherit.js";
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

/** ⛔ WRITE EACH BLOCK'S OWN SIZE FROM ITS RUNS (NEW-SPACING-2). Returns whether anything
 *  changed, which is what makes it safe to run on every transaction — see the plugin below.
 *
 *  The DECISION is `blockFontSize` in lib/notesSpacing.js and is unit-tested there; this is only
 *  the walk that feeds it and applies the answer. A block whose runs disagree, or which holds
 *  anything that is not text, gets `null` — the default strut, with inline layout deciding the
 *  height, which is exactly right for a line carrying two sizes. */
function deriveBlockSizes(doc, tr) {
  let touched = false;
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
    /* ⛔ AN EMPTY BLOCK KEEPS THE SIZE IT WAS GIVEN (NEW-ENTER-INHERIT), AND THIS IS WHAT MADE
     * THE ENTER FIX LOOK BROKEN WHILE IT WAS ALREADY WORKING. A brand-new line has no runs at
     * all, `blockFontSize([])` is null by its own rule, and this walk then wrote that null
     * straight over the size the split had just inherited — so the carry was performed and
     * immediately undone, one transaction later, by a plugin that had no idea a split had
     * happened. An empty block has nothing to disagree with; its declared size is a statement
     * about what the NEXT character will be, and it is also what gives the caret its height
     * before anything is typed. Leave it alone. */
    if (node.content.size === 0) return true;
    const runs = [];
    node.forEach((child) => {
      /* ⛔ A LINE BREAK IS NOT AN UNSIZED RUN — IT IS NOT A RUN AT ALL (NEW-ENTER-INHERIT).
       * `hardBreak` used to be pushed as `{fontSize: null}`, which `blockFontSize` reads as "a
       * run with no size", which means "the runs disagree", which drops the block's size to
       * null. So pressing SHIFT+ENTER in a sized paragraph silently reset that paragraph's line
       * box to the default height while every word in it kept its size — measured, 22 → null,
       * and it reads as a spacing bug rather than the formatting bug it is. A break carries no
       * text and no size, so it has no opinion to disagree with. */
      if (child.type.name === "hardBreak") return;
      if (!child.isText) { runs.push({ fontSize: null }); return; }
      const mark = child.marks.find((m) => m.type.name === "textStyle");
      runs.push({ fontSize: mark?.attrs?.fontSize || null });
    });
    const next = blockFontSize(runs);
    if ((node.attrs.fontSize || null) === next) return true;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, fontSize: next });
    touched = true;
    return true;
  });
  return touched;
}

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

  // ⛔ HOW FAR APART THE LINES ARE (NEW-7). A BLOCK property, extending paragraph and heading
  // rather than riding textStyle — half a line cannot be one-and-a-half spaced. The value is
  // written into the markup, so it saves, syncs and PRINTS with no second stylesheet; the
  // shape of that markup is decided once, in lib/notesSpacing.js.
  Extension.create({
    name: "noteSpacing",

    /* ⛔ THE DERIVATION RUNS FOR EVERY DOCUMENT, NOT ONLY FOR TEXT TYPED TODAY
     * (NEW-SPACING-2). Doing it only in the toolbar command would fix the next paragraph he
     * makes smaller and leave every paragraph he ALREADY made smaller exactly as tall — which
     * is the note he was looking at when he reported this. So it also runs as an
     * `appendTransaction`: any change to the document re-derives the block sizes.
     *
     * ⛔ IT IS SAFE TO RUN ON EVERY TRANSACTION because it is IDEMPOTENT — `deriveBlockSizes`
     * returns false when every block already agrees with its runs, and returning `null` from
     * `appendTransaction` ends the round. A rule that rewrote something every pass would loop
     * forever, so the "did anything change" answer is the loop guard, not a counter. */
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey("noteSpacingBlockSize"),
        appendTransaction: (trs, _old, newState) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const tr = newState.tr;
          if (!deriveBlockSizes(newState.doc, tr)) return null;
          /* ⛔ AND IT MUST HAND THE STORED MARKS BACK (NEW-ENTER-INHERIT). ProseMirror clears
           * `storedMarks` on any transaction that does not restate them, so this housekeeping
           * pass was silently stripping the marks a split had just carried to the new line — the
           * user pressed Enter in bold 22px text and typed in plain default text, with nothing
           * anywhere reporting a mark had been dropped. A pass that only means to adjust a
           * block attribute must not also decide what the next keystroke looks like. */
          tr.setStoredMarks(newState.storedMarks);
          return tr;
        },
      })];
    },

    addGlobalAttributes() {
      return [{
        /* ⛔ THE NOTE'S DENSITY LIVES ON THE **DOCUMENT**, NOT ON THE TREE (NEW-SPACING-3).
         * That is the whole reason this was cheap and safe to add: the module's own stated
         * principle is that anything riding the document is saved, synced, printed and exported
         * for free. Putting it on the page node instead would have meant the tree schema,
         * `migratePageNode` and the cloud merge — and TODAY's other defect (B342996 ×3) was
         * exactly that: a new per-node field `migratePageNode` silently destroyed on every read.
         * A document attribute touches none of it. */
        types: ["doc"],
        attributes: {
          density: {
            default: DEFAULT_DENSITY,
            // The doc node is never serialised to HTML by name, so there is nothing to render;
            // the editor reads it and sets two custom properties, and the print sheet is handed
            // the same id. `parseHTML` keeps a pasted document from inventing one.
            parseHTML: () => DEFAULT_DENSITY,
            renderHTML: () => ({}),
          },
        },
      }, {
        types: ["paragraph", "heading"],
        attributes: {
          lineHeight: { default: null, parseHTML: (el) => spacingFromElement(el).lineHeight, renderHTML: () => ({}) },
          /* ⛔ THE BLOCK'S OWN SIZE (NEW-SPACING-2). A size set on the whole paragraph lands
           * HERE rather than only on an inline span, because a block's line box can never be
           * shorter than its own font's strut — measured: every word set to 11px still rendered
           * in the 24.75px row the 15px paragraph above it used. See lib/notesSpacing.js. */
          fontSize: { default: null, parseHTML: (el) => spacingFromElement(el).fontSize, renderHTML: () => ({}) },
          spaceBefore: { default: null, parseHTML: (el) => spacingFromElement(el).spaceBefore, renderHTML: () => ({}) },
          spaceAfter: {
            default: null,
            parseHTML: (el) => spacingFromElement(el).spaceAfter,
            // ⛔ ONE attribute writes the whole style string. Three that each wrote `style`
            // would overwrite one another — the last one rendered would win and the other two
            // would vanish, which is the sort of bug that only shows up on the third setting.
            renderHTML: (attrs) => {
              const style = spacingStyle(attrs);
              return style ? { style } : {};
            },
          },
        },
      }];
    },
    addCommands() {
      return {
        setNoteSpacing: (patch) => ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          let touched = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
            touched = true;
            return true;
          });
          if (touched && dispatch) dispatch(tr);
          return touched;
        },

        /* ⛔ SET THE SIZE ON THE BLOCK TOO, WHEN THE BLOCK ENTIRELY AGREES (NEW-SPACING-2).
         *
         * Called after the inline mark has been applied, so the document already says what the
         * runs are; this reads them back and, when every run in a block names the SAME size,
         * writes that size onto the block. That is what makes the strut follow the content and
         * a smaller paragraph a genuinely shorter row.
         *
         * ⛔ IT IS DERIVED, NEVER GUESSED — the decision is `blockFontSize`, which returns null
         * for a block whose runs disagree or whose runs are not all sized. So a MIXED line keeps
         * the default strut and takes its height from the tallest run, which is ordinary inline
         * layout and exactly right; and clearing the size clears the block attribute with it. */
        /* ⛔ ONE ACTION FOR A WHOLE NOTE (NEW-SPACING-3). His goal, in his words, is *"save space
         * and see more information on screen"*, and a per-paragraph control makes him do that a
         * line at a time. `setDocAttribute` is a real ProseMirror step, so this is undoable,
         * rides the document into storage and sync, and needs no schema anywhere else. */
        setNoteDensity: (id) => ({ state, tr, dispatch }) => {
          const next = densityFor(id).id;
          if (state.doc.attrs.density === next) return false;
          if (dispatch) dispatch(tr.setDocAttribute("density", next));
          return true;
        },

        syncBlockFontSize: () => ({ state, tr, dispatch }) => {
          const touched = deriveBlockSizes(state.doc, tr);
          if (touched && dispatch) dispatch(tr);
          return touched;
        },
      };
    },
  }),

  TaskList,
  TaskItem.configure({ nested: true }),

  // ⛔ TAB CHANGES THE LEVEL OF THE CURRENT ITEM; IT NEVER CREATES A NODE THE USER DID NOT
  // TYPE. Registered ABOVE the list keymap on purpose — real nesting still wins wherever it
  // can act, and this only reaches the presses it declines (the first item of a list). See
  // lib/notesListIndent.js for the whole rule and the option that was refused.
  NoteListIndent,

  /* ⛔ A NEW LINE CONTINUES THE ONE ABOVE IT (NEW-ENTER-INHERIT). Registered ABOVE the list
   * keymap at priority 200, the same rung as the indent rule, and for the same reason: it has to
   * see the press BEFORE `splitListItem` and `splitBlock` in order to run them itself and repair
   * their result in the SAME transaction. It DECLINES everywhere it is not needed — a range
   * split, a caret that is not at the end of its block, an EMPTY block (which is the "leave the
   * list" case the owner named), and a code block — so everything it does not claim behaves
   * exactly as it did. The whole decision table is pure and lives in lib/notesEnterInherit.js. */
  Extension.create({
    name: "noteEnterInherit",
    priority: 200,
    addKeyboardShortcuts() {
      return { Enter: () => enterInheritHandler({ editor: this.editor }) };
    },
  }),

  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),

  // A picture, held by ID. The bytes are in IndexedDB — see lib/notesImageNode.js.
  NoteImage,

  // ANY OTHER FILE, held the same way (NEW-5). It rides the picture tier rather than a
  // second one — same store, same bucket, same purge cascade — and its intake runs at a
  // higher priority so a mixed drop is routed in one place instead of raced. See
  // lib/notesAttachNode.js.
  NoteAttachment,

  // A coloured note block and a section that folds away (NEW-7). Both are ordinary schema
  // nodes, which is what makes them persist, sync, print and export with no new plumbing;
  // both carry a NAME rather than a colour, so the screen, paper and Markdown each draw
  // them their own way. See lib/notesCalloutNode.js and lib/notesToggleNode.js.
  NoteCallout,
  NoteToggleTitle,
  NoteToggle,
  // A block that stays where it was put (NEW-2). Out of flow, so the rest of the document
  // does not know it exists; its position is two numbers ON THE NODE, which is what makes it
  // survive a reload, a sync and the PDF without a second store to keep in step.
  NoteAnchor,

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

  // Type `/` at the start of a block (or after a space) and name what you want (NEW-1).
  // Registered ABOVE the default keymap so Enter picks the highlighted item instead of
  // splitting the paragraph — and it fires on a NARROW trigger by design, so `and/or` and
  // a pasted URL are untouched. See lib/notesSlashMenu.js.
  NoteSlashMenu,

  Placeholder.configure({ placeholder: NOTE_PLACEHOLDER }),
];

/** The extension list for ONE live editor. Same set as `NOTE_EXTENSIONS` (which stays the
 *  canonical declaration the schema guard reads), with the two extensions that need to
 *  know WHICH page they are serving re-configured for it.
 *
 *  `imageContext` is a FUNCTION on purpose: the notebook a picture is charged against gains
 *  and loses pages while the editor is open, so a value captured at mount goes stale. */
export function noteExtensions({
  imageContext = null, onSearchMatches = null, onPasted = null, onSlash = null, onSlashRun = null,
} = {}) {
  return NOTE_EXTENSIONS.map((ext) => {
    if (ext.name === "noteImage") return NoteImage.configure({ imageContext });
    if (ext.name === "noteAttachment") return NoteAttachment.configure({ imageContext });
    if (ext.name === "noteSearchHighlight") return NoteSearchHighlight.configure({ onMatches: onSearchMatches });
    if (ext.name === "notePastePlain") return NotePastePlain.configure({ onPasted });
    if (ext.name === "noteSlashMenu") return NoteSlashMenu.configure({ onChange: onSlash, onRun: onSlashRun });
    return ext;
  });
}

/** An empty note's document model — one empty paragraph, which is what the editor would
 *  normalise to anyway. Written explicitly so a never-typed page still round-trips through
 *  storage as a real document rather than as `null`. */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
