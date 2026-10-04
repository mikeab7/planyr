# doc-review/docEditor — Word + text files in Review (NEW-1, B2022928)

When a `.docx` / `.doc` / `.txt` is opened in Review (Library row, dashboard card, Upload/Open…, drop, or a
direct `#/markup` link) the Review workspace root shows **`DocEditor.jsx`** (a lazy chunk) instead of the drawing canvas.
No measure/calibrate/takeoff tools exist on these files. **Nothing here may download** — saving hands bytes to
the Review root's `saveDocFile`, which writes to the Library (guard: the source sweep in the docEditorOpenSave suite).

**Key files**
- `docKind.js` — extension → kind (`docx|doc|txt`); eager (DocReview/Library/dashboard import it), tiny.
- `docModel.js` — PURE `loadModel(file)` / `buildSave(...)`; the whole open→bytes round trip, Node-testable. A `.doc` opens through
  the shared files folder's docStructure (headings, bold/italic/underline, lists, tables — pictures become a visible placeholder); if that
  throws, it falls back to the text-only reader WITH a visible warning, never silently.
- `docExtensions.js` — Tiptap extensions (reuses the Notes packages) + Word nodes/marks: `docRaw`/`docRawBlock`/`docImage`
  (opaque pass-through of XML the editor can't model), `trackIns`/`trackDel`/`trackFmt`/`comment` marks, paragraph facts
  (`pFmt` = a paragraph's tracked formatting change; table nodes carry `gridChange`).
- `trackChanges.js` — Track Changes without a plugin: `fixupTracked(tr, state)` lets an edit apply then re-inserts what
  it deleted (marked) and marks what it added; `listChanges` / `acceptChange` / `rejectChange` / `acceptAll` / `rejectAll`.
  **Formatting changes** (Word's "Formatted: …": run `trackFmt` mark, paragraph `pFmt`, and table / row / cell / grid / section /
  paragraph-mark records held in node attrs) are `kind: "fmt"` entries in the same list: Accept drops the record, Reject restores
  the OLD properties (kept verbatim; engine: fmtChange in the shared docx folder). The document's final section lives in `meta.sectPr`
  outside the page, so `DocEditor.jsx` resolves that one itself. Rejecting a list-membership change restores the rest and says
  it left the list as it was (`tr.getMeta("fmtPartial")`). Wired in `DocEditor.jsx` by wrapping `view.props.dispatchTransaction`; bypass = `tr.setMeta(BYPASS, true)`.
- `txtModel.js` — byte-faithful .txt (BOM, UTF-16, CRLF, trailing newline preserved).
- `DocEditor.jsx` / `docEditorCss.js` — toolbar, find/replace, Review pane (changes + comments), phone layout.
- The .docx read/write engine lives in the shared files folder's docx/ subfolder (reader, writer, xml, package, fmtChange, rprMarks): saving rewrites ONLY
  word/document.xml + the comment parts (+ numbering when a new list needs it); every other package part is carried
  through untouched. Tests: the docEditorDocx and docEditorOpenSave suites under test/; browser run: the
  verify-doc-editor harness under ui-audit/.

**Second-reader proof (V1448016):** the verify-docx-libreoffice harness under ui-audit/ (also run by the docxLibreOffice suite under test/, skipped with a
printed message when LibreOffice is absent) saves a fixture with the real writer, has LibreOffice read it back and asserts every
tracked change / comment / reply and its author, then validates the XML parts against the ISO 29500 schemas. It is LibreOffice,
NOT Microsoft Word — opening in Word itself stays on V1448016.

**Versions:** every Save stores the new bytes under a NEW source id (a new Drive key) and keeps the previous
source in the review record (`sources[1..]`) — bytes are never overwritten and `purgeReview` cleans them all.
**Version history (B2034128):** see the version module and the history sheet in the folder pointer one level up; the Review root
opens an earlier version read-only (`file.readOnly` → this editor hides every editing tool), Restore, Save a copy.
