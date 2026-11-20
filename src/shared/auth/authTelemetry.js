/* Auth telemetry — ONE helper every sign-in / sign-up / forgot-password / email-link code path reports through
 * (NEW-1, 2026-11-02, after B2619760: sign-in was dead for every signed-out person for days and nothing noticed).
 *
 * Events travel through `reportClientEvent` → `public.client_errors` (insert-only, writable signed out — that is the
 * point: an auth failure happens BEFORE any session exists). Source = `event:<kind>`; the alarm route counts them per
 * hour (`src/shared/auth/signinHealth.js` → `summariseEvents`). Only `auth-captcha-refused` can alarm, and only past a
 * floor; every other kind is a COUNT the daily sweep reads. Wrong passwords never alarm.
 *
 *   auth-ok                  a gated call (sign in / sign up / reset) went through — the denominator for a failure rate
 *   auth-captcha-refused     the SERVER (Supabase) refused for a missing / spent / rejected bot-check token
 *   auth-captcha-blocked     the bot-check script never loaded (blocked by an extension / network / DNS)
 *   auth-captcha-widget-error  Cloudflare's widget reported an error (extra.code = its error code)
 *   auth-captcha-timeout     the script or an interactive challenge timed out
 *   auth-network             the sign-in request never reached Supabase
 *   auth-wrong-password      invalid credentials — counted, never an alarm
 *   auth-user-error          other person-side outcomes (unconfirmed email, rate limit, banned…) — counted, never an alarm
 *   auth-unexpected          anything else Supabase returned
 *
 * ⛔ PRIVACY: a password is never an argument anywhere here. An email is never sent — only its DOMAIN, as the existing
 * `signup-rate-limited` event does. `extra` is allow-listed (mode, domain, code, reason, status), so a caller cannot
 * leak a field by accident.
 *
 * ⛔ A NEW AUTH CALL REPORTS THROUGH `observeAuthCall(mode, email, () => supabase.auth.X(...))` — not its own
 * `reportClientEvent`. (`test/authCallsCaptchaGate.test.js` is the sibling guard for "carries a bot-check token".) */
import { reportClientEvent } from "../telemetry/clientErrors.js";
import { isCaptchaError } from "../turnstile/captchaCopy.js";
import { SIGNUP_RATE_LIMIT_MESSAGE_FRAGMENT } from "./rateLimitCopy.js";

export const AUTH_EVENT = Object.freeze({
  OK: "auth-ok",
  CAPTCHA_REFUSED: "auth-captcha-refused",
  CAPTCHA_BLOCKED: "auth-captcha-blocked",
  CAPTCHA_WIDGET_ERROR: "auth-captcha-widget-error",
  CAPTCHA_TIMEOUT: "auth-captcha-timeout",
  NETWORK: "auth-network",
  WRONG_PASSWORD: "auth-wrong-password",
  USER_ERROR: "auth-user-error",
  UNEXPECTED: "auth-unexpected",
  // The sign-in PANEL itself (NEW-1, 2026-11-08) — counts, never an alarm. `vanished`: it unmounted while signed out with
  // nobody asking (a defect). `restored`: a forced reload took the page and the panel came back with the typed email.
  // `escape`: the person's Escape closed it (reason = whether an email had been typed — the only way to tell a deliberate
  // Escape from one aimed at a password manager's menu).
  PANEL_VANISHED: "auth-panel-vanished",
  PANEL_RESTORED: "auth-panel-restored",
  PANEL_ESCAPE: "auth-panel-escape",
});

/* Outcomes that belong to the person, not to the system: counted, never an alarm. */
const USER_CODES = new Set([
  "email_not_confirmed", "user_banned", "over_request_rate_limit", "over_email_send_rate_limit", "over_sms_send_rate_limit",
  "signup_disabled", "user_already_exists", "email_exists", "weak_password", "same_password", "validation_failed",
  "email_address_invalid", "email_address_not_authorized", "user_not_found", "reauthentication_needed",
]);
/* Person-side wording older / string-only errors carry without a code (signUp's wrapper stringifies). */
const USER_TEXT = /password should be|user already registered|already been registered|unable to validate email|email not confirmed|email rate limit|for security purposes, you can only request|signups? not allowed|invalid email|rate limit/i;
const NETWORK_TEXT = /failed to fetch|networkerror|load failed|network request failed|fetch failed|network error|err_internet|timed out/i;

const text = (err) => (typeof err === "string" ? err : String((err && err.message) || ""));
const codeOf = (err) => (err && typeof err === "object" ? String(err.code || err.error_code || "").toLowerCase() : "");

/** Raw auth error (an AuthError, a thrown Error, or a string) → the event kind. `null`/undefined → auth-ok. Pure. */
export function classifyAuthError(err) {
  if (!err) return AUTH_EVENT.OK;
  if (isCaptchaError(err)) return AUTH_EVENT.CAPTCHA_REFUSED;
  const code = codeOf(err);
  const t = text(err);
  if (code === "invalid_credentials" || /invalid login credentials/i.test(t)) return AUTH_EVENT.WRONG_PASSWORD;
  if (USER_CODES.has(code) || t.includes(SIGNUP_RATE_LIMIT_MESSAGE_FRAGMENT) || USER_TEXT.test(t)) return AUTH_EVENT.USER_ERROR;
  const status = err && typeof err === "object" && Number.isFinite(err.status) ? err.status : null;
  if ((err && err.name === "AuthRetryableFetchError") || status === 0 || NETWORK_TEXT.test(t)) return AUTH_EVENT.NETWORK;
  return AUTH_EVENT.UNEXPECTED;
}

export const emailDomain = (email) => (String(email || "").split("@")[1] || "").trim().toLowerCase().slice(0, 120);

const ALLOWED_EXTRA = ["mode", "domain", "code", "reason", "status"];
/** Keep only the allow-listed, short, primitive fields. Never throws. */
export function cleanExtra(extra) {
  const out = {};
  if (!extra || typeof extra !== "object") return out;
  for (const k of ALLOWED_EXTRA) {
    const v = extra[k];
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number") out[k] = typeof v === "string" ? v.slice(0, 80) : v;
  }
  return out;
}

/** Report one auth event. Fire-and-forget; never throws (reportClientEvent is already fail-safe). */
export function reportAuthEvent(kind, extra) {
  try { return reportClientEvent(kind, `auth ${kind.replace(/^auth-/, "")}`, cleanExtra(extra)); } catch (_) { return null; }
}

/** Report the outcome of one gated auth call. `err` is the RAW error (classify before it becomes a display string). */
export function reportAuthOutcome(mode, err, email) {
  try {
    const kind = classifyAuthError(err);
    const extra = { mode, domain: emailDomain(email) };
    const code = codeOf(err);
    if (kind !== AUTH_EVENT.OK && code) extra.code = code;
    const status = err && typeof err === "object" && Number.isFinite(err.status) ? err.status : null;
    if (kind === AUTH_EVENT.UNEXPECTED && status != null) extra.status = status;
    return reportAuthEvent(kind, extra);
  } catch (_) { return null; }
}

/**
 * Wrap ONE supabase-js auth call: `await observeAuthCall("signin", email, () => supabase.auth.signInWithPassword(creds))`.
 * Returns the call's own result untouched (so callers keep reading `{ data, error }`); a THROWN error is reported and
 * rethrown unchanged.
 */
export async function observeAuthCall(mode, email, call) {
  let res;
  try { res = await call(); } catch (e) { reportAuthOutcome(mode, e, email); throw e; }
  reportAuthOutcome(mode, res && res.error, email);
  return res;
}
