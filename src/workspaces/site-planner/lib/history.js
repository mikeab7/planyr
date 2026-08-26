/* Pure undo/redo snapshot stack for the Site Planner canvas. Geometry-agnostic:
 * the caller pushes immutable state snapshots (the whole drawn-layer state) and
 * supplies a stable string `keyOf(snapshot)` used to (a) skip no-op frames — a
 * push that didn't actually change anything (B32) — and (b) compare a candidate
 * against the LIVE current state on undo.
 *
 * Extracted from SitePlanner.jsx (was inline pastRef/futureRef + pushHistory/
 * undo/redo) so the stack + dedup logic is unit-testable in isolation, and so the
 * live current state is passed in EXPLICITLY at the moment of each command rather
 * than read from a ref that lagged a render behind — the cause of undo behaving
 * unreliably right after a drag-move (B315: snapshot/baseline taken stale).
 *
 * A "transaction" is one push (before a mutation) → many live changes → one undo
 * frame. A drag-move pushes ONCE at drag-start, mutates freely during the drag,
 * and is reverted in a single undo. Callers must push exactly once per undoable
 * action; this module does not infer transaction boundaries. */

/* Do two snapshots hold the SAME collections, by reference? A React state update replaces the array
 * it changes, so identical references across every key is proof no collection was committed — the
 * cheap half of `canUndo` below. */
const sameRefs = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
};

