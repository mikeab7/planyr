/* merge-ledgers-safe.mjs — the wrapper END TO END, against REAL git branches and REAL merges
 * (NEW-1 / B1592848). Modelled on test/mergeDriverE2E.test.js for the same reason: reasoning about
 * what git *would* do proves nothing next to what it *actually does*. Every scenario below was
 * first reproduced by hand in a throwaway repo before being written as a test — see the item's
 * write-up in BACKLOG.md / docs/archive/BACKLOG-DONE.md for the adjacent-cases table this file's
 * results feed. No real branch in THIS repo is ever touched; every repo here is a fresh `git init`
 * in a temp dir, cleaned up in `afterAll`.
 *
 * THE MEASURED ADJACENT CASES (each is its own describe block below):
 *   (1) two branches append DIFFERENT, well-separated entries — git's own `ort` merge strategy
 *       resolves this with NO conflict and no tool involvement at all. Measured, not assumed: an
 *       edited line and a same-file insertion a few lines away do NOT conflict by mere proximity —
 *       git only conflicts on a genuine overlap.
 *   (2) two branches append at the EXACT SAME anchor (both prepend to the top of the same
 *       section) — a real conflict, disjoint ids, auto-resolved and auto-committed by the wrapper.
 *   (3) one branch appends immediately after a line while another branch EDITS that same anchor
 *       line — THIS is the one real conflict where an append and an in-place edit land in the same
 *       hunk, and it is the case a plain `merge=union` handles worst: reproduced here BOTH ways —
 *       what the union driver used to write, and what it writes now that B1592848 closed the gap
 *       (REFUSED, conflict markers left, nothing committed).
 *   (4) a branch appends to BOTH BACKLOG.md and VERIFICATION.md in one commit, merged against
 *       another branch that touched both too — proves the wrapper resolves independent per-file
 *       conflicts in one pass and makes exactly one merge commit.
 *   (5) rebase vs merge on the identical two branches — proves they are NOT the same operation
 *       (rebase pauses per replayed commit and never makes a merge commit) and documents why the
 *       wrapper deliberately targets `git merge` only, matching this repo's own standing preference
 *       (CLAUDE.md: never rewrite shared history; prefer merging main in over rebasing).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runSafeMerge, mergeInProgress } from "../scripts/merge-ledgers-safe.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* The real scripts, copied verbatim — both resolve-ledgers.mjs and merge-ledgers-safe.mjs compute
 * their own REPO from `import.meta.url`, so running the COPY from inside a scratch repo's own
 * scripts/ dir is what scopes every read/write to that scratch repo instead of this real one. */
const SCRIPT_FILES = ["merge-ledgers-safe.mjs", "resolve-ledgers.mjs", "next-id.mjs", "idBlocks.mjs"];

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const softGit = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

function seedScripts(dir) {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  for (const f of SCRIPT_FILES) copyFileSync(join(REPO, "scripts", f), join(dir, "scripts", f));
}

function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "safe-merge-e2e@planyr.test");
  git(dir, "config", "user.name", "Safe Merge E2E");
  seedScripts(dir);
  writeFileSync(join(dir, ".gitignore"), ".planyr-ledger-merges.log\n"); // matches the real repo's own .gitignore
  return dir;
}

