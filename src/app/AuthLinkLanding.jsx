/* AuthLinkLanding — the page the emailed sign-in / password-reset link opens (NEW-1, 2026-11-02).
 *
 * The email points here (`/?app&authlink=<token>&kind=reset|signin`), NOT at Supabase's verify URL. Corporate
 * mail scanners open every link in a message; Supabase's own links spend their one-time token on that first
 * request, so the person would arrive to "expired". Opening THIS page spends nothing — the token is only used
 * when the person presses the one button, which calls verifyOtp({ token_hash }). That also means it works on a
 * different device or browser than the one that asked.
 *
 * EVERY STATE HAS A NEXT STEP (the state table is `landingPlan` in shared/auth/authLink.js, unit-tested):
 *   malformed · ready · signed in as the SAME account · signed in as a DIFFERENT account (named, with Switch and
 *   Stay — never a silent swap) · verifying · expired-or-used · network failure · verify rate limit · other.
 * "Send me a new link" is right there on the failure states; the address is pre-filled ONLY from this device's
 * own memory of what was typed (the link never carries it) — otherwise the field is empty.
 *
 * AFTER SUCCESS: a reset link marks "password change pending" (shared/auth/recoveryPending.js) and tells the Shell to
 * open the non-dismissable set-a-new-password form — supabase-js emits PASSWORD_RECOVERY for a recovery verifyOtp,
 * but we do not rely on that event alone. A sign-in link lands signed in, on the route the person started from
 * when `next` survived `safeNextRoute`. If the new session is for a different account than the one that was signed
 * in (a hint collision), that is said plainly.
 * Module-scope components only (MODULE-SCOPE-COMPONENTS). Reached only when the address carries ?authlink=. */
import { useEffect, useRef, useState } from "react";
import { Button } from "../shared/ui/controls.jsx";
import { RADIUS } from "../shared/ui/radius.js";
import { FONT_SIZE } from "../shared/ui/designTokens.js";
import { parseAuthLinkSearch, stripAuthLinkParams, accountHint, landingPlan, SUPPORT_EMAIL } from "../shared/auth/authLink.js";
import { markRecoveryPending } from "../shared/auth/recoveryPending.js";
import { verifyAuthLink, requestEmailLink, recallLinkEmail } from "../workspaces/site-planner/lib/emailLinkClient.js";
import { failureCopy, SUPPORT_MAILTO } from "../workspaces/site-planner/lib/emailLinkCopy.js";
import EmailLinkSent from "../workspaces/site-planner/components/EmailLinkSent.jsx";

