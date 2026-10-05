/* Send one email through the Gmail API as a Google Workspace user, authenticated by a service
 * account with domain-wide delegation (NEW-1 provider layer — replaces the dropped Resend step:
 * no new account, no new paid seat; planyr.io is already on Google Workspace).
 *
 * Flow: sign a short-lived RS256 JWT with the service account's private key (WebCrypto — works in
 * Cloudflare Workers and Node), exchange it at Google's token endpoint with `sub` = the mailbox to
 * send as, then POST the RFC 2822 message to gmail.users.messages.send. Network is injected so
 * test/teamInviteEmail.test.js drives it with fakes. The key never leaves the server.
 *
 * Env (Cloudflare Pages): GMAIL_SERVICE_ACCOUNT_JSON (secret — the service-account key file's
 * contents) · INVITE_SENDER (the planyr.io mailbox to send as; a plain variable).
 */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const SCOPE = "https://www.googleapis.com/auth/gmail.send";

const enc = new TextEncoder();
const b64urlBytes = (bytes) => {
  let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlStr = (str) => b64urlBytes(enc.encode(str));
const b64wrapped = (str) => { const b = btoa(String.fromCharCode(...enc.encode(str))); return (b.match(/.{1,76}/g) || [""]).join("\r\n"); };
const oneLine = (s) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").trim(); // header-injection guard

export function parseServiceAccount(raw) {
  let j; try { j = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (_) { return null; }
  if (!j || !j.client_email || !j.private_key) return null;
  return { clientEmail: j.client_email, privateKey: j.private_key };
}

async function importKey(pem) {
  const body = String(pem).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export async function signJwt({ clientEmail, privateKey }, sub, nowSec) {
  const head = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlStr(JSON.stringify({ iss: clientEmail, sub, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }));
  const key = await importKey(privateKey);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${head}.${claims}`)));
  return `${head}.${claims}.${b64urlBytes(sig)}`;
}

// RFC 2822 multipart/alternative (text + html), UTF-8 throughout.
export function buildMime({ from, to, subject, text, html, boundary = "planyr-" + Math.random().toString(36).slice(2) }) {
  return [
    `From: ${oneLine(from)}`,
    `To: ${oneLine(to)}`,
    `Subject: =?UTF-8?B?${btoa(String.fromCharCode(...enc.encode(oneLine(subject))))}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64wrapped(text),
    `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64wrapped(html),
    `--${boundary}--`, "",
  ].join("\r\n");
}

const tokenCache = new Map(); // sender -> { token, exp } (per isolate; tokens last an hour)

/* Returns { ok:true } or { ok:false, error }. Never throws. */
export async function sendViaGmail({ serviceAccountJson, sender, to, subject, html, text, fromName = "Planyr", fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000) }) {
  const sa = parseServiceAccount(serviceAccountJson);
  if (!sa) return { ok: false, error: "GMAIL_SERVICE_ACCOUNT_JSON is not a valid service-account key." };
  try {
    let tok = tokenCache.get(sender);
    if (!tok || tok.exp - 60 < now()) {
      const jwt = await signJwt(sa, sender, now());
      const tr = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString(),
      });
      if (!tr.ok) {
        let d = ""; try { d = (await tr.text()).slice(0, 200); } catch (_) { /* ignore */ }
        return { ok: false, error: `Google refused the service-account sign-in (${tr.status}). ${d}`.trim() };
      }
      const tj = await tr.json();
      tok = { token: tj.access_token, exp: now() + (tj.expires_in || 3600) };
      tokenCache.set(sender, tok);
    }
    const raw = b64urlStr(buildMime({ from: `${fromName} <${sender}>`, to, subject, text, html }));
    const res = await fetchImpl(SEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${tok.token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      if (res.status === 401) tokenCache.delete(sender);
      let d = ""; try { d = (await res.text()).slice(0, 200); } catch (_) { /* ignore */ }
      return { ok: false, error: `Gmail refused the send (${res.status}). ${d}`.trim() };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Gmail send failed: ${e && e.message ? e.message : e}` };
  }
}
