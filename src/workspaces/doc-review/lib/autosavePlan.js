/* Pure decision for ONE autosave tick of useReviewPersistence.
 *
 * Pulled out of the hook so the timing-sensitive gating is unit-testable in isolation.
 * Inputs are plain booleans the hook reads from its refs at tick time:
 *   - loadEcho : this tick is a programmatic load (resume/open) re-emitting the deps it just
 *                set — NOT a user edit. Skip everything and consume the flag so the very next
 *                genuine edit is treated normally (B19/B44).
 *   - enabled  : this persistence instance is active (e.g. DocReview only saves in "review"
 *                mode).
 *   - empty    : a blank review is never written.
 *   - suspended: still inside the short post-load window. A real edit here must still be
 *                MIRRORED + flagged dirty (so it's recoverable and reaches the cloud on the
 *                unmount/hide flush), but we must NOT schedule the debounced cloud write — that
 *                would re-save the just-loaded snapshot with a fresh updatedAt (B19). Before the
 *                fix the whole tick was skipped, so a genuine edit made <~1.5 s after open was
 *                never flagged dirty and never reached the cloud (B324/NEW-4).
 *
 * Returns the four actions the hook performs, all independent booleans.
 */
export function planAutosave({ enabled = true, empty = false, loadEcho = false, suspended = false } = {}) {
  if (loadEcho) return { consumeEcho: true, markDirty: false, mirror: false, scheduleSave: false };
  if (!enabled || empty) return { consumeEcho: false, markDirty: false, mirror: false, scheduleSave: false };
  return { consumeEcho: false, markDirty: true, mirror: true, scheduleSave: !suspended };
}
