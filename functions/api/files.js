/* /api/files — file bytes back FROM Google Drive (B207 wiring; B409 rework).
 *
 * Cloudflare Pages Function (server-side, where the Google creds live).
 *
 *   GET    /api/files?key=…  — STREAM the file's bytes back from Drive. The client's
 *                              Range header is forwarded, so viewers can read a slice
 *                              (206 Partial Content) — this is what lets a 125 MB PDF
 *                              open progressively. The body is passed through as a
 *                              ReadableStream, never buffered (the Worker has 128 MB of
 *                              memory; response bodies aren't subject to the request cap).
 *   DELETE /api/files?key=…  — remove the file + its mapping
 *
 * UPLOADS NO LONGER LIVE HERE (B409 rework): the old POST buffered the whole file in the
 * Worker (~100 MB body cap + 128 MB memory) so a big civil set could never save. All
 * uploads now go through the chunked /api/uploads/* endpoints — see
 * functions/api/uploads/start.js.
 *
 * Auth: a valid Supabase session (Authorization: Bearer <access token>), verified via the
 * Supabase Auth API; every key is scoped under the token-derived uid, so one user can
 * never address another user's file (the B491 rule). The Planyr-key↔Drive-id mapping
 * persists in the drive_files table (db/drive_files.sql), scoped to the caller by RLS.
 * Returns no-silent-failure results (B209).
 *
 * Needs deploy env: SUPABASE_URL, SUPABASE_ANON_KEY + the Google creds +
 * PLANYR_STORAGE_BACKEND=drive.
 */
import { buildStorageAdapter, storageConfig } from "../../server/storage/index.js";
import { verifySupabaseUser } from "../../server/auth/supabaseAuth.js";
import { supabaseIdStore } from "../../server/storage/idStoreSupabase.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

// A filename safe inside a quoted Content-Disposition value: printable ASCII only, no
// quotes/backslashes (a raw name could otherwise break out of the header).
const dispositionName = (s) => String(s || "document").replace(/[^\x20-\x7E]/g, "_").replace(/[\\"]/g, "'");

// Auth + adapter wired to the durable (Supabase-backed) id map, all scoped to the caller.
async function context_(env, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const v = await verifySupabaseUser({ token, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
  if (!v.ok) return { error: json({ ok: false, error: v.error }, 401) };
  const cfg = storageConfig(env);
  if (cfg.backend !== "drive") return { error: json({ ok: false, error: 'Storage backend is not "drive".' }, 503) };
  const idStore = supabaseIdStore({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token });
  return { user: v.user, adapter: buildStorageAdapter(cfg, { idStore }) };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const c = await context_(env, request);
  if (c.error) return c.error;
  const rawKey = new URL(request.url).searchParams.get("key");
  if (!rawKey) return json({ ok: false, error: "Missing ?key=." }, 400);
  const range = request.headers.get("range") || undefined;
  const r = await c.adapter.fetchStream(`${c.user.id}/${rawKey}`, { range });
  if (!r.ok) return json({ ok: false, error: r.error }, 404);
  const headers = {
    "content-type": r.contentType || "application/octet-stream",
    "accept-ranges": "bytes", // advertises the slice support viewers probe for
    "content-disposition": `inline; filename="${dispositionName(r.name)}"`,
    "cache-control": "private, no-store",
  };
  if (r.contentLength) headers["content-length"] = r.contentLength;
  if (r.contentRange) headers["content-range"] = r.contentRange;
  return new Response(r.body, { status: r.status || 200, headers });
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
