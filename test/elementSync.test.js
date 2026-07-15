import { describe, it, expect } from "vitest";
import { createElementSync, stableStringify, semanticallyEqual } from "../src/workspaces/site-planner/lib/elementSync.js";
import { foldNeverSyncedLocal, reconcileSeedRows } from "../src/workspaces/site-planner/lib/elementRows.js";
import { toastForSyncEvent } from "../src/workspaces/site-planner/lib/conflictToasts.js";

// B671 — the per-element write engine. Injected commit + timers + clock, so the diff classes,
// debounce-vs-immediate boundaries, batch coalescing, conflict matrix, and backoff are all
// deterministic with no real I/O or wall clock.

const tick = () => new Promise((r) => setTimeout(r, 0)); // let serializer/commit microtasks settle

// A harness with a controllable clock, controllable engine timers, and a scriptable commit.
function makeHarness(overrides = {}) {
  const commits = [];        // each entry = the ops array of one commit_elements call
  const events = [];
  const statuses = [];
  const timers = [];         // pending engine timers { fn, ms, id }
  let clock = 1000;
  let responder = overrides.responder || ((ops) => ({
    ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })),
  }));

  const sync = createElementSync({
    siteId: "site-1",
    commit: async (ops) => { commits.push(ops); return responder(ops); },
    now: () => clock,
    setTimer: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    debounceMs: 750,
    ...overrides.sync,
  });
  if (!overrides.noSeed) sync.seed([]); // engine is a no-op until seeded; default to an empty seed (fresh site)

  return {
    sync, commits, events, statuses,
    setResponder: (r) => { responder = r; },
    advance: (ms) => { clock += ms; },
    setClock: (v) => { clock = v; },
    // run all currently-pending engine timers (debounce / backoff)
    runTimers: () => { const due = timers.splice(0); due.forEach((t) => t.fn()); },
    pendingTimers: () => timers.length,
  };
}

const el = (id, extra = {}) => ({ id, type: "building", cx: 0, cy: 0, w: 10, h: 10, ...extra });

describe("diff classes", () => {
  it("a brand-new element commits immediately as a create (no debounce timer)", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1")] }, {});
    await tick();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0][0]).toMatchObject({ op: "create", id: "e1", kind: "el" });
    expect(h.pendingTimers()).toBe(0); // immediate, not debounced
  });

  it("an edit to a committed element is DEBOUNCED (no commit until the timer fires)", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick();       // create commits
    h.sync.reconcile({ els: [el("e1", { w: 20 })] }, {}); await tick();
    expect(h.commits).toHaveLength(1);        // the edit is still pending
    expect(h.pendingTimers()).toBe(1);
    h.runTimers(); await tick();
    expect(h.commits).toHaveLength(2);
    expect(h.commits[1][0]).toMatchObject({ op: "update", id: "e1", expected: 1 }); // rev from the create
  });

  it("removing a committed element commits a delete immediately", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick();
    h.sync.reconcile({ els: [] }, {}); await tick();
    expect(h.commits[1][0]).toMatchObject({ op: "delete", id: "e1", expected: 1 });
  });

  it("create-then-delete before any commit is a net no-op", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1")] }, { busy: true }); // deferred (gesture in progress)
    h.sync.reconcile({ els: [] }, {});                     // removed before it ever committed
    await tick();
    expect(h.commits).toHaveLength(0);
    expect(h.sync.pendingCount()).toBe(0);
  });

  it("a busy (mid-gesture) reconcile defers; flushGesture() commits at gesture end", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1", { cx: 5 })] }, { busy: true });
    await tick();
    expect(h.commits).toHaveLength(0);
    h.sync.reconcile({ els: [el("e1", { cx: 9 })] }, {}); // effect re-runs at gesture end
    h.sync.flushGesture(); await tick();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0][0].data.cx).toBe(9);
  });
});

describe("new-element z assignment", () => {
  it("assigns a top-of-collection z to a created element with none, patches the canvas, and commits z in both column and data", async () => {
    const patches = [];
    const h = makeHarness({ sync: { patchElement: (kind, id, patch) => patches.push({ kind, id, patch }) } });
    // an existing element at z=0 (seeded) then a brand-new element with no z
    h.sync.seed([{ kind: "el", id: "old", data: { id: "old", z: 0 }, rev: 1, z_index: 0 }]);
    h.sync.reconcile({ els: [{ id: "old", z: 0 }, { id: "new" }] }, {}); await tick();
    // canvas got the z patch
    expect(patches).toEqual([{ kind: "el", id: "new", patch: { z: 1024 } }]);
    // the create op carries z in the column AND in data (so the B672 rebuild agrees)
    const createOp = h.commits.flat().find((o) => o.op === "create" && o.id === "new");
    expect(createOp.z).toBe(1024);
    expect(createOp.data.z).toBe(1024);
  });

  it("gives each element of a fresh group a distinct increasing z", async () => {
    const patches = [];
    const h = makeHarness({ sync: { patchElement: (k, id, p) => patches.push([id, p.z]) } });
    h.sync.reconcile({ els: [{ id: "a" }, { id: "b" }, { id: "c" }] }, {}); await tick();
    expect(patches).toEqual([["a", 0], ["b", 1024], ["c", 2048]]);
  });
});

describe("batching (one RPC per flush)", () => {
  it("a group move of many elements commits as ONE batch", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("a"), el("b"), el("c")] }, {}); await tick(); // 3 creates, one batch
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].map((o) => o.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("30-element generation is a single batch (paste/parking-fill safety)", async () => {
    const h = makeHarness();
    const many = Array.from({ length: 30 }, (_, i) => el("g" + i));
    h.sync.reconcile({ els: many }, {}); await tick();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0]).toHaveLength(30);
  });
});

describe("kinds", () => {
  it("routes each collection to its kind", async () => {
    const h = makeHarness();
    h.sync.reconcile({
      els: [el("e1")],
      markups: [{ id: "m1", kind: "polyline" }],
      measures: [{ id: "d1" }],
      callouts: [{ id: "c1" }],
      parcels: [{ id: "p1" }],
    }, {});
    await tick();
    const kinds = Object.fromEntries(h.commits[0].map((o) => [o.id, o.kind]));
    expect(kinds).toEqual({ e1: "el", m1: "markup", d1: "measure", c1: "callout", p1: "parcel" });
  });
});

