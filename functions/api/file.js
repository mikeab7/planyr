/* /api/file — auto-file a dropped drawing (B299 wiring).
 *
 * Cloudflare Pages Function (server-side, same origin as the app). The Project Files drawer
 * POSTs a dropped PDF here; this forwards it to the Cloud Run auto-filing service
 * (server/filing/), which reads the title block with the Claude API and returns a filing
 * decision. The browser NEVER sees the API key — it only ever talks to this same-origin proxy,
 * and the key lives on the Cloud Run side (KEY DECISIONS).
 *
 *   POST /api/file   headers: Authorization: Bearer <supabase token>,
 *                             X-Planyr-Projects: base64(JSON [{id,name,aliases?}])
 *                    body: raw PDF bytes
 *                    → { ok, decision, placement, facts }
 *
 * Gated, like the Drive backend: until DOC_FILING_URL is set this returns a clear 503 and the
 * drawer falls back to manual filing — no silent failure, no regression. Auth = a valid
 * Supabase session (same check as /api/files).
 */
import { verifySupabaseUser } from "../../server/auth/supabaseAuth.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export async function onRequestPost(context) {
  const { env, request } = context;

  // The compute service must be provisioned + pointed at. Absent → honest 503 (dormant).
  const target = env.DOC_FILING_URL;
  if (!target) return json({ ok: false, error: "Auto-filing isn't enabled yet (DOC_FILING_URL unset)." }, 503);

  // Require a signed-in user — the same gate the rest of the file plumbing uses.
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const v = await verifySupabaseUser({ token, supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY });
  if (!v.ok) return json({ ok: false, error: v.error }, 401);

  let bytes;
  try { bytes = await request.arrayBuffer(); } catch (_) { return json({ ok: false, error: "Couldn't read the upload body." }, 400); }
  if (!bytes || !bytes.byteLength) return json({ ok: false, error: "Empty upload." }, 400);

  let resp;
  try {
    resp = await fetch(`${target.replace(/\/+$/, "")}/file`, {
      method: "POST",
      headers: {
        "content-type": "application/pdf",
        "x-planyr-projects": request.headers.get("x-planyr-projects") || "",
        // Forward the caller's auth so the Cloud Run service can authorize (it runs
        // --no-allow-unauthenticated; the deploy wires identity-token/header auth there).
        authorization: request.headers.get("authorization") || "",
      },
      body: bytes,
    });
  } catch (e) { return json({ ok: false, error: `Auto-filing service unreachable: ${(e && e.message) || e}` }, 502); }

  let body = {};
  try { body = await resp.json(); } catch (_) { /* non-JSON */ }
  return json(body && Object.keys(body).length ? body : { ok: false, error: `Auto-filing service HTTP ${resp.status}` }, resp.status);
}
