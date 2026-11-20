#!/usr/bin/env node
/* notes-editor-loc — how many lines of PLANYR-OWNED EDITOR CODE the Notes module holds (NEW-1, 2026-11-05).
 *
 * "Planyr-owned editor code" = the files that implement or drive the rich-text box editor: the extensions and node views, the
 * paste pipeline, the table helpers, the formatting toolbar and the editor component. NOT counted: the page tree / storage /
 * cloud sync / conflict review / version history / templates / quick open / print+Markdown export — those are not an editor
 * and no upstream editor package replaces them. The list is `EDITOR_FILES` below and is the definition docs/notes-editor.md §A
 * reports against; add a file here in the same commit that adds an editor file.
 *
 *   node scripts/notes-editor-loc.mjs                 → the count for the working tree
 *   node scripts/notes-editor-loc.mjs --base <ref>    → the same count at a git ref (e.g. origin/main), and the difference */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const LIB = "src/workspaces/notes/lib/";
const COMP = "src/workspaces/notes/components/";
export const EDITOR_FILES = [
  `${COMP}NoteEditor.jsx`, `${COMP}NoteToolbar.jsx`, `${COMP}NoteSlashMenu.jsx`, `${COMP}PasteIcons.jsx`,
  ...[
    "notesExtensions", "notesAnchorNode", "notesAnchorPrune", "notesArrows", "notesAttachNode", "notesBlankPaper", "notesBlockKeys",
    "notesBoxResize", "notesCalloutNode", "notesEnterInherit", "notesFakeBullets", "notesFontFamily", "notesFormatPalette",
    "notesImageIntake", "notesImageNode", "notesIndentLevel", "notesKeyScope", "notesListIndent", "notesMarquee", "notesMixedSelection",
    "notesOfficeLists", "notesOfficeStyle", "notesPageHeight", "notesPageWidth", "notesPasteInherit", "notesPasteModes", "notesPastePlain",
    "notesResolvedValue", "notesSearchHighlight", "notesSlashMenu", "notesSpacing", "notesTabKey", "notesTableClipboard",
    "notesTableColumns", "notesTableFill", "notesTableMultiSelect", "notesTablePaste", "notesTablePicture", "notesTableRowHeight",
    "notesTableRowStyle", "notesTableToText", "notesTableWidth", "notesToggleNode", "notesToolbarDiag", "notesViewport",
  ].map((n) => `${LIB}${n}.js`),
];

const lines = (s) => (s.length ? s.split("\n").length - (s.endsWith("\n") ? 1 : 0) : 0);
function count(read) {
  let total = 0;
  const per = {};
  for (const f of EDITOR_FILES) {
    let text = "";
    try { text = read(f); } catch { /* the file does not exist at that ref */ }
    per[f] = lines(text);
    total += per[f];
  }
  return { total, per };
}

const args = process.argv.slice(2);
const now = count((f) => fs.readFileSync(f, "utf8"));
console.log(`working tree: ${now.total} lines in ${EDITOR_FILES.length} editor files`);
const bi = args.indexOf("--base");
if (bi >= 0) {
  const ref = args[bi + 1];
  const base = count((f) => execFileSync("git", ["show", `${ref}:${f}`], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
  console.log(`${ref}: ${base.total} lines`);
  console.log(`difference: ${now.total - base.total >= 0 ? "+" : ""}${now.total - base.total}`);
  for (const f of EDITOR_FILES) if (now.per[f] !== base.per[f]) console.log(`  ${String(now.per[f] - base.per[f]).padStart(5)}  ${f}  (${base.per[f]} → ${now.per[f]})`);
}