function commitAll(dir, message) {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

/** Was the current HEAD created by an actual `git merge` (two parents)? Robust against exactly how
 *  many ancestor commits either side brought along — unlike a raw rev-list count, which has to be
 *  hand-computed per scenario and is easy to get off by one. */
function isMergeCommit(dir) {
  const parents = git(dir, "rev-list", "-1", "--parents", "HEAD").trim().split(/\s+/).length - 1;
  return parents === 2;
}

/** Invoke the REAL wrapper as a subprocess against a scratch repo — the actual CLI, not a mock. */
function runWrapper(dir, ref) {
  return spawnSync(process.execPath, [join(dir, "scripts", "merge-ledgers-safe.mjs"), ref], { cwd: dir, encoding: "utf8" });
}

let ROOT;
beforeAll(() => { ROOT = mkdtempSync(join(tmpdir(), "safe-merge-e2e-")); });
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

describe("(1) two branches append DIFFERENT, well-separated entries", () => {
  it("git's own merge resolves this with ZERO conflict — no tool needed at all", () => {
    const dir = initRepo(join(ROOT, "case1-separate-appends"));
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B10 — item ten\n- Verify: sandbox\n- detail line\n\n### B1 — old item\nbody\n");
    commitAll(dir, "base");
    git(dir, "checkout", "-q", "-b", "branchA");
    writeFileSync(join(dir, "BACKLOG.md"), readFileSync(join(dir, "BACKLOG.md"), "utf8").replace("- Verify: sandbox", "- Verify: live (A edited this)"));
    commitAll(dir, "A edits B10 verify line");
    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "branchB", "main");
    writeFileSync(join(dir, "BACKLOG.md"), readFileSync(join(dir, "BACKLOG.md"), "utf8").replace("### B1 — old item", "### B11 — brand new item from B\nnew body\n\n### B1 — old item"));
    commitAll(dir, "B appends a new item, well separated from A's edit");
    git(dir, "checkout", "-q", "main");
    git(dir, "merge", "--no-edit", "-q", "branchA");

    const res = runSafeMerge({ ref: "branchB", repo: dir,
      spawnMerge: () => softGit(dir, "merge", "--no-edit", "branchB"),
      spawnResolve: () => { throw new Error("resolve-ledgers.mjs must NOT be invoked — git merged cleanly on its own"); },
    });
    expect(res).toEqual({ ok: true, outcome: "clean-merge", ref: "branchB" });
    const text = readFileSync(join(dir, "BACKLOG.md"), "utf8");
    expect(text).toContain("Verify: live (A edited this)");
    expect(text).toContain("### B11 — brand new item from B");
  });
});

describe("(2) two branches append at the EXACT SAME anchor — the #974 arrival-order shape", () => {
  let dir;
  beforeAll(() => {
    dir = initRepo(join(ROOT, "case2-same-anchor"));
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B1 — old item\nbody\n");
    commitAll(dir, "base");
    git(dir, "checkout", "-q", "-b", "branchA");
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B500 — my new item\nmy body\n\n### B1 — old item\nbody\n");
    commitAll(dir, "A prepends a new item to the top of Open");
    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "branchB", "main");
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B501 — their new item\ntheir body\n\n### B1 — old item\nbody\n");
    commitAll(dir, "B prepends a DIFFERENT new item to the same top-of-section anchor");
    git(dir, "checkout", "-q", "main");
    git(dir, "merge", "--no-edit", "-q", "branchA");
  });

  it("git DOES conflict here (same insertion point, git can't order them) — measured", () => {
    const merge = softGit(dir, "merge", "--no-edit", "branchB");
    expect(merge.status).not.toBe(0);
    const status = softGit(dir, "status", "--porcelain").stdout;
    expect(status).toContain("UU BACKLOG.md");
    git(dir, "merge", "--abort");
  });

  it("the wrapper auto-resolves it AND makes exactly one merge commit — nothing left for a human", () => {
    const result = runWrapper(dir, "branchB");
    expect(result.status).toBe(0);
    expect(softGit(dir, "status", "--porcelain").stdout.trim()).toBe(""); // clean tree, nothing pending
    expect(isMergeCommit(dir)).toBe(true); // exactly one new commit — a real merge commit, both parents present
    const text = readFileSync(join(dir, "BACKLOG.md"), "utf8");
    expect(text).toContain("### B500 — my new item");
    expect(text).toContain("### B501 — their new item");
    expect(text).not.toMatch(/^[<>=]{7}/m);
  });
});

