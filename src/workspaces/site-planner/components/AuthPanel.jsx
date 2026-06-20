/* Account UI. Logged OUT: a modal with sign-in / sign-up / password-reset, plus a
 * "set new password" form when arriving from a reset link. Logged IN: a tabbed
 * account panel — Profile (edit name + organization, saved to public.profiles) and
 * Settings (change password, cloud-sync note) — with Sign out always available
 * (B297/B298). Auth state is owned by the Shell; this calls the auth wrappers and
 * the profile hook's save/reload passed in via `profileApi`. */
import { useEffect, useRef, useState } from "react";
import { signIn, signUp, signOut, resetPassword, updatePassword } from "../lib/auth.js";

const PAL = { ink: "#2c2a26", muted: "#8a8473", line: "#e7e2d6", accent: "#c2410c", paper: "#fff" };
const field = { width: "100%", boxSizing: "border-box", padding: "9px 11px", fontSize: 13, border: `1px solid ${PAL.line}`, borderRadius: 8, color: PAL.ink, fontFamily: "inherit", marginTop: 6 };
const btn = (primary) => ({ padding: "9px 14px", fontSize: 13, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${primary ? PAL.accent : PAL.line}`, background: primary ? PAL.accent : "#fff", color: primary ? "#fff" : PAL.ink });
const linkBtn = { border: "none", background: "transparent", color: PAL.accent, cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 0 };
const s = (v) => (v == null ? "" : String(v)).trim();

function Wrap({ onClose, children, msg }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(20,18,15,0.55)", display: "grid", placeItems: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: PAL.paper, borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.35)", padding: 22, width: 360, maxWidth: "92vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: PAL.ink }}>Account</h2>
          <button onClick={onClose} style={{ ...btn(false), padding: "4px 10px", fontSize: 12 }}>Close ✕</button>
        </div>
        {children}
        {msg && <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.45, color: msg.type === "err" ? "#b91c1c" : "#15803d" }}>{msg.text}</div>}
      </div>
    </div>
  );
}

// ── Logged-in account panel: Profile + Settings tabs ───────────────────────────
function AccountView({ user, profileApi, initialTab, onClose }) {
  const [tab, setTab] = useState(initialTab === "settings" ? "settings" : "profile");
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

  const tabBtn = (id, label) => (
    <button onClick={() => { setTab(id); setMsg(null); }} style={{ ...btn(tab === id), flex: 1, padding: "7px 0" }}>{label}</button>
  );

  return (
    <Wrap onClose={onClose} msg={msg}>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {tabBtn("profile", "Profile")}
        {tabBtn("settings", "Settings")}
      </div>

      {tab === "profile" ? (
        <div>
          <div style={{ fontSize: 12.5, color: PAL.muted }}>Signed in as</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: PAL.ink, wordBreak: "break-all", margin: "1px 0 12px" }}>{user.email}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input autoComplete="given-name" placeholder="First name" value={first} onChange={edit(setFirst)} style={{ ...field, flex: 1, marginTop: 0 }} />
            <input autoComplete="family-name" placeholder="Last name" value={last} onChange={edit(setLast)} style={{ ...field, flex: 1, marginTop: 0 }} />
          </div>
          <input autoComplete="organization" placeholder="Organization / company" value={org} onChange={edit(setOrg)} style={field} />
          <button style={{ ...btn(true), width: "100%", marginTop: 12 }} disabled={busy} onClick={saveProfile}>{busy ? "…" : "Save profile"}</button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: PAL.ink }}>Change password</div>
          <input type="password" autoComplete="new-password" placeholder="New password (min 6 characters)" value={pw} onChange={(e) => setPw(e.target.value)} style={field} onKeyDown={(e) => { if (e.key === "Enter" && pw.length >= 6) changePassword(); }} />
          <button style={{ ...btn(true), width: "100%", marginTop: 12 }} disabled={busy || pw.length < 6} onClick={changePassword}>{busy ? "…" : "Update password"}</button>
          <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.5, marginTop: 14 }}>
            Your sites and reviews are saved to your account in the cloud and sync across your devices.
          </div>
        </div>
      )}

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
        else if (needsConfirm) setMsg({ type: "ok", text: "Account created — check your email for a confirmation link, then sign in." });
        else onClose();
      } else if (mode === "reset") {
        const { error } = await resetPassword(email.trim());
        setMsg(error ? { type: "err", text: error } : { type: "ok", text: "Password-reset email sent — check your inbox." });
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
      <Wrap onClose={onClose} msg={msg}>
        <div style={{ fontSize: 13, color: PAL.ink, marginBottom: 2 }}>Set a new password</div>
        <input type="password" autoComplete="new-password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} style={field} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <button style={{ ...btn(true), width: "100%", marginTop: 12 }} disabled={busy || pw.length < 6} onClick={submit}>{busy ? "…" : "Update password"}</button>
      </Wrap>
    );
  }

  // Logged-out forms: signin / signup / reset.
  return (
    <Wrap onClose={onClose} msg={msg}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <button style={{ ...btn(mode === "signin"), flex: 1, padding: "7px 0" }} onClick={() => { setMode("signin"); setMsg(null); }}>Sign in</button>
        <button style={{ ...btn(mode === "signup"), flex: 1, padding: "7px 0" }} onClick={() => { setMode("signup"); setMsg(null); }}>Sign up</button>
      </div>
      {mode === "signup" && (
        <>
          <div style={{ display: "flex", gap: 6 }}>
            <input autoComplete="given-name" placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} style={{ ...field, flex: 1 }} />
            <input autoComplete="family-name" placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} style={{ ...field, flex: 1 }} />
          </div>
          <input autoComplete="organization" placeholder="Organization / company" value={org} onChange={(e) => setOrg(e.target.value)} style={field} />
        </>
      )}
      <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
      {mode !== "reset" && (
        <input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={field} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      )}
      <button style={{ ...btn(true), width: "100%", marginTop: 12 }} disabled={busy || !email || (mode !== "reset" && pw.length < 6)}
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
