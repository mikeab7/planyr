/* ⛔ NEW-7 (B472048) — THE OPERATION ENVELOPE.
 *
 * Three writes this week could not be attributed without asking the owner directly: the parcel
 * MERGE on 8 South (two deletes and a create at one identical microsecond, one account, nothing
 * linking them — "77 − 2 + 1"), six UNDO presses on Bain while a second presence was in the plan,
 * and two parcel-split slivers deleted 3.66 s and ~0 s after their split. Every one would have been
 * a one-line answer with an op id and a session id on the row.
 *
 * ⛔ `actor_session_id` IS THE LOAD-BEARING FIELD. Both live sessions authenticate as the SAME
 * account, so `actor_user_id` — and the existing `updated_by` / `deleted_by` columns — can never
 * answer "was that my other tab?". Several cases below exist only to pin that.
 */
import { describe, it, expect } from "vitest";
import {
  OP_KINDS, OP_KIND_LIST, isOpKind, isCompositeOpKind, mintOpId, makeEnvelope,
  envelopeAnswersWhoAndWhat, createOperationTracker, groupRowsIntoOperations,
  describeOperation, halfLandedComposites, undoOwnership,
} from "../src/workspaces/site-planner/lib/operationEnvelope.js";

const tracker = (over = {}) => createOperationTracker({ sessionId: "sess-A", userId: () => "user-1", now: () => 1000, ...over });

describe("NEW-7 · the vocabulary is closed", () => {
  it("names the three composite kinds a row-level reading cannot represent", () => {
    for (const k of ["merge", "split", "replace"]) expect(isCompositeOpKind(k)).toBe(true);
    for (const k of ["move", "create", "delete", "edit"]) expect(isCompositeOpKind(k)).toBe(false);
  });
  it("rejects an unknown kind rather than storing whatever was typed", () => {
    expect(isOpKind("merge")).toBe(true);
    expect(isOpKind("frobnicate")).toBe(false);
    expect(makeEnvelope({ opKind: "frobnicate", sessionId: "s" }).op_kind).toBe("unknown");
  });
  it("carries `unknown` as a real member, so an unattributed write has somewhere honest to go", () => {
    expect(OP_KIND_LIST).toContain("unknown");
    expect(OP_KINDS.unknown.label).toBe("changed");
  });
  it("mints distinct ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => mintOpId()));
    expect(ids.size).toBe(500);
    expect(mintOpId()).toMatch(/^op_[0-9a-z]+$/);
  });
});

describe("NEW-7 · the tracker: one operation per user-visible action", () => {
  it("stamps every row of one operation with ONE op id", () => {
    const t = tracker();
    const opId = t.beginOperation("merge");
    const a = t.current(), b = t.current(), c = t.current();
    expect([a.op_id, b.op_id, c.op_id]).toEqual([opId, opId, opId]);
    expect(a.op_kind).toBe("merge");
    expect(a.actor_session_id).toBe("sess-A");
    expect(a.actor_user_id).toBe("user-1");
    expect(a.client_ts).toBe(new Date(1000).toISOString());
  });

  it("a second operation gets its OWN id — two gestures never merge into one story", () => {
    const t = tracker();
    const first = t.beginOperation("move");
    const second = t.beginOperation("split");
    expect(second).not.toBe(first);
    expect(t.current().op_id).toBe(second);
    expect(t.current().op_kind).toBe("split");
  });

  it("⛔ a write with NOTHING open is `unknown` with a FRESH id — never folded into the last one", () => {
    const t = tracker();
    const opId = t.beginOperation("move");
    t.endOperation();
    const orphan = t.current();
    expect(orphan.op_kind).toBe("unknown");
    expect(orphan.op_id).not.toBe(opId);          // not attributed to the operation that just ended
    expect(orphan.actor_session_id).toBe("sess-A");   // …but it still says WHO
    expect(t.current().op_id).not.toBe(orphan.op_id); // and two orphans are two operations
  });

  it("never returns null — a row that cannot say who wrote it is the state this removes", () => {
    const t = tracker();
    expect(t.current()).toBeTruthy();
    expect(t.isOpen()).toBe(false);
  });

  it("reads the session id at CALL time, so a session resolving late is not snapshotted null", () => {
    /* The B377891 trap: `selfUid` snapshotted before auth resolves is null for the whole session. */
    let sid = null;
    const t = createOperationTracker({ sessionId: () => sid, now: () => 1 });
    expect(t.current().actor_session_id).toBeNull();
    sid = "sess-late";
    expect(t.current().actor_session_id).toBe("sess-late");
  });

  it("refuses to be constructed without a session id source", () => {
    expect(() => createOperationTracker({})).toThrow(/sessionId/);
  });
});