describe("(3) an append landing on the SAME anchor line as an in-place edit — union's worst case", () => {
  // Reproduced by hand first: branch A edits "- detail line" itself; branch B inserts a new item
  // using that same unedited line as its insertion anchor. Because the insertion is expressed
  // relative to that exact line, git's `ort` merge (unlike case 1) DOES conflict here — this is the
  // one place an append and an in-place edit genuinely collide in one hunk.
  function buildCase(dir) {
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B10 — item ten\n- Verify: sandbox\n- detail line\n### B1 — old item\nbody\n");
    commitAll(dir, "base");
    git(dir, "checkout", "-q", "-b", "branchA");
    writeFileSync(join(dir, "BACKLOG.md"), readFileSync(join(dir, "BACKLOG.md"), "utf8").replace("- detail line", "- detail line (edited by A)"));
    commitAll(dir, "A edits the anchor line itself");
    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "branchB", "main");
    writeFileSync(join(dir, "BACKLOG.md"), readFileSync(join(dir, "BACKLOG.md"), "utf8").replace("- detail line\n### B1", "- detail line\n### B11 — brand new item from B\nnew body\n### B1"));
    commitAll(dir, "B inserts using that same line as anchor/context");
    git(dir, "checkout", "-q", "main");
    git(dir, "merge", "--no-edit", "-q", "branchA");
  }

  it("git DOES conflict, in a single hunk that mixes the edit and the insertion — measured", () => {
    const dir = initRepo(join(ROOT, "case3-edit-vs-adjacent-append-probe"));
    buildCase(dir);
    const merge = softGit(dir, "merge", "--no-edit", "branchB");
    expect(merge.status).not.toBe(0);
    const conflicted = readFileSync(join(dir, "BACKLOG.md"), "utf8");
    expect(conflicted).toContain("<<<<<<<");
    expect(conflicted).toContain("- detail line (edited by A)");
    expect(conflicted).toContain("### B11 — brand new item from B"); // the new item is INSIDE the hunk, not outside it
  });

  it("WITHOUT the B1592848 fix, a bare union would have silently corrupted item B10's block", () => {
    const dir = initRepo(join(ROOT, "case3-old-union-behavior"));
    buildCase(dir);
    softGit(dir, "merge", "--no-edit", "branchB");
    const conflicted = readFileSync(join(dir, "BACKLOG.md"), "utf8");
    // Simulate git's OWN zero-config `union` driver: both sides of every conflict, concatenated —
    // no precondition, no refusal. This is exactly `.gitattributes`' bare `merge=union` line the
    // brief's STARTING POINT proposed for BACKLOG.md.
    const naiveUnion = conflicted
      .replace(/<<<<<<< [^\n]*\n/g, "")
      .replace(/=======\n/g, "")
      .replace(/>>>>>>> [^\n]*\n/g, "");
    expect(naiveUnion).toContain("- detail line (edited by A)\n- detail line\n### B11 — brand new item from B");
    // "- detail line" now appears TWICE inside item B10's own block, with the new item B11
    // grafted in between the two copies — a corrupted item, not a merge. This is why bare
    // `merge=union` was rejected for BACKLOG.md/VERIFICATION.md (see scripts/resolve-ledgers.mjs's
    // header) and why B1592848 closes the id-overlap check's blind spot instead of loosening it.
  });

  it("WITH the fix, the wrapper REFUSES — conflict markers left, nothing committed, no corruption", () => {
    const dir = initRepo(join(ROOT, "case3-fixed-behavior"));
    buildCase(dir);
    const before = git(dir, "rev-list", "--count", "HEAD").trim();
    const result = runWrapper(dir, "branchB");
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/in-place edit/);
    const after = git(dir, "rev-list", "--count", "HEAD").trim();
    expect(after).toBe(before); // no commit was made
    const status = softGit(dir, "status", "--porcelain").stdout;
    expect(status).toContain("UU BACKLOG.md"); // still unmerged — a human has to look
    const text = readFileSync(join(dir, "BACKLOG.md"), "utf8");
    expect(text).toContain("<<<<<<<"); // conflict markers genuinely left in place, not guessed away
    git(dir, "merge", "--abort");
  });
});

