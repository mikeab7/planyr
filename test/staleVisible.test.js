import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElementSync } from "../src/workspaces/site-planner/lib/elementSync.js";
import { toastForSyncEvent } from "../src/workspaces/site-planner/lib/conflictToasts.js";

/* NEW-1 — IS A REFUSAL ACTUALLY VISIBLE? The question that found this was not "does the mapping
 * produce a warning" (it always did, and it was unit-tested) but "does the warning reach the
 * SCREEN". Two separate things were swallowing it, and neither was in the sync engine:
 *
 *   1. `SitePlanner.jsx`'s sync-event handler opened with `if (!kind || !id) return;` — correct for
 *      every row of the B673 matrix, all of which are about one element, and fatal for the ONE
 *      event that is about the whole plan. `client-stale` carries no kind and no id, so the toast
 *      was built and dropped before `pushToast`.
 *   2. The save badge's switch named `failed`, `syncing` and `retrying`, and not `stale` — so a tab
 *      that had STOPPED committing landed on the resting case and painted a green "synced".
 *
 * Together: the engine gives up, and the screen says everything is saved. That is the exact shape
 * the owner named — a safety check whose warning never reaches the screen — and it was live on the
 * already-shipped rejected-op streak, not only on group CAS.
 *
 * ⛔ WHAT THIS FILE PROVES AND WHAT IT DOES NOT. The engine half is BEHAVIOURAL: the real engine is
 * driven to the stale state and the real event is caught. The rendering half is a SOURCE check,
 * because the badge and the toast host live inside a component this repo cannot mount headlessly
 * signed-out, and the sandbox proxy refuses CONNECT to Supabase so no browser here can reach the
 * signed-in path at all. A source check is weaker than a click-through and is not a substitute for
 * one — the signed-in pass is logged in `VERIFICATION.md`, and this exists so the two lines cannot
 * be deleted or reordered back into silence in the meantime.
 */
const SRC = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

/** Drive the real engine until it gives up, and return every event it emitted. */
function driveToStale() {
  const events = [];
  const timers = [];
  let clock = 1000;
  const els = [{ id: "h", type: "building", cx: 0, cy: 0, w: 100, h: 100 }];
  const sync = createElementSync({
    siteId: "s1",
    // Every op refused on its rev guard, over and over — the NEW-3 hot-loop the stale state exists
    // to stop. Nothing here is group CAS: this path shipped long before stage 2.
    commit: async (ops) => ({ ok: true, results: ops.map((o) => ({ id: o.id, status: "conflict", row: { id: o.id, kind: "el", rev: (o.expected || 0) + 5, data: { id: o.id, type: "building", cx: 9 }, z_index: 0 } })) }),
    now: () => clock,
    setTimer: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    onEvent: (e) => events.push(e),
    report: () => {},
    liveCollections: () => ({ els }),
    backoff: [1, 1, 1, 1, 1],
  });
  sync.seed(els.map((e, i) => ({ kind: "el", id: e.id, data: e, rev: 1, z_index: i })));
  return { sync, events, els, timers, bump: (n) => { els[0] = { ...els[0], cx: els[0].cx + n }; } };
}

describe("a tab that has stopped saving says so", () => {
  it("the engine really reaches `stale`, and the event it emits carries NO element", async () => {
    const h = driveToStale();
    for (let i = 0; i < 12 && h.sync.state !== "stale"; i += 1) {
      h.bump(1);
      h.sync.reconcile({ els: h.els }, {});
      h.sync.flushGesture();
      await new Promise((r) => setTimeout(r, 0));
      h.timers.splice(0).forEach((t) => t.fn());
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(h.sync.state).toBe("stale");
    const stale = h.events.filter((e) => e.type === "client-stale");
    expect(stale.length).toBeGreaterThan(0);
    // ⛔ THE PROPERTY THE HANDLER TRIPPED OVER, asserted against the engine rather than assumed.
    expect(stale[0].kind).toBeUndefined();
    expect(stale[0].id).toBeUndefined();
    expect(stale[0].pending).toBeGreaterThan(0);
  });

  it("the matrix turns that event into a warning without needing an element label", () => {
    const spec = toastForSyncEvent({ type: "client-stale", streak: 4, pending: 3 }, { name: "", label: "", self: true });
    expect(spec).not.toBeNull();
    expect(spec.text).toMatch(/can't be saved/);
    expect(spec.text).toMatch(/Reload/);
  });

  it("⛔ the handler does not drop an element-less event on the floor", () => {
    // The guard may exist — it must not be the whole story. Require that the element-less branch
    // pushes a toast before returning.
    const at = SRC.indexOf("syncEventRef.current = (ev) => {");
    expect(at).toBeGreaterThan(0);
    const head = SRC.slice(at, at + 2600);
    const guard = head.indexOf("if (!kind || !id)");
    expect(guard).toBeGreaterThan(0);
    const branch = head.slice(guard, guard + 400);
    expect(branch).toMatch(/toastForSyncEvent/);
    expect(branch).toMatch(/pushToast/);
  });

  it("⛔ the save badge treats `stale` as an error, not as a resting green state", () => {
    // `stale` is strictly worse than `failed` — the engine has given up rather than kept retrying —
    // so it must be named, and named no later than `failed`.
    const stale = SRC.indexOf('elemSync.state === "stale"');
    const failed = SRC.indexOf('elemSync.state === "failed"');
    expect(stale).toBeGreaterThan(0);
    expect(stale).toBeLessThan(failed);
    expect(SRC.slice(stale, stale + 120)).toMatch(/return "error"/);
    // …and the badge's detail line says what to do about it.
    expect(SRC).toMatch(/This tab is out of date — reload to keep saving/);
  });
});
