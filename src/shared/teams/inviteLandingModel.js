/* Invite LINK landing — the pure half (NEW-2, 2026-10-29). No React, no I/O, no imports — Node-testable.
 * The invite email's button opens planyr.io/?app&invite=<id>, where <id> is the invite row's own random uuid
 * (never the email). src/app/InviteLanding.jsx resolves it with the invite_preview RPC and asks THIS module
 * what to do, so the decision table below is the single place the rules live:
 *   signed out + open invite      → open the sign-in (account exists) / sign-up (it doesn't) screen with the
 *                                   invited address already filled in
 *   signed in as THAT address     → a small "You've been invited to <team> — Accept / Decline" prompt
 *   signed in as ANOTHER address  → "This invite was sent to <email>. Sign out and sign in with that address
 *                                   to accept." + a Sign out button. The invite is NEVER attached to the wrong
 *                                   account (and respond_to_invite refuses it server-side anyway).
 *   used / declined / unknown id  → one plain line, nothing else revealed (the RPC withholds the address).
 * A brand-new signup is added by handle_new_user at signup, so there is nothing to accept for them. */

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
 *  `unreachable`: the preview call itself failed — say so, never pretend the invite is gone. */
export function inviteLandingPlan({ preview, user, unreachable = false }) {
  if (unreachable) return { kind: "notice", tone: "warn", text: "Couldn't check this invitation — open the link again in a moment." };
  if (!preview || preview.ok === false) return { kind: "notice", tone: "info", text: "This invitation is no longer available." };
  const team = preview.team_name || "the team";
  if (preview.status === "claimed") return { kind: "notice", tone: "info", text: `This invitation to ${team} has already been used.` };
  if (preview.status === "declined") return { kind: "notice", tone: "info", text: `This invitation to ${team} was declined.` };
  if (preview.status !== "open") return { kind: "notice", tone: "info", text: "This invitation is no longer available." };

  const email = preview.email || "";
  if (!user) return { kind: "auth", email, mode: preview.has_account ? "signin" : "signup" };
  if (sameAddress(user.email, email)) {
    return { kind: "answer", invite: { id: preview.invite_id, teamName: team }, teamName: team, invitedBy: preview.invited_by_name || "A teammate" };
  }
  return { kind: "wrong-account", email, text: `This invite was sent to ${email}. Sign out and sign in with that address to accept.` };
}
