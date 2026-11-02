/* Supabase Auth — PHASE 2: login only (email + password).
 *
 * Thin wrappers around Supabase's BUILT-IN auth — we do NOT implement password
 * hashing, sessions, or any security-critical logic ourselves; Supabase handles
 * all of it. Login is ADDITIVE this phase: it does NOT change how sites are saved
 * or loaded (still 100% localStorage), gate any feature, or attach data to the
 * user. RLS is Phase 3; wiring save/load + migrating sites is Phase 4.
 */
import { supabase } from "./supabase.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { SIGNUP_RATE_LIMIT_MESSAGE_FRAGMENT } from "../../../shared/auth/rateLimitCopy.js";
import { friendlyAuthError, classifyAuthError } from "../../../shared/auth/authErrors.js";
import { markDeliberateSignOut, currentAuthEventMeta } from "../../../shared/auth/sessionIntent.js";
// NEW-1 (B2619760 follow-up): every gated call reports its outcome through ONE helper — see authTelemetry.js.
import { observeAuthCall } from "../../../shared/auth/authTelemetry.js";

// Where Supabase sends the user back after email confirmation / password reset.
// Must be allow-listed in Supabase → Auth → URL Configuration → Redirect URLs.
// Pin to the bare origin root ("https://planyr.io/") rather than the live pathname:
// the app always boots from "/" and reads the auth params client-side, so a stable,
// allow-listed target avoids ever sending the callback to a path the front-door
// redirect (index.html) doesn't special-case.
const redirectTo = (() => {
  try { return window.location.origin + "/"; } catch (_) { return undefined; }
})();

// Every auth error reaches the screen through here (NEW-1, follow-up to B2619760): a captcha refusal, a
// dropped connection ("Failed to fetch"), a rate limit, "User already registered", "Auth session missing!"
// … are turned into plain words with a next step ONCE (shared/auth/authErrors.js), for sign in, sign up,
// forgot password, set a new password, Settings and sign out everywhere — never a copy per mode, and the
// server's own text never reaches the screen. An error that maps to nothing is reported (so it can be
// added to the table) and shown as a plain sentence plus support@planyr.io.
const errMsg = (e) => friendlyAuthError(e);
// `{ error, errorKind }` — the text for the screen and the kind the panel uses to offer a one-tap next step.
function failure(e) {
  if (!e) return { error: null, errorKind: null };
  const errorKind = classifyAuthError(e);
  if (errorKind === "unknown") {
    try { reportClientEvent("auth-error-unmapped", "auth error with no friendly copy", { code: String(e.code || e.error_code || ""), status: e.status || 0, name: String(e.name || ""), msg: String(e.message || e).slice(0, 120) }); } catch (_) { /* telemetry must never break sign-in */ }
  }
  return { error: errMsg(e), errorKind };
}

// `captchaToken` (B1160720, NEW-1) is a Cloudflare Turnstile token, opaque to us — we only
// forward it. Supabase Auth (GoTrue) is the one that verifies it, server-side, against
// Cloudflare's siteverify endpoint using the SECRET key configured in the Supabase
// dashboard (never present in this codebase). Omitted entirely when the caller has none
// (Turnstile unconfigured, or the widget hasn't produced a token yet) rather than sent as
// an empty string — GoTrue treats a present-but-empty captchaToken as a failed challenge
// when captcha protection is enabled, which would wrongly reject a signup from a build
// that never rendered the widget in the first place.
export async function signUp(email, password, profile = {}, captchaToken) {
  if (!supabase) return { error: "Cloud not configured." };
  // First/last/org are stored in Supabase user_metadata (options.data).
  const meta = {};
  if (profile.firstName) meta.first_name = profile.firstName;
  if (profile.lastName) meta.last_name = profile.lastName;
  if (profile.org) meta.org = profile.org;
  const options = { emailRedirectTo: redirectTo, data: meta };
  if (captchaToken) options.captchaToken = captchaToken;
  const { data, error } = await observeAuthCall("signup", email, () => supabase.auth.signUp({ email, password, options }));
  const { error: msg, errorKind } = failure(error);
  // Best-effort visibility only (B1160721, NEW-2) — the Postgres trigger is the real
  // enforcement and cannot be bypassed by skipping this call entirely (a raw API request
  // is still blocked, it just won't show up here); this only makes a BROWSER-DRIVEN block
  // visible after the fact, the same client_errors channel every other silent-failure
  // class in this app already reports through. Domain only, never the full address.
  if (errorKind === "signup_rate_limit") {
    reportClientEvent("signup-rate-limited", "signup blocked by server-side rate limit", {
      domain: (String(email).split("@")[1] || "").toLowerCase(),
    });
  }
  // When email confirmation is on, signUp returns a user but no session yet. `signedIn` is the
  // session actually being present — the panel branches on that, not on a build-time flag.
  return { error: msg, errorKind, needsConfirm: !!(data && data.user && !data.session), signedIn: !!(data && data.session) };
}

