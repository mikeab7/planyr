/* GET /oauth/authorize — the start of "Connect to Claude" (see functions/api/oauth/_lib.js).
 * Checks the client and its EXACT registered redirect first: if either is wrong it shows an error page on planyr.io and
 * NEVER redirects (RFC 6749 4.1.2.1 — an open redirect is how codes get stolen). Any other bad
 * request also gets a page, never a redirect. A good request is stored server-side and the browser goes to
 * the Allow page `/#/connect/<id>`: only that id travels through sign-in (safeNextRoute keeps it; a query would be cut). */
import { CHALLENGE_RE, rpc, SCOPE } from "../api/oauth/_lib.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
  "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
};
export function errorPage(title, detail, status = 400) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Planyr · ${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#f7f7f5;--fg:#1c1c1a;--card:#fff;--line:#d9d9d4}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ececea;--card:#1f1f1d;--line:#3a3a37}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:30rem;margin:12vh auto;padding:1.5rem;background:var(--card);border:1px solid var(--line);border-radius:12px}
h1{font-size:1.25rem;margin:0 0 .5rem}a{color:inherit}</style></head><body><main>
<h1>${esc(title)}</h1><p>${esc(detail)}</p><p>Nothing was connected. Start again from your AI assistant, or <a href="/">open Planyr</a>.</p>
</main></body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

export async function handleAuthorize({ env, request, fetchImpl = fetch }) {
  if (request.method !== "GET") return errorPage("That link didn't work", "This address only opens from a link.", 405);
  const q = new URL(request.url).searchParams;
  const clientId = q.get("client_id") || "";
  const redirectUri = q.get("redirect_uri") || "";
  const state = q.get("state");
  if (!clientId || !redirectUri) return errorPage("That link didn't work", "The connection link is missing its assistant or its return address.");
  // Every problem with the request is answered with a page here, never a redirect: even a "standard" error
  // redirect is only safe once the redirect is known good, and a page is always safe.
  if (q.get("response_type") !== "code") return errorPage("That link didn't work", "This connection link asks for something Planyr doesn't offer.");
  const challenge = q.get("code_challenge") || "";
  if (q.get("code_challenge_method") !== "S256" || !CHALLENGE_RE.test(challenge)) {
    return errorPage("That link didn't work", "This assistant didn't use the secure sign-in check Planyr requires (PKCE with S256).");
  }
  const scope = q.get("scope");
  if (scope && !scope.split(/\s+/).filter(Boolean).every((s) => s === SCOPE)) {
    return errorPage("That link didn't work", "This assistant asked for more than read-only access, which Planyr doesn't offer.");
  }
  let out;
  try {
    out = await rpc(env, "mcp_oauth_begin", { p_client_id: clientId, p_redirect_uri: redirectUri, p_state: state, p_code_challenge: challenge, p_scope: SCOPE }, fetchImpl);
  } catch (e) {
    console.log(JSON.stringify({ evt: "mcp-authorize", ok: false, error: String(e?.message || e).slice(0, 200) }));
    return errorPage("Planyr couldn't start the connection", "Something went wrong on our side. Please try again in a minute.", 503);
  }
  if (!out?.ok && out?.reason === "client") return errorPage("Unknown assistant", "Planyr doesn't recognise the assistant that sent you here. Remove the connector and add it again.");
  if (!out?.ok && out?.reason === "redirect") return errorPage("That link didn't work", "The return address in this link doesn't match the one the assistant registered, so Planyr won't send you there.");
  if (!out?.ok || !out.request_id) return errorPage("That link didn't work", "Planyr couldn't read this connection request.");
  return new Response(null, { status: 302, headers: { location: `/#/connect/${out.request_id}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export const onRequest = (context) => handleAuthorize({ env: context.env, request: context.request });
