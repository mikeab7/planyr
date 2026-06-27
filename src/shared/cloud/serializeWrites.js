/* Per-key write serializer (B528/B529) — make cloud writes for the SAME key run one at a time.
 *
 * The optimistic-concurrency guard (optimisticUpsert.js) sends the `version` the client last
 * synced and REJECTS a write whose version is stale. That's exactly right for a GENUINE
 * cross-device/cross-tab edit. But a single tab can race ITSELF: the debounced autosave and a
 * visibility / unmount / manual-save flush can both read the same tracked `version` and fire
 * concurrently. Whichever request lands second still carries the now-stale version, so the CAS
 * matches 0 rows and it's wrongly reported as a "conflict" — which then trips the autosave
 * lockout (`canCloudSave` returns false once status === "conflict"), and the user sees a scary
 * "saved elsewhere" with autosave silently stopped until reload. No data is lost (last write
 * wins on the row), but the state is alarming and sticky. (B528 = Doc Review, B529 = Site Planner.)
 *
 * The fix is NOT to weaken the guard — it's to stop a tab racing itself. A second write for a key
 * WAITS for the in-flight one, then runs with the version that write threaded back, so the CAS
 * succeeds. Cross-device conflicts are still caught (a different tab/device advanced the row →
 * the serialized write still reads a version the server has moved past → real conflict, as before).
 *
 * `makeWriteSerializer()` returns `serialize(key, task)`:
 *   - `task` is an async function performing one write; its resolved value is returned to the caller.
 *   - calls with the SAME key run strictly in submission order (serialized); DIFFERENT keys are
 *     independent (no cross-key blocking).
 *   - a task's rejection is isolated: it never breaks the next link in that key's chain, and the
 *     caller still receives that task's real result or rejection.
 *   - the chain pointer self-clears when its last link settles, so the map stays bounded by the
 *     number of live keys.
 *
 * Pure (no I/O, no globals beyond the closure), so the ordering/isolation guarantees are unit-tested.
 */
export function makeWriteSerializer() {
  const tail = {}; // key -> Promise (the chain tail; intentionally never rejects)
  return function serialize(key, task) {
    const prev = tail[key] || Promise.resolve();
    // Run `task` once the previous link settles, regardless of whether it resolved or rejected.
    const run = prev.then(() => task(), () => task());
    // The chain tail swallows outcomes so one failed write can't break the next link.
    const link = run.then(() => {}, () => {});
    tail[key] = link;
    // Drop the pointer once this is the last link to settle (keeps `tail` from growing unbounded).
    link.then(() => { if (tail[key] === link) delete tail[key]; });
    return run;
  };
}
