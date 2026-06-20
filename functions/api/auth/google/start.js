/* GET /api/auth/google/start — begin the one-time Google consent (B207 Drive wiring).
 *
 * A Cloudflare Pages Function (runs server-side on the planyr.io deploy; reads secrets
 * from the deploy's env, never the client bundle). Redirects the owner to Google's consent
 * screen; after they approve, Google returns to /api/auth/google/callback with a code that
 * the callback turns into the refresh token. One-time bootstrap — only the Workspace owner
 * (Internal app) can complete it.
 */
import { buildConsentUrl } from "../../../../server/oauth/googleAuth.js";

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.GOOGLE_CLIENT_ID) {
    return new Response("Google client id not configured (set GOOGLE_CLIENT_ID in the deploy env).", { status: 503 });
  }
  const origin = new URL(request.url).origin; // same-origin callback (planyr.io)
  const url = buildConsentUrl({ clientId: env.GOOGLE_CLIENT_ID, origin });
  return Response.redirect(url, 302);
}
