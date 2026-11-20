/* MAP.md generator (B637; narrowed by NEW-1/B1358128, 2026-09-08). This used to require the
 * committed repo-root MAP.md's file/export inventory to exactly match a fresh scan of the source
 * tree on every PR — dropped because that meant every PR that added/removed/renamed a file, or
 * changed a primary export (an extremely common shape of change), also had to regenerate and
 * commit MAP.md, so any two such PRs open at once conflicted on it by construction (see
 * .github/ci-gates.yml's "Generated-index touch guard"). MAP.md is now refreshed by a scheduled
 * job instead (.github/workflows/regen-derived-docs.yml), so it can be briefly stale between
 * refreshes — expected and fine, since nothing in the app reads it at runtime. `auditMap()` and
 * its `--check` CLI mode still exist for that job and for local use.
 *
 * What's still worth asserting here, decoupled from whether the committed file happens to be
 * fresh right now: the generator runs cleanly and returns the documented shape, and it never
 * reintroduces the volatile generated-at stamp this same item removed (a date/commit-hash header
 * that changed on every regen even with zero real content change — a PR was once observed whose
 * entire diff was "Refresh MAP.md's generated-at stamp"). */
import { describe, it, expect } from "vitest";
import { auditMap, render, deriveDescription } from "../scripts/build-map.mjs";

describe("MAP.md generator", () => {
  it("runs cleanly and reports the documented shape", () => {
    const { ok, problems, todos, drift } = auditMap();
    expect(typeof ok).toBe("boolean");
    expect(Array.isArray(problems)).toBe(true);
    expect(Array.isArray(todos)).toBe(true);
    expect(drift === null || typeof drift === "object").toBe(true);
  });

  /* Built from a FRESH render, never the currently-committed MAP.md — that file can be briefly
   * stale between the scheduled job's refreshes (by design, see this file's own header), so a
   * regression test has to exercise the generator itself, not today's regen state. */
  it("a fresh render's header carries no volatile date/commit-hash stamp", () => {
    const header = render([{ path: "src/main.jsx", owner: "infra", exports: ["default"] }], new Map())
      .split("\n").slice(0, 6).join("\n");
    expect(header).not.toMatch(/Generated \d{4}-\d{2}-\d{2}/);
    expect(header).not.toMatch(/@ `[0-9a-f]{7,}`/);
  });

  /* NEW-1 (2026-11-05): the generator's default for a file with no description used to be the
   * placeholder `TODO — describe`, which `--check` and test/resolveLedgers.test.js both forbid. After
   * the nightly job sat unmergeable for weeks, its first run wrote ~586 of them and main's required
   * `build` went red. A generator whose default output fails its own guard cannot run unattended, so
   * the default is now a genuine line derived from the file itself. */
  describe("deriveDescription — the default is never a placeholder", () => {
    const TODO = "TODO — describe";

    it("uses the first sentence of the file's header comment, minus ticket labels", () => {
      const src = "/* B2092656 ×3 — where a county's saved parcel copy lives in the browser. More detail follows here. */\nexport const x = 1;";
      expect(deriveDescription("src/a/parcelWorker.js", src, ["x"])).toBe("Where a county's saved parcel copy lives in the browser.");
    });

    it("reads a header that comes AFTER the imports (and ignores a trailing // note on an import line)", () => {
      const src = 'import { a } from "./a.js"; // NEW-1 (misleading note)\nimport b from "./b.js";\n\n/* Georgia jurisdiction facts — the pure, network-free half. */\nexport const g = 1;';
      expect(deriveDescription("src/lib/georgia.js", src, ["g"])).toBe("Georgia jurisdiction facts — the pure, network-free half.");
    });

    it("reads a // line-comment header and skips eslint pragmas", () => {
      const src = "/* eslint-disable */\n// Trailer parking rows — the pure rules the canvas label and the draw tool share.\n// More.\nexport const t = 1;";
      expect(deriveDescription("src/lib/trailerRows.js", src, ["t"])).toBe("Trailer parking rows — the pure rules the canvas label and the draw tool share.");
    });

    it("caps a very long first sentence", () => {
      const src = "/* " + "word ".repeat(120) + "*/\nexport const y = 1;";
      const d = deriveDescription("src/lib/long.js", src, ["y"]);
      expect(d.length).toBeLessThanOrEqual(192);
      expect(d.endsWith("…")).toBe(true);
    });

    it("with no header comment falls back to the file's exports — still not a placeholder", () => {
      expect(deriveDescription("src/lib/bare.js", "export function f(){}\n", ["f", "g"])).toBe("Module exporting f, g.");
      expect(deriveDescription("src/lib/side.js", "console.log(1);\n", [])).toMatch(/side\.js/);
    });

    it("never returns the placeholder, whatever the input", () => {
      for (const src of ["", "/* */", "// \n", "export default 1;", "/* TODO */ export const z = 1;"]) {
        expect(deriveDescription("src/lib/q.js", src, [])).not.toContain(TODO);
        expect(deriveDescription("src/lib/q.js", src, [])).not.toBe("");
      }
    });
  });
});
