#!/usr/bin/env node
/*
 * generated-doc-touch-guard.mjs — CI gate (NEW-1, B<PENDING>, 2026-09-08): a branch must never
 * touch a committed, GENERATED index — MAP.md, BACKLOG_OPEN.md, docs/UI-INVENTORY.md.
 *
 * WHY. All three are wholly rewritten by their own generator on every regen, so the old regime —
 * "regenerate it in the same commit whenever its input changes" — meant any two PRs open at the
 * same time that both touched one of these files conflicted on it by construction. Worse than an
 * ordinary conflict: GitHub computes a PR's required `build` check against a REAL test-merge ref
 * (`refs/pull/<n>/merge`), and it cannot even build that ref while the PR conflicts — so the
 * required check never runs at all and sits at "Expected — waiting for status to be reported"
 * forever, which blocks the merge, which means main goes longer before the next merge, which
 * makes the next PR's conflict more likely. Measured 2026-09-08: PR #1529 re-conflicted on these
 * exact files three times in one hour and produced zero workflow runs while conflicted.
 *
 * `.gitattributes` already gives MAP.md/BACKLOG_OPEN.md a `merge=union` driver so a LOCAL
 * `git merge` resolves cleanly (see that file's own header) — but GitHub's server-side
 * mergeability computation does not consult it (confirmed empirically the same night: the union
 * driver was already in place and PR #1529 conflicted anyway), so that fix cannot reach the
 * problem this guard exists for.
 *
 * THE FIX: stop branches from touching these files at all. They are refreshed after the fact —
 * see `.github/workflows/regen-derived-docs.yml` — so no branch ever needs to carry a change to
 * them, and this gate makes that a hard rule rather than a convention. A generator's own drift
 * check (`build-map.mjs --check`, `build-backlog-index.mjs --check`, `ui-inventory.mjs --check`)
 * still exists for that scheduled job and for local use — see each script's own USAGE block for
 * the narrower per-PR replacement that stayed in `.github/ci-gates.yml` (a tag-legend guard, a
 * signature-budget guard) which check real content-quality rules that have nothing to do with
 * these files' own freshness.
 *
 * WHAT COUNTS AS A TOUCH: one of GENERATED_DOCS appears in `git diff --name-only
 * origin/main...HEAD` (triple-dot: against the MERGE BASE with origin/main, not its tip — the
 * same technique scripts/check-mint.mjs already relies on, so a branch that's behind main is
 * still measured from where it actually forked).
 *
 * EXEMPT, narrowly:
 *   - a push to `main` itself — that IS the intended lifecycle point for these files to change
 *     (a merged regen PR, or a maintainer's manual regen-after-conflict-resolution commit);
 *   - a branch whose name starts with `chore/regen-derived-docs` (the scheduled job's own branch
 *     prefix — see the workflow above) — but ONLY when its diff touches nothing OUTSIDE the three
 *     generated files, so this exemption can never be used to smuggle an unrelated change past the
 *     gate under that branch name.
 * This very branch (the one that introduces this rule) is the one deliberate one-time exception:
 * it changes the generator scripts themselves and therefore legitimately updates their output in
 * the same commit — see BACKLOG.md's own entry for why that is not a violation of the rule it adds.
 *
 * MODES:
 *   node scripts/generated-doc-touch-guard.mjs         → gate; exit 0 clean, 1 violation, 2 unverifiable
 *   node scripts/generated-doc-touch-guard.mjs --json  → machine-readable verdict
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tryGit, selfBranchNames } from "./next-id.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

export const GENERATED_DOCS = ["MAP.md", "BACKLOG_OPEN.md", "docs/UI-INVENTORY.md"];
/* NEW-1 (ledger, 2026-10-05): these four are the OLD hand-edited ledger files. Once `ledger/` is on
 * origin/main the two live ones are GENERATED VIEWS and the two archives no longer exist, so editing
 * (or re-creating) any of them is the old way of filing an entry — it conflicts with every other PR
 * that does, and GitHub's server-side merge ignores `merge=union`. File entries under ledger/ instead
 * (CLAUDE.md "LEDGER"; `node scripts/ledger.mjs --help`). Only enforced while the ledger is in force,
 * so the PR that introduces the ledger is not blocked by its own rule. */
export const RETIRED_LEDGER_FILES = ["BACKLOG.md", "VERIFICATION.md", "docs/archive/BACKLOG-DONE.md", "docs/archive/VERIFICATION-DONE.md"];
const REFRESHABLE_BY_REGEN = (f) => GENERATED_DOCS.includes(f) || RETIRED_LEDGER_FILES.slice(0, 2).includes(f);
export const REGEN_BRANCH_PREFIX = "chore/regen-derived-docs";
const MAIN_BRANCH_NAMES = new Set(["main", "refs/heads/main"]);

