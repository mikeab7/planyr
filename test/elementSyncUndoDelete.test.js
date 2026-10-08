import { describe, it, expect } from "vitest";
import { createElementSync } from "../src/workspaces/site-planner/lib/elementSync.js";

// AUTH-SWEEP 2 / V182 step 1 — Delete then Ctrl+Z before the delete reaches the cloud must leave the
// element ALIVE on the server (it used to show restored + "Synced" and vanish on reload).
const tick = () => new Promise((r) => setTimeout(r, 0));
const E = { id: "e1", type: "building", cx: 0, cy: 0, w: 10, h: 10, z: 0 };

function make(commitImpl) {
  const commits = [];
  let clock = 1000;
  const s = createElementSync({
    siteId: "s", selfUid: "me", now: () => clock, setTimer: () => 1, clearTimer: () => {}, onEvent: () => {},
    commit: async (ops) => { commits.push(ops); return commitImpl ? commitImpl(ops) : { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
  });
  s.seed([{ kind: "el", id: "e1", data: E, rev: 5, z_index: 0 }]);
  return { s, commits, adv: (ms) => { clock += ms; } };
}
const flat = (c) => c.flat().map((o) => `${o.op}:${o.id}`);

describe("undo of a delete (V182)", () => {
  it("undo while the delete is still QUEUED behind another commit cancels it — nothing deletes the element", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const E2 = { id: "e2", type: "building", cx: 5, cy: 5, w: 10, h: 10, z: 1 };
    const { s, commits } = make(async (ops) => { if (ops.some((o) => o.id === "e2")) await gate; return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; });
    s.reconcile({ els: [E, E2] }, {}); s.flushGesture(); await tick(); // e2 create held on the wire
    s.reconcile({ els: [E2] }, {}); s.flushGesture(); await tick();   // Delete e1 — queued behind it
    s.allowResurrect([{ kind: "el", id: "e1" }]);
    s.reconcile({ els: [E, E2] }, {}); s.flushGesture(); await tick(); // Ctrl+Z
    release(); await tick(); await tick(); await tick();
    expect(flat(commits)).not.toContain("delete:e1");
  });

  it("undo while the delete is IN FLIGHT ends with the element alive on the server", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const { s, commits } = make(async (ops) => { if (ops[0].op === "delete") await gate; return { ok: true, results: ops.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; });
    s.reconcile({ els: [] }, {}); s.flushGesture(); await tick();   // delete on the wire
    s.allowResurrect([{ kind: "el", id: "e1" }]);
    s.reconcile({ els: [E] }, {}); s.flushGesture(); await tick();  // undo while in flight
    release(); await tick(); await tick(); s.flushGesture(); await tick(); await tick();
    const ops = flat(commits);
    const lastForE1 = ops.filter((o) => o.endsWith(":e1")).pop();
    expect(lastForE1).not.toBe("delete:e1");   // a restore/create/update must follow the delete
  });
});
