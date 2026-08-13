/* Account UI. Logged OUT: a modal with sign-in / sign-up / password-reset, plus a
 * "set new password" form when arriving from a reset link. Logged IN: the SETTINGS panel —
 * four named sections behind a nav (Profile · Team · Account & security · Interface), with
 * Sign out always available (B297/B298, IA rebuilt by NEW-4 — see the note above `SECTIONS`
 * for what folded in and what deliberately did not ship). Auth state is owned by the Shell;
 * this calls the auth wrappers and the profile hook's save/reload passed in via `profileApi`. */
import { lazy, useEffect, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { signIn, signUp, signOut, signOutEverywhere, resetPassword, updatePassword } from "../lib/auth.js";
// The confirmation / reset copy NAMES the address the email arrives from (NEW-2) — a user
// watching for "planyr.io" never finds it otherwise and assumes the signup failed. Both
// messages are generated from the one sender constant in lib/authMail.js.
import { SIGNUP_CONFIRM_MSG, PASSWORD_RESET_MSG } from "../lib/authMail.js";
/* LAZY (B1064 tranche a). This file is reached from the Shell, so it lands in the shared ENTRY
 * chunk — the one chunk EVERY route downloads, planner or not. The Team tab is signed-in-only
 * and opens on an explicit click (the default tab is Profile), so nothing about it belongs on
 * a first paint of any workspace. Moving it out is the one panel in this tranche whose saving
 * lands on all four routes rather than only the Site route. */
const TeamPanel = lazy(() => import("./TeamPanel.jsx"));
import LazyPanel from "./LazyPanel.jsx";
import InterfaceSettings from "../../../shared/ui/InterfaceSettings.jsx";

const PAL = { ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)", accent: "var(--accent)", paper: "var(--surface-raised)" };
const field = { width: "100%", boxSizing: "border-box", padding: "9px 11px", fontSize: 13, border: `1px solid ${PAL.line}`, borderRadius: RADIUS.md, color: PAL.ink, fontFamily: "inherit", marginTop: 6 };
const btn = (primary) => ({ padding: "9px 14px", fontSize: 13, borderRadius: RADIUS.md, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${primary ? PAL.accent : PAL.line}`, background: primary ? PAL.accent : "var(--surface-raised)", color: primary ? "var(--on-accent)" : PAL.ink });
const linkBtn = { border: "none", background: "transparent", color: PAL.accent, cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: "6px 2px" };
const s = (v) => (v == null ? "" : String(v)).trim();

function Wrap({ onClose, children, msg, width = 360, title = "Account" }) {
  const panelRef = useRef(null);
  // Modal a11y (B530 + focus management): Escape-to-close, AND — because role=dialog /
  // aria-modal do NOT actually trap focus in browsers — move focus INTO the dialog on
  // open, TRAP Tab/Shift+Tab inside it, and RESTORE focus to the opener (the Sign-in
  // pill) on close. One handler on the shared Wrap covers every AuthPanel view.
  useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    const getFocusable = () => panel
      ? Array.from(panel.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null)
      : [];
    const init = getFocusable();
    (init.find((el) => el.tagName === "INPUT") || init[0] || panel)?.focus(); // focus in
    const onKey = (e) => {
      if (e.key === "Escape") { onClose && onClose(); return; }
      if (e.key !== "Tab" || !panel) return;
      const els = getFocusable();
      if (!els.length) { e.preventDefault(); panel.focus(); return; }
      const first = els[0], last = els[els.length - 1], active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !panel.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      try { opener && opener.focus && opener.focus(); } catch (_) { /* opener gone — fine */ }
    };
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(20,18,15,0.55)", display: "grid", placeItems: "center" }}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ background: PAL.paper, borderRadius: RADIUS.lg, boxShadow: "0 20px 60px rgba(0,0,0,0.35)", padding: 22, width, maxWidth: "92vw", maxHeight: "88vh", overflowY: "auto", outline: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: PAL.ink }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{ ...btn(false), padding: "4px 10px", fontSize: 12 }}>Close <span aria-hidden="true">✕</span></button>
        </div>
        {children}
        {msg && <div role="alert" aria-live="assertive" style={{ marginTop: 10, fontSize: 12, lineHeight: 1.45, color: msg.type === "err" ? "var(--danger-text)" : "var(--success-text)" }}>{msg.text}</div>}
      </div>
    </div>
  );
}

/* NEW-4 — THE SETTINGS PANEL'S INFORMATION ARCHITECTURE.
 *
 * The report, verbatim: "if I'm in the settings just to change my password, and I don't want it to
 * be right there… let's build out a more professional settings menu." Settings was one tab of three
 * whose entire body WAS the change-password form, so the most consequential control in the account
 * greeted you before anything else.
 *
 * Four named sections behind a nav, and change password is now INSIDE one rather than in front of
 * everything:
 *   profile   — who you are (name, organization, the address you signed in with)
 *   team      — your organization's members (lazy; signed-in only)
 *   security  — Account & security: change password, sign out on all devices
 *   interface — display theme, smooth zoom — anything about the APP rather than about a DRAWING
 *
 * ⛔ PROFILE AND TEAM FOLD IN; THEY ARE NOT A THIRD PARALLEL SURFACE (the owner asked for this to
 * be stated either way). They were already tabs of this same modal — what made them read as a
 * separate surface was that "Settings" sat beside them as a peer, as though profile and team were
 * something other than settings. They are now sections OF Settings, and the account dropdown's
 * three rows became DEEP LINKS into those sections rather than routes to different places. No
 * Shell wiring changed; `initialTab` still takes "profile" / "team" / "settings".
 *
 * ⛔ AND WHAT DID NOT SHIP, deliberately: an "active sessions" list. Enumerating a user's sessions
 * needs the service-role admin API, which may never reach the browser (/CLAUDE.md → KEY DECISIONS).
 * A section that could only have listed this one device would be furniture pretending to be a
 * security feature, so Account & security carries the action that IS real — sign out everywhere —
 * and nothing else. An empty section never ships.
 */
const SECTIONS = [
  { id: "profile",   label: "Profile",   hint: "Name & organization" },
  { id: "team",      label: "Team",      hint: "Who's in your org" },
  { id: "security",  label: "Account & security", hint: "Password, sessions" },
  { id: "interface", label: "Interface", hint: "Theme, zoom" },
];
/* The account dropdown's "Settings" row lands on INTERFACE, not on security. That is the whole
 * point of the item: the front door is the ordinary app preference, and the password is one click
 * away in a section that says what it is. */
const SECTION_ALIAS = { settings: "interface", profile: "profile", team: "team" };

function AccountView({ user, profileApi, initialTab, onClose }) {
  const [tab, setTab] = useState(() => SECTION_ALIAS[initialTab] || "profile");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [org, setOrg] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false); // don't clobber in-progress edits on a background reload

  // Seed the form from the profile row (falling back to the signup metadata), and
  // re-seed if the row arrives/changes — unless the user has started editing.
  const profile = profileApi?.profile;
  useEffect(() => {
    if (dirty.current) return;
    const meta = (user && user.user_metadata) || {};
    const p = profile || {};
    setFirst(s(p.first_name) || s(meta.first_name));
    setLast(s(p.last_name) || s(meta.last_name));
    setOrg(s(p.org) || s(meta.org));
  }, [profile, user]);

  const edit = (setter) => (e) => { dirty.current = true; setter(e.target.value); };

  const saveProfile = async () => {
    if (!first.trim() || !last.trim()) { setMsg({ type: "err", text: "First and last name are required." }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = profileApi?.save
        ? await profileApi.save({ firstName: first, lastName: last, org })
        : { ok: false, error: "Profile not available." };
      if (res.ok) { dirty.current = false; setMsg({ type: "ok", text: "Profile saved." }); }
      else setMsg({ type: "err", text: res.error || "Couldn't save profile." });
    } finally { setBusy(false); }
  };

  const changePassword = async () => {
    setBusy(true); setMsg(null);
    try {
      const { error } = await updatePassword(pw);
      if (error) setMsg({ type: "err", text: error });
      else { setPw(""); setMsg({ type: "ok", text: "Password updated." }); }
    } finally { setBusy(false); }
  };

  const signOutAll = async () => {
    setBusy(true); setMsg(null);
    try {
      const { error } = await signOutEverywhere();
      // LOUD-FAILURE: a security action that quietly fails is worse than one not offered.
      if (error) setMsg({ type: "err", text: error });
      else onClose();
    } finally { setBusy(false); }
  };

  const navBtn = (sec) => {
    const on = tab === sec.id;
    return (
      <button
        key={sec.id}
        data-settings-section={sec.id}
        aria-current={on ? "true" : undefined}
        onClick={() => { setTab(sec.id); setMsg(null); }}
        style={{
          display: "block", width: "100%", textAlign: "left", padding: "7px 9px", borderRadius: RADIUS.md,
          border: `1px solid ${on ? PAL.accent : "transparent"}`, cursor: "pointer", fontFamily: "inherit",
          background: on ? "var(--hover-ghost)" : "transparent", color: PAL.ink,
        }}
      >
        <span style={{ display: "block", fontSize: 12.5, fontWeight: on ? 700 : 500 }}>{sec.label}</span>
        <span style={{ display: "block", fontSize: 10.5, color: PAL.muted }}>{sec.hint}</span>
      </button>
    );
  };

  const sectionHead = (text) => (
    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)", padding: "0 0 8px" }}>{text}</div>
  );

  return (
    <Wrap onClose={onClose} msg={msg} width={560} title="Settings">
      <div className="settings-shell" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <nav className="settings-nav" aria-label="Settings sections">{SECTIONS.map(navBtn)}</nav>
        <div style={{ flex: 1, minWidth: 0 }}>
          {tab === "team" ? (
            <LazyPanel name="The Team section" minHeight={260} label="Loading team…">
              <TeamPanel user={user} setMsg={setMsg} />
            </LazyPanel>
          ) : tab === "profile" ? (
            <div>
              {sectionHead("Profile")}
              <div style={{ fontSize: 12.5, color: PAL.muted }}>Signed in as</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: PAL.ink, wordBreak: "break-all", margin: "1px 0 12px" }}>{user?.email || "(no email)"}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input aria-label="First name" autoComplete="given-name" placeholder="First name" value={first} onChange={edit(setFirst)} style={{ ...field, flex: 1, marginTop: 0 }} />
                <input aria-label="Last name" autoComplete="family-name" placeholder="Last name" value={last} onChange={edit(setLast)} style={{ ...field, flex: 1, marginTop: 0 }} />
              </div>
              <input aria-label="Organization or company" autoComplete="organization" placeholder="Organization / company" value={org} onChange={edit(setOrg)} style={field} />
              <button style={{ ...btn(true), width: "100%", marginTop: 12 }} disabled={busy} onClick={saveProfile}>{busy ? "…" : "Save profile"}</button>
            </div>
          ) : tab === "security" ? (
            <div data-settings-panel="security">
              {sectionHead("Account & security")}
              <div style={{ fontSize: 12.5, fontWeight: 600, color: PAL.ink }}>Change password</div>
              <input aria-label="New password" type="password" autoComplete="new-password" placeholder="New password (min 6 characters)" value={pw} onChange={(e) => setPw(e.target.value)} style={field} onKeyDown={(e) => { if (e.key === "Enter" && pw.length >= 6) changePassword(); }} />
              <button style={{ ...btn(true), width: "100%", marginTop: 10 }} disabled={busy || pw.length < 6} onClick={changePassword}>{busy ? "…" : "Update password"}</button>
              <div style={{ height: 1, background: PAL.line, margin: "16px 0 12px" }} />
              <div style={{ fontSize: 12.5, fontWeight: 600, color: PAL.ink }}>Signed in elsewhere?</div>
              <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.45, margin: "3px 0 9px" }}>
                Ends your session on every device, including this one.
              </div>
              <button style={{ ...btn(false), width: "100%" }} data-testid="sign-out-everywhere" disabled={busy} onClick={signOutAll}>{busy ? "…" : "Sign out on all devices"}</button>
            </div>
          ) : (
            <div data-settings-panel="interface">
              {sectionHead("Interface")}
              {/* Display theme (B389) and smooth zoom (NEW-1) — both per-DEVICE preferences about
                  the app rather than about a drawing, rendered from the ONE shared component so
                  this panel and the signed-out header gear can never disagree. */}
              <InterfaceSettings />
              <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.5, marginTop: 16 }}>
                Your sites and reviews are saved to your account in the cloud and sync across your devices.
              </div>
              {/* Storage on this device (NEW-3/B1429) lives in the planner's plan menu, NOT here —
                  this file lands in the shared ENTRY chunk, so even a lazy stub is downloaded by
                  every route and pushed the Notes route past its bundle ceiling. */}
            </div>
          )}
        </div>
      </div>

      <div style={{ height: 1, background: PAL.line, margin: "16px 0 12px" }} />
      <button style={{ ...btn(false), width: "100%" }} disabled={busy} onClick={async () => { setBusy(true); await signOut(); onClose(); }}>Sign out</button>
    </Wrap>
  );
}

export default function AuthPanel({ user, recovery, profileApi, initialTab, onClose }) {
  const [mode, setMode] = useState(recovery ? "recovery" : "signin"); // signin | signup | reset | recovery
  const [email, setEmail] = useState((user && user.email) || "");
  const [pw, setPw] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [org, setOrg] = useState("");
  const [msg, setMsg] = useState(null); // { type: 'err'|'ok', text }
  const [busy, setBusy] = useState(false);

  // `mode` seeds from `recovery` once at mount; if a reset link fires PASSWORD_RECOVERY
  // while this panel is already open, sync into recovery mode so the set-password form
  // shows (never resets a user's signin↔signup choice — only acts when recovery is true).
  useEffect(() => { if (recovery) setMode("recovery"); }, [recovery]);

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await signIn(email.trim(), pw);
        error ? setMsg({ type: "err", text: error }) : onClose();
      } else if (mode === "signup") {
        if (!first.trim() || !last.trim()) { setMsg({ type: "err", text: "First and last name are required." }); return; }
        const { error, needsConfirm } = await signUp(email.trim(), pw, { firstName: first.trim(), lastName: last.trim(), org: org.trim() });
        if (error) setMsg({ type: "err", text: error });
        else if (needsConfirm) setMsg({ type: "ok", text: SIGNUP_CONFIRM_MSG });
        else onClose();
      } else if (mode === "reset") {
        const { error } = await resetPassword(email.trim());
        setMsg(error ? { type: "err", text: error } : { type: "ok", text: PASSWORD_RESET_MSG });
      } else if (mode === "recovery") {
        const { error } = await updatePassword(pw);
        if (error) setMsg({ type: "err", text: error });
        else { setMsg({ type: "ok", text: "Password updated." }); setTimeout(onClose, 900); }
      }
    } finally { setBusy(false); }
  };

  // Signed-in account view (Profile + Settings) — not while completing a recovery.
  if (user && !recovery) {
    return <AccountView user={user} profileApi={profileApi} initialTab={initialTab} onClose={onClose} />;
  }

  // Set-new-password (arrived from a reset link).
  if (mode === "recovery") {
    return (
      <Wrap onClose={onClose} msg={msg} title="Set a new password">
        <div style={{ fontSize: 13, color: PAL.ink, marginBottom: 2 }}>Set a new password</div>
        <input aria-label="New password" type="password" autoComplete="new-password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} style={field} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <button style={{ ...btn(true), width: "100%", marginTop: 12 }} disabled={busy || pw.length < 6} onClick={submit}>{busy ? "…" : "Update password"}</button>
      </Wrap>
    );
  }

  // Logged-out forms: signin / signup / reset.
  return (
    <Wrap onClose={onClose} msg={msg} title={mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password"}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <button style={{ ...btn(mode === "signin"), flex: 1, padding: "7px 0" }} onClick={() => { setMode("signin"); setMsg(null); }}>Sign in</button>
        <button style={{ ...btn(mode === "signup"), flex: 1, padding: "7px 0" }} onClick={() => { setMode("signup"); setMsg(null); }}>Sign up</button>
      </div>
      {mode === "signup" && (
        <>
          <div style={{ display: "flex", gap: 6 }}>
            <input aria-label="First name" autoComplete="given-name" placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} style={{ ...field, flex: 1 }} />
            <input aria-label="Last name" autoComplete="family-name" placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} style={{ ...field, flex: 1 }} />
          </div>
          <input aria-label="Organization or company" autoComplete="organization" placeholder="Organization / company" value={org} onChange={(e) => setOrg(e.target.value)} style={field} />
        </>
      )}
      <input aria-label="Email" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
      {mode !== "reset" && (
        <input aria-label="Password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={field} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      )}
      <button data-testid="auth-submit" style={{ ...btn(true), width: "100%", marginTop: 12 }} disabled={busy || !email || (mode !== "reset" && pw.length < 6)}
        onClick={submit}>{busy ? "…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset email"}</button>
      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        {mode === "reset"
          ? <button style={linkBtn} onClick={() => { setMode("signin"); setMsg(null); }}>← Back to sign in</button>
          : <button style={linkBtn} onClick={() => { setMode("reset"); setMsg(null); }}>Forgot password?</button>}
        {mode === "signup" && <span style={{ color: PAL.muted }}>Min 6 characters</span>}
      </div>
    </Wrap>
  );
}
