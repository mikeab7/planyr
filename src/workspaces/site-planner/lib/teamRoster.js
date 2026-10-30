/* Pure roster model for Settings › Team (NEW-1, 2026-10-03). Role is shown by WHICH SECTION a person
 * sits in, so this is the one place that decides the grouping. No React, no I/O — Node-testable.
 * Sections: admins · members · invited. An empty section is simply absent from `sections`. */

export function initialsOf(name, email) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  const base = words[0] || String(email || "").trim();
  return (base.slice(0, 2) || "?").toUpperCase();
}

/* members: [{userId, role, displayName, email}] · invites: [{id, email, role, lastSentAt?, declinedAt?}] */
export function groupRoster(members, invites, myUid) {
  const rows = (members || []).map((m) => ({
    kind: "member", id: m.userId, role: m.role === "admin" ? "admin" : "member",
    name: m.displayName || m.email || "Teammate",
    // Email always shows — two accounts can share a display name and differ only by email.
    email: m.email || "",
    isYou: !!myUid && m.userId === myUid,
  }));
  const invited = (invites || []).map((iv) => ({
    kind: "invite", id: iv.id, role: iv.role === "admin" ? "admin" : "member", email: iv.email, name: iv.email,
    lastSentAt: iv.lastSentAt || null,
    // NEW-1 (invite inbox): set once the invitee declined. The row stays in "Invited" so the inviter
    // SEES the answer instead of the invite silently vanishing; they can remove it or invite again.
    declinedAt: iv.declinedAt || null,
  }));
  const sections = [
    { id: "admins", label: "Admins", rows: rows.filter((r) => r.role === "admin") },
    { id: "members", label: "Members", rows: rows.filter((r) => r.role !== "admin") },
    { id: "invited", label: "Invited", rows: invited },
  ].filter((s) => s.rows.length > 0);
  return { sections, memberCount: rows.length };
}

/* The ⋯ menu is offered only to an admin, and never on their own row. */
export function canManage(row, isAdmin) {
  return !!isAdmin && !(row && row.kind === "member" && row.isYou);
}

export function countsLine(memberCount, projectCount) {
  const m = `${memberCount} member${memberCount === 1 ? "" : "s"}`;
  const p = `${projectCount} shared project${projectCount === 1 ? "" : "s"}`;
  return `${m} · ${p}`;
}

/* Resend throttle (NEW-1): how many ms until an invite may be emailed again. The server enforces
 * the same window (claim_invite_send); this only keeps the button honest. 0 = ready. */
export const RESEND_WINDOW_MS = 60 * 1000;
export function resendCooldownMs(lastSent, now = Date.now()) {
  const t = typeof lastSent === "number" ? lastSent : Date.parse(lastSent || "");
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, t + RESEND_WINDOW_MS - now);
}

/* NEW-4 (2026-10-29) — the roster for the SELECTED team, and only that team. A roster is two requests
 * (members, invites); click team A then team B quickly and A's answers could land after B's and stay on
 * screen under B's name and admin controls — where Remove / Change role then sent B's team id with A's
 * user id. Every load takes a ticket; a result is applied only if it is still the newest ticket AND its
 * team is still the selected one, and members + invites are applied TOGETHER (never one team's members
 * beside another's invites). A failure is reported, never swallowed into a stale list.
 * `fetchMembers/fetchInvites(teamId)`, `getSelected()` and the two callbacks are injected. */
export function createRosterLoader({ fetchMembers, fetchInvites, getSelected, onApply, onError }) {
  let ticket = 0;
  return {
    /** Forget any in-flight load (the selection changed or the panel closed). */
    cancel() { ticket += 1; },
    async load(teamId) {
      const mine = ++ticket;
      if (!teamId) { onApply(teamId, [], []); return; }
      try {
        const [members, invites] = await Promise.all([fetchMembers(teamId), fetchInvites(teamId)]);
        if (mine !== ticket || getSelected() !== teamId) return; // superseded, or another team is showing now
        onApply(teamId, members || [], invites || []);
      } catch (e) {
        if (mine === ticket && getSelected() === teamId && onError) onError(e);
      }
    },
  };
}
