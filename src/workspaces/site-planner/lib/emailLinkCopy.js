/* NEW-1 — every sentence the "email me a link" flow shows, and the cooldown arithmetic, as pure functions.
 * The panel (EmailLinkSent.jsx), the landing page (app/AuthLinkLanding.jsx) and the tests read these; no
 * component types its own wording. Plain words, no numbers a person has to decode beyond a clock. */
import { AUTH_SENDER_LABEL, SUPPORT_EMAIL } from "./authMail.js";
import { LINK_VALID_MINUTES } from "../../../shared/auth/authLink.js";

export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

/** 42 → "0:42"; 125 → "2:05"; anything under a second is "0:01" (a button never says 0:00 and stays locked). */
export function clock(seconds) {
  const s = Math.max(1, Math.ceil(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A long wait in words: "about 38 minutes", "a minute", "42 seconds". */
export function waitWords(seconds) {
  const s = Math.max(1, Math.ceil(Number(seconds) || 0));
  if (s < 90) return s < 60 ? `${s} seconds` : "a minute";
  const m = Math.ceil(s / 60);
  return m >= 60 ? "about an hour" : `about ${m} minutes`;
}

/** The "Send again" button: its label and whether it can be pressed right now. */
export function resendControl(secondsLeft) {
  const left = Math.max(0, Math.ceil(Number(secondsLeft) || 0));
  return left > 0 ? { enabled: false, label: `Send again in ${clock(left)}` } : { enabled: true, label: "Send again" };
}

export function sentCopy(email, purpose) {
  return {
    heading: "Check your inbox",
    inbox: `Check your inbox at ${email}. It comes from ${AUTH_SENDER_LABEL}.`,
    valid: `The link works once and for ${LINK_VALID_MINUTES === 60 ? "1 hour" : LINK_VALID_MINUTES + " minutes"}.` + (purpose === "reset" ? " It opens a page where you choose a new password." : " It signs you in on whichever device you open it."),
    spam: "Not there after a minute? Look in spam or junk.",
    support: `Still nothing? Email ${SUPPORT_EMAIL} and we’ll get you in.`,
  };
}

/** What to tell the person when a request did not produce an email. NEVER implies it was sent. */
export function failureCopy(result) {
  const r = result || {};
  if (r.reason === "throttled") return `We’ve already sent this address a link. You can ask for another in ${waitWords(r.retryAfterSeconds)}.`;
  if (r.reason === "bad_request") return "That doesn’t look like an email address. Check it and try again.";
  if (r.reason === "network") return `We couldn’t reach Planyr to send it, so no email went out. Check your connection and try again, or email ${SUPPORT_EMAIL}.`;
  if (r.reason === "send_failed" || r.reason === "link_failed") return `We couldn’t send the email just now, so nothing is on its way. Try again in a minute, or email ${SUPPORT_EMAIL} and we’ll get you in.`;
  // unavailable · not_configured · anything unexpected
  return `Emailed links aren’t working right now, and no email was sent. Email ${SUPPORT_EMAIL} and we’ll get you in.`;
}

/** Shown beside the sign-in form when the browser check (Turnstile) failed, hung or could not load (owner-approved
 * "AI agent access" mockup, Moment 2, 2026-11-27). It names the two real causes (a network that blocks the check, or an
 * AI agent's browser, which the check always refuses) and points at the emailed code, which does not need the check. */
export const BLOCKED_CHECK_COPY = {
  heading: "The security check didn\u2019t finish",
  body: "Your network may have blocked it. Using an AI agent, or does it keep failing? Email a sign-in code instead.",
  retry: "Try the check again",
};

/** Shown at the top of the sign-in form when the panel is running inside an AI agent's browser (Moment 1). That
 * browser can never pass the check, so the emailed code leads and the password form waits behind a link. */
export const AGENT_BROWSER_COPY = {
  heading: "Using an AI agent?",
  body: "This browser can\u2019t pass Planyr\u2019s security check. We\u2019ll email you a sign-in code instead.",
  usePassword: "Use my password instead",
};

/** The sign-in form's email button (the email carries both a link and a sign-in code). */
export const EMAIL_CODE_BUTTON = "Email me a sign-in code";

/** The typed-code box under the sent message (sign-in only). */
export const CODE_COPY = {
  label: "Code from the email",
  agent: "Signing in through your own AI agent? Read it the code yourself, only for a sign-in you just started. Planyr never shows the code on this screen.",
  button: "Sign in",
};
/** What to tell the person when a typed code did not work. */
export function codeFailureCopy(kind) {
  if (kind === "rate") return "Too many tries. Wait a few minutes, then try again.";
  if (kind === "network") return `We couldn\u2019t reach Planyr, so nothing was checked. Try again, or email ${SUPPORT_EMAIL}.`;
  if (kind === "bad_code") return "That code didn\u2019t work. Check it, or press Send again for a new one (the old one stops working).";
  return `Something went wrong checking the code. Try again, or email ${SUPPORT_EMAIL}.`;
}
