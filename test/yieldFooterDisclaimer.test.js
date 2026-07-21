// B895 — the Yield-panel provenance-readability refactor consolidated ~7 inline
// "screening only — confirm with your engineer / reviewing authority" variants into
// ONE persistent footer (YieldFooterDisclaimer.jsx). This guards the two halves of
// that promise: the standardized sentence is defined exactly once, and the panel
// mounts it exactly once — so a future edit can't silently reintroduce a duplicate
// or an inline repeat. Source-scan style (this repo's vitest config is DOM-free), the
// same pattern as test/drainageNoteLength.test.js.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DISCLAIMER = "Screening estimates for deal-stage decisions, not a substitute for your engineer or the reviewing agency.";

const componentSrc = readFileSync(
  fileURLToPath(new URL("../src/workspaces/site-planner/components/YieldFooterDisclaimer.jsx", import.meta.url)),
  "utf8",
);
const plannerSrc = readFileSync(
  fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)),
  "utf8",
);

function countOccurrences(haystack, needle) {
  let count = 0, idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
  return count;
}

describe("B895 — the Yield-panel generic disclaimer renders exactly once", () => {
  it("YieldFooterDisclaimer.jsx defines the standardized disclaimer sentence exactly once", () => {
    expect(countOccurrences(componentSrc, DISCLAIMER)).toBe(1);
  });

  it("SitePlanner.jsx mounts <YieldFooterDisclaimer /> exactly once — the ONE persistent footer", () => {
    expect(countOccurrences(plannerSrc, "<YieldFooterDisclaimer")).toBe(1);
  });

  it("the disclaimer sentence itself never appears inline elsewhere in the Yield panel / pond inspector / cost takeoff", () => {
    expect(plannerSrc.includes(DISCLAIMER)).toBe(false);
  });
});