describe("conflict matrix", () => {
  it("edit-vs-edit: adopts the remote rev, re-commits local on top (LWW), emits lost-race", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick();  // create → rev 1
    // next update returns a conflict with a remote row at rev 7
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) =>
      o.op === "update" ? { id: o.id, status: "conflict", row: { rev: 7, updated_by: "u2", data: { id: "e1", w: 99 } } }
                        : { id: o.id, status: "ok", rev: (o.expected || 0) + 1 }) }));
    h.sync.reconcile({ els: [el("e1", { w: 20 })] }, {}); h.runTimers(); await tick();
    const lost = h.events.find((e) => e.type === "edit-vs-edit-lost-race");
    expect(lost).toBeTruthy();
    expect(lost.remote.rev).toBe(7);
    // LWW: local data re-committed on top at the adopted rev
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }));
    h.runTimers(); await tick();
    const reUpdate = h.commits.at(-1).find((o) => o.id === "e1" && o.op === "update");
    expect(reUpdate.expected).toBe(7); // committed against the remote rev
    expect(reUpdate.data.w).toBe(20);
  });

  it("edit-vs-deleted: emits edit-vs-deleted and does NOT auto-restore", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick();
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) =>
      o.op === "update" ? { id: o.id, status: "deleted", row: { rev: 3, deleted_by: "u2" } }
                        : { id: o.id, status: "ok", rev: 1 }) }));
    h.sync.reconcile({ els: [el("e1", { w: 20 })] }, {}); h.runTimers(); await tick();
    expect(h.events.find((e) => e.type === "edit-vs-deleted")).toBeTruthy();
    expect(h.sync.pendingCount()).toBe(0); // dropped, not re-queued
  });

  it("delete-vs-edit: re-issues the delete at the fresh rev (delete wins)", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick(); // rev 1
    let first = true;
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => {
      if (o.op === "delete" && first) { first = false; return { id: o.id, status: "conflict", row: { rev: 5 } }; }
      return { id: o.id, status: "ok", rev: (o.expected || 0) + 1 };
    }) }));
    h.sync.reconcile({ els: [] }, {}); await tick();      // delete → conflict → re-queued (debounced)
    h.runTimers(); await tick();                          // re-issued delete at rev 5
    const reDelete = h.commits.at(-1).find((o) => o.op === "delete");
    expect(reDelete.expected).toBe(5);
    expect(h.events.some((e) => e.type === "delete-reapplied")).toBe(true);
  });

  it("create-vs-create 'exists' is treated as an assert and re-committed as an update", async () => {
    const h = makeHarness();
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) =>
      o.op === "create" ? { id: o.id, status: "exists", row: { rev: 4 } }
                        : { id: o.id, status: "ok", rev: (o.expected || 0) + 1 }) }));
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick();
    expect(h.sync.pendingCount()).toBeGreaterThan(0); // re-queued as update (debounced)
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }));
    h.runTimers(); await tick();
    expect(h.commits.at(-1)[0]).toMatchObject({ op: "update", id: "e1", expected: 4 });
  });
});

describe("backoff and failure", () => {
  it("retries with backoff and goes 'failed' after maxAttempts (staying queued)", async () => {
    const h = makeHarness({ sync: { backoff: [10, 10, 10, 10, 10], maxAttempts: 3 } });
    h.setResponder(() => ({ ok: false, error: "network" }));
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick();
    expect(h.sync.state).toBe("retrying");
    h.runTimers(); await tick();   // attempt 2
    h.runTimers(); await tick();   // attempt 3 → failed
    expect(h.sync.state).toBe("failed");
    expect(h.sync.pendingCount()).toBe(1); // work is NOT lost
  });

  it("retryNow() re-attempts a failed queue", async () => {
    const h = makeHarness({ sync: { backoff: [10], maxAttempts: 1 } });
    h.setResponder(() => ({ ok: false, error: "network" }));
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick();
    expect(h.sync.state).toBe("failed");
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: 1 })) }));
    h.sync.retryNow(); await tick();
    expect(h.sync.state).toBe("idle");
    expect(h.sync.pendingCount()).toBe(0);
  });
});

describe("serialization (no interleaving)", () => {
  it("a second flush waits for the in-flight commit (one batch at a time)", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const h = makeHarness({ responder: undefined });
    let calls = 0;
    // first commit blocks on the gate; assert no second commit starts meanwhile
    const orig = h.sync;
    // rebuild with a gated commit
    const commits = [];
    const s = createElementSync({
      siteId: "s", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      commit: async (ops) => { commits.push(ops); calls += 1; if (calls === 1) await gate; return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: 1 })) }; },
    });
    s.seed([]); // engine is a no-op until seeded
    s.reconcile({ els: [el("a")] }, {});      // create → flush #1 (blocked)
    s.reconcile({ els: [el("a"), el("b")] }, {}); s.flushGesture(); // create b → wants flush #2
    await tick();
    expect(commits).toHaveLength(1);          // #2 is queued behind #1
    release(); await tick(); await tick();
    expect(commits.length).toBeGreaterThanOrEqual(2);
    void orig;
  });
});

describe("undo/redo needs no special case", () => {
  it("an undo that removes a just-created element diffs to a delete like any edit", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick();     // create
    // undo restores the pre-create snapshot (no e1) → the diff sees a delete, committed normally
    h.sync.reconcile({ els: [] }, {}); await tick();
    expect(h.commits.at(-1)[0]).toMatchObject({ op: "delete", id: "e1" });
  });
});

describe("seed + keepalive", () => {
  it("seed() from rows makes a matching local element a no-op (key-order-insensitive)", async () => {
    const h = makeHarness();
    h.sync.seed([{ kind: "el", id: "e1", data: { w: 10, cx: 0, id: "e1" }, rev: 4, z_index: 0 }]);
    // local element has the same values in a different key order → no commit
    h.sync.reconcile({ els: [{ id: "e1", cx: 0, w: 10 }] }, {}); await tick();
    expect(h.commits).toHaveLength(0);
  });

  it("reconcile is a no-op until the shadow is seeded (avoids create-churn before the DB fetch lands)", async () => {
    const h = makeHarness({ noSeed: true });
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick();
    expect(h.commits).toHaveLength(0);       // nothing committed before seed
    h.sync.seed([]);
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick();
    expect(h.commits).toHaveLength(1);       // now it commits
  });

  it("pendingOps() exposes the unsent (debounced) batch for the unload keepalive flush", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1")] }, {}); await tick();       // create commits → shadow has e1
    h.sync.reconcile({ els: [el("e1", { w: 20 })] }, {});          // update enqueued, debounced (unsent)
    const ops = h.sync.pendingOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "update", id: "e1" });
  });
});

