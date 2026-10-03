/* Pure roster model for Settings › Team (NEW-1, 2026-10-03). Role is shown by WHICH SECTION a person
 * sits in, so this is the one place that decides the grouping. No React, no I/O — Node-testable.
 * Sections: admins · members · invited. An empty section is simply absent from `sections`. */

export function initialsOf(name, email) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  const base = words[0] || String(email || "").trim();
  return (base.slice(0, 2) || "?").toUpperCase();
}

/* members: [{userId, role, displayName, email}] · invites: [{id, email, role}] */
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
