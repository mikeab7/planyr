/* POST /api/files — upload a file's bytes to Google Drive (B207 / NEW-2 wiring).
 *
 * A Cloudflare Pages Function (server-side, where the Google creds live). The Project
 * Files drawer calls this to push a dropped PDF into the company Drive, in addition to
 * the existing Supabase filing — so files start appearing in Drive without changing the
 * app's current read/restore path (a safe, additive first increment).
 *
 * Auth: requires a valid Supabase session (Authorization: Bearer <access token>),
 * verified via the Supabase Auth API — so this write endpoint can't be abused. Files are
 * namespaced by the caller's user id inside the app's Drive folder tree.
 *
 * Body: the raw file bytes. Headers: X-Planyr-Key (stable key), X-Planyr-Folder,
 * X-Planyr-Name, Content-Type. Returns { ok, planyrKey } / { ok:false, error } — never a
 * silent success (B209).
 *
 * Needs deploy env: SUPABASE_URL, SUPABASE_ANON_KEY (for auth) + the Google creds +
 * PLANYR_STORAGE_BACKEND=drive (already set).
 */
import { buildStorageAdapter, storageConfig } from "../../server/storage/index.js";
import { verifySupabaseUser } from "../../server/auth/supabaseAuth.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const slug = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9/]+/g, "-").replace(/^-+|-+$/g, "") || "x";

export async function onRequestPost(context) {
  const { env, request } = context;

  // 1) Auth — must be a real signed-in user.
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const v = await verifySupabaseUser({ token, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
  if (!v.ok) return json({ ok: false, error: v.error }, 401);

  // 2) Drive must be the active backend.
  const cfg = storageConfig(env);
  if (cfg.backend !== "drive") return json({ ok: false, error: 'Storage backend is not "drive".' }, 503);

  // 3) Inputs.
  const planyrKey = request.headers.get("x-planyr-key");
  if (!planyrKey) return json({ ok: false, error: "Missing X-Planyr-Key." }, 400);
  const name = request.headers.get("x-planyr-name") || "document.pdf";
  const contentType = request.headers.get("content-type") || "application/octet-stream";
  // Namespace by user id so a single shared Drive keeps each user's files separate.
  const folder = `${v.user.id}/${slug(request.headers.get("x-planyr-folder") || "")}`;

  let bytes;
  try { bytes = new Uint8Array(await request.arrayBuffer()); } catch (_) { return json({ ok: false, error: "Couldn't read the upload body." }, 400); }
  if (!bytes.length) return json({ ok: false, error: "Empty upload." }, 400);

  // 4) Save to Drive through the adapter (no-silent-failure contract).
  const adapter = buildStorageAdapter(cfg);
  const r = await adapter.save({ planyrKey: `${v.user.id}/${planyrKey}`, bytes, contentType, name, folder });
  if (!r.ok) return json({ ok: false, error: r.error }, 502);
  return json({ ok: true, planyrKey });
}
