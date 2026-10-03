# doc-review/docEditor — Word + text files in Review (NEW-1, B2022928)

When a `.docx` / `.doc` / `.txt` is opened in Review (Library row, dashboard card, Upload/Open…, drop, or a
direct `#/markup` link) the Review workspace root shows **`DocEditor.jsx`** (a lazy chunk) instead of the drawing canvas.
No measure/calibrate/takeoff tools exist on these files. **Nothing here may download** — saving hands bytes to
the Review root's `saveDocFile`, which writes to the Library (guard: the source sweep in the docEditorOpenSave suite).

**Key files**
- `docKind.js` — extension → kind (`docx|doc|txt`); eager (DocReview/Library/dashboard import it), tiny.
- `docModel.js` — PURE `loadModel(file)` / `buildSave(...)`; the whole open→bytes round trip, Node-testable.
- `docExtensions.js` — Tiptap extensions (reuses the Notes packages) + Word nodes/marks: `docRaw`/`docRawBlock`/`docImage`
  (opaque pass-through of XML the editor can't model), `trackIns`/`trackDel`/`comment` marks, paragraph facts.
- `trackChanges.js` — Track Changes without a plugin: `fixupTracked(tr, state)` lets an edit apply then re-inserts what
  it deleted (marked) and marks what it added; `listChanges` / `acceptChange` / `rejectChange` / `acceptAll` / `rejectAll`.
  Wired in `DocEditor.jsx` by wrapping `view.props.dispatchTransaction`; bypass = `tr.setMeta(BYPASS, true)`.
- `txtModel.js` — byte-faithful .txt (BOM, UTF-16, CRLF, trailing newline preserved).
- `DocEditor.jsx` / `docEditorCss.js` — toolbar, find/replace, Review pane (changes + comments), phone layout.
- The .docx read/write engine lives in shared/files/docx/ (reader, writer, xml, package): saving rewrites ONLY
  word/document.xml + the comment parts (+ numbering when a new list needs it); every other package part is carried
  through untouched. Tests: the docEditorDocx and docEditorOpenSave suites under test/; browser run: the
  verify-doc-editor harness under ui-audit/.

**Versions:** every Save stores the new bytes under a NEW source id (a new Drive key) and keeps the previous
source in the review record (`sources[1..]`) — bytes are never overwritten and `purgeReview` cleans them all.
