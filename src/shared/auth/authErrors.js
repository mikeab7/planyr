/* ONE place that turns an auth failure into words a person can act on (NEW-1, follow-up to B2619760).
 *
 * `auth.js` runs EVERY error from Supabase Auth (GoTrue) through `friendlyAuthError`, so no mode —
 * sign in, sign up, forgot password, set a new password, Settings, sign out everywhere — can show
 * the server's own text. The raw string is "Failed to fetch", "User already registered",
 * "Auth session missing!", "Database error saving new user"… none of which tells anyone what to do.
 *
 * `classifyAuthError` reads the STRUCTURED parts first (`error.code` / `error_code`, then `status`,
 * then `name`) and falls back to the message only for the two shapes that never carry a code: a
 * browser network failure and the signup rate-limit trigger. Every kind has copy that ENDS in a next
 * step; the default for an unknown error is a plain sentence plus support@planyr.io — never the raw
 * string. `AUTH_ERROR_KINDS` is the complete table, so the test can prove that no raw string in it
 * can render.
 *
 * Pure and dependency-light (it is in the entry chunk every route downloads). */
import { isCaptchaError, CAPTCHA_FAILED_COPY } from "../turnstile/captchaCopy.js";
import { SIGNUP_RATE_LIMIT_MESSAGE_FRAGMENT } from "./rateLimitCopy.js";

export const SUPPORT_EMAIL = "support@planyr.io";
export const MIN_PASSWORD_LENGTH = 6;

/** kind → { text, action? }. `action` names the one-tap next step the panel can offer. */
export const AUTH_ERROR_KINDS = {
  captcha:             { text: CAPTCHA_FAILED_COPY },
  network:             { text: "We couldn't reach Planyr. Check your connection, then try again.", action: "retry" },
  rate_limit:          { text: "Too many attempts from this connection. Wait a minute and try again — a shared office network can trigger this." },
  email_rate_limit:    { text: "We've sent several emails to this address recently. Wait a few minutes (check spam for the ones already sent), then try again." },
  signup_rate_limit:   { text: `Too many accounts were created from this connection recently. Wait a while and try again, or email ${SUPPORT_EMAIL}.` },
  user_exists:         { text: "An account with that email already exists.", action: "signin" },
  invalid_credentials: { text: "That email and password don't match.", action: "reset" },
  email_not_confirmed: { text: "Confirm your email first. Open the link we sent you, then sign in." },
  weak_password:       { text: `That password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters and avoid common passwords.` },
  same_password:       { text: "Choose a password different from your current one." },
  invalid_email:       { text: "That email address doesn't look right. Check it and try again." },
  signup_disabled:     { text: `New accounts can't be created right now. Try again later, or email ${SUPPORT_EMAIL}.` },
  user_banned:         { text: `This account is unavailable. Email ${SUPPORT_EMAIL} and we'll sort it out.` },
  session_missing:     { text: "Your sign-in expired. Sign in again, then try once more." },
  link_expired:        { text: "That link has expired. Send yourself a new one.", action: "newlink" },
  unknown:             { text: `Something went wrong on our end. Try again, and if it keeps happening email ${SUPPORT_EMAIL}.` },
};

const BY_CODE = {
  captcha_failed: "captcha",
  over_request_rate_limit: "rate_limit",
  over_email_send_rate_limit: "email_rate_limit",
  over_sms_send_rate_limit: "email_rate_limit",
  user_already_exists: "user_exists",
  email_exists: "user_exists",
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  weak_password: "weak_password",
  same_password: "same_password",
  validation_failed: "invalid_email",
  email_address_invalid: "invalid_email",
  signup_disabled: "signup_disabled",
  email_provider_disabled: "signup_disabled",
  user_banned: "user_banned",
  session_not_found: "session_missing",
  session_expired: "session_missing",
  refresh_token_not_found: "session_missing",
  refresh_token_already_used: "session_missing",
  bad_jwt: "session_missing",
  otp_expired: "link_expired",
  flow_state_expired: "link_expired",
  flow_state_not_found: "link_expired",
};

const NETWORK_TEXT = /failed to fetch|load failed|networkerror|network request failed|network error|fetch failed|the internet connection appears to be offline|timed out|econn|enotfound/i;

/** The kind of an auth failure, from whatever shape arrives (an AuthError, a plain object or a string). */
export function classifyAuthError(err) {
  if (!err) return null;
  if (isCaptchaError(err)) return "captcha";
  const o = typeof err === "object" ? err : {};
  const text = typeof err === "string" ? err : String(o.message || o.msg || "");
  const code = String(o.code || o.error_code || "");
  if (BY_CODE[code]) return BY_CODE[code];
  if (text.includes(SIGNUP_RATE_LIMIT_MESSAGE_FRAGMENT)) return "signup_rate_limit";
  const name = String(o.name || "");
  if (name === "AuthRetryableFetchError" || NETWORK_TEXT.test(text)) return "network";
  if (name === "AuthSessionMissingError" || /auth session missing/i.test(text)) return "session_missing";
  const status = Number(o.status || 0);
  if (status === 429) return "rate_limit";
  if (status === 0 && name && /fetch/i.test(name)) return "network";
  if (status >= 502 && status <= 504) return "network";
  if (/user already registered/i.test(text)) return "user_exists";
  if (/invalid login credentials/i.test(text)) return "invalid_credentials";
  if (/email not confirmed/i.test(text)) return "email_not_confirmed";
  if (/new password should be different/i.test(text)) return "same_password";
  if (/password should be at least|password is known to be weak/i.test(text)) return "weak_password";
  if (/unable to validate email|invalid format/i.test(text)) return "invalid_email";
  return "unknown";
}

/** The panel's one-tap action for an error kind, or null. */
export function authErrorAction(kind) { return (kind && AUTH_ERROR_KINDS[kind] && AUTH_ERROR_KINDS[kind].action) || null; }

/** The text to show for an auth error. NEVER the server's own string. null when there is no error. */
export function friendlyAuthError(err) {
  const kind = classifyAuthError(err);
  return kind ? AUTH_ERROR_KINDS[kind].text : null;
}

/** For `session_missing` in a place where the person is completing a reset link, the honest words are about the link. */
export function recoveryErrorText(kind) {
  return kind === "session_missing" ? AUTH_ERROR_KINDS.link_expired.text : AUTH_ERROR_KINDS[kind || "unknown"].text;
}

/** Client-side validation messages (shown at submit instead of disabling the button). */
export const FIELD_COPY = {
  email: "Enter your email address.",
  emailShape: "That email address doesn't look right. Check it and try again.",
  password: "Enter your password.",
  newPassword: "Enter a new password.",
  passwordShort: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
  names: "First and last name are required.",
};

export function validateAuthFields({ mode, email, pw, first, last }) {
  if (mode !== "recovery") {
    if (!String(email || "").trim()) return FIELD_COPY.email;
    if (!/^[^\s@]+@[^\s@]+$/.test(String(email).trim())) return FIELD_COPY.emailShape;
  }
  if (mode === "signup" && (!String(first || "").trim() || !String(last || "").trim())) return FIELD_COPY.names;
  if (mode === "signin" && !pw) return FIELD_COPY.password;
  if (mode === "signup" && String(pw || "").length < MIN_PASSWORD_LENGTH) return FIELD_COPY.passwordShort;
  if (mode === "recovery") {
    if (!pw) return FIELD_COPY.newPassword;
    if (String(pw).length < MIN_PASSWORD_LENGTH) return FIELD_COPY.passwordShort;
  }
  return null;
}
