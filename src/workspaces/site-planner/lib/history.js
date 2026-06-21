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
 * unreliably right after a drag-move (B310: snapshot/baseline taken stale).
 *
 * A "transaction" is one push (before a mutation) → many live changes → one undo
 * frame. A drag-move pushes ONCE at drag-start, mutates freely during the drag,
 * and is reverted in a single undo. Callers must push exactly once per undoable
 * action; this module does not infer transaction boundaries. */

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
      while (past.length) {
        const cand = past.pop();
        if (keyOf(cand) !== keyOf(current)) { prev = cand; break; }
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

    /* Button-enable predicate. Matches the historical behaviour: enabled whenever the
     * past stack is non-empty (a no-op-only stack can still show enabled, then undo()
     * cleans it — unchanged from B32). */
    canUndo() { return past.length > 0; },
    canRedo() { return future.length > 0; },

    reset() { past = []; future = []; },

    /* Introspection for tests / debugging — returns shallow copies, never the live arrays. */
    snapshotStacks() { return { past: [...past], future: [...future] }; },
  };
}
