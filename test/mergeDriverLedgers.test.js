/* The ledger merge driver's DECISION CORE (NEW-1) — `mergeGenerated` / `conflictMarkers`. Fast,
 * dependency-free unit tests against small stub build scripts, isolating the orchestration logic
 * (seed → regenerate → check the B384432 loss post-condition → conflict markers on any failure)
 * from `build-map.mjs` / `build-backlog-index.mjs`'s own correctness, which has its own tests.
 *
 * The full end-to-end proof — a REAL `git merge` invoking this driver through real git config
 * against the REAL generator scripts — lives in test/mergeDriverE2E.test.js, modelled on
 * test/mintGateE2E.test.js. This file is the cheap complement, not a substitute for it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeGenerated, conflictMarkers } from "../scripts/merge-driver-ledgers.mjs";

let ROOT;
beforeEach(() => { ROOT = mkdtempSync(join(tmpdir(), "merge-driver-unit-")); });
afterEach(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

/** A scratch repo carrying only a stub `scripts/build-map.mjs` — `GENERATED`'s build path is
 *  fixed, so the stub must live at that exact path to be picked up. */
function scratchRepo(buildMapScript) {
  const dir = mkdtempSync(join(ROOT, "repo-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "build-map.mjs"), buildMapScript);
  return dir;
}

describe("conflictMarkers — the fallback shape a human (or resolve-ledgers.mjs) can still parse", () => {
  it("wraps both sides in ordinary <<<<<<</=======/>>>>>>> markers", () => {
    const text = conflictMarkers("mine\n", "theirs\n");
    expect(text).toBe("<<<<<<< ours\nmine\n=======\ntheirs\n>>>>>>> theirs\n");
  });

  it("adds a trailing newline to a side that is missing one, so markers never run into content", () => {
    const text = conflictMarkers("mine", "theirs");
    expect(text).toMatch(/^<<<<<<< ours\nmine\n=======\n/);
    expect(text).toMatch(/theirs\n>>>>>>> theirs\n$/);
  });
});

describe("mergeGenerated — the decision core", () => {
  it("refuses a file that is not a registered generated ledger, without touching disk", () => {
    const res = mergeGenerated({ file: "SOMETHING-ELSE.md", oursText: "a", theirsText: "b", repo: ROOT });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/not one of the registered generated ledgers/);
  });

  it("seeds the union, runs the real regenerator, and reports the regenerated text on success", () => {
    // A minimal but REAL preserve-across-regen generator, in the shape build-map.mjs actually
    // uses: read whatever seed is on disk, echo it back with a marker proving it really ran.
    const dir = scratchRepo(
      "import { readFileSync, writeFileSync, existsSync } from 'node:fs';\n" +
      "import { dirname, resolve } from 'node:path';\n" +
      "import { fileURLToPath } from 'node:url';\n" +
      "const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');\n" +
      "const p = resolve(REPO, 'MAP.md');\n" +
      "const seed = existsSync(p) ? readFileSync(p, 'utf8') : '';\n" +
      "writeFileSync(p, seed + '<!-- regenerated -->\\n');\n",
    );
    const res = mergeGenerated({
      file: "MAP.md",
      oursText: "- **`src/a.js`** — mine\n",
      theirsText: "- **`src/b.js`** — theirs\n",
      repo: dir,
    });
    expect(res.ok).toBe(true);
    expect(res.resultText).toContain("`src/a.js`** — mine");
    expect(res.resultText).toContain("`src/b.js`** — theirs");
    expect(res.resultText).toContain("<!-- regenerated -->");
    // the seed really was written to the real path the generator reads from
    expect(readFileSync(join(dir, "MAP.md"), "utf8")).toBe(res.resultText);
  });

  it("reports failure (never throws) when the regeneration script itself throws", () => {
    const dir = scratchRepo("process.stderr.write('boom\\n'); process.exit(1);\n");
    const res = mergeGenerated({ file: "MAP.md", oursText: "a", theirsText: "b", repo: dir });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/threw/);
  });

  it("REFUSES when the regenerator comes back missing a hand-authored description (B384432)", () => {
    // A deliberately LOSSY generator: ignores whatever was seeded and always emits a fixed,
    // undescribed MAP.md — modelling exactly the PR #978 failure this driver exists to prevent.
    const dir = scratchRepo(
      "import { writeFileSync } from 'node:fs';\n" +
      "import { dirname, resolve } from 'node:path';\n" +
      "import { fileURLToPath } from 'node:url';\n" +
      "const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');\n" +
      "writeFileSync(resolve(REPO, 'MAP.md'), \"- **`src/b.js`** — TODO — describe\\n\");\n",
    );
    const res = mergeGenerated({
      file: "MAP.md",
      oursText: "- **`src/b.js`** — Branch B's own new helper.\n",
      theirsText: "- **`src/c.js`** — TODO — describe\n",
      repo: dir,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/MISSING 1 hand-authored description/);
    expect(res.reason).toMatch(/src\/b\.js/);
    expect(res.reason).toMatch(/B384432/);
  });
});
