/* Login UI (Phase 2). A modal: sign-in / sign-up / password-reset when logged out,
 * a "set new password" form when arriving from a reset link, and an account view
 * (who's signed in + sign out) when logged in. Purely additive — it does not touch
 * how sites are stored. Auth state is owned by App; this calls the auth wrappers. */
import { useState } from "react";
import { signIn, signUp, signOut, resetPassword, updatePassword } from "../lib/auth.js";

const PAL = { ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)", accent: "var(--accent)", paper: "var(--surface-raised)" };
const field = { width: "100%", boxSizing: "border-box", padding: "9px 11px", fontSize: 13, border: `1px solid ${PAL.line}`, borderRadius: 8, color: PAL.ink, fontFamily: "inherit", marginTop: 6 };
const btn = (primary) => ({ padding: "9px 14px", fontSize: 13, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${primary ? PAL.accent : PAL.line}`, background: primary ? PAL.accent : "var(--surface-raised)", color: primary ? "#fff" : PAL.ink });
const linkBtn = { border: "none", background: "transparent", color: PAL.accent, cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 0 };

export default function AuthPanel({ user, recovery, onClose }) {
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

  const wrap = (children) => (
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

  // Signed-in account view (not while completing a recovery).
  if (user && !recovery) {
    const m = user.user_metadata || {};
    const name = [m.first_name, m.last_name].filter(Boolean).join(" ");
    return wrap(
      <div>
        <div style={{ fontSize: 12.5, color: PAL.muted, lineHeight: 1.5 }}>Signed in as</div>
        {name && <div style={{ fontSize: 14, fontWeight: 700, color: PAL.ink, marginTop: 2 }}>{name}{m.org ? ` · ${m.org}` : ""}</div>}
        <div style={{ fontSize: name ? 12.5 : 14, fontWeight: name ? 400 : 650, color: name ? PAL.muted : PAL.ink, wordBreak: "break-all", margin: "2px 0 14px" }}>{user.email}</div>
        <button style={{ ...btn(true), width: "100%" }} disabled={busy} onClick={async () => { setBusy(true); await signOut(); onClose(); }}>Sign out</button>
        <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.5, marginTop: 12 }}>
          Your sites are saved to your account in the cloud and sync across your devices. Sign out to work from this browser's local sites instead.
        </div>
      </div>
    );
  }

  // Set-new-password (arrived from a reset link).
  if (mode === "recovery") {
    return wrap(
      <div>
        <div style={{ fontSize: 13, color: PAL.ink, marginBottom: 2 }}>Set a new password</div>
        <input type="password" autoComplete="new-password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} style={field} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        <button style={{ ...btn(true), width: "100%", marginTop: 12 }} disabled={busy || pw.length < 6} onClick={submit}>{busy ? "…" : "Update password"}</button>
      </div>
    );
  }

  // Logged-out forms: signin / signup / reset.
  return wrap(
    <div>
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
    </div>
  );
}
