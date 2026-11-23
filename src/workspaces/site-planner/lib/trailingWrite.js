/* A trailing-edge debouncer whose FINAL value always lands (NEW-2).
 *
 * A colour drag or a slider fires an input event per frame; writing each one to the account would be a storm of
 * requests, but dropping any of them is worse — the last value of a gesture is the one the user meant. So:
 *   · `push(edit)` queues an edit (the UI has already applied it locally — optimistic);
 *   · the write runs `ms` after the LAST push, with every queued edit handed over together (`commit(edits)`);
 *   · `flush()` runs it NOW — called on unmount / page hide / scope switch, so a pending value is never lost;
 *   · while a write is in flight, new pushes wait and go in the next batch (writes never overlap, never reorder).
 * `commit` returns a promise; a rejected/failed one is surfaced through `onError(error, batch)` (so the caller can revert) and as `{ ok:false, error }` from flush().
 */
// The timers are called as bare functions: `timers.set(...)` would invoke window.setTimeout with `this === timers`,
// which a browser refuses ("Illegal invocation") — so the defaults are wrapped, never method references.
export function createTrailingWriter(commit, ms = 400, timers = { set: (f, m) => setTimeout(f, m), clear: (t) => clearTimeout(t) }, onError = null) {
  let queue = [];
  let timer = null;
  let running = Promise.resolve();
  const run = () => {
    timer = null;
    if (!queue.length) return running;
    const batch = queue; queue = [];
    // The chain itself never rejects (so later batches still run), but a failed commit is REPORTED to `onError`
    // — and flush() resolves to { ok:false, error } instead of a silent undefined that reads as success.
    const result = running.then(() => commit(batch)).then(() => ({ ok: true }), (error) => {
      if (onError) { try { onError(error, batch); } catch (_) { /* a bad handler never breaks the chain */ } }
      return { ok: false, error };
    });
    running = result;
    return result;
  };
  return {
    push(edit) { queue.push(edit); if (timer) timers.clear(timer); timer = timers.set(run, ms); },
    flush() { if (timer) { timers.clear(timer); timer = null; } return run(); },
    pending: () => queue.length > 0 || timer !== null,
  };
}