// Sign in and Forgot password are captcha-gated server-side exactly like sign-up (NEW-1, amends
// B1160720 — which only wired sign-up, leaving every signed-out user unable to get back in). Same
// omit-when-empty rule as signUp(): a present-but-empty token is a failed challenge to GoTrue.
export async function signIn(email, password, captchaToken) {
  if (!supabase) return { error: "Cloud not configured." };
  const creds = { email, password };
  if (captchaToken) creds.options = { captchaToken };
  const { error } = await observeAuthCall("signin", email, () => supabase.auth.signInWithPassword(creds));
  return failure(error);
}

export async function signOut() {
  if (!supabase) return;
  markDeliberateSignOut();      // the person pressed it: the SIGNED_OUT that follows is not "you were signed out"
  try { await supabase.auth.signOut(); } catch (_) {}
}

/* NEW-4 — sign out EVERY session for this account, not just this browser. Supabase's `global`
 * scope revokes all refresh tokens server-side, so a phone or an office machine left signed in is
 * signed out too; the local session goes with them because the same call clears it here.
 * ⛔ Unlike `signOut()` above this REPORTS its outcome (LOUD-FAILURE): a security action that
 * silently fails is worse than one that is not offered, because the user believes they are safe.
 * There is deliberately NO "active sessions" list beside it — enumerating sessions needs the
 * service-role admin API, which may never reach the browser (/CLAUDE.md → KEY DECISIONS). */
export async function signOutEverywhere() {
  if (!supabase) return { error: "Cloud not configured." };
  markDeliberateSignOut();
  try {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    return failure(error);
  } catch (e) {
    return failure(e);
  }
}

export async function resetPassword(email, captchaToken) {
  if (!supabase) return { error: "Cloud not configured." };
  const options = { redirectTo };
  if (captchaToken) options.captchaToken = captchaToken;
  const { error } = await observeAuthCall("reset", email, () => supabase.auth.resetPasswordForEmail(email, options));
  return failure(error);
}

export async function updatePassword(password) {
  if (!supabase) return { error: "Cloud not configured." };
  const { error } = await supabase.auth.updateUser({ password });
  return failure(error);
}

// Current signed-in user (from the locally-stored session), or null.
export async function getUser() {
  if (!supabase) return null;
  try { const { data } = await supabase.auth.getSession(); return (data && data.session && data.session.user) || null; }
  catch (_) { return null; }
}

// Subscribe to auth changes. Fires (event, user, meta) on sign-in/out, token refresh,
// and PASSWORD_RECOVERY (when the user opens a reset link). Returns unsubscribe.
// `meta` (NEW-1, shared/auth/sessionIntent.js) says what an empty answer MEANS: `deliberate` (the person
// pressed Sign out here), `lost` (the session ended without them asking: "You were signed out"), `pending`
// (a stored session could not be used YET — no network at boot — which is "not known", not "signed out").
export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const user = (session && session.user) || null;
    cb(event, user, currentAuthEventMeta(event, user));
  });
  return () => { try { data.subscription.unsubscribe(); } catch (_) {} };
}
