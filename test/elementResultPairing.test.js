import { describe, it, expect } from "vitest";
import { createElementSync } from "../src/workspaces/site-planner/lib/elementSync.js";

/* ⛔ NEW-1 — ONE ID CAN NAME TWO ROWS, AND THE COMMIT RESULTS WERE KEYED BY ID ALONE.
 *
 * THE PROOF, from the owner's live data rather than a hypothetical. `site_elements`' primary key is
 * (site_id, kind, id) — deliberately, because legacy pre-salt ids are reused verbatim across
 * collections — and site `smqh3au6aeb4` (Katz / Plan 1) holds `e6327` TWICE, both LIVE: once as
 * kind `el` (a building, rev 2) and once as kind `markup` (rev 2). Both rows carry the identical
 * `updated_at` of 2026-06-29 15:36:02.112, i.e. they were written by ONE commit batch — which is
 * exactly the condition below.
 *
 * `elementSync` keyed a batch's per-op results by `r.id` alone in two places (the commit-result
 * pass and the atomic-rollback pass), under a comment asserting "ids are unique within a batch".
 * They are not. The second `set()` overwrote the first, and every lookup for that id then returned
 * the OTHER row's result: the wrong rev, the wrong status, silently. Every other lookup in that
 * file goes through `skey(kind, id)`; these two forgot the kind.
 *
 * ⚠ THE FIX IS *NOT* `skey(r.kind, r.id)` — THERE IS NO `r.kind` TO KEY ON. `commit_elements`
 * builds each result from `v_id` alone (`db/site_elements.sql`): `{id, status, rev}`, plus `row`
 * on a miss. Keying by a field the server never sends would miss on EVERY op and break the whole
 * write path. What the RPC does guarantee is ORDER — it appends exactly one result per element of
 * `p_ops` — and `flush()` builds `ops = batch.map(opFor)`, so `results[i]` belongs to `batch[i]`.
 * The pairing is positional, VERIFIED (id, and kind whenever a returned row names one) rather than
 * assumed, and falls back to a per-id FIFO that consumes each result once when a response does not
 * match that contract.
 */

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeHarness(overrides = {}) {
  const commits = [];
  const events = [];
  const reports = [];
  const timers = [];
  let clock = 1000;
  let responder = overrides.responder || ((ops) => ({
    ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })),
  }));
  const sync = createElementSync({
    siteId: "smqh3au6aeb4",
    commit: async (ops, opts) => { commits.push(ops); return responder(ops, opts); },
    now: () => clock,
    setTimer: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    onEvent: (e) => events.push(e),
    report: (name, msg, payload) => reports.push({ name, msg, payload }),
    selfUid: "tab-a",
    ...overrides.sync,
  });
  return {
    sync, commits, events, reports,
    setResponder: (r) => { responder = r; },
    runTimers: () => { const due = timers.splice(0); due.forEach((t) => t.fn()); },
    shadow: (kind, id) => sync.shadowSnapshot().get(kind + ":" + id),
  };
}

// The owner's real collision, verbatim: one id, two live rows, two kinds.
const ID = "e6327";
const buildingV1 = { id: ID, type: "building", cx: 100, cy: 200, w: 400, h: 250, z: 2048 };
const buildingV2 = { ...buildingV1, cx: 140 };                       // the edit this batch carries
const markupV1 = { id: ID, kind: "rect", x: 10, y: 20, w: 60, h: 30, z: 1024 };
const markupV2 = { ...markupV1, x: 55 };

const seedRows = () => [
  { kind: "el", id: ID, data: buildingV1, rev: 2, z_index: 2048, deleted_at: null },
  { kind: "markup", id: ID, data: markupV1, rev: 2, z_index: 1024, deleted_at: null },
];

// Drive one batch carrying BOTH rows and answer it with `results`.
async function commitBoth(h, results, extra = {}) {
  h.sync.seed(seedRows());
  h.setResponder(() => ({ ok: true, results, sentAtomic: true, ...extra }));
  h.sync.reconcile({ els: [buildingV2], markups: [markupV2] }, {});
  h.runTimers();
  await tick();
  return h.commits[0] || [];
}

