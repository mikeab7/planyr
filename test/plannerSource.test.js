// B1064 step 1 (NEW-0) — the planner-as-text helper must not rot. A module extracted from SitePlanner.jsx that is missing
// from `plannerSource()` turns every negative source-scan assertion about its code into a vacuous pass; an extracted module
// that imports BACK from SitePlanner.jsx is a circular edge. Both are caught here, by name.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { PLANNER_DIR, PLANNER_MAIN, PLANNER_EXTRACTED, plannerParts, plannerSource } from "./helpers/plannerSource.js";

const MARK = "@planner-extract";
const sourceFilesUnder = (rel) => readdirSync(PLANNER_DIR + rel).filter((f) => /\.(jsx?|mjs)$/.test(f)).map((f) => `${rel}/${f}`);

describe("plannerSource() — the extracted-module registry", () => {
  it("every listed module exists and is marked", () => {
    for (const f of PLANNER_EXTRACTED) {
      expect(existsSync(PLANNER_DIR + f), `${f} is listed in PLANNER_EXTRACTED but is missing`).toBe(true);
      expect(readFileSync(PLANNER_DIR + f, "utf8"), `${f} must carry ${MARK} in its header`).toContain(MARK);
    }
  });

  it("every module marked @planner-extract is listed (an unlisted one is invisible to every source-scan test)", () => {
    const marked = [...sourceFilesUnder("components"), ...sourceFilesUnder("lib")].filter((f) => readFileSync(PLANNER_DIR + f, "utf8").includes(MARK));
    expect(marked.sort()).toEqual([...PLANNER_EXTRACTED].sort());
  });

  it("no extracted module imports back from SitePlanner.jsx (circular)", () => {
    for (const f of PLANNER_EXTRACTED) {
      expect(readFileSync(PLANNER_DIR + f, "utf8"), f).not.toMatch(/from\s+["'][^"']*SitePlanner(\.jsx)?["']/);
    }
  });

  it("the concatenation carries code from every part, main file included, in the documented order", () => {
    const parts = plannerParts();
    expect(parts.map((p) => p.file)).toContain(PLANNER_MAIN);
    const src = plannerSource();
    // one anchor per part — known-present text, so a part that stops being read goes red here
    const anchors = [
      ["lib/plannerShared.js", "export const SURF_RAISED"],
      ["lib/planRenderHelpers.jsx", "export function inlineLabelEls("],
      [PLANNER_MAIN, "export default function SitePlanner("],
      ["components/elementRender.jsx", "export const ElNode = memo("],
      ["components/NumInput.jsx", "export function NumInput("],
      ["components/YieldDrainagePanels.jsx", "export function DrainagePanel("],
    ];
    let last = -1;
    for (const [file, needle] of anchors) {
      const at = src.indexOf(needle);
      expect(at, `${file}: ${needle}`).toBeGreaterThan(-1);
      expect(at, `${file} is out of order`).toBeGreaterThan(last);
      last = at;
    }
  });
});
