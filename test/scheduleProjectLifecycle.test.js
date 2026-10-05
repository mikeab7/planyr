import { describe, it, expect } from "vitest";
import { dropSchedulesOfDeletedProjects, projectLiveness } from "../src/shared/schedule/scheduleLiveness.js";
import { resolveScheduleHint, planHintHealFromRows, planScheduleHintSync } from "../src/shared/schedule/scheduleLinkHints.js";

/* NEW-1 / NEW-2 (2026-10-05). RED-PROOF shapes are the production rows measured that day:
 *  · schedule 24 linked to project smtxbxh59fqt, a project soft-deleted 24 days earlier, still listed by the Dashboard;
 *  · two live Goose Creek plans carrying scheduleProjectId "23" for a schedule that does not exist. */
const S = (id, siteId, extra = {}) => ({ id, name: `S${id}`, linkedSiteId: siteId, linkedSiteName: siteId, ...extra });
const del = "2026-09-11T19:12:33Z";

describe("a deleted project's schedule never reaches a reader (D03)", () => {
  const map = { 24: S(24, "smtx"), 5: S(5, "live"), 6: S(6, null, { ownerKind: "org" }) };
  const sites = [{ id: "smtx", group_id: "smtx", deleted_at: del }, { id: "live", group_id: "live", deleted_at: null }];
  it("drops the orphan, keeps live and org-owned schedules", () => {
    expect(Object.keys(dropSchedulesOfDeletedProjects(map, sites))).toEqual(["5", "6"]);
  });
  it("delete then restore: the schedule is listed again (the project is live again)", () => {
    const restored = [{ id: "smtx", group_id: "smtx", deleted_at: null }, sites[1]];
    expect(Object.keys(dropSchedulesOfDeletedProjects(map, restored)).sort()).toEqual(["24", "5", "6"]);
  });
  it("a project with one deleted plan and one live plan is LIVE", () => {
    const g = [{ id: "a", group_id: "g", deleted_at: del }, { id: "b", group_id: "g", deleted_at: null }];
    expect(projectLiveness(g).dead.size).toBe(0);
    expect(Object.keys(dropSchedulesOfDeletedProjects({ 1: S(1, "g") }, g))).toEqual(["1"]);
  });
  it("a link to a project we hold no row for is UNKNOWN, kept; a failed sites read leaves the map as is", () => {
    expect(Object.keys(dropSchedulesOfDeletedProjects({ 1: S(1, "elsewhere") }, sites))).toEqual(["1"]);
    expect(dropSchedulesOfDeletedProjects(map, null)).toBe(map);
  });
  it("RED control: without the filter the orphan is listed", () => {
    expect(Object.keys(map)).toContain("24");
  });
});

describe("a dangling 'has a schedule' hint is verified against live schedules (D04)", () => {
  const goose = { id: "smqfy", scheduleProjectId: "23" };
  it("hint to a schedule that does not exist -> no schedule (no dead-end icon)", () => {
    expect(resolveScheduleHint(goose, [S(5, "other")])).toBeNull();
  });
  it("falls back to the project's actual schedule", () => {
    expect(resolveScheduleHint(goose, [S(31, "smqfy")])).toBe(31);
  });
  it("a valid hint is kept; an unknown (not-yet-read) live list shows the stored hint unchanged", () => {
    expect(resolveScheduleHint({ id: "g", scheduleProjectId: 5 }, [S(5, "g"), S(6, "g")])).toBe(5);
    expect(resolveScheduleHint(goose, null)).toBe("23");
  });
  it("heal from the rows clears the dangling hint; 'nothing known yet' ({} / null) still never clears (the last-schedule-gone case is the database trigger's job)", () => {
    expect(planHintHealFromRows({ 5: S(5, "other") }, [goose])).toEqual([{ groupId: "smqfy", scheduleProjectId: null, name: null }]);
    expect(planHintHealFromRows({}, [goose])).toEqual([]);
    expect(planHintHealFromRows(null, [goose])).toEqual([]);
  });
  it("the Schedule iframe's EMPTY list still means 'not loaded' and never clears", () => {
    expect(planScheduleHintSync([], [goose])).toEqual([]);
  });
});
