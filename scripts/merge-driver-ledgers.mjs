#!/usr/bin/env node
/*
 * merge-driver-ledgers.mjs — the git MERGE DRIVER for the two GENERATED ledger files (NEW-1).
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT resolve-ledgers.mjs AGAIN. MAP.md and BACKLOG_OPEN.md are
 * regenerated on almost every PR (`build-map.mjs` on any file add/remove/rename, `build-backlog-
 * index.mjs` on any BACKLOG.md edit), so on a busy day any PR open more than ~20 minutes conflicts
 * on them by construction — PR #1245 hit it twice in one session. `resolve-ledgers.mjs` already
 * fixes this correctly, but as a MANUAL command someone has to remember to run after a conflicted
 * `git merge` leaves markers behind. A git MERGE DRIVER (gitattributes(5), `merge=<name>`) makes
 * the identical fix happen INSIDE `git merge` itself for these two paths — no conflict is ever
 * shown for them in the common case.
 *
 * SCOPE — MAP.md and BACKLOG_OPEN.md ONLY, matching `.gitattributes`. BACKLOG.md / BACKLOG-DONE.md
 * / VERIFICATION.md / VERIFICATION-DONE.md deliberately stay on the manual `resolve-ledgers.mjs`
 * path: a merge driver is per-file and cannot see across files, and the UNION_FILES resolution
 * depends on a CROSS-FILE post-condition (re-running CI's own duplicate-id detectors over the
 * live+archive PAIR, rolling back the whole union if it would introduce one) that cannot fit a
 * single-file driver's contract. This was considered and ruled out deliberately — do not widen it.
 *
 * ⛔ A MERGE DRIVER RUNS BEFORE GIT HAS CHECKED OUT *ANYTHING* THE MERGE CHANGES — MEASURED, NOT
 * ASSUMED. git's recursive/ort strategy computes the ENTIRE merged tree in memory — invoking every
 * path's content merge, including custom drivers — and only writes the result to the working tree
 * (and even `MERGE_HEAD` itself) as its LAST step, once every path is resolved. Proved directly: an
 * instrumented driver invocation showed `src/` on disk holding only whichever branch was already
 * checked out, with "theirs"' newly-added file entirely absent, and `.git/MERGE_HEAD` not yet
 * written at all — for a merge that went on to complete with zero conflicts and no ref to "theirs"
 * ever having existed on disk at driver time. So a naive re-run of `build-map.mjs` here (a plain
 * `readdirSync` of `src/`) silently produces a MAP.md missing whichever files the OTHER side added
 * — passing with NO conflict shown, which is exactly the "silently wrong" failure class this
 * repo's LOUD-FAILURE rule exists to catch. BACKLOG_OPEN.md has the identical hazard one file
 * removed: it depends on BACKLOG.md, a path this driver does not control, whose own merge result
 * is equally not yet on disk.
 *
 * THE FIX HAS TWO LAYERS, DELIBERATELY, BECAUSE NEITHER ALONE IS BOTH SAFE AND COMPLETE:
 *   1. THIS DRIVER (mid-merge, necessarily a partial view) — seeds the union of both sides'
 *      hand-authored descriptions and re-runs the real generator against whatever the working
 *      tree currently holds. Good enough to avoid a shown conflict in the common case, and the
 *      B384432 description-loss check below is unaffected by file-set incompleteness (it only
 *      compares descriptions for paths present in the RESULT).
 *   2. `scripts/post-merge-regen.mjs`, run from the `.githooks/post-merge` hook — fires only once
 *      git has resolved every path with NO conflicts left anywhere and the commit is made, which
 *      is exactly the point (confirmed empirically) where the working tree IS complete. It re-runs
 *      the SAME unmodified generators there and re-stages the result if it differs, so the
 *      correction is immediately visible (`git status`) and one more commit away, regardless of
 *      what this driver could see mid-merge. See that script's header for the rest of this story,
 *      including why it can only STAGE the fix rather than fold it into the merge commit itself.
 * A merge that also has a genuine, separate conflict on some OTHER file never reaches step 2
 * automatically (the merge does not "execute automatically" in git's terms) — the person resolving
 * that conflict already re-runs the generators by hand per the Definition of Done, which is the
 * pre-existing, documented expectation this doesn't change.
 *
 * REUSES resolve-ledgers.mjs's `seedGenerated` / `GENERATED` / `lostDescriptions` rather than
 * re-deriving the regeneration logic. See that file's header for why "generated" does not mean
 * "fully derived": MAP.md's one-line descriptions are hand-authored and preserved from whatever
 * copy is on disk when the generator runs, so seeding from only one side of a merge silently
 * destroyed 48 of them on PR #978 (B384432). The same seeding function is reused here, so that fix
 * cannot regress independently in two places.
 *
 * HOW GIT INVOKES THIS. `.gitattributes` names `merge=planyr-ledger` for these two paths; the
 * actual command lives in LOCAL git config (`merge.planyr-ledger.driver`), wired by
 * `scripts/install-hooks.mjs` (the same self-installer that arms the mint-gate pre-push hook and
 * the post-merge backstop hook above) — `.gitattributes` is committed, but
 * `merge.<name>.driver` is local-only config, so a clone with the hook installer never run
 * silently gets NO merge driver at all (git falls back to an ordinary merge with no error). See
 * install-hooks.mjs for the loud detection of that gap.
 *
 * Git calls it as:  <this file> %O %A %B %P   (ancestor, ours, theirs, path) and takes WHATEVER IS
 * LEFT IN %A as the merged result, regardless of exit status — a non-zero exit only marks the path
 * as unmerged (`git status` shows a real conflict) so a human still has to look. The ancestor (%O)
 * is not read as text: like resolve-ledgers.mjs, this regenerates fresh from the UNION of both
 * sides' descriptions rather than a 3-way text diff.
 *
 * LOUD-FAILURE. If regeneration throws, or the B384432 loss check trips, this driver does NOT
 * write a half-merged generated file — it writes ordinary conflict markers into %A and exits
 * non-zero, exactly as if no driver had run at all. A driver that silently commits a broken
 * generated file is strictly worse than the conflict it was built to remove.
 *
 *   git merge <branch>                                  → fires automatically for these two paths
 *   node scripts/merge-driver-ledgers.mjs %O %A %B %P    → what git actually runs (never by hand)
 */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { GENERATED, seedGenerated, lostDescriptions } from "./resolve-ledgers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/**
 * The decision core. Given both sides' text for a registered generated file, seed the union onto
 * disk, run its real build script, and check the B384432 loss post-condition. `repo` defaults to
 * this module's own location (the normal case: git always invokes the COMMITTED copy of this
 * script, which lives inside the very repo it is merging), and is only overridden by tests.
 *
 * Returns `{ ok:true, resultText }` or `{ ok:false, reason }` — never throws, so the CLI wrapper
 * can turn a failure into conflict markers instead of an uncaught exception.
 */
