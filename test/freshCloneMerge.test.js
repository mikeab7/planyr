/* freshCloneMerge.test.js — THE LITERAL ACCEPTANCE CRITERION OF B1102688, kept as a permanent
 * regression guard rather than a one-time manual check.
 *
 * THE ITEM. MAP.md, BACKLOG_OPEN.md, and docs/archive/BACKLOG-DONE.md are fully regenerated (the
 * first two) or hand-appended (the third) on nearly every PR, so they conflicted by construction —
 * but only on a clone that had run `npm install` did that conflict self-resolve, because the
 * driver doing the resolving was named directly in `.gitattributes` and its actual command lives
 * in LOCAL git config that only `npm install` writes. Every fresh agent container and every fresh
 * CI checkout skips that step, so these files came through as raw textual conflicts, holding
 * GitHub's `mergeable_state` at `dirty` and every required check at "Expected — waiting for status
 * to be reported" indefinitely.
 *
 * THIS FILE proves the fix the way a human verifying it by hand would: clone fresh (a bare `git
 * init`, never `npm install`, never `scripts/install-hooks.mjs` in any form), create two branches
 * that each legitimately touch these files, merge one into the other, and require zero shown
 * conflict. It reads `.gitattributes` straight off THIS repo's disk (never retyped) so the test
 * can never silently drift from what actually ships. `test/mergeDriverE2E.test.js` proves the
 * OTHER end — the installed clone keeps its smarter, unchanged behavior — this proves the floor.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findDuplicateIds, B_FILES } from "../scripts/next-id.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REAL_GITATTRIBUTES = readFileSync(join(REPO, ".gitattributes"), "utf8");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const softGit = (cwd, ...args) => { try { return git(cwd, ...args); } catch { return null; } };
const porcelain = (dir) => spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout;

/* Real, dependency-free generator scripts, copied byte-for-byte — no fixture reimplementation. */
const SCRIPT_FILES = ["build-map.mjs", "build-backlog-index.mjs"];

/** A bare fresh clone: `git init`, the REAL committed `.gitattributes`, and the real generator
 *  scripts. Deliberately NOTHING else — no `.githooks`, no `installHooks`/`installMergeDriver`/
 *  `installAttributesOverride` call of any kind. This is what every fresh agent container and
 *  every fresh CI checkout actually looks like before this fix. */
function freshClone(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "fresh-clone@planyr.test");
  git(dir, "config", "user.name", "Fresh Clone (no npm install)");
  writeFileSync(join(dir, ".gitattributes"), REAL_GITATTRIBUTES);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  for (const f of SCRIPT_FILES) copyFileSync(join(REPO, "scripts", f), join(dir, "scripts", f));
  mkdirSync(join(dir, "docs", "archive"), { recursive: true });
  return dir;
}