/** Is `name` the scheduled regen job's own branch? */
export function isRegenBranch(name) {
  return typeof name === "string" && name.startsWith(REGEN_BRANCH_PREFIX);
}

/**
 * PURE verdict. `branchNames` — every name this checkout might be known by (see
 * `selfBranchNames`); `changedFiles` — the full set of repo-relative paths this branch's diff
 * touches, relative to its merge base with main.
 */
export function verdict({ branchNames = [], changedFiles = [], ledgerInForce = false }) {
  if (branchNames.some((n) => MAIN_BRANCH_NAMES.has(n))) {
    return { ok: true, reason: "push to main — the intended lifecycle point for these files to change." };
  }
  const guarded = (f) => GENERATED_DOCS.includes(f) || (ledgerInForce && RETIRED_LEDGER_FILES.includes(f));
  const touched = changedFiles.filter(guarded);
  if (!touched.length) return { ok: true, touched: [] };

  const onlyGenerated = changedFiles.every(REFRESHABLE_BY_REGEN);
  if (branchNames.some(isRegenBranch) && onlyGenerated) {
    return { ok: true, touched, reason: `exempt: ${REGEN_BRANCH_PREFIX}* branch, diff touches only generated docs` };
  }
  return { ok: false, touched };
}

/** Run the gate against a real checkout. Returns `{ ok, unverifiable, reason, touched, branch }`. */
export function runGate(repo = REPO) {
  const fetch = tryGit(repo, "git fetch --no-tags --quiet origin main");
  if (!fetch.ok) return { unverifiable: true, reason: `could not fetch origin/main — ${fetch.reason}` };

  const branchNames = selfBranchNames(repo);
  const diff = tryGit(repo, "git diff --name-only origin/main...HEAD");
  if (!diff.ok) return { unverifiable: true, reason: `could not diff against origin/main — ${diff.reason}` };
  const changedFiles = diff.out.split("\n").map((l) => l.trim()).filter(Boolean);

  const ledgerInForce = tryGit(repo, "git cat-file -e origin/main:ledger/backlog/_frame.md").ok;
  const v = verdict({ branchNames, changedFiles, ledgerInForce });
  return { ...v, branch: branchNames[0] || "(detached)" };
}

// ---- CLI -------------------------------------------------------------------------------
function main(argv) {
  const json = argv.includes("--json");
  const res = runGate();

  if (json) process.stdout.write(JSON.stringify(res) + "\n");

  if (res.unverifiable) {
    if (!json) {
      process.stderr.write(
        `\n⚠ Generated-index touch guard UNVERIFIED: ${res.reason}\n` +
          `   Not failing the build on an infrastructure problem — but this PR is unguarded for this check.\n`,
      );
    }
    return 0;
  }

  if (res.ok) {
    if (!json) {
      process.stdout.write(
        res.touched?.length
          ? `✅ Generated-index touch guard: ${res.branch} touches ${res.touched.join(", ")} — exempt (${res.reason}).\n`
          : `✅ Generated-index touch guard: ${res.branch} does not touch ${GENERATED_DOCS.join(", ")} (nor, once ledger/ is in force, the old ledger files).\n`,
      );
    }
    return 0;
  }

  if (!json) {
    process.stderr.write(
      `\n⛔ GENERATED-INDEX TOUCH GUARD FAILED (NEW-1) — this branch modifies a GENERATED file:\n\n` +
        `   ${res.touched.join("\n   ")}\n\n` +
        `   These files are wholly rewritten by their own generator (scripts/build-map.mjs,\n` +
        `   scripts/build-backlog-index.mjs, ui-audit/ui-inventory.mjs), so any two PRs open at once\n` +
        `   that both touch one conflict on it by construction — and GitHub can't even compute a\n` +
        `   test-merge for a conflicted PR, so the required "build" check never runs at all.\n\n` +
        `   (BACKLOG.md / VERIFICATION.md / docs/archive/*-DONE.md: the ledger is now ONE FILE PER ENTRY under\n` +
        `   ledger/ — file, edit and move entries there; \`node scripts/ledger.mjs --help\`. A branch that\n` +
        `   edited the old files: \`node scripts/ledger.mjs import-legacy <base> <tip>\`.)\n\n` +
        `   → Revert your changes to these files (\`git checkout origin/main -- <file>\`). They are\n` +
        `     refreshed automatically by .github/workflows/regen-derived-docs.yml after your PR merges —\n` +
        `     you never need to touch them yourself.\n\n`,
    );
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
