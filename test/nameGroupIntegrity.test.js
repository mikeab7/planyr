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
  jsonbGroupKeyOf, columnGroupKeyOf, groupKeyMismatch, nameMismatch, unstampedRow, scheduleNameDrift,
  scheduleNameStaleAgainstLive, auditRows,
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

describe("unstampedRow — a row with no valid rename stamp for sites_preserve_rename_stamp to protect (NEW-1, 2026-09-15)", () => {
  it("RED: no siteRenamedAt key at all — the real smu1z3h60nbu shape measured 2026-09-15", () => {
    expect(unstampedRow({ id: "smu1z3h60nbu", data: { groupId: "smu1z3h60nbu", site: "Untitled site" } }))
      .toEqual({ id: "smu1z3h60nbu" });
  });

  it("RED: a present-but-empty marker (JSON null) — the pre-2026-09-10 write shape", () => {
    expect(unstampedRow({ id: "p1", data: { site: "X", siteRenamedAt: null } })).toEqual({ id: "p1" });
  });

  it("RED: no data object at all", () => {
    expect(unstampedRow({ id: "p2", data: null })).toEqual({ id: "p2" });
  });

  it("GREEN: a real epoch-ms stamp", () => {
    expect(unstampedRow({ id: "p3", data: { site: "X", siteRenamedAt: 1785525795307 } })).toBeNull();
  });

  it("GREEN: a numeric-string stamp — renameStamp's own tolerance (PostgREST's data->>'x' shape); a\n" +
     "     row this check flags must agree with what projectName.renameStamp — the ONE parse — says,\n" +
     "     never a stricter re-derivation", () => {
    expect(unstampedRow({ id: "p4", data: { site: "X", siteRenamedAt: "1785525795307" } })).toBeNull();
  });

  it("a row with no id is never reported (nothing to name)", () => {
    expect(unstampedRow({ data: {} })).toBeNull();
    expect(unstampedRow(null)).toBeNull();
  });
});

