/* Team workspace management (team feature) — the "Team" tab in the signed-in Account panel.
 * A team home: see who's on the team, invite people (admin), rename/delete the team (admin),
 * change roles, or leave. A brand-new team leads with an invite-first prompt. All I/O goes
 * through lib/teams.js (RLS-scoped). Theme tokens only — no raw hex (owner theming rule).
 * Signed-in only (the Account panel only mounts this when there's a user). */
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  listMyTeams, listMembers, listInvites, createTeam, inviteByEmail,
  setRole, removeMember, cancelInvite, leaveTeam, renameTeam, deleteTeam,
} from "../lib/teams.js";
import { loadSitesList } from "../lib/storage.js";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";

const PAL = { ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)", accent: "var(--accent)", paper: "var(--surface-raised)", danger: "var(--danger)" };
const field = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, border: `1px solid ${PAL.line}`, borderRadius: 8, color: PAL.ink, fontFamily: "inherit", background: "var(--surface-default)" };
const btn = (primary) => ({ padding: "8px 12px", fontSize: 12.5, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${primary ? PAL.accent : PAL.line}`, background: primary ? PAL.accent : "var(--surface-raised)", color: primary ? "var(--on-accent)" : PAL.ink });
const tiny = { ...btn(false), padding: "3px 8px", fontSize: 11 };
const iconBtn = { ...btn(false), padding: "3px 9px", fontSize: 15, lineHeight: 1, fontWeight: 700 };
const pill = (on) => ({ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "2px 7px", borderRadius: 999, border: `1px solid ${PAL.line}`, color: on ? "var(--on-accent)" : PAL.muted, background: on ? PAL.accent : "transparent" });
const label = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted, marginBottom: 6 };
const menuItem = (danger) => ({ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", fontSize: 13, border: "none", borderBottom: `1px solid ${PAL.line}`, background: "transparent", cursor: "pointer", fontFamily: "inherit", color: danger ? PAL.danger : PAL.ink });

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const menuRef = useRef(null);

  const say = useCallback((type, text) => setMsg && setMsg(text ? { type, text } : null), [setMsg]);

  // List my teams, preferring a specific team id for selection (e.g. a just-created one) so the
  // view flips to it deterministically in a single state update.
  const loadTeams = useCallback(async (preferId) => {
    try {
      const list = await listMyTeams();
      setTeams(list);
      setSel((cur) => {
        const want = preferId || cur;
        return (want && list.some((t) => t.id === want)) ? want : (list[0] ? list[0].id : null);
      });
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
  useEffect(() => { loadRoster(sel); setConfirmLeave(false); setConfirmDelete(false); setMenuOpen(false); setRenaming(false); }, [sel, loadRoster]);

  // How many of my projects are shared with the selected team (local cache; secondary nicety).
  const sharedCount = useMemo(() => {
    if (!current) return 0;
    try {
      const groups = new Set();
      loadSitesList().forEach((sm) => { if ((sm.teamId || null) === current.id) groups.add(sm.groupId || sm.id); });
      return groups.size;
    } catch (_) { return 0; }
  }, [current]);

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
    setName(""); setShowCreate(false); say("ok", "Team created.");
    await loadTeams(r.teamId);
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
  const doLeave = async () => { setBusy(true); const r = await leaveTeam(sel); setBusy(false); if (r.ok) { say("ok", "You left the team."); setSel(null); await loadTeams(); } else say("err", r.error || "Couldn't leave."); };
  const doDelete = async () => { setBusy(true); const r = await deleteTeam(sel); setBusy(false); if (r.ok) { say("ok", "Team deleted."); setConfirmDelete(false); setSel(null); await loadTeams(); } else say("err", r.error || "Couldn't delete the team."); };

  const startRename = () => { setMenuOpen(false); setRenameVal(current.name); setRenaming(true); };
  const commitRename = async () => {
    const v = renameVal.trim();
    setRenaming(false);
    if (!v || !current || v === current.name) return;
    setBusy(true); const r = await renameTeam(sel, v); setBusy(false);
    if (r.ok) { say("ok", "Team renamed."); await loadTeams(sel); } else say("err", r.error || "Couldn't rename the team.");
  };

  if (teams === null) return <div style={{ fontSize: 12.5, color: PAL.muted, padding: "8px 0" }}>Loading teams…</div>;

  // Shared invite form (used both in the new-team prompt and the established-team footer).
  const inviteForm = (
    <div>
      <div style={{ display: "flex", gap: 6 }}>
        <input type="email" autoComplete="off" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...field, flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") doInvite(); }} />
        <select value={role} onChange={(e) => setRoleSel(e.target.value)} style={{ ...field, width: 96, flex: "none" }}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button style={{ ...btn(true), width: "100%", marginTop: 8 }} disabled={busy || !email.trim()} onClick={doInvite}>{busy ? "…" : "Send invite"}</button>
    </div>
  );

  const isNewTeam = isAdmin && members.length <= 1 && invites.length === 0;

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
          {/* Header: name (inline-rename for admins) + role + admin menu */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            {renaming ? (
              <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); else if (e.key === "Escape") setRenaming(false); }}
                style={{ ...field, fontSize: 15, fontWeight: 700, flex: 1 }} />
            ) : (
              <div style={{ fontSize: 16, fontWeight: 700, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current.name}</div>
            )}
            <span style={pill(isAdmin)}>{current.role}</span>
            {isAdmin && !renaming && (
              <button ref={menuRef} style={iconBtn} disabled={busy} onClick={() => setMenuOpen((o) => !o)} title="Team settings">⋯</button>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: PAL.muted, marginBottom: 14 }}>
            {members.length} member{members.length === 1 ? "" : "s"}{sharedCount > 0 ? ` · ${sharedCount} project${sharedCount === 1 ? "" : "s"} shared` : ""}
          </div>

          <AnchoredMenu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuRef} placement="below-right" width={180} zIndex={6000} panelStyle={{ background: "var(--surface-raised)", border: `1px solid ${PAL.line}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,0.22)", overflow: "hidden" }}>
            <button style={menuItem(false)} onClick={startRename}>Rename team</button>
            <button style={{ ...menuItem(true), borderBottom: "none" }} onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}>Delete team</button>
          </AnchoredMenu>

          {/* Delete confirm (inline, no dialog) */}
          {confirmDelete && (
            <div style={{ border: `1px solid ${PAL.danger}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Delete “{current.name}”?</div>
              <div style={{ fontSize: 11.5, color: PAL.muted, marginBottom: 10 }}>The team and its invites are removed for everyone. Shared projects become private again — no project is deleted.</div>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button style={tiny} disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button style={{ ...tiny, borderColor: PAL.danger, color: PAL.danger }} disabled={busy} onClick={doDelete}>{busy ? "…" : "Delete team"}</button>
              </div>
            </div>
          )}

          {/* New-team onboarding: lead with inviting people */}
          {isNewTeam && (
            <div style={{ border: `1px solid ${PAL.accent}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>Your team is ready 🎉</div>
              <div style={{ fontSize: 11.5, color: PAL.muted, marginBottom: 10 }}>Add people to start sharing projects. They get access the moment they sign in with the invited email.</div>
              {inviteForm}
            </div>
          )}

          {/* Roster */}
          <div style={label}>Members</div>
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
              <div style={label}>Pending invites</div>
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

          {/* Invite form (admin, established team) */}
          {isAdmin && !isNewTeam && (
            <div style={{ marginBottom: 14 }}>
              <div style={label}>Invite by email</div>
              {inviteForm}
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

      {/* Create a team — primary call-to-action when you have none, a secondary toggle otherwise */}
      {teams.length === 0 ? (
        <>
          <div style={{ height: 1, background: PAL.line, margin: "14px 0 12px" }} />
          <div style={label}>Create a team</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input placeholder="Team name (e.g. Acme Development)" value={name} onChange={(e) => setName(e.target.value)} style={{ ...field, flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") doCreate(); }} />
            <button style={btn(true)} disabled={busy || !name.trim()} onClick={doCreate}>{busy ? "…" : "Create"}</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ height: 1, background: PAL.line, margin: "14px 0 12px" }} />
          {showCreate ? (
            <div>
              <div style={label}>Create another team</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input autoFocus placeholder="Team name (e.g. Acme Development)" value={name} onChange={(e) => setName(e.target.value)} style={{ ...field, flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") doCreate(); else if (e.key === "Escape") { setShowCreate(false); setName(""); } }} />
                <button style={btn(true)} disabled={busy || !name.trim()} onClick={doCreate}>{busy ? "…" : "Create"}</button>
                <button style={btn(false)} disabled={busy} onClick={() => { setShowCreate(false); setName(""); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button style={{ ...tiny, padding: "6px 12px" }} onClick={() => setShowCreate(true)}>+ New team</button>
          )}
        </>
      )}
    </div>
  );
}
