/* A per-key write queue (NEW-18 — the site-plan-overlay false-conflict bug). Used wherever a
 * rapid burst of async writes for the SAME key (e.g. one row's id) must never run concurrently —
 * so a later write's read of "the version I last saw" never races an earlier write for the same
 * key that hasn't settled yet. That race is exactly what made "someone else changed this site
 * plan" fire for a single user dragging one overlay: two finished-drag commits fired close
 * together, both read the same stale expected-version (because the state/ref they read from
 * lags a just-issued write by at least one React render), the first succeeded, and the second was
 * rejected by the server's real optimistic-concurrency check and reported as a foreign edit.
 *
 * Pure — no I/O of its own. `run(key, fn)` sequences every `fn` sharing a key onto one promise
 * chain, so the second call's `fn` body does not even START until the first's has fully settled.
 * A `fn` that throws/rejects never wedges the queue for that key — the next `run` call for the
 * same key still proceeds.
 */
export function createWriteSerializer() {
  const tails = new Map();
  return {
    run(key, fn) {
      const tail = tails.get(key) || Promise.resolve();
      const settled = tail.then(fn, fn);
      tails.set(key, settled.catch(() => {}));
      return settled;
    },
  };
}