describe("NEW-7 · `envelopeAnswersWhoAndWhat`", () => {
  it("requires the SESSION, not merely the user", () => {
    expect(envelopeAnswersWhoAndWhat(makeEnvelope({ opId: "op_1", opKind: "merge", sessionId: "s", userId: "u" }))).toBe(true);
    // an op id and a USER but no session — the exact state that could not answer "was that me"
    expect(envelopeAnswersWhoAndWhat({ op_id: "op_1", op_kind: "merge", actor_user_id: "u", actor_session_id: null })).toBe(false);
    expect(envelopeAnswersWhoAndWhat(makeEnvelope({ opKind: "merge", sessionId: "s" }))).toBe(false);   // no op id
    expect(envelopeAnswersWhoAndWhat(null)).toBe(false);
  });
});

describe("NEW-7 · reading rows back as OPERATIONS — the 8 South merge", () => {
  /* The real shape, with the envelope it would have carried. */
  const MERGE_ROWS = [
    { id: "e56", kind: "parcel", rev: 4, deleted_at: "2026-08-13T14:57:34.590Z", updated_at: "2026-08-13T14:57:34.590Z", op_id: "op_m", op_kind: "merge", actor_session_id: "sess-mike", actor_user_id: "u1" },
    { id: "e1454594huuiov", kind: "parcel", rev: 4, deleted_at: "2026-08-13T14:57:34.590Z", updated_at: "2026-08-13T14:57:34.590Z", op_id: "op_m", op_kind: "merge", actor_session_id: "sess-mike", actor_user_id: "u1" },
    { id: "e1454919qhgshe", kind: "parcel", rev: 1, deleted_at: null, updated_at: "2026-08-13T14:57:34.590Z", op_id: "op_m", op_kind: "merge", actor_session_id: "sess-mike", actor_user_id: "u1" },
  ];

  it("groups the three rows into ONE operation", () => {
    const ops = groupRowsIntoOperations(MERGE_ROWS, { selfSessionId: "sess-mike" });
    expect(ops).toHaveLength(1);
    expect(ops[0].opKind).toBe("merge");
    expect(ops[0].deleted).toHaveLength(2);
    expect(ops[0].created).toHaveLength(1);
    expect(ops[0].isMine).toBe(true);
  });

  it("⛔ READS AS A MERGE, NEVER AS NET ROW ARITHMETIC", () => {
    const [op] = groupRowsIntoOperations(MERGE_ROWS, { selfSessionId: "sess-mike" });
    const sentence = describeOperation(op);
    expect(sentence).toBe("You merged 2 parcels into 1");
    expect(sentence).not.toMatch(/-2|\+1|77/);
  });

  it("names the other session when it is not mine", () => {
    const [op] = groupRowsIntoOperations(MERGE_ROWS, { selfSessionId: "sess-other" });
    expect(op.isMine).toBe(false);
    expect(describeOperation(op, { nameOf: () => "Michael" })).toBe("Michael merged 2 parcels into 1");
  });

  it("⛔ TWO SESSIONS ON ONE ACCOUNT ARE TOLD APART — which the user id alone cannot do", () => {
    const rows = [
      { ...MERGE_ROWS[0], op_id: "op_a", actor_session_id: "sess-A" },
      { ...MERGE_ROWS[2], op_id: "op_b", actor_session_id: "sess-B" },
    ];
    const ops = groupRowsIntoOperations(rows, { selfSessionId: "sess-A" });
    expect(ops).toHaveLength(2);
    expect(ops.filter((o) => o.isMine)).toHaveLength(1);
    // …and both carry the SAME user id, which is exactly why the session is the load-bearing field
    expect(new Set(rows.map((r) => r.actor_user_id)).size).toBe(1);
  });

  it("a legacy row with no envelope is its own operation and is not attributed to anyone", () => {
    const ops = groupRowsIntoOperations([{ id: "old", kind: "parcel", rev: 3, updated_at: "2026-01-01T00:00:00Z" }], { selfSessionId: "sess-A" });
    expect(ops).toHaveLength(1);
    expect(ops[0].enveloped).toBe(false);
    expect(ops[0].isMine).toBe(false);
    expect(describeOperation(ops[0])).toMatch(/^Someone changed/);
  });

  it("a split reads as a split", () => {
    const ops = groupRowsIntoOperations([
      { id: "p", kind: "parcel", rev: 2, updated_at: "t", op_id: "op_s", op_kind: "split", actor_session_id: "s" },
      { id: "a", kind: "parcel", rev: 1, updated_at: "t", op_id: "op_s", op_kind: "split", actor_session_id: "s" },
      { id: "b", kind: "parcel", rev: 1, updated_at: "t", op_id: "op_s", op_kind: "split", actor_session_id: "s" },
    ], { selfSessionId: "s" });
    expect(describeOperation(ops[0])).toBe("You split 1 parcel into 2");
  });
});

