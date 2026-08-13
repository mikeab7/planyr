import { describe, it, expect } from "vitest";
import { toastForSyncEvent } from "../src/workspaces/site-planner/lib/conflictToasts.js";
import { createElementSync } from "../src/workspaces/site-planner/lib/elementSync.js";

// B673 — the conflict policy matrix (whole-element granularity, LWW, no field merging): both sides
// of a collision get told, deletes win intuitively, restores are explicit, and normal live sync
// stays quiet. The mapping is pure; the engine half (restore op + restore-conflict) runs against a
// scripted RPC.

const ctx = { name: "Sam", label: "Building 3", self: false };   // a PROVEN different account
const mine = { name: "you (another window)", label: "Building 3", self: true }; // NEW-4 — same account, another tab
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("toastForSyncEvent — the matrix, both sides", () => {
  it("edit-vs-edit, losing side: 'your version was kept' + zoom", () => {
    const t = toastForSyncEvent({ type: "edit-vs-edit-lost-race" }, ctx);
    expect(t.text).toBe("Building 3 was also just edited by Sam — your version was kept.");
    expect(t.action).toBe("zoom");
  });

  it("edit-vs-edit, overwritten side (foreign rev inside the 15s authored window): 'their version is showing' + zoom", () => {
    const t = toastForSyncEvent({ type: "remote-upsert", authoredRecently: true }, ctx);
    expect(t.text).toBe("Sam changed Building 3 you just edited — their version is showing.");
    expect(t.action).toBe("zoom");
  });

  it("a remote upsert OUTSIDE the window is normal live sync — silent", () => {
    expect(toastForSyncEvent({ type: "remote-upsert", authoredRecently: false }, ctx)).toBeNull();
  });

  it("edit-vs-deleted: 'deleted by ⟨name⟩' + RESTORE, and the deletion shows on canvas", () => {
    const t = toastForSyncEvent({ type: "edit-vs-deleted" }, ctx);
    expect(t.text).toBe("Building 3 was deleted by Sam.");
    expect(t.action).toBe("restore");
    expect(t.removeFromCanvas).toBe(true);
  });

  it("delete-vs-edit, editor's side: removal notice inside the window; silent outside", () => {
    expect(toastForSyncEvent({ type: "remote-delete", authoredRecently: true }, ctx).text)
      .toBe("Building 3 you just edited was deleted by Sam.");
    expect(toastForSyncEvent({ type: "remote-delete", authoredRecently: false }, ctx)).toBeNull();
  });

  it("delete-vs-edit, deleting side: the re-applied delete is silent (delete wins, no self-toast)", () => {
    expect(toastForSyncEvent({ type: "delete-reapplied" }, ctx)).toBeNull();
  });

  it("restore-conflict: their version is showing", () => {
    const t = toastForSyncEvent({ type: "restore-conflict" }, ctx);
    expect(t.action).toBe("zoom");
    expect(t.text).toContain("already restored or edited by Sam");
  });

  it("unknown/malformed events are silent, never a crash", () => {
    expect(toastForSyncEvent(null, ctx)).toBeNull();
    expect(toastForSyncEvent({ type: "nonsense" }, ctx)).toBeNull();
  });
});

