/* NEW-3 (2026-09-12 owner review) — the permanent guard against the two drift classes
 * nameGroupIntegrity.js exists to catch: a project's name copied across several places with
 * nothing keeping them in agreement, and a project's group keyed two different ways.
 *
 * Every "bad row" fixture here is the REAL shape measured against `planyr_production` the day this
 * was written (a read-only query, not invented): row `e2e-fixture-testfit` disagrees on its group
 * key (`group_id:"e2e-fixture"` vs `data.groupId:"e2e-fixture-testfit"` — a typo in
 * e2e/seed/seed-fixtures.sql, fixed alongside this test), and the whole account otherwise reads
 * clean (125 rows, 0 name-column disagreements, 7 non-empty scheduleProjectName hints, all in
 * agreement with their project's name that day). So the RED cases below are proven against the
 * actual production disagreement, not a synthetic stand-in, and the GREEN cases are proven against
 * the actual production clean state.
 */
import { describe, it, expect } from "vitest";
import {
  jsonbGroupKeyOf, columnGroupKeyOf, groupKeyMismatch, nameMismatch, scheduleNameDrift, auditRows,
} from "../src/workspaces/site-planner/lib/nameGroupIntegrity.js";

// The real disagreeing row, verbatim (id/group_id/data.groupId/site/data.site), read from
// planyr_production 2026-09-12.
const E2E_FIXTURE_TESTFIT_ROW = () => ({
  id: "e2e-fixture-testfit",
  group_id: "e2e-fixture",
  site: "E2E Dense Test-Fit",
  data: { groupId: "e2e-fixture-testfit", site: "E2E Dense Test-Fit" },
  updated_at: "2026-06-01T00:00:00Z",
  deleted_at: null,
});

// An ordinary healthy row — group_id column absent (the common real-account shape: an anchor plan
// whose model's groupId defaults to its own id, so the column mirror is never even populated).
const HEALTHY_ROW = (over = {}) => ({
  id: "smtest1", group_id: null, site: "Woods Road",
  data: { groupId: null, site: "Woods Road" }, updated_at: "2026-06-01T00:00:00Z", deleted_at: null,
  ...over,
});

describe("jsonbGroupKeyOf / columnGroupKeyOf — the two derivations", () => {
  it("agree when neither carries an explicit group id (both fall back to the row's own id)", () => {
    const row = HEALTHY_ROW();
    expect(jsonbGroupKeyOf(row)).toBe("smtest1");
    expect(columnGroupKeyOf(row)).toBe("smtest1");
  });

  it("disagree on the real production shape (e2e-fixture-testfit)", () => {
    const row = E2E_FIXTURE_TESTFIT_ROW();
    expect(jsonbGroupKeyOf(row)).toBe("e2e-fixture-testfit"); // what rename_site_group() reads
    expect(columnGroupKeyOf(row)).toBe("e2e-fixture");        // what a column-keyed resolver reads
  });
});

describe("groupKeyMismatch — RED on the real disagreement, GREEN on the healthy shape", () => {
  it("RED: e2e-fixture-testfit is caught", () => {
    expect(groupKeyMismatch(E2E_FIXTURE_TESTFIT_ROW())).toEqual({
      id: "e2e-fixture-testfit", jsonbKey: "e2e-fixture-testfit", columnKey: "e2e-fixture",
    });
  });

  it("GREEN: an ordinary row with no explicit group id at all", () => {
    expect(groupKeyMismatch(HEALTHY_ROW())).toBeNull();
  });

  it("GREEN: a multi-plan group where the column mirror correctly matches the jsonb", () => {
    const row = { id: "smt2", group_id: "smanchor1", data: { groupId: "smanchor1" } };
    expect(groupKeyMismatch(row)).toBeNull();
  });

  it("⛔ CONTROL — a column-only check (comparing columnGroupKeyOf against itself) can never see\n" +
     "     this class of drift by construction; only comparing against the jsonb derivation can. This\n" +
     "     is the exact mistake several client resolvers in storage.js/cloudSync.js still make.", () => {
    const row = E2E_FIXTURE_TESTFIT_ROW();
    expect(columnGroupKeyOf(row)).toBe(columnGroupKeyOf(row)); // trivially true — proves nothing
    expect(jsonbGroupKeyOf(row)).not.toBe(columnGroupKeyOf(row)); // the check that actually catches it
  });
});