export function mergeGenerated({ file, oursText, theirsText, repo = REPO }) {
  const entry = GENERATED.find((g) => g.file === file);
  if (!entry) {
    return {
      ok: false,
      reason: `"${file}" is not one of the registered generated ledgers (${GENERATED.map((g) => g.file).join(", ")}) — refusing to guess how to merge it.`,
    };
  }

  seedGenerated(file, { ours: oursText, theirs: theirsText }, repo);
  try {
    execFileSync(process.execPath, [join(repo, ...entry.build[0].split("/"))], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const detail = (e?.stderr || e?.message || String(e)).toString().trim().slice(0, 500);
    return { ok: false, reason: `regenerating ${file} via ${entry.build[0]} threw: ${detail}` };
  }

  const resultText = readFileSync(join(repo, file), "utf8");
  const lost = lostDescriptions(oursText, theirsText, resultText);
  if (lost.length) {
    return {
      ok: false,
      reason: `regenerated ${file} is MISSING ${lost.length} hand-authored description(s) that existed before the merge: ` +
        `${lost.slice(0, 8).join(", ")}${lost.length > 8 ? `, +${lost.length - 8} more` : ""} (B384432)`,
    };
  }

  return { ok: true, resultText };
}

/**
 * Ordinary textual conflict markers — the exact shape resolve-ledgers.mjs's own `resolveConflicts`
 * parses, so a human (or that script) can still finish the job by hand after this driver refuses.
 */
export function conflictMarkers(oursText, theirsText) {
  const withEol = (t) => (t.endsWith("\n") ? t : `${t}\n`);
  return `<<<<<<< ours\n${withEol(oursText)}=======\n${withEol(theirsText)}>>>>>>> theirs\n`;
}

/* Same evidence trail as resolve-ledgers.mjs's `.planyr-ledger-merges.log` (gitignored), so both
 * the manual and automatic paths' outcomes stay countable in one place. Best-effort: a logging
 * failure must never turn a resolved (or correctly-refused) merge into a broken one. */
function logRun(row) {
  try { appendFileSync(join(REPO, ".planyr-ledger-merges.log"), `${new Date().toISOString()} ${JSON.stringify(row)}\n`); }
  catch { /* never fatal */ }
}

function main(argv) {
  const [, oursPath, theirsPath, pathArg] = argv; // %O %A %B %P — the ancestor is unused, see header
  if (!oursPath || !theirsPath) {
    process.stderr.write(
      "⛔ merge-driver-ledgers.mjs: expected git's %O %A %B %P arguments — this is meant to run\n" +
      "   only as a configured git merge driver (merge.planyr-ledger.driver), never invoked by hand.\n");
    return 2;
  }
  const oursText = readFileSync(oursPath, "utf8");
  const theirsText = readFileSync(theirsPath, "utf8");
  const file = pathArg ? basename(pathArg) : basename(oursPath);

  const res = mergeGenerated({ file, oursText, theirsText, repo: REPO });
  if (res.ok) {
    writeFileSync(oursPath, res.resultText);
    logRun({ outcome: "resolved", file });
    process.stdout.write(`✅ merge driver: regenerated ${file} — both sides reconciled, nothing left for you to resolve.\n`);
    return 0;
  }

  writeFileSync(oursPath, conflictMarkers(oursText, theirsText));
  process.stderr.write(
    `\n⛔ LEDGER MERGE DRIVER FAILED for ${file}: ${res.reason}\n` +
    `   Leaving ordinary conflict markers in place — this is exactly as if no driver had run at all.\n` +
    `   Resolve by hand, or run: node scripts/resolve-ledgers.mjs\n\n`);
  logRun({ outcome: "failed", file, reason: res.reason });
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