export function createHistoryStack({ keyOf, limit = 80 } = {}) {
  if (typeof keyOf !== "function") throw new Error("createHistoryStack: keyOf must be a function");
  let past = [];
  let future = [];

  return {
    /* Record the pre-mutation snapshot. `current` is the live state about to change.
     * Pushing opens a new branch, so any pending redo future is discarded. */
    push(current) {
      past.push(current);
      if (past.length > limit) past.shift();
      future = [];
    },

    /* Revert to the most recent snapshot whose key differs from the live `current`,
     * discarding any no-op frames on top of it (B32). Returns the snapshot to apply,
     * or null when there is nothing meaningful to undo. The live `current` is pushed
     * onto the redo future so redo can return to it. */
    undo(current) {
      let prev = null;
      /* NEW-4(d) — hoist `keyOf(current)` OUT of the loop. `keyOf` is the planner's `histKey`: a
       * JSON.stringify of every parcel, element, measurement, callout and markup in the plan. It was
       * recomputed on EVERY iteration against the same unchanging `current`, so an undo that skipped
       * ten deduped no-op frames stringified the whole model eleven times instead of once — on a
       * path the owner hits constantly. Behaviour-identical: `current` cannot change inside the loop. */
      const curKey = keyOf(current);
      while (past.length) {
        const cand = past.pop();
        if (keyOf(cand) !== curKey) { prev = cand; break; }
      }
      if (!prev) return null;
      future.push(current);
      return prev;
    },

    /* Re-apply the next future snapshot, parking the live `current` back on the past
     * stack. Returns the snapshot to apply, or null when there is nothing to redo. */
    redo(current) {
      if (!future.length) return null;
      const next = future.pop();
      past.push(current);
      return next;
    },

    /* Discard the most recent pushed snapshot WITHOUT applying it and return it
     * (null if none). Used to cancel an interrupted drag: the frame pushed at
     * drag-start is dropped so an aborted move leaves no half-recorded command on
     * the stack (the caller separately restores the geometry to that snapshot). */
    drop() {
      return past.length ? past.pop() : null;
    },

    /* ⛔ NEW-2 (B648353) — MULTI-STEP UNDO/REDO FOR THE HISTORY DROPDOWN, and why it is NOT just
     * `undo()` called in a loop from the caller. `undo(current)` dedupes against a `current` the
     * CALLER supplies; calling it N times synchronously from a component would call it N times
     * with the SAME stale `current` (React doesn't re-render — and so doesn't refresh the ref this
     * planner reads `current` from — inside one synchronous handler), corrupting the redo chain
     * (each call would push the same pre-undo `current` onto `future` again instead of the true
     * intermediate state). `undoN`/`redoN` do the walk INTERNALLY, threading the correct evolving
     * pivot at each step, and return only the FINAL target — so the caller applies ONE snapshot for
     * the whole run (one gesture, one `applySnapshot`, one flush — matching how a paste or a
     * multi-object delete already push exactly one frame for the whole action). */
    undoN(current, n) {
      let cur = current, last = null;
      for (let i = 0; i < n && past.length; i++) {
        const curKey = keyOf(cur);
        let prev = null;
        while (past.length) {
          const cand = past.pop();
          if (keyOf(cand) !== curKey) { prev = cand; break; }
        }
        if (!prev) break;
        future.push(cur);
        cur = prev;
        last = prev;
      }
      return last;
    },
    redoN(current, n) {
      let cur = current, last = null;
      for (let i = 0; i < n && future.length; i++) {
        const next = future.pop();
        past.push(cur);
        cur = next;
        last = next;
      }
      return last;
    },

    /* Non-destructive PEEK, newest first, describing up to `limit` undoable/redoable steps for the
     * history dropdown — same no-op dedup as `undo()` (a caller must see exactly what a click would
     * consume, never more). Each entry is `{ before, after }`: `after` is what the step reverts you
     * AWAY from, `before` is what it reverts you TO. Never mutates `past`/`future`. */
    recentUndoSteps(current, limit = 20) {
      const steps = [];
      let after = current;
      let idx = past.length - 1;
      while (idx >= 0 && steps.length < limit) {
        const afterKey = keyOf(after);
        let before = null;
        while (idx >= 0) {
          const cand = past[idx--];
          if (keyOf(cand) !== afterKey) { before = cand; break; }
        }
        if (!before) break;
        steps.push({ before, after });
        after = before;
      }
      return steps;
    },
    recentRedoSteps(current, limit = 20) {
      const steps = [];
      let before = current;
      for (let i = future.length - 1; i >= 0 && steps.length < limit; i--) {
        const after = future[i];
        steps.push({ before, after });
        before = after;
      }
      return steps;
    },

    /* ⛔ NEW-5 — "UNDO IS ENABLED" IS THE ONLY SIGNAL A USER HAS THAT A PLAN WAS MODIFIED, AND A
     * PLAIN SELECTION CLICK WAS ARMING IT.
     *
     * Reported live on production 2026-08-12, isolated: load `smsqi16s9ej4` fresh (Undo correctly
     * disabled), single left-click inside Building 3 — no drag, no modifier, the pointer does not
     * move — and Undo turns ENABLED. The database is byte-identical across it: md5 over all 50
     * `site_elements` rows `e6c520d7dba3b5fa7520aae3012545a9` before AND after, and `updated_at`
     * does not advance. Six selection clicks produced six entries on the owner's live plan, and
     * unwinding them was the only way to be sure the plan was untouched. That cost is the item.
     *
     * ⛔ THE FIX IS HERE, NOT AT THE 210 `pushHistory()` CALL SITES. A press handler pushes the
     * pre-mutation snapshot BEFORE it knows whether a mutation follows — that is the transaction
     * model this module is built on (push at drag-start, mutate freely, one frame), and unpicking
     * it per call site would be 210 chances to get the drag threshold wrong, which is expressly not
     * being reopened. So the predicate stops asking "is there a frame?" and starts asking the
     * question the button actually claims to answer: **does any frame differ from the live state?**
     * `undo()` has always asked exactly that (its `keyOf` dedup, B32); the button simply never did.
     *
     * ⚠ IT IS A REFERENCE SCAN, NOT A STRINGIFY, and that matters: `keyOf` is a JSON.stringify of
     * every parcel, element, measurement, callout and markup in the plan, and this predicate is read
     * on every render of the toolbar. React state updates REPLACE the collection arrays on every
     * real mutation, so an identical set of references is proof nothing was committed — which is the
     * reported case exactly. It errs only in the safe direction: a value-equal frame that was
     * reallocated still reads "enabled", and `undo()`'s own key dedup then discards it. Pass
     * `{ exact: true }` to pay for certainty. */
    canUndo(current, { exact = false } = {}) {
      if (!past.length) return false;
      if (current === undefined) return true;            // legacy callers: unchanged behaviour
      let refDiff = false;
      for (let i = past.length - 1; i >= 0; i--) {
        if (!sameRefs(past[i], current)) { refDiff = true; break; }
      }
      if (!refDiff) return false;
      if (!exact) return true;
      const curKey = keyOf(current);
      return past.some((p) => keyOf(p) !== curKey);
    },
    canRedo() { return future.length > 0; },

    reset() { past = []; future = []; },

    /* Introspection for tests / debugging — returns shallow copies, never the live arrays. */
    snapshotStacks() { return { past: [...past], future: [...future] }; },
  };
}
