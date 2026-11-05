/* NEW-1 — "Reviews ▾" delete: a refused delete must never look like it worked.
 * The decision is pure (src/workspaces/doc-review/lib/deleteOutcome.js) and shared by the
 * Library's useReviewTrash and the Reviews ▾ menu, so this is the one table for both. */
import { describe, it, expect } from "vitest";
import { deleteReviewOutcome, deleteFailureEvent } from "../src/workspaces/doc-review/lib/deleteOutcome.js";

describe("deleteReviewOutcome — result → landed / failed", () => {
  it("a soft delete that touched one row LANDED", () => {
    expect(deleteReviewOutcome({ ok: true, removed: 1, soft: true, error: null })).toEqual({ landed: true, failed: false, cleanup: null, reason: null });
  });
  it("a 0-row soft delete (RLS / ownership / already deleted — B757) FAILED, not silently succeeded", () => {
    const o = deleteReviewOutcome({ ok: true, removed: 0, soft: true, error: null });
    expect(o.landed).toBe(false);
    expect(o.failed).toBe(true);
    expect(o.reason).toBe("zero-rows");
  });
  it("a reported error FAILED", () => {
    const o = deleteReviewOutcome({ ok: false, removed: 0, soft: true, error: "network" });
    expect(o).toMatchObject({ landed: false, failed: true, reason: "error" });
  });
  it("no result at all (the store bailed before writing) FAILED", () => {
    expect(deleteReviewOutcome(undefined)).toMatchObject({ landed: false, failed: true, reason: "no-result" });
    expect(deleteReviewOutcome({ ok: false })).toMatchObject({ failed: true, reason: "not-ok" });
  });
  it("a pre-migration HARD delete that succeeded is neither landed (no undo) nor failed", () => {
    const o = deleteReviewOutcome({ ok: true, orphaned: 0 });
    expect(o).toEqual({ landed: false, failed: false, cleanup: null, reason: null });
  });
  it("a hard delete with stranded bytes reports the cleanup counts", () => {
    const o = deleteReviewOutcome({ ok: true, orphaned: 2, sharedKept: 1 });
    expect(o.failed).toBe(false);
    expect(o.cleanup).toEqual({ orphaned: 2, sharedKept: 1 });
  });
});

describe("deleteFailureEvent — telemetry only for a failure", () => {
  it("names delete-zero-rows for the RLS no-op and cloud-write-failed for an error", () => {
    const zero = deleteFailureEvent(deleteReviewOutcome({ ok: true, removed: 0, soft: true }), { surface: "reviews-menu", id: "r1" });
    expect(zero.kind).toBe("delete-zero-rows");
    expect(zero.extra).toEqual({ id: "r1", surface: "reviews-menu" });
    const err = deleteFailureEvent(deleteReviewOutcome({ ok: false, error: "x" }), { surface: "library", id: "r2" });
    expect(err.kind).toBe("cloud-write-failed");
  });
  it("is null when the delete landed", () => {
    expect(deleteFailureEvent(deleteReviewOutcome({ ok: true, removed: 1, soft: true }), { surface: "library", id: "r1" })).toBeNull();
  });
});
