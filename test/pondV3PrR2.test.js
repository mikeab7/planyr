// v3 CRITERIA-TRUTH milestone, PR-R2 — NEW-20(a): the flood-data re-check gives feedback.
// A fetch in flight (live ↻ or the B832 auto-revalidation) must never look like nothing
// happened: the row reads "checking…", the ↻ spins and disables. Source-scan (vitest DOM-free).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("NEW-20(a) — the re-check affordances show a BUSY state", () => {
  it("derives a single drainRefreshing flag from a live-busy OR auto-revalidating fetch", () => {
    expect(src).toContain('const drainRefreshing = !!drainage && (drainage.status === "busy" || drainage.autoRefreshing);');
  });
  it("the header line reads 'checking…' and its ↻ spins + disables while refreshing", () => {
    expect(src).toContain('{drainRefreshing ? "Flood data: checking…" : floodAgeMs != null ? `Flood data ${formatAge(floodAgeMs)} ago` : "Flood data: not checked"}');
    expect(src).toContain('onClick={drainRefreshing ? undefined : drainage.onCheck} disabled={drainRefreshing} aria-busy={drainRefreshing}');
    expect(src).toContain('animation: drainRefreshing ? "spin 0.9s linear infinite" : undefined');
  });
  it("the buildability strip row reads 'checking…' and its ↻ spins + disables while refreshing", () => {
    expect(src).toContain('{v.recheck && drainRefreshing ? "checking…" : v.sentence}');
    expect(src).toContain('onClick={drainRefreshing ? undefined : drainage.onCheck} disabled={drainRefreshing} aria-busy={drainRefreshing} aria-label="Re-check flood data"');
  });
  it("uses the existing keyframes spin (no new animation needed)", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");
    expect(css).toContain("@keyframes spin");
  });
});
