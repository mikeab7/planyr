/* Source-availability taxonomy — the ONE owner of every "this file's bytes aren't
 * available" message across Document Review (the single-sheet banner in DocReview, the
 * Stitcher placeholder note, and the Files browser / drawer queue warns), so the surfaces
 * can't drift and each failure names its PRECISE, distinct cause (B405).
 *
 * The states are hard-distinct — "source unavailable" is NOT one bucket. Collapsing them
 * (the old behaviour) made every failure read "Couldn't fetch …", which hid whether a file
 * was never stored, too big to store, or stored-but-unreachable — and a missing source even
 * returned SILENTLY (no banner at all). Each state below maps to a different user action:
 *
 *   oversize     — over the 50 MB per-file cloud limit, so the bytes were never stored
 *                  online → re-open the file to view it (B207's Drive cutover lifts the cap).
 *   not-stored   — a source record exists but was never durably uploaded (a reload mid-
 *                  upload, or an upload that failed at import / before the bucket existed)
 *                  → re-open the file to upload it.
 *   signed-out   — not signed in, so the private cloud copy can't be read → sign in.
 *   fetch-failed — the file IS stored but the bytes didn't come back (network / permission)
 *                  → re-open the file to view it (a transient, retryable state).
 *
 * Re-opening the file always re-binds to the SAME review id (DocReview.openFile reuses the
 * srcId on a same-name re-drop and never changes reviewId), so markups are never orphaned.
 */

export const CLOUD_FILE_LIMIT_MB = 50;

/* Classify a persisted source BEFORE attempting a download. Returns one of the unavailable
 * states, or null when the source carries a storage/Drive key and should be fetchable (the
 * caller then attempts the fetch and, on failure, uses "fetch-failed" / "signed-out"). */
export function classifySource(src, { signedIn = true } = {}) {
  if (!src) return signedIn ? "not-stored" : "signed-out";
  if (src.oversize) return "oversize";
  if (!src.driveKey && !src.storageKey) return signedIn ? "not-stored" : "signed-out";
  return null; // has a key → looks fetchable
}

/* The single-sheet banner copy for a state. `name` = the file's display name. Durable
 * wording (never "coming soon"): the 50 MB cap text stays accurate whether or not Drive is
 * live, and every line ends by reassuring that markups are saved. */
export function sourceUnavailableMessage(state, { name = "this file" } = {}) {
  const q = `“${name}”`; // “name”
  switch (state) {
    case "oversize":
      return `${q} is over the ${CLOUD_FILE_LIMIT_MB} MB per-file cloud limit, so its pages couldn’t be stored online — re-open the file to view it (your markups are saved).`;
    case "not-stored":
      return `${q} wasn’t stored in the cloud — re-open the file to upload it (your markups are saved).`;
    case "signed-out":
      return `Sign in to view ${q} (your markups are saved).`;
    case "fetch-failed":
    default:
      return `Couldn’t load ${q} from the cloud just now — re-open the file to view it (your markups are saved).`;
  }
}

/* The short Files-browser / drawer queue warn for a just-filed file. Mirrors the banner
 * taxonomy so the two surfaces use one vocabulary. Returns null when the file stored fine. */
export function fileWarn({ oversize = false, uploadFailed = false, driveError = false } = {}) {
  if (oversize) return `over the ${CLOUD_FILE_LIMIT_MB} MB cloud limit — re-open to view`;
  if (uploadFailed) return `couldn’t be stored — re-open to upload`;
  if (driveError) return `filed; Drive copy failed`;
  return null;
}