// B672 recurrence (V229 #5) — the refetch-replace lost-update race. A tab whose socket dropped
// holds a STALE canvas; when it rejoins, the refetch seeds the shadow at the FRESH revs. The old
// wiring then reconciled against the stale canvas (stateRef), committing old geometry as valid
// rev-guarded updates that clobbered every other session. These tests pin the engine invariants
// the fix relies on: (1) refetch + substitute + reconcile is a FIXED POINT (no echo commits),
// (2) an in-flight commit is protected from remote rows and refetches exactly like a dirty one.
describe("refetch-replace safety (V229 #5 lost-update class)", () => {
  it("reconciling the substituted refetch result against the fresh seed commits NOTHING", async () => {
    const h = makeHarness();
    // tab converged at rev 2, then its socket drops; meanwhile another session advances e1 to rev 10
    h.sync.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 2, z_index: 0 }]);
    const freshRows = [{ kind: "el", id: "e1", data: { id: "e1", cx: 99 }, rev: 10, z_index: 0 }];
    h.sync.seed(freshRows); // the rejoin refetch re-seeds the shadow at fresh revs
    // the FIX: the caller diffs the substituted collections (rows ∪ dirty) — here just the rows —
    // never the stale canvas. That diff must be a no-op: no stale update sneaks out at rev 10.
    h.sync.reconcile({ els: freshRows.map((r) => r.data) }, {});
    await tick(); h.runTimers(); await tick();
    expect(h.commits).toHaveLength(0);
    // (the OLD wiring would have called reconcile({ els: [{ id: "e1", cx: 0 }] }) here — a diff vs
    // the rev-10 shadow → an update carrying cx:0 at expected:10 → the reproduced data loss)
  });

  it("dirtyEntries() includes the batch in flight, so a refetch substitution keeps a mid-commit edit", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const commits = [];
    const s = createElementSync({
      siteId: "s", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      commit: async (ops) => { commits.push(ops); await gate; return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); s.flushGesture(); await tick();
    expect(commits).toHaveLength(1);                       // the edit is ON THE WIRE, dirty is empty
    const pending = s.dirtyEntries();                      // what refetch-replace substitutes
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "el", id: "e1" });
    expect(pending[0].el.cx).toBe(50);                     // the in-flight data, not the stale row
    expect(pending[0].baseRev).toBe(1);                    // NEW-F4: the shadow rev the op targets rides along for the journal
    release(); await tick(); await tick();
    expect(s.dirtyEntries()).toHaveLength(0);              // settled after the result lands
  });

  it("a foreign row landing while a commit is in flight keeps local data and re-targets the rev", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const events = [];
    const commits = [];
    const s = createElementSync({
      siteId: "s", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => { commits.push(ops); await gate; return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); s.flushGesture(); await tick(); // in flight at expected:1
    const instr = s.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 77 }, rev: 5, z_index: 0 });
    expect(instr.action).toBe("ignore");                   // local (in-flight) data stays on canvas
    expect(events.some((e) => e.type === "remote-while-dirty")).toBe(true);
    release(); await tick(); await tick();
    // the ok result (rev 2) must NOT drag the shadow rev back below the adopted remote rev 5
    expect(s.shadowSnapshot().get("el:e1").rev).toBe(5);
  });

  it("our own commit echoing back mid-flight (same data) is silent — no event, no canvas action", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const events = [];
    const s = createElementSync({
      siteId: "s", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => { await gate; return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); s.flushGesture(); await tick();
    const instr = s.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 50, z: 0 }, rev: 2, z_index: 0 });
    expect(instr.action).toBe("ignore");
    expect(events.filter((e) => e.type === "remote-while-dirty")).toHaveLength(0); // identical data → quiet
    release(); await tick(); await tick();
    // and a follow-up reconcile of the same canvas commits nothing (fully converged)
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); await tick();
    expect(s.pendingCount()).toBe(0);
  });

  it("a foreign IDENTICAL row drops a queued duplicate update instead of re-writing it", async () => {
    const h = makeHarness();
    h.sync.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    h.sync.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); // update queued (debounced, unsent)
    expect(h.sync.pendingCount()).toBe(1);
    // another session commits EXACTLY the same values first
    const instr = h.sync.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 50, z: 0 }, rev: 2, z_index: 0 });
    expect(instr.action).toBe("ignore");
    expect(h.sync.pendingCount()).toBe(0);                 // the duplicate write was dropped
    h.runTimers(); await tick();
    expect(h.commits).toHaveLength(0);                     // nothing hits the RPC at all
  });

  it("reconcile does not re-enqueue data that is already in flight (refetch-during-commit no-op)", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const commits = [];
    const s = createElementSync({
      siteId: "s", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      commit: async (ops) => { commits.push(ops); await gate; return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); s.flushGesture(); await tick(); // in flight
    // the refetch-replace's post-substitution reconcile sees the same in-flight data on canvas
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {});
    expect(s.pendingCount()).toBe(0);                      // not re-enqueued
    release(); await tick(); await tick();
    expect(commits).toHaveLength(1);                       // exactly one write total
  });
});

