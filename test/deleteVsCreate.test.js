import { describe, it, expect } from "vitest";
import { createElementSync } from "../src/workspaces/site-planner/lib/elementSync.js";

/* ⛔ NEW-1 — DELETE-vs-CREATE. The row of the B673 matrix that was never written down, and the one
 * that cost the owner a truck court and a trailer row on plan `smsdrvzr9gzx`.
 *
 * THE MEASURED INCIDENT, reproduced below rather than paraphrased. Two tabs on one plan. Tab A
 * created a building assembly — host + 2 truck courts + 2 trailer rows. Tab B still held a delete
 * formed before those ids existed. Tab B's delete lost its rev guard, and `elementSync`'s
 * "delete WINS — re-issue at the fresh rev" branch stripped the stale rev and re-issued against
 * the NEW rows: at 13:38:49.543–546 three deletes were re-applied to rows 1.75 s old, and
 * `e1454940cgzlnc` (a 135 × 1198 truck court) and `e1454943cgzlnc` (its trailer row) died.
 *
 * "Delete wins" is right for delete-vs-EDIT: two people disagreeing about a row that exists, and
 * removal is the less recoverable intent, so it is the one that should not need re-doing. It is
 * wrong for delete-vs-CREATE, because there the delete is not a decision about the row that
 * exists — it is a decision about a row that no longer does.
 *
 * ONE TEST PER DIRECTION, as the item asks:
 *   • delete-then-create → the delete is DROPPED and the created row survives (this file);
 *   • create-then-delete → the delete still WINS, exactly as before (the regression half — a guard
 *     that also swallows legitimate deletes has traded one data-loss bug for another).
 */

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeHarness(overrides = {}) {
  const commits = [];
  const events = [];
  const adopted = [];
  const reports = [];
  const timers = [];
  let clock = 1000;
  let responder = overrides.responder || ((ops) => ({
    ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })),
  }));
  const sync = createElementSync({
    siteId: "smsdrvzr9gzx",
    commit: async (ops) => { commits.push(ops); return responder(ops); },
    now: () => clock,
    setTimer: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    onEvent: (e) => events.push(e),
    onRowsCanonical: (rows) => adopted.push(...rows),
    report: (name, msg, payload) => reports.push({ name, msg, payload }),
    selfUid: "tab-b",
    ...overrides.sync,
  });
  return {
    sync, commits, events, adopted, reports,
    setResponder: (r) => { responder = r; },
    advance: (ms) => { clock += ms; },
    now: () => clock,
    runTimers: () => { const due = timers.splice(0); due.forEach((t) => t.fn()); },
  };
}

// The real geometry off the owner's rows, so the fixture is the defect rather than a stand-in.
const court = { id: "e1454940cgzlnc", type: "paving", cx: 1594.19, cy: -1140.31, w: 135, h: 1198, rot: 270, attachedTo: "e1454939cgzlnc", truckCourt: { side: "right" } };
const trailer = { id: "e1454943cgzlnc", type: "trailer", cx: 1594.19, cy: -292.81, w: 1198, h: 50, rot: 0, attachedTo: "e1454939cgzlnc", forCourt: "e1454942cgzlnc", prevZone: "e1454942cgzlnc" };

// A realtime row as tab B receives it from the tab that created the element.
const rowFor = (el, rev, by = "tab-a") => ({ kind: "el", id: el.id, data: el, rev, z_index: 2048, updated_by: by, deleted_at: null });

