/* Google Drive storage backend (B207 / NEW-2) — scaffold behind the adapter.
 *
 * One backend implementation of the contract in memoryBackend.js, storing BYTES ONLY in
 * a Workspace Drive on planyr.io. It is the substrate beneath auto-filing, NOT a
 * redefinition of it: auto-filing (title-block read → match project + aliases →
 * rename/route into the folder structure → "needs filing" holding area for no-match /
 * low-confidence, never auto-guess → queryable index of file facts) stays authoritative
 * and writes THROUGH this backend. The index records live in Supabase Postgres, not Drive.
 *
 * ── Live wiring is BLOCKED on the manual Google setup (owner + Cowork). Until the OAuth
 *    client is provided, every op returns a clear { ok:false } — never a throw, never a
 *    silent success (B209). Pass a `client` (the thin Drive REST wrapper, created
 *    server-side from the credentials) to light it up; no app code changes.
 *
 * ── Decisions baked in (per the NEW-2 spec):
 *    • OAuth app type = Internal (Workspace user type) → skips Google verification and
 *      the 7-day refresh-token expiry.
 *    • Scope = drive.file (least privilege): the app only touches files IT creates, which
 *      is sufficient because Planyr creates the folder structure and drops files in — and
 *      those files still show up normally in the owner's Drive for manual drag-to-email.
 *      Use a broader Drive scope ONLY if Planyr must read/organize pre-existing files;
 *      that's a deliberate decision to flag, not a default.
 *    • Credentials (client id/secret) + the OAuth refresh token live SERVER-SIDE ONLY —
 *      never in the frontend build, never a VITE_ var, never committed, never on the
 *      public Cloudflare Pages deploy (same isolation rule as the APS key).
 *    • Moving storage to Drive removes the Supabase free-tier 50 MB-per-file ceiling.
 *
 * Expected `client` interface (the part Cowork's setup makes real — a fill-in, not a
 * rebuild). Each returns a plain value or throws; the adapter's `attempt()` + this
 * wrapper turn throws/!ok into visible failures:
 *   client.create({ bytes, contentType, name, parentFolderId }) -> { id }
 *   client.media(fileId)                 -> { bytes, contentType, name }
 *   client.list({ parentFolderId })      -> [{ id, name, size, mimeType, parents }]
 *   client.update(fileId, { addParents, removeParents, name }) -> { id }
 *   client.del(fileId)                   -> void
 *   client.permitAnyoneReader(fileId)    -> { webViewLink }
 *   client.folderId(folderPath)          -> string   (ensures/loads the folder, returns id)
 */
import { ok, fail } from "../result.js";

const NOT_CONFIGURED =
  "Google Drive isn't connected yet — add the server-side OAuth credentials (Workspace setup) to enable filing to Drive.";

export function driveBackend({ client = null } = {}) {
  const need = () => (client ? null : fail(NOT_CONFIGURED));

  // Resolve a Planyr folder concept to a Drive folder id (the client ensures it exists).
  const folderId = async (folder) => (folder ? await client.folderId(folder) : undefined);

  return {
    name: "drive",
    configured: !!client,

    async put({ bytes, contentType, name, folder, parentFolderId: pinnedParent }) {
      const n = need(); if (n) return n;
      // A pinned parent id (B650 tree filing — the caller resolved the exact tree folder's
      // Drive id) wins over the lazy path-ensure; that's what lands drawings INSIDE the
      // project's standard folder tree instead of the flat legacy path.
      const parentFolderId = pinnedParent || await folderId(folder);
      const res = await client.create({ bytes, contentType, name, parentFolderId });
      if (!res || !res.id) return fail("Drive did not return a file id.");
      return ok({ backendId: res.id });
    },

    async get(backendId) {
      const n = need(); if (n) return n;
      const m = await client.media(backendId);
      return ok({ bytes: m.bytes, contentType: m.contentType, name: m.name });
    },

    /* Streamed read (B409 rework): the body is Drive's own ReadableStream, passed through
     * unbuffered; `range` (an HTTP Range header value) is forwarded so viewers can read a
     * slice — status is then 206 and contentRange echoes Drive's Content-Range. */
    async getStream(backendId, { range } = {}) {
      const n = need(); if (n) return n;
      const m = await client.mediaStream(backendId, { range });
      return ok({
        status: m.res.status, // 200, or 206 for a range read
        body: m.res.body,     // ReadableStream — never buffered in the Worker
        contentType: m.contentType, name: m.name, size: m.size,
        contentLength: m.res.headers.get("content-length") || (m.size != null ? String(m.size) : null),
        contentRange: m.res.headers.get("content-range") || null,
      });
    },

    async list({ folder } = {}) {
      const n = need(); if (n) return n;
      const parentFolderId = await folderId(folder);
      const rows = await client.list({ parentFolderId });
      const items = (rows || []).map((r) => ({ backendId: r.id, name: r.name, size: Number(r.size) || 0, contentType: r.mimeType, folder: folder || null }));
      return ok({ items });
    },

    async move(backendId, toFolder) {
      const n = need(); if (n) return n;
      const addParents = await folderId(toFolder);
      await client.update(backendId, { addParents });
      return ok();
    },

    async rename(backendId, newName) {
      const n = need(); if (n) return n;
      await client.update(backendId, { name: newName });
      return ok();
    },

    async remove(backendId) {
      const n = need(); if (n) return n;
      await client.del(backendId);
      return ok();
    },

    // Native Drive share link (B208 default). Recipients see a familiar Google Drive link.
    async shareLink(backendId) {
      const n = need(); if (n) return n;
      const res = await client.permitAnyoneReader(backendId);
      if (!res || !res.webViewLink) return fail("Drive did not return a share link.");
      return ok({ url: res.webViewLink });
    },
  };
}
