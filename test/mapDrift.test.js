/* MAP.md drift guard (B637). Fails CI if the committed repo-root MAP.md's file/export inventory has
 * drifted from a fresh scan of the source tree, or if any file is still `TODO — describe`. Regenerate
 * with `node scripts/build-map.mjs` in the same commit as any file add/remove/rename or export change.
 * Mirrors test/docPointers.test.js → ui-audit/doc-pointer-audit.mjs (import the audit fn; assert clean). */
import { describe, it, expect } from "vitest";
import { auditMap } from "../scripts/build-map.mjs";

describe("MAP.md stays in sync with the source tree", () => {
  it("no inventory drift and no undescribed files", () => {
    const { ok, problems } = auditMap();
    expect(ok, "\n" + problems.join("\n") + "\n").toBe(true);
  });
});
