/* Settings → AI assistants ("Connect to Claude", 2026-11-27; approved mockup step 1 and step 5).
 * The connector's address with Copy, the steps in Claude, and every live connection with when it was last used and a
 * one-press Disconnect that stops it on the very next call. Names are SELF-REPORTED by the assistant, so each row
 * also says which site it sends you back to (a fake "Claude" would show a different host). Lazy: loads only when the
 * section opens. Module-scope components only; tokens only (docs/DESIGN.md). */
import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/controls.jsx";
import { RADIUS } from "../ui/radius.js";
import { FONT_SIZE, SPACE } from "../ui/designTokens.js";
import { listMyAssistants, disconnectAssistant } from "./connectorClient.js";
import { connectorUrl } from "../auth/connectRequest.js";
import { grantLine } from "./assistantsView.js";

const ink = "var(--text-primary)", muted = "var(--text-secondary)", line = "var(--border-default)";
const card = { border: `1px solid ${line}`, borderRadius: RADIUS.lg, background: "var(--surface-field)", padding: SPACE.xl };
const small = { fontSize: FONT_SIZE.control, color: muted, lineHeight: 1.5 };

function AddressBox() {
  const url = connectorUrl(typeof window !== "undefined" ? window.location.origin : undefined);
  const [copied, setCopied] = useState(null);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied("ok"); }
    catch (_) { setCopied("fail"); }
  };
  return (
    <div>
      <div style={{ display: "flex", gap: SPACE.md, alignItems: "center", flexWrap: "wrap" }}>
        <code data-testid="assistants-url" style={{ flex: "1 1 200px", minWidth: 0, fontSize: FONT_SIZE.emphasis, padding: `${SPACE.sm}px ${SPACE.lg}px`, border: `1px solid ${line}`, borderRadius: RADIUS.md, background: "var(--surface-default)", color: ink, wordBreak: "break-all", userSelect: "all" }}>{url}</code>
        <Button size="sm" variant="ghost" data-testid="assistants-copy" onClick={copy}>{copied === "ok" ? "Copied" : "Copy address"}</Button>
      </div>
      {copied === "fail" && <div role="alert" style={{ ...small, color: "var(--danger-text)", marginTop: SPACE.xs }}>Couldn’t copy. Select the address and copy it yourself.</div>}
    </div>
  );
}

function GrantRow({ g, busy, onDisconnect }) {
  return (
    <div data-testid="assistant-row" data-grant-id={g.id} style={{ display: "flex", gap: SPACE.lg, alignItems: "center", padding: `${SPACE.lg}px 0`, borderTop: `1px solid ${line}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FONT_SIZE.display, fontWeight: 700, color: ink, wordBreak: "break-word" }}>{g.client_name}</div>
        <div style={small}>{grantLine(g)}</div>
        <div style={small}>Read only · sends you back to {g.redirect_host}</div>
      </div>
      <Button size="sm" variant="ghost" disabled={busy} data-testid="assistant-disconnect" onClick={() => onDisconnect(g)} style={{ color: "var(--danger-text)" }}>{busy ? "…" : "Disconnect"}</Button>
    </div>
  );
}

export default function AssistantsPanel({ sectionHead }) {
  const [state, setState] = useState({ phase: "loading", grants: [] });
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const load = useCallback(async () => {
    setState((s) => ({ ...s, phase: "loading" }));
    const r = await listMyAssistants();
    setState(r.ok ? { phase: "ready", grants: r.grants } : { phase: "error", grants: [], message: r.message });
  }, []);
  useEffect(() => { load(); }, [load]);

  const disconnect = async (g) => {
    setBusyId(g.id); setNotice(null);
    const r = await disconnectAssistant(g.id);
    setBusyId(null);
    if (!r.ok && r.reason !== "missing") { setNotice({ type: "err", text: `Couldn’t disconnect ${g.client_name}: ${r.message}` }); return; }
    setNotice({ type: "ok", text: `${g.client_name} is disconnected. It can’t read Planyr any more.` });
    load();
  };

  return (
    <div data-settings-panel="assistants">
      {sectionHead ? sectionHead("AI assistants") : null}
      <div style={card}>
        <div style={{ fontSize: FONT_SIZE.display, fontWeight: 700, color: ink }}>Use Planyr from Claude</div>
        <div style={{ ...small, margin: `${SPACE.xs}px 0 ${SPACE.lg}px` }}>
          Your assistant can look up your projects, site plans, schedules and file names when you ask it. It can’t change anything, and it sees only what you can see.
        </div>
        <AddressBox />
        <div style={{ ...small, marginTop: SPACE.lg }} data-testid="assistants-steps">
          <strong style={{ color: ink }}>In Claude:</strong> Settings → Connectors → Add custom connector → paste the address → Connect. Planyr then asks you to approve it.
        </div>
      </div>

      <div style={{ marginTop: SPACE.xxl }}>
        <div style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: ink, marginBottom: SPACE.xs }}>Connected assistants</div>
        {notice && <div role={notice.type === "err" ? "alert" : "status"} data-testid="assistants-notice" style={{ ...small, color: notice.type === "err" ? "var(--danger-text)" : ink, marginBottom: SPACE.sm }}>{notice.text}</div>}
        {state.phase === "loading" && state.grants.length === 0 && <div style={small}>Loading…</div>}
        {state.phase === "error" && (
          <div role="alert" data-testid="assistants-error" style={{ ...small, color: "var(--danger-text)" }}>
            Couldn’t load your connections ({state.message}). <Button size="sm" variant="ghost" onClick={load}>Try again</Button>
          </div>
        )}
        {state.phase === "ready" && state.grants.length === 0 && <div data-testid="assistants-empty" style={small}>No assistants connected yet.</div>}
        {state.grants.map((g) => <GrantRow key={g.id} g={g} busy={busyId === g.id} onDisconnect={disconnect} />)}
        {state.grants.length > 0 && <div style={{ ...small, marginTop: SPACE.sm }}>Disconnecting stops it at once. To use it again, reconnect from Claude.</div>}
      </div>
    </div>
  );
}
