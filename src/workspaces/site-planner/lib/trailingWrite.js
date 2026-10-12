/* A trailing-edge debouncer whose FINAL value always lands (NEW-2).
 *
 * A colour drag or a slider fires an input event per frame; writing each one to the account would be a storm of
 * requests, but dropping any of them is worse — the last value of a gesture is the one the user meant. So:
 *   · `push(edit)` queues an edit (the UI has already applied it locally — optimistic);
 *   · the write runs `ms` after the LAST push, with every queued edit handed over together (`commit(edits)`);
 *   · `flush()` runs it NOW — called on unmount / page hide / scope switch, so a pending value is never lost;
 *   · while a write is in flight, new pushes wait and go in the next batch (writes never overlap, never reorder).
 * `commit` returns a promise; a rejected/failed one is the caller's to surface (it receives the batch, so it can revert).
 */
// The timers are called as bare functions: `timers.set(...)` would invoke window.setTimeout with `this === timers`,
// which a browser refuses ("Illegal invocation") — so the defaults are wrapped, never method references.
export function createTrailingWriter(commit, ms = 400, timers = { set: (f, m) => setTimeout(f, m), clear: (t) => clearTimeout(t) }) {
  let queue = [];
  let timer = null;
  let running = Promise.resolve();
  const run = () => {
    timer = null;
    if (!queue.length) return running;
    const batch = queue; queue = [];
    running = running.then(() => commit(batch)).catch(() => {});
    return running;
  };
  return {
    push(edit) { queue.push(edit); if (timer) timers.clear(timer); timer = timers.set(run, ms); },
    flush() { if (timer) { timers.clear(timer); timer = null; } return run(); },
    pending: () => queue.length > 0 || timer !== null,
  };
}
