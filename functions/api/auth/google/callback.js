/* GET /api/auth/google/callback — finish consent, reveal the refresh token (B207).
 *
 * Google redirects here with `?code=…` after the owner approves. We exchange it for tokens
 * and show the refresh token ONCE so the owner can paste it into the deploy env as
 * GOOGLE_REFRESH_TOKEN. After that this route is no longer needed (the backend uses the
 * stored refresh token). A one-time owner bootstrap on an Internal app — only org users
 * can reach a successful consent.
 *
 * The refresh token is shown only to the just-authenticated owner in their own browser and
 * is never logged or stored server-side here — the owner moves it into the encrypted env.
 */
import { exchangeCodeForTokens } from "../../../../server/oauth/googleAuth.js";

// HTML-escape any interpolated value (the refresh token, Google's error strings) so a stray
// character can never break out of the markup (B491 hardening — defense in depth on the one
// page that renders a secret).
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const page = (title, bodyHtml) =>
  new Response(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)}</title><body style="font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#2c2a26;line-height:1.5">${bodyHtml}</body>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        // This page can render the refresh token — never let an intermediary/browser cache it,
        // and never leak the URL (which may carry the OAuth code) to a third party via Referer.
        "cache-control": "no-store, max-age=0",
        "referrer-policy": "no-referrer",
      },
      status: 200,
    },
  );

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  if (err) return page("Consent cancelled", `<h2>Consent was cancelled</h2><p>Google returned: <code>${esc(err)}</code>. You can close this tab and try again.</p>`);
  const code = url.searchParams.get("code");
  if (!code) return page("Missing code", `<h2>Missing authorization code</h2><p>Open <code>/api/auth/google/start</code> to begin.</p>`);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response("Google client id/secret not configured in the deploy env.", { status: 503 });
  }

  const r = await exchangeCodeForTokens({
    code, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, origin: url.origin,
  });
  if (!r.ok) return page("Token exchange failed", `<h2>Couldn't complete sign-in</h2><p>${esc(r.error)}</p>`);
  if (!r.refreshToken) {
    return page("No refresh token returned", `<h2>No refresh token</h2><p>Google didn't return a refresh token — this usually means consent was previously granted. Revoke Planyr's access at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>, then run <code>/api/auth/google/start</code> again.</p>`);
  }
  return page("Drive connected — copy your refresh token", `
    <h2>✅ Drive consent complete</h2>
    <p><b>Copy this refresh token</b> and add it to the Planyr deploy's environment as
    <code>GOOGLE_REFRESH_TOKEN</code> (encrypted, server-side — never the frontend), then set
    <code>PLANYR_STORAGE_BACKEND=drive</code>. After that, redeploy and this page is no longer needed.</p>
    <textarea readonly rows="4" style="width:100%;font-family:ui-monospace,monospace;font-size:13px;padding:8px;border:1px solid #d8d3c7;border-radius:8px" onclick="this.select()">${esc(r.refreshToken)}</textarea>
    <p style="color:#6b6557;font-size:13px">For your security, don't paste this into a chat — put it straight into the deploy env. You can revoke it anytime at myaccount.google.com/permissions.</p>
  `);
}
