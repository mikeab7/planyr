/* Plain words for a captcha refusal (NEW-1, amends B1160720).
 *
 * Supabase Auth (GoTrue) answers a missing / spent / rejected Turnstile token with HTTP 400,
 * `error_code: "captcha_failed"` and a message such as
 *   "captcha protection: request disallowed (no captcha_token found)".
 * That string is jargon the person cannot act on, and it must never reach the screen in ANY
 * mode (sign in, sign up, forgot password). `auth.js` runs every error through
 * `friendlyAuthError` (shared/auth/authErrors.js — which owns the mapping for ALL auth errors since
 * NEW-1 follow-up; this file keeps only the captcha copy and the detector it builds on).
 *
 * The copy deliberately does not contain the word "captcha". */

export const CAPTCHA_FAILED_COPY = "We couldn't verify this browser. Try again.";

/** Shown by the panel when the check itself could not run (blocked script, network, timeout). */
export const CAPTCHA_UNAVAILABLE_COPY = "We couldn't run the browser check. Check your connection, then try again.";

/** True for GoTrue's captcha refusals, whether we hold the AuthError object or only its text. */
export function isCaptchaError(err) {
  if (!err) return false;
  const code = typeof err === "object" ? String(err.code || err.error_code || "") : "";
  if (code === "captcha_failed") return true;
  const text = typeof err === "string" ? err : String((err && err.message) || "");
  return /captcha/i.test(text);
}
