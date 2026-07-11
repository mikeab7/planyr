/* POST /api/uploads/start — open a chunked upload to Google Drive (B409 rework).
 *
 * The server-side half of unlimited-size uploads: mints a Drive RESUMABLE session (the
 * Google creds live only here), persists its session URI in public.upload_sessions
 * (db/upload_sessions.sql — the URI is a capability URL and NEVER goes to the browser),
 * and hands back only an opaque uploadId + the chunk size. The browser then PUTs ~16 MB
 * slices to /api/uploads/<id>/chunk, all same-origin — which is what keeps every request
 * under the Worker's ~100 MB body cap and 128 MB memory, at any total file size.
 *
 * Body: { fileName, mimeType, totalBytes, planyrKey, projectId?, discipline?, folderId? }
 * → { ok, uploadId, chunkSize }
 *
 * Folder targeting mirrors the old upload paths exactly: the project's mirrored standard
 * tree wins (B650/B686), else the flat `<uid>/<project…/discipline>` path derived from
 * the planyrKey — so files land in the same Drive folders they always did.
 */
import { defaultDriveClientFactory } from "../../../server/storage/index.js";
import { folderStoreSupabase } from "../../../server/storage/folderStoreSupabase.js";
import { treeParentForUpload } from "../../../server/storage/folderMirror.js";
import { UPLOAD_CHUNK_SIZE } from "../../../server/uploads/resumableProxy.js";
import { json, uploadContext } from "./_common.js";

const slug = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9/]+/g, "-").replace(/^-+|-+$/g, "") || "x";

export async function onRequestPost(context) {
  const { env, request } = context;
  const c = await uploadContext(env, request);
  if (c.error) return c.error;

  let body = {};
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: "Invalid JSON body." }, 400); }
  const planyrKey = typeof body.planyrKey === "string" ? body.planyrKey.trim() : "";
  const totalBytes = Number(body.totalBytes);
  const fileName = (typeof body.fileName === "string" && body.fileName) || "document.pdf";
  const mimeType = (typeof body.mimeType === "string" && body.mimeType) || "application/octet-stream";
  if (!planyrKey || planyrKey.length > 1024) return json({ ok: false, error: "Missing or invalid planyrKey." }, 400);
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return json({ ok: false, error: "totalBytes must be a positive integer." }, 400);

  const client = defaultDriveClientFactory(c.cfg.drive);
  if (!client) return json({ ok: false, error: "Google Drive isn't connected yet." }, 503);

  // Housekeeping: drop the caller's expired sessions (Google kills the URI after ~1 week).
  // Off the critical path when the platform allows it; never blocks the upload.
  try {
    if (typeof context.waitUntil === "function") context.waitUntil(c.store.purgeExpired());
    else await c.store.purgeExpired();
  } catch (_) { /* best-effort */ }

  try {
    // Tree filing first (B650/B686 — explicit folder pick wins, then the discipline route
    // inside the mirrored standard tree); the flat legacy path derived from the planyrKey
    // (`<uid>/project-…/<discipline>/…`) is the never-blocking fallback.
    const store = folderStoreSupabase({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token: c.token });
    const treeParent = await treeParentForUpload({
      store,
      projectId: body.projectId ? String(body.projectId) : null,
      discipline: body.discipline ? String(body.discipline) : null,
      folderId: body.folderId ? String(body.folderId) : null,
    });
    const flatFolder = `${c.user.id}/${slug(planyrKey.split("/").slice(0, -1).join("/"))}`;
    const parentFolderId = treeParent || await client.folderId(flatFolder);

    // Mint the resumable session server-side (no browser Origin binding — the only thing
    // that ever PUTs to this URI is this Worker; B409's browser-direct PUT is CORS-dead).
    const { uploadUri } = await client.createResumableSession({
      name: fileName, parentFolderId, contentType: mimeType, size: totalBytes,
    });

    // Persist the session BEFORE telling the browser anything — a session we can't find
    // again on the next chunk request would be a silent dead end (LOUD-FAILURE).
    const created = await c.store.create({
      planyrKey, driveSessionUri: uploadUri, fileName, mimeType, totalBytes,
    });
    if (!created.ok) return json({ ok: false, error: "Couldn't record the upload session — please retry." }, 502);

    return json({ ok: true, uploadId: created.id, chunkSize: UPLOAD_CHUNK_SIZE });
  } catch (e) {
    return json({ ok: false, error: (e && e.message) || "Couldn't start the upload." }, 502);
  }
}
