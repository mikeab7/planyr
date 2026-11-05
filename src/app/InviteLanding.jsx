/* InviteLanding — what happens when someone opens the button in a team-invite email (NEW-2, 2026-10-29; reworked
 * NEW-1, 2026-11-02). The link is planyr.io/?app&invite=<id>; <id> is the invite row's own random uuid (never the email).
 * THE LINK IS THE PROOF OF THE MAILBOX — email confirmation is off, so an address match proves nothing and nobody joins
 * by address alone. This component reads the id once (and strips it from the address bar so a reload does not reopen the
 * prompt), asks the invite_preview RPC who it is for, and follows the table in shared/teams/inviteLandingModel.js:
 *   signed out, no account    → a "Create your account" card, the invited address filled in and fixed. It posts to
 *                               /api/auth/invite-signup (no Turnstile — the link already proves the mailbox), then
 *                               signs the new account in and joins
 *   signed out, has account   → asks Shell to open sign-in with the invited address filled in; come back and Accept
 *   signed in, right address  → "You've been invited to <team> — Accept / Decline" (redeem_invite_link: proves + joins)
 *   signed in, other address  → says which address the invite is for and offers "Switch to <it>"
 *   just joined               → "You're on <team>." + Go to my projects / See the team  (never "already used")
 *   used / declined / gone    → one plain line + what to do next
 * The preview is re-asked when the signed-in user changes, but `joined` outranks it: right after a join the preview
 * correctly reads "claimed", which used to be shown as "already used". Module-scope components only
 * (MODULE-SCOPE-COMPONENTS). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FloatingNotice from "../shared/ui/FloatingNotice.jsx";
import { Button } from "../shared/ui/controls.jsx";
import { RADIUS } from "../shared/ui/radius.js";
import { FONT_SIZE } from "../shared/ui/designTokens.js";
import { supabase } from "../workspaces/site-planner/lib/supabase.js";
import { signOut } from "../workspaces/site-planner/lib/auth.js";
import { redeemInvite } from "./teamInvites.js";
import { TEAMS_CHANGED_EVENT } from "../shared/teams/teamInviteModel.js";
import { inviteIdFromSearch, stripInviteParam, inviteLandingPlan, signupCardProblem, signupFailure } from "../shared/teams/inviteLandingModel.js";

const card = {
  padding: "12px 14px", borderRadius: RADIUS.md, background: "var(--surface-raised, var(--surface))",
  color: "var(--text)", border: "1px solid var(--border-default)", fontSize: FONT_SIZE.control, lineHeight: 1.45,
};
const input = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: RADIUS.sm, border: "1px solid var(--border-default)",
  background: "var(--surface)", color: "var(--text)", fontSize: FONT_SIZE.control, marginTop: 6,
};

function Card({ testId, tone, children }) {
  return (
    <FloatingNotice testId={testId}>
      <div role={tone === "warn" ? "alert" : "status"} style={{ ...card, borderColor: tone === "warn" ? "var(--danger)" : card.border }}>
        {children}
      </div>
    </FloatingNotice>
  );
}

function AnswerCard({ uid, plan, onJoined, onDone, onWrongAccount }) {
  const [busy, setBusy] = useState(null); // "accept" | "decline" | null
  const [result, setResult] = useState(null); // { ok, text }
  const go = async (accept) => {
    setBusy(accept ? "accept" : "decline");
    const r = await redeemInvite(uid, plan.invite, accept);
    setBusy(null);
    if (r.ok && accept) { onJoined(r.teamName || plan.teamName); return; }
    if (r.wrongAccount) { onWrongAccount(); return; } // signed in as someone else since the preview was read
    setResult({ ok: r.ok, text: r.text });
  };
  if (result && result.ok) {
    return (
      <Card testId="invite-landing-done">
        <div>{result.text}</div>
        <div style={{ marginTop: 8 }}><Button size="sm" onClick={onDone}>Done</Button></div>
      </Card>
    );
  }
  return (
    <Card testId="invite-landing-answer" tone={result ? "warn" : undefined}>
      <div style={{ fontWeight: 700, fontSize: FONT_SIZE.emphasis, overflowWrap: "anywhere" }}>
        You've been invited to {plan.teamName}
      </div>
      <div style={{ color: "var(--text-secondary)", marginBottom: 8, overflowWrap: "anywhere" }}>{plan.invitedBy} invited you.</div>
      <div style={{ display: "flex", gap: 6 }}>
        <Button size="sm" data-testid="invite-landing-accept" disabled={busy !== null} onClick={() => go(true)}>{busy === "accept" ? "Joining…" : "Accept"}</Button>
        <Button size="sm" variant="ghost" data-testid="invite-landing-decline" disabled={busy !== null} onClick={() => go(false)}>{busy === "decline" ? "Declining…" : "Decline"}</Button>
      </div>
      {result && !result.ok && <div style={{ marginTop: 6, color: "var(--danger-text)" }}>{result.text}</div>}
    </Card>
  );
}

// A person with no account arriving by a valid link: the address is the invite's (shown, not editable), and the server
// route creates the account without Turnstile — the link already proves they hold this mailbox.
function SignupCard({ plan, inviteId, onJoined, onHaveAccount, onDismiss }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [org, setOrg] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current) return;
    const problem = signupCardProblem({ firstName: first, lastName: last, password: pw });
    if (problem) { setErr(problem); return; }
    submitting.current = true; setBusy(true); setErr("");
    let status = 0, body = null;
    try {
      const resp = await fetch("/api/auth/invite-signup", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite: inviteId, password: pw, firstName: first.trim(), lastName: last.trim(), org: org.trim() }),
      });
      status = resp.status; body = await resp.json().catch(() => null);
    } catch (_) { /* status stays 0 → "couldn't reach Planyr" */ }
    if (status === 200 && body && body.ok) {
      try {
        const { error } = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
        if (error) throw error;
        setPw("");
        onJoined((body.team && body.team.name) || plan.teamName);
        return;
      } catch (_) { setErr("Your account was created and you've joined the team, but we couldn't sign you in here. Sign in with the password you just chose."); }
    } else {
      const f = signupFailure(status, body);
      if (f.next === "signin") { setPw(""); onHaveAccount(f.text); } else setErr(f.text);
    }
    submitting.current = false; setBusy(false);
  };
  return (
    <Card testId="invite-landing-signup" tone={err ? "warn" : undefined}>
      <div style={{ fontWeight: 700, fontSize: FONT_SIZE.emphasis, overflowWrap: "anywhere" }}>Create your account to join {plan.teamName}</div>
      <div style={{ color: "var(--text-secondary)", overflowWrap: "anywhere" }}>{plan.invitedBy} invited you.</div>
      <input aria-label="Email" data-testid="invite-signup-email" type="email" value={plan.email} readOnly style={{ ...input, color: "var(--text-secondary)" }} />
      <div style={{ display: "flex", gap: 6 }}>
        <input aria-label="First name" data-testid="invite-signup-first" autoComplete="given-name" placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} style={input} />
        <input aria-label="Last name" data-testid="invite-signup-last" autoComplete="family-name" placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} style={input} />
      </div>
      <input aria-label="Organization or company" autoComplete="organization" placeholder="Organization / company (optional)" value={org} onChange={(e) => setOrg(e.target.value)} style={input} />
      <input aria-label="Password" data-testid="invite-signup-password" type="password" autoComplete="new-password" placeholder="Password (6+ characters)" value={pw}
        onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} style={input} />
      {err && <div role="alert" data-testid="invite-signup-error" style={{ marginTop: 6, color: "var(--danger-text)", overflowWrap: "anywhere" }}>{err}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button size="sm" data-testid="invite-signup-submit" disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create account & join"}</Button>
        <Button size="sm" variant="ghost" data-testid="invite-signup-have-account" disabled={busy} onClick={() => onHaveAccount("")}>I already have an account</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>Not now</Button>
      </div>
    </Card>
  );
}

