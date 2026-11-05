/* deleteOutcome — the ONE reading of `deleteReview`'s result (NEW-1, LOUD-FAILURE).
 *
 * `deleteReview` (reviewStore.js) answers `{ ok, removed, soft, error, orphaned?, cleanupFailed?,
 * sharedKept? }` and its own comment says `removed: 0` is the RLS / ownership / already-deleted
 * NO-OP (B757): the UPDATE ran, touched nothing, and reported no error. Two callers read that
 * result — the Library's `useReviewTrash` (ReviewTrash.jsx) and the "Reviews ▾" menu's own ×
 * (ReviewsBar.jsx). The menu used to `await deleteReview(id); refresh();` and drop the result on
 * the floor, so a refused delete cleared the confirm row, refreshed the list, and left the review
 * exactly where it was with nothing saying why. This module is the shared verdict so the two
 * surfaces cannot disagree about what "it worked" means; the Library's wording lives beside it in
 * `TrashNotice`, which both surfaces render.
 *
 * Pure: no React, no network. Unit-tested in test/deleteOutcome.test.js. */

/** `landed` — a delete that REALLY happened (soft, ≥1 row). `failed` — nothing was deleted
 *  (no result, a reported error, or a 0-row soft delete). `cleanup` — a hard delete that ran but
 *  left bytes behind (NEW-4's orphaned / cleanupFailed). The three are disjoint on every input;
 *  `landed` and `failed` can both be false only for a hard delete that fully succeeded. */
export function deleteReviewOutcome(r) {
  if (!r || typeof r !== "object") return { landed: false, failed: true, cleanup: null, reason: "no-result" };
  const removed = Number.isFinite(r.removed) ? r.removed : null;
  if (!r.ok) return { landed: false, failed: true, cleanup: null, reason: r.error ? "error" : "not-ok" };
  if (r.soft && removed === 0) return { landed: false, failed: true, cleanup: null, reason: "zero-rows" };
  const cleanup = (r.orphaned || r.cleanupFailed) ? { orphaned: r.orphaned || 0, sharedKept: r.sharedKept || 0 } : null;
  return { landed: !!(r.soft && removed > 0), failed: false, cleanup, reason: null };
}

/** The telemetry row a FAILED outcome earns — `null` when nothing failed. The event name is the
 *  B468 "a delete that affected zero rows" vocabulary, so a refused delete in either surface is
 *  one query in client_errors, not an investigation. */
export function deleteFailureEvent(outcome, { surface, id }) {
  if (!outcome || !outcome.failed) return null;
  const kind = outcome.reason === "zero-rows" ? "delete-zero-rows" : "cloud-write-failed";
  return { kind, message: `${surface} review delete refused (${outcome.reason})`, extra: { id, surface } };
}
