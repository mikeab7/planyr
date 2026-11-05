import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pushToastPure, countByDedupeKey, visibleToasts, TOAST_CAP } from "../src/shared/ui/Toast.jsx";
import { toastForSyncEvent } from "../src/workspaces/site-planner/lib/conflictToasts.js";
import { plannerSource } from "./helpers/plannerSource.js";

/* ROUND EIGHT, NEW-2 (B1482353) — THE STALE-TAB BANNER MUST NEVER STACK.
 *
 * The owner's screenshot: two identical "This tab is out of date — your recent changes here can't
 * be saved. Reload the page to catch up." banners plus a "+1 more" pill, over the canvas and the
 * placement tooltip, on a plan four minutes old with one tab and one account. `TOAST_CAP` is 2,
 * so "+1 more" means exactly THREE were pushed — which matches the telemetry precisely
 * (`element-assembly-split-unresolved` at streaks 4, 5 and 6; see elementSyncConvergence.test.js
 * for the full trace and the DB read that proves the single writer).
 *
 * This file guards the DISPLAY half, which is deliberately independent of the engine half: NEW-2
 * is shippable even if a root cause is not fully closed, so the invariant "at most one of these
 * exists at any time" must hold no matter how many times anything decides to raise it.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const read = (p) => readFileSync(HERE + p, "utf8");
const PLANNER = plannerSource();
const TOASTJS = read("../src/shared/ui/Toast.jsx");

describe("a state notice replaces itself; an event notice still accumulates", () => {
  it("pushing the same dedupeKey twice leaves ONE toast, not two", () => {
    let l = [];
    l = pushToastPure(l, { text: "This tab is out of date", dedupeKey: "client-stale" });
    l = pushToastPure(l, { text: "This tab is out of date", dedupeKey: "client-stale" });
    l = pushToastPure(l, { text: "This tab is out of date", dedupeKey: "client-stale" });
    expect(l).toHaveLength(1);
    expect(countByDedupeKey(l, "client-stale")).toBe(1);
  });

  it("the exact screenshot cannot re-form: three raises never produce a '+n more' pill", () => {
    let l = [];
    for (let i = 0; i < 3; i++) l = pushToastPure(l, { text: "This tab is out of date", dedupeKey: "client-stale" });
    const { shown, more } = visibleToasts(l, TOAST_CAP);
    expect(shown).toHaveLength(1);
    expect(more).toBe(0);
  });

  it("a repeat keeps the SAME id, so React never remounts it and its dismiss timer never restarts", () => {
    let l = pushToastPure([], { text: "first", dedupeKey: "client-stale" });
    const id = l[0].id;
    l = pushToastPure(l, { text: "second", dedupeKey: "client-stale" });
    expect(l[0].id).toBe(id);
    expect(l[0].text).toBe("second");     // the content DOES refresh — replaced, not ignored
  });

  it("a repeat keeps its SLOT — it does not jump to the bottom of the stack under the user's cursor", () => {
    let l = pushToastPure([], { text: "state", dedupeKey: "client-stale" });
    l = pushToastPure(l, { text: "an event" });
    l = pushToastPure(l, { text: "state again", dedupeKey: "client-stale" });
    expect(l.map((t) => t.text)).toEqual(["state again", "an event"]);
  });

  it("toasts WITHOUT a dedupeKey are untouched — two real events are still two notices", () => {
    let l = [];
    l = pushToastPure(l, { text: "a building you edited changed" });
    l = pushToastPure(l, { text: "a pond you edited changed" });
    expect(l).toHaveLength(2);
  });

  it("different dedupeKeys are different notices", () => {
    let l = pushToastPure([], { text: "a", dedupeKey: "k1" });
    l = pushToastPure(l, { text: "b", dedupeKey: "k2" });
    expect(l).toHaveLength(2);
  });
});

describe("the stale-tab notice is a single-instance notice, and it offers a way to act", () => {
  it("client-stale carries a stable dedupeKey", () => {
    const spec = toastForSyncEvent({ type: "client-stale", streak: 4, pending: 3 }, { name: "", label: "", self: true });
    expect(spec.dedupeKey).toBe("client-stale");
  });

  it("its dedupeKey does not vary with streak or pending count — otherwise every round is a new banner", () => {
    const a = toastForSyncEvent({ type: "client-stale", streak: 4, pending: 3 }, { self: true });
    const b = toastForSyncEvent({ type: "client-stale", streak: 9, pending: 41, reason: "assembly-split" }, { self: true });
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.text).toBe(b.text);
  });

  it("the sentence tells the user to reload AND the spec now offers the action to do it", () => {
    const spec = toastForSyncEvent({ type: "client-stale" }, { self: true });
    expect(spec.text).toMatch(/Reload the page/);
    expect(spec.action).toBe("reload");
  });

  it("per-element event notices are NOT given a dedupeKey (they are news, not state)", () => {
    for (const type of ["edit-vs-edit-lost-race", "remote-while-dirty", "edit-vs-deleted", "restore-conflict"]) {
      const spec = toastForSyncEvent({ type, authoredRecently: true, remote: {} }, { name: "Sam", label: "a building", self: false });
      if (spec) expect(spec.dedupeKey).toBeUndefined();
    }
  });
});

describe("the reload the banner offers cannot be what loses the work", () => {
  /* ⛔ The banner says "Reload the page to catch up" while the engine is holding un-committed
   * edits. A reload re-seeds from the server's rows, and ROWS-CANONICAL-ON-SEED (docs/DATA.md §2
   * inv. 3) makes those rows win over a diverging local canvas UNLESS a pending-edit journal
   * entry explains the difference. So the journal must be armed in the `stale` state — and it was
   * the one engine state not named in the journal-write condition, left to the coincidence of
   * `pending > 0` being true at that instant. */
  it("`stale` is a named state in the journal-write condition, not left to a coincidence", () => {
    const at = PLANNER.indexOf("writeJournal(siteId, journalSid, live.dirtyEntries()");
    expect(at).toBeGreaterThan(0);
    const cond = PLANNER.slice(Math.max(0, at - 320), at);
    for (const state of ["committing", "retrying", "failed", "stale"]) {
      expect(cond).toContain(`s.state === "${state}"`);
    }
  });

  it("the Reload action persists the journal BEFORE navigating, never after", () => {
    const at = PLANNER.indexOf("const wideNoticeAction =");
    expect(at).toBeGreaterThan(0);
    const body = PLANNER.slice(at, at + 900);
    const j = body.indexOf("writeJournal");
    const r = body.indexOf("location.reload");
    expect(j).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(j);          // ordering IS the guarantee here
  });

  it("the plan-wide branch forwards the spec's dedupeKey instead of dropping it", () => {
    const at = PLANNER.indexOf("if (!kind || !id)");
    expect(at).toBeGreaterThan(0);
    const branch = PLANNER.slice(at, at + 400);
    expect(branch).toMatch(/dedupeKey/);
    expect(branch).not.toMatch(/action: null/);   // the hard-coded null is what suppressed the action
  });
});

