/* A SELECTED / EDITING NOTES BOX PAINTS NO FILL (NEW-3, owner 2026-10-30).
 * "Clicking a Notes box tinted the whole thing pink. When selected, show only the border and
 * handles." The wash that B421494 / B1555152 added is gone; selected and editing are told apart by
 * border weight alone. Source half — the computed-style proof in a real browser (light, dark, hover,
 * multi-select, a table box, text selection still visible) is
 * ui-audit/verify-notes-spacing-popover-selection.mjs (red on main: 0.08 / 0.16 accent alpha). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const editor = readFileSync("src/workspaces/notes/components/NoteEditor.jsx", "utf8");
const css = editor.slice(editor.indexOf("const EDITOR_CSS"), editor.indexOf("function EditorStyles"));
const rulesFor = (needle) => css.split("\n").filter((l) => l.includes(needle) && l.includes("{") && !l.trim().startsWith("/*"));

describe("Notes box selection never paints a fill", () => {
  it("the selected-box rule sets a border and no background", () => {
    const r = rulesFor('.planyr-anchor[data-selected="1"] {');
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/border-color:\s*var\(--accent-notes\)/);
    expect(r[0]).not.toMatch(/background/);
  });

  it("the editing-box rule is a heavier border and no background", () => {
    const r = rulesFor('.planyr-anchor[data-editing="1"] {');          // the cursor rule shares the selector
    const border = r.find((l) => /border-width/.test(l));
    expect(border).toMatch(/border-width:\s*2px/);
    expect(r.filter((l) => /background/.test(l))).toEqual([]);
  });

  it("no anchor rule keyed on selected / editing / hover / focus paints a background", () => {
    const bad = css.split("\n").filter((l) => /\.planyr-anchor(\[data-(selected|editing)="1"\]|:hover|:focus-within)\s*\{/.test(l) && /background/.test(l));
    expect(bad).toEqual([]);
  });
});
