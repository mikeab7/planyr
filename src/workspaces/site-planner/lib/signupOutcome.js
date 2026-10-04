/* What the sign-up panel does with a signUp() answer, as pure functions (NEW-1/2, auth panel).
 *
 * Branch on what the server actually RETURNED — a session present vs absent — never on a
 * build-time flag, so flipping Supabase's "Confirm email" setting changes the behaviour with no
 * redeploy:
 *   - error                      → stay on the form and show it
 *   - session present            → signed in already (confirmation OFF): land in the app
 *   - session absent (no error)  → confirmation ON: replace the form with "check your email"
 * An answer with neither an error nor a session is NEVER read as "signed in" — claiming a login
 * that did not happen is the worse failure — so it falls to the check-your-email state. */
import { AUTH_SENDER_LABEL } from "./authMail.js";

export const MIN_PASSWORD_LENGTH = 6;
export const PASSWORD_MIN_HINT = `Min ${MIN_PASSWORD_LENGTH} characters`;

export function signupOutcome(res) {
  if (!res || res.error) return "error";
  return res.signedIn ? "signed-in" : "check-email";
}

// The hint belongs to the password field and only helps while it is relevant: the field has
// focus, or something short has been typed. Never on Sign in (the caller gates on mode).
export function passwordHintVisible(focused, value) {
  const len = (value || "").length;
  return !!focused || (len > 0 && len < MIN_PASSWORD_LENGTH);
}

// Copy for the check-your-email state. The sender is named because it currently reads as
// Supabase, which looks like spam to anyone not expecting it; built from the one sender
// constant so it cannot drift from what actually sends (see authMail.js).
export function checkEmailCopy(email) {
  return {
    heading: "Check your email",
    sent: `We sent a confirmation link to ${email}.`,
    sender: `It comes from ${AUTH_SENDER_LABEL} — that is Planyr’s mail service, so the name may look unfamiliar. Check spam if it isn’t there in a minute or two.`,
    next: "Open the link to confirm, then sign in.",
  };
}
