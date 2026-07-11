/* Storage adapter — the single module the app talks to for file operations (B206 / NEW-1).
 *
 * The app calls ONLY these methods (save / fetch / list / move / rename / remove /
 * shareLink) and references files ONLY by Planyr's own stable keys. Inside, the adapter:
 *   - translates Planyr key ↔ backend id through the idMap (the only translator), so no
 *     backend id (e.g. a Google Drive file id) ever leaks into app code;
 *   - delegates the actual bytes work to a swappable `backend` (memory stub today,
 *     Google Drive next — B207; the swap is a one-line change here, nothing in the app);
 *   - routes every share link through the linkProvider (B208);
 *   - returns a result object for EVERY op and never throws (B209 / NEW-4), so a failed
 *     or half-finished file op is always a visible state, never a silent success.
 *
 * Acceptance (NEW-1): point this at a different/stub backend and NOTHING outside this
 * module changes — see test/storageAdapter.test.js.
 */
import { ok, fail, attempt } from "./result.js";
import { createIdMap } from "./idMap.js";
import { createLinkProvider } from "./linkProvider.js";

export function createStorageAdapter({ backend, idMap = createIdMap(), linkProvider } = {}) {
  if (!backend) throw new Error("createStorageAdapter requires a backend.");
  const links = linkProvider || createLinkProvider({ kind: "drive", backend });

  // Resolve a Planyr key to a backend id (async — the idMap may be a durable store).
  const resolved = (planyrKey) => idMap.resolve(planyrKey);

  return {
    backendName: backend.name || "unknown",
    linkKind: links.kind,

    /* Store bytes under a Planyr stable key. The app chooses the key; the backend returns
     * its own id, which we bind in the idMap and never expose. `parentFolderId` (optional,
     * server-resolved — the B650 tree-filing follow-on) pins the file into an EXACT backend
     * folder id (a folder of the project's standard tree); omitted → the backend derives the
     * folder from the `folder` path exactly as before. */
    async save({ planyrKey, bytes, contentType = "application/octet-stream", name, folder, parentFolderId } = {}) {
      if (!planyrKey) return fail("save needs a planyrKey.");
      if (bytes == null) return fail("save needs bytes.");
      const r = await attempt(() => backend.put({ bytes, contentType, name, folder, planyrKey, parentFolderId }), "Upload");
      if (!r.ok) return r;
      if (!r.backendId) return fail("Backend did not return an id for the saved file.");
      // Record the key↔backend-id mapping. If THIS fails after the bytes already landed, the
      // file would read back as "missing" (nothing resolves it) while the upload looked like a
      // success — the silent failure NEW-4 forbids. So roll the bytes back (best-effort) and
      // fail honestly; the caller retries / falls back, and no orphaned copy is left behind.
      const bound = await idMap.bind(planyrKey, r.backendId, { name });
      if (bound && bound.ok === false) {
        await attempt(() => backend.remove(r.backendId), "Rollback");
        return fail("Saved the file but couldn't record it; the upload was rolled back — please retry.");
      }
      return ok({ planyrKey });
    },

    /* Fetch bytes by Planyr key. */
    async fetch(planyrKey) {
      const backendId = await resolved(planyrKey);
      if (!backendId) return fail(`No file is filed under "${planyrKey}".`);
      return attempt(() => backend.get(backendId), "Download");
    },

    /* Fetch bytes by Planyr key as a pass-through STREAM (B409 rework — the large-file
     * download path). `range` (an HTTP Range header value) is forwarded to the backend so
     * a viewer can read a slice (206 Partial Content) instead of the whole file; the body
     * is never buffered in this process. */
    async fetchStream(planyrKey, { range } = {}) {
      const backendId = await resolved(planyrKey);
      if (!backendId) return fail(`No file is filed under "${planyrKey}".`);
      return attempt(() => backend.getStream(backendId, { range }), "Download");
    },

    /* List files (by a Planyr-level query, e.g. { folder }). Returns items keyed by
     * Planyr key only — backend objects with no Planyr binding are omitted, never leaked. */
    async list(query = {}) {
      const r = await attempt(() => backend.list(query), "List");
      if (!r.ok) return r;
      const mapped = await Promise.all((r.items || []).map(async (it) => ({
        planyrKey: await idMap.reverse(it.backendId), name: it.name, size: it.size, contentType: it.contentType, folder: it.folder,
      })));
      return ok({ items: mapped.filter((it) => it.planyrKey) }); // drop anything not bound to a Planyr key
    },

    /* Move a file to another folder (Planyr-level folder concept). */
    async move(planyrKey, toFolder) {
      const backendId = await resolved(planyrKey);
      if (!backendId) return fail(`No file is filed under "${planyrKey}".`);
      return attempt(() => backend.move(backendId, toFolder), "Move");
    },

    /* Rename a file's display name (its Planyr key is stable and does NOT change). */
    async rename(planyrKey, newName) {
      const backendId = await resolved(planyrKey);
      if (!backendId) return fail(`No file is filed under "${planyrKey}".`);
      if (!newName) return fail("rename needs a new name.");
      return attempt(() => backend.rename(backendId, newName), "Rename");
    },

    /* Delete a file and drop its mapping. */
    async remove(planyrKey) {
      const backendId = await resolved(planyrKey);
      if (!backendId) return fail(`No file is filed under "${planyrKey}".`);
      const r = await attempt(() => backend.remove(backendId), "Delete");
      if (r.ok) await idMap.unbind(planyrKey);
      return r;
    },

    /* Produce a share link for a file (routed through the link provider — B208). */
    async shareLink(planyrKey, opts = {}) {
      const backendId = await resolved(planyrKey);
      if (!backendId) return fail(`No file is filed under "${planyrKey}".`);
      return attempt(() => links.link(planyrKey, backendId, opts), "Share link");
    },
  };
}