describe("(4) a branch appends to BOTH ledgers at once", () => {
  it("resolves independent per-file conflicts in BACKLOG.md and VERIFICATION.md with ONE merge commit", () => {
    const dir = initRepo(join(ROOT, "case4-both-files"));
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B1 — old item\nbody\n");
    writeFileSync(join(dir, "VERIFICATION.md"), "# Verification\n\n## Pending\n\n### V1 — old check\nbody\n");
    commitAll(dir, "base");
    git(dir, "checkout", "-q", "-b", "branchA");
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B500 — mine (backlog)\nbody\n\n### B1 — old item\nbody\n");
    writeFileSync(join(dir, "VERIFICATION.md"), "# Verification\n\n## Pending\n\n### V500 — mine (verify)\nbody\n\n### V1 — old check\nbody\n");
    commitAll(dir, "A adds a new item to BOTH ledgers");
    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "branchB", "main");
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B501 — theirs (backlog)\nbody\n\n### B1 — old item\nbody\n");
    writeFileSync(join(dir, "VERIFICATION.md"), "# Verification\n\n## Pending\n\n### V501 — theirs (verify)\nbody\n\n### V1 — old check\nbody\n");
    commitAll(dir, "B adds a DIFFERENT new item to BOTH ledgers");
    git(dir, "checkout", "-q", "main");
    git(dir, "merge", "--no-edit", "-q", "branchA");

    const result = runWrapper(dir, "branchB");
    expect(result.status).toBe(0);
    expect(isMergeCommit(dir)).toBe(true); // one merge commit resolves BOTH files, not two separate commits
    expect(softGit(dir, "status", "--porcelain").stdout.trim()).toBe("");
    const backlog = readFileSync(join(dir, "BACKLOG.md"), "utf8");
    const verify = readFileSync(join(dir, "VERIFICATION.md"), "utf8");
    expect(backlog).toContain("B500");
    expect(backlog).toContain("B501");
    expect(verify).toContain("V500");
    expect(verify).toContain("V501");
  });
});

describe("(5) rebase vs merge on the identical branches — measured, not assumed", () => {
  function buildCase(dir) {
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B1 — old item\nbody\n");
    commitAll(dir, "base");
    git(dir, "checkout", "-q", "-b", "branchA");
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B500 — mine\nbody\n\n### B1 — old item\nbody\n");
    commitAll(dir, "A prepends a new item");
    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "branchB", "main");
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B501 — theirs\nbody\n\n### B1 — old item\nbody\n");
    commitAll(dir, "B prepends a different new item, same anchor");
    git(dir, "checkout", "-q", "main");
    git(dir, "merge", "--no-edit", "-q", "branchA");
  }

  it("MERGE: one command, one resulting merge commit — what the wrapper targets", () => {
    const dir = initRepo(join(ROOT, "case5-merge"));
    buildCase(dir);
    const result = runWrapper(dir, "branchB");
    expect(result.status).toBe(0);
    const log = git(dir, "log", "--oneline", "-1").trim();
    expect(log).toMatch(/Merge branch 'branchB'/);
    expect(isMergeCommit(dir)).toBe(true);
  });

  it("REBASE: pauses mid-replay, needs --continue per conflicting commit, makes NO merge commit — a different shape entirely", () => {
    const dir = initRepo(join(ROOT, "case5-rebase"));
    buildCase(dir);
    // Rebase main's tip (which already carries branchA) onto branchB — replays main's one commit
    // on top of branchB and hits the SAME textual conflict case (2) already proved conflicts.
    const rebase = softGit(dir, "rebase", "branchB");
    expect(rebase.status).not.toBe(0);
    expect(softGit(dir, "status", "--porcelain").stdout).toContain("UU BACKLOG.md");
    // resolve-ledgers.mjs works here too (it only reads conflict markers from the working tree —
    // merge vs rebase is invisible to it), but finishing requires `rebase --continue`, not `commit`:
    const resolve = spawnSync(process.execPath, [join(dir, "scripts", "resolve-ledgers.mjs")], { cwd: dir, encoding: "utf8" });
    expect(resolve.status).toBe(0);
    expect(softGit(dir, "status", "--porcelain").stdout).not.toMatch(/^U/m); // resolved and STAGED (mid-rebase, not committed)
    // Measured, not assumed: `git commit` mid-rebase SUCCEEDS (unlike a merge, where it is exactly
    // the right way to finish) — but it only closes the CURRENT replayed step. The rebase is still
    // "in progress" afterward and git says so explicitly ("You are currently editing a commit while
    // rebasing" / "use git rebase --continue once you are satisfied") — the same verb that cleanly
    // FINISHES a merge leaves a rebase in a confusing half-done state. This is the sharpest reason
    // the wrapper deliberately does not try to support `--rebase`: the completion step is not a
    // drop-in swap of one git command for another.
    const commitAttempt = softGit(dir, "-c", "core.editor=true", "commit", "--no-edit");
    expect(commitAttempt.status).toBe(0);
    expect(softGit(dir, "status", "--porcelain").stdout).toBe(""); // looks clean...
    expect(softGit(dir, "status").stdout).toMatch(/rebasing|rebase in progress/i); // ...but is NOT done
    const cont = softGit(dir, "-c", "core.editor=true", "rebase", "--continue");
    expect(cont.status).toBe(0);
    // No merge commit was ever created — rebase REPLAYS main's one commit (from branchA, via the
    // earlier fast-forward) on top of branchB's history, so the log is LINEAR: base, branchB's own
    // commit, then the replayed one — three commits, never a "Merge branch" line.
    const log = git(dir, "log", "--oneline").trim();
    expect(log).not.toMatch(/Merge branch/);
    expect(log.split("\n")).toHaveLength(3);
  });
});

