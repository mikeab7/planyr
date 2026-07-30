/* NEW-2 — who Planyr's auth emails actually come FROM, in one place.
 *
 * A user who just signed up watches for something from planyr.io. Nothing arrives under
 * that name, so they conclude the signup failed and either retry or bounce. The fix is to
 * name the real sender in the confirmation and password-reset copy — which only works if
 * the app and the mail service agree, so the address lives here ONCE and both messages are
 * built from it.
 *
 * CURRENT SENDER — Supabase's BUILT-IN email service (owner-confirmed 2026-07-30; the
 * project's auth settings can't be read from the sandbox, whose egress policy 403s
 * supabase.com/.co outright). Supabase's own docs are blunt about this service: it is
 * "not meant for production use", it is rate-limited to a handful of messages per hour,
 * and — the sharp edge — it "will refuse to deliver messages to addresses that are not
 * part of the project's team", failing with "Email address not authorized". So today a
 * stranger's signup cannot receive a confirmation at all. That's a product decision for
 * the owner (wire a transactional provider as custom SMTP and send from planyr.io), not
 * something to paper over in copy — see OWNER-TODO.md and V542.
 *
 * ⛔ WHEN CUSTOM SMTP IS CONFIGURED, CHANGE THESE TWO LINES IN THE SAME BREATH. The copy
 * is generated from them and test/authMailCopy.test.js asserts both messages carry the
 * address, so the user-facing text cannot drift away from what actually sends. */

export const AUTH_SENDER_NAME = "Supabase Auth";
export const AUTH_SENDER_EMAIL = "noreply@mail.app.supabase.io";

// "Supabase Auth (noreply@mail.app.supabase.io)" — the display name is what an inbox
// actually shows in its From column, the address is what a search box matches on, so the
// copy names both. One short line each: this is a status message, not a help article.
export const AUTH_SENDER_LABEL = `${AUTH_SENDER_NAME} (${AUTH_SENDER_EMAIL})`;

export const SIGNUP_CONFIRM_MSG =
  `Account created — the confirmation link comes from ${AUTH_SENDER_LABEL}. Check spam if it isn’t in your inbox, then sign in.`;

export const PASSWORD_RESET_MSG =
  `Password-reset link sent from ${AUTH_SENDER_LABEL} — check spam if it isn’t in your inbox.`;
