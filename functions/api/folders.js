/* /api/folders — mirror a project's folder tree into Google Drive (B645).
 *
 * Cloudflare Pages Function (server-side, where the Google creds live). Planyr's Supabase
 * folder index is authoritative; this endpoint pushes structural changes one-way into Drive.
 * The client writes the tree straight to Supabase (own-row RLS) for instant, authoritative
 * edits, then calls here to reconcile the Drive mirror.
 *
 *   POST /api/folders  { action:"sync",        projectId }            → reconcile tree → Drive
 *   POST /api/folders  { action:"plan-delete", projectId, folderId }  → enumerate what a
 *                                                                        delete would remove
 *
 * Auth: a valid Supabase session (Authorization: Bearer <access token>). Drive gating matches
 * /api/files — when the backend isn't "drive" or creds are missing, returns 503 so the client
 * treats it as "Drive not enabled yet" (the tree still lives in Supabase; only the mirror waits).
 * Needs deploy env: SUPABASE_URL, SUPABASE_ANON_KEY, the Google creds, PLANYR_STORAGE_BACKEND=drive.
 */
import { verifySupabaseUser } from "../../server/auth/supabaseAuth.js";
import { storageConfig, defaultDriveClientFactory } from "../../server/storage/index.js";
import { folderStoreSupabase } from "../../server/storage/folderStoreSupabase.js";
import { syncProjectFolders, planDelete } from "../../server/storage/folderMirror.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

// Auth + a live Drive client + the folder store, all scoped to the caller. Mirrors files.js.
async function context_(env, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const v = await verifySupabaseUser({ token, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
  if (!v.ok) return { error: json({ ok: false, error: v.error }, 401) };
  const cfg = storageConfig(env);
  if (cfg.backend !== "drive") return { error: json({ ok: false, error: 'Storage backend is not "drive".' }, 503) };
  const client = defaultDriveClientFactory(cfg.drive);
  if (!client) return { error: json({ ok: false, error: "Google Drive isn't connected yet." }, 503) };
  const store = folderStoreSupabase({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token });
  return { user: v.user, client, store };
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const c = await context_(env, request);
  if (c.error) return c.error;

  let body = {};
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: "Expected a JSON body." }, 400); }
  const { action, projectId, folderId } = body || {};
  if (!projectId) return json({ ok: false, error: "Missing projectId." }, 400);

  try {
    if (action === "sync") {
      const r = await syncProjectFolders({ projectId, userId: c.user.id, client: c.client, store: c.store });
      return json(r, r.ok ? 200 : 502);
    }
    if (action === "plan-delete") {
      if (!folderId) return json({ ok: false, error: "Missing folderId." }, 400);
      const r = await planDelete({ projectId, folderId, client: c.client, store: c.store });
      return json(r, r.ok ? 200 : 502);
    }
    return json({ ok: false, error: `Unknown action "${action}".` }, 400);
  } catch (e) {
    return json({ ok: false, error: (e && e.message) || "Folder sync failed." }, 502);
  }
}