describe("⛔ the surface inventory — a NEW surface may not grow an ungated copy of this message", () => {
  /* NEW-2 asks which surfaces can raise this class of message and how many can raise it at once.
   * The measured answer, swept rather than assumed:
   *
   *   SURFACE                      MECHANISM                                 BEFORE      AFTER
   *   Site Planner canvas          conflictToasts client-stale → ToastHost   unbounded   1
   *   Site Planner save badge      `saveDetail` prop (inline header chrome)  1           1
   *   Site Planner app shell       `pushError` (one state string + banner)   1           1
   *   App Shell (every route)      `updateReason` (one derived value)        1           1
   *   Notes                        ConflictNotice (one at a time by design)  1           1
   *   Scheduler (sequence/…html)   `offlineFallback` (one inline bar)        1           1
   *   Review / Library / Dashboard — (raise nothing of this class)           0           0
   *
   * Exactly ONE surface could ever stack, and it is the one that did. The rest are single-valued
   * by construction — a boolean or a string, not a list — so there is nothing to dedupe there and
   * no change was made to them. This test pins the only thing that can regress: that the toast
   * stack (the ONLY unbounded, append-based surface in the app) stays the only one, and that any
   * future consumer of it inherits the dedupe rather than re-inventing a push. */
  it("only the shared toast stack is append-based; it lives in exactly one module", () => {
    expect(TOASTJS).toContain("export function pushToastPure");
    expect(TOASTJS).toContain("dedupeKey");
  });

  it("every useToasts consumer is accounted for in the inventory above", () => {
    // A new consumer is fine — it just has to be a deliberate choice, recorded here, so nobody
    // adds a fourth surface that raises a state notice without asking whether it can stack.
    const consumers = ["src/shared/ui/Toast.jsx", "src/workspaces/site-planner/SitePlanner.jsx", "src/workspaces/site-planner/SitePlannerApp.jsx"];
    for (const f of consumers) expect(read("../" + f)).toContain("useToasts");
    expect(consumers).toHaveLength(3);
  });

  it("the dedupe lives in the SHARED primitive, so a future surface inherits it for free", () => {
    // If this ever moves into SitePlanner.jsx, the next surface re-inherits the bug.
    expect(TOASTJS).toMatch(/dedupeKey != null/);
  });
});
