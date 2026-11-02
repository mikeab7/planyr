/* POST /api/auth/email-link — Planyr mails an EXISTING account's own inbox a one-time link (NEW-1).
 *   body { email, purpose: "reset" | "signin", next? }   →   200 { ok:true, retryAfterSeconds, expiresMinutes }
 *
 * WHY IT EXISTS. Supabase's built-in mailer allows 2 emails an hour for the WHOLE project, sends as "Supabase
 * Auth", cannot be given a scanner-safe link without custom SMTP, and sits behind a Turnstile check that a
 * corporate network can block outright. So Forgot password and "email me a sign-in link" go through here:
 * the link is made with Supabase's admin generate_link, the mail goes out through the Google Workspace
 * mailbox Planyr already sends invites from (lib/gmailSend.js), as no-reply@planyr.io.
 *
 * WHY IT MAY SKIP TURNSTILE (the reasoning the brief asked to have written down). The captcha exists to stop
 * a bot GUESSING PASSWORDS and to stop mass sign-ups; password sign-in and sign-up stay behind it. This
 * route guesses nothing and creates nothing: it only ever mails the link to the inbox that already belongs to
 * the account, so a stranger who calls it learns nothing and gains nothing — the one thing they could do is
 * make an inbox fill up, and that is what the caps are for: 60 s between mails to one address, 3 an hour per
 * address, 10 an hour per IP, 60 an hour for the whole project (public.claim_auth_email_link — one function,
 * one lock, so concurrent requests cannot slip under). THE CAPS FAIL CLOSED: if the cap store errors the
 * route refuses (503) and logs; it never sends unlimited mail.
 *
 * SECURITY INVARIANTS — do not loosen without re-reading the threat model in the PR:
 *   1. POST only; NO CORS headers on any response; a request whose Origin is another website is refused.
 *   2. EXISTING ACCOUNTS ONLY. The address is looked up (inside the claim) BEFORE any link is made. generate_link
 *      is never called for an unknown address, because type "magiclink" on an unknown address CREATES the
 *      account. The link it returns must be for the very user the lookup found, or nothing is mailed.
 *   3. THE REPLY NEVER REVEALS WHETHER AN ACCOUNT EXISTS: an unknown address gets the same status and body
 *      as a known one (and waits a jittered moment, so the timing is similar). Honest limit: sign-up with this
 *      project's settings can already tell a person that an address is registered, so this is not the only
 *      such door — it just must not add a new one.
 *   4. The token, the link, the service-role key and Gmail's detail never reach the browser or the log. The log
 *      holds outcomes only. The address and the IP are stored only as keyed hashes (HMAC, server secret).
 *   5. A mail that did not go out is never reported as sent, and its cap allowance is given back.
 * Logic lives in handleEmailLink(request, env, deps) so it is unit-tested with a fake fetch and a fake mailer. */
import { buildAuthLinkUrl, LINK_VALID_MINUTES } from "../../../src/shared/auth/authLink.js";
import { buildAuthEmail } from "../lib/authEmail.js";
import { sendViaGmail } from "../lib/gmailSend.js";

export const FROM_DEFAULT = "no-reply@planyr.io";
export const REPLY_TO_DEFAULT = "support@planyr.io";
const MAX_BODY = 2048;
const EMAIL_RE = /^[^\s@<>()\[\],;:"\\]+@[^\s@<>()\[\],;:"\\]+\.[A-Za-z]{2,}$/;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

const enc = new TextEncoder();
/* Keyed hash (hex) used for the cap table's keys — a stored value can neither be read back as an address/IP
 * nor be recomputed without the server's secret. */
export async function hmacKey(secret, value) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(String(value))));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const log = (evt, request) => {
  // Outcome and where it came from — never an address, token, key or IP.
  try { console.log(JSON.stringify({ evt: "email-link", ...evt, ts: new Date().toISOString() })); } catch (_) { /* logging must never break the route */ }
};

function originAllowed(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from some browsers, curl, server-side callers: no browser cross-site risk
  let host; try { host = new URL(origin).host; } catch (_) { return false; }
  let own = ""; try { own = new URL(request.url).host; } catch (_) { /* ignore */ }
  let app = ""; try { app = new URL(env.PUBLIC_APP_URL || "https://planyr.io").host; } catch (_) { /* ignore */ }
  return host === own || host === app || host === "planyr.io" || host === "www.planyr.io" || host === "planyr.pages.dev" || host.endsWith(".planyr.pages.dev");
}

async function postJson(doFetch, url, headers, body) {
  try {
    const res = await doFetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    let json = null; try { json = await res.json(); } catch (_) { /* empty body */ }
    return { ok: res.ok, status: res.status, body: json };
  } catch (e) {
    return { ok: false, status: 0, body: null, netError: (e && e.name) || "Error" };
  }
}

