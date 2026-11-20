/* Who Planyr's auth emails actually come FROM, in one place — and the words that name them.
 *
 * A person who just asked for a sign-in link or a password reset watches for something from planyr.io.
 * If nothing arrives under that name they conclude it failed and retry or bounce. Naming the real sender
 * only helps while the name is TRUE, so the address lives here ONCE and the copy is built from it
 * (test/authMailCopy.test.js asserts the messages carry it).
 *
 * TWO SENDERS, ONE PER KIND OF MAIL (corrected 2026-11-02, NEW-1 — this header used to say Supabase's
 * built-in mailer sent everything and that "a stranger's signup cannot receive a confirmation at all"):
 *
 *   · SIGN-IN LINKS AND PASSWORD RESETS come from Planyr — no-reply@planyr.io — through the Google
 *     Workspace mailbox that also sends team invites (functions/api/auth/email-link.js →
 *     functions/api/lib/gmailSend.js). That route exists because Supabase's own mailer allows 2 emails an
 *     hour for the whole project, cannot be given a scanner-safe link, and reads "Supabase Auth".
 *   · SIGN-UP CONFIRMATION would come from Supabase's built-in mailer ("Supabase Auth"), but email
 *     confirmation is OFF on this project (mailer_autoconfirm = true, measured 2026-11-02), so no
 *     confirmation mail is sent today and a new account is signed in at once. That copy is kept — and
 *     keeps naming Supabase, because that is who would send it — for the day confirmation is switched on.
 *
 * ⛔ If the sending mailbox / From address changes, change AUTH_SENDER_EMAIL here AND the Cloudflare env
 * (AUTH_MAIL_FROM / INVITE_FROM) in the same breath. Gmail only honours a From that is a verified "Send mail
 * as" alias of the authenticated mailbox; otherwise it silently rewrites it (B2485776). */

export const AUTH_SENDER_NAME = "Planyr";
export const AUTH_SENDER_EMAIL = "no-reply@planyr.io";
// "Planyr (no-reply@planyr.io)" — the display name is what an inbox shows in its From column, the address
// is what a search box matches on, so the copy names both.
export const AUTH_SENDER_LABEL = `${AUTH_SENDER_NAME} (${AUTH_SENDER_EMAIL})`;

// Supabase's own mailer — used only by the sign-up confirmation, which is off today (see above).
export const SIGNUP_CONFIRM_SENDER_NAME = "Supabase Auth";
export const SIGNUP_CONFIRM_SENDER_EMAIL = "noreply@mail.app.supabase.io";
export const SIGNUP_CONFIRM_SENDER_LABEL = `${SIGNUP_CONFIRM_SENDER_NAME} (${SIGNUP_CONFIRM_SENDER_EMAIL})`;

export const SIGNUP_CONFIRM_MSG =
  `Account created — the confirmation link comes from ${SIGNUP_CONFIRM_SENDER_LABEL}. Check spam if it isn’t in your inbox, then sign in.`;

// One support address for the whole flow — defined beside the link rules both sides read.
export { SUPPORT_EMAIL } from "../../../shared/auth/authLink.js";
