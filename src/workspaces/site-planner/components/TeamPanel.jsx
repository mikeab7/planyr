/* Team workspace management (team feature) — the "Team" tab in the signed-in Account panel.
 * Redesigned 2026-10-03 (NEW-1): grouped by role (lib/teamRoster.js), phone + desktop. A team home: see who's on the team, invite people (admin), rename/delete the team (admin),
 * change roles, or leave. A brand-new team leads with an invite-first prompt. All I/O goes
 * through lib/teams.js (RLS-scoped). Theme tokens only — no raw hex (owner theming rule).
 * Signed-in only (the Account panel only mounts this when there's a user). */
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  listMyTeams, listMembers, listInvites, createTeam, inviteByEmail,
  setRole, removeMember, cancelInvite, leaveTeam, renameTeam, deleteTeam, resendInvite,
} from "../lib/teams.js";
import { loadSitesList } from "../lib/storage.js";
/* ⛔ THESE TWO IMPORTS ARE STATIC ON PURPOSE, AND THAT WAS MEASURED RATHER THAN ASSUMED.
 * The Team tab is lazy while `SitePlanner.jsx` imports `userPrefs.js` statically, so this module
 * has consumers in two tiers and Rollup gives it its own shared chunk — the same mechanical
 * outcome `teams.js` already has, recorded in ui-audit/perf-budgets.json's siteRouteAllowlist.
 * The Site route downloads the SAME BYTES in one more file; it is not route pollution.
 * ⚠ Three "tidier" dynamic-import arrangements were tried first and every one was WORSE, because
 * a dynamic import CREATES a chunk rather than moving one: dynamic here → `siteRouteChunks` 7→8,
 * dynamic for both modules → 7→9. Static keeps the count at 7. Do not re-litigate this by
 * converting either import to `import()` — run `npm run perf:bundle` if tempted, since lint,
 * tests and build are all green either way and only that audit can see the difference. */
import { normalizeSharePref, resetShareContext } from "../lib/newProjectSharing.js";
import { loadUserPrefs, saveUserPrefs } from "../lib/userPrefs.js";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { groupRoster, canManage, initialsOf, countsLine, resendCooldownMs } from "../lib/teamRoster.js";

