/* InviteLanding — what happens when someone opens the button in a team-invite email (NEW-2, 2026-10-29).
 * The link is planyr.io/?app&invite=<id>; <id> is the invite row's own random uuid (never the email). This
 * component reads it once (and strips it from the address bar so a reload does not reopen the prompt), asks the
 * invite_preview RPC who it is for, and follows the table in shared/teams/inviteLandingModel.js:
 *   signed out        → asks Shell to open sign-in / sign-up with the invited address already filled in
 *   signed in, right  → "You've been invited to <team> — Accept / Decline" (the same answerInvite the account menu uses)
 *   signed in, wrong  → "This invite was sent to <email>. Sign out and sign in with that address to accept." + Sign out
 * The preview is re-asked when the signed-in user changes, so a brand-new signup (already added by handle_new_user)
 * sees "already used", not a stale Accept. Module-scope components only (MODULE-SCOPE-COMPONENTS). */
import { useEffect, useMemo, useRef, useState } from "react";
import FloatingNotice from "../shared/ui/FloatingNotice.jsx";
import { Button } from "../shared/ui/controls.jsx";
import { RADIUS } from "../shared/ui/radius.js";
import { FONT_SIZE } from "../shared/ui/designTokens.js";
import { supabase } from "../workspaces/site-planner/lib/supabase.js";
import { signOut } from "../workspaces/site-planner/lib/auth.js";
import { answerInvite } from "./teamInvites.js";
import { inviteIdFromSearch, stripInviteParam, inviteLandingPlan } from "../shared/teams/inviteLandingModel.js";

const card = {
  padding: "12px 14px", borderRadius: RADIUS.md, background: "var(--surface-raised, var(--surface))",
  color: "var(--text)", border: "1px solid var(--border-default)", fontSize: FONT_SIZE.control, lineHeight: 1.45,
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

function AnswerCard({ uid, plan, onDone }) {
  const [busy, setBusy] = useState(null); // "accept" | "decline" | null
  const [result, setResult] = useState(null); // { ok, text }
  const go = async (accept) => {
    setBusy(accept ? "accept" : "decline");
    const r = await answerInvite(uid, plan.invite, accept);
    setBusy(null);
    if (r.ok) setResult({ ok: true, text: r.text }); else setResult({ ok: false, text: r.text });
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

/** Props: user (Supabase user or null), authKnown (false until auth has reported), onNeedAuth({ email, mode }). */
export default function InviteLanding({ user, authKnown, onNeedAuth }) {
  const [inviteId, setInviteId] = useState(null);
  const [preview, setPreview] = useState(null);   // invite_preview result
  const [unreachable, setUnreachable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
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

  // Ask who the invite is for — once auth is known, and again if the signed-in user changes.
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
  }, [inviteId, authKnown, uid]);

  const plan = useMemo(
    () => (inviteId && authKnown && loaded ? inviteLandingPlan({ preview, user, unreachable }) : null),
    [inviteId, authKnown, loaded, preview, user, unreachable],
  );

  // Signed out: open the auth screen once, filled in. (Signing in changes `uid`, which re-asks and re-plans.)
  useEffect(() => {
    if (plan && plan.kind === "auth" && askedAuthFor.current !== inviteId) {
      askedAuthFor.current = inviteId;
      onNeedAuth({ email: plan.email, mode: plan.mode });
    }
  }, [plan, inviteId, onNeedAuth]);

  if (!plan || dismissed || plan.kind === "auth") return null;
  const close = () => setDismissed(true);
  if (plan.kind === "answer") return <AnswerCard uid={uid} plan={plan} onDone={close} />;
  if (plan.kind === "wrong-account") {
    return (
      <Card testId="invite-landing-wrong-account" tone="warn">
        <div style={{ overflowWrap: "anywhere" }}>{plan.text}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Button size="sm" data-testid="invite-landing-signout" onClick={() => { signOut(); }}>Sign out</Button>
          <Button size="sm" variant="ghost" onClick={close}>Not now</Button>
        </div>
      </Card>
    );
  }
  return (
    <Card testId="invite-landing-notice" tone={plan.tone}>
      <div style={{ overflowWrap: "anywhere" }}>{plan.text}</div>
      <div style={{ marginTop: 8 }}><Button size="sm" variant="ghost" onClick={close}>Close</Button></div>
    </Card>
  );
}
