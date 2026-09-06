/* B1162192 — scripts/audit-orphan-folders.mjs's bucketing rule (live / soft_deleted /
 * never_existed for a project_folders tree, against public.sites). Pure and Node-testable;
 * the Drive-walk half needs a real Supabase + Drive account and is exercised by hand
 * (documented in the script's own header, and the real run this item's backlog entry cites).
 */
import { describe, it, expect } from "vitest";
import { bucketFor } from "../scripts/audit-orphan-folders.mjs";

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