// B757 — the single-tab false "you (another window)" conflict. During ACTIVE manipulation of one
// element in ONE tab, our own write echoes back over realtime AHEAD of its own RPC result. If a
// NEWER edit has meanwhile queued, comparing the echo only against the dirty||inflight WINNER missed
// the in-flight data and mis-fired `remote-while-dirty` → a bogus "someone else edited it" pop-up
// with nobody else present. The echo must be recognized as ours by matching EITHER pending entry
// (and our own delete's tombstone echo while a delete is in flight).
describe("B757 — a single tab never sees a false 'another window' conflict on its own echo", () => {
  // In-flight commit's own echo, arriving after a NEWER edit queued: recognized as ours, silent.
  it("in-flight edit echo while a newer edit is queued → silent (no remote-while-dirty)", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const events = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => { await gate; return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); s.flushGesture(); await tick(); // D1 (cx:50) in flight
    s.reconcile({ els: [{ id: "e1", cx: 60, z: 0 }] }, {});                                 // D2 (cx:60) queued while D1 in flight
    // the realtime echo of our OWN D1 write lands (rev bumped, authored by self)
    const instr = s.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 50, z: 0 }, rev: 2, z_index: 0, updated_by: "me" });
    expect(instr.action).toBe("ignore");
    expect(events.filter((e) => e.type === "remote-while-dirty")).toHaveLength(0); // ← the fix: recognized as our own echo
    expect(s.pendingCount()).toBe(1);                     // D2 is still queued (not our echo, not dropped)
    release(); await tick(); await tick();
  });

  // Our own DELETE's tombstone echo, arriving before its RPC result, is not a foreign conflict.
  it("in-flight delete's own tombstone echo → silent (no remote-while-dirty)", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const events = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => { await gate; return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 3, z_index: 0 }]);
    s.reconcile({ els: [] }, {}); await tick();          // delete flushed immediately → in flight
    const instr = s.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 4, z_index: 0, deleted_at: "2026-07-11T00:00:00Z", deleted_by: "me" });
    expect(instr.action).toBe("ignore");
    expect(events.filter((e) => e.type === "remote-while-dirty")).toHaveLength(0); // our own tombstone echo, not a conflict
    release(); await tick(); await tick();
  });

  // After editing THEN deleting an element, a delayed echo of the pre-delete UPDATE must not resurrect
  // it (the delete removed the shadow rev ceiling). The delete's remembered rev is the floor.
  it("a stale pre-delete edit echo after a local delete → ignored (no resurrect, no toast)", async () => {
    const events = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }),
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); s.flushGesture(); await tick(); // edit → rev 2
    s.reconcile({ els: [] }, {}); await tick();                                             // delete → rev 3, shadow.delete
    expect(s.shadowSnapshot().has("el:e1")).toBe(false);
    // the delayed echo of the earlier UPDATE (rev 2, our own uid) lands after the delete
    const instr = s.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 50, z: 0 }, rev: 2, z_index: 0, updated_by: "me" });
    expect(instr.action).toBe("ignore");                 // ← the fix: not resurrected
    expect(events.filter((e) => e.type === "remote-upsert")).toHaveLength(0); // no false "another window" toast
  });

  // GUARD: a genuine re-create by ANOTHER window (rev ABOVE our delete's rev) still comes through, so
  // the tombstone floor doesn't swallow a real re-add.
  it("a genuine re-create above the delete rev still upserts (tombstone floor doesn't over-suppress)", async () => {
    const events = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }),
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); s.flushGesture(); await tick(); // edit → rev 2
    s.reconcile({ els: [] }, {}); await tick();                                             // delete → rev 3
    // another window re-created it → rev 8 (above our delete's rev 3)
    const instr = s.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 99, z: 0 }, rev: 8, z_index: 0, updated_by: "someone-else" });
    expect(instr.action).toBe("upsert");                 // genuinely live again → comes through
    expect(events.filter((e) => e.type === "remote-upsert")).toHaveLength(1);
  });

  // GUARD: a GENUINE other-window edit (data matching NEITHER pending entry) still surfaces loudly —
  // the fix must not silence real two-window conflicts.
  it("a genuine foreign edit (data ≠ inflight AND ≠ dirty) still fires remote-while-dirty", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const events = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => { await gate; return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); s.flushGesture(); await tick(); // D1 in flight
    s.reconcile({ els: [{ id: "e1", cx: 60, z: 0 }] }, {});                                 // D2 queued
    // another window committed cx:99 — matches neither our in-flight (50) nor our dirty (60)
    const instr = s.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 99, z: 0 }, rev: 7, z_index: 0, updated_by: "someone-else" });
    expect(instr.action).toBe("ignore");                 // local data stays on canvas
    expect(events.filter((e) => e.type === "remote-while-dirty")).toHaveLength(1); // real conflict → still surfaced
    release(); await tick(); await tick();
    expect(s.shadowSnapshot().get("el:e1").rev).toBe(7); // adopted the foreign rev
  });

  // WRITE-PATH self-conflict: an 8 s COMMIT_TIMEOUT_MS aborts a commit that actually landed
  // server-side; the retry re-flushes at the stale expected rev, hits OUR OWN committed row (a
  // 'conflict' whose data === our data), and pre-fix emitted edit-vs-edit-lost-race in a single tab.
  it("a timed-out-but-committed edit whose retry conflicts with our OWN row → silent (no edit-vs-edit toast)", async () => {
    const h = makeHarness();
    h.sync.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    let call = 0;
    h.setResponder((ops) => {
      call += 1;
      if (call === 1) return { ok: false, results: [], error: "commit timeout" };   // aborted, but it committed at rev 2
      return { ok: true, results: ops.map((o) => ({ id: o.id, status: "conflict", row: { data: o.data, rev: 2, z_index: o.z, updated_by: "me" } })) };
    });
    h.sync.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); h.sync.flushGesture(); await tick(); // attempt 1 → timeout → requeue + backoff
    h.runTimers(); await tick();                          // backoff → retry (attempt 2) → conflict = our own data
    expect(call).toBe(2);
    expect(h.events.filter((e) => e.type === "edit-vs-edit-lost-race")).toHaveLength(0); // our own committed data, not a foreign edit
    expect(h.sync.shadowSnapshot().get("el:e1").rev).toBe(2); // converged at the fresh rev
    expect(h.sync.pendingCount()).toBe(0);                // not re-committed
  });

  // Same class on the RESTORE path.
  it("a timed-out-but-committed restore whose retry conflicts with our OWN row → silent (no restore-conflict toast)", async () => {
    const h = makeHarness();
    h.sync.seed([]);
    let call = 0;
    h.setResponder((ops) => {
      call += 1;
      if (call === 1) return { ok: false, results: [], error: "commit timeout" };
      return { ok: true, results: ops.map((o) => ({ id: o.id, status: "conflict", row: { data: o.data, rev: 9, z_index: o.z, updated_by: "me" } })) };
    });
    h.sync.restore("el", "e1", { id: "e1", cx: 7, z: 0 }); await tick(); // restore attempt 1 → timeout → requeue
    h.runTimers(); await tick();                          // retry → conflict = our own data
    expect(h.events.filter((e) => e.type === "restore-conflict")).toHaveLength(0);
    expect(h.sync.shadowSnapshot().get("el:e1").rev).toBe(9);
  });

  // GUARD: a genuine write-path conflict carrying DIFFERENT data still fires the toast (already covered
  // by the L156 test for the happy retry; here via the timeout→retry path to pin the self-dup gate).
  it("a timed-out edit whose retry conflicts with DIFFERENT (foreign) data still fires edit-vs-edit", async () => {
    const h = makeHarness();
    h.sync.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    let call = 0;
    h.setResponder((ops) => {
      call += 1;
      if (call === 1) return { ok: false, results: [], error: "commit timeout" };
      return { ok: true, results: ops.map((o) => ({ id: o.id, status: "conflict", row: { data: { id: "e1", cx: 999, z: 0 }, rev: 4, z_index: 0, updated_by: "u2" } })) };
    });
    h.sync.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); h.sync.flushGesture(); await tick();
    h.runTimers(); await tick();
    expect(h.events.filter((e) => e.type === "edit-vs-edit-lost-race")).toHaveLength(1); // real foreign write → still surfaced
  });

  // Residual: the realtime echo of a committed-but-unacked write, after a NEWER edit queued during the
  // retry backoff — inflight is cleared and dirty holds D2, so only the recentSent backstop recognizes it.
  it("a committed-but-unacked write's realtime echo, after a newer edit queued during backoff → silent", async () => {
    const h = makeHarness();
    h.sync.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    h.setResponder(() => ({ ok: false, results: [], error: "timeout" })); // D1 aborted but committed at rev 2 server-side
    h.sync.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); h.sync.flushGesture(); await tick(); // D1 on wire → timeout → requeued; backoff pending (not run)
    h.sync.reconcile({ els: [{ id: "e1", cx: 60, z: 0 }] }, {}); // D2 queued during backoff, overwrites the requeued D1 in dirty
    // the realtime echo of the committed D1 (rev 2) lands — matches neither inflight (cleared) nor dirty (D2)
    const instr = h.sync.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 50, z: 0 }, rev: 2, z_index: 0, updated_by: "me" });
    expect(instr.action).toBe("ignore");
    expect(h.events.filter((e) => e.type === "remote-while-dirty")).toHaveLength(0); // recognized as ours via recentSent
  });

  // ── RECURRENCE (owner 2026-07-13): the burst of "you (another window) changed X you just edited"
  // while editing in ONE tab. Root cause: a refetch-replace (fires on every socket reconnect / tab-
  // wake) re-seeds the shadow from a fetch snapshot OLDER than a batch this tab just committed — the
  // seed rolls the shadow revs BACKWARD, and the just-committed batch's realtime echoes then arrive
  // at a higher rev with NO pending entry left, so each element mis-fires the conflict toast. B757
  // hardened only the pending branch; these pin the no-pending READ path (edit + delete twins).
  it("a stale-seed edit echo (refetch predated the commit) → upsert with NO false 'another window' toast", async () => {
    const events = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }),
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); s.flushGesture(); await tick(); // edit → committed rev 2 (recentSent = cx:50)
    // a refetch-replace lands whose fetch snapshot PREDATES the edit → shadow rolled BACK to rev 1
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    // the realtime echo of OUR OWN edit now arrives (rev 2) ABOVE the stale shadow, no pending entry
    const instr = s.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 50, z: 0 }, rev: 2, z_index: 0, updated_by: "me" });
    expect(instr.action).toBe("ignore");                       // B812: own-rev echo → ignore (canvas already fresh)
    expect(events.filter((e) => e.type === "remote-upsert")).toHaveLength(0); // ← the fix: no false toast
  });

  // GUARD: after we commit an edit (authoredRecently), a GENUINE foreign overwrite of the SAME element
  // arriving with no pending entry still surfaces "changed X you just edited" — must not be silenced.
  it("a genuine foreign upsert of an element we just edited still fires remote-upsert(authoredRecently)", async () => {
    const events = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }),
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); s.flushGesture(); await tick(); // we edit → rev 2, recentSent = cx:50
    // another window overwrites it to cx:99 (rev 3) — different data, no pending local entry
    const instr = s.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 99, z: 0 }, rev: 3, z_index: 0, updated_by: "someone-else" });
    expect(instr.action).toBe("upsert");
    const t = events.filter((e) => e.type === "remote-upsert");
    expect(t).toHaveLength(1);
    expect(t[0].authoredRecently).toBe(true);                  // real overwrite of what we just touched → surfaced loudly
  });

  it("a stale-seed tombstone echo of our OWN delete → remove with NO false 'deleted by another window' toast", async () => {
    const events = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }),
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 3, z_index: 0 }]);
    s.reconcile({ els: [] }, {}); await tick();                // delete → committed rev 4 (delete floor = 4)
    // a refetch-replace whose fetch predated the delete re-seeds the element ALIVE again
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 3, z_index: 0 }]);
    // our own delete's tombstone echo now lands (rev 4), no pending entry
    const instr = s.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 4, z_index: 0, deleted_at: "2026-07-13T00:00:00Z", deleted_by: "me" });
    expect(instr.action).toBe("remove");                       // canvas drops the re-seeded ghost
    expect(events.filter((e) => e.type === "remote-delete")).toHaveLength(0); // ← the fix: no false toast
  });

  // GUARD: a GENUINE delete by another window (we hold no delete floor for it) still surfaces removal.
  it("a genuine foreign delete of an element we just edited still fires remote-delete", async () => {
    const events = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }),
    });
    s.seed([{ kind: "el", id: "e1", data: { id: "e1", cx: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "e1", cx: 50, z: 0 }] }, {}); s.flushGesture(); await tick(); // we edit → rev 2 (no delete floor)
    // another window deletes it (rev 3) — no tombstone floor of ours to suppress it
    const instr = s.applyRemoteRow({ kind: "el", id: "e1", data: { id: "e1", cx: 50, z: 0 }, rev: 3, z_index: 0, deleted_at: "2026-07-13T00:00:00Z", deleted_by: "u2" });
    expect(instr.action).toBe("remove");
    const t = events.filter((e) => e.type === "remote-delete");
    expect(t).toHaveLength(1);
    expect(t[0].authoredRecently).toBe(true);                  // "X you just edited was deleted by ⟨name⟩"
  });
});

