/* Per-folder CLAUDE.md pointer freshness guard. Fails CI if a `src/**\/CLAUDE.md` pointer
 * names a code file that no longer exists under its folder (renamed/deleted but the pointer
 * wasn't updated). Mirrors test/gisSources.test.js → ui-audit/gis-source-audit.mjs. */
import { describe, it, expect } from "vitest";
import { auditDocPointers, findPointerFiles } from "../ui-audit/doc-pointer-audit.mjs";

describe("per-folder CLAUDE.md pointers stay fresh", () => {
  it("every code-file reference in a pointer still resolves to a real file in its folder", () => {
    const { problems } = auditDocPointers();
    expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
  });

  it("there is at least one per-folder pointer (guard is actually running)", () => {
    expect(findPointerFiles().length).toBeGreaterThan(0);
  });
});
