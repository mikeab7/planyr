/* /api/files — file bytes to/from Google Drive (B207 / NEW-2 wiring).
 *
 * Cloudflare Pages Function (server-side, where the Google creds live). The Project Files
 * drawer calls this to push a dropped PDF into the company Drive and to read it back.
 *
 *   POST   /api/files   — upload bytes (headers: X-Planyr-Key, X-Planyr-Folder,
 *                          X-Planyr-Name; body: raw bytes) → { ok, planyrKey }
 *   GET    /api/files?key=…  — download bytes back from Drive
 *   DELETE /api/files?key=…  — remove the file + its mapping
 *
 * Auth: a valid Supabase session (Authorization: Bearer <access token>), verified via the
 * Supabase Auth API. The Planyr-key↔Drive-id mapping persists in the drive_files table
 * (db/drive_files.sql) so a file saved in one request can be fetched in a later one,
 * scoped to the caller by RLS. Returns no-silent-failure results (B209).
 *
 * Needs deploy env: SUPABASE_URL, SUPABASE_ANON_KEY + the Google creds +
 * PLANYR_STORAGE_BACKEND=drive.
 */
import { buildStorageAdapter, storageConfig } from "../../server/storage/index.js";
import { verifySupabaseUser } from "../../server/auth/supabaseAuth.js";
import { supabaseIdStore } from "../../server/storage/idStoreSupabase.js";
import { folderStoreSupabase } from "../../server/storage/folderStoreSupabase.js";
import { treeParentForUpload } from "../../server/storage/folderMirror.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const slug = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9/]+/g, "-").replace(/^-+|-+$/g, "") || "x";

// Auth + adapter wired to the durable (Supabase-backed) id map, all scoped to the caller.
async function context_(env, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const v = await verifySupabaseUser({ token, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
  if (!v.ok) return { error: json({ ok: false, error: v.error }, 401) };
  const cfg = storageConfig(env);
  if (cfg.backend !== "drive") return { error: json({ ok: false, error: 'Storage backend is not "drive".' }, 503) };
  const idStore = supabaseIdStore({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token });
  const folderStore = folderStoreSupabase({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token });
  return { user: v.user, adapter: buildStorageAdapter(cfg, { idStore }), folderStore };
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const c = await context_(env, request);
  if (c.error) return c.error;

  const rawKey = request.headers.get("x-planyr-key");
  if (!rawKey) return json({ ok: false, error: "Missing X-Planyr-Key." }, 400);
  const name = request.headers.get("x-planyr-name") || "document.pdf";
  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const folder = `${c.user.id}/${slug(request.headers.get("x-planyr-folder") || "")}`; // per-user inside the shared Drive

  let bytes;
  try { bytes = new Uint8Array(await request.arrayBuffer()); } catch (_) { return json({ ok: false, error: "Couldn't read the upload body." }, 400); }
  if (!bytes.length) return json({ ok: false, error: "Empty upload." }, 400);

  // Tree filing (B650 follow-on): when the project's standard folder tree is mirrored, the
  // bytes land INSIDE it — 02. Design → 01. Drawings → <discipline> → 01. Current — via the
  // exact Drive folder id (the same shared resolver the Library uses for display). Tree not
  // seeded / not yet mirrored / no project → null → the flat legacy path above; never blocks.
  const parentFolderId = await treeParentForUpload({
    store: c.folderStore,
    projectId: request.headers.get("x-planyr-project"),
    discipline: request.headers.get("x-planyr-discipline"),
    folderId: request.headers.get("x-planyr-folder-id") || null, // explicit folder pick wins (B686)
  });

  const r = await c.adapter.save({ planyrKey: `${c.user.id}/${rawKey}`, bytes, contentType, name, folder, parentFolderId });
  if (!r.ok) return json({ ok: false, error: r.error }, 502);
  return json({ ok: true, planyrKey: rawKey });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const c = await context_(env, request);
  if (c.error) return c.error;
  const rawKey = new URL(request.url).searchParams.get("key");
  if (!rawKey) return json({ ok: false, error: "Missing ?key=." }, 400);
  const r = await c.adapter.fetch(`${c.user.id}/${rawKey}`);
  if (!r.ok) return json({ ok: false, error: r.error }, 404);
  return new Response(r.bytes, { status: 200, headers: {
    "content-type": r.contentType || "application/octet-stream",
    "cache-control": "private, no-store",
  } });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const c = await context_(env, request);
  if (c.error) return c.error;
  const rawKey = new URL(request.url).searchParams.get("key");
  if (!rawKey) return json({ ok: false, error: "Missing ?key=." }, 400);
  const r = await c.adapter.remove(`${c.user.id}/${rawKey}`);
  return json({ ok: r.ok, error: r.ok ? undefined : r.error }, r.ok ? 200 : 502);
}