// B812 — the single-tab BURST that survived B759(×2)+B811: a resized building's bonded children
// (sidewalk/paving/parking) get REFITTED and re-committed several times (once per debounced flush),
// so each accrues MANY revs fast. Then a socket reconnect fires refetch-replace whose fetch snapshot
// is OLDER than — or omits entirely — those just-committed children, and the realtime echoes of the
// tab's OWN writes arrive. B811 (reconcileSeedRows) only protects children the fetch still CONTAINS;
// a child DROPPED by the stale fetch loses its shadow entry, and an INTERMEDIATE-rev echo then passes
// the rev guard with no pending entry and no data-match in the single-slot cache → a false toast per
// pre-final commit = the reported burst. OWN-ECHO-BY-REV closes it: every rev THIS tab produced is
// remembered, so any self-echo is recognized regardless of shadow/data state.
describe("B812 — own-echo-by-rev kills the single-tab resize burst", () => {
  const mkSync = (events) => createElementSync({
    siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
    onEvent: (e) => events.push(e),
    commit: async (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }),
  });

  it("a child DROPPED by a stale refetch: intermediate-rev self-echoes fire NO toast (the burst)", async () => {
    const events = [];
    const s = mkSync(events);
    s.seed([{ kind: "el", id: "pv", data: { id: "pv", area: 1 }, rev: 1, z_index: 0 }]);
    // bonded child refit + re-committed twice during the drag → rev 2 (area 2), then rev 3 (area 3)
    s.reconcile({ els: [{ id: "pv", area: 2, z: 0 }] }, {}); s.flushGesture(); await tick();
    s.reconcile({ els: [{ id: "pv", area: 3, z: 0 }] }, {}); s.flushGesture(); await tick();
    // reconnect refetch-replace whose snapshot OMITS the just-committed child → shadow entry dropped
    s.seed([]); // reconcileSeedRows can't re-insert a row the fetch lacks → child is gone from the shadow
    expect(s.shadowSnapshot().has("el:pv")).toBe(false);
    // the tab's OWN echoes of the intermediate (rev 2) and final (rev 3) commits now arrive
    const i2 = s.applyRemoteRow({ kind: "el", id: "pv", data: { id: "pv", area: 2, z: 0 }, rev: 2, z_index: 0, updated_by: "me" });
    const i3 = s.applyRemoteRow({ kind: "el", id: "pv", data: { id: "pv", area: 3, z: 0 }, rev: 3, z_index: 0, updated_by: "me" });
    expect(i2.action).toBe("ignore");
    expect(i3.action).toBe("ignore");
    expect(events.filter((e) => e.type === "remote-upsert")).toHaveLength(0); // ← NO burst
    expect(s.shadowSnapshot().get("el:pv").rev).toBe(3); // shadow re-advanced monotonically to our top rev
  });

  it("a re-created child (fold → pending) mid-flight: old self-echoes fire NO remote-while-dirty", async () => {
    const events = [];
    const s = mkSync(events);
    s.seed([{ kind: "el", id: "pv", data: { id: "pv", area: 1 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "pv", area: 2, z: 0 }] }, {}); s.flushGesture(); await tick(); // rev 2
    s.reconcile({ els: [{ id: "pv", area: 3, z: 0 }] }, {}); s.flushGesture(); await tick(); // rev 3
    s.seed([]); // stale refetch drops the child from the shadow
    // the fold re-adds it to canvas → reconcile enqueues a CREATE that is now pending/in-flight...
    s.reconcile({ els: [{ id: "pv", area: 3, z: 0 }] }, {}); // pending create (no shadow)
    // ...and while it is pending, a buffered echo of the OLDER rev-2 commit replays
    const i = s.applyRemoteRow({ kind: "el", id: "pv", data: { id: "pv", area: 2, z: 0 }, rev: 2, z_index: 0, updated_by: "me" });
    expect(i.action).toBe("ignore");
    expect(events.filter((e) => e.type === "remote-while-dirty")).toHaveLength(0); // ← no false pending-conflict toast
  });

  it("GUARD: a GENUINE foreign write at an UNRECORDED rev still fires remote-upsert(authoredRecently)", async () => {
    const events = [];
    const s = mkSync(events);
    s.seed([{ kind: "el", id: "pv", data: { id: "pv", area: 1 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "pv", area: 2, z: 0 }] }, {}); s.flushGesture(); await tick(); // our rev 2
    s.reconcile({ els: [{ id: "pv", area: 3, z: 0 }] }, {}); s.flushGesture(); await tick(); // our rev 3
    s.seed([]); // shadow dropped, same stale-refetch setup as the burst case
    // a real other-window write lands at rev 4 (a rev WE never produced), different data
    const instr = s.applyRemoteRow({ kind: "el", id: "pv", data: { id: "pv", area: 99, z: 0 }, rev: 4, z_index: 0, updated_by: "someone-else" });
    expect(instr.action).toBe("upsert");
    const t = events.filter((e) => e.type === "remote-upsert");
    expect(t).toHaveLength(1);
    expect(t[0].authoredRecently).toBe(true); // we touched pv within 15s → real overwrite is surfaced loudly
  });

  it("GUARD: a foreign write at a rev NUMERICALLY EQUAL to one we produced but for a DIFFERENT element still toasts", async () => {
    const events = [];
    const s = mkSync(events);
    s.seed([{ kind: "el", id: "pv", data: { id: "pv", area: 1, z: 0 }, rev: 1, z_index: 0 },
            { kind: "el", id: "sw", data: { id: "sw", area: 1, z: 0 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "pv", area: 2, z: 0 }, { id: "sw", area: 1, z: 0 }] }, {}); s.flushGesture(); await tick(); // pv → our rev 2 (sw unchanged, never committed)
    // ownRevs are keyed PER element: a foreign write to sw at rev 2 must NOT be masked by pv's rev 2
    const instr = s.applyRemoteRow({ kind: "el", id: "sw", data: { id: "sw", area: 88, z: 0 }, rev: 2, z_index: 0, updated_by: "someone-else" });
    expect(instr.action).toBe("upsert");
    expect(events.filter((e) => e.type === "remote-upsert" && e.id === "sw")).toHaveLength(1);
  });

  // Round-2 Angle 4: an own-echo that outlives the 15s ownRevs/recentSent windows is STILL recognized by
  // the never-pruned HIGH-WATER floor (any rev <= our highest committed rev is ours), so no false toast —
  // even when the element is still authoredRecently and a stale refetch dropped its shadow entry.
  it("high-water floor: a self-echo older than the ~15s ownRevs window is still recognized as ours", async () => {
    const events = [];
    let clock = 0;
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => clock, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }),
    });
    s.seed([{ kind: "el", id: "pv", data: { id: "pv", area: 1 }, rev: 1, z_index: 0 }]);
    s.reconcile({ els: [{ id: "pv", area: 2, z: 0 }] }, {}); s.flushGesture(); await tick(); // rev 2 (high-water) at t=0
    clock = 20000; // 20s later — past the 15s ownRevs/recentSent window
    s.seed([]); // stale refetch drops the shadow entry
    const instr = s.applyRemoteRow({ kind: "el", id: "pv", data: { id: "pv", area: 2, z: 0 }, rev: 2, z_index: 0, updated_by: "me" });
    expect(instr.action).toBe("ignore"); // rev 2 <= high-water 2 → ours → suppressed
    expect(events.filter((e) => e.type === "remote-upsert")).toHaveLength(0);
  });

  it("Angle 4: an element edited >15s after its create, shadow dropped, old-create echo mid re-create → NO toast", async () => {
    const events = [];
    let clock = 0;
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => clock, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: (e) => events.push(e),
      commit: async (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }),
    });
    s.seed([]);
    s.reconcile({ els: [{ id: "cc", v: 1, z: 0 }] }, {}); s.flushGesture(); await tick(); // CREATE → rev 1 (high-water) at t=0
    clock = 20000;
    s.reconcile({ els: [{ id: "cc", v: 2, z: 0 }] }, {}); s.flushGesture(); await tick(); // edit >15s later → rev 2 (high-water now 2), isRecent refreshed
    s.seed([]); // stale refetch omits cc → shadow dropped
    s.reconcile({ els: [{ id: "cc", v: 2, z: 0 }] }, {}); // fold re-adds → pending create in-flight (no shadow)
    // a replayed echo of the OLD create (rev 1) lands during the in-flight window
    const instr = s.applyRemoteRow({ kind: "el", id: "cc", data: { id: "cc", v: 1, z: 0 }, rev: 1, z_index: 0, updated_by: "me" });
    expect(instr.action).toBe("ignore");                    // rev 1 <= high-water 2 → ours
    expect(events.filter((e) => e.type === "remote-while-dirty")).toHaveLength(0); // ← the round-2 fix
  });

  // Round-4 (owner "close all loose ends"): the delete floor exposed to reconcileSeedRows is now a
  // NEVER-pruned high-water, so an in-session reconnect ARBITRARILY LATER than a delete still keeps the
  // element deleted; a genuine re-create clears it.
  it("the delete floor for reconcileSeedRows survives >15s (never-pruned) and clears on re-create", async () => {
    let clock = 0;
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => clock, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: () => {},
      commit: async (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }),
    });
    s.seed([{ kind: "el", id: "pv", data: { id: "pv", w: 10 }, rev: 5, z_index: 0 }]);
    s.reconcile({ els: [] }, {}); await tick();             // delete → floor rev 6
    clock = 20000;                                          // 20s later — past the 15s in-flight window
    expect(s.tombstonedSnapshot().get("el:pv")?.rev).toBe(6); // floor retained (never pruned)
    // re-create pv (restore / new element at the same id) → the floor is dropped
    s.reconcile({ els: [{ id: "pv", w: 99, z: 0 }] }, {}); s.flushGesture(); await tick();
    expect(s.tombstonedSnapshot().has("el:pv")).toBe(false); // cleared → won't hide the re-create
  });
});

