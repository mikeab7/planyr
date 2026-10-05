/* Support (B711907, admin side) — the triage queue over what people file through the app's
 * "Report a problem / Something was slow" control (public.problem_reports). Open tickets first,
 * oldest-waiting first; Close / Reopen writes through admin_set_report_status() (is_admin()-gated
 * server-side). Each ticket can pull the reporter's recent errors (admin_recent_errors_for_user) so
 * it arrives with context. The full history table is the "Problem reports" section below.
 * NOT built here: a separate support_tickets table / in-app Help form (the existing report control
 * already files the ticket) and any email notification (parked on the transactional-email decision). */
import { useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { Button } from "../../shared/ui/controls.jsx";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import AdminPanel, { PanelState, useAdminLoad } from "./AdminPanel.jsx";
import { fetchSupportReports, shapeTickets, setReportStatus, fetchRecentErrorsForUser, ticketFrom, ago } from "./lib/adminPanels.js";

function RecentErrors({ userId }) {
  const { loading, data, error, reload } = useAdminLoad(() => fetchRecentErrorsForUser(supabase, userId), [userId]);
  const rows = data || [];
  return (
    <div style={{ marginTop: 6 }}>
      <PanelState loading={loading} error={error} empty={rows.length === 0} emptyText="No recent errors from this account." onRetry={reload} />
      {rows.map((r) => (
        <div key={r.id} style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", padding: "2px 0", wordBreak: "break-word" }}>
          {ago(r.at)} · build {r.build || "?"} · {r.module || "—"} · {r.message || "(no message)"}
        </div>
      ))}
    </div>
  );
}

function Ticket({ t, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showErrors, setShowErrors] = useState(false);
  const toggle = async () => {
    setBusy(true); setErr(null);
    const { error } = await setReportStatus(supabase, t.id, t.status === "open" ? "closed" : "open");
    setBusy(false);
    if (error) setErr(error); else onChanged();
  };
  return (
    <div style={{ borderTop: "1px solid var(--border-default)", padding: "8px 0", fontSize: FONT_SIZE.control }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ color: t.category === "slow" ? "var(--warn-text)" : "var(--text-primary)" }}>{t.category === "slow" ? "Slow" : "Problem"}</strong>
        <span style={{ color: "var(--text-secondary)" }}>{ticketFrom(t)}</span>
        <span style={{ color: "var(--text-tertiary)" }} title={t.at}>{ago(t.at)}</span>
        {t.build && <span style={{ color: "var(--text-tertiary)" }}>build {t.build}</span>}
        <span style={{ flex: 1 }} />
        {t.userId && <Button variant="secondary" size="sm" onClick={() => setShowErrors((v) => !v)}>{showErrors ? "Hide errors" : "Recent errors"}</Button>}
        <Button variant={t.status === "open" ? "primary" : "secondary"} size="sm" disabled={busy} onClick={toggle}>{t.status === "open" ? "Close" : "Reopen"}</Button>
      </div>
      <div style={{ whiteSpace: "pre-wrap", margin: "4px 0 0", color: "var(--text-primary)" }}>{t.description || "(no description — a bare “something was slow” tap)"}</div>
      {err && <div role="alert" style={{ color: "var(--danger-text)", marginTop: 4 }}>Could not update: {err}</div>}
      {showErrors && t.userId && <RecentErrors userId={t.userId} />}
    </div>
  );
}

export default function SupportSection() {
  const { loading, data, error, reload } = useAdminLoad(() => fetchSupportReports(supabase), []);
  const { open, closed } = shapeTickets(data);
  const [showClosed, setShowClosed] = useState(false);
  return (
    <AdminPanel
      id="support" title="Support"
      blurb={loading || error ? "Reports filed from inside the app, as a queue." : `${open.length} open, ${closed.length} closed. Oldest open first.`}
    >
      <PanelState loading={loading} error={error} empty={open.length + closed.length === 0} emptyText="No tickets filed yet." onRetry={reload} />
      {!loading && !error && open.length === 0 && closed.length > 0 && <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>Nothing open.</div>}
      {!loading && !error && open.map((t) => <Ticket key={t.id} t={t} onChanged={reload} />)}
      {!loading && !error && closed.length > 0 && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setShowClosed((v) => !v)}>{showClosed ? "Hide closed" : `Show closed (${closed.length})`}</Button>
          {showClosed && closed.map((t) => <Ticket key={t.id} t={t} onChanged={reload} />)}
        </div>
      )}
    </AdminPanel>
  );
}