describe("runSafeMerge: a failed `git merge` that never actually STARTED is refused, not silently committed", () => {
  // Found by dogfooding this exact script against a stale shallow clone: `git merge` failed with
  // "Could not read <object>" / "refusing to merge unrelated histories" — NOT a content conflict —
  // so `unmergedPaths()` was trivially empty and, before this check existed, the wrapper went on to
  // run resolve-ledgers.mjs (a harmless no-op) and then `git commit`, which is meaningless when no
  // merge is underway at all.
  it("with injected spawners: merge fails, no MERGE_HEAD → refused as merge-did-not-start, resolver/commit never called", () => {
    let resolveCalled = false, commitCalled = false;
    const res = runSafeMerge({
      ref: "origin/main",
      repo: "/nonexistent",
      spawnMerge: () => ({ status: 128, stdout: "", stderr: "fatal: refusing to merge unrelated histories\n" }),
      spawnResolve: () => { resolveCalled = true; return { status: 0, stdout: "", stderr: "" }; },
      spawnCommit: () => { commitCalled = true; return { status: 0, stdout: "", stderr: "" }; },
      listUnmerged: () => [],
      checkMergeInProgress: () => false,
    });
    expect(res).toEqual({ ok: false, outcome: "merge-did-not-start", ref: "origin/main", resolverOutput: "fatal: refusing to merge unrelated histories\n" });
    expect(resolveCalled).toBe(false);
    expect(commitCalled).toBe(false);
  });

  it("real repo: a DIRTY working tree makes `git merge` fail before touching anything — the wrapper refuses cleanly", () => {
    const dir = initRepo(join(ROOT, "merge-did-not-start-dirty-tree"));
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B1 — old item\nbody\n");
    commitAll(dir, "base");
    git(dir, "checkout", "-q", "-b", "branchB");
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B501 — theirs\nbody\n\n### B1 — old item\nbody\n");
    commitAll(dir, "B prepends");
    git(dir, "checkout", "-q", "main");
    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n## Open\n\n### B1 — old item\nbody\nUNCOMMITTED LOCAL EDIT\n"); // dirty, uncommitted

    const result = runWrapper(dir, "branchB");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/did not even start/);
    expect(mergeInProgress(dir)).toBe(false);
    expect(readFileSync(join(dir, "BACKLOG.md"), "utf8")).toContain("UNCOMMITTED LOCAL EDIT"); // untouched
  });
});

describe("KNOWN-GOOD ARM — an ordinary merge with no ledger files involved at all", () => {
  it("merges cleanly regardless of whether this wrapper's ledger-specific code is correct", () => {
    const dir = initRepo(join(ROOT, "known-good-arm"));
    writeFileSync(join(dir, "src.js"), "export const a = 1;\n");
    commitAll(dir, "base");
    git(dir, "checkout", "-q", "-b", "branchB");
    writeFileSync(join(dir, "src.js"), "export const a = 1;\nexport const b = 2;\n");
    commitAll(dir, "unrelated change");
    git(dir, "checkout", "-q", "main");
    const result = runWrapper(dir, "branchB");
    expect(result.status).toBe(0);
    expect(readFileSync(join(dir, "src.js"), "utf8")).toContain("export const b = 2;");
  });
});
