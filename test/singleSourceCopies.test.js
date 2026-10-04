/* Red-proofs for the verdict-A copies fixed in B2064896 (docs/audit-single-source-of-truth.md, Part 2).
 * Each case was written against production's measured shape and fails on main before the fix:
 *   A1 B2064897 — one project, one status (8 South: a pursuit plan and an active plan)
 *   A2 B2064898 — the "has a schedule" hint heals from the schedule ROWS, not only from the open Schedule tab
 *   A3 B2064899 — the filing-facts read prefers the review's own value over the index copy's blank
 * "After reload" = the readers are pure functions of the stored rows, so recomputing from the same rows IS the reload. */
import { describe, it, expect } from "vitest";
import { groupStatusOf, groupProjects } from "../src/shared/projects/projectModel.js";
import { groupProjectsByGroupId } from "../src/workspaces/dashboard/lib/dashboardPipeline.js";
import { planHintHealFromRows, navListFromScheduleRows } from "../src/shared/schedule/scheduleLinkHints.js";
import { applyReviewTruth } from "../functions/api/mcp/_tools.js";

describe("A1 — a project has ONE status, whichever surface asks", () => {
  // production: group smqiljx5fngg (8 South) — plan s1 'pursuit' was edited most recently (element recency),
  // plan s2 'active' has the newer HEADER (the status write that landed).
  const rows = [
    { id: "s1", group_id: "g8", site: "8 South", status: "pursuit", updated_at: "2026-09-01T00:00:00Z" },
    { id: "s2", group_id: "g8", site: "8 South", status: "active", updated_at: "2026-09-20T00:00:00Z" },
  ];
  const elementRecency = { s1: Date.parse("2026-10-01T00:00:00Z"), s2: Date.parse("2026-09-02T00:00:00Z") };
  const camel = rows.map((r) => ({ id: r.id, groupId: r.group_id, site: r.site, status: r.status, updatedAt: Date.parse(r.updated_at) }));

  it("groupStatusOf: newest header wins, a statusless plan never beats a stated one", () => {
    expect(groupStatusOf(camel)).toBe("active");
    expect(groupStatusOf(rows)).toBe("active");
    expect(groupStatusOf([{ id: "a", updatedAt: 9 }, { id: "b", status: "dead", updatedAt: 1 }])).toBe("dead");
    expect(groupStatusOf([])).toBe(null);
  });
  it("Dashboard (element-recency representative) and breadcrumb read the SAME status — red before the fix", () => {
    const dash = groupProjectsByGroupId(rows, elementRecency)[0].status;
    const crumb = groupProjects(camel)[0].status;
    expect(dash).toBe("active");
    expect(crumb).toBe("active");
    expect(dash).toBe(crumb);
  });
  it("changing the source (the stale plan gets a fresh header) moves every reader together, and survives a 'reload'", () => {
    const moved = rows.map((r) => (r.id === "s1" ? { ...r, status: "complete", updated_at: "2026-10-03T00:00:00Z" } : r));
    const movedCamel = moved.map((r) => ({ id: r.id, groupId: r.group_id, status: r.status, updatedAt: Date.parse(r.updated_at) }));
    const reload = JSON.parse(JSON.stringify(moved));
    expect(groupProjectsByGroupId(moved, elementRecency)[0].status).toBe("complete");
    expect(groupProjects(movedCamel)[0].status).toBe("complete");
    expect(groupProjectsByGroupId(reload, elementRecency)[0].status).toBe("complete");
  });
});

describe("A2 — the schedule hint converges from the schedule rows", () => {
  const rows = { 22: { id: 22, name: "TAS Land Sale", ownerKind: "site", linkedSiteId: "gGoose", linkedSiteName: "Goose Creek" } };
  it("a project with a linked schedule but no hint on any plan gets one (production: schedule 22)", () => {
    const ops = planHintHealFromRows(rows, [{ id: "gGoose", scheduleProjectId: null }]);
    expect(ops.map((o) => [o.groupId, String(o.scheduleProjectId)])).toEqual([["gGoose", "22"]]);
  });
  it("a hint naming a schedule that no longer links to the project is cleared", () => {
    const ops = planHintHealFromRows({}, [{ id: "gGone", scheduleProjectId: 99 }]);
    expect(ops).toEqual([]); // an EMPTY list is 'nothing known yet' — never clears
    const ops2 = planHintHealFromRows({ 5: { id: 5, name: "Other", ownerKind: "site", linkedSiteId: "gOther" } }, [{ id: "gGone", scheduleProjectId: 99 }]);
    expect(ops2.map((o) => [o.groupId, o.scheduleProjectId])).toEqual([["gGone", null]]);
  });
  it("two schedules on one project keep ONE hint (by design) and write nothing when it already matches", () => {
    const two = { 22: rows[22], 24: { id: 24, name: "x", ownerKind: "site", linkedSiteId: "gGoose" } };
    expect(planHintHealFromRows(two, [{ id: "gGoose", scheduleProjectId: 24 }])).toEqual([]);
  });
  it("a null/garbage rows map yields no writes", () => {
    expect(navListFromScheduleRows(null)).toEqual([]);
    expect(planHintHealFromRows(undefined, [{ id: "g", scheduleProjectId: 3 }])).toEqual([]);
  });
});

describe("A3 — filing facts: the review's value wins, the index copy only fills a gap", () => {
  const facts = [{ id: "r1", review_id: "r1", project_id: "p", discipline: "Other", item: "", revision: "", doc_date: null, source_file: "x.pdf" }];
  const reviews = [{ id: "r1", project_id: "p", deleted_at: null, discipline: "Geotechnical", item: "Geotechnical Report", revision: "B", doc_date: "2026-06-18" }];
  it("blank facts take the review's item / revision / date / discipline (red before the fix)", () => {
    const [f] = applyReviewTruth(facts, reviews);
    expect([f.item, f.revision, f.doc_date, f.discipline]).toEqual(["Geotechnical Report", "B", "2026-06-18", "Geotechnical"]);
    expect(f.source_file).toBe("x.pdf");
  });
  it("a review field that is blank never erases a stated fact", () => {
    const [f] = applyReviewTruth([{ ...facts[0], item: "Kept", revision: "A" }], [{ ...reviews[0], item: "", revision: null }]);
    expect([f.item, f.revision]).toEqual(["Kept", "A"]);
  });
  it("a soft-deleted review still drops its facts (unchanged)", () => {
    expect(applyReviewTruth(facts, [{ ...reviews[0], deleted_at: "2026-10-01" }])).toEqual([]);
  });
});
