/* saveDedupe — "is this exactly the record I last wrote?" (B2233521).
 *
 * A plan switch wrote the plan being left TWICE, back to back: the header's switch handler flushes it (`flushSite`), and the planner's own
 * persist-on-leave writes the identical state again a moment later — each a whole `saveSite` (read, migrate, normalise, history snapshot,
 * write, read-back). With the planner now KEPT across a switch (lib/plannerKeepAlive.js) the second one runs inside the show. The second
 * write changes nothing on disk, so it is skipped — but ONLY when both of these hold:
 *   1. every field of the record is the SAME VALUE (identity for the collections, which the planner never mutates in place — every edit
 *      replaces the array — and value for the scalar header fields), and
 *   2. the store still holds that write byte-for-byte (`sitesWriteStillCurrent`, the same proof the autosave's settle tick already uses):
 *      any other writer in between — another tab, a cloud pull, a rename — fails it and the write runs exactly as before.
 * Pure: the caller owns the stamp and the write.
 */
export const SAVE_RECORD_KEYS = Object.freeze([
  "id", "site", "name", "groupId", "county", "origin",
  "parcels", "els", "measures", "callouts", "markups", "settings", "sheetOverlays", "deletedIds", "layerOverrides", "layerAbove",
]);

export function sameSaveRecord(a, b) {
  if (!a || !b) return false;
  for (const k of SAVE_RECORD_KEYS) if (a[k] !== b[k]) return false;
  return true;
}

/** May a write of `rec` be skipped? `last` = `{ rec, stamp }` of the last write this caller made; `stillCurrent(stamp)` proves the store
 *  still holds it. */
export function writeIsRedundant(last, rec, stillCurrent) {
  return !!(last && last.stamp && sameSaveRecord(last.rec, rec) && stillCurrent(last.stamp));
}

/* B2233521 — WHOSE STORE. A planner's in-memory plan belongs to the account it was OPENED under. The device store a save lands in is chosen
 * at WRITE time by the account that is signed in at that moment, so a flush that runs after a sign-out (persist-on-leave as the planner
 * unmounts, a page-hide flush, a kept planner's flush) wrote the account's plan into the SIGNED-OUT store — measured on the build before
 * this change, without any keep-alive: the plan on screen at sign-out was copied into the logged-out device store, where the next visitor
 * of that browser would see it. The rule: a planner OPENED UNDER AN ACCOUNT writes only while that same account is signed in. Nothing is
 * lost by refusing: every edit was already written, immediately, to that account's store when it was made.
 * A planner opened with NO account (signed out, or the first instant of a page load before sign-in resolves) is deliberately NOT gated:
 * the boot path mounts before auth resolves and relies on its saves landing in whatever store becomes active — refusing there could stop
 * a live planner saving at all, which is a worse failure than the one this closes. */
export function mayWriteForAccount(openedUid, nowUid) {
  if (!openedUid) return true;
  return openedUid === (nowUid || null);
}