describe("NEW-1 — a delete formed before the row existed is DROPPED, not re-issued", () => {
  it("THE MEASURED CASE: a row that arrived from another tab and never reached the canvas produces NO delete", async () => {
    /* The diff mints a delete for one reason — the shadow holds an element and the collections do
     * not — and both halves of that can be true without anyone deleting anything. `applyRemoteRow`
     * writes the shadow entry ITSELF, so if the upsert it returns is dropped on the way to the
     * canvas (a snapshot applied over it, a gesture buffering it, a remount), the next diff invents
     * a delete for an element this tab never held, and issues it against rows seconds old. */
    const h = makeHarness();
    h.sync.seed([]);
    h.advance(1750);
    expect(h.sync.applyRemoteRow(rowFor(court, 7)).action).toBe("upsert");
    h.sync.applyRemoteRow(rowFor(trailer, 9));

    h.sync.reconcile({ els: [] }, {});    // …the canvas never took them
    h.runTimers();
    await tick();

    expect(h.commits.flat().filter((o) => o.op === "delete")).toHaveLength(0);
    expect(h.reports.some((r) => r.name === "element-delete-fabricated")).toBe(true);
    // …and the canvas is handed what it is missing, rather than the server being told to drop it.
    expect(h.adopted.map((a) => a.id).sort()).toEqual([court.id, trailer.id].sort());
  });

  it("the SEND-side path — the one no conflict branch could ever have caught", async () => {
    /* `opFor` sends a delete at the shadow's CURRENT rev, not the rev it was formed against. So a
     * queued delete whose element is re-created in the meantime goes out expecting EXACTLY the row
     * that was just written, the server ACCEPTS it, and nothing anywhere reports a conflict. That
     * is why the question is asked before the op is built, as well as after a refusal. */
    const h = makeHarness({ sync: { backoff: [10, 10, 10, 10, 10] } });
    h.sync.seed([{ kind: "el", id: court.id, data: court, rev: 2, z_index: 2048 }]);
    h.sync.reconcile({ els: [court] }, {});                  // the canvas genuinely held it…
    h.setResponder(() => ({ ok: false, results: [], error: "network" }));
    h.sync.reconcile({ els: [] }, {});                       // …and the user deleted it. Transport fails.
    await tick();
    expect(h.commits[0][0]).toMatchObject({ op: "delete", id: court.id, expected: 2 });
    h.commits.length = 0;

    h.sync.seed([]);                                         // a reconnect refetch, taken before the create
    h.advance(1750);
    h.sync.applyRemoteRow(rowFor(court, 7));                 // …the other tab's brand-new row
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }));
    h.runTimers();                                           // the backoff retry fires
    await tick();

    expect(h.commits.flat().filter((o) => o.op === "delete")).toHaveLength(0);
    expect(h.reports.some((r) => r.name === "element-delete-vs-create-dropped")).toBe(true);
    expect(h.events.some((e) => e.type === "delete-vs-create-dropped")).toBe(true);
  });

  it("the CAS-LOSS path: the create lands while the delete is ON THE WIRE — the conflict is refused", async () => {
    const h = makeHarness({ sync: { backoff: [10, 10, 10, 10, 10] } });
    h.sync.seed([{ kind: "el", id: trailer.id, data: trailer, rev: 3, z_index: 5120 }]);
    h.sync.reconcile({ els: [trailer] }, {});
    h.setResponder(() => ({ ok: false, results: [], error: "network" }));
    h.sync.reconcile({ els: [] }, {});
    await tick();
    h.commits.length = 0;
    h.sync.seed([]);                                         // reconnect refetch, snapshot predates the create

    // The row is created between our op leaving and its result arriving — the measured race.
    h.setResponder((ops) => {
      h.advance(1750);
      h.sync.applyRemoteRow(rowFor(trailer, 9));
      return { ok: true, results: ops.map((o) => ({ id: o.id, status: "conflict", row: rowFor(trailer, 9) })) };
    });
    h.runTimers();
    await tick();
    h.runTimers();
    await tick();

    // Exactly ONE delete on the wire: the pre-fix build re-issued it here and the row died.
    expect(h.commits.flat().filter((o) => o.op === "delete")).toHaveLength(1);
    expect(h.events.some((e) => e.type === "delete-vs-create-dropped")).toBe(true);
    expect(h.events.some((e) => e.type === "delete-reapplied")).toBe(false);
    expect(h.adopted.map((a) => a.id)).toContain(trailer.id);
    expect(h.sync.shadowSnapshot().get("el:" + trailer.id).rev).toBe(9);   // the server's row is canonical
  });

  it("the refusal does not undo itself: the next diff must not re-mint the same delete", async () => {
    const h = makeHarness();
    h.sync.seed([]);
    h.sync.applyRemoteRow(rowFor(court, 7));
    h.sync.reconcile({ els: [] }, {});                       // refused + re-adopted
    h.runTimers(); await tick();
    h.commits.length = 0;
    h.advance(5000);
    h.sync.reconcile({ els: [] }, {});                       // the canvas still has not caught up
    h.runTimers(); await tick();
    expect(h.commits.flat().filter((o) => o.op === "delete")).toHaveLength(0);
  });

  it("an expired delete never rides out on the UNLOAD keepalive either (it has no result handler)", async () => {
    const h = makeHarness({ sync: { backoff: [10, 10, 10, 10, 10] } });
    h.sync.seed([{ kind: "el", id: court.id, data: court, rev: 2, z_index: 2048 }]);
    h.sync.reconcile({ els: [court] }, {});
    h.setResponder(() => ({ ok: false, results: [], error: "network" }));
    h.sync.reconcile({ els: [] }, {});
    await tick();
    expect(h.sync.pendingOps().filter((o) => o.op === "delete")).toHaveLength(1); // queued, still legitimate
    h.sync.seed([]);
    h.advance(1750);
    h.sync.applyRemoteRow(rowFor(court, 7));
    expect(h.sync.pendingOps().filter((o) => o.op === "delete")).toHaveLength(0); // …and now expired
  });
});