export async function handleEmailLink(request, env, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const send = deps.send || ((m) => sendViaGmail(m));
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const random = deps.random || Math.random;

  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
  if (!originAllowed(request, env || {})) { log({ ok: false, reason: "origin" }, request); return reply(403, { ok: false, reason: "forbidden" }); }

  let input;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(400, { ok: false, reason: "bad_request" });
    input = JSON.parse(raw);
  } catch (_) { return reply(400, { ok: false, reason: "bad_request" }); }
  const email = input && typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const purpose = input && input.purpose;
  if (!email || email.length > 254 || !EMAIL_RE.test(email) || (purpose !== "reset" && purpose !== "signin")) return reply(400, { ok: false, reason: "bad_request" });

  const e = env || {};
  const base = String(e.SUPABASE_URL || "").replace(/\/+$/, "");
  const service = e.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !service || !e.GMAIL_SERVICE_ACCOUNT_JSON || !e.INVITE_SENDER) { log({ ok: false, reason: "not-configured" }, request); return reply(503, { ok: false, reason: "not_configured" }); }
  const svc = { apikey: service, authorization: `Bearer ${service}` };

  // 1) CLAIM: caps checked and recorded, and the account looked up, in one locked database function.
  let claim;
  try {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const [emailKey, ipKey] = await Promise.all([hmacKey(service, "email:" + email), hmacKey(service, "ip:" + ip)]);
    const r = await postJson(doFetch, `${base}/rest/v1/rpc/claim_auth_email_link`, svc, { p_email: email, p_email_key: emailKey, p_ip_key: ipKey, p_purpose: purpose });
    claim = r.ok ? r.body : null;
    if (!claim || typeof claim.ok !== "boolean" || (claim.ok && typeof claim.claim_id !== "number")) { log({ ok: false, reason: "claim-failed", status: r.status, net: r.netError }, request); return reply(503, { ok: false, reason: "unavailable" }); }
  } catch (_) { log({ ok: false, reason: "claim-failed", status: "exception" }, request); return reply(503, { ok: false, reason: "unavailable" }); }

  if (!claim.ok) {
    log({ ok: false, reason: "throttled:" + String(claim.reason || "?") }, request);
    return reply(429, { ok: false, reason: "throttled", retryAfterSeconds: Math.max(1, Math.round(Number(claim.retry_after_seconds) || 60)) });
  }
  const success = reply.bind(null, 200, { ok: true, retryAfterSeconds: Math.round(Number(claim.cooldown_seconds) || 60), expiresMinutes: LINK_VALID_MINUTES });
  const release = () => postJson(doFetch, `${base}/rest/v1/rpc/release_auth_email_link`, svc, { p_claim_id: claim.claim_id }).catch(() => null);

  // 2) NO SUCH ACCOUNT: look the same, wait about as long as a real send would, create and send nothing.
  if (!claim.user_id) {
    await sleep(500 + Math.floor(random() * 600));
    log({ ok: true, reason: "no-account" }, request);
    return success();
  }

  // 3) THE LINK, for the account the lookup found.
  const gen = await postJson(doFetch, `${base}/auth/v1/admin/generate_link`, svc, { type: purpose === "reset" ? "recovery" : "magiclink", email });
  const g = gen.body;
  const token = g && (g.hashed_token || (g.properties && g.properties.hashed_token));
  if (!gen.ok || !token) { await release(); log({ ok: false, reason: "generate-link", status: gen.status }, request); return reply(502, { ok: false, reason: "link_failed" }); }
  if (g.id !== claim.user_id || String(g.email || "").toLowerCase() !== email) { await release(); log({ ok: false, reason: "pin-mismatch" }, request); return reply(502, { ok: false, reason: "link_failed" }); }

  let link, mail;
  try {
    link = await buildAuthLinkUrl({ appUrl: e.PUBLIC_APP_URL, kind: purpose, token, email, next: input.next });
    mail = buildAuthEmail({ kind: purpose, link });
  } catch (_) { await release(); log({ ok: false, reason: "build" }, request); return reply(502, { ok: false, reason: "link_failed" }); }

  // 4) THE MAIL. Anything but a confirmed send is a failure.
  let sent;
  try {
    sent = await send({ serviceAccountJson: e.GMAIL_SERVICE_ACCOUNT_JSON, sender: e.INVITE_SENDER, fromEmail: e.AUTH_MAIL_FROM || e.INVITE_FROM || FROM_DEFAULT, replyTo: e.INVITE_REPLY_TO || REPLY_TO_DEFAULT, to: email, subject: mail.subject, html: mail.html, text: mail.text, fetchImpl: doFetch });
  } catch (_) { sent = { ok: false }; }
  if (!sent || !sent.ok) { await release(); log({ ok: false, reason: "send-failed" }, request); return reply(502, { ok: false, reason: "send_failed" }); }

  log({ ok: true, reason: "sent", purpose }, request);
  return success();
}

export const onRequest = (context) => handleEmailLink(context.request, context.env);
