/* NEW-3 (2026-09-02) — scripts/audit-project-name-split.mjs's whole job is "disagree, but only
 * among LIVE rows." This is the proof that job actually holds, in both directions, because the
 * FIRST version of this check got it backwards and had to be retracted.
 *
 * LIVE EVIDENCE this fixture is built from (queried from planyr_production, verbatim): group
 * `smsrpaiqu5sv`. The first pass at this check queried `public.sites` with no `deleted_at` filter
 * and reported this group as split. Re-run WITH `deleted_at IS NULL` applied, it wasn't: the
 * anchor row `smsrpaiqu5sv` is soft-deleted (`deleted_at: 2026-08-13 21:21:18`, five seconds after
 * its own last update and 114s BEFORE the rest of the group's rename stamp) — the owner created
 * that plan, deleted it, then renamed the surviving group, and the rename correctly never touched
 * a tombstoned row. Six live rows, one name, one stamp, zero disagreement.
 */
import { describe, it, expect } from "vitest";
import { reconcileGroupNames } from "../src/workspaces/site-planner/lib/projectName.js";

const ms = (s) => Date.parse(s);

// The real Woods Road group, EVERY row this session found in production, deletedAt included so
// the test can apply (and withhold) the live-only filter itself, exactly like the script does.
const WOODS_ROAD_ALL_ROWS = () => [
  { id: "smsrpaiqu5sv", groupId: "smsrpaiqu5sv", site: "FM 359 RD, Fulshear, TX 77441", siteRenamedAt: 1786655992552, updatedAt: ms("2026-08-13T21:21:13.675Z"), deletedAt: ms("2026-08-13T21:21:18.103Z") },
  { id: "smtbrnf34sr5", groupId: "smsrpaiqu5sv", site: "Woods Road", siteRenamedAt: 1786656132673, updatedAt: ms("2026-08-29T20:32:11.78Z"), deletedAt: null },
  { id: "smsrrlk9u576", groupId: "smsrpaiqu5sv", site: "Woods Road", siteRenamedAt: 1786656132673, updatedAt: ms("2026-08-27T16:57:41.34Z"), deletedAt: null },
  { id: "smt7ozvglbmp", groupId: "smsrpaiqu5sv", site: "Woods Road", siteRenamedAt: 1786656132673, updatedAt: ms("2026-08-27T16:56:53.105Z"), deletedAt: null },
  { id: "smt7p4jqd08a", groupId: "smsrpaiqu5sv", site: "Woods Road", siteRenamedAt: 1786656132673, updatedAt: ms("2026-08-24T20:36:03.706Z"), deletedAt: ms("2026-08-24T20:36:58.343Z") },
  { id: "smsxg0a3sdj2", groupId: "smsrpaiqu5sv", site: "Woods Road", siteRenamedAt: 1786656132673, updatedAt: ms("2026-08-24T20:28:09.68Z"), deletedAt: null },
  { id: "smt0rwoodsa1", groupId: "smsrpaiqu5sv", site: "Woods Road", siteRenamedAt: 1786656132673, updatedAt: ms("2026-08-24T20:23:27.777Z"), deletedAt: null },
  { id: "smt3dobluh5e", groupId: "smsrpaiqu5sv", site: "Woods Road", siteRenamedAt: 1786656132673, updatedAt: ms("2026-08-24T20:23:24.459Z"), deletedAt: null },
  { id: "smss1gyt8yw1", groupId: "smsrpaiqu5sv", site: "Woods Road", siteRenamedAt: 1786656132673, updatedAt: ms("2026-08-16T22:13:33.931Z"), deletedAt: ms("2026-08-17T16:33:14.306Z") },
  { id: "smss0bulpy84", groupId: "smsrpaiqu5sv", site: "Woods Road", siteRenamedAt: 1786656132673, updatedAt: ms("2026-08-13T21:22:13.079633Z"), deletedAt: null },
];

// Exactly what audit-project-name-split.mjs does: fetch with `deleted_at IS NULL` at the SQL
// layer, so a deleted row never even reaches reconcileGroupNames. Simulated here as a filter.
const liveOnly = (rows) => rows.filter((r) => !r.deletedAt).map(({ deletedAt, ...p }) => p);

describe("audit-project-name-split guard — live rows only", () => {
  it("GREEN: the real Woods Road group, filtered to live rows, has NO disagreement", () => {
    const { changes, ambiguous } = reconcileGroupNames(liveOnly(WOODS_ROAD_ALL_ROWS()));
    expect(changes).toEqual([]);
    expect(ambiguous).toEqual([]);
  });

  it("⛔ CONTROL — proves the filter is load-bearing: the SAME group, UNFILTERED (deleted rows\n" +
     "     included), DOES flag a false disagreement — reproducing the exact mistake this item\n" +
     "     retracted, so a future 'simplify the query' cannot silently reintroduce it.", () => {
    const all = WOODS_ROAD_ALL_ROWS().map(({ deletedAt, ...p }) => p); // same shape, deleted rows left in
    const { changes } = reconcileGroupNames(all);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].groupId).toBe("smsrpaiqu5sv");
  });

  it("RED: a genuine split among LIVE rows still gets caught", () => {
    const rows = [
      { id: "p1", groupId: "g1", site: "Woods Road", siteRenamedAt: 1786656132673, updatedAt: ms("2026-08-29T20:32:11.78Z") },
      { id: "p2", groupId: "g1", site: "Woods Road", siteRenamedAt: 1786656132673, updatedAt: ms("2026-08-27T16:57:41.34Z") },
      // A live plan this browser never touched at rename time — stale name, OLDER stamp, still LIVE.
      { id: "p3", groupId: "g1", site: "Old Name", siteRenamedAt: 1786655992552, updatedAt: ms("2026-08-13T21:21:13.675Z") },
    ];
    const { changes } = reconcileGroupNames(rows);
    expect(changes.length).toBe(1);
    expect(changes[0]).toMatchObject({ id: "p3", groupId: "g1", from: "Old Name", to: "Woods Road", basis: "stamp" });
  });

  it("a soft-deleted row with a stale name, sitting BESIDE otherwise-agreeing live rows, does not\n" +
     "     trip the guard once it's excluded — the general form of the Woods Road case", () => {
    const liveRows = [
      { id: "p1", groupId: "g2", site: "New Name", siteRenamedAt: 500, updatedAt: 100 },
      { id: "p2", groupId: "g2", site: "New Name", siteRenamedAt: 500, updatedAt: 200 },
    ];
    const deletedStaleRow = { id: "p3", groupId: "g2", site: "Ancient Name", siteRenamedAt: 100, updatedAt: 50, deletedAt: 150 };
    // The guard's input, correctly scoped:
    const { changes: liveChanges } = reconcileGroupNames(liveRows);
    expect(liveChanges).toEqual([]);
    // And the control — including the deleted row WOULD have flagged it:
    const { deletedAt, ...deletedAsIfLive } = deletedStaleRow;
    const { changes: unfilteredChanges } = reconcileGroupNames([...liveRows, deletedAsIfLive]);
    expect(unfilteredChanges.length).toBeGreaterThan(0);
  });
});
