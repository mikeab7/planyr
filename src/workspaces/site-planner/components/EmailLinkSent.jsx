/* NEW-1 — what the person sees AFTER Planyr has emailed them a link: where to look, what it is called, how long
 * it lasts, a "Send again" that respects the send cap and says when it can be pressed, the spam line, then
 * support. Shared by the sign-in panel (reset + sign-in link) and the link landing page ("send a new one"),
 * so the two can never say different things. Words come from lib/emailLinkCopy.js; module-scope components
 * only; lazy-loaded by its hosts (it is only ever shown after a send), so it costs the entry chunk nothing. */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/controls.jsx";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { sentCopy, failureCopy, resendControl, SUPPORT_MAILTO } from "../lib/emailLinkCopy.js";

const note = { fontSize: FONT_SIZE.control, lineHeight: 1.5, color: "var(--text-secondary)", marginTop: 8 };

/** Props: email, purpose ("reset"|"signin"), initialSeconds (cooldown from the send), onResend(): Promise<result>, onBack(), backLabel. */
export default function EmailLinkSent({ email, purpose, initialSeconds = 60, onResend, onBack, backLabel = "Back to sign in" }) {
  const c = sentCopy(email, purpose);
  const [readyAt, setReadyAt] = useState(() => Date.now() + Math.max(0, initialSeconds) * 1000);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [again, setAgain] = useState(0); // how many extra links this view has sent
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const left = Math.max(0, Math.ceil((readyAt - now) / 1000));
  const ctl = resendControl(left);
  const resend = async () => {
    if (!ctl.enabled || busy) return;
    setBusy(true); setProblem(null);
    const r = await onResend();
    if (!alive.current) return;
    setBusy(false);
    if (r && r.ok) { setReadyAt(Date.now() + (r.retryAfterSeconds || 60) * 1000); setNow(Date.now()); setAgain((n) => n + 1); }
    else {
      setProblem(failureCopy(r));
      if (r && r.reason === "throttled" && r.retryAfterSeconds) { setReadyAt(Date.now() + r.retryAfterSeconds * 1000); setNow(Date.now()); }
    }
  };

  return (
    <div data-testid="email-link-sent">
      <div style={{ fontSize: FONT_SIZE.emphasis, color: "var(--text-primary)", lineHeight: 1.5, wordBreak: "break-word", fontWeight: 600 }} data-testid="email-link-inbox">{c.inbox}</div>
      <div style={note}>{c.valid}</div>
      {again > 0 && <div role="status" style={{ ...note, color: "var(--success-text)" }} data-testid="email-link-again-sent">Sent again.</div>}
      <div style={{ ...note, marginTop: 12 }}>{c.spam}</div>
      <div style={note}>Still nothing? Email <a href={SUPPORT_MAILTO} style={{ color: "var(--accent)" }}>support@planyr.io</a> and we’ll get you in.</div>
      {problem && <div role="alert" data-testid="email-link-problem" style={{ ...note, color: "var(--danger-text)" }}>{problem}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Button variant="ghost" data-testid="email-link-resend" disabled={!ctl.enabled || busy} onClick={resend}>{busy ? "Sending…" : ctl.label}</Button>
        {onBack && <Button variant="ghost" data-testid="email-link-back" onClick={onBack}>{backLabel}</Button>}
      </div>
    </div>
  );
}
