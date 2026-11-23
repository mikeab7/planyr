/* /api/files/share — mint a shareable link for a filed drawing (B208 / NEW-3 exposure).
 *
 * The storage adapter + link provider already know HOW to make a link (Drive's native
 * "anyone with the link" webViewLink today; a future planyr.io/s/<token> is a one-place
 * switch via PLANYR_LINK_KIND, with zero change here). This route is the missing HTTP
 * surface that lets the app ask for one.
 *
 *   POST /api/files/share?key=…  → { ok, url }
 *
 * It's a POST (not a branch on the /api/files GET) because generating the link is a
 * MUTATION — it grants a public "anyone with the link" reader permission on the Drive file
 * — while that GET returns raw bytes. Auth + backend gating mirror /api/files exactly, and
 * statuses are honest (NEW-4): 401 (no session), 503 (Drive isn't the active backend), 404
 * (the file has no Drive mapping — e.g. a Supabase-fallback file, so there's no Drive link),
 * 502 (any other link failure). Never a silent success.
 */
import { buildStorageAdapter } from "../../../server/storage/index.js";
import { json, authedContext } from "../lib/http.js";
import { supabaseIdStore } from "../../../server/storage/idStoreSupabase.js";

// Auth + adapter wired to the durable (Supabase-backed) id map, scoped to the caller.
async function context_(env, request) {
  const a = await authedContext(env, request);
  if (a.error) return a;
  const idStore = supabaseIdStore({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, token: a.token });
  return { user: a.user, adapter: buildStorageAdapter(a.cfg, { idStore }) };
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const c = await context_(env, request);
  if (c.error) return c.error;
  const rawKey = new URL(request.url).searchParams.get("key");
  if (!rawKey) return json({ ok: false, error: "Missing ?key=." }, 400);
  const r = await c.adapter.shareLink(`${c.user.id}/${rawKey}`); // same uid-prefix as upload/download
  if (r.ok) return json({ ok: true, url: r.url });
  // No mapping for this key → the file isn't in Drive (e.g. a Supabase-fallback file) → 404;
  // any other failure (Drive API error, link not returned) → 502. Both are honest, never silent.
  const notFiled = /No file is filed/i.test(r.error || "");
  return json({ ok: false, error: r.error }, notFiled ? 404 : 502);
}
