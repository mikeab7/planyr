/* Shared context for the /api/uploads/* chunked-upload endpoints (B409 rework).
 * Underscore-prefixed → NOT routed by Cloudflare Pages (same convention as
 * gis-cache/_handler.js). Auth + backend gating mirror /api/files exactly: a valid
 * Supabase session, and Drive must be the active storage backend.
 *
 * Ownership rule (the B491 IDOR lesson): every endpoint loads the upload session through
 * the CALLER'S token (anon key + RLS), so another user's uploadId resolves to nothing —
 * "not yours" and "doesn't exist" are the same 404, and no byte can be written into, or
 * read out of, someone else's upload. The Drive session URI stays in that row and is
 * never included in any response.
 */
import { storageConfig } from "../../../server/storage/index.js";
import { verifySupabaseUser } from "../../../server/auth/supabaseAuth.js";
import { uploadSessionStore } from "../../../server/storage/uploadSessionStore.js";

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export async function uploadContext(env, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const v = await verifySupabaseUser({ token, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
  if (!v.ok) return { error: json({ ok: false, error: v.error }, 401) };
  const cfg = storageConfig(env);
  if (cfg.backend !== "drive") return { error: json({ ok: false, error: 'Storage backend is not "drive".' }, 503) };
  const store = uploadSessionStore({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token });
  return { user: v.user, token, cfg, store };
}

/* Load the caller's session row for an /api/uploads/<id>/* endpoint, or the honest error
 * Response. RLS makes a foreign or unknown id indistinguishable — both 404. */
export async function ownSession(ctx, id) {
  if (!id) return { error: json({ ok: false, error: "Missing upload id." }, 400) };
  const session = await ctx.store.get(id);
  if (!session) return { error: json({ ok: false, error: "No such upload." }, 404) };
  return { session };
}
