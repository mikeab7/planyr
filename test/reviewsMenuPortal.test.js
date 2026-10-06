import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// AUTH-SWEEP 2: the Reviews menu lives inside a PriorityToolbar zone that clips overflow, so it must be
// portaled (AnchoredMenu); and Review's window key handler must not cancel Enter/Space on a focused button.
describe("Review chrome regressions (AUTH-SWEEP 2)", () => {
  const bar = readFileSync("src/workspaces/doc-review/components/ReviewsBar.jsx", "utf8");
  const doc = readFileSync("src/workspaces/doc-review/DocReview.jsx", "utf8");
  it("Reviews menu renders through AnchoredMenu, not an absolutely positioned child of the clipped toolbar", () => {
    expect(bar).toMatch(/<AnchoredMenu\b/);
    expect(bar).not.toMatch(/position: "absolute", top: "calc\(100% \+ 6px\)"/);
  });
  it("window keydown leaves Enter/Space to a focused button/link/menu row", () => {
    expect(doc).toMatch(/closest\("button, a\[href\], summary, \[role='button'\], \[role='menuitem'\]"\)/);
  });
});
