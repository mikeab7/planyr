/* B1171504 — the triage-report half of ui-audit/visual-regression.mjs. A CI-authored baseline
 * removes the moment a person used to eyeball a diff before trusting `--approve`; buildTriageMarkdown
 * is what carries that judgment to the PR instead — every surface/theme/viewport an approve run
 * touched, changed or not, with its diff magnitude. Pure formatting, no browser/filesystem, so it's
 * unit-tested directly rather than only exercised end-to-end.
 */
import { describe, it, expect } from "vitest";
import { buildTriageMarkdown } from "../ui-audit/visual-regression.mjs";

describe("buildTriageMarkdown — the CI-authored-baseline triage artifact", () => {
  it("lists every row, changed and unchanged alike, never silently dropping one", () => {
    const md = buildTriageMarkdown(
      [
        { surfaceId: "map-landing", theme: "light", viewportId: "desktop", changed: false },
        { surfaceId: "map-landing", theme: "dark", viewportId: "desktop", changed: true, diffMagnitude: { pct: 1.2345, maxDelta: 40 } },
      ],
      "widened the help/report control",
    );
    expect(md).toContain("map-landing");
    expect(md).toContain("unchanged");
    expect(md.match(/\| map-landing \|/g)).toHaveLength(2);
  });

  it("reports a real diff magnitude in percent and max channel delta", () => {
    const md = buildTriageMarkdown([
      { surfaceId: "library", theme: "light", viewportId: "phone", changed: true, diffMagnitude: { pct: 2.71, maxDelta: 233 } },
    ]);
    expect(md).toMatch(/2\.7100%/);
    expect(md).toMatch(/233\/255/);
  });

  it("marks a brand-new baseline distinctly from a changed one (nothing to diff against)", () => {
    const md = buildTriageMarkdown([
      { surfaceId: "library", theme: "light", viewportId: "desktop", changed: true, isNewBaseline: true },
    ]);
    expect(md).toMatch(/new baseline/i);
    expect(md).not.toMatch(/%/);
  });

  it("flags a dimension change distinctly from an ordinary pixel diff", () => {
    const md = buildTriageMarkdown([
      {
        surfaceId: "site-planner-header", theme: "dark", viewportId: "desktop", changed: true,
        diffMagnitude: { dimensionChanged: true, priorSize: "1440x900", newSize: "1440x901" },
      },
    ]);
    expect(md).toMatch(/dimensions changed/i);
    expect(md).toContain("1440x900");
    expect(md).toContain("1440x901");
  });

  it("never throws on a missing/errored diffMagnitude — reports it plainly instead", () => {
    const md = buildTriageMarkdown([
      { surfaceId: "map-landing", theme: "light", viewportId: "desktop", changed: true, diffMagnitude: null },
      { surfaceId: "map-landing", theme: "dark", viewportId: "desktop", changed: true, diffMagnitude: { error: "size mismatch" } },
    ]);
    expect(md).toMatch(/magnitude unavailable/);
    expect(md).toMatch(/could not diff/);
  });

  it("includes the reason string given, and says so plainly when none is given", () => {
    const withReason = buildTriageMarkdown([], "a real reason");
    expect(withReason).toContain("a real reason");
    const noReason = buildTriageMarkdown([]);
    expect(noReason).toMatch(/\(none\)/);
  });
});