// B756 — the refetch-replace integration the data-loss fix restores: a brand-new signed-in site's
// parcels live only in local state (rows are empty on the first fetch). foldNeverSyncedLocal folds them
// back into `next`, and the post-substitution reconcile must COMMIT them as creates (they used to be
// silently wiped, leaving 0 site_elements rows).
describe("B756 — never-synced local parcels commit through refetch-replace", () => {
  it("seed([]) + fold-in a local-only parcel + reconcile → one create commit (parcels reach site_elements)", async () => {
    const commits = [];
    const s = createElementSync({
      siteId: "s", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      commit: async (ops) => { commits.push(ops); return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: 1 })) }; },
    });
    s.seed([]); // refetchReplace fetched 0 rows for the brand-new site
    const next = { els: [], markups: [], measures: [], callouts: [], parcels: [] }; // rows-canonical = empty
    const local = { ...next, parcels: [{ id: "psX_0", points: [[0, 0], [10, 0], [10, 10]] }] };
    const merged = foldNeverSyncedLocal(next, local, new Set() /* no rows */);
    expect(merged.parcels.map((p) => p.id)).toEqual(["psX_0"]); // survived the wipe
    s.reconcile(merged, { busy: false });
    await tick();
    expect(commits).toHaveLength(1);
    expect(commits[0][0]).toMatchObject({ op: "create", id: "psX_0", kind: "parcel" }); // committed as a row
  });

  it("a parcel that already has a row is NOT re-committed (rows canonical, no V229 re-commit)", async () => {
    const commits = [];
    const s = createElementSync({
      siteId: "s", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      commit: async (ops) => { commits.push(ops); return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: 1 })) }; },
    });
    const row = { kind: "parcel", id: "psX_0", data: { id: "psX_0", points: [[0, 0], [10, 0], [10, 10]] }, rev: 5, z_index: 0 };
    s.seed([row]);
    const next = { els: [], markups: [], measures: [], callouts: [], parcels: [row.data] };
    const local = { ...next, parcels: [{ id: "psX_0", points: [[9, 9], [1, 1], [2, 2]] }] }; // STALE local geometry
    const merged = foldNeverSyncedLocal(next, local, new Set(["parcel:psX_0"]));
    expect(merged.parcels).toEqual([row.data]); // adopts the row, not the stale local copy
    s.reconcile(merged, { busy: false });
    await tick();
    expect(commits).toHaveLength(0); // nothing re-committed — the stale tab can't clobber
  });
});

