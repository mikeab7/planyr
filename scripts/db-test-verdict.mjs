// scripts/db-test-verdict.mjs — B<PENDING> (NEW-2, 2026-09-20/22)
//
// WHY THIS IS A SEPARATE, PURE MODULE, AND WHY IT IS NOT ONE REGEX.
// ============================================================================================
// Every db/test/*.sql file in this repo is SELF-ROLLING-BACK: it always ends by raising a
// PL/pgSQL exception (RAISE EXCEPTION), on PASS *and* on FAIL alike, so no fixture row or real
// delete it performed during the test ever survives the transaction. That means a wrapper
// script CANNOT tell pass from fail by psql's exit code (which is non-zero either way) — it has
// to read the exception's own MESSAGE TEXT.
//
// The twelve files were written by different sessions over months and never agreed on a wording
// for that message: "ALL 11 CHECKS PASSED" vs "PROOF PASSED" vs "ALL PASS" vs "7 passed, 0
// FAILED ----" vs "PROOF FAILED" with no count at all. A single regex clever enough to cover all
// of that is exactly the kind of instrument this repo's own AGENT-RULES warns about — one that
// LOOKS like it works and is actually guessing. So this file is an EXPLICIT REGISTRY: one verdict
// matcher per file, each written directly against that file's own real raised-message text (see
// db/test/*.sql's own final `raise exception` statements — these patterns are not hypothetical).
//
// A file with NO registered matcher is a LOUD, NAMED failure (`UNREGISTERED_TEST_FILE`), never a
// silent skip or a guessed pass — the same fail-closed shape as this repo's `MUST_BE_PRESENT`
// vacuity guards. Adding a new db/test/*.sql file means adding one line here in the SAME commit,
// or CI refuses to run it.

// ---- The four report SHAPES actually in use, each proven against a captured real string below.

function allPassedOrCountedFail(text) {
  if (/ALL\s+\d+\s+(?:CHECKS?|CASES?)\s+PASSED/i.test(text)) return { status: "pass" };
  const m = text.match(/(\d+)\s+of\s+\d+\s+(?:checks?|cases?)\s+FAILED/i);
  if (m) return { status: "fail", failedCount: Number(m[1]) };
  return null;
}

function passedCommaFailed(text) {
  const m = text.match(/(\d+)\s+passed,\s*(\d+)\s+FAILED/i);
  if (!m) return null;
  const failedCount = Number(m[2]);
  return failedCount > 0 ? { status: "fail", failedCount } : { status: "pass" };
}

function proofPassedOrFailed(text) {
  if (/PROOF PASSED/.test(text)) return { status: "pass" };
  if (/PROOF FAILED/.test(text)) return { status: "fail", failedCount: null };
  return null;
}

function allPassLiteralOrCountedFail(text) {
  if (/ALL PASS/.test(text)) return { status: "pass" };
  const m = text.match(/(\d+)\s+FAILED/i);
  if (m) return { status: "fail", failedCount: Number(m[1]) };
  return null;
}

// ---- The registry. Key = the test file's basename. Value = which shape it uses.
// Every entry was checked against that file's actual `raise exception` text (2026-09-22).
export const VERDICT_REGISTRY = {
  "backfill_group_id_column.test.sql": proofPassedOrFailed,
  "commit_elements_group_cas.test.sql": allPassLiteralOrCountedFail,
  "deleted_plan_naming.test.sql": passedCommaFailed,
  "overlay_object_release_guard.test.sql": passedCommaFailed,
  "parcel_active_deleted_invariant.test.sql": allPassedOrCountedFail,
  "reconcile_site_group_name.test.sql": proofPassedOrFailed,
  "sites_block_delete_live_group.test.sql": allPassedOrCountedFail,
  "sites_rename_stamp_guard.test.sql": allPassedOrCountedFail,
  "sites_site_column_mirror.test.sql": allPassedOrCountedFail,
  "sites_soft_delete_rls.test.sql": passedCommaFailed,
  "sites_version_monotonic_guard.test.sql": allPassedOrCountedFail,
  "team_share_scope.test.sql": passedCommaFailed,
};

/**
 * Classify one test file's captured psql output (stdout+stderr combined) into a verdict.
 * NEVER guesses: an unregistered basename, a connection failure, or a message that matches
 * neither PASS nor FAIL for its registered shape all come back as an explicit "error" status
 * with a reason string — fail-closed, so an unparseable run can never read as green.
 */
export function classifyTestOutput(basename, output) {
  const matcher = VERDICT_REGISTRY[basename];
  if (!matcher) {
    return {
      status: "error",
      reason: `UNREGISTERED_TEST_FILE — no verdict matcher for "${basename}" in scripts/db-test-verdict.mjs. Add one in the same commit that adds this test file.`,
    };
  }
  const text = String(output || "");
  const verdict = matcher(text);
  if (!verdict) {
    return {
      status: "error",
      reason: `UNPARSEABLE_OUTPUT — "${basename}"'s registered matcher found neither a PASS nor a FAIL marker in the captured output. Treating as a failure rather than guessing.`,
    };
  }
  return verdict;
}
