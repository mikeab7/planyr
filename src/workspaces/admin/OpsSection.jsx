/* Ops (B711908) — outstanding work + Claude Code session hygiene, as a page instead of a chat.
 * Outstanding work is a READ-ONLY DIGEST of the repo ledger (counts + the newest items), stored in
 * public.ops_snapshots; the Build workflow's `ops-digest` job refreshes it after every merge to main
 * (B2159504, scripts/ops-snapshot.mjs --push); the ledger files stay canonical.
 * The session-sweep log is public.ops_session_sweeps, written through admin_record_session_sweep()
 * (is_admin()-gated) — by the form below or by the weekly sweep run on the owner's own account. */
import { useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { Button } from "../../shared/ui/controls.jsx";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { RADIUS } from "../../shared/ui/radius.js";
import AdminPanel, { Card, Chip, PanelState, useAdminLoad } from "./AdminPanel.jsx";
import { exactTime } from "./lib/adminFormat.js";
import { fetchOps, shapeOps, recordSessionSweep, parseStillOpen, ago, digestStamp } from "./lib/adminPanels.js";
import { snapshotHealth, CHECK_LABELS, SOURCES, SOURCE_LABELS, staleLimitMin } from "../../shared/auth/signinHealth.js";

/* NEW-1 (2026-11-02, after B2619760) — the hourly outside-in sign-in check. "Stopped" is computed here from the clock:
 * a snapshot that says all-clear and has not been touched for hours is exactly the dead-man's-switch case. */
const SIGNIN_TONE = { ok: "ok", broken: "danger", stale: "danger", none: "danger", blind: "warn" };
function SigninHealth({ snap }) {
  const h = snapshotHealth(snap, Date.now());
  const e = (snap && snap.events) || {};
  return (
    <div data-testid="signin-health" data-state={h.state}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: FONT_SIZE.control }}>
        <Chip tone={SIGNIN_TONE[h.state] || "neutral"}>{{ ok: "Sign-in OK", broken: "Sign-in BROKEN", stale: "Check stopped", none: "Never checked", blind: "Cannot confirm" }[h.state]}</Chip>
        <span>{h.line}</span>
      </div>
      {snap && (
        <>
          <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginTop: 6 }}>
            Last hour from browsers: {e.ok || 0} signed in · {e.wrongPassword || 0} wrong passwords · {e.refused || 0} refused by the bot check · {e.blocked || 0} blocked scripts · {e.widgetError || 0} widget errors · {e.timeout || 0} timeouts · {e.network || 0} network failures
            {snap.lastCheckAt ? <> · last outside check {ago(snap.lastCheckAt)}</> : null}
          </div>
          {snap.sources && (
            <div data-testid="signin-sources" style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginTop: 6 }}>
              {SOURCES.map((src, i) => {
                const at = snap.sources[src] && snap.sources[src].lastAt;
                const late = at && (Date.now() - new Date(at).getTime()) / 60000 > staleLimitMin(src);
                return (
                  <span key={src} data-source={src} data-late={late ? "1" : "0"}>
                    {i > 0 ? " · " : ""}{SOURCE_LABELS[src]}: {at ? `last ran ${ago(at)}` : "has not run yet"}{late ? " — STOPPED" : ""}
                  </span>
                );
              })}
            </div>
          )}
          {h.gaps.length > 0 && (
            <div data-testid="signin-coverage-gap" style={{ fontSize: FONT_SIZE.control, marginTop: 6 }}>
              <Chip tone="warn">Coverage gap</Chip> {h.gaps.map((g) => g.text).join(" ")}
            </div>
          )}
          {Array.isArray(snap.checks) && snap.checks.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {snap.checks.map((c) => (
                <div key={c.name} style={{ fontSize: FONT_SIZE.control, padding: "1px 0" }}>
                  <strong>{c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : c.status === "skipped" ? "–" : c.uncovered ? "∅" : "?"}</strong> {CHECK_LABELS[c.name] || c.name}{c.detail ? <span style={{ color: "var(--text-secondary)" }}> — {c.detail}</span> : null}
                </div>
              ))}
            </div>
          )}
          {snap.mail && !snap.mail.configured && <div style={{ fontSize: FONT_SIZE.label, color: "var(--danger-text)", marginTop: 6 }}>Alarm email is not set up in Cloudflare yet (GMAIL_SERVICE_ACCOUNT_JSON + INVITE_SENDER): a break would reach you only through the GitHub issue.</div>}
        </>
      )}
    </div>
  );
}

function Digest({ title, d }) {
  return (
    <div style={{ minWidth: 0 }}>
      <h4 style={{ margin: "0 0 4px", fontSize: FONT_SIZE.emphasis }}>{title}: {d.count}</h4>
      {d.recent.map((r) => (
        <div key={r.id} style={{ fontSize: FONT_SIZE.control, padding: "2px 0", wordBreak: "break-word" }}>
          <strong>{r.id}</strong> {r.title}
        </div>
      ))}
      {d.count > d.recent.length && <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>…and {d.count - d.recent.length} more in the ledger</div>}
    </div>
  );
}

