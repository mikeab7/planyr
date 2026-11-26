/* NEW-1 — what the person sees AFTER Planyr has emailed them a link: where to look, what it is called, how long
 * it lasts, a "Send again" that respects the send cap and says when it can be pressed, the spam line, then
 * support. Shared by the sign-in panel (reset + sign-in link) and the link landing page ("send a new one"),
 * so the two can never say different things. Words come from lib/emailLinkCopy.js; module-scope components
 * only; lazy-loaded by its hosts (it is only ever shown after a send), so it costs the entry chunk nothing. */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/controls.jsx";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { sentCopy, failureCopy, resendControl, SUPPORT_MAILTO, CODE_COPY, codeFailureCopy } from "../lib/emailLinkCopy.js";

const note = { fontSize: FONT_SIZE.control, lineHeight: 1.5, color: "var(--text-secondary)", marginTop: 8 };

/** Props: email, purpose ("reset"|"signin"), initialSeconds (cooldown from the send), onResend(): Promise<result>, onBack(), backLabel. */
export default function EmailLinkSent({ email, purpose, initialSeconds = 60, onResend, onBack, onVerifyCode, backLabel = "Back to sign in" }) {
  const c = sentCopy(email, purpose);
  const [readyAt, setReadyAt] = useState(() => Date.now() + Math.max(0, initialSeconds) * 1000);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [again, setAgain] = useState(0); // how many extra links this view has sent
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [codeProblem, setCodeProblem] = useState(null);
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

  const submitCode = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (checking || !onVerifyCode) return;
    setChecking(true); setCodeProblem(null);
    const r = await onVerifyCode(code);
    if (!alive.current) return;
    setChecking(false);
    if (!r || !r.ok) setCodeProblem(codeFailureCopy(r && r.kind));
  };

  return (
    <div data-testid="email-link-sent">
      <div style={{ fontSize: FONT_SIZE.emphasis, color: "var(--text-primary)", lineHeight: 1.5, wordBreak: "break-word", fontWeight: 600 }} data-testid="email-link-inbox">{c.inbox}</div>
      <div style={note}>{c.valid}</div>
      {again > 0 && <div role="status" style={{ ...note, color: "var(--success-text)" }} data-testid="email-link-again-sent">Sent again.</div>}
      <div style={{ ...note, marginTop: 12 }}>{c.spam}</div>
      <div style={note}>Still nothing? Email <a href={SUPPORT_MAILTO} style={{ color: "var(--accent)" }}>support@planyr.io</a> and we’ll get you in.</div>
      {onVerifyCode && (
        <form onSubmit={submitCode} data-testid="email-code-form" style={{ marginTop: 14 }}>
          <label htmlFor="email-code-input" style={{ display: "block", fontSize: FONT_SIZE.control, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>{CODE_COPY.label}</label>
          <input id="email-code-input" name="code" data-testid="email-code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", fontSize: FONT_SIZE.emphasis, border: "1px solid var(--border-default)", borderRadius: 8, background: "var(--surface-field)", color: "var(--text-primary)", fontFamily: "inherit", letterSpacing: 2 }} />
          <div style={note}>{CODE_COPY.hint}</div>
          {codeProblem && <div role="alert" data-testid="email-code-problem" style={{ ...note, color: "var(--danger-text)" }}>{codeProblem}</div>}
          <div style={{ marginTop: 10 }}><Button type="submit" data-testid="email-code-submit" disabled={checking || code.replace(/\D/g, "").length < 6}>{checking ? "Checking…" : CODE_COPY.button}</Button></div>
        </form>
      )}
      {problem && <div role="alert" data-testid="email-link-problem" style={{ ...note, color: "var(--danger-text)" }}>{problem}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Button variant="ghost" data-testid="email-link-resend" disabled={!ctl.enabled || busy} onClick={resend}>{busy ? "Sending…" : ctl.label}</Button>
        {onBack && <Button variant="ghost" data-testid="email-link-back" onClick={onBack}>{backLabel}</Button>}
      </div>
    </div>
  );
}
