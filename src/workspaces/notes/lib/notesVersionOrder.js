/* notesVersionOrder — which of the two conflicting copies is NEWER (B849105, notes/versions
 * follow-up). PURE: one function, no DOM, no editor.
 *
 * ⛔ THE BUG THIS REPLACES. `notesRedline.js` used to hardcode `localDoc` ("this window") as
 * the diff's REVISED side and `serverDoc` ("the other window") as ORIGINAL — always, regardless
 * of which one was actually written more recently. The owner hit exactly the case that makes
 * that wrong: his "this window" copy was the OLDER edit (last touched 4 days ago), his "other
 * window" copy was NEWER (1 day ago, after a "Convert table to text" pass had already removed a
 * table and left its contact rows as plain lines). The redline is diff-direction-only, so it
 * showed "Table — added" (present on the REVISED/local side) — true of the arbitrary window
 * pairing, but the exact opposite of what actually happened over time: the table was REMOVED
 * going old → new, not added. His words: *"you show table added, i thought the update was that
 * the table was deleted?"* He was right, and the reason is that "revised" was never really
 * "revised" — it was just "whichever copy happens to be open in this tab."
 *
 * A conflict's two copies have no natural "which one is more correct" ordering — that is the
 * whole reason a conflict was raised — but they DO have a natural "which one was written more
 * recently" ordering, whenever both timestamps are known and different, and that is a fact
 * about the WORLD rather than an artifact of which browser tab you happen to be reading from.
 * Every caller that needs to talk about "added"/"removed" (the redline) or "which one do I
 * keep" (the footer buttons) should orient on THAT axis, not on local-vs-server.
 *
 * `updatedAt` here is `Notes.jsx`'s `localUpdatedAt` (this device's tree, stamped only by
 * `touchPage` on an actual saved write) and the conflict entry's `serverUpdatedAt` (the row's
 * own `updated_at`, set by `notesConflictFor`) — see that file's header for why neither can be
 * invented when absent.
 */

/** One side of the pairing: which choice resolves to it (`"mine"` keeps the local/device copy,
 *  `"theirs"` keeps the server copy — the same vocabulary `resolveNotesConflict` already uses),
 *  its document, and its own `updatedAt` (possibly `null` — see below). */
function side(which, doc, updatedAt) {
  return { which, doc, updatedAt };
}

/** Order the two conflicting copies by recency.
 *
 * Returns `{ comparable, newer, older }`.
 *
 * `comparable` is `true` only when BOTH timestamps are known (finite numbers) AND they differ —
 * an exact tie is not treated as one side being "newer", because it isn't; that is the honest
 * reading whenever both windows saved within the same recorded millisecond, or a page's
 * timestamp granularity can't tell them apart.
 *
 * `newer`/`older` are ALWAYS populated (never `null`) so a caller never has to branch on their
 * presence — but when `comparable` is `false` they are a STABLE, ARBITRARY pairing (the local
 * copy first) carrying no claim about which one is actually more recent. ⛔ A caller MUST check
 * `comparable` before rendering either as "newer"/"older" in a word a person reads — displaying
 * an unproven direction is exactly the bug this file exists to remove. When it is `false`, fall
 * back to a neutral, non-recency label (see `ConflictReview.jsx` / `ConflictSideBySide.jsx`).
 */
export function orderConflictVersions({ localDoc, serverDoc, localUpdatedAt, serverUpdatedAt } = {}) {
  const mine = side("mine", localDoc ?? null, Number.isFinite(localUpdatedAt) ? localUpdatedAt : null);
  const theirs = side("theirs", serverDoc ?? null, Number.isFinite(serverUpdatedAt) ? serverUpdatedAt : null);

  const bothKnown = Number.isFinite(mine.updatedAt) && Number.isFinite(theirs.updatedAt);
  const comparable = bothKnown && mine.updatedAt !== theirs.updatedAt;
  if (!comparable) return { comparable: false, newer: mine, older: theirs };

  return mine.updatedAt > theirs.updatedAt
    ? { comparable: true, newer: mine, older: theirs }
    : { comparable: true, newer: theirs, older: mine };
}
