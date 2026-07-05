/* /api/files/resumable — browser-direct LARGE-file uploads to Google Drive (B409).
 *
 * The plain /api/files POST buffers the whole upload in this Cloudflare Pages Function
 * (request.arrayBuffer()) and Drive-creates it with uploadType=multipart — Google's ≤5 MB
 * path. That caps real uploads at the Worker's ~100 MB request-body limit + 128 MB memory,
 * so a 100 MB+ civil set silently fails and falls back to Supabase → "oversize". This route
 * fixes that by keeping the bytes OFF the Worker entirely:
 *
 *   POST /api/files/resumable   — INIT: mint a Drive resumable session (server-side, where the
 *                                 Google creds live) and hand the pre-authorized session URL
 *                                 back. Headers: X-Planyr-Key, X-Planyr-Folder, X-Planyr-Name,
 *                                 X-Planyr-Content-Type, X-Planyr-Size. → { ok, uploadUri }
 *                                 The browser then PUTs the bytes straight to `uploadUri`
 *                                 (cross-origin to googleapis.com), so neither the body limit
 *                                 nor the memory cap applies — multi-GB works.
 *   PUT  /api/files/resumable   — COMMIT: after the browser's PUT returns the new Drive file id,
 *                                 record the Planyr-key ↔ Drive-id mapping so the file reads back
 *                                 later. Body: { planyrKey, fileId, name }. → { ok, planyrKey }
 *
 * Auth + backend gating mirror /api/files exactly (valid Supabase session; backend must be
 * "drive"). The session is minted with the browser's Origin so Google allows the cross-origin
 * PUT (CORS). The mapping lives in public.drive_files (db/drive_files.sql), scoped by RLS.
 */
import { storageConfig, defaultDriveClientFactory } from "../../../server/storage/index.js";
import { verifySupabaseUser } from "../../../server/auth/supabaseAuth.js";
import { supabaseIdStore } from "../../../server/storage/idStoreSupabase.js";
import { folderStoreSupabase } from "../../../server/storage/folderStoreSupabase.js";
import { treeParentForUpload } from "../../../server/storage/folderMirror.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const slug = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9/]+/g, "-").replace(/^-+|-+$/g, "") || "x";

// Verify the caller + confirm Drive is the active backend. Returns { user, token } or { error }.
async function auth_(env, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const v = await verifySupabaseUser({ token, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
  if (!v.ok) return { error: json({ ok: false, error: v.error }, 401) };
  const cfg = storageConfig(env);
  if (cfg.backend !== "drive") return { error: json({ ok: false, error: 'Storage backend is not "drive".' }, 503) };
  return { user: v.user, token, cfg };
}

// INIT — mint a resumable session for the browser to PUT the bytes to directly.
export async function onRequestPost(context) {
  const { env, request } = context;
  const a = await auth_(env, request);
  if (a.error) return a.error;

  const rawKey = request.headers.get("x-planyr-key");
  if (!rawKey) return json({ ok: false, error: "Missing X-Planyr-Key." }, 400);
  const name = request.headers.get("x-planyr-name") || "document.pdf";
  const contentType = request.headers.get("x-planyr-content-type") || "application/pdf";
  const size = Number(request.headers.get("x-planyr-size")) || undefined;
  const folder = `${a.user.id}/${slug(request.headers.get("x-planyr-folder") || "")}`; // per-user, mirrors /api/files

  const client = defaultDriveClientFactory(a.cfg.drive);
  if (!client) return json({ ok: false, error: "Google Drive isn't connected yet." }, 503);

  try {
    // Tree filing (B650 follow-on): large files target the project's standard tree folder too
    // (same shared resolver as /api/files); tree not mirrored → the flat legacy path. The
    // lookup itself never throws.
    const store = folderStoreSupabase({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token: a.token });
    const treeParent = await treeParentForUpload({
      store,
      projectId: request.headers.get("x-planyr-project"),
      discipline: request.headers.get("x-planyr-discipline"),
    });
    const parentFolderId = treeParent || await client.folderId(folder);
    const origin = request.headers.get("origin") || undefined; // bind the session for the browser's cross-origin PUT
    const { uploadUri } = await client.createResumableSession({ name, parentFolderId, contentType, size, origin });
    return json({ ok: true, uploadUri });
  } catch (e) {
    return json({ ok: false, error: (e && e.message) || "Couldn't start the upload." }, 502);
  }
}

// COMMIT — record the Planyr-key ↔ Drive-id mapping after the browser's PUT completes.
export async function onRequestPut(context) {
  const { env, request } = context;
  const a = await auth_(env, request);
  if (a.error) return a.error;

  let body = {};
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: "Invalid JSON body." }, 400); }
  const planyrKey = body && body.planyrKey;
  const fileId = body && body.fileId;
  if (!planyrKey || !fileId) return json({ ok: false, error: "Missing planyrKey or fileId." }, 400);

  // Record the key↔Drive-id mapping. If it fails, the file would read back as "missing" while
  // the upload looked like a success — the silent failure NEW-4 forbids. So delete the just-
  // uploaded Drive file (best-effort rollback) and fail honestly; the client retries.
  const idStore = supabaseIdStore({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token: a.token });
  const setRes = await idStore.set(`${a.user.id}/${planyrKey}`, fileId, { name: body.name }); // mirror /api/files key scoping
  if (setRes && setRes.ok === false) {
    try { const client = defaultDriveClientFactory(a.cfg.drive); if (client) await client.del(fileId); } catch (_) { /* best-effort rollback */ }
    return json({ ok: false, error: "Uploaded to Drive but couldn't record the file; it was rolled back — please retry." }, 502);
  }
  return json({ ok: true, planyrKey });
}