describe("NEW-1 — a commit batch carrying one id under two kinds", () => {
  it("sends both ops, and each op is answered with ITS OWN result", async () => {
    const h = makeHarness();
    // Positional, as the RPC returns them: the element's op CONFLICTED, the markup's was accepted.
    const ops = await commitBoth(h, [
      { id: ID, status: "conflict", row: { kind: "el", id: ID, rev: 9, data: buildingV1, updated_by: "tab-b" } },
      { id: ID, status: "ok", rev: 3 },
    ]);

    // The batch really did carry both (the collision is representable on the wire, not just in the DB).
    expect(ops.map((o) => o.kind).sort()).toEqual(["el", "markup"]);

    // The markup was accepted: its shadow advances to the rev the SERVER gave IT.
    expect(h.shadow("markup", ID).rev).toBe(3);
    // The element was refused: it adopts the CONFLICT row's rev and re-commits, and it says so.
    expect(h.shadow("el", ID).rev).toBe(9);
    expect(h.events.some((e) => e.type === "edit-vs-edit-lost-race" && e.kind === "el")).toBe(true);
    // …and the accepted markup must NOT be reported as a conflict.
    expect(h.events.some((e) => e.type === "edit-vs-edit-lost-race" && e.kind === "markup")).toBe(false);
  });

  it("the mirror image — the markup conflicts and the element is accepted", async () => {
    const h = makeHarness();
    await commitBoth(h, [
      { id: ID, status: "ok", rev: 3 },
      { id: ID, status: "conflict", row: { kind: "markup", id: ID, rev: 11, data: markupV1, updated_by: "tab-b" } },
    ]);

    expect(h.shadow("el", ID).rev).toBe(3);
    expect(h.shadow("markup", ID).rev).toBe(11);
    expect(h.events.some((e) => e.type === "edit-vs-edit-lost-race" && e.kind === "markup")).toBe(true);
    expect(h.events.some((e) => e.type === "edit-vs-edit-lost-race" && e.kind === "el")).toBe(false);
  });

  it("a DELETED result on one kind must not tombstone the other", async () => {
    const h = makeHarness();
    await commitBoth(h, [
      { id: ID, status: "deleted", row: { kind: "el", id: ID, rev: 5 } },
      { id: ID, status: "ok", rev: 3 },
    ]);

    // The element hit a tombstone → its shadow is dropped and B673 is told.
    expect(h.shadow("el", ID)).toBeUndefined();
    expect(h.events.some((e) => e.type === "edit-vs-deleted" && e.kind === "el")).toBe(true);
    // The markup was accepted and is untouched by its neighbour's tombstone.
    expect(h.shadow("markup", ID)).toBeTruthy();
    expect(h.shadow("markup", ID).rev).toBe(3);
    expect(h.events.some((e) => e.type === "edit-vs-deleted" && e.kind === "markup")).toBe(false);
  });

  it("B1117 atomic rollback adopts each kind's OWN fresh rev", async () => {
    const h = makeHarness();
    // `applied:false` — the server rolled the whole call back; only the revs may be adopted.
    await commitBoth(h, [
      { id: ID, status: "conflict", row: { kind: "el", id: ID, rev: 9 } },
      { id: ID, status: "conflict", row: { kind: "markup", id: ID, rev: 4 } },
    ], { applied: false });

    expect(h.shadow("el", ID).rev).toBe(9);
    expect(h.shadow("markup", ID).rev).toBe(4);
    // Nothing landed, so both keep OUR json as the diff baseline, flagged stale.
    expect(h.shadow("el", ID).stale).toBe(true);
    expect(h.shadow("markup", ID).stale).toBe(true);
  });

  it("the pairing is VERIFIED, not assumed: a response out of op order follows the kind it names", async () => {
    const h = makeHarness();
    await commitBoth(h, [
      { id: ID, status: "conflict", row: { kind: "markup", id: ID, rev: 9 } },
      { id: ID, status: "conflict", row: { kind: "el", id: ID, rev: 4 } },
    ]);

    expect(h.shadow("el", ID).rev).toBe(4);
    expect(h.shadow("markup", ID).rev).toBe(9);
    expect(h.reports.some((r) => r.name === "element-results-unaligned")).toBe(true);
  });
});

describe("NEW-1 — the control: ordinary batches are untouched", () => {
  it("two DIFFERENT ids still get their own results", async () => {
    const h = makeHarness();
    const a = { id: "e100", type: "building", cx: 0, cy: 0, w: 10, h: 10, z: 1024 };
    const b = { id: "e200", type: "building", cx: 5, cy: 5, w: 10, h: 10, z: 2048 };
    h.sync.seed([
      { kind: "el", id: "e100", data: a, rev: 2, z_index: 1024, deleted_at: null },
      { kind: "el", id: "e200", data: b, rev: 2, z_index: 2048, deleted_at: null },
    ]);
    h.setResponder(() => ({
      ok: true,
      results: [
        { id: "e100", status: "ok", rev: 3 },
        { id: "e200", status: "conflict", row: { kind: "el", id: "e200", rev: 8, data: b, updated_by: "tab-b" } },
      ],
    }));
    h.sync.reconcile({ els: [{ ...a, cx: 40 }, { ...b, cx: 45 }] }, {});
    h.runTimers();
    await tick();

    expect(h.shadow("el", "e100").rev).toBe(3);
    expect(h.shadow("el", "e200").rev).toBe(8);
    // A well-formed one-per-op response never takes the degraded path.
    expect(h.reports.some((r) => r.name === "element-results-unaligned")).toBe(false);
  });

  it("an op with no result at all is still requeued, not silently settled", async () => {
    const h = makeHarness();
    const a = { id: "e100", type: "building", cx: 0, cy: 0, w: 10, h: 10, z: 1024 };
    h.sync.seed([{ kind: "el", id: "e100", data: a, rev: 2, z_index: 1024, deleted_at: null }]);
    h.setResponder(() => ({ ok: true, results: [] }));
    h.sync.reconcile({ els: [{ ...a, cx: 40 }] }, {});
    h.runTimers();
    await tick();

    expect(h.reports.some((r) => r.name === "element-no-result")).toBe(true);
    expect(h.sync.pendingCount()).toBe(1);
  });
});
