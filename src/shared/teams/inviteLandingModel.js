/* Invite LINK landing — the pure half (NEW-2, 2026-10-29; reworked NEW-1, 2026-11-02). No React, no I/O, no imports —
 * Node-testable. The invite email's button opens planyr.io/?app&invite=<id>, where <id> is the invite row's own random
 * uuid (never the email). src/app/InviteLanding.jsx resolves it with the invite_preview RPC and asks THIS module what
 * to do, so the decision table below is the single place the rules live.
 *
 * THE LINK IS THE PROOF OF THE MAILBOX (NEW-1, 2026-11-02): email confirmation is off, so an address match proves
 * nothing; only someone holding the emailed link may join. Every state below has a NEXT STEP — a card with no way
 * forward is a defect:
 *   joined (this tab just did)  → "You're on <team>." + go to the team's work           (item 7: never "already used")
 *   signed out, no account      → "Create your account" card, the invited address filled in and fixed; no Turnstile
 *   signed out, has an account  → the sign-in screen, the invited address filled in; come back and Accept
 *   signed in as THAT address   → Accept / Decline (the link proves the mailbox)
 *   signed in as ANOTHER one    → says which address the invite is for, offers "Switch to <it>"; never joins the
 *                                 wrong account, never a bare refusal
 *   used / declined / gone      → one plain line + what to do next (sign in, ask an admin to invite you again)
 *   couldn't reach the server   → says so + Try again */

export const INVITE_PARAM = "invite";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isInviteId = (s) => typeof s === "string" && UUID.test(s);

/** The invite id in a location.search string, or null (anything that is not a uuid is ignored). */
export function inviteIdFromSearch(search) {
  let v = null;
  try { v = new URLSearchParams(String(search || "")).get(INVITE_PARAM); } catch (_) { return null; }
  return isInviteId(v) ? v : null;
}

/** location.search with the invite param removed — one-time, so a reload does not reopen the prompt. A plain
 *  splice (like Shell's auth deep link) keeps a bare "?app" exactly as the email wrote it. */
export function stripInviteParam(search) {
  return String(search || "")
    .replace(/([?&])invite=[^&]*/, (_, sep) => (sep === "?" ? "?" : ""))
    .replace(/^\?&/, "?")
    .replace(/&&/g, "&")
    .replace(/^[?&]$/, "")
    .replace(/[?&]$/, "");
}

const norm = (e) => String(e == null ? "" : e).trim().toLowerCase();
export const sameAddress = (a, b) => !!norm(a) && norm(a) === norm(b);

/** invite_preview result (or null when the call failed) + the signed-in user (or null) → what to show.
 *  `unreachable`: the preview call itself failed — say so, never pretend the invite is gone.
 *  `joined`: { teamName } once THIS tab has just joined through this link (redeem or link sign-up) — it outranks the
 *  preview, which by then correctly reads "claimed" and used to be shown as "already used" (item 7). */
export function inviteLandingPlan({ preview, user, unreachable = false, joined = null }) {
  if (joined) return { kind: "joined", teamName: joined.teamName || "the team", text: `You're on ${joined.teamName || "the team"}.` };
  if (unreachable) return { kind: "notice", tone: "warn", action: "retry", text: "Couldn't check this invitation \u2014 try again in a moment." };
  if (!preview || preview.ok === false) {
    return { kind: "notice", tone: "info", action: user ? "work" : "signin", text: "This invitation is no longer available. It may have been replaced by a newer one \u2014 check your email for the latest, or ask a team admin to invite you again." };
  }
  const team = preview.team_name || "the team";
  if (preview.status === "claimed") {
    return { kind: "notice", tone: "info", action: user ? "work" : "signin", teamName: team,
      text: `This invitation to ${team} has already been used. If that was you, ${team} is in your account \u2014 if you can't find it, ask a team admin to invite you again.` };
  }
  if (preview.status === "declined") {
    return { kind: "notice", tone: "info", action: user ? "work" : "signin", teamName: team,
      text: `This invitation to ${team} was declined. If you changed your mind, ask a team admin to invite you again.` };
  }
  if (preview.status !== "open") return { kind: "notice", tone: "info", action: user ? "work" : "signin", text: "This invitation is no longer available. Ask a team admin to invite you again." };

  const email = preview.email || "";
  const invitedBy = preview.invited_by_name || "A teammate";
  if (!user) {
    if (preview.has_account) return { kind: "auth", email, mode: "signin" };
    return { kind: "signup", email, teamName: team, invitedBy, invite: { id: preview.invite_id, teamName: team } };
  }
  if (sameAddress(user.email, email)) {
    return { kind: "answer", invite: { id: preview.invite_id, teamName: team }, teamName: team, invitedBy };
  }
  return { kind: "wrong-account", email, currentEmail: user.email || "", teamName: team,
    text: `This invitation to ${team} is for ${email}. You're signed in as ${user.email || "a different account"}.` };
}

/** The create-account card's validation, before anything is sent. Returns an error sentence or "". */
export function signupCardProblem({ firstName, lastName, password }) {
  if (!String(firstName || "").trim() || !String(lastName || "").trim()) return "First and last name are required.";
  if (String(password || "").length < 6) return "Choose a password of at least 6 characters.";
  return "";
}

/** /api/auth/invite-signup (or a network failure) → plain words + what the card should do next.
 *  { status, body } is the response; `body` may be null. Returns { text, next: "form" | "signin" }. */
export function signupFailure(status, body) {
  const reason = body && body.reason;
  if (reason === "has_account") return { text: "This address already has a Planyr account \u2014 sign in to accept.", next: "signin" };
  if (reason === "account_created") return { text: (body && body.error) || "Your account was created. Sign in with the password you just chose.", next: "signin" };
  if (reason === "too_many") return { text: (body && body.error) || "Too many tries for this invitation. Try again tomorrow.", next: "form" };
  if (reason === "not_available") return { text: "This invitation is no longer available. Ask a team admin to invite you again.", next: "form" };
  if (body && body.error) return { text: body.error, next: "form" };
  return { text: status ? "Couldn't create your account \u2014 try again in a moment." : "Couldn't reach Planyr \u2014 check your connection and try again.", next: "form" };
}
