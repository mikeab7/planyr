#!/usr/bin/env node
/*
 * post-merge-regen.mjs — the correctness backstop for the ledger merge driver (NEW-1), run from
 * the `.githooks/post-merge` hook.
 *
 * WHY THIS EXISTS. `scripts/merge-driver-ledgers.mjs` runs MID-MERGE, before git has checked out
 * anything the merge changes — see that file's header for the measured proof (a driver invocation
 * sees only whichever branch is currently checked out, and git gives it no ref to "theirs" either:
 * `MERGE_HEAD` is not written until the merge actually stops or finishes). So the driver's own
 * regeneration is necessarily a MID-MERGE BEST EFFORT: enough to avoid a shown conflict and to get
 * hand-authored descriptions right, but not guaranteed to see every file the merge is about to add.
 *
 * `post-merge` fires at exactly the moment that gap closes: git only invokes it once a merge has
 * resolved EVERY path with no conflicts left anywhere and the commit is already made, and by then
 * the working tree holds the COMPLETE result. Confirmed empirically, not assumed: an instrumented
 * hook on the identical merge that left a file invisible to the driver showed that same file
 * present in `src/` at THIS point. Re-running the real, unmodified generators here — the same ones
 * a session runs by hand per the Definition of Done whenever files are added/removed/renamed —
 * against that complete tree can only produce the correct answer.
 *
 * WHY THIS ONLY STAGES THE FIX RATHER THAN AMENDING THE MERGE COMMIT: also confirmed empirically —
 * `git commit --amend` run from INSIDE a `post-merge` hook fails with "You are in the middle of a
 * merge", because git has not yet cleared its own merge-in-progress bookkeeping at the point the
 * hook runs (that happens once `git merge` fully returns, moments later). Reaching for an amend
 * anyway — deferred, retried, or by hand-editing repository internals — would be exactly the kind
 * of timing-dependent hack this repo's own instrument-reliability rules warn against. Staging the
 * correction (`git add`) is both safe at this point AND sufficient: it shows up immediately as the
 * merge command returns (`git status` reports `M  MAP.md`), and folding it into the merge with one
 * more commit — or an amend, now that the merge has actually finished — is an ordinary next step.
 *
 * SCOPE. Only regenerates a ledger that currently exists (a repo without MAP.md/BACKLOG_OPEN.md —
 * e.g. a scratch fixture — is left alone), and only touches the index if the regeneration actually
 * changed something, so an ordinary merge with no ledger drift is a true no-op.
 *
 * A merge with a genuine, separate conflict on some OTHER path never reaches this hook at all —
 * confirmed empirically: `post-merge` does not fire even after manually resolving such a conflict
 * and running `git commit` to finish it. The person resolving that conflict already re-runs the
 * generators by hand before committing, which is the pre-existing, documented workflow (Definition
 * of Done) this does not change.
 *
 * NEVER BLOCKS ANYTHING (LOUD-FAILURE, tempered): `post-merge` cannot abort a merge that already
 * succeeded, and a hook that could still wedge the process over a ledger regeneration would be a
 * far worse trade than the staleness gap it exists to close — so any error here is reported and
 * this still exits 0. CI's own `build-map.mjs --check` / `build-backlog-index.mjs --check` drift
 * guards remain the backstop of last resort, exactly as they already are today for a hand-run
 * regeneration someone forgot.
 *
 *   .githooks/post-merge → node scripts/post-merge-regen.mjs   (never invoked by hand)
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { GENERATED } from "./resolve-ledgers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_DEFAULT = resolve(HERE, "..");

/** Re-run every GENERATED ledger's build script that exists on disk; re-stage any that changed.
 *  Returns the list of files it corrected. Never throws — a single generator failing is reported
 *  and skipped, not fatal to the others or to the merge. */
export function regenerateAndRestage(repo = REPO_DEFAULT) {
  const changed = [];
  for (const { file, build } of GENERATED) {
    const path = join(repo, file);
    if (!existsSync(path)) continue; // nothing to correct — e.g. a scratch fixture
    const before = readFileSync(path, "utf8");
    try {
      execFileSync(process.execPath, [join(repo, ...build[0].split("/"))], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const detail = (e?.stderr || e?.message || String(e)).toString().trim().slice(0, 300);
      process.stderr.write(`⚠ post-merge-regen: re-running ${build[0]} for ${file} failed — leaving it as the merge driver produced it. ${detail}\n`);
      continue;
    }
    const after = readFileSync(path, "utf8");
    if (after !== before) changed.push(file);
  }
  if (changed.length) execFileSync("git", ["add", "--", ...changed], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  return changed;
}

function main() {
  let changed = [];
  try {
    changed = regenerateAndRestage(REPO_DEFAULT);
  } catch (e) {
    process.stderr.write(`⚠ post-merge-regen: unexpected error — ${e?.message || e}\n`);
    return 0; // never block a merge commit over this
  }
  if (changed.length) process.stdout.write(`✅ post-merge-regen: corrected ${changed.join(", ")} against the complete merged tree.\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
