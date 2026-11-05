/* NEW-1 — WHEN a failed overlay download may HEAL the record (drop its `storageKey`, stamp
 * `storageMissing`), and when it may only REPORT. Pure; no Supabase, no React.
 *
 * WHY THIS EXISTS. Supabase Storage answers an object the caller's RLS will not let it read with the
 * SAME 400 "Object not found" it gives an object that is genuinely gone. The rehydrate loop in
 * `SitePlanner.jsx` turned that answer into `{ storageKey: null, storageMissing: true }` on the record,
 * and the record lives inside `sites.data` — which every teammate on a shared plan may write. So a
 * teammate simply OPENING the owner's shared plan erased the owner's overlay pointer in the owner's own
 * plan. Measured on production 2026-10-11 (read-only): 12 overlay records on shared plans carried
 * `storageMissing: true` with `storageKey` null while the very object their id names was still in the
 * bucket — every one of them a file in another account's folder from the point of view of a teammate.
 *
 * THE RULE. A "missing" answer is only trustworthy for an object the reader is GUARANTEED to be able to
 * read — its OWN folder (`<uid>/…`), which the bucket's own-folder SELECT policy always admits. Anything
 * else (another account's folder, no signed-in uid, a malformed key) could be a permission answer, so it
 * is reported (`denied`) and the record is left exactly as it is. Never widen this to "the owner's
 * folder when I am on the owner's team": team-read policies are DERIVED (they depend on the plan, the
 * team, the bin), so a denial there says nothing about whether the bytes exist. */

/** The uploader segment of a storage key (`<uid>/site-overlays/<plan>/<id>.<ext>`), or null when the
 *  key is not a plain relative object path. Rejects anything that could make the first segment lie. */
export function overlayKeyOwner(key) {
  if (typeof key !== "string" || !key) return null;
  if (key.startsWith("/") || key.includes("\\") || key.includes("//")) return null;
  const parts = key.split("/");
  if (parts.length < 2 || parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return parts[0];
}

/** May this failed download persist a heal onto the record?
 *  @param {{ key: string|null, missing: boolean, uid: string|null, cloudActive: boolean }} a
 *  @returns {boolean} true ONLY for a confirmed-missing object in the reader's own folder. */
export function mayHealMissingOverlay({ key, missing, uid, cloudActive } = {}) {
  if (!missing || !cloudActive || !uid || !key) return false;
  return overlayKeyOwner(key) === String(uid);
}

/** The terminal load reason to record for an overlay whose bytes could not be fetched.
 *  "missing" — the reader's own object is confirmed gone (re-add). "denied" — the object is in another
 *  account's folder (or the reader has no uid) and Storage refused it; it may be fine, just not readable
 *  by THIS account, so it must never read as "gone". "network" — a transient failure (retry). */
export function overlayLoadReason({ key, missing, uid }) {
  if (!key) return "missing"; // idb-only record whose local copy is gone: nothing in the cloud to ask
  if (!missing) return "network";
  return overlayKeyOwner(key) === String(uid || "") && uid ? "missing" : "denied";
}
