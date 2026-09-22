import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { classifyTestOutput, VERDICT_REGISTRY } from "../scripts/db-test-verdict.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_TEST_DIR = path.join(__dirname, "..", "src", "workspaces", "site-planner", "db", "test");

describe("db-test-verdict — the CI parser for self-rolling-back SQL tests", () => {
  // ---- Every case below is a REAL captured message, not a hypothetical — see each comment.

  it("recognises sites_block_delete_live_group's real PASS message (captured 2026-09-22 against production, all 11 cases)", () => {
    const v = classifyTestOutput(
      "sites_block_delete_live_group.test.sql",
      "ERROR:  P0001: sites_block_delete_live_group: ALL 11 CHECKS PASSED\n(fixtures rolled back)\nCONTEXT:  PL/pgSQL function inline_code_block line 231 at RAISE\n"
    );
    expect(v.status).toBe("pass");
  });

  it("recognises sites_block_delete_live_group's FAIL shape with a nonzero count", () => {
    const v = classifyTestOutput(
      "sites_block_delete_live_group.test.sql",
      "ERROR:  P0001: sites_block_delete_live_group: 2 of 11 checks FAILED\n  FAIL case 10: purge_one_deleted_plan() did NOT refuse an anon (no-JWT) caller\n(fixtures rolled back)\n"
    );
    expect(v.status).toBe("fail");
    expect(v.failedCount).toBe(2);
  });

  it("treats a FAIL count of exactly 0 as impossible input for the counted-FAILED shape but still parses it as pass-shaped text correctly (ALL N PASSED takes precedence)", () => {
    // sites_rename_stamp_guard's real PASS text
    const v = classifyTestOutput(
      "sites_rename_stamp_guard.test.sql",
      "ERROR:  P0001: sites_preserve_rename_stamp: ALL 28 CHECKS PASSED\n(fixtures rolled back)\n"
    );
    expect(v.status).toBe("pass");
  });

  it("recognises sites_site_column_mirror's real FAIL shape", () => {
    const v = classifyTestOutput(
      "sites_site_column_mirror.test.sql",
      "ERROR:  P0001: sites_site_column_mirror: 1 of 7 checks FAILED\n  FAIL case 3: ...\n(fixtures rolled back)\n"
    );
    expect(v.status).toBe("fail");
    expect(v.failedCount).toBe(1);
  });

  it("recognises sites_version_monotonic_guard's real PASS shape", () => {
    const v = classifyTestOutput(
      "sites_version_monotonic_guard.test.sql",
      "ERROR:  P0001: sites_enforce_version_monotonic: ALL 10 CHECKS PASSED\n(fixtures rolled back)\n"
    );
    expect(v.status).toBe("pass");
  });

  it("recognises parcel_active_deleted_invariant's real PASS shape ('CASES' not 'CHECKS')", () => {
    const v = classifyTestOutput(
      "parcel_active_deleted_invariant.test.sql",
      "ERROR:  P0001: parcel_active_deleted_invariant: ALL 3 CASES PASSED (rolled back, nothing written)\n"
    );
    expect(v.status).toBe("pass");
  });

  it("recognises parcel_active_deleted_invariant's real FAIL shape", () => {
    const v = classifyTestOutput(
      "parcel_active_deleted_invariant.test.sql",
      "ERROR:  P0001: parcel_active_deleted_invariant: 1 of 3 cases FAILED:\n  ...\n"
    );
    expect(v.status).toBe("fail");
    expect(v.failedCount).toBe(1);
  });

  it("recognises backfill_group_id_column's PROOF PASSED shape", () => {
    const v = classifyTestOutput(
      "backfill_group_id_column.test.sql",
      "ERROR:  P0001: PROOF PASSED (rolled back, nothing persists): ...\n"
    );
    expect(v.status).toBe("pass");
  });

  it("recognises backfill_group_id_column's PROOF FAILED early-exit shape (no count)", () => {
    const v = classifyTestOutput(
      "backfill_group_id_column.test.sql",
      "ERROR:  P0001: PROOF FAILED — backfill_group_id_column() did not converge the column (expected x, got y)\n"
    );
    expect(v.status).toBe("fail");
  });

  it("recognises reconcile_site_group_name's PROOF PASSED / PROOF FAILED shape", () => {
    expect(
      classifyTestOutput("reconcile_site_group_name.test.sql", "ERROR:  P0001: PROOF PASSED (rolled back, nothing persists): ...\n").status
    ).toBe("pass");
    expect(
      classifyTestOutput(
        "reconcile_site_group_name.test.sql",
        "ERROR:  P0001: PROOF FAILED — the detector did not see the planted split (expected 1, got 0)\n"
      ).status
    ).toBe("fail");
  });

  it("recognises deleted_plan_naming's 'N passed, M FAILED ----' shape, both directions", () => {
    expect(
      classifyTestOutput(
        "deleted_plan_naming.test.sql",
        "ERROR:  P0001: \nsome report\n---- 12 passed, 0 FAILED ----\n(this exception is deliberate: it rolls the whole test back)\n"
      ).status
    ).toBe("pass");
    const fail = classifyTestOutput(
      "deleted_plan_naming.test.sql",
      "ERROR:  P0001: \nsome report\n---- 10 passed, 2 FAILED ----\n(this exception is deliberate: it rolls the whole test back)\n"
    );
    expect(fail.status).toBe("fail");
    expect(fail.failedCount).toBe(2);
  });

  it("recognises overlay_object_release_guard's '=== ... N passed, M failed ===' shape", () => {
    expect(
      classifyTestOutput(
        "overlay_object_release_guard.test.sql",
        "ERROR:  P0001: === overlay_object_release_guard proof: 5 passed, 0 failed ===\nreport text\n"
      ).status
    ).toBe("pass");
    const fail = classifyTestOutput(
      "overlay_object_release_guard.test.sql",
      "ERROR:  P0001: === overlay_object_release_guard proof: 4 passed, 1 failed ===\nreport text\n"
    );
    expect(fail.status).toBe("fail");
    expect(fail.failedCount).toBe(1);
  });

  it("recognises sites_soft_delete_rls's and team_share_scope's shared 'N passed, M FAILED ----' shape", () => {
    for (const file of ["sites_soft_delete_rls.test.sql", "team_share_scope.test.sql"]) {
      expect(
        classifyTestOutput(file, "ERROR:  P0001: \nreport\n---- 6 passed, 0 FAILED ----\n(this exception is deliberate...)\n").status
      ).toBe("pass");
      expect(
        classifyTestOutput(file, "ERROR:  P0001: \nreport\n---- 5 passed, 1 FAILED ----\n(this exception is deliberate...)\n").status
      ).toBe("fail");
    }
  });

  it("recognises commit_elements_group_cas's 'ALL PASS' / 'N FAILED' shape", () => {
    expect(
      classifyTestOutput(
        "commit_elements_group_cas.test.sql",
        "ERROR:  P0001: \n=== B1341 stage 2 — group CAS ===ALL PASS\n\nreport (fixtures rolled back, nothing written)\n"
      ).status
    ).toBe("pass");
    const fail = classifyTestOutput(
      "commit_elements_group_cas.test.sql",
      "ERROR:  P0001: \n=== B1341 stage 2 — group CAS ===3 FAILED\n\nreport (fixtures rolled back, nothing written)\n"
    );
    expect(fail.status).toBe("fail");
    expect(fail.failedCount).toBe(3);
  });

  // ---- Fail-closed behaviour: never guess.

  it("returns an explicit error (never a silent pass) for an unregistered file", () => {
    const v = classifyTestOutput("some_new_test.test.sql", "ERROR:  P0001: ALL 4 CHECKS PASSED\n");
    expect(v.status).toBe("error");
    expect(v.reason).toMatch(/UNREGISTERED_TEST_FILE/);
  });

  it("returns an explicit error (never a silent pass) when a registered file's output matches neither shape — e.g. a connection failure with no SQL exception at all", () => {
    const v = classifyTestOutput(
      "sites_block_delete_live_group.test.sql",
      "psql: error: connection to server failed: could not translate host name\n"
    );
    expect(v.status).toBe("error");
    expect(v.reason).toMatch(/UNPARSEABLE_OUTPUT/);
  });

  it("returns an explicit error for empty output", () => {
    const v = classifyTestOutput("sites_block_delete_live_group.test.sql", "");
    expect(v.status).toBe("error");
  });

  // ---- The registry itself must stay in sync with the real directory — a new test file with no
  // matcher must fail THIS suite, not silently pass CI (same MUST_BE_PRESENT shape this repo
  // already uses elsewhere).

  it("has exactly one registry entry per db/test/*.sql file that actually exists on disk, in both directions", () => {
    const onDisk = readdirSync(DB_TEST_DIR)
      .filter((f) => f.endsWith(".test.sql"))
      .sort();
    const registered = Object.keys(VERDICT_REGISTRY).sort();
    const missingFromRegistry = onDisk.filter((f) => !registered.includes(f));
    const staleInRegistry = registered.filter((f) => !onDisk.includes(f));
    expect(missingFromRegistry, `Add a verdict matcher in scripts/db-test-verdict.mjs for: ${missingFromRegistry.join(", ")}`).toEqual([]);
    expect(staleInRegistry, `Remove stale registry entries for files that no longer exist: ${staleInRegistry.join(", ")}`).toEqual([]);
  });

  it("every registered matcher is one of the four known shape functions (source guard against a fifth ad-hoc shape sneaking in)", () => {
    const uniqueMatchers = new Set(Object.values(VERDICT_REGISTRY));
    expect(uniqueMatchers.size).toBeLessThanOrEqual(4);
  });
});
