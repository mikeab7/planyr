/* Team workspace management (team feature) — the "Team" tab in the signed-in Account panel.
 * Create a team, see who's on it, and (as an admin) invite people by email, change roles, or
 * remove them; a regular member sees a read-only roster and can leave. All I/O goes through
 * lib/teams.js (RLS-scoped). Theme tokens only — no raw hex (owner theming rule). Signed-in only
 * (the Account panel only mounts this when there's a user). */
import { useEffect, useState, useCallback } from "react";
import { listMyTeams, listMembers, listInvites, createTeam, inviteByEmail, setRole, removeMember, cancelInvite, leaveTeam } from "../lib/teams.js";

const PAL = { ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)", accent: "var(--accent)", paper: "var(--surface-raised)" };
const field = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, border: `1px solid ${PAL.line}`, borderRadius: 8, color: PAL.ink, fontFamily: "inherit" };
const btn = (primary) => ({ padding: "8px 12px", fontSize: 12.5, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${primary ? PAL.accent : PAL.line}`, background: primary ? PAL.accent : "var(--surface-raised)", color: primary ? "var(--on-accent)" : PAL.ink });
const tiny = { ...btn(false), padding: "3px 8px", fontSize: 11 };
const pill = (on) => ({ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "2px 7px", borderRadius: 999, border: `1px solid ${PAL.line}`, color: on ? "var(--on-accent)" : PAL.muted, background: on ? PAL.accent : "transparent" });

export default function TeamPanel({ user, setMsg }) {
  const myUid = user && user.id;
  const [teams, setTeams] = useState(null); // null = loading
  const [sel, setSel] = useState(null);     // selected team id
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");      // new-team name
  const [email, setEmail] = useState("");    // invite email
  const [role, setRoleSel] = useState("member");
  const [confirmLeave, setConfirmLeave] = useState(false);

  const say = useCallback((type, text) => setMsg && setMsg(text ? { type, text } : null), [setMsg]);

  const loadTeams = useCallback(async () => {
    try {
      const list = await listMyTeams();
      setTeams(list);
      setSel((cur) => cur && list.some((t) => t.id === cur) ? cur : (list[0] ? list[0].id : null));
    } catch (e) { setTeams([]); say("err", "Couldn't load your teams — check your connection."); }
  }, [say]);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  const current = teams && teams.find((t) => t.id === sel);
  const isAdmin = current && current.role === "admin";

  const loadRoster = useCallback(async (teamId) => {
    if (!teamId) { setMembers([]); setInvites([]); return; }
    setMembers(await listMembers(teamId));
    setInvites(await listInvites(teamId));
  }, []);
  useEffect(() => { loadRoster(sel); setConfirmLeave(false); }, [sel, loadRoster]);

  const doCreate = async () => {
    if (!name.trim()) { say("err", "Give the team a name."); return; }
    setBusy(true); say();
    const r = await createTeam(name);
    setBusy(false);
    if (!r.ok) {
      const raw = r.error || "";
      const msg = /row.level security|violates|rls/i.test(raw)
        ? "Couldn't create the team — please try again or contact support."
        : raw || "Couldn't create the team.";
      console.error("[teams] create failed:", raw);
      say("err", msg);
      return;
    }
    setName(""); say("ok", "Team created.");
    await loadTeams(); setSel(r.teamId);
  };

  const doInvite = async () => {
    setBusy(true); say();
    const r = await inviteByEmail(sel, email, role);
    setBusy(false);
    if (!r.ok) { say("err", r.error || "Couldn't send the invite."); return; }
    setEmail(""); say("ok", "Invite sent — it activates when they sign in with that email.");
    loadRoster(sel);
  };

  const doSetRole = async (uid, nextRole) => { setBusy(true); const r = await setRole(sel, uid, nextRole); setBusy(false); if (!r.ok) say("err", r.error || "Couldn't change the role."); else loadRoster(sel); };
  const doRemove = async (uid) => { setBusy(true); const r = await removeMember(sel, uid); setBusy(false); if (!r.ok) say("err", r.error || "Couldn't remove the member."); else loadRoster(sel); };
  const doCancel = async (id) => { setBusy(true); const r = await cancelInvite(id); setBusy(false); if (!r.ok) say("err", r.error || "Couldn't cancel the invite."); else loadRoster(sel); };
  const doLeave = async () => { setBusy(true); const r = await leaveTeam(sel); setBusy(false); if (r.ok) { say("ok", "You left the team."); await loadTeams(); } else say("err", r.error || "Couldn't leave."); };

  if (teams === null) return <div style={{ fontSize: 12.5, color: PAL.muted, padding: "8px 0" }}>Loading teams…</div>;

  return (
    <div style={{ fontSize: 13, color: PAL.ink }}>
      <div style={{ fontSize: 11.5, color: PAL.muted, lineHeight: 1.5, marginBottom: 12 }}>
        A team is a shared workspace. Projects you share with a team show up for everyone on it,
        who can all open and edit them. Projects stay private until you deliberately share them.
      </div>

      {/* Team picker (when in more than one) */}
      {teams.length > 1 && (
        <select value={sel || ""} onChange={(e) => setSel(e.target.value)} style={{ ...field, marginBottom: 12 }}>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}

      {current ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{current.name}</div>
            <span style={pill(false)}>{current.role}</span>
          </div>

          {/* Roster */}
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted, marginBottom: 6 }}>Members</div>
          <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
            {members.map((m) => (
              <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", border: `1px solid ${PAL.line}`, borderRadius: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.displayName}{m.userId === myUid ? " (you)" : ""}
                  </div>
                  {m.email && m.email !== m.displayName && <div style={{ fontSize: 11, color: PAL.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</div>}
                </div>
                <span style={pill(m.role === "admin")}>{m.role}</span>
                {isAdmin && m.userId !== myUid && (
                  <>
                    <button style={tiny} disabled={busy} onClick={() => doSetRole(m.userId, m.role === "admin" ? "member" : "admin")}>
                      {m.role === "admin" ? "Make member" : "Make admin"}
                    </button>
                    <button style={tiny} disabled={busy} onClick={() => doRemove(m.userId)} title="Remove from team">✕</button>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Pending invites */}
          {invites.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted, marginBottom: 6 }}>Pending invites</div>
              <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
                {invites.map((iv) => (
                  <div key={iv.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", border: `1px dashed ${PAL.line}`, borderRadius: 8 }}>
                    <div style={{ flex: 1, minWidth: 0, color: PAL.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{iv.email}</div>
                    <span style={pill(false)}>{iv.role}</span>
                    {isAdmin && <button style={tiny} disabled={busy} onClick={() => doCancel(iv.id)} title="Cancel invite">✕</button>}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Invite form (admin) */}
          {isAdmin && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted, marginBottom: 6 }}>Invite by email</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="email" autoComplete="off" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...field, flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") doInvite(); }} />
                <select value={role} onChange={(e) => setRoleSel(e.target.value)} style={{ ...field, width: 96, flex: "none" }}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button style={{ ...btn(true), width: "100%", marginTop: 8 }} disabled={busy || !email.trim()} onClick={doInvite}>{busy ? "…" : "Send invite"}</button>
            </div>
          )}

          {/* Leave */}
          <div style={{ height: 1, background: PAL.line, margin: "4px 0 10px" }} />
          {confirmLeave ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: PAL.muted, flex: 1 }}>Leave “{current.name}”?</span>
              <button style={tiny} disabled={busy} onClick={() => setConfirmLeave(false)}>Cancel</button>
              <button style={{ ...tiny, color: "var(--warn-text)" }} disabled={busy} onClick={doLeave}>Leave</button>
            </div>
          ) : (
            <button style={{ ...btn(false), width: "100%" }} disabled={busy} onClick={() => setConfirmLeave(true)}>Leave this team</button>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: PAL.muted, marginBottom: 12 }}>You're not on a team yet.</div>
      )}

      {/* Create a team — always available */}
      <div style={{ height: 1, background: PAL.line, margin: "14px 0 12px" }} />
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted, marginBottom: 6 }}>Create a team</div>
      <div style={{ display: "flex", gap: 6 }}>
        <input placeholder="Team name (e.g. Acme Development)" value={name} onChange={(e) => setName(e.target.value)} style={{ ...field, flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") doCreate(); }} />
        <button style={btn(true)} disabled={busy || !name.trim()} onClick={doCreate}>{busy ? "…" : "Create"}</button>
      </div>
    </div>
  );
}