describe("engine restore op (the Restore action's write path)", () => {
  function harness(responder) {
    const commits = [];
    const events = [];
    const sync = createElementSync({
      siteId: "s",
      commit: async (ops) => { commits.push(ops); return responder(ops); },
      now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
    });
    sync.seed([]);
    return { sync, commits, events };
  }

  it("restore sends a restore op with our data and adopts the new rev on ok", async () => {
    const { sync, commits } = harness((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: 5 })) }));
    sync.restore("el", "e1", { id: "e1", type: "building", w: 40, z: 0 });
    await tick();
    expect(commits[0][0]).toMatchObject({ op: "restore", id: "e1", kind: "el", data: { id: "e1", w: 40 } });
    // committed → a later identical reconcile is a no-op (shadow adopted rev 5 + our data)
    sync.reconcile({ els: [{ id: "e1", type: "building", w: 40, z: 0 }] }, {});
    await tick();
    expect(commits).toHaveLength(1);
  });

  it("restore racing a live row adopts THEIR row and emits restore-conflict (no re-push)", async () => {
    const { sync, commits, events } = harness((ops) => ({
      ok: true,
      results: ops.map((o) => ({ id: o.id, status: "conflict", row: { kind: "el", id: o.id, rev: 9, z_index: 0, data: { id: o.id, w: 77, z: 0 }, updated_by: "u2" } })),
    }));
    sync.restore("el", "e1", { id: "e1", w: 40, z: 0 });
    await tick();
    expect(events.some((e) => e.type === "restore-conflict" && e.remote.rev === 9)).toBe(true);
    expect(sync.pendingCount()).toBe(0); // their version stands — nothing re-queued
    // and the adopted shadow means THEIR data is the no-op baseline now
    sync.reconcile({ els: [{ id: "e1", w: 77, z: 0 }] }, {});
    await tick();
    expect(commits).toHaveLength(1); // no second commit — canvas matches the adopted row
  });
});

/* ⛔ NEW-4 — an action is attributed to a PERSON only on a proven different account. A second tab
 * of the owner's own session named a phantom collaborator ~5 times; the wording half of that fix
 * lives here, and it is asserted for every row of the matrix that names anyone at all. */
describe("NEW-4 — same account, another tab: the sentence names a TAB, never a person", () => {
  const rows = [
    { type: "edit-vs-edit-lost-race" },
    { type: "remote-while-dirty" },
    { type: "remote-upsert", authoredRecently: true },
    { type: "remote-delete", authoredRecently: true },
    { type: "edit-vs-deleted" },
    { type: "restore-conflict" },
    { type: "delete-vs-create-dropped" },
  ];
  it("every attributing row has a self variant, and it credits no name", () => {
    for (const ev of rows) {
      const t = toastForSyncEvent(ev, mine);
      expect(t, ev.type).toBeTruthy();
      expect(t.text, ev.type).toContain("another tab of yours");
      expect(t.text, ev.type).not.toContain("Sam");
      expect(t.text, ev.type).not.toContain("a teammate");
    }
  });

  it("the SAME rows still name a proven different account", () => {
    for (const ev of rows) {
      const t = toastForSyncEvent(ev, ctx);
      expect(t.text, ev.type).toContain("Sam");
      expect(t.text, ev.type).not.toContain("another tab of yours");
    }
  });

  it("a caller that forgets `self` gets the UNATTRIBUTED wording — wrong in the harmless direction", () => {
    const t = toastForSyncEvent({ type: "edit-vs-deleted" }, { name: "Sam", label: "Building 3" });
    expect(t.text).toContain("another tab of yours");
  });
});

/* ⛔ NEW-1 — the delete-vs-create row of the matrix, one test per direction. */
describe("NEW-1 — delete-vs-create, both directions", () => {
  it("the DELETER is told, because the element visibly comes back", () => {
    const t = toastForSyncEvent({ type: "delete-vs-create-dropped" }, ctx);
    expect(t.text).toBe("Sam re-created Building 3 after you deleted it — it's back on the plan.");
    expect(t.action).toBe("zoom");
  });

  it("the CREATOR sees nothing: their create simply stands, and there is no event on that side", () => {
    // `delete-reapplied` is the deleter-side telemetry class and stays silent; the creating tab
    // never receives a delete-vs-create event at all, so the matrix has nothing to render for it.
    expect(toastForSyncEvent({ type: "delete-reapplied" }, ctx)).toBeNull();
    expect(toastForSyncEvent({ type: "remote-upsert", authoredRecently: false }, ctx)).toBeNull();
  });
});
