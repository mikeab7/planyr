import { describe, it, expect } from "vitest";
import { folderReconcilePlan, planIsEmpty } from "../server/storage/folderReconcile.js";

// Helper: a row with sane defaults; override what a case cares about.
const row = (o) => ({
  id: o.id,
  parentId: o.parentId ?? null,
  name: o.name ?? o.id,
  trashed: o.trashed ?? false,
  driveFolderId: o.driveFolderId ?? null,
  driveParentId: o.driveParentId ?? null,
  driveName: o.driveName ?? null,
  driveTrashed: o.driveTrashed ?? false,
});

describe("folderReconcilePlan — creates (B645)", () => {
  it("emits a create for every not-yet-mirrored folder, parents before children", () => {
    const rows = [
      row({ id: "c", parentId: "b", name: "leaf" }),
      row({ id: "a", parentId: null, name: "top" }),
      row({ id: "b", parentId: "a", name: "mid" }),
    ];
    const plan = folderReconcilePlan(rows);
    expect(plan.creates.map((c) => c.id)).toEqual(["a", "b", "c"]); // depth order
    expect(plan.renames).toHaveLength(0);
    expect(plan.moves).toHaveLength(0);
    expect(plan.trashes).toHaveLength(0);
  });

  it("carries name + parentId (null at top) so the executor can resolve the Drive parent", () => {
    const plan = folderReconcilePlan([row({ id: "a", parentId: null, name: "01. Hillwood" })]);
    expect(plan.creates[0]).toEqual({ id: "a", name: "01. Hillwood", parentId: null });
  });
});

describe("folderReconcilePlan — rename + move in place (B645)", () => {
  it("renames when the label changed since last push (same Drive id)", () => {
    const rows = [
      row({ id: "a", name: "Civil (new)", driveFolderId: "d1", driveName: "Civil", driveParentId: null }),
    ];
    const plan = folderReconcilePlan(rows);
    expect(plan.renames).toEqual([{ id: "a", driveFolderId: "d1", name: "Civil (new)" }]);
    expect(plan.creates).toHaveLength(0);
  });

  it("moves when the desired parent's Drive id differs from the one last pushed", () => {
    const rows = [
      row({ id: "p1", name: "P1", driveFolderId: "dp1", driveName: "P1", driveParentId: null }),
      row({ id: "p2", name: "P2", driveFolderId: "dp2", driveName: "P2", driveParentId: null }),
      // child currently mirrored under dp1, desired parent is now p2 (dp2)
      row({ id: "c", parentId: "p2", name: "C", driveFolderId: "dc", driveName: "C", driveParentId: "dp1" }),
    ];
    const plan = folderReconcilePlan(rows);
    expect(plan.moves).toEqual([
      { id: "c", driveFolderId: "dc", newParentId: "p2", removeParent: "dp1" },
    ]);
  });

  it("does NOT move when the desired parent has no Drive id yet (still a pending create)", () => {
    const rows = [
      row({ id: "p", parentId: null, name: "P" }), // pending create, no driveFolderId
      row({ id: "c", parentId: "p", name: "C", driveFolderId: "dc", driveName: "C", driveParentId: "old" }),
    ];
    const plan = folderReconcilePlan(rows);
    expect(plan.creates.map((c) => c.id)).toEqual(["p"]);
    expect(plan.moves).toHaveLength(0); // wait for the parent's create first
  });

  it("emits nothing when Drive already matches desired (idempotent no-op)", () => {
    const rows = [
      row({ id: "a", parentId: null, name: "A", driveFolderId: "d1", driveName: "A", driveParentId: null }),
      row({ id: "b", parentId: "a", name: "B", driveFolderId: "d2", driveName: "B", driveParentId: "d1" }),
    ];
    const plan = folderReconcilePlan(rows);
    expect(planIsEmpty(plan)).toBe(true);
  });
});

describe("folderReconcilePlan — trash (delete mirror) (B645)", () => {
  it("trashes only the subtree ROOT; children ride the Drive cascade", () => {
    const rows = [
      row({ id: "a", parentId: null, name: "A", trashed: true, driveFolderId: "d1", driveName: "A" }),
      row({ id: "b", parentId: "a", name: "B", trashed: true, driveFolderId: "d2", driveName: "B", driveParentId: "d1" }),
      row({ id: "c", parentId: "b", name: "C", trashed: true, driveFolderId: "d3", driveName: "C", driveParentId: "d2" }),
    ];
    const plan = folderReconcilePlan(rows);
    expect(plan.trashes).toEqual([{ id: "a", driveFolderId: "d1" }]); // only the root
  });

  it("does not re-trash a folder already trashed in Drive", () => {
    const rows = [
      row({ id: "a", parentId: null, name: "A", trashed: true, driveFolderId: "d1", driveTrashed: true }),
    ];
    expect(folderReconcilePlan(rows).trashes).toHaveLength(0);
  });

  it("skips a trashed folder that never reached Drive (nothing to remove)", () => {
    const rows = [row({ id: "a", parentId: null, name: "A", trashed: true, driveFolderId: null })];
    expect(planIsEmpty(folderReconcilePlan(rows))).toBe(true);
  });

  it("never renames or moves a trashed folder", () => {
    const rows = [
      row({ id: "a", parentId: null, name: "renamed", trashed: true, driveFolderId: "d1", driveName: "old", driveParentId: "x" }),
    ];
    const plan = folderReconcilePlan(rows);
    expect(plan.renames).toHaveLength(0);
    expect(plan.moves).toHaveLength(0);
    expect(plan.trashes).toHaveLength(1);
  });
});

describe("folderReconcilePlan — mixed + robustness", () => {
  it("handles a create, a rename, a move, and a trash together", () => {
    const rows = [
      row({ id: "keep", parentId: null, name: "Keep", driveFolderId: "dk", driveName: "Keep", driveParentId: null }),
      row({ id: "new", parentId: "keep", name: "New" }), // create
      row({ id: "ren", parentId: null, name: "Renamed", driveFolderId: "dr", driveName: "Old", driveParentId: null }), // rename
      row({ id: "mov", parentId: "keep", name: "Mov", driveFolderId: "dm", driveName: "Mov", driveParentId: null }), // move under keep
      row({ id: "del", parentId: null, name: "Del", trashed: true, driveFolderId: "dd", driveName: "Del" }), // trash
    ];
    const plan = folderReconcilePlan(rows);
    expect(plan.creates.map((c) => c.id)).toEqual(["new"]);
    expect(plan.renames.map((r) => r.id)).toEqual(["ren"]);
    expect(plan.moves.map((m) => m.id)).toEqual(["mov"]);
    expect(plan.trashes.map((t) => t.id)).toEqual(["del"]);
  });

  it("is cycle-safe (a corrupt self-parent row does not hang)", () => {
    const rows = [row({ id: "x", parentId: "x", name: "X" })];
    expect(() => folderReconcilePlan(rows)).not.toThrow();
  });

  it("tolerates an empty/no-arg input", () => {
    expect(planIsEmpty(folderReconcilePlan())).toBe(true);
    expect(planIsEmpty(folderReconcilePlan([]))).toBe(true);
  });
});
