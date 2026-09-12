#!/usr/bin/env node
/*
 * merge-ledgers-safe.mjs — NEW-1 (B1592848): the ONE command for "bring `origin/main` into my
 * branch", so the two-step dance nobody was actually doing stops being a two-step dance.
 *
 * THE PROBLEM THIS CLOSES, MEASURED, NOT ASSUMED. `scripts/resolve-ledgers.mjs` already does
 * exactly what a safe automatic merge of BACKLOG.md / VERIFICATION.md needs: union the arrival-
 * order case, REFUSE (leaving real conflict markers) the moment two sessions touched the same
 * item. It has existed since B296224 and is documented in CLAUDE.md's "Workflow & deploy" section.
 * And it kept not getting run: within about an hour, PR #1673 and PR #1675 both went
 * `mergeable_state: dirty` on this exact file pair and were hand-rebased instead, and PR #1656 hit
 * the identical shape earlier the same evening. The tool was never broken — it was a SEPARATE STEP
 * a session had to remember mid-merge, and remembering is exactly the kind of thing that doesn't
 * scale across concurrent sessions under time pressure. Folding "merge, then if it conflicts on a
 * ledger, run the resolver, then finish the commit" into one command removes the step to forget.
 *
 * ⛔ WHY THIS IS NOT A GIT MERGE DRIVER (considered and rejected — see
 * scripts/merge-driver-ledgers.mjs's own header for the sibling case it already ruled out). A merge
 * driver commits its output the moment `git merge` returns success, with no chance to inspect the
 * result first. `resolve-ledgers.mjs`'s cross-file POST-CONDITION (re-checking CI's own duplicate-id
 * detectors over the live+archive pair before anything is written, per B780) needs to see whether
 * the union it is about to write would race a DIFFERENT branch's archive of the same item — a
 * per-file driver cannot do that safely (same reasoning as the generated-pair driver's documented
 * scope limit), and a driver that got it wrong would have already committed before anyone could
 * look. This script runs the SAME resolver as a still-inspectable step BEFORE the merge commit is
 * made — nothing new is invented, nothing is committed that resolve-ledgers.mjs itself did not
 * already approve, and its LOUD-FAILURE refusal path (real conflict markers, non-zero exit, no
 * commit) is preserved byte-for-byte because this script just runs it and reads its exit code.
 *
 * WHAT IT DOES, four steps:
 *   1. `git merge --no-edit <ref>` (ref defaults to `origin/main`).
 *   2. Clean merge (exit 0) → done, nothing else to do.
 *   3. Conflicted → run `node scripts/resolve-ledgers.mjs` exactly as a human would.
 *      - It refuses (a real edit-race, or a non-ledger file conflicts too) → STOP. The working
 *        tree is left exactly as resolve-ledgers.mjs itself leaves it (conflict markers for the
 *        refused hunks, non-ledger conflicts untouched) — a human resolves the rest by hand.
 *      - It resolves everything it owns AND no unmerged path remains → finish the merge with
 *        `git commit --no-edit`.
 *   4. Never commits unless `git status --porcelain` shows zero unmerged (`U`) paths — checked
 *      fresh after step 3, not assumed from resolve-ledgers.mjs's own exit code alone (LOUD-FAILURE:
 *      a script that trusted another script's self-report without re-checking is exactly the class
 *      of bug this repo's own merge tooling exists to be incapable of).
 *
 *   node scripts/merge-ledgers-safe.mjs                 → merge origin/main into the current branch
 *   node scripts/merge-ledgers-safe.mjs <ref>            → merge an arbitrary ref instead
 *   npm run safe-merge [-- <ref>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const RESOLVE_LEDGERS = join(HERE, "resolve-ledgers.mjs");

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

/** Paths git currently reports as unmerged (`U` in `git status --porcelain`). */
export function unmergedPaths(repo = REPO) {
  const out = execFileSync("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

/**
 * Did git actually ENTER a merge (conflicted or not)? `.git/MERGE_HEAD` exists for exactly as long
 * as a merge is in progress — present the instant `git merge` reports a conflict, gone the moment
 * it is committed or aborted. Distinguishes a real content conflict from `git merge` failing to
 * even START (a dirty working tree, `refusing to merge unrelated histories`, a shallow clone that
 * can't compute a merge base, …) — found by dogfooding this exact script against a stale shallow
 * clone: with no conflict markers and no MERGE_HEAD, `unmergedPaths()` is trivially empty, and
 * without this check the wrapper would have run `resolve-ledgers.mjs` (a harmless no-op) and then
 * attempted `git commit` — which is meaningless when no merge is underway, and LOUD-FAILURE demands
 * this be refused, not silently "handled".
 */
export function mergeInProgress(repo = REPO) {
  return existsSync(join(repo, ".git", "MERGE_HEAD"));
}

/**
 * Run one merge attempt. Never throws — every outcome is a return value so the CLI can report it
 * plainly. `spawnMerge`/`spawnResolve`/`spawnCommit` are injectable so the unit test can pin the
 * decision logic without a real git repo; the CLI (and the E2E test) use the real spawners.
 */
export function runSafeMerge({
  ref = "origin/main",
  repo = REPO,
  spawnMerge = () => spawnSync("git", ["merge", "--no-edit", ref], { cwd: repo, encoding: "utf8" }),
  spawnResolve = () => spawnSync(process.execPath, [RESOLVE_LEDGERS], { cwd: repo, encoding: "utf8" }),
  spawnCommit = () => spawnSync("git", ["commit", "--no-edit"], { cwd: repo, encoding: "utf8" }),
  listUnmerged = () => unmergedPaths(repo),
  checkMergeInProgress = () => mergeInProgress(repo),
} = {}) {
  const merge = spawnMerge();
  if (merge.status === 0) return { ok: true, outcome: "clean-merge", ref };

  if (!checkMergeInProgress()) {
    // git never entered a merge at all — a real content conflict is not the only way `git merge`
    // exits non-zero, and none of those other ways are ours to paper over.
    return {
      ok: false, outcome: "merge-did-not-start", ref,
      resolverOutput: `${merge.stdout || ""}${merge.stderr || ""}`,
    };
  }

  const resolve = spawnResolve();
  const stillUnmerged = listUnmerged();

  if (resolve.status !== 0 || stillUnmerged.length) {
    return {
      ok: false,
      outcome: resolve.status !== 0 ? "resolver-refused" : "unmerged-paths-remain",
      ref,
      unmerged: stillUnmerged,
      resolverOutput: `${resolve.stdout || ""}${resolve.stderr || ""}`,
    };
  }

  const commit = spawnCommit();
  if (commit.status !== 0) {
    return { ok: false, outcome: "commit-failed", ref, commitOutput: `${commit.stdout || ""}${commit.stderr || ""}` };
  }
  return { ok: true, outcome: "auto-resolved", ref, resolverOutput: `${resolve.stdout || ""}${resolve.stderr || ""}` };
}

function main(argv) {
  const ref = argv.find((a) => !a.startsWith("--")) || "origin/main";
  const res = runSafeMerge({ ref });

  if (res.ok && res.outcome === "clean-merge") {
    process.stdout.write(`✅ merged ${ref} — no conflicts.\n`);
    return 0;
  }
  if (res.ok && res.outcome === "auto-resolved") {
    process.stdout.write(res.resolverOutput || "");
    process.stdout.write(`✅ merged ${ref} — ledger conflict(s) auto-resolved by resolve-ledgers.mjs, merge commit made.\n`);
    return 0;
  }

  process.stderr.write(res.resolverOutput || "");
  if (res.outcome === "merge-did-not-start") {
    process.stderr.write(`\n⛔ git merge ${ref} did not even start — this is not a content conflict (a dirty working\n` +
      `   tree, diverged/shallow history, or another git error). Nothing was touched; fix the\n` +
      `   underlying git problem above, then re-run.\n\n`);
  } else {
    process.stderr.write(
      `\n⛔ merge of ${ref} left unresolved conflicts (${res.outcome}) — nothing was committed.\n` +
      (res.unmerged?.length ? `   Still unmerged: ${res.unmerged.join(", ")}\n` : "") +
      `   Resolve by hand, then: git commit\n\n`,
    );
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
