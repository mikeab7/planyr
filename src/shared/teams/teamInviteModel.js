/* Team-invite inbox — the pure half (NEW-1, 2026-10-28). No React, no I/O, no imports — Node-testable.
 * Someone who ALREADY has a Planyr account and is invited to a team sees that invite in the account
 * menu and answers it (Accept / Decline). The data rides two SECURITY DEFINER RPCs
 * (db/team_invite_inbox.sql: list_my_invites / respond_to_invite); the client side is src/app/teamInvites.js. */

/** Fired on `window` after the signed-in user's team membership changed (an invite was accepted) so
 *  whatever holds a copy of "my teams / what is shared with me" can re-read it. */
export const TEAMS_CHANGED_EVENT = "planyr:teams-changed";

export const roleWord = (role) => (role === "admin" ? "admin" : "member");

/** list_my_invites rows → the shape the menu renders. */
export function mapInviteRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.invite_id)
    .map((r) => ({
      id: r.invite_id, teamId: r.team_id, teamName: r.team_name || "A team",
      role: roleWord(r.role), invitedBy: r.invited_by_name || "A teammate", createdAt: r.created_at || null,
    }));
}

/** "Chris Seward invited you as admin" — the line under the team name. */
export const inviteLine = (inv) => `${inv.invitedBy} invited you as ${roleWord(inv.role)}`;

/** The count badge on the account button: nothing at 0, "9+" past nine. */
export const badgeLabel = (n) => (!(n > 0) ? "" : n > 9 ? "9+" : String(n));

/** Plain words for a respond_to_invite result. Returns { ok, text }. */
export function answerNote(res, accept, teamName) {
  const team = teamName || "the team";
  if (res && res.ok) return { ok: true, text: accept ? `You joined ${team}.` : `Declined the invitation to ${team}.` };
  const reason = res && res.reason;
  if (reason === "not_found") return { ok: false, text: "That invitation is no longer there." };
  if (reason === "declined") return { ok: false, text: "You declined this invitation — ask for a new one." };
  return { ok: false, text: (res && res.error) || "Couldn't save your answer — try again." };
}