const PAL = { ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)", accent: "var(--accent)", paper: "var(--surface-raised)", danger: "var(--danger)" };
const field = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, border: `1px solid ${PAL.line}`, borderRadius: 8, color: PAL.ink, fontFamily: "inherit", background: "var(--surface-default)" };
const btn = (primary) => ({ padding: "8px 12px", fontSize: 12.5, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${primary ? PAL.accent : PAL.line}`, background: primary ? PAL.accent : "var(--surface-raised)", color: primary ? "var(--on-accent)" : PAL.ink });
const tiny = { ...btn(false), padding: "3px 8px", fontSize: 11 };
const menuItem = (danger) => ({ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", fontSize: 13, border: "none", borderBottom: `1px solid ${PAL.line}`, background: "transparent", cursor: "pointer", fontFamily: "inherit", color: danger ? PAL.danger : PAL.ink });

/* Settings › Team layout (NEW-1). One rhythm: SECTION_GAP between every section, LABEL_GAP between a
 * label and its card. GUTTER is the card's inner padding — labels sit on it so they line up with the
 * avatars, not the card edge. */
const SECTION_GAP = 18, LABEL_GAP = 6, GUTTER = 14, AV = 36;
const label = { fontSize: FONT_SIZE.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted, marginBottom: 6 }; // create-team blocks
const sectionLabel = { fontSize: FONT_SIZE.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted, margin: `0 0 ${LABEL_GAP}px ${GUTTER}px` };
const card = { background: "var(--surface-field)", border: `1px solid ${PAL.line}`, borderRadius: RADIUS.lg, overflow: "hidden" };
const avatar = { width: AV, height: AV, flex: "none", borderRadius: RADIUS.pill, display: "grid", placeItems: "center", fontSize: FONT_SIZE.emphasis, fontWeight: 700, background: "var(--hover-ghost)", color: PAL.ink, boxSizing: "border-box" };
const moreBtn = (touch) => ({ width: touch ? 44 : 36, height: touch ? 44 : 36, flex: "none", display: "grid", placeItems: "center end", background: "transparent", border: "none", borderRadius: RADIUS.md, color: PAL.ink, fontSize: 20 /* design-exempt: the ⋯ glyph size, scaled to its own 44px touch target */, fontWeight: 700, lineHeight: 1, cursor: "pointer", fontFamily: "inherit", padding: touch ? "0 4px 0 0" : 0, margin: touch ? "-6px -8px -6px 0" : "0 -4px 0 0" });
const linkBtnStyle = { background: "none", border: "none", color: PAL.accent, fontSize: FONT_SIZE.control, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: 0, whiteSpace: "nowrap", flex: "none" };
const infoBtn = { width: 22, height: 22, flex: "none", borderRadius: RADIUS.pill, border: `1px solid ${PAL.muted}`, background: "transparent", color: PAL.muted, fontSize: FONT_SIZE.control, fontWeight: 700, fontStyle: "italic", fontFamily: "Georgia, serif", cursor: "pointer", padding: 0, display: "grid", placeItems: "center" };
const switchTrack = (on) => ({ position: "relative", width: 44, height: 26, flex: "none", borderRadius: RADIUS.pill, border: `1px solid ${on ? PAL.accent : PAL.line}`, background: on ? PAL.accent : "var(--hover-ghost)", cursor: "pointer", padding: 0, margin: "0 -4px 0 0" });
const switchKnob = (on) => ({ position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: RADIUS.pill, background: on ? "var(--on-accent)" : PAL.muted, transition: "left .12s" });
const tile = { height: 76, boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, background: "var(--surface-field)", border: `1px solid ${PAL.line}`, borderRadius: RADIUS.lg, color: PAL.ink, padding: 0 };
const tileNum = { fontSize: 24 /* design-exempt: the stat tile's hero numeral, same reasoning as the dashboard KPI figures */, fontWeight: 700, lineHeight: 1.1 };
const tileLbl = { fontSize: FONT_SIZE.control, color: PAL.muted, lineHeight: 1.2 };

function EnvelopeIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><rect x="1.5" y="3" width="13" height="10" rx="1.5" /><path d="M2 4l6 5 6-5" strokeLinecap="round" /></svg>;
}

const NARROW_Q = "(max-width: 560px)"; // same breakpoint as AuthPanel's phone drill-in
function useNarrow() {
  const read = () => { try { return !!(window.matchMedia && window.matchMedia(NARROW_Q).matches); } catch (_) { return false; } };
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    let mq; try { mq = window.matchMedia(NARROW_Q); } catch (_) { return undefined; }
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);
  return narrow;
}

export default function TeamPanel({ user, setMsg, onTitle }) {
  const narrow = useNarrow();
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
  const infoRef = useRef(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [personMenu, setPersonMenu] = useState(null); // { row, anchor } — the ⋯ menu / sheet

  const say = useCallback((type, text) => setMsg && setMsg(text ? { type, text } : null), [setMsg]);

  /* B326418 — the account-level "new projects are shared by default" switch. Account-scoped
   * rather than team-scoped on purpose: it governs what happens to projects YOU create, so one
   * teammate must not be able to change it for everyone. */
  const [sharePref, setSharePref] = useState(null);   // null = still loading (no static default needed)
  const [sharePrefBusy, setSharePrefBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    loadUserPrefs(myUid)
      .then((r) => { if (alive) setSharePref(normalizeSharePref(r && r.prefs && r.prefs.newProjectSharing)); })
      .catch(() => { if (alive) setSharePref(normalizeSharePref(null)); });
    return () => { alive = false; };
  }, [myUid]);

  // LOUD-FAILURE: a preference that only saved on this computer says so, rather than showing a
  // tick that quietly means nothing on the owner's other machine.
  const saveSharePref = async (next) => {
    const clean = normalizeSharePref(next);
    setSharePref(clean); setSharePrefBusy(true); say();
    try {
      const cur = await loadUserPrefs(myUid);
      const res = await saveUserPrefs(myUid, { ...(cur && cur.prefs), newProjectSharing: clean });
      if (!res.ok) say("err", `Saved on this computer only — ${res.error || "couldn't reach the cloud"}.`);
      else { resetShareContext(); say("ok", clean.enabled ? "New projects will be shared with your team." : "New projects will be private."); }
    } catch (e) {
      say("err", `Couldn't save that — ${(e && e.message) || "unknown error"}.`);
    } finally { setSharePrefBusy(false); }
  };

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
  const currentName = current ? current.name : null;
  useEffect(() => { if (onTitle) onTitle(currentName); return () => { if (onTitle) onTitle(null); }; }, [onTitle, currentName]);
  const isAdmin = current && current.role === "admin";

  const loadRoster = useCallback(async (teamId) => {
    if (!teamId) { setMembers([]); setInvites([]); return; }
    setMembers(await listMembers(teamId));
    setInvites(await listInvites(teamId));
  }, []);
  useEffect(() => { loadRoster(sel); setConfirmLeave(false); setConfirmDelete(false); setMenuOpen(false); setRenaming(false); setPersonMenu(null); setShowInvite(false); }, [sel, loadRoster]);

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
    const sentTo = email.trim().toLowerCase();
    setEmail(""); setShowInvite(false);
    if (r.emailed) { markSent(sentTo); say("ok", `Invite sent to ${sentTo}`); }
    else say("err", "Invite saved, but the email didn't send. Try Resend.");
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
  // Resend throttle (NEW-1): disabled for ~a minute after any send; the server enforces the same window.
  const [sentAt, setSentAt] = useState({});   // lower-cased email -> ms of the last send from this tab
  const [clock, setClock] = useState(() => Date.now());
  const markSent = (em) => { const t = Date.now(); setSentAt((m) => ({ ...m, [em]: t })); setClock(t); };
  const cooldown = (iv) => resendCooldownMs(Math.max(sentAt[String(iv.email).toLowerCase()] || 0, Date.parse(iv.lastSentAt || "") || 0), clock);
  useEffect(() => {
    const left = Object.values(sentAt).concat(invites.map((i) => Date.parse(i.lastSentAt || "") || 0)).map((t) => resendCooldownMs(t, clock)).filter((x) => x > 0);
    if (!left.length) return undefined;
    const id = setTimeout(() => setClock(Date.now()), Math.min(...left) + 50);
    return () => clearTimeout(id);
  }, [sentAt, invites, clock]);
  const doResend = async (iv) => {
    if (cooldown(iv) > 0) return;
    setBusy(true); const r = await resendInvite(sel, iv.email); setBusy(false);
    if (r.ok) { markSent(String(iv.email).toLowerCase()); say("ok", "Invite email sent again"); return; }
    if (r.throttled) { setSentAt((m) => ({ ...m, [String(iv.email).toLowerCase()]: Date.now() })); setClock(Date.now()); say("err", r.error); return; }
    say("err", "Invite saved, but the email didn't send. Try Resend.");
  };

  // Escape closes the open ⋯ menu / info popover first, not the whole Settings dialog behind it
  // (the dialog's own Escape handler is a document-level capture; window capture runs before it).
  const anyOpen = !!personMenu || infoOpen || menuOpen;
  useEffect(() => {
    if (!anyOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setPersonMenu(null); setInfoOpen(false); setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [anyOpen]);

  const openMenu = (row, el) => { setPersonMenu({ row, anchor: { current: el } }); };
  const closeMenu = () => setPersonMenu(null);

  if (teams === null) return <div style={{ fontSize: 12.5, color: PAL.muted, padding: "8px 0" }}>Loading teams…</div>;

  // Shared invite form (used both in the new-team prompt and when the Invite control is opened).
  const inviteForm = (
    <div>
      <div style={{ display: "flex", gap: 6 }}>
        <input type="email" autoComplete="off" aria-label="Email address" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...field, flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") doInvite(); }} />
        <select aria-label="Role" value={role} onChange={(e) => setRoleSel(e.target.value)} style={{ ...field, width: 96, flex: "none" }}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button style={{ ...btn(true), width: "100%", marginTop: 8 }} disabled={busy || !email.trim()} onClick={doInvite}>{busy ? "…" : "Send invite"}</button>
    </div>
  );

  const isNewTeam = isAdmin && members.length <= 1 && invites.length === 0;
  const { sections, memberCount } = groupRoster(members, invites, myUid);
  const initial = (r) => initialsOf(r.kind === "invite" ? "" : r.name, r.email);

  const menuRows = (row) => {
    const item = (label, onClick, opts = {}) => (
      <button key={label} role="menuitem" data-team-menu-item={label} style={{ ...menuItem(!!opts.danger), minHeight: narrow ? 48 : undefined, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "none" }} disabled={busy || !!opts.disabled} onClick={() => { closeMenu(); onClick(); }}>
        <span>{label}</span>{opts.check && <span aria-hidden="true" style={{ color: PAL.accent, fontWeight: 700 }}>✓</span>}
      </button>
    );
    if (row.kind === "invite") return [item("Resend invite", () => doResend(row), { disabled: cooldown(row) > 0 }), item("Cancel invite", () => doCancel(row.id), { danger: true })];
    return [
      item("Admin", () => row.role !== "admin" && doSetRole(row.id, "admin"), { check: row.role === "admin" }),
      item("Member", () => row.role !== "member" && doSetRole(row.id, "member"), { check: row.role === "member" }),
      <div key="gap" style={{ height: 8 }} />,
      item("Remove from team", () => doRemove(row.id), { danger: true }),
    ];
  };

  // A render FUNCTION, not a component: a component defined here is a new type every render, so the
  // click that opens the ⋯ menu remounted the row and detached the very button the menu anchors to
  // (B2038784 amendment — the menu measured a detached node and stayed at left:-9999px, opacity 0).
  const renderRow = (r, first) => (
    <div key={`${r.kind}:${r.id}`} data-team-row={r.kind} data-team-row-role={r.role} style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, padding: `${narrow ? 10 : 9}px ${GUTTER}px ${narrow ? 10 : 9}px ${GUTTER}px`, minHeight: narrow ? 56 : 52 }}>
      {!first && <div aria-hidden="true" style={{ position: "absolute", top: 0, right: 0, left: GUTTER + AV + 12, height: 1, background: PAL.line }} />}
      {r.kind === "invite"
        ? <span aria-hidden="true" style={{ ...avatar, border: `1.5px dashed ${PAL.muted}`, background: "transparent", color: PAL.muted }}><EnvelopeIcon /></span>
        : <span aria-hidden="true" style={avatar}>{initial(r)}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        {r.kind === "invite" ? (
          /* An invite's email is the ONLY identifier on the row, so it WRAPS (after the @ if it must)
             rather than truncating; the status and Resend wrap onto further lines instead of cutting. */
          <>
            <div data-team-invite-email style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere", lineHeight: 1.3 }}>
              {r.email.split("@")[0]}{r.email.includes("@") && <>@<wbr />{r.email.split("@").slice(1).join("@")}</>}
            </div>
            <div style={{ fontSize: 12, color: PAL.muted, display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 4 }}>
              <span>{r.role === "admin" ? "Admin" : "Member"} · not joined yet</span>
              {canManage(r, isAdmin) && !narrow && (
                <>
                  <span aria-hidden="true">·</span>
                  <button data-team-resend style={linkBtnStyle} disabled={busy || cooldown(r) > 0} onClick={() => doResend(r)}>Resend invite</button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {r.name}{r.isYou && <span style={{ fontWeight: 400, color: PAL.muted }}> · You</span>}
            </div>
            <div style={{ fontSize: 12, color: PAL.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.email}</div>
          </>
        )}
      </div>
      {canManage(r, isAdmin) && (
        <button data-team-more aria-label={`Options for ${r.name}`} aria-haspopup="menu" disabled={busy} onClick={(e) => openMenu(r, e.currentTarget)} style={moreBtn(narrow)}>⋯</button>
      )}
    </div>
  );

  const rosterSections = sections.map((s) => (
    <div key={s.id} data-team-section={s.id} style={{ marginTop: SECTION_GAP }}>
      <div style={sectionLabel}>{s.label}</div>
      <div style={card}>{s.rows.map((r, i) => renderRow(r, i === 0))}</div>
    </div>
  ));

  const sharingSection = sharePref && (
    <div data-team-section="sharing" style={{ marginTop: SECTION_GAP }}>
      <div style={sectionLabel}>Sharing</div>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: `10px ${GUTTER}px`, minHeight: narrow ? 56 : 52 }}>
          <span id="team-autoshare-label" style={{ fontSize: 14, fontWeight: 600, minWidth: 0 }}>Auto-share new site plans</span>
          <button ref={infoRef} data-team-info aria-label="About auto-sharing" aria-expanded={infoOpen} onClick={() => setInfoOpen((o) => !o)} style={infoBtn}>i</button>
          <span style={{ flex: 1 }} />
          <button
            role="switch" aria-checked={sharePref.enabled} aria-labelledby="team-autoshare-label" data-team-autoshare
            disabled={sharePrefBusy}
            onClick={() => saveSharePref({ ...sharePref, enabled: !sharePref.enabled })}
            style={switchTrack(sharePref.enabled)}
          ><span aria-hidden="true" style={switchKnob(sharePref.enabled)} /></button>
        </div>
        {/* Several teams and none chosen resolves to PRIVATE, so the panel has to say which
            team it would be — otherwise "on" silently does nothing (LOUD-FAILURE). */}
        {sharePref.enabled && teams && teams.length > 1 && (
          <div style={{ padding: `0 ${GUTTER}px 12px` }}>
            <select aria-label="Team for new projects" style={field} value={sharePref.teamId || ""} disabled={sharePrefBusy} onChange={(e) => saveSharePref({ ...sharePref, teamId: e.target.value || null })}>
              <option value="">Pick a team — new projects stay private until you do</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <AnchoredMenu open={infoOpen} onClose={() => setInfoOpen(false)} anchorRef={infoRef} placement="below-left" width={260} zIndex={6000} panelStyle={{ background: "var(--surface-raised)", border: `1px solid ${PAL.line}`, borderRadius: RADIUS.md, boxShadow: "0 12px 32px rgba(0,0,0,0.22)", padding: "10px 12px", fontSize: 12, lineHeight: 1.45, color: PAL.ink }}>
        Applies only to projects you create from now on — nothing you already have changes.
        Site plans only; your notes, library, review and schedule stay private.
      </AnchoredMenu>
    </div>
  );

  const teamMenu = isAdmin && !renaming && (
    <>
      <button ref={menuRef} data-team-menu aria-label="Team settings" aria-haspopup="menu" style={narrow ? { ...moreBtn(true), margin: 0, border: `1px solid ${PAL.line}`, borderRadius: RADIUS.md } : { ...moreBtn(false), margin: `0 ${GUTTER - 3}px 0 0` }} disabled={busy} onClick={() => setMenuOpen((o) => !o)}>⋯</button>
      <AnchoredMenu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuRef} placement="below-right" width={180} zIndex={6000} panelStyle={{ background: "var(--surface-raised)", border: `1px solid ${PAL.line}`, borderRadius: RADIUS.md, boxShadow: "0 12px 32px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        <button style={menuItem(false)} onClick={startRename}>Rename team</button>
        <button style={{ ...menuItem(true), borderBottom: "none" }} onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}>Delete team</button>
      </AnchoredMenu>
    </>
  );

  const inviteBtn = isAdmin && (
    <button data-team-invite onClick={() => setShowInvite((o) => !o)} aria-expanded={showInvite || isNewTeam} style={{ ...btn(true), padding: "9px 14px", fontSize: 13 }}>+ Invite</button>
  );

  return (
    <div data-team-panel data-team-layout={narrow ? "phone" : "desktop"} style={{ fontSize: 13, color: PAL.ink }}>
      {/* Team picker (when in more than one) */}
      {teams.length > 1 && (
        <select aria-label="Team" value={sel || ""} onChange={(e) => setSel(e.target.value)} style={{ ...field, marginBottom: 12 }}>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}

      {current ? (
        <>
          {/* Desktop pane header: name + counts left; Invite · team ⋯ right. (Phone: the page header
              carries the team name; stat tiles carry the counts and the Invite action.) */}
          {renaming ? (
            <input autoFocus aria-label="Team name" value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); else if (e.key === "Escape") setRenaming(false); }}
              style={{ ...field, fontSize: 15, fontWeight: 700, marginBottom: 8 }} />
          ) : null}
          {!narrow && (
            <div data-team-header style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 20 /* design-exempt: pane-header team name */, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current.name}</div>
                <div style={{ fontSize: 12, color: PAL.muted }}>{countsLine(memberCount, sharedCount)}</div>
              </div>
              {inviteBtn}
              {teamMenu}
            </div>
          )}
          {narrow && (
            <div data-team-tiles style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <div style={tile}><span style={tileNum}>{memberCount}</span><span style={tileLbl}>Members</span></div>
              <div style={tile}><span style={tileNum}>{sharedCount}</span><span style={tileLbl}>Projects</span></div>
              {isAdmin
                ? <button data-team-invite onClick={() => setShowInvite((o) => !o)} aria-label="Invite" aria-expanded={showInvite || isNewTeam} style={{ ...tile, background: PAL.accent, borderColor: PAL.accent, color: "var(--on-accent)", cursor: "pointer", fontFamily: "inherit" }}><span style={{ ...tileNum, fontWeight: 500 }}>+</span><span style={{ ...tileLbl, color: "var(--on-accent)" }}>Invite</span></button>
                : <div style={{ ...tile, visibility: "hidden" }} aria-hidden="true" />}
            </div>
          )}

          {/* Delete confirm (inline, no dialog) */}
          {confirmDelete && (
            <div style={{ border: `1px solid ${PAL.danger}`, borderRadius: RADIUS.md, padding: 12, marginTop: SECTION_GAP }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Delete “{current.name}”?</div>
              <div style={{ fontSize: 11.5, color: PAL.muted, marginBottom: 10 }}>The team and its invites are removed for everyone. Shared projects become private again — no project is deleted.</div>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button style={tiny} disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button style={{ ...tiny, borderColor: PAL.danger, color: PAL.danger }} disabled={busy} onClick={doDelete}>{busy ? "…" : "Delete team"}</button>
              </div>
            </div>
          )}

          {/* Invite flow (existing form) — opened by Invite; a brand-new team leads with it. */}
          {isAdmin && (isNewTeam || showInvite) && (
            <div data-team-invite-form style={{ border: `1px solid ${isNewTeam ? PAL.accent : PAL.line}`, borderRadius: RADIUS.md, padding: 12, marginTop: SECTION_GAP }}>
              {isNewTeam && <div style={{ fontWeight: 700, marginBottom: 3 }}>Your team is ready 🎉</div>}
              {isNewTeam && <div style={{ fontSize: 11.5, color: PAL.muted, marginBottom: 10 }}>Add people to start sharing projects. They get access the moment they sign in with the invited email.</div>}
              {inviteForm}
            </div>
          )}

          {rosterSections}
          {sharingSection}

          {/* Leave */}
          <div style={{ height: 1, background: PAL.line, margin: `${SECTION_GAP}px 0 10px` }} />
          {confirmLeave ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: PAL.muted, flex: 1 }}>Leave “{current.name}”?</span>
              <button style={tiny} disabled={busy} onClick={() => setConfirmLeave(false)}>Cancel</button>
              <button style={{ ...tiny, color: "var(--warn-text)" }} disabled={busy} onClick={doLeave}>Leave</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button style={{ ...btn(false), flex: 1 }} disabled={busy} onClick={() => setConfirmLeave(true)}>Leave this team</button>
              {narrow && teamMenu}
            </div>
          )}

          {/* Person ⋯ menu: phone = bottom sheet, desktop = dropdown. Same items either way. */}
          {personMenu && narrow && (
            <div onClick={closeMenu} style={{ position: "fixed", inset: 0, zIndex: 6000, background: "rgba(20,18,15,0.45)", display: "flex", alignItems: "flex-end" }}>
              <div role="dialog" aria-label={`Options for ${personMenu.row.name}`} data-team-sheet onClick={(e) => e.stopPropagation()} style={{ width: "100%", background: PAL.paper, borderRadius: `${RADIUS.lg}px ${RADIUS.lg}px 0 0`, padding: "14px 14px calc(14px + env(safe-area-inset-bottom, 0px))", boxShadow: "0 -12px 40px rgba(0,0,0,0.3)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "2px 4px 12px", borderBottom: `1px solid ${PAL.line}`, marginBottom: 6 }}>
                  {personMenu.row.kind === "invite"
                    ? <span aria-hidden="true" style={{ ...avatar, border: `1.5px dashed ${PAL.muted}`, background: "transparent", color: PAL.muted }}><EnvelopeIcon /></span>
                    : <span aria-hidden="true" style={avatar}>{initial(personMenu.row)}</span>}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{personMenu.row.name}</div>
                    {personMenu.row.kind !== "invite" && <div style={{ fontSize: 12, color: PAL.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{personMenu.row.email}</div>}
                  </div>
                </div>
                {menuRows(personMenu.row)}
              </div>
            </div>
          )}
          {personMenu && !narrow && (
            <AnchoredMenu open onClose={closeMenu} anchorRef={personMenu.anchor} placement="below-right" width={200} zIndex={6000} panelStyle={{ background: "var(--surface-raised)", border: `1px solid ${PAL.line}`, borderRadius: RADIUS.md, boxShadow: "0 12px 32px rgba(0,0,0,0.22)", overflow: "hidden", padding: 4 }}>
              <div data-team-dropdown>{menuRows(personMenu.row)}</div>
            </AnchoredMenu>
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

