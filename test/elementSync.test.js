import { describe, it, expect } from "vitest";
import { createElementSync, stableStringify } from "../src/workspaces/site-planner/lib/elementSync.js";

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

describe("stableStringify", () => {
  it("is key-order-insensitive and recurses", () => {
    expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 4 }, b: 1 }));
  });
});
