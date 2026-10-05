/* Ops (B711908) — outstanding work + Claude Code session hygiene, as a page instead of a chat.
 * Outstanding work is a READ-ONLY DIGEST of the repo ledger (counts + the newest items), stored in
 * public.ops_snapshots by `node scripts/ops-snapshot.mjs --sql`; the ledger files stay canonical.
 * The session-sweep log is public.ops_session_sweeps, written through admin_record_session_sweep()
 * (is_admin()-gated) — by the form below or by the weekly sweep run on the owner's own account. */
import { useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { Button } from "../../shared/ui/controls.jsx";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { RADIUS } from "../../shared/ui/radius.js";
import AdminPanel, { PanelState, useAdminLoad } from "./AdminPanel.jsx";
import { fetchOps, shapeOps, recordSessionSweep, parseStillOpen, ago } from "./lib/adminPanels.js";

function Digest({ title, d }) {
  return (
    <div style={{ minWidth: 0 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: FONT_SIZE.emphasis }}>{title}: {d.count}</h3>
      {d.recent.map((r) => (
        <div key={r.id} style={{ fontSize: FONT_SIZE.control, padding: "2px 0", wordBreak: "break-word" }}>
          <strong>{r.id}</strong> {r.title}
        </div>
      ))}
      {d.count > d.recent.length && <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>…and {d.count - d.recent.length} more in the ledger</div>}
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
      <summary style={{ cursor: "pointer", fontSize: FONT_SIZE.control, fontWeight: 700 }}>Record a session sweep</summary>
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
  return (
    <AdminPanel id="ops" title="Ops" blurb="What is outstanding, and the state of Claude Code session clean-up.">
      <PanelState loading={loading} error={error} onRetry={reload} />
      {ops && (
        <>
          <h3 style={{ margin: 0, fontSize: FONT_SIZE.emphasis }}>Session sweeps</h3>
          {last ? (
            <div style={{ fontSize: FONT_SIZE.control }}>
              Last sweep {ago(last.at)}: {last.archived} archived, {last.stillOpen.length} still open.
              {last.stillOpen.map((o, i) => <div key={i} style={{ padding: "2px 0" }}>• {o.title}{o.waitingOn ? ` — waiting on ${o.waitingOn}` : ""}</div>)}
              {last.note && <div style={{ color: "var(--text-secondary)" }}>{last.note}</div>}
            </div>
          ) : <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>No sweep recorded yet.</div>}
          <SweepForm onSaved={reload} />
          {ops.sweeps.length > 1 && (
            <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>
              Earlier: {ops.sweeps.slice(1).map((s) => `${s.at.slice(0, 10)} (${s.archived} archived, ${s.stillOpen.length} open)`).join(" · ")}
            </div>
          )}
          <h3 style={{ margin: "8px 0 0", fontSize: FONT_SIZE.emphasis }}>Outstanding work</h3>
          {!ops.backlog && !ops.verification ? (
            <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>No ledger snapshot loaded yet.</div>
          ) : (
            <>
              <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>
                Digest of the repo ledger, taken {ago((ops.backlog || ops.verification).updatedAt)} — the ledger files stay canonical.
                {ops.backlog && ops.backlog.open.topTags.length > 0 && ` Biggest themes: ${ops.backlog.open.topTags.map((x) => `${x.tag} ${x.count}`).join(", ")}.`}
              </div>
              <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                {ops.backlog && <Digest title="Open backlog items" d={ops.backlog.open} />}
                {ops.backlog && <Digest title="Waiting on a live check (Verify)" d={ops.backlog.verify} />}
                {ops.verification && <Digest title="Pending live checks (V#)" d={ops.verification.pending} />}
              </div>
            </>
          )}
        </>
      )}
    </AdminPanel>
  );
}