describe("NEW-1 — the other direction: an ordinary delete still WINS", () => {
  it("create-then-delete: a delete formed AFTER the row existed is re-issued at the fresh rev", async () => {
    const h = makeHarness();
    h.sync.seed([]);
    // Tab B watches the element be created…
    h.sync.applyRemoteRow(rowFor(court, 7));
    h.sync.reconcile({ els: [court] }, {});     // …the canvas ADOPTS it — the control the guard turns on
    h.advance(60_000);
    // …and only THEN does the user delete it. This decision is about the row that exists.
    let first = true;
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => {
      if (o.op === "delete" && first) { first = false; return { id: o.id, status: "conflict", row: rowFor(court, 8) }; }
      return { id: o.id, status: "ok", rev: (o.expected || 0) + 1 };
    }) }));
    h.sync.reconcile({ els: [] }, {});
    await tick();
    h.runTimers();
    await tick();

    const deletes = h.commits.flat().filter((o) => o.op === "delete");
    expect(deletes.length).toBeGreaterThan(1);                       // re-issued, per the B673 matrix
    expect(h.events.some((e) => e.type === "delete-reapplied")).toBe(true);
    expect(h.events.some((e) => e.type === "delete-vs-create-dropped")).toBe(false);
    expect(h.adopted).toHaveLength(0);                               // nothing came back onto the canvas
  });

  it("delete-vs-EDIT is untouched: an element with no observed birth behaves exactly as before", async () => {
    const h = makeHarness();
    h.sync.seed([{ kind: "el", id: court.id, data: court, rev: 4, z_index: 2048 }]);
    let first = true;
    h.setResponder((ops) => ({ ok: true, results: ops.map((o) => {
      if (o.op === "delete" && first) { first = false; return { id: o.id, status: "conflict", row: rowFor({ ...court, cy: -1200 }, 5) }; }
      return { id: o.id, status: "ok", rev: (o.expected || 0) + 1 };
    }) }));
    h.sync.reconcile({ els: [] }, {});
    await tick();
    h.runTimers();
    await tick();
    expect(h.commits.flat().filter((o) => o.op === "delete").length).toBeGreaterThan(1);
    expect(h.events.some((e) => e.type === "delete-reapplied")).toBe(true);
  });
});