/** Props: user (Supabase user or null), authKnown (false until auth has reported), onNeedAuth({ email, mode }),
 *  onOpenWork() (the dashboard), onOpenTeam() (the account's Team tab). */
export default function InviteLanding({ user, authKnown, onNeedAuth, onOpenWork, onOpenTeam }) {
  const [inviteId, setInviteId] = useState(null);
  const [preview, setPreview] = useState(null);   // invite_preview result
  const [unreachable, setUnreachable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [joined, setJoined] = useState(null);     // { teamName } once THIS tab joined through this link
  const [forceSignin, setForceSignin] = useState(false); // the signup card said "I already have an account"
  const [retryTick, setRetryTick] = useState(0);
  const askedAuthFor = useRef(null);
  const uid = user ? user.id : null;

  // Read the id once, then take it out of the address bar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = inviteIdFromSearch(window.location.search);
    if (!id) return;
    setInviteId(id);
    try {
      const search = stripInviteParam(window.location.search);
      window.history.replaceState(window.history.state, "", window.location.pathname + search + window.location.hash);
    } catch (_) { /* history unavailable — the param just stays in the bar */ }
  }, []);

  // Ask who the invite is for — once auth is known, and again if the signed-in user changes or "Try again" is pressed.
  useEffect(() => {
    if (!inviteId || !authKnown) return undefined;
    let live = true;
    setLoaded(false); setUnreachable(false);
    (async () => {
      try {
        if (!supabase) throw new Error("Cloud not configured.");
        const { data, error } = await supabase.rpc("invite_preview", { p_invite: inviteId });
        if (!live) return;
        if (error) { setUnreachable(true); setPreview(null); } else setPreview(data);
      } catch (_) {
        if (live) { setUnreachable(true); setPreview(null); }
      } finally { if (live) setLoaded(true); }
    })();
    return () => { live = false; };
  }, [inviteId, authKnown, uid, retryTick]);

  const plan = useMemo(() => {
    if (!inviteId || !authKnown) return null;
    if (joined) return inviteLandingPlan({ preview, user, joined });
    if (!loaded) return null;
    const p = inviteLandingPlan({ preview, user, unreachable });
    // "I already have an account" on the signup card: take the sign-in screen instead (the address stays filled in).
    return forceSignin && p.kind === "signup" ? { kind: "auth", email: p.email, mode: "signin" } : p;
  }, [inviteId, authKnown, loaded, preview, user, unreachable, joined, forceSignin]);

  // Signed out + has an account (or "I already have one"): open the auth screen once, filled in.
  // (Signing in changes `uid`, which re-asks and re-plans.)
  useEffect(() => {
    if (plan && plan.kind === "auth" && askedAuthFor.current !== inviteId) {
      askedAuthFor.current = inviteId;
      onNeedAuth({ email: plan.email, mode: plan.mode });
    }
  }, [plan, inviteId, onNeedAuth]);

  const justJoined = useCallback((teamName) => {
    setJoined({ teamName });
    try { window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT)); } catch (_) { /* nothing listening is fine */ }
  }, []);
  const switchAccount = useCallback(async () => {
    askedAuthFor.current = null; // the next signed-out plan re-opens sign-in with the invited address
    setForceSignin(false);
    await signOut();
  }, []);
  const close = () => setDismissed(true);

  if (!plan || dismissed || plan.kind === "auth") return null;
  if (plan.kind === "joined") {
    return (
      <Card testId="invite-landing-joined">
        <div style={{ fontWeight: 700, fontSize: FONT_SIZE.emphasis, overflowWrap: "anywhere" }}>{plan.text}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <Button size="sm" data-testid="invite-landing-open-work" onClick={() => { close(); if (onOpenWork) onOpenWork(); }}>Go to my projects</Button>
          <Button size="sm" variant="ghost" data-testid="invite-landing-open-team" onClick={() => { close(); if (onOpenTeam) onOpenTeam(); }}>See the team</Button>
        </div>
      </Card>
    );
  }
  if (plan.kind === "signup") {
    return <SignupCard plan={plan} inviteId={inviteId} onJoined={justJoined} onDismiss={close}
      onHaveAccount={() => { askedAuthFor.current = null; setForceSignin(true); }} />;
  }
  if (plan.kind === "answer") {
    return <AnswerCard uid={uid} plan={plan} onJoined={justJoined} onDone={close} onWrongAccount={() => setRetryTick((n) => n + 1)} />;
  }
  if (plan.kind === "wrong-account") {
    return (
      <Card testId="invite-landing-wrong-account" tone="warn">
        <div style={{ overflowWrap: "anywhere" }}>{plan.text}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <Button size="sm" data-testid="invite-landing-switch" onClick={switchAccount}>Switch to {plan.email}</Button>
          <Button size="sm" variant="ghost" onClick={close}>Not now</Button>
        </div>
      </Card>
    );
  }
  // notice — one plain line and the next step
  return (
    <Card testId="invite-landing-notice" tone={plan.tone}>
      <div style={{ overflowWrap: "anywhere" }}>{plan.text}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {plan.action === "retry" && <Button size="sm" data-testid="invite-landing-retry" onClick={() => setRetryTick((n) => n + 1)}>Try again</Button>}
        {plan.action === "signin" && <Button size="sm" data-testid="invite-landing-signin" onClick={() => { close(); onNeedAuth({ email: "", mode: "signin" }); }}>Sign in</Button>}
        {plan.action === "work" && <Button size="sm" data-testid="invite-landing-open-work" onClick={() => { close(); if (onOpenWork) onOpenWork(); }}>Go to my projects</Button>}
        <Button size="sm" variant="ghost" onClick={close}>Close</Button>
      </div>
    </Card>
  );
}

