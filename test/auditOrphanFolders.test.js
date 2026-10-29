/* B1162192 — scripts/audit-orphan-folders.mjs's bucketing rule (live / soft_deleted /
 * never_existed for a project_folders tree, against public.sites). Pure and Node-testable;
 * the Drive-walk half needs a real Supabase + Drive account and is exercised by hand
 * (documented in the script's own header, and the real run this item's backlog entry cites).
 */
import { describe, it, expect } from "vitest";
import { bucketFor, statusByProjectKeys } from "../scripts/audit-orphan-folders.mjs";

describe("bucketFor — the never_existed/soft_deleted/live split", () => {
  it("no sites row at all for this project_id → never_existed", () => {
    expect(bucketFor(undefined)).toBe("never_existed");
  });

  it("a live (non-deleted) sites row → live", () => {
    expect(bucketFor({ hasLive: true, hasDeleted: false })).toBe("live");
  });

  it("only soft-deleted sites rows → soft_deleted", () => {
    expect(bucketFor({ hasLive: false, hasDeleted: true })).toBe("soft_deleted");
  });

  it("a project with BOTH a live plan and a soft-deleted one (multi-plan group) → live wins", () => {
    expect(bucketFor({ hasLive: true, hasDeleted: true })).toBe("live");
  });
});

/* NEW-6 (data-risk 2026-10-29) — fetchSitesGroupStatus used to `continue` on a NULL group_id, so a solo project
 * (no group_id column) and a project whose group_id column drifted from data->>'groupId' both bucketed as
 * never_existed — the only bucket --apply may touch. Neither may. */
describe("statusByProjectKeys — a project is judged by every key it can be asked by", () => {
  const bucket = (m, id) => bucketFor(m.get(id));
  it("a solo project with a NULL group_id column is live, not never_existed", () => {
    const m = statusByProjectKeys([{ id: "smsolo", group_id: null, groupKey: null, deleted_at: null }]);
    expect(bucket(m, "smsolo")).toBe("live");
  });
  it("a drifted-key project (group_id column ≠ data->>'groupId') is live under BOTH keys", () => {
    const m = statusByProjectKeys([{ id: "smplan", group_id: "smcolumn", groupKey: "smjsonb", deleted_at: null }]);
    expect(bucket(m, "smcolumn")).toBe("live");
    expect(bucket(m, "smjsonb")).toBe("live");
    expect(bucket(m, "smplan")).toBe("live");
  });
  it("a soft-deleted solo project is soft_deleted, still never never_existed", () => {
    const m = statusByProjectKeys([{ id: "smgone", group_id: null, groupKey: null, deleted_at: "2026-09-01T00:00:00Z" }]);
    expect(bucket(m, "smgone")).toBe("soft_deleted");
  });
  it("a genuinely absent project is still never_existed (the known-good arm: the bucket still exists)", () => {
    const m = statusByProjectKeys([{ id: "smother", group_id: "smg", groupKey: "smg", deleted_at: null }]);
    expect(bucket(m, "smnothing")).toBe("never_existed");
  });
  it("a live sibling keeps the group live even when another plan in it is soft-deleted", () => {
    const m = statusByProjectKeys([
      { id: "a", group_id: "g", groupKey: "g", deleted_at: "2026-09-01T00:00:00Z" },
      { id: "b", group_id: "g", groupKey: "g", deleted_at: null },
    ]);
    expect(bucket(m, "g")).toBe("live");
  });
});