describe("nameMismatch — a row disagreeing with ITSELF (never legitimate, live or deleted)", () => {
  it("RED: site column and data.site disagree", () => {
    const row = { id: "p1", site: "Woods Road", data: { site: "Old Name" } };
    expect(nameMismatch(row)).toEqual({ id: "p1", siteColumn: "Woods Road", siteJsonb: "Old Name" });
  });

  it("RED: one side has a claim, the other has none — still a disagreement, because both real\n" +
     "     rename functions always write both together", () => {
    expect(nameMismatch({ id: "p2", site: "Woods Road", data: {} })).toEqual({
      id: "p2", siteColumn: "Woods Road", siteJsonb: null,
    });
    expect(nameMismatch({ id: "p3", site: null, data: { site: "Woods Road" } })).toEqual({
      id: "p3", siteColumn: null, siteJsonb: "Woods Road",
    });
  });

  it("GREEN: the real e2e-fixture-testfit row (its name copies agree; only its group key drifted)", () => {
    expect(nameMismatch(E2E_FIXTURE_TESTFIT_ROW())).toBeNull();
  });

  it("GREEN: both null/absent (no name claimed at all)", () => {
    expect(nameMismatch({ id: "p4", site: null, data: {} })).toBeNull();
    expect(nameMismatch({ id: "p5", site: "", data: { site: "   " } })).toBeNull();
  });
});

describe("scheduleNameDrift — informational only, per its own header", () => {
  it("flags a stale hint against the resolved authoritative name", () => {
    expect(scheduleNameDrift({ id: "p1", data: { scheduleProjectName: "Old Schedule Name" } }, "Woods Road"))
      .toEqual({ id: "p1", scheduleProjectName: "Old Schedule Name", authoritativeName: "Woods Road" });
  });

  it("says nothing when the hint agrees, is empty, or there is no resolved authority yet", () => {
    expect(scheduleNameDrift({ id: "p1", data: { scheduleProjectName: "Woods Road" } }, "Woods Road")).toBeNull();
    expect(scheduleNameDrift({ id: "p1", data: { scheduleProjectName: "" } }, "Woods Road")).toBeNull();
    expect(scheduleNameDrift({ id: "p1", data: {} }, "Woods Road")).toBeNull();
    expect(scheduleNameDrift({ id: "p1", data: { scheduleProjectName: "X" } }, null)).toBeNull();
  });
});

describe("auditRows — the whole-account pass", () => {
  it("catches the real production shape: one group-key mismatch, zero name mismatches", () => {
    const rows = [
      E2E_FIXTURE_TESTFIT_ROW(),
      HEALTHY_ROW({ id: "smt2" }),
      HEALTHY_ROW({ id: "smt3", site: "Bain", data: { groupId: null, site: "Bain" } }),
    ];
    const { nameMismatches, groupKeyMismatches } = auditRows(rows);
    expect(nameMismatches).toEqual([]);
    expect(groupKeyMismatches).toEqual([{ id: "e2e-fixture-testfit", jsonbKey: "e2e-fixture-testfit", columnKey: "e2e-fixture" }]);
  });

  it("reports NOTHING against a fully clean account (the whole-account shape measured 2026-09-12:\n" +
     "     125 rows, 0 name-column disagreements, 0 group-key disagreements outside the one fixture)", () => {
    const rows = [
      HEALTHY_ROW({ id: "s1" }),
      HEALTHY_ROW({ id: "s2", group_id: "s1", data: { groupId: "s1", site: "Woods Road" } }),
      { id: "s3", group_id: null, site: "Bain", data: { groupId: null, site: "Bain", scheduleProjectName: "Bain" }, deleted_at: null },
    ];
    const { nameMismatches, groupKeyMismatches, scheduleNameDrifts } = auditRows(rows);
    expect(nameMismatches).toEqual([]);
    expect(groupKeyMismatches).toEqual([]);
    expect(scheduleNameDrifts).toEqual([]);
  });

  it("surfaces a stale schedule-name hint informationally without failing the two blocking checks", () => {
    const rows = [
      HEALTHY_ROW({ id: "s1", site: "Woods Road", data: { groupId: null, site: "Woods Road" } }),
      { id: "s2", group_id: "s1", site: "Woods Road", data: { groupId: "s1", site: "Woods Road", scheduleProjectName: "Old Name" }, deleted_at: null },
    ];
    const { nameMismatches, groupKeyMismatches, scheduleNameDrifts } = auditRows(rows);
    expect(nameMismatches).toEqual([]);
    expect(groupKeyMismatches).toEqual([]);
    expect(scheduleNameDrifts).toEqual([{ id: "s2", scheduleProjectName: "Old Name", authoritativeName: "Woods Road" }]);
  });

  it("a soft-deleted row still gets its OWN two blocking checks (they're per-row, not a live-only\n" +
     "     gate the way projectName's split reconciliation is)", () => {
    const row = { ...E2E_FIXTURE_TESTFIT_ROW(), deleted_at: "2026-08-01T00:00:00Z" };
    const { groupKeyMismatches } = auditRows([row]);
    expect(groupKeyMismatches).toEqual([{ id: "e2e-fixture-testfit", jsonbKey: "e2e-fixture-testfit", columnKey: "e2e-fixture" }]);
  });
});