function commitAll(dir, message) {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

function writeSrcFile(dir, relPath, content) {
  mkdirSync(dirname(join(dir, relPath)), { recursive: true });
  writeFileSync(join(dir, relPath), content);
}

function generate(dir, script) {
  execFileSync(process.execPath, [join(dir, "scripts", script)], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
}

let ROOT;
beforeAll(() => { ROOT = mkdtempSync(join(tmpdir(), "fresh-clone-merge-")); });
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

describe("a bare fresh clone (no npm install, no .githooks, no local git config) — the acceptance criterion", () => {
  let dir;
  beforeAll(() => {
    dir = freshClone(join(ROOT, "no-install"));

    // --- MAP.md: two branches each add a different new source file ---
    writeSrcFile(dir, "src/old.js", "export function old() {}\n");
    generate(dir, "build-map.mjs");

    // --- BACKLOG_OPEN.md: a base BACKLOG.md with two independent items to append near ---
    writeFileSync(join(dir, "BACKLOG.md"), [
      "# Backlog", "", "## 🔲 Open", "",
      "### B1 — base item alpha", "body", "",
      "### B2 — base item beta", "body", "",
      "## Later", "",
    ].join("\n"));
    generate(dir, "build-backlog-index.mjs");

    // --- docs/archive/BACKLOG-DONE.md: a base with one existing closed item ---
    writeFileSync(join(dir, "docs", "archive", "BACKLOG-DONE.md"), [
      "# Backlog — Done", "",
      "### B900 — an already-shipped item", "already done, untouched by either branch", "",
    ].join("\n"));

    commitAll(dir, "base");

    git(dir, "checkout", "-q", "-b", "branch-x");
    writeSrcFile(dir, "src/x.js", "export function x() {}\n");
    generate(dir, "build-map.mjs");
    writeFileSync(join(dir, "BACKLOG.md"), readFileSync(join(dir, "BACKLOG.md"), "utf8")
      .replace("### B2 — base item beta\nbody\n", "### B2 — base item beta\nbody\n\n### B3 — X's new item\nbody\n"));
    generate(dir, "build-backlog-index.mjs");
    writeFileSync(join(dir, "docs", "archive", "BACKLOG-DONE.md"),
      readFileSync(join(dir, "docs", "archive", "BACKLOG-DONE.md"), "utf8") + "\n### B901 — X's item, just shipped\nshipped by branch X\n");
    commitAll(dir, "branch-x: new file, new backlog item, newly archived item");

    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "branch-y");
    writeSrcFile(dir, "src/y.js", "export function y() {}\n");
    generate(dir, "build-map.mjs");
    writeFileSync(join(dir, "BACKLOG.md"), readFileSync(join(dir, "BACKLOG.md"), "utf8")
      .replace("### B1 — base item alpha\nbody\n", "### B1 — base item alpha\nbody\n\n### B4 — Y's new item\nbody\n"));
    generate(dir, "build-backlog-index.mjs");
    writeFileSync(join(dir, "docs", "archive", "BACKLOG-DONE.md"),
      readFileSync(join(dir, "docs", "archive", "BACKLOG-DONE.md"), "utf8") + "\n### B902 — Y's item, just shipped\nshipped by branch Y\n");
    commitAll(dir, "branch-y: another new file, another backlog item, another newly archived item");

    git(dir, "checkout", "-q", "branch-x");
    softGit(dir, "merge", "-q", "--no-edit", "branch-y");
  });

  it("the merge command itself succeeds — exit 0, not left mid-merge", () => {
    // A conflicted merge leaves .git/MERGE_HEAD behind and `git status` reports it; a clean merge
    // (or a fast-forward) does not. This is the direct, mechanical version of "no shown conflict".
    const r = spawnSync("git", ["rev-parse", "--verify", "-q", "MERGE_HEAD"], { cwd: dir });
    expect(r.status).not.toBe(0); // no in-progress merge left behind
  });

  it("MAP.md merges with NO conflict and both new files present", () => {
    expect(porcelain(dir)).not.toMatch(/^UU MAP\.md$/m);
    const map = readFileSync(join(dir, "MAP.md"), "utf8");
    expect(map).toContain("`src/old.js`");
    expect(map).toContain("`src/x.js`");
    expect(map).toContain("`src/y.js`");
  });

  it("BACKLOG_OPEN.md merges with NO conflict and both new items present", () => {
    expect(porcelain(dir)).not.toMatch(/^UU BACKLOG_OPEN\.md$/m);
    const idx = readFileSync(join(dir, "BACKLOG_OPEN.md"), "utf8");
    expect(idx).toContain("B3");
    expect(idx).toContain("B4");
  });

  it("docs/archive/BACKLOG-DONE.md merges with NO conflict and both newly-archived items present", () => {
    expect(porcelain(dir)).not.toMatch(/^UU docs\/archive\/BACKLOG-DONE\.md$/m);
    const done = readFileSync(join(dir, "docs", "archive", "BACKLOG-DONE.md"), "utf8");
    expect(done).toContain("### B900");
    expect(done).toContain("### B901");
    expect(done).toContain("### B902");
  });

  it("no path in this merge was left unmerged at all", () => {
    expect(porcelain(dir)).not.toMatch(/^(DD|AU|UD|UA|DU|AA|UU) /m);
  });
});

describe("KNOWN-GOOD ARM — the same bare fresh clone merges an ordinary, unrelated change cleanly too", () => {
  it("proves the harness itself works, independent of whether B1102688's code is correct", () => {
    const dir = freshClone(join(ROOT, "known-good"));
    writeSrcFile(dir, "src/old.js", "export function old() {}\n");
    generate(dir, "build-map.mjs");
    commitAll(dir, "base");

    git(dir, "checkout", "-q", "-b", "p");
    writeFileSync(join(dir, "README.md"), "p was here\n");
    commitAll(dir, "p: unrelated file");

    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "q");
    writeFileSync(join(dir, "NOTES.md"), "q was here\n");
    commitAll(dir, "q: another unrelated file");

    git(dir, "checkout", "-q", "p");
    const r = spawnSync("git", ["merge", "-q", "--no-edit", "q"], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(0);
  });
});

describe("the ONE documented residual risk for docs/archive/BACKLOG-DONE.md is caught LOUDLY, not silently", () => {
  it("two branches editing the SAME already-closed entry differently merge with no conflict, but the real CI duplicate-id guard catches the result", () => {
    // This is the narrow case .gitattributes' own comment names as union's one blind spot: not two
    // branches each ARCHIVING a different item (the scenario above, which is perfectly safe), but
    // two branches correcting the exact same existing DONE entry differently. Proving BOTH halves
    // of the claim: (a) union still merges it with no shown conflict, and (b) the existing,
    // unmodified findDuplicateIds/B_FILES machinery (the same one test/idUniqueness.test.js runs in
    // CI) genuinely flags the result — so the residual risk is a loud, named build failure, not a
    // silent data-correctness bug.
    const dir = freshClone(join(ROOT, "same-entry-edited-twice"));
    writeFileSync(join(dir, "docs", "archive", "BACKLOG-DONE.md"), [
      "# Backlog — Done", "",
      "### B900 — an item whose wording gets corrected", "original wording", "",
    ].join("\n"));
    commitAll(dir, "base");

    git(dir, "checkout", "-q", "-b", "fix-a");
    writeFileSync(join(dir, "docs", "archive", "BACKLOG-DONE.md"), [
      "# Backlog — Done", "",
      "### B900 — an item whose wording gets corrected (typo fix A)", "original wording", "",
    ].join("\n"));
    commitAll(dir, "fix-a: correct the heading one way");

    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "fix-b");
    writeFileSync(join(dir, "docs", "archive", "BACKLOG-DONE.md"), [
      "# Backlog — Done", "",
      "### B900 — an item whose wording gets corrected (typo fix B)", "original wording", "",
    ].join("\n"));
    commitAll(dir, "fix-b: correct the heading a different way");

    git(dir, "checkout", "-q", "fix-a");
    const r = spawnSync("git", ["merge", "-q", "--no-edit", "fix-b"], { cwd: dir, encoding: "utf8" });

    expect(r.status).toBe(0); // (a) union: no shown conflict
    expect(porcelain(dir)).not.toMatch(/^UU /m);

    // (b) the SAME production duplicate-id detector CI runs, pointed at this scratch repo, catches it.
    const dups = findDuplicateIds(dir, B_FILES, "B");
    expect(dups).toEqual([{ id: "B900", count: 2 }]);
  });
});
