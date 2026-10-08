/* Support (B711907, NEW-4) — the triage queue over what people file through the app's "Report a problem /
 * Something was slow" control (public.problem_reports); the old separate "Problem reports" list is merged in
 * (same data, one place). Compact one-line rows; items with a written description stay individual, bare
 * "something was slow" taps collapse into one group per account with an inline-confirmed "Close all".
 * Close / Reopen writes through admin_set_report_status() (is_admin()-gated server-side). Each row expands to
 * its context and the reporter's recent errors. */
import { useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { Button, SegmentedControl } from "../../shared/ui/controls.jsx";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { RADIUS } from "../../shared/ui/radius.js";
import AdminPanel, { Chip, PanelState, useAdminLoad } from "./AdminPanel.jsx";
import { AdminTable, Th, Td, Clip, RelTime, LinkButton } from "./AdminTable.jsx";
import { useAdminData } from "./AdminData.jsx";
import { setReportStatus, fetchRecentErrorsForUser, ticketFrom } from "./lib/adminPanels.js";
import { splitDeployReloads } from "./lib/adminIssues.js";
import { groupSupport, contextSummary } from "./lib/adminSupport.js";

function RecentErrors({ userId }) {
  const { loading, data, error, reload } = useAdminLoad(() => fetchRecentErrorsForUser(supabase, userId, 50), [userId]);
  const { errors: rows, deployReloads } = splitDeployReloads(data, 15);
  return (
    <div style={{ marginTop: 6 }}>
      <PanelState loading={loading} error={error} empty={rows.length === 0} emptyText="No recent errors from this account." onRetry={reload} />
      {rows.map((r) => (
        <div key={r.id} style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", padding: "2px 0", wordBreak: "break-word" }}>
          <RelTime iso={r.at} /> · build {r.build || "?"} · {r.module || "—"} · {r.message || "(no message)"}
        </div>
      ))}
      {deployReloads > 0 && <div data-testid="deploy-reloads-line" style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", padding: "2px 0" }}>{deployReloads} deploy {deployReloads === 1 ? "reload" : "reloads"} (expected)</div>}
    </div>
  );
}

function Detail({ t }) {
  return (
    <div style={{ padding: "8px 12px 12px", fontSize: FONT_SIZE.control }}>
      <div style={{ whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>{t.description || "(no description — a bare “something was slow” tap)"}</div>
      <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>{contextSummary(t.context)}</div>
      {t.context && <pre style={{ margin: "6px 0 0", padding: 8, background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, fontSize: FONT_SIZE.label, overflowX: "auto", maxHeight: 200 }}>{JSON.stringify(t.context, null, 2)}</pre>}
      {t.userId && <RecentErrors userId={t.userId} />}
    </div>
  );
}

function TicketRow({ t, indent, onToggle, busy, err, expanded, setExpanded }) {
  return (
    <>
      <tr data-testid="support-row">
        <Td style={{ paddingLeft: indent ? 28 : 12 }}><Chip tone={t.category === "slow" ? "warn" : "danger"}>{t.category === "slow" ? "Slow" : "Problem"}</Chip></Td>
        <Td><Clip max={200}>{ticketFrom(t)}</Clip></Td>
        <Td><Clip max={420}>{t.description || "(bare slow tap)"}</Clip></Td>
        <Td><RelTime iso={t.at} /></Td>
        <Td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <LinkButton onClick={() => setExpanded(expanded ? null : t.id)} aria-expanded={expanded}>{expanded ? "Hide" : "Details"}</LinkButton>{" "}
          <Button variant={t.status === "open" ? "primary" : "ghost"} size="sm" disabled={busy} onClick={() => onToggle(t)}>{t.status === "open" ? "Close" : "Reopen"}</Button>
          {err && <div role="alert" style={{ color: "var(--danger-text)", fontSize: FONT_SIZE.label }}>Could not update: {err}</div>}
        </Td>
      </tr>
      {expanded && <tr><td colSpan={5} style={{ borderTop: "1px solid var(--border-default)", background: "var(--surface-page)" }}><Detail t={t} /></td></tr>}
    </>
  );
}

function SlowGroup({ g, onChanged, expandedId, setExpandedId, toggleOne, busyId, errId, errMsg }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const isOpen = g.tickets.some((t) => t.status === "open");
  const closeAll = async () => {
    setBusy(true); setErr(null);
    const results = await Promise.all(g.tickets.filter((t) => t.status === "open").map((t) => setReportStatus(supabase, t.id, "closed")));
    setBusy(false); setConfirm(false);
    const failed = results.filter((r) => r.error);
    if (failed.length) setErr(`${failed.length} of ${results.length} could not be closed: ${failed[0].error}`);
    onChanged();
  };
  return (
    <>
      <tr data-testid="slow-group">
        <Td><Chip tone="warn">Slow</Chip></Td>
        <Td><Clip max={200}>{g.who}</Clip></Td>
        <Td><strong>{g.label}</strong></Td>
        <Td><RelTime iso={g.latest} /></Td>
        <Td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <LinkButton onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Collapse" : "Expand"}</LinkButton>{" "}
          {isOpen && !confirm && <Button variant="primary" size="sm" onClick={() => setConfirm(true)}>Close all</Button>}
          {isOpen && confirm && (
            <>
              <span style={{ fontSize: FONT_SIZE.control, fontWeight: 600 }}>Close {g.tickets.length}? </span>
              <Button variant="danger" size="sm" disabled={busy} onClick={closeAll}>{busy ? "Closing…" : "Yes, close all"}</Button>{" "}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button>
            </>
          )}
          {err && <div role="alert" style={{ color: "var(--danger-text)", fontSize: FONT_SIZE.label }}>{err}</div>}
        </Td>
      </tr>
      {open && g.tickets.map((t) => (
        <TicketRow key={t.id} t={t} indent onToggle={toggleOne} busy={busyId === t.id} err={errId === t.id ? errMsg : null} expanded={expandedId === t.id} setExpanded={setExpandedId} />
      ))}
    </>
  );
}

export default function SupportSection() {
  const d = useAdminData();
  const { support } = d;
  const { open, closed } = support.tickets;
  const { hideInternal, setHideInternal } = d;
  const [filter, setFilter] = useState("open");
  const [expandedId, setExpandedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [errId, setErrId] = useState(null);
  const [errMsg, setErrMsg] = useState(null);
  const toggleOne = async (t) => {
    setBusyId(t.id); setErrId(null);
    const { error } = await setReportStatus(supabase, t.id, t.status === "open" ? "closed" : "open");
    setBusyId(null);
    if (error) { setErrId(t.id); setErrMsg(error); } else support.reload();
  };
  const list = filter === "open" ? open : closed;
  const { items, groups } = groupSupport(list, { oldestFirst: filter === "open" });
  return (
    <AdminPanel
      id="support" title="Support"
      blurb={support.loading || support.error ? "Reports filed from inside the app, as a queue." : `${open.length} open, ${closed.length} closed${hideInternal && support.hiddenOpen + support.hiddenClosed ? ` — excluding ${support.hiddenOpen + support.hiddenClosed} from internal/test accounts and marked tests` : ""}. Written reports first; bare slow taps grouped by account.`}
      actions={(
        <>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: FONT_SIZE.control, fontWeight: 600 }} title="Reports from test and internal accounts (e2e, your own) and signed-out reports marked as a test. Nothing is closed or deleted — this only hides them from the list, the nav badge and the Overview tile.">
            <input type="checkbox" checked={hideInternal} onChange={(e) => setHideInternal(e.target.checked)} data-testid="support-hide-internal" /> Hide internal{support.hiddenOpen + support.hiddenClosed ? ` (${support.hiddenOpen + support.hiddenClosed})` : ""}
          </label>
          <SegmentedControl value={filter} onChange={setFilter} options={[{ key: "open", label: `Open ${open.length}` }, { key: "closed", label: `Closed ${closed.length}` }]} aria-label="Status" />
          <Button variant="ghost" size="sm" onClick={support.reload}>Refresh</Button>
        </>
      )}
    >
      <PanelState loading={support.loading} error={support.error} empty={!support.loading && !support.error && list.length === 0} emptyText={filter === "open" ? "Nothing open." : "Nothing closed yet."} emptyHint={open.length + closed.length === 0 ? (support.allCount > 0 ? "Everything filed so far is from internal or test accounts — switch off Hide internal to see it." : "No reports have been filed from the app yet.") : undefined} onRetry={support.reload} />
      {!support.loading && !support.error && list.length > 0 && (
        <AdminTable maxHeight={640} minWidth={720}>
          <thead><tr><Th>Kind</Th><Th>From</Th><Th>What</Th><Th>When</Th><Th /></tr></thead>
          <tbody>
            {items.map((t) => <TicketRow key={t.id} t={t} onToggle={toggleOne} busy={busyId === t.id} err={errId === t.id ? errMsg : null} expanded={expandedId === t.id} setExpanded={setExpandedId} />)}
            {groups.map((g) => <SlowGroup key={g.key} g={g} onChanged={support.reload} expandedId={expandedId} setExpandedId={setExpandedId} toggleOne={toggleOne} busyId={busyId} errId={errId} errMsg={errMsg} />)}
          </tbody>
        </AdminTable>
      )}
    </AdminPanel>
  );
}
