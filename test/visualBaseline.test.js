/* NEW-1 (visual regression baselines) — the pure half: surface list, tolerance verdicts, and the
 * generated docs/VISUAL-REGRESSION.md content. See ui-audit/lib/visualBaseline.mjs's own header for
 * why the generated doc is built from the approval manifest and never from a live capture's diff
 * numbers (a live diff is not a deterministic function of source, so baking it into a `--check`-gated
 * doc would make the doc-drift gate fail on its own green runs).
 */
import { describe, it, expect } from "vitest";
import {
  SURFACES, THEMES, NOT_COVERED, TOLERANCE,
  surfaceIds, findSurface, baselineFile, evaluateDiff, buildStatusMarkdown,
} from "../ui-audit/lib/visualBaseline.mjs";

describe("SURFACES — the coverage list", () => {
  it("names at least the four minimum surfaces the brief asked for", () => {
    const ids = surfaceIds();
    expect(ids).toContain("map-landing");
    expect(ids).toContain("site-planner-header");
    expect(ids).toContain("site-planner-left-rail");
    expect(ids).toContain("library");
  });
  it("every surface has a non-empty name and note (the doc's coverage statement depends on both)", () => {
    for (const s of SURFACES) {
      expect(s.id).toMatch(/^[a-z-]+$/);
      expect(s.name.length).toBeGreaterThan(3);
      expect(s.note.length).toBeGreaterThan(10);
    }
  });
  it("has no duplicate surface ids", () => {
    expect(new Set(surfaceIds()).size).toBe(SURFACES.length);
  });
  it("declares at least one named not-covered gap (coverage is a sample, not a census, and must say so)", () => {
    expect(NOT_COVERED.length).toBeGreaterThan(0);
    for (const n of NOT_COVERED) expect(n.length).toBeGreaterThan(10);
  });
});

describe("findSurface / baselineFile", () => {
  it("resolves a known surface", () => {
    expect(findSurface("library").name).toMatch(/Library/);
  });
  it("throws, naming the valid ids, on an unknown surface", () => {
    expect(() => findSurface("nope")).toThrow(/unknown surface "nope"/);
    expect(() => findSurface("nope")).toThrow(/library/); // names a real id
  });
  it("builds a stable filename per surface/theme pair", () => {
    expect(baselineFile("library", "light")).toBe("library--light.png");
    expect(baselineFile("library", "dark")).toBe("library--dark.png");
  });
  it("throws on an unknown theme rather than silently building a bogus filename", () => {
    expect(() => baselineFile("library", "sepia")).toThrow(/unknown theme "sepia"/);
  });
  it("throws on an unknown surface before ever constructing a filename", () => {
    expect(() => baselineFile("nope", "light")).toThrow(/unknown surface "nope"/);
  });
});

describe("evaluateDiff — the pass/fail verdict", () => {
  it("passes on null (nothing to compare — trivially identical)", () => {
    const v = evaluateDiff(null);
    expect(v.pass).toBe(true);
    expect(v.reason).toMatch(/identical/);
  });
  it("passes on a stats object with 0 differing pixels", () => {
    const v = evaluateDiff({ differing: 0, pct: 0, maxDelta: 0, bbox: null });
    expect(v.pass).toBe(true);
  });
  it("passes when both pct and maxDelta sit at or under tolerance", () => {
    const tol = { maxDiffPct: 0.02, maxChannelDelta: 8 };
    const v = evaluateDiff({ differing: 3, pct: 0.02, maxDelta: 8, bbox: { x: 1, y: 1, w: 2, h: 2 } }, tol);
    expect(v.pass).toBe(true);
    expect(v.reason).toMatch(/within tolerance/);
  });
  it("fails when pct exceeds tolerance even if maxDelta is fine", () => {
    const tol = { maxDiffPct: 0.02, maxChannelDelta: 8 };
    const v = evaluateDiff({ differing: 100, pct: 0.5, maxDelta: 4, bbox: { x: 0, y: 0, w: 10, h: 10 } }, tol);
    expect(v.pass).toBe(false);
    expect(v.reason).toMatch(/EXCEEDS tolerance/);
    expect(v.reason).toMatch(/0\.5% of pixels differ/);
  });
  it("fails when maxDelta exceeds tolerance even if pct is tiny", () => {
    const tol = { maxDiffPct: 0.02, maxChannelDelta: 8 };
    const v = evaluateDiff({ differing: 1, pct: 0.0001, maxDelta: 255, bbox: { x: 5, y: 5, w: 1, h: 1 } }, tol);
    expect(v.pass).toBe(false);
    expect(v.reason).toMatch(/worst channel delta 255/);
  });
  it("names the changed region's bounding box in a failing reason", () => {
    const tol = { maxDiffPct: 0.02, maxChannelDelta: 8 };
    const v = evaluateDiff({ differing: 50, pct: 1, maxDelta: 40, bbox: { x: 10, y: 20, w: 30, h: 40 } }, tol);
    expect(v.reason).toMatch(/x10,y20 30x40/);
  });
  it("defaults to the module's own TOLERANCE constant when none is passed", () => {
    const justOver = evaluateDiff({ differing: 1, pct: TOLERANCE.maxDiffPct + 1, maxDelta: 1, bbox: { x: 0, y: 0, w: 1, h: 1 } });
    expect(justOver.pass).toBe(false);
  });
});