describe("scheduleNameDrift — BLOCKING (promoted NEW-1/B1793504, 2026-09-20; see its own header)", () => {
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

describe("scheduleNameStaleAgainstLive — B1768080, informational only, per its own header", () => {
  // The real shape read from planyr_production 2026-09-18: schedule id 30 was renamed to
  // "MUD v PID"; these four `sites` rows in group smqfy48tlk9j still carry the pre-rename hint.
  const LIVE_NAMES = new Map([["30", "MUD v PID"], ["15", "Richfield"]]);

  it("RED: the real production divergence (schedule 30 renamed, the site's stored hint did not follow)", () => {
    const row = { id: "sms69x8rb2qk", data: { scheduleProjectId: "30", scheduleProjectName: "Goose Creek" } };
    expect(scheduleNameStaleAgainstLive(row, LIVE_NAMES)).toEqual({
      id: "sms69x8rb2qk", scheduleProjectId: "30", storedName: "Goose Creek", liveName: "MUD v PID",
    });
  });

  it("GREEN: a hint that still agrees with its schedule's live name (Richfield, schedule 15)", () => {
    const row = { id: "smt7q6ar8egz", data: { scheduleProjectId: "15", scheduleProjectName: "Richfield" } };
    expect(scheduleNameStaleAgainstLive(row, LIVE_NAMES)).toBeNull();
  });

  it("GREEN: no schedule linked, no live map, or the schedule id isn't one the caller fetched (a\n" +
     "     deleted schedule, or a schedule this run's fetch didn't include) — never guesses", () => {
    expect(scheduleNameStaleAgainstLive({ id: "p1", data: {} }, LIVE_NAMES)).toBeNull();
    expect(scheduleNameStaleAgainstLive({ id: "p2", data: { scheduleProjectId: "30", scheduleProjectName: "Goose Creek" } }, null)).toBeNull();
    // schedule ids 21/23 — real production shape: linked on the site side, but no longer present
    // in planar_data's projects at all (a deleted schedule).
    expect(scheduleNameStaleAgainstLive({ id: "p3", data: { scheduleProjectId: "21", scheduleProjectName: "Goose Creek" } }, LIVE_NAMES)).toBeNull();
  });

  it("a live name of null is still a real answer and can itself disagree with a stored hint", () => {
    const row = { id: "p1", data: { scheduleProjectId: "9", scheduleProjectName: "Old Name" } };
    expect(scheduleNameStaleAgainstLive(row, new Map([["9", null]]))).toEqual({
      id: "p1", scheduleProjectId: "9", storedName: "Old Name", liveName: null,
    });
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

  it("surfaces a stale schedule-name hint in the BLOCKING bucket, without tripping the other three", () => {
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

  it("NEW-1 (2026-09-15): catches a row with no valid rename stamp — the real smu1z3h60nbu shape,\n" +
     "     whether it is live or (per rename_stamp_backfill_20260912.sql's own trashed-included\n" +
     "     scope) soft-deleted", () => {
    const stamped = { id: "s1", group_id: null, site: "Woods Road", data: { groupId: null, site: "Woods Road", siteRenamedAt: 1785525795307 }, deleted_at: null };
    const newborn = { id: "smu1z3h60nbu", group_id: null, site: "Untitled site", data: { groupId: "smu1z3h60nbu", site: "Untitled site" }, deleted_at: null };
    const trashed = { id: "t1", group_id: null, site: "Old Draft", data: { groupId: "t1", site: "Old Draft" }, deleted_at: "2026-08-01T00:00:00Z" };
    const { unstampedRows } = auditRows([stamped, newborn, trashed]);
    expect(unstampedRows).toEqual([{ id: "smu1z3h60nbu" }, { id: "t1" }]);
  });

  it("reports NOTHING for unstampedRows once every row carries a valid stamp — the whole-account\n" +
     "     shape measured 2026-09-15 after the INSERT-trigger fix and the one-row repair (127/127)", () => {
    const rows = [
      { id: "s1", data: { groupId: null, site: "Woods Road", siteRenamedAt: 1785525795307 }, deleted_at: null },
      { id: "s2", data: { groupId: "s1", site: "Woods Road", siteRenamedAt: 1785525795307 }, deleted_at: null },
    ];
    const { unstampedRows } = auditRows(rows);
    expect(unstampedRows).toEqual([]);
  });

  it("B1768080: with a live schedule-name map, surfaces the real production divergence (schedule\n" +
     "     30 renamed to \"MUD v PID\") informationally, without touching the four blocking checks —\n" +
     "     the site's OWN name never changed here, so scheduleNameDrift correctly stays silent", () => {
    const rows = [
      HEALTHY_ROW({ id: "sms69x8rb2qk", group_id: "smqfy48tlk9j", site: "Goose Creek", data: { groupId: "smqfy48tlk9j", site: "Goose Creek", scheduleProjectId: "30", scheduleProjectName: "Goose Creek", siteRenamedAt: 1785525795307 } }),
      { id: "smt7q6ar8egz", group_id: "smsdrvzr9gzx", site: "Richfield", data: { groupId: "smsdrvzr9gzx", site: "Richfield", scheduleProjectId: "15", scheduleProjectName: "Richfield", siteRenamedAt: 1785525795307 }, deleted_at: null },
    ];
    const liveScheduleNameById = new Map([["30", "MUD v PID"], ["15", "Richfield"]]);
    const out = auditRows(rows, { liveScheduleNameById });
    expect(out.nameMismatches).toEqual([]);
    expect(out.groupKeyMismatches).toEqual([]);
    expect(out.unstampedRows).toEqual([]);
    expect(out.scheduleNameDrifts).toEqual([]);
    expect(out.scheduleNameStaleVsLive).toEqual([
      { id: "sms69x8rb2qk", scheduleProjectId: "30", storedName: "Goose Creek", liveName: "MUD v PID" },
    ]);
  });

  it("NEW-1 (B1793504, 2026-09-20): a SITE rename that never re-mirrors scheduleProjectName is\n" +
     "     caught in the BLOCKING bucket — the real bug this promotion exists to catch (a rename\n" +
     "     that changes the group's authoritative name while the hint keeps its pre-rename value)", () => {
    const rows = [
      HEALTHY_ROW({ id: "g1", group_id: null, site: "MUD v PID", data: { groupId: null, site: "MUD v PID", scheduleProjectId: "30", scheduleProjectName: "Goose Creek", siteRenamedAt: 1785525795307 } }),
    ];
    const out = auditRows(rows);
    expect(out.nameMismatches).toEqual([]);
    expect(out.groupKeyMismatches).toEqual([]);
    expect(out.unstampedRows).toEqual([]);
    expect(out.scheduleNameDrifts).toEqual([
      { id: "g1", scheduleProjectName: "Goose Creek", authoritativeName: "MUD v PID" },
    ]);
  });

  it("omits scheduleNameStaleVsLive entirely (not just empty-but-computed) when no live map is given\n" +
     "     — the seeded unit suite's own default shape, since it has no scheduler backend to fetch", () => {
    const rows = [HEALTHY_ROW({ id: "s1" })];
    expect(auditRows(rows).scheduleNameStaleVsLive).toEqual([]);
  });
});
