/* ConnectLanding — the Allow page of "Connect to Claude" (AI agent access part 2, 2026-11-27; approved mockup step 3).
 *
 * Reached at `#/connect/<request id>` after /oauth/authorize (functions/oauth/authorize.js) stored the assistant's
 * request server-side. Only that id travels, so it survives every sign-in route (password, emailed link, typed code).
 * If the person signs in from ANOTHER tab, the Shell finds the id again on this device (shared/auth/connectRequest.js).
 *
 * WHAT IT SHOWS, and why (adversarial review A4/A5/A9):
 *   - the assistant's name, labelled as the name it gave ITSELF, and the site it will send you back to, in plain text,
 *     so a fake "Claude" that returns somewhere else is visible;
 *   - exactly what it can and can't do, from the ONE list the connector itself checks (shared/mcp/connectorScope.js);
 *   - Allow and Cancel. Each is a POST through the person's own session (never a cookie, never a GET), single use.
 * The app's root document is never framed (public/_headers frame-ancestors 'none'), so the Allow button can't be
 * clickjacked. There is no way to approve without this page. Module-scope components only; tokens only. */
import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "../shared/ui/controls.jsx";
import { RADIUS } from "../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../shared/ui/designTokens.js";
import { CONNECTOR_TOOLS, CONNECTOR_CANNOT, CONNECTOR_SEES } from "../shared/mcp/connectorScope.js";
import { connectRequestInfo, decideConnect, returnUrl } from "../shared/mcp/connectorClient.js";
import { rememberPendingConnect, clearPendingConnect } from "../shared/auth/connectRequest.js";
import { signOut } from "../workspaces/site-planner/lib/auth.js";

const AUTH_WAIT_MS = 4000;
const ink = "var(--text-primary)", muted = "var(--text-secondary)";
const small = { fontSize: FONT_SIZE.control, color: muted, lineHeight: 1.5 };
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

const STOP_COPY = {
  missing: ["This connection link didn’t work", "Planyr can’t find this request. Start connecting again from your assistant."],
  used: ["This request was already answered", "Each connection request can be answered once. Start again from your assistant if you need to."],
  expired: ["This request ran out", "Connection requests last 10 minutes. Start connecting again from your assistant."],
  error: ["Planyr couldn’t load this request", "Something went wrong. Check your connection and try again."],
};

