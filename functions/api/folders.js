/* /api/folders — mirror a project's folder tree into Google Drive (B650).
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
import { supabaseIdStore } from "../../server/storage/idStoreSupabase.js";
import { syncProjectFolders, planDelete, migrateFilesToTree, moveKeyToTree } from "../../server/storage/folderMirror.js";

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
  const { action, projectId, folderId, offset, planyrKey, discipline } = body || {};
  if (!projectId) return json({ ok: false, error: "Missing projectId." }, 400);

  try {
    if (action === "file-move") {
      // Move ONE file's Drive bytes to the tree folder of an EXPLICIT discipline — the refile
      // flow, where the user just confirmed what a "needs filing" document actually is.
      if (!planyrKey) return json({ ok: false, error: "Missing planyrKey." }, 400);
      const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const idStore = supabaseIdStore({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token });
      const r = await moveKeyToTree({ userId: c.user.id, projectId, planyrKey, discipline, client: c.client, store: c.store, idStore });
      return json(r, r.ok ? 200 : 502);
    }
    if (action === "migrate-files") {
      // One-time migration (B660): move this project's already-uploaded Drive files into the
      // standard tree — one small batch per request (same chunking rule as sync); the client
      // loops on `done`. Idempotent (already-in-place files skip), so re-running is safe.
      const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const idStore = supabaseIdStore({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token });
      const r = await migrateFilesToTree({
        userId: c.user.id, projectId, client: c.client, store: c.store, idStore,
        offset: Number(offset) || 0, limit: 8,
      });
      return json(r, r.ok ? 200 : 502);
    }
    if (action === "sync") {
      // ONE small chunk per request (the 502 fix): a serverless request attempting a whole
      // 133-folder seed in one go gets killed by the platform mid-flight. 20 ops ≈ 40 network
      // calls ≈ seconds — comfortably inside every limit. The response's `remaining` tells the
      // client to call again; completed work persists, so the loop resumes, never duplicates.
      const r = await syncProjectFolders({ projectId, userId: c.user.id, client: c.client, store: c.store, maxOps: 20 });
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
