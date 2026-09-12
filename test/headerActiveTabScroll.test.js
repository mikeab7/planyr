/* NEW-3 (B1343202) — "select a tab far along the strip, leave and return; the active tab can sit
 * off-screen." DEDUPE-FIRST: this is the SAME defect B917073 already shipped a fix for (its own
 * `useLayoutEffect` keyed on `[narrow, module]`, scrolling `[aria-current="page"]` into view on
 * mount AND on every module switch, with a horizontal-only, minimum-distance nudge). AUDIT-FIRST:
 * rather than trust the archive note, this suite re-asserts the fix is still present and still
 * wired to the real signal (a module CHANGE, not just a mount) before closing NEW-3 as
 * already-shipped rather than re-implementing it.
 *
 * ⛔ THE REAL PROOF IS A HIT TEST IN A BROWSER — `ui-audit/verify-header-touch-targets.mjs`'s
 * active-tab section switches to a tab past the fold, re-mounts the header, and asserts the
 * active tab's own rect is inside the scrolling row's visible rect, both on first load and after
 * a later module switch. This suite guards the source wiring CI can check without one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const header = readFileSync(join(ROOT, "src/shared/ui/AppHeader.jsx"), "utf8");

describe("the active tab is kept on-screen in Row 2's sideways-scrolling strip (B917073, re-verified)", () => {
  it("re-runs on every module CHANGE, not just on mount", () => {
    expect(header).toContain('}, [narrow, module]);');
  });

  it("finds the active tab by the SAME aria-current the Tab primitive sets, never a positional guess", () => {
    expect(header).toContain('row.querySelector(\'[aria-current="page"]\')');
  });

  it("is a no-op off the phone breakpoint — desktop tabs are never scrolled, they're all visible", () => {
    const fn = header.slice(header.indexOf("// NEW-2 (B917073) — keep the ACTIVE module tab"), header.indexOf("/* Enter/leave."));
    expect(fn).toContain("if (!narrow) return undefined;");
  });

  it("moves the MINIMUM distance rather than always snapping to an edge — an already-visible tab never jumps", () => {
    expect(header).toContain("if (tabRect.left < rowRect.left) row.scrollLeft -= (rowRect.left - tabRect.left);");
    expect(header).toContain("else if (tabRect.right > rowRect.right) row.scrollLeft += (tabRect.right - rowRect.right);");
  });

  it("is horizontal-only — this row never scrolls vertically, so a cross-axis nudge would be a pure side effect", () => {
    const fn = header.slice(header.indexOf("// NEW-2 (B917073) — keep the ACTIVE module tab"), header.indexOf("/* Enter/leave."));
    expect(fn).not.toMatch(/scrollTop/);
  });
});
