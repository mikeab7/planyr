/* NEW-1 — the browser half of "Planyr emails you a link": ask the route to send one, and later turn the link's
 * token into a session. The ONLY places the browser talks to /api/auth/email-link and calls verifyOtp.
 *
 * requestEmailLink never throws and never reports a send it did not confirm: the route's { ok:true } is the
 * only success, and a network failure is its own reason ("network") so the panel can say nothing went out.
 * verifyAuthLink is called ONLY from the landing page's button press (a mail scanner that merely opens the
 * link never reaches it). */
import { supabase } from "./supabase.js";
import { classifyVerifyFailure } from "../../../shared/auth/authLink.js";
// NEW-1 (sign-in alarm): every auth path reports its outcome through ONE helper — authTelemetry.js.
import { observeAuthCall } from "../../../shared/auth/authTelemetry.js";

const ENDPOINT = "/api/auth/email-link";
const LAST_EMAIL_KEY = "planyr:auth:lastLinkEmail";

/* The route's outcome as the error shape the alarm's classifier already understands. A throttle or a bad address is the
 * person's (counted, never an alarm); a network failure is auth-network; a down / failing route is auth-unexpected + its status. */
function outcomeAsAuthError(r) {
  if (r.ok) return null;
  if (r.reason === "throttled") return { code: "over_email_send_rate_limit", status: 429, message: "email link throttled" };
  if (r.reason === "bad_request") return { code: "validation_failed", status: 400, message: "email link: bad address" };
  if (r.reason === "network") return { name: "AuthRetryableFetchError", status: 0, message: "email link: network" };
  return { code: String(r.reason || "unavailable"), status: r.status || 503, message: "email link: " + String(r.reason || "unavailable") };
}

/** → { ok:true, retryAfterSeconds, expiresMinutes } | { ok:false, reason, retryAfterSeconds? } — reported once through observeAuthCall("email-link"). */
export async function requestEmailLink({ email, purpose, next, fetchImpl = (typeof fetch === "function" ? fetch : null) }) {
  let out = { ok: false, reason: "network" };
  await observeAuthCall("email-link", email, async () => { out = await sendEmailLinkRequest({ email, purpose, next, fetchImpl }); return { error: outcomeAsAuthError(out) }; });
  return out;
}

async function sendEmailLinkRequest({ email, purpose, next, fetchImpl }) {
  if (!fetchImpl) return { ok: false, reason: "network" };
  let res;
  try {
    res = await fetchImpl(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: String(email || "").trim(), purpose, ...(next ? { next } : {}) }) });
  } catch (_) { return { ok: false, reason: "network" }; }
  let j = null; try { j = await res.json(); } catch (_) { /* not JSON — e.g. the route does not exist (404 HTML) */ }
  if (res.ok && j && j.ok === true) {
    rememberLinkEmail(email);
    return { ok: true, retryAfterSeconds: Number(j.retryAfterSeconds) || 60, expiresMinutes: Number(j.expiresMinutes) || 60 };
  }
  if (j && typeof j.reason === "string") return { ok: false, reason: j.reason, status: res.status, ...(j.retryAfterSeconds ? { retryAfterSeconds: Number(j.retryAfterSeconds) } : {}) };
  return { ok: false, reason: res.status >= 500 || res.status === 404 ? "unavailable" : "network", status: res.status };
}

/** Spend the link: → { ok:true, user, accessToken } | { ok:false, kind: "expired"|"rate"|"network"|"other" } */
export async function verifyAuthLink({ token, kind }) {
  if (!supabase) return { ok: false, kind: "other" };
  try {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type: kind === "reset" ? "recovery" : "magiclink" });
    if (error) return { ok: false, kind: classifyVerifyFailure(error) };
    const user = data && data.user;
    if (!user || !(data && data.session)) return { ok: false, kind: "other" };
    return { ok: true, user, accessToken: data.session.access_token };
  } catch (e) { return { ok: false, kind: classifyVerifyFailure(e) }; }
}

/* The address typed on THIS device, so "Send a new one" can pre-fill it on the page the link opens — without
 * the address ever being in the link. A different device simply has none and shows an empty field. */
export function rememberLinkEmail(email) { try { localStorage.setItem(LAST_EMAIL_KEY, String(email || "").trim().toLowerCase()); } catch (_) { /* blocked */ } }
export function recallLinkEmail() { try { return localStorage.getItem(LAST_EMAIL_KEY) || ""; } catch (_) { return ""; } }

/* Right after an emailed link is redeemed, tell the server so the mailbox is recorded as proven (public.prove_mailbox — service
 * role only, so a server must write it; functions/api/auth/mailbox-proof.js checks the session really came from an emailed token).
 * → { ok:true } | { ok:false, reason }. Never throws; the caller reports a failure to telemetry and never blocks the sign-in on it. */
export async function recordMailboxProof(accessToken, fetchImpl = (typeof fetch === "function" ? fetch : null)) {
  if (!accessToken || !fetchImpl) return { ok: false, reason: "no_session" };
  try {
    const res = await fetchImpl("/api/auth/mailbox-proof", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: "{}" });
    let j = null; try { j = await res.json(); } catch (_) { /* not JSON */ }
    if (res.ok && j && j.ok === true) return { ok: true };
    return { ok: false, reason: (j && typeof j.reason === "string" && j.reason) || `http_${res.status}` };
  } catch (_) { return { ok: false, reason: "network" }; }
}
