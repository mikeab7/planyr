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
import { json, authedContext } from "../lib/http.js";
import { uploadSessionStore } from "../../../server/storage/uploadSessionStore.js";

export { json };

export async function uploadContext(env, request) {
  const a = await authedContext(env, request);
  if (a.error) return a;
  const store = uploadSessionStore({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token: a.token });
  return { user: a.user, token: a.token, cfg: a.cfg, store };
}

/* Load the caller's session row for an /api/uploads/<id>/* endpoint, or the honest error
 * Response. RLS makes a foreign or unknown id indistinguishable — both 404. */
export async function ownSession(ctx, id) {
  if (!id) return { error: json({ ok: false, error: "Missing upload id." }, 400) };
  const session = await ctx.store.get(id);
  if (!session) return { error: json({ ok: false, error: "No such upload." }, 404) };
  return { session };
}
