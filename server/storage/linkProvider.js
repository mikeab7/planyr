/* Share-by-link provider (B205 / NEW-3).
 *
 * ALL share-link generation goes through this one interface, so switching how links are
 * minted is a single-place change. Today it returns the backend's NATIVE share link
 * (for Drive: a familiar Google Drive link — intentional, keeps recipients comfortable).
 * Later it can mint Planyr-native signed links (planyr.io/s/<token>, the backend serves
 * the bytes through the adapter) by flipping `kind` to "planyr" and supplying a `signer`
 * — no UI/app code changes, because nothing hardcodes a Drive link call.
 *
 * Non-goal (deferred): drag-a-file-out-of-the-browser-into-an-email — that's a desktop
 * sync-client gesture; for now the user does that in Drive directly.
 */
import { fail } from "./result.js";

export function createLinkProvider({ kind = "drive", backend, signer = null } = {}) {
  return {
    kind,
    /* Mint a share link for a file. `planyrKey` is the app-facing id; `backendId` is the
     * resolved backend id (the adapter passes both so neither side reaches across the
     * abstraction). Returns a result { ok, url } — never a bare string, never a throw. */
    async link(planyrKey, backendId, opts = {}) {
      if (kind === "drive") {
        if (!backend || typeof backend.shareLink !== "function") return fail("Backend can't produce a share link.");
        return backend.shareLink(backendId, opts); // native Drive link
      }
      if (kind === "planyr") {
        if (typeof signer !== "function") return fail("Planyr-native links need a signer (not configured).");
        return signer(planyrKey, opts); // planyr.io/s/<token> → backend bytes via the adapter
      }
      return fail(`Unknown link kind "${kind}".`);
    },
  };
}
