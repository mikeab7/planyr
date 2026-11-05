/* NEW-2 (2026-10-30) — the Layers panel stays perfectly still under the pointer. The global button rules put `filter: brightness(.97)` on every hovered button and a 0.5 px
 * `transform` on every pressed one; inside the panel that makes the left group tabs (and the row chevrons) tremble as the pointer crosses them. Source guard — the pixel
 * and rect proofs are ui-audit/measure-layers-panel-hover.mjs (live). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/workspaces/site-planner/components/LayerPanel.jsx", import.meta.url), "utf8");

describe("Layers panel hover/press are colour-only", () => {
  it("the panel root carries the steady class", () => {
    expect(panel).toMatch(/className="layer-panel-steady"\s+data-testid="layer-panel"/);
  });
  it("buttons inside it drop the global hover filter and the press nudge", () => {
    expect(css).toMatch(/\.layer-panel-steady button:hover:not\(:disabled\), \.layer-panel-steady button:active:not\(:disabled\) \{ filter: none; transform: none; \}/);
  });
  it("the replacement hover is a background colour only (no size, border, weight, padding or transform)", () => {
    const rule = css.match(/\.layer-panel-steady \[role="tab"\]\[aria-selected="false"\]:hover:not\(:disabled\),[^{]*\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule[1].trim()).toBe("background-color: var(--hover-ghost) !important;");
  });
  it("the panel never styles :hover with a layout-affecting property in its own file", () => {
    expect(panel).not.toMatch(/onMouseEnter|onMouseLeave|onPointerEnter|onPointerLeave|useHover/);
  });
});