describe("buildStatusMarkdown — the generated docs/VISUAL-REGRESSION.md content", () => {
  const manifest = {
    tolerance: TOLERANCE,
    surfaces: {
      "map-landing": {
        light: { approvedAt: "2026-09-01", approvedCommit: "abc1234", note: "initial baseline" },
        // dark deliberately missing — exercises the "no baseline yet" row
      },
    },
  };

  it("is a pure function of its inputs — identical output on repeat calls", () => {
    const a = buildStatusMarkdown({ manifest, noiseFloor: "0 differing pixels, 2 runs, 2026-09-01.", addedCiTimeNote: "~12s." });
    const b = buildStatusMarkdown({ manifest, noiseFloor: "0 differing pixels, 2 runs, 2026-09-01.", addedCiTimeNote: "~12s." });
    expect(a).toBe(b);
  });

  it("states coverage AND the named not-covered gaps, the same way docs/UI-INVENTORY.md does", () => {
    const md = buildStatusMarkdown({ manifest, noiseFloor: "0 differing pixels.", addedCiTimeNote: "~12s." });
    for (const s of SURFACES) expect(md).toContain(s.name);
    for (const n of NOT_COVERED) expect(md).toContain(n.slice(0, 30));
  });

  it("renders an approved baseline's commit/date and a missing one as explicitly unbaselined", () => {
    const md = buildStatusMarkdown({ manifest, noiseFloor: "0 differing pixels.", addedCiTimeNote: "~12s." });
    expect(md).toMatch(/2026-09-01.*`abc1234`.*initial baseline/);
    expect(md).toMatch(/_\(no baseline yet\)_/);
  });

  it("prints the tolerance numbers it actually used, not a hardcoded string", () => {
    const custom = { maxDiffPct: 1.5, maxChannelDelta: 99 };
    const md = buildStatusMarkdown({ manifest: { ...manifest, tolerance: custom }, noiseFloor: "x", addedCiTimeNote: "y" });
    expect(md).toContain("1.5%");
    expect(md).toContain("99/255");
  });

  it("carries the noise-floor and added-CI-time notes verbatim", () => {
    const md = buildStatusMarkdown({ manifest, noiseFloor: "MEASURED: 0/8 surfaces differed across 2 runs.", addedCiTimeNote: "measured 11.4s locally." });
    expect(md).toContain("MEASURED: 0/8 surfaces differed across 2 runs.");
    expect(md).toContain("measured 11.4s locally.");
  });

  it("emits one status-table row per surface x theme", () => {
    const md = buildStatusMarkdown({ manifest, noiseFloor: "x", addedCiTimeNote: "y" });
    const rows = md.split("\n").filter((l) => l.startsWith("| "));
    // header + separator are not "| surface |...|---|" style rows we count here since the table
    // header itself also starts with "| " — assert at least SURFACES.length * THEMES.length data rows exist.
    const dataRows = rows.filter((l) => SURFACES.some((s) => l.includes(s.name)));
    expect(dataRows.length).toBe(SURFACES.length * THEMES.length);
  });
});
