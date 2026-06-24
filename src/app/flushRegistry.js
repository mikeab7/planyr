/* Cross-workspace "flush before we navigate away" registry (B452).
 *
 * A FORCED reload — the chunk-recovery reloadFresh() and the ErrorBoundary "Reload"
 * button — navigates with location.replace. That does fire beforeunload/visibilitychange,
 * so a workspace's SYNCHRONOUS local save still runs; what it can drop is the best-effort
 * CLOUD push, which is debounced/async and gets abandoned mid-flight by the navigation.
 * The worst real-world case: a user adds work, a background deploy swaps a chunk, a click
 * dead-ends, the app force-reloads, and the last edits lived only in memory + the local
 * mirror — not the cloud. Boot reconciliation (mergePulledSites) re-pushes a fuller-than-
 * cloud local copy on the NEXT load, so nothing is truly lost; this registry just closes
 * the window by giving every live workspace one last synchronous chance to flush — a local
 * save (guaranteed) plus a keepalive cloud push that outlives the navigation.
 *
 * Each registered flusher MUST be synchronous and MUST NOT throw; errors are swallowed so
 * one bad flusher can't block the others or the reload itself.
 */
const flushers = new Set();

// Register a flusher; returns an unregister fn (call on unmount). A non-function is ignored.
export function registerFlush(fn) {
  if (typeof fn !== "function") return () => {};
  flushers.add(fn);
  return () => { flushers.delete(fn); };
}

// Run every registered flusher once, best-effort. Called right before a forced reload.
export function flushAll() {
  for (const fn of flushers) {
    try { fn(); } catch { /* never let one workspace's flush block the others or the reload */ }
  }
}

export const _flushers = flushers; // test seam
