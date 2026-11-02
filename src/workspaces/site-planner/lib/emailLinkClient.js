/* NEW-1 — the browser half of "Planyr emails you a link": ask the route to send one, and later turn the link's
 * token into a session. The ONLY places the browser talks to /api/auth/email-link and calls verifyOtp.
 *
 * requestEmailLink never throws and never reports a send it did not confirm: the route's { ok:true } is the
 * only success, and a network failure is its own reason ("network") so the panel can say nothing went out.
 * verifyAuthLink is called ONLY from the landing page's button press (a mail scanner that merely opens the
 * link never reaches it). */
import { supabase } from "./supabase.js";
import { classifyVerifyFailure } from "../../../shared/auth/authLink.js";

const ENDPOINT = "/api/auth/email-link";
const LAST_EMAIL_KEY = "planyr:auth:lastLinkEmail";

/** → { ok:true, retryAfterSeconds, expiresMinutes } | { ok:false, reason, retryAfterSeconds? } */
export async function requestEmailLink({ email, purpose, next, fetchImpl = (typeof fetch === "function" ? fetch : null) }) {
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
  if (j && typeof j.reason === "string") return { ok: false, reason: j.reason, ...(j.retryAfterSeconds ? { retryAfterSeconds: Number(j.retryAfterSeconds) } : {}) };
  return { ok: false, reason: res.status >= 500 || res.status === 404 ? "unavailable" : "network" };
}

/** Spend the link: → { ok:true, user } | { ok:false, kind: "expired"|"rate"|"network"|"other" } */
export async function verifyAuthLink({ token, kind }) {
  if (!supabase) return { ok: false, kind: "other" };
  try {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type: kind === "reset" ? "recovery" : "magiclink" });
    if (error) return { ok: false, kind: classifyVerifyFailure(error) };
    const user = data && data.user;
    if (!user || !(data && data.session)) return { ok: false, kind: "other" };
    return { ok: true, user };
  } catch (e) { return { ok: false, kind: classifyVerifyFailure(e) }; }
}

/* The address typed on THIS device, so "Send a new one" can pre-fill it on the page the link opens — without
 * the address ever being in the link. A different device simply has none and shows an empty field. */
export function rememberLinkEmail(email) { try { localStorage.setItem(LAST_EMAIL_KEY, String(email || "").trim().toLowerCase()); } catch (_) { /* blocked */ } }
export function recallLinkEmail() { try { return localStorage.getItem(LAST_EMAIL_KEY) || ""; } catch (_) { return ""; } }