function SweepForm({ onSaved }) {
  const [archived, setArchived] = useState("0");
  const [stillOpen, setStillOpen] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const field = { font: "inherit", fontSize: FONT_SIZE.control, padding: "6px 8px", border: "1px solid var(--border-default)", borderRadius: RADIUS.md, background: "var(--surface-page)", color: "var(--text-primary)" };
  const save = async () => {
    setBusy(true); setErr(null);
    const { error } = await recordSessionSweep(supabase, { archived: Math.max(0, parseInt(archived, 10) || 0), stillOpen: parseStillOpen(stillOpen), note });
    setBusy(false);
    if (error) { setErr(error); return; }
    setStillOpen(""); setNote(""); setArchived("0"); onSaved();
  };
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: FONT_SIZE.control, fontWeight: 700 }} data-testid="record-manually">Record manually</summary>
      <div style={{ display: "grid", gap: 8, marginTop: 8, maxWidth: 560 }}>
        <label style={{ fontSize: FONT_SIZE.control }}>Sessions archived<input type="number" min="0" value={archived} onChange={(e) => setArchived(e.target.value)} style={{ ...field, display: "block", width: 90, marginTop: 2 }} /></label>
        <label style={{ fontSize: FONT_SIZE.control }}>Still open — one per line, “title — what it is waiting on”
          <textarea rows={4} value={stillOpen} onChange={(e) => setStillOpen(e.target.value)} style={{ ...field, display: "block", width: "100%", boxSizing: "border-box", marginTop: 2 }} /></label>
        <label style={{ fontSize: FONT_SIZE.control }}>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} style={{ ...field, display: "block", width: "100%", boxSizing: "border-box", marginTop: 2 }} /></label>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Button size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save sweep"}</Button>
          {err && <span role="alert" style={{ color: "var(--danger-text)", fontSize: FONT_SIZE.control }}>Could not save: {err}</span>}
        </div>
      </div>
    </details>
  );
}

export default function OpsSection() {
  const { loading, data, error, reload } = useAdminLoad(() => fetchOps(supabase), []);
  const ops = data ? shapeOps(data) : null;
  const last = ops && ops.sweeps[0];
  const stamp = ops && digestStamp(ops);
  return (
    <AdminPanel id="ops" title="Ops" blurb="What is outstanding, and the state of Claude Code session clean-up." actions={<Button variant="ghost" size="sm" onClick={reload}>Refresh</Button>}>
      <PanelState loading={loading} error={error} onRetry={reload} />
      {ops && (
        <>
          <Card title="Session sweeps">
          {last ? (
            <div style={{ fontSize: FONT_SIZE.control }}>
              Last sweep {ago(last.at)}: {last.archived} archived, {last.stillOpen.length} still open.
              {last.stillOpen.map((o, i) => <div key={i} style={{ padding: "2px 0" }}>• {o.title}{o.waitingOn ? ` — waiting on ${o.waitingOn}` : ""}</div>)}
              {last.note && <div style={{ color: "var(--text-secondary)" }}>{last.note}</div>}
            </div>
          ) : (
            <PanelState empty emptyText="No session sweep recorded yet." emptyHint="Recorded automatically by the weekly sweep." />
          )}
          <div style={{ marginTop: 10 }}><SweepForm onSaved={reload} /></div>
          {ops.sweeps.length > 1 && (
            <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>
              Earlier: {ops.sweeps.slice(1).map((s) => `${new Date(s.at).toLocaleDateString()} (${s.archived} archived, ${s.stillOpen.length} open)`).join(" · ")}
            </div>
          )}
          </Card>
          <Card title="Sign-in health">
            <SigninHealth snap={ops.signin} />
          </Card>
          <Card title="Outstanding work">
          {!ops.backlog && !ops.verification ? (
            <PanelState empty emptyText="No ledger digest loaded yet." emptyHint="The digest is pushed from the repo after every merge to main; nothing on this page can create it." />
          ) : (
            <>
              <div data-testid="digest-stamp" style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span title={exactTime(stamp.at)}>
                  Updated <strong>{stamp.ago}</strong>{stamp.commit ? <> after <code>{stamp.commit}</code></> : " (loaded by hand — no merge recorded)"}. Refreshed after every merge to main.
                </span>
                {stamp.stale && <Chip tone="warn">Not updating — check the OPS_INGEST_TOKEN secret</Chip>}
                {ops.backlog && ops.backlog.open.topTags.length > 0 && <span>Biggest themes: {ops.backlog.open.topTags.map((x) => `${x.tag} ${x.count}`).join(", ")}.</span>}
              </div>
              <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                {ops.backlog && <Digest title="Open backlog items" d={ops.backlog.open} />}
                {ops.backlog && <Digest title="Waiting on a live check (Verify)" d={ops.backlog.verify} />}
                {ops.verification && <Digest title="Pending live checks (V#)" d={ops.verification.pending} />}
              </div>
            </>
          )}
          </Card>
        </>
      )}
    </AdminPanel>
  );
}
