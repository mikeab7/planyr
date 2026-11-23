/* The ONE home for the small HTTP helpers every `functions/` route used to re-declare (audit batch I7, 2026-11-23):
 * `json`, `bearer`, `serviceHeaders`, `authedContext` and the constant-time `safeEqual`. Not routed (no onRequest* export). */
import { verifySupabaseUser } from "../../../server/auth/supabaseAuth.js";
import { storageConfig, defaultDriveClientFactory } from "../../../server/storage/index.js";

export { safeEqual } from "./safeEqual.js";

/* JSON Response. `extra` merges headers (cache-control etc.) after the content-type. */
export const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });

/* The bearer token on a request, "" when absent (the exact trim the Drive routes always used). */
export const bearer = (request) => (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");

/* Supabase service-role request headers (server-only key). `extra` merges after. */
export const serviceHeaders = (key, extra = {}) => ({ apikey: key, authorization: `Bearer ${key}`, ...extra });

/* Auth + backend gating shared by every Drive-backed route. Resolves `{ user, token, cfg }`, plus a live
 * `client` when `needDrive` is set; on failure `{ error: Response }` with the same statuses/messages the routes
 * answered before (401 verify failure, 503 backend not drive, 503 Drive not connected). */
export async function authedContext(env, request, { needDrive = false } = {}) {
  const token = bearer(request);
  const v = await verifySupabaseUser({ token, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
  if (!v.ok) return { error: json({ ok: false, error: v.error }, 401) };
  const cfg = storageConfig(env);
  if (cfg.backend !== "drive") return { error: json({ ok: false, error: 'Storage backend is not "drive".' }, 503) };
  const out = { user: v.user, token, cfg };
  if (needDrive) {
    const client = defaultDriveClientFactory(cfg.drive);
    if (!client) return { error: json({ ok: false, error: "Google Drive isn't connected yet." }, 503) };
    out.client = client;
  }
  return out;
}