function Frame({ title, children }) {
  return (
    <Dialog onClose={() => {}} label={title} testId="connect-landing" z={5100} scrim="var(--modal-scrim)" width="min(420px, 100%)" padding={22}
      dismissOnBackdrop={false} dismissOnEscape={false}
      style={{ color: ink, border: "none", borderRadius: RADIUS.lg, boxShadow: "var(--modal-shadow)", maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box", maxWidth: "100%" }}>
      <h2 data-testid="connect-title" style={{ margin: `0 0 ${SPACE.lg}px`, fontSize: FONT_SIZE.display, fontWeight: 700, wordBreak: "break-word" }}>{title}</h2>
      {children}
    </Dialog>
  );
}

function List({ items, mark, tone, testId }) {
  return (
    <ul data-testid={testId} style={{ listStyle: "none", margin: `${SPACE.xs}px 0 0`, padding: 0 }}>
      {items.map((t) => (
        <li key={t} style={{ display: "flex", gap: SPACE.md, fontSize: FONT_SIZE.emphasis, lineHeight: 1.45, color: ink, padding: `${SPACE.xxs}px 0` }}>
          <span aria-hidden="true" style={{ color: tone, fontWeight: 700, flex: "none" }}>{mark}</span><span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** Props: requestId, user, authKnown, onOpenSignIn(), onDone() — hides the page (Cancel without a return address). */
export default function ConnectLanding({ requestId, user, authKnown, onOpenSignIn, onDone }) {
  const [waited, setWaited] = useState(false);
  const [info, setInfo] = useState(null);       // null = loading
  const [phase, setPhase] = useState("idle");   // idle | deciding | leaving | failed
  const [problem, setProblem] = useState(null);
  const uid = user ? user.id : null;
  const deciding = useRef(false);

  useEffect(() => { const t = setTimeout(() => setWaited(true), AUTH_WAIT_MS); return () => clearTimeout(t); }, []);
  useEffect(() => { rememberPendingConnect(requestId); }, [requestId]);
  useEffect(() => {
    let live = true;
    setInfo(null);
    if (!uid) return undefined;
    connectRequestInfo(requestId).then((r) => { if (live) setInfo(r); });
    return () => { live = false; };
  }, [requestId, uid]);

  const decide = async (allow) => {
    if (deciding.current) return;
    deciding.current = true;
    setPhase("deciding"); setProblem(null);
    const r = await decideConnect(requestId, allow);
    deciding.current = false;
    if (!r.ok || !r.redirect_uri) {
      setPhase("failed");
      setProblem(r.reason && STOP_COPY[r.reason] ? STOP_COPY[r.reason][1] : `Planyr couldn’t record your answer (${r.message || "unknown error"}). Try again.`);
      return;
    }
    clearPendingConnect();
    setPhase("leaving");
    try { window.location.replace(returnUrl(r, window.location.origin)); }
    catch (_) { setPhase("failed"); setProblem("Planyr couldn’t send you back to your assistant. Close this tab and check the assistant."); }
  };

  if (!authKnown && !waited) return null;

  if (!user) {
    return (
      <Frame title="Connect an AI assistant to Planyr">
        <div data-testid="connect-signed-out" style={{ fontSize: FONT_SIZE.emphasis, lineHeight: 1.5 }}>Sign in to Planyr first. Then you can approve the connection here.</div>
        <div style={{ display: "flex", gap: SPACE.md, marginTop: SPACE.xxl, flexWrap: "wrap" }}>
          <Button data-testid="connect-signin" onClick={onOpenSignIn}>Sign in</Button>
          <Button variant="ghost" onClick={() => { clearPendingConnect(); onDone(); }}>Not now</Button>
        </div>
      </Frame>
    );
  }

  if (!info) return <Frame title="Connect an AI assistant to Planyr"><div style={small}>Loading…</div></Frame>;

  if (!info.ok) {
    const [title, body] = STOP_COPY[info.reason] || STOP_COPY.error;
    return (
      <Frame title={title}>
        <div data-testid={`connect-stop-${info.reason || "error"}`} role="alert" style={{ fontSize: FONT_SIZE.emphasis, lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: "flex", gap: SPACE.md, marginTop: SPACE.xxl }}>
          <Button onClick={() => { clearPendingConnect(); onDone(); }}>Close</Button>
        </div>
      </Frame>
    );
  }

  const name = info.client_name;
  const host = info.redirect_host;
  const busy = phase === "deciding" || phase === "leaving";
  return (
    <Frame title={`Connect ${name} to Planyr?`}>
      <div style={small}>
        Signed in as <strong style={{ color: ink, wordBreak: "break-all" }} data-testid="connect-email">{user.email}</strong>
        {" · "}
        {/* "Not you?" (approved mockup): signs out here and keeps the request, so the right person can sign in and answer it. */}
        <button type="button" data-testid="connect-not-you" disabled={busy} onClick={() => { rememberPendingConnect(requestId); signOut(); }}
          style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }}>Not you?</button>
      </div>
      <div style={{ ...small, marginTop: SPACE.xs }} data-testid="connect-host">
        “{name}” is the name this assistant gave itself. After you answer, Planyr sends you back to <strong style={{ color: ink }}>{host}</strong>.
      </div>
      {LOOPBACK.has(host) && (
        <div role="note" data-testid="connect-loopback" style={{ ...small, color: "var(--warn-text)", marginTop: SPACE.sm }}>
          This assistant runs on your own computer. Only allow it if you started connecting it yourself just now.
        </div>
      )}
      <div style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, marginTop: SPACE.xxl }}>{name} will be able to</div>
      <List testId="connect-can" items={CONNECTOR_TOOLS.map((t) => t.can)} mark="✓" tone="var(--accent)" />
      <div style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, marginTop: SPACE.xl }}>It can’t</div>
      <List testId="connect-cannot" items={CONNECTOR_CANNOT} mark="✕" tone="var(--danger-text)" />
      <div style={{ ...small, marginTop: SPACE.lg }}>{CONNECTOR_SEES}</div>
      {problem && <div role="alert" data-testid="connect-problem" style={{ ...small, color: "var(--danger-text)", marginTop: SPACE.lg }}>{problem}</div>}
      <div style={{ display: "flex", gap: SPACE.md, marginTop: SPACE.xxl, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <Button variant="ghost" data-testid="connect-cancel" disabled={busy} onClick={() => decide(false)}>Cancel</Button>
        <Button data-testid="connect-allow" disabled={busy} onClick={() => decide(true)}>{phase === "deciding" ? "…" : phase === "leaving" ? "Sending you back…" : "Allow"}</Button>
      </div>
      <div style={{ ...small, marginTop: SPACE.lg }}>You can disconnect any time in Settings → AI assistants.</div>
    </Frame>
  );
}
