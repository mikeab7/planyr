/* Site plans — the ONE way a panel control (rename, visibility, lock, opacity, share, crop, site
 * link, background site attach) saves a change to a plan.
 *
 * ⛔ NEW-2 (2026-10-29): `updateOverlay` writes EVERY column of the row it is handed (`overlayToRow`), so
 * the row must be built from the plan's LATEST state, never from the copy a control captured when its
 * action STARTED. The old shape was `updateOverlay(id, { ...o, ...patch })` with `o` that stale copy,
 * stamped with the newest version — the compare-and-swap passed on stale data, so a background site link
 * (which waits on a lookup), a debounced opacity write or a rename silently wrote the plan's OLD position
 * / rotation / visibility back over a move the person made while it waited. Only the patch is the
 * intent of the action; everything else is read at WRITE time, inside the per-plan queue, from
 * `getLatest()`.
 *
 * Pure orchestration: every effect (the write, the refetch, the version cache, the latest-copy read) is
 * injected, so test/overlayPatchWrite.test.js drives it with a slow resolver and a fake store.
 */

/** The row to write: the plan's latest known state with ONLY the patch laid over it. */
export function rowBasis(latest, captured, patch, version) {
  return { ...(latest || captured), ...patch, version };
}

/** Save `patch` onto plan `id`. Retries once with the server's fresh version on a reported conflict
 *  (the queue already rules out our own writes racing, so a first conflict is presumed stale
 *  bookkeeping). Returns `{ error, data, conflict, expected }` of the last attempt. */
export async function writeOverlayPatch({ id, captured, patch, getLatest, getVersion, noteVersion, update, fetchAll }) {
  const expected0 = Number.isFinite(getVersion(id)) ? getVersion(id) : captured.version;
  let res = await update(id, rowBasis(getLatest(id), captured, patch, expected0));
  if (res.conflict) {
    const { data: fresh } = await fetchAll();
    const freshVersion = (fresh || []).find((x) => x.id === id)?.version;
    if (Number.isFinite(freshVersion) && freshVersion !== expected0) {
      noteVersion(id, freshVersion);
      // Re-read the latest copy: the refetch took time, and the person may have moved the plan since.
      res = await update(id, rowBasis(getLatest(id), captured, patch, freshVersion));
    }
  }
  return res;
}
