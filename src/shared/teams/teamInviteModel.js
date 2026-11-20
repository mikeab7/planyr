/* Team-invite inbox — the pure half (NEW-1, 2026-10-28). No React, no I/O, no imports — Node-testable.
 * Someone who ALREADY has a Planyr account and is invited to a team sees that invite in the account
 * menu and answers it (Accept / Decline). The data rides two SECURITY DEFINER RPCs
 * (db/team_invite_proof.sql: list_my_invites / respond_to_invite); the client side is src/app/teamInvites.js. */

/** Fired on `window` after the signed-in user's team membership changed (an invite was accepted) so
 *  whatever holds a copy of "my teams / what is shared with me" can re-read it. */
export const TEAMS_CHANGED_EVENT = "planyr:teams-changed";

export const roleWord = (role) => (role === "admin" ? "admin" : "member");

/** list_my_invites rows → the shape the menu renders. NEW-1 (2026-11-02): a row is PROVEN (full details, answerable) or
 *  UNPROVEN — the account's mailbox hasn't been confirmed, so the server withholds the id, team, inviter and role and
 *  all we know is that an invitation is waiting. A row from a database that predates `proven` reads as proven. */
export function mapInviteRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && (r.invite_id || r.proven === false))
    .map((r, i) => (r.proven === false
      ? { id: `waiting-${i}`, proven: false, createdAt: r.created_at || null }
      : {
        id: r.invite_id, proven: true, teamId: r.team_id, teamName: r.team_name || "A team",
        role: roleWord(r.role), invitedBy: r.invited_by_name || "A teammate", createdAt: r.created_at || null,
      }));
}

/** The menu's two lists: invitations the account can answer now, and how many are waiting on the mailbox proof. */
export function splitInvites(invites) {
  const list = Array.isArray(invites) ? invites : [];
  return { ready: list.filter((i) => i.proven !== false), waiting: list.filter((i) => i.proven === false) };
}

/** "Chris Seward invited you as admin" — the line under the team name. */
export const inviteLine = (inv) => `${inv.invitedBy} invited you as ${roleWord(inv.role)}`;

/** The count badge on the account button: nothing at 0, "9+" past nine. */
export const badgeLabel = (n) => (!(n > 0) ? "" : n > 9 ? "9+" : String(n));

/** The waiting card's heading: "A team invitation is waiting" / "3 team invitations are waiting". No team name — an account
 *  whose mailbox is unproven is never told which team. */
export const waitingLine = (n) => (n === 1 ? "A team invitation is waiting for you." : `${n} team invitations are waiting for you.`);

/** Plain words for a respond_to_invite result. Returns { ok, text, unproven? }. */
export function answerNote(res, accept, teamName) {
  const team = teamName || "the team";
  if (res && res.ok) return { ok: true, text: accept ? `You joined ${team}.` : `Declined the invitation to ${team}.` };
  const reason = res && res.reason;
  if (reason === "unproven") return { ok: false, unproven: true, text: "Confirm your email first \u2014 open the link in your invitation email." };
  if (reason === "not_found") return { ok: false, text: "That invitation is no longer there." };
  if (reason === "declined") return { ok: false, text: "You declined this invitation \u2014 ask for a new one." };
  if (reason === "claimed") return { ok: false, text: `This invitation was already used. If you're not on ${team}, ask a team admin to invite you again.` };
  return { ok: false, text: (res && res.error) || "Couldn't save your answer \u2014 try again." };
}

/** Plain words for a redeem_invite_link result (the emailed link, signed in). */
export function redeemNote(res, accept, teamName) {
  const team = (res && res.team_name) || teamName || "the team";
  if (res && res.ok) return { ok: true, text: accept ? `You're on ${team}.` : `Declined the invitation to ${team}.` };
  const reason = res && res.reason;
  if (reason === "wrong_account") return { ok: false, wrongAccount: true, text: "This invitation is for a different email address." };
  if (reason === "not_found") return { ok: false, text: "This invitation is no longer available. Ask a team admin to invite you again." };
  if (reason === "declined") return { ok: false, text: `You declined this invitation to ${team} \u2014 ask a team admin to invite you again.` };
  if (reason === "claimed") return { ok: false, text: `This invitation was already used. If you're not on ${team}, ask a team admin to invite you again.` };
  if (reason === "not_signed_in") return { ok: false, text: "Sign in to answer this invitation." };
  return { ok: false, text: (res && res.error) || "Couldn't save your answer \u2014 try again." };
}

/** /api/team/invite-resend → words for the waiting card. status 200 → "We sent a confirmation to <address>." */
export function resendNote(status, body, address) {
  if (status === 200 && body && body.ok) return { ok: true, text: `We sent a confirmation to ${body.email || address}.` };
  if (status === 429) return { ok: false, throttled: true, text: "Just sent \u2014 check your inbox, or try again in a minute." };
  if (status === 404) return { ok: false, text: "There's no invitation waiting for this account any more." };
  if (status === 401 || /invalid or expired session/i.test(String((body && body.error) || ""))) return { ok: false, signIn: true, text: "Your sign-in expired \u2014 sign in again to resend it." };
  return { ok: false, text: (body && body.error) || "Couldn't send the email \u2014 try again in a moment." };
}
