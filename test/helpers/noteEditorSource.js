/* THE NOTE EDITOR AS TEXT — one reader for every source-scan test that asks "does the Notes editor contain X".
 *
 * Same idea as test/helpers/plannerSource.js. NoteEditor.jsx is being split (audit batch L1): the editor stylesheet, the
 * find / zoom / page-setup bars, the paste-options flyout, the mini toolbar and the document menu now live in sibling
 * modules. A test that kept reading only NoteEditor.jsx would pass VACUOUSLY on a negative assertion once the code it
 * guards moved out. `noteEditorSource()` returns the main file plus every module extracted from it, so an assertion sees
 * the same text it saw before the move. A new extraction costs one line in NOTE_EDITOR_EXTRACTED.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const NOTE_EDITOR_DIR = fileURLToPath(new URL("../../src/workspaces/notes/components/", import.meta.url));
export const NOTE_EDITOR_MAIN = "NoteEditor.jsx";
export const NOTE_EDITOR_EXTRACTED = ["noteEditorCss.js", "NoteEditorBars.jsx", "PasteOptions.jsx", "MiniBar.jsx", "DocMenu.jsx", "useNoteE2EHook.js"];

const read = (rel) => readFileSync(NOTE_EDITOR_DIR + rel, "utf8");

/** [{ file, text }] — extracted modules first (they sat above the component), then the main file. */
export function noteEditorParts() {
  return [...NOTE_EDITOR_EXTRACTED, NOTE_EDITOR_MAIN].map((file) => ({ file, text: read(file) }));
}

/** The editor's source as ONE string (see the header). */
export function noteEditorSource() {
  return noteEditorParts().map((p) => p.text).join("\n");
}
