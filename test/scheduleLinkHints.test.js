import { describe, it, expect } from "vitest";
import { planScheduleHintSync, schedulesBySite } from "../src/shared/schedule/scheduleLinkHints.js";

/* B1953795 (S1) — the "Has a schedule" hint on a Site Planner group is a derived mirror of the
 * schedules' own `linkedSiteId`. RED-PROOF: main only wrote the hint from three one-shot messages
 * (link / create-linked / unlink-with-a-group) so unlink, relink X→Y, delete, and two-schedule sites
 * all left a stale calendar icon; a module that derives the hint from the full list has no such gap. */
const S = (id, siteId, extra = {}) => ({ id, name: `S${id}`, ...(siteId ? { linkedSiteId: siteId, linkedSiteName: siteId.toUpperCase() } : {}), ...extra });

describe("planScheduleHintSync — hints converge on what the schedules say", () => {
  it("unlink: the schedule moved to the organization clears the old project's hint", () => {
    const list = [S(1, null, { ownerKind: "org" }), S(2, "b")];
    const ops = planScheduleHintSync(list, [{ id: "a", scheduleProjectId: 1 }, { id: "b", scheduleProjectId: 2 }]);
    expect(ops).toEqual([{ groupId: "a", scheduleProjectId: null, name: null }]);
  });
  it("unlink where the stale link field lingers but ownerKind says org: still cleared (one ownership answer)", () => {
    const list = [S(1, "a", { ownerKind: "org" }), S(2, "b")];
    expect(planScheduleHintSync(list, [{ id: "a", scheduleProjectId: 1 }])).toEqual([{ groupId: "a", scheduleProjectId: null, name: null }]);
  });
  it("relink X→Y: X's hint clears and Y's is set in the same pass", () => {
    const list = [S(1, "y")];
    const ops = planScheduleHintSync(list, [{ id: "x", scheduleProjectId: 1 }, { id: "y", scheduleProjectId: null }]);
    expect(ops).toEqual([
      { groupId: "x", scheduleProjectId: null, name: null },
      { groupId: "y", scheduleProjectId: 1, name: "Y" },
    ]);
  });
  it("delete: a hint pointing at a schedule that no longer exists is cleared", () => {
    const list = [S(2, "b")];
    expect(planScheduleHintSync(list, [{ id: "a", scheduleProjectId: 1 }, { id: "b", scheduleProjectId: 2 }])).toEqual([{ groupId: "a", scheduleProjectId: null, name: null }]);
  });
  it("two schedules on one site: a still-valid hint is kept (stable); deleting that one repoints to the survivor", () => {
    const both = [S(1, "a"), S(3, "a")];
    expect(planScheduleHintSync(both, [{ id: "a", scheduleProjectId: 3 }])).toEqual([]);
    const survivor = [S(1, "a")];
    expect(planScheduleHintSync(survivor, [{ id: "a", scheduleProjectId: 3 }])).toEqual([{ groupId: "a", scheduleProjectId: 1, name: "A" }]);
  });
  it("a fresh link on an unhinted group sets it; a matching hint is a no-op (no needless cloud write)", () => {
    expect(planScheduleHintSync([S(1, "a")], [{ id: "a", scheduleProjectId: null }])).toEqual([{ groupId: "a", scheduleProjectId: 1, name: "A" }]);
    expect(planScheduleHintSync([S(1, "a")], [{ id: "a", scheduleProjectId: 1 }])).toEqual([]);
    expect(planScheduleHintSync([S(1, "a")], [{ id: "a", scheduleProjectId: "1" }])).toEqual([]); // text vs number id
  });
  it("NEVER clears on an empty / unloaded / malformed list (nothing known yet is not 'no schedules')", () => {
    const groups = [{ id: "a", scheduleProjectId: 1 }];
    expect(planScheduleHintSync([], groups)).toEqual([]);
    expect(planScheduleHintSync(null, groups)).toEqual([]);
    expect(planScheduleHintSync([S(1, "a")], null)).toEqual([]);
  });
  it("groups with no hint and no schedule are untouched", () => {
    expect(planScheduleHintSync([S(1, "a")], [{ id: "zz", scheduleProjectId: null }, { id: "a", scheduleProjectId: 1 }])).toEqual([]);
  });
  it("schedulesBySite groups by the ownership answer", () => {
    const m = schedulesBySite([S(1, "a"), S(2, "a"), S(3, null)]);
    expect([...m.keys()]).toEqual(["a"]);
    expect(m.get("a").map((p) => p.id)).toEqual([1, 2]);
  });
});