describe("stableStringify", () => {
  it("is key-order-insensitive and recurses", () => {
    expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 4 }, b: 1 }));
  });

  // B812 red-team (Angle 2): stableStringify MUST equal the value's post-wire form (JSON.stringify →
  // jsonb → back), because every self-echo/self-dup guard byte-compares a LOCAL object against a SERVER
  // row. JSON drops undefined-valued keys / functions / symbols and renders holes+undefined as null; the
  // old code emitted an `undefined` token, so an element with an undefined property looked foreign.
  const wireThenSorted = (v) => {
    const round = JSON.parse(JSON.stringify(v) ?? "null");
    const sortRec = (x) => Array.isArray(x) ? x.map(sortRec)
      : (x && typeof x === "object") ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortRec(x[k])])) : x;
    return JSON.stringify(sortRec(round));
  };
  it("matches the wire (JSON) form exactly — drops undefined keys, holes/undefined → null", () => {
    for (const v of [
      { id: "e1", w: 110, hatch: undefined },
      { id: "e2", pts: [1, undefined, 3] },
      { b: 1, a: undefined, c: { z: undefined, y: 2 } },
      { id: "e3", cx: 228.4999999997, cy: -0, big: 1e21, arr: [] },
      { fn: function () {}, ok: 5 },
      { nested: [{ a: undefined, b: [undefined, 1] }] },
    ]) {
      expect(stableStringify(v)).toBe(wireThenSorted(v));
    }
  });
  it("an element differing only by an undefined-valued key serializes IDENTICALLY (no phantom diff)", () => {
    expect(stableStringify({ id: "pv", w: 10, z: 0, hatch: undefined })).toBe(stableStringify({ id: "pv", w: 10, z: 0 }));
  });
});

/* NEW-1 — the two-tab cascade false-conflict class (owner-reported 2026-07-14 + 2026-07-15).
 * Two same-account tabs on one plan: an edit in the active tab re-lays its bonded children
 * (paving / sidewalks / parking), and the idle tab's rows→canvas→re-derive round trip can echo
 * back byte-DIVERGENT but geometrically identical copies at foreign revs. Three engine guards:
 *   #1 only DIRECT edits feed `recent`/authoredRecently (a cascade write never claims "you just
 *      edited"), via the injected isDirectEdit predicate;
 *   #2 semantically-equal copies are SILENT (no event) on every read/conflict path;
 *   #3 `stale` (mixed json↔rev) shadow pairings never seed a refetch (reconcileSeedRows). */

describe("NEW-1 #1 — derived cascade ops never claim authorship (isDirectEdit)", () => {
  const bonded = (id, extra = {}) => ({ id, type: "paving", cx: 0, cy: 0, w: 10, h: 10, z: 2048, attachedTo: "b1", ...extra });
  const byShape = { isDirectEdit: (kind, id, el) => !(el && el.attachedTo) }; // bonded = derived

  it("a foreign overwrite of a DERIVED element fires remote-upsert with authoredRecently:false → the toast layer stays quiet", async () => {
    const h = makeHarness({ sync: byShape });
    h.sync.reconcile({ els: [el("b1", { z: 1024 }), bonded("pv1")] }, {}); await tick(); // creates
    // the gesture: building edited (direct), bonded child re-laid by the cascade (derived)
    h.sync.reconcile({ els: [el("b1", { z: 1024, w: 20 }), bonded("pv1", { cx: 5 })] }, {});
    h.sync.flushGesture(); await tick();
    // tab B's re-derived copy of the CHILD echoes in at a foreign rev with genuinely different data
    const r = h.sync.applyRemoteRow({ kind: "el", id: "pv1", rev: 99, z_index: 2048, deleted_at: null, data: bonded("pv1", { cx: 555 }) });
    expect(r.action).toBe("upsert"); // data still converges (LWW read) — only the BLAME is gated
    const ev = h.events.filter((e) => e.type === "remote-upsert").pop();
    expect(ev.authoredRecently).toBe(false); // never "…you just edited" for an element the user never touched
    expect(toastForSyncEvent(ev, { name: "you (another window)", label: "a paving area" })).toBeNull();
  });

  it("GUARD: the DIRECT element (the one actually edited) still claims authorship — a real foreign overwrite toasts", async () => {
    const h = makeHarness({ sync: byShape });
    h.sync.reconcile({ els: [el("b1", { z: 1024 }), bonded("pv1")] }, {}); await tick();
    h.sync.reconcile({ els: [el("b1", { z: 1024, w: 20 }), bonded("pv1", { cx: 5 })] }, {});
    h.sync.flushGesture(); await tick();
    const r = h.sync.applyRemoteRow({ kind: "el", id: "b1", rev: 99, z_index: 1024, deleted_at: null, data: el("b1", { z: 1024, w: 77 }) });
    expect(r.action).toBe("upsert");
    const ev = h.events.filter((e) => e.type === "remote-upsert").pop();
    expect(ev.authoredRecently).toBe(true);
    expect(toastForSyncEvent(ev, { name: "you (another window)", label: "a building" })).not.toBeNull();
  });

  it("the derived tag survives a conflict re-enqueue (LWW re-commit still never stamps recent)", async () => {
    const h = makeHarness({ sync: byShape });
    h.sync.reconcile({ els: [el("b1", { z: 1024 }), bonded("pv1")] }, {}); await tick();
    // the child's cascade update loses a race (genuinely different remote data → loud LWW branch)
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => (o.id === "pv1"
      ? { id: o.id, status: "conflict", row: { rev: 7, z_index: 2048, data: bonded("pv1", { cx: 900 }) } }
      : { id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }));
    h.sync.reconcile({ els: [el("b1", { z: 1024 }), bonded("pv1", { cx: 5 })] }, {});
    h.runTimers(); await tick();
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }));
    h.runTimers(); await tick(); // the re-commit lands
    // a later foreign overwrite still reads authoredRecently:false — the re-enqueue kept direct:false
    const ev = (() => { h.sync.applyRemoteRow({ kind: "el", id: "pv1", rev: 99, z_index: 2048, deleted_at: null, data: bonded("pv1", { cx: 321 }) }); return h.events.filter((e) => e.type === "remote-upsert").pop(); })();
    expect(ev.authoredRecently).toBe(false);
  });

  it("restore() is ALWAYS direct (an explicit user action), even under an everything-is-derived predicate", async () => {
    const h = makeHarness({ sync: { isDirectEdit: () => false } });
    h.sync.restore("el", "e1", el("e1", { z: 1024 })); await tick();
    h.sync.applyRemoteRow({ kind: "el", id: "e1", rev: 99, z_index: 1024, deleted_at: null, data: el("e1", { z: 1024, w: 50 }) });
    const ev = h.events.filter((e) => e.type === "remote-upsert").pop();
    expect(ev.authoredRecently).toBe(true);
  });

  it("a THROWING predicate fails open to direct — attribution problems never silence a real heads-up", async () => {
    const h = makeHarness({ sync: { isDirectEdit: () => { throw new Error("boom"); } } });
    h.sync.reconcile({ els: [el("e1", { z: 1024 })] }, {}); await tick();
    h.sync.applyRemoteRow({ kind: "el", id: "e1", rev: 99, z_index: 1024, deleted_at: null, data: el("e1", { z: 1024, w: 50 }) });
    expect(h.events.filter((e) => e.type === "remote-upsert").pop().authoredRecently).toBe(true);
  });

  it("no predicate passed → everything stays direct (pre-NEW-1 behavior preserved)", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1", { z: 1024 })] }, {}); await tick();
    h.sync.applyRemoteRow({ kind: "el", id: "e1", rev: 99, z_index: 1024, deleted_at: null, data: el("e1", { z: 1024, w: 50 }) });
    expect(h.events.filter((e) => e.type === "remote-upsert").pop().authoredRecently).toBe(true);
  });
});

