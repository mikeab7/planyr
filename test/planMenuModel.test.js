/* NEW-1 (2026-11-04) — the plan menu's pure rules (lib/planMenuModel.js). */
import { describe, it, expect } from "vitest";
import { FIND_MIN_PLANS, showFind, filterPlans, otherPlans, planMenuItems, deletedLine, deletedEntries, deletedCount } from "../src/workspaces/site-planner/lib/planMenuModel.js";

const NOW = new Date(2026, 10, 4, 12, 0, 0).getTime();   // 4 Nov 2026, local noon

describe("Find a plan", () => {
  it("exists only at 8 or more plans", () => {
    expect(FIND_MIN_PLANS).toBe(8);
    expect(showFind(1)).toBe(false);
    expect(showFind(7)).toBe(false);
    expect(showFind(8)).toBe(true);
    expect(showFind(12)).toBe(true);
  });
  it("filters case-insensitively as you type, keeps order, and an empty query keeps everything", () => {
    const plans = [{ id: "a", name: "Phase II & III - Two (2) 1.2M" }, { id: "b", name: "Concept B" }, { id: "c", name: "concept C" }, { id: "d" }];
    expect(filterPlans(plans, "").map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterPlans(plans, "  CONCEPT ").map((p) => p.id)).toEqual(["b", "c"]);
    expect(filterPlans(plans, "phase ii").map((p) => p.id)).toEqual(["a"]);
    expect(filterPlans(plans, "untitled").map((p) => p.id)).toEqual(["d"]);   // an unnamed plan is searched by the name it shows
    expect(filterPlans(plans, "zzz")).toEqual([]);
  });
  it("otherPlans drops only the current plan and never re-sorts", () => {
    const plans = [{ id: "z" }, { id: "a" }, { id: "m" }];
    expect(otherPlans(plans, "a").map((p) => p.id)).toEqual(["z", "m"]);
    expect(otherPlans(null, "a")).toEqual([]);
  });
});

describe("the ONE ⋯ / right-click item list", () => {
  const ids = (o) => planMenuItems(o).map((i) => i.id);
  it("a plain plan: Rename · Duplicate · Delete plan (red, last)", () => {
    const items = planMenuItems({ isCurrent: false, canDelete: true });
    expect(items.map((i) => i.id)).toEqual(["rename", "duplicate", "delete"]);
    expect(items.map((i) => i.label)).toEqual(["Rename", "Duplicate", "Delete plan"]);
    expect(items[2].danger).toBe(true);
    expect(items.slice(0, 2).every((i) => !i.danger)).toBe(true);
  });
  it("no divider anywhere — every row is a real item (equal rows, equal gaps)", () => {
    for (const o of [{}, { canDelete: true }, { isCurrent: true, canLock: true, canDelete: true }]) {
      expect(planMenuItems(o).every((i) => i.id !== "divider" && i.label)).toBe(true);
    }
  });
  it("Delete plan is offered only when the site has 2+ plans", () => {
    expect(ids({ isCurrent: true, canDelete: false })).toEqual(["rename", "duplicate"]);
    expect(ids({ isCurrent: true, canDelete: true })).toContain("delete");
  });
  it("the view-only lock is on the CURRENT plan's menu only, with the old wording, and only when the plan is the user's to lock", () => {
    expect(ids({ isCurrent: false, canLock: true, canDelete: true })).not.toContain("lock");
    expect(ids({ isCurrent: true, canLock: false, canDelete: true })).not.toContain("lock");
    const unlocked = planMenuItems({ isCurrent: true, canLock: true, locked: false }).find((i) => i.id === "lock");
    const locked = planMenuItems({ isCurrent: true, canLock: true, locked: true }).find((i) => i.id === "lock");
    expect(unlocked.label).toBe("Lock to view-only for teammates");
    expect(locked.label).toBe("Locked — teammates can view only");
    expect(unlocked.title).toBe("Teammates can edit this plan. Click to make it view-only for them.");
    expect(locked.title).toBe("Teammates can view this plan but not change it. Click to let them edit again.");
  });
  it("Delete plan is always last, even with the lock row present", () => {
    const items = planMenuItems({ isCurrent: true, canLock: true, canDelete: true });
    expect(items[items.length - 1].id).toBe("delete");
  });
});

describe("the Recently deleted view", () => {
  it("'Deleted Oct 20, 2:37 PM' in local time; the year is added only when it isn't this year", () => {
    const thisYear = new Date(2026, 9, 20, 14, 37).getTime();
    const lastYear = new Date(2025, 9, 20, 14, 37).getTime();
    expect(deletedLine(thisYear, NOW)).toBe("Deleted Oct 20, 2:37 PM");
    expect(deletedLine(lastYear, NOW)).toBe("Deleted Oct 20, 2025, 2:37 PM");
    expect(deletedLine(new Date(2026, 0, 5, 0, 5).getTime(), NOW)).toBe("Deleted Jan 5, 12:05 AM");
  });
  it("takes an ISO string, and says nothing when there is no usable time (a file with no deletedAt has no line)", () => {
    expect(deletedLine(new Date(2026, 9, 20, 9, 3).toISOString(), NOW)).toBe("Deleted Oct 20, 9:03 AM");
    expect(deletedLine(undefined, NOW)).toBe("");
    expect(deletedLine(null, NOW)).toBe("");
    expect(deletedLine("not a date", NOW)).toBe("");
    expect(deletedLine(0, NOW)).toBe("");
  });
  it("four identically-named plans are told apart by the exact time, newest first", () => {
    const mk = (id, d) => ({ id, name: "Goose Creek - Concept A", deletedAt: new Date(2026, 9, d, 14, 37).getTime() });
    const rows = deletedEntries([mk("p1", 18), mk("p2", 22), mk("p3", 20), mk("p4", 19)], []);
    expect(rows.map((r) => r.id)).toEqual(["p2", "p3", "p4", "p1"]);
    expect(new Set(rows.map((r) => deletedLine(r.deletedAt, NOW))).size).toBe(4);
  });
  it("plans and deleted site-plan FILES share one newest-first list; a file with no time sorts last and keeps its kind", () => {
    const rows = deletedEntries(
      [{ id: "p1", name: "A", deletedAt: 1000 }],
      [{ id: "f1", name: "Master plan", deletedAt: 2000 }, { id: "f2", name: "Old", deletedAt: undefined }],
    );
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual(["file:f1", "plan:p1", "file:f2"]);
    expect(deletedCount([{}, {}], [{}])).toBe(3);   // the "(n)" counts plans + files
    expect(deletedCount(null, undefined)).toBe(0);
  });
});