describe("NEW-7 · a half-landed composite is visible as one", () => {
  it("flags a merge that deleted without creating", () => {
    const ops = groupRowsIntoOperations([
      { id: "a", kind: "parcel", rev: 4, deleted_at: "t", updated_at: "t", op_id: "op_m", op_kind: "merge", actor_session_id: "s" },
    ], { selfSessionId: "s" });
    expect(halfLandedComposites(ops)).toHaveLength(1);
  });
  it("a whole merge is not flagged", () => {
    const ops = groupRowsIntoOperations([
      { id: "a", kind: "parcel", rev: 4, deleted_at: "t", updated_at: "t", op_id: "op_m", op_kind: "merge", actor_session_id: "s" },
      { id: "b", kind: "parcel", rev: 1, updated_at: "t", op_id: "op_m", op_kind: "merge", actor_session_id: "s" },
    ], { selfSessionId: "s" });
    expect(halfLandedComposites(ops)).toEqual([]);
  });
});

describe("NEW-7 · undo ownership — three verdicts, and the middle one is new", () => {
  it("my own operation undoes silently, as always", () => {
    const v = undoOwnership({ actor_session_id: "sess-A" }, "sess-A");
    expect(v.verdict).toBe("own");
    expect(v.needsConfirm).toBe(false);
  });

  it("⛔ ANOTHER SESSION'S OPERATION REQUIRES CONFIRMATION, AND NAMES THEM", () => {
    const v = undoOwnership({ actor_session_id: "sess-B", actor_user_id: "u1" }, "sess-A", { nameOf: () => "Michael" });
    expect(v.verdict).toBe("foreign");
    expect(v.needsConfirm).toBe(true);
    expect(v.message).toMatch(/Michael/);
    expect(v.message).toMatch(/not yours/);
  });

  it("⛔ AN UN-ENVELOPED FRAME WARNS BUT DOES NOT BLOCK — refusing every legacy frame is worse", () => {
    const v = undoOwnership({}, "sess-A");
    expect(v.verdict).toBe("unknown");
    expect(v.needsConfirm).toBe(false);      // Undo still works on every plan saved before this shipped
  });

  it("the SAME ACCOUNT in two tabs is still foreign — the case user id cannot see", () => {
    const v = undoOwnership({ actor_session_id: "sess-B", actor_user_id: "u1" }, "sess-A");
    expect(v.verdict).toBe("foreign");
  });
});