const AUTH_WAIT_MS = 4000;
const overlay = { position: "fixed", inset: 0, zIndex: 5100, background: "rgba(20,18,15,0.55)", display: "grid", placeItems: "center", padding: 16 };
const card = { background: "var(--surface-raised)", color: "var(--text-primary)", borderRadius: RADIUS.lg, boxShadow: "0 20px 60px rgba(0,0,0,0.35)", padding: 22, width: 380, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box" };
const field = { width: "100%", boxSizing: "border-box", padding: "9px 11px", fontSize: FONT_SIZE.emphasis, border: "1px solid var(--border-default)", borderRadius: RADIUS.md, background: "var(--surface-field)", color: "var(--text-primary)", fontFamily: "inherit", marginTop: 8 };

function stripUrl() {
  try {
    const search = stripAuthLinkParams(window.location.search);
    window.history.replaceState(window.history.state, "", window.location.pathname + search + window.location.hash);
  } catch (_) { /* history unavailable — the params just stay in the bar */ }
}

function Shell({ title, children }) {
  return (
    <div style={overlay} data-testid="auth-link-landing">
      <div role="dialog" aria-modal="true" aria-label={title} style={card}>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }} data-testid="auth-link-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Support() {
  return <div style={{ marginTop: 14, fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>Stuck? Email <a href={SUPPORT_MAILTO} style={{ color: "var(--accent)" }}>{SUPPORT_EMAIL}</a>.</div>;
}

/* "Send me a new link" — an inline form (the address pre-filled from this device only), then the shared sent view. */
function ResendPanel({ kind, onBackToSignIn }) {
  const [email, setEmail] = useState(() => recallLinkEmail());
  const [purpose, setPurpose] = useState(kind || "signin");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [sent, setSent] = useState(null);
  const submit = async () => {
    if (busy || !email.trim()) return;
    setBusy(true); setProblem(null);
    const r = await requestEmailLink({ email: email.trim(), purpose });
    setBusy(false);
    if (r.ok) setSent({ email: email.trim(), purpose, seconds: r.retryAfterSeconds }); else setProblem(failureCopy(r));
  };
  if (sent) {
    return <EmailLinkSent email={sent.email} purpose={sent.purpose} initialSeconds={sent.seconds}
      onResend={() => requestEmailLink({ email: sent.email, purpose: sent.purpose })} onBack={onBackToSignIn} />;
  }
  return (
    <div data-testid="auth-link-resend-form">
      {!kind && (
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <Button size="sm" variant={purpose === "signin" ? "primary" : "ghost"} onClick={() => setPurpose("signin")}>Sign-in link</Button>
          <Button size="sm" variant={purpose === "reset" ? "primary" : "ghost"} onClick={() => setPurpose("reset")}>Password reset</Button>
        </div>
      )}
      <label style={{ display: "block", marginTop: 10, fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }} htmlFor="auth-link-email">Your Planyr email address</label>
      <input id="auth-link-email" data-testid="auth-link-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} style={field} />
      {problem && <div role="alert" style={{ marginTop: 8, fontSize: FONT_SIZE.control, color: "var(--danger-text)", lineHeight: 1.45 }} data-testid="auth-link-resend-problem">{problem}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <Button data-testid="auth-link-resend-submit" disabled={busy || !email.trim()} onClick={submit}>{busy ? "Sending…" : "Send"}</Button>
        <Button variant="ghost" onClick={onBackToSignIn}>Back to sign in</Button>
      </div>
    </div>
  );
}

/** Props: user (Supabase user or null), authKnown, onOpenSignIn(), onRecovery() — the Shell opens the set-new-password form. */
export default function AuthLinkLanding({ user, authKnown, onOpenSignIn, onRecovery }) {
  const [link] = useState(() => (typeof window === "undefined" ? { present: false } : parseAuthLinkSearch(window.location.search)));
  const [phase, setPhase] = useState({ name: "idle" });
  const [hidden, setHidden] = useState(false);
  const [resending, setResending] = useState(false);
  const [swapNotice, setSwapNotice] = useState(null); // { was, now } — a session for a different account than the one that was signed in
  // If the first auth report never arrives (a stalled storage read), show the page anyway after a few seconds, as signed out —
  // a link page that stays blank is a dead end (shared/auth/authLink.js: every state has a next step).
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), AUTH_WAIT_MS); return () => clearTimeout(t); }, []);
  const [hintReady, setHintReady] = useState(false);
  const [userHint, setUserHint] = useState(null);
  const uid = user ? user.id : null;
  const verifying = useRef(false);
  const previous = useRef(null);

  // The signed-in account's fingerprint, to compare with the link's (8 hex characters — never the address).
  useEffect(() => {
    let live = true;
    setHintReady(false);
    if (!user || !user.email) { setUserHint(null); setHintReady(true); return undefined; }
    accountHint(user.email).then((h) => { if (live) { setUserHint(h); setHintReady(true); } });
    return () => { live = false; };
  }, [uid, user && user.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = (then) => { stripUrl(); setHidden(true); if (then) then(); };

  const spend = async (isSwitch) => {
    if (verifying.current) return;
    verifying.current = true;
    previous.current = user ? { id: user.id, email: user.email } : null;
    setPhase({ name: "verifying" });
    const r = await verifyAuthLink({ token: link.token, kind: link.kind });
    verifying.current = false;
    if (!r.ok) { setPhase({ name: "failed", kind: r.kind }); return; }
    stripUrl();
    const was = previous.current;
    if (link.kind === "reset") {
      markRecoveryPending();
      setHidden(true);
      if (onRecovery) onRecovery();
      return;
    }
    if (link.next) { try { window.location.hash = "#" + link.next; } catch (_) { /* leave them where they are */ } }
    if (was && was.id !== r.user.id && !isSwitch) { setSwapNotice({ was: was.email, now: r.user.email }); setPhase({ name: "idle" }); return; }
    setHidden(true);
  };

  if (hidden || !link.present) return null;
  if ((!authKnown && !waited) || !hintReady) return null; // wait for the first auth report: a signed-in visitor must not flash "ready"

  if (swapNotice) {
    return (
      <Shell title="You’re signed in">
        <div data-testid="auth-link-swapped" style={{ fontSize: FONT_SIZE.emphasis, lineHeight: 1.5, wordBreak: "break-word" }}>
          This link was for {swapNotice.now}, so this browser is now signed in as {swapNotice.now} instead of {swapNotice.was}.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}><Button onClick={() => setHidden(true)}>Continue to Planyr</Button></div>
      </Shell>
    );
  }

  const plan = landingPlan({ link, phase, user, userHint });
  if (resending) {
    return (
      <Shell title="Send me a new link">
        <ResendPanel kind={link.kind} onBackToSignIn={() => leave(onOpenSignIn)} />
        <Support />
      </Shell>
    );
  }

  const act = (id) => {
    if (id === "continue") spend(false);
    else if (id === "switch") spend(true);
    else if (id === "retry") spend(false);
    else if (id === "resend") setResending(true);
    else if (id === "signin") leave(onOpenSignIn);
    else if (id === "stay") leave();
  };

  return (
    <Shell title={plan.title}>
      <div data-testid={`auth-link-state-${plan.state}`} role={phase.name === "failed" || plan.state === "malformed" || plan.state === "different-account" ? "alert" : "status"} style={{ fontSize: FONT_SIZE.emphasis, lineHeight: 1.5, color: "var(--text-primary)", wordBreak: "break-word" }}>{plan.message}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {plan.actions.map((a) => (
          <Button key={a.id} variant={a.primary ? "primary" : "ghost"} disabled={!!a.disabled} data-testid={`auth-link-${a.id}`} onClick={() => act(a.id)}>{a.label}</Button>
        ))}
      </div>
      <Support />
    </Shell>
  );
}