describe("NEW-1 #2 — semantically-equal copies are silent (semanticallyEqual + the three read paths)", () => {
  it("semanticallyEqual: float noise within eps is equal; a real edit is not; key sets must match both ways", () => {
    expect(semanticallyEqual({ cx: 100, pts: [1, 2] }, { cx: 100 + 1e-9, pts: [1 + 1e-12, 2] })).toBe(true);
    expect(semanticallyEqual({ cx: 100 }, { cx: 100.5 })).toBe(false);            // a genuine move
    expect(semanticallyEqual({ cx: 1 }, { cx: 1, extra: 0 })).toBe(false);        // added key = real change
    expect(semanticallyEqual({ a: undefined, cx: 1 }, { cx: 1 })).toBe(true);     // JSON semantics: undefined = absent
    expect(semanticallyEqual({ n: NaN }, { n: NaN })).toBe(true);
    expect(semanticallyEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(semanticallyEqual({ s: "a" }, { s: "b" })).toBe(false);
    expect(semanticallyEqual(null, {})).toBe(false);
    expect(semanticallyEqual({ deep: { pts: [{ x: 5 }] } }, { deep: { pts: [{ x: 5 + 1e-8 }] } })).toBe(true);
  });

  it("conflict path: a byte-divergent but semantically-equal live row adopts SILENTLY — no event, no re-commit ping-pong", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1", { z: 1024 })] }, {}); await tick(); // create @ rev 1
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({
      id: o.id, status: "conflict", row: { rev: 5, z_index: 1024, data: { ...o.data, cx: 1e-9 } }, // the other tab's float-noise copy
    })) }));
    h.sync.reconcile({ els: [el("e1", { z: 1024, w: 20 })] }, {});
    h.runTimers(); await tick();
    expect(h.events).toHaveLength(0);          // no lost-race toast for an invisible difference
    expect(h.commits).toHaveLength(2);         // and no third commit queued (no ping-pong)
    expect(h.sync.pendingCount()).toBe(0);
    // the remote rev WAS adopted — the next real edit targets it
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }));
    h.sync.reconcile({ els: [el("e1", { z: 1024, w: 30 })] }, {});
    h.runTimers(); await tick();
    expect(h.commits[2][0].expected).toBe(5);
  });

  it("no-pending read path: a foreign-rev row semantically equal to the shadow upserts with NO remote-upsert event (the reported burst)", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("pv1", { z: 2048, attachedTo: "b1" })] }, {}); await tick();
    const r = h.sync.applyRemoteRow({ kind: "el", id: "pv1", rev: 42, z_index: 2048, deleted_at: null,
      data: { ...el("pv1", { z: 2048, attachedTo: "b1" }), cx: 1e-10 } }); // tab B's re-derived copy
    expect(r.action).toBe("upsert");           // bytes still converge to the server's copy
    expect(h.events).toHaveLength(0);          // but nobody is told anything changed — nothing did
  });

  it("GUARD (no-pending): a genuinely different foreign row still fires remote-upsert(authoredRecently)", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1", { z: 1024 })] }, {}); await tick();
    h.sync.applyRemoteRow({ kind: "el", id: "e1", rev: 42, z_index: 1024, deleted_at: null, data: el("e1", { z: 1024, cx: 50 }) });
    const ev = h.events.filter((e) => e.type === "remote-upsert").pop();
    expect(ev).toBeTruthy();
    expect(ev.authoredRecently).toBe(true);
  });

  it("pending read path: a semantically-equal foreign row while dirty is silent; the LWW re-commit still runs", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("e1", { z: 1024 })] }, {}); await tick();
    h.sync.reconcile({ els: [el("e1", { z: 1024, w: 20 })] }, {}); await tick(); // dirty (debounced)
    const r = h.sync.applyRemoteRow({ kind: "el", id: "e1", rev: 9, z_index: 1024, deleted_at: null,
      data: { ...el("e1", { z: 1024, w: 20 }), cx: 1e-9 } });
    expect(r.action).toBe("ignore");           // local (dirty) data stays on canvas
    expect(h.events).toHaveLength(0);          // no remote-while-dirty for an invisible difference
    h.runTimers(); await tick();               // the pending edit still re-commits at the adopted rev
    expect(h.commits[1][0].expected).toBe(9);
  });
});

describe("NEW-1 #3 — stale (mixed json↔rev) shadow pairings never seed a refetch", () => {
  it("a foreign row adopted while dirty leaves a `stale` shadow entry; reconcileSeedRows keeps the fetched row canonical", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("sw1", { z: 1024 })] }, {}); await tick();            // create @ rev 1
    h.sync.reconcile({ els: [el("sw1", { z: 1024, cx: 140 })] }, {}); await tick();   // dirty (debounced)
    // a foreign row (different data) lands while dirty → the engine adopts rev 9 but KEEPS the old json
    h.sync.applyRemoteRow({ kind: "el", id: "sw1", rev: 9, z_index: 1024, deleted_at: null, data: el("sw1", { z: 1024, cx: 900 }) });
    const snap = h.sync.shadowSnapshot();
    expect(snap.get("el:sw1").stale).toBe(true);
    expect(snap.get("el:sw1").rev).toBe(9);
    // a stale FETCH (rev 4 < 9) must NOT be overwritten from that mixed pairing — the row stays
    const rows = [{ kind: "el", id: "sw1", rev: 4, z_index: 1024, deleted_at: null, data: el("sw1", { z: 1024, cx: 100 }) }];
    const out = reconcileSeedRows(rows, snap, h.sync.tombstonedSnapshot());
    expect(out[0].data).toEqual(el("sw1", { z: 1024, cx: 100 }));
    expect(out[0].rev).toBe(4);
  });

  it("a CLEAN just-committed shadow entry still substitutes over a stale fetch (B759 behavior preserved)", async () => {
    const h = makeHarness();
    h.sync.reconcile({ els: [el("sw1", { z: 1024 })] }, {}); await tick();            // rev 1
    h.sync.reconcile({ els: [el("sw1", { z: 1024, cx: 140 })] }, {});
    h.sync.flushGesture(); await tick();                                              // committed @ rev 2
    const rows = [{ kind: "el", id: "sw1", rev: 1, z_index: 1024, deleted_at: null, data: el("sw1", { z: 1024 }) }];
    const out = reconcileSeedRows(rows, h.sync.shadowSnapshot(), h.sync.tombstonedSnapshot());
    expect(out[0].rev).toBe(2);
    expect(out[0].data.cx).toBe(140); // our committed move survives the stale fetch
  });
});
