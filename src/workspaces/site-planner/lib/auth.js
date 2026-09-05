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

// Where Supabase sends the user back after email confirmation / password reset.
// Must be allow-listed in Supabase → Auth → URL Configuration → Redirect URLs.
// Pin to the bare origin root ("https://planyr.io/") rather than the live pathname:
// the app always boots from "/" and reads the auth params client-side, so a stable,
// allow-listed target avoids ever sending the callback to a path the front-door
// redirect (index.html) doesn't special-case.
const redirectTo = (() => {
  try { return window.location.origin + "/"; } catch (_) { return undefined; }
})();

const errMsg = (e) => (e && e.message) || null;

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
  const { data, error } = await supabase.auth.signUp({ email, password, options });
  const msg = errMsg(error);
  // Best-effort visibility only (B1160721, NEW-2) — the Postgres trigger is the real
  // enforcement and cannot be bypassed by skipping this call entirely (a raw API request
  // is still blocked, it just won't show up here); this only makes a BROWSER-DRIVEN block
  // visible after the fact, the same client_errors channel every other silent-failure
  // class in this app already reports through. Domain only, never the full address.
  if (msg && msg.includes(SIGNUP_RATE_LIMIT_MESSAGE_FRAGMENT)) {
    reportClientEvent("signup-rate-limited", "signup blocked by server-side rate limit", {
      domain: (String(email).split("@")[1] || "").toLowerCase(),
    });
  }
  // When email confirmation is on, signUp returns a user but no session yet.
  return { error: msg, needsConfirm: !!(data && data.user && !data.session) };
}

export async function signIn(email, password) {
  if (!supabase) return { error: "Cloud not configured." };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: errMsg(error) };
}

export async function signOut() {
  if (!supabase) return;
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
  try {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    return { error: errMsg(error) };
  } catch (e) {
    return { error: (e && e.message) || "Couldn't sign out everywhere." };
  }
}

export async function resetPassword(email) {
  if (!supabase) return { error: "Cloud not configured." };
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return { error: errMsg(error) };
}

export async function updatePassword(password) {
  if (!supabase) return { error: "Cloud not configured." };
  const { error } = await supabase.auth.updateUser({ password });
  return { error: errMsg(error) };
}

// Current signed-in user (from the locally-stored session), or null.
export async function getUser() {
  if (!supabase) return null;
  try { const { data } = await supabase.auth.getSession(); return (data && data.session && data.session.user) || null; }
  catch (_) { return null; }
}

// Subscribe to auth changes. Fires (event, user) on sign-in/out, token refresh,
// and PASSWORD_RECOVERY (when the user opens a reset link). Returns unsubscribe.
export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, (session && session.user) || null));
  return () => { try { data.subscription.unsubscribe(); } catch (_) {} };
}
