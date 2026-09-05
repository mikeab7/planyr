/* NEW-2 — the React error boundary must report the same module SLUG every other telemetry
 * source uses (Shell.jsx's `w.id`, e.g. "site-planner"), never the human-facing crash-card
 * copy (`label`, e.g. "Site Planyr"). Measured on production client_errors: every non-react
 * source writes the slug, and every source="react" row carried a display name instead
 * ("Site Planyr" 166, "Sequence Planyr" 3, "Review"/"Document Review" 3, "Notes" 6, "Food" 4)
 * — 182 rows no per-module query keyed on the real slug could ever find.
 *
 * `crashModuleSlug` is the pure decision `componentDidCatch` reports through; this suite pins
 * it without mounting a React tree.
 */
import { describe, it, expect } from "vitest";
import { crashModuleSlug } from "../src/app/ErrorBoundary.jsx";

describe("NEW-2 — the crash report's module field is the SLUG, not the display label", () => {
  it("prefers moduleId (the same slug every other telemetry source reports)", () => {
    expect(crashModuleSlug({ moduleId: "site-planner", label: "Site Planyr" })).toBe("site-planner");
    expect(crashModuleSlug({ moduleId: "scheduler", label: "Sequence Planyr" })).toBe("scheduler");
    expect(crashModuleSlug({ moduleId: "doc-review", label: "Review" })).toBe("doc-review");
  });

  it("falls back to label only when a caller hasn't been updated to pass moduleId", () => {
    expect(crashModuleSlug({ label: "Site Planyr" })).toBe("Site Planyr");
  });

  it("never throws or reports undefined on missing/empty props", () => {
    expect(crashModuleSlug({})).toBe(null);
    expect(crashModuleSlug(null)).toBe(null);
    expect(crashModuleSlug(undefined)).toBe(null);
  });
});
