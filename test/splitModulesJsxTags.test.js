// Audit batch L: a component moved to its own file must IMPORT every component it renders. eslint's no-undef does not see JSX
// tags, so a forgotten import is a runtime ReferenceError that only a browser run catches (it hid DocMenu's missing MiniBar).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FILES = [
  "src/workspaces/notes/components/NoteEditorBars.jsx", "src/workspaces/notes/components/PasteOptions.jsx",
  "src/workspaces/notes/components/MiniBar.jsx", "src/workspaces/notes/components/DocMenu.jsx",
  "src/workspaces/notes/components/NoteEditor.jsx",
  "src/workspaces/site-planner/components/yieldPanelParts.jsx", "src/workspaces/site-planner/components/drainageBlocks.jsx",
  "src/workspaces/site-planner/components/YieldDrainagePanels.jsx", "src/workspaces/site-planner/MapFinder.jsx",
  "src/workspaces/doc-review/DocReview.jsx",
];
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("split modules render only components they import or define", () => {
  for (const f of FILES) {
    it(f, () => {
      const code = strip(readFileSync(f, "utf8"));
      const tags = [...new Set([...code.matchAll(/<([A-Z]\w*)[\s/>]/g)].map((m) => m[1]))];
      const missing = tags.filter((t) => !new RegExp(`(\\b(?:function|const|let|class)\\s+${t}\\b|\\bimport\\b[^;]*\\b${t}\\b[^;]*from)`).test(code));
      expect(missing).toEqual([]);
    });
  }
});
