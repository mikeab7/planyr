/* Issues (B711906) — production errors grouped by message, newest first, read through
 * admin_error_groups() / admin_error_group_rows() (SECURITY DEFINER, is_admin()-gated; client_errors
 * keeps its INSERT-only policy). Errors are the default tab; diagnostic events and timing rows are
 * separate tabs, never mixed into the error list. The deliberate "that felt slow" presses now live
 * in Problem reports / Support (category "slow"), not here. */
import { useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { SegmentedControl } from "../../shared/ui/controls.jsx";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { RADIUS } from "../../shared/ui/radius.js";
import AdminPanel, { PanelState, useAdminLoad, th, td } from "./AdminPanel.jsx";
import {
  ISSUE_KINDS, ISSUE_WINDOWS, fetchErrorGroups, fetchErrorGroupRows, shapeErrorGroups, groupRowArgs, ago,
} from "./lib/adminPanels.js";

function GroupRows({ group }) {
  const { loading, data, error, reload } = useAdminLoad(() => fetchErrorGroupRows(supabase, groupRowArgs(group)), [group.kind, group.source, group.rawMessage]);
  const rows = data || [];
  return (
    <div style={{ padding: "6px 0 10px" }}>
      <PanelState loading={loading} error={error} empty={rows.length === 0} emptyText="No rows." onRetry={reload} />
      {rows.map((r) => (
        <details key={r.id} style={{ fontSize: FONT_SIZE.control, padding: "3px 0" }}>
          <summary style={{ cursor: "pointer" }}>
            {new Date(r.at).toLocaleString()} · build {r.build || "?"} · {r.module || "no module"} · {r.user_id ? "signed in" : "signed out"}
          </summary>
          <div style={{ color: "var(--text-secondary)", wordBreak: "break-all" }}>{r.url || "—"}</div>
          <div style={{ color: "var(--text-tertiary)", wordBreak: "break-all" }}>{r.user_agent || ""}</div>
          {r.stack && (
            <pre style={{ margin: "4px 0 0", padding: 8, background: "var(--surface-page)", border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, fontSize: FONT_SIZE.label, overflowX: "auto", maxHeight: 220 }}>{r.stack}</pre>
          )}
        </details>
      ))}
    </div>
  );
}

export default function IssuesSection() {
  const [kind, setKind] = useState("error");
  const [days, setDays] = useState(30);
  const [openKey, setOpenKey] = useState(null);
  const { loading, data, error, reload } = useAdminLoad(() => fetchErrorGroups(supabase, kind, days), [kind, days]);
  const groups = shapeErrorGroups(data);
  const total = groups.reduce((s, g) => s + g.occurrences, 0);
  return (
    <AdminPanel
      id="issues" title="Issues"
      blurb={`Production ${kind === "error" ? "errors" : kind === "event" ? "diagnostic events" : "timing rows"} grouped by message, most recently seen first. ${groups.length ? `${groups.length} ${groups.length === 1 ? "group" : "groups"}, ${total} occurrences in the last ${days} days.` : ""}`}
      actions={(
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <SegmentedControl value={kind} onChange={setKind} options={ISSUE_KINDS.map((k) => ({ key: k.id, label: k.label }))} aria-label="Kind" />
          <SegmentedControl value={days} onChange={setDays} options={ISSUE_WINDOWS.map((w) => ({ key: w.days, label: w.label }))} aria-label="Window" />
        </div>
      )}
    >
      <PanelState loading={loading} error={error} empty={groups.length === 0} emptyText="Nothing in this window." onRetry={reload} />
      {!loading && !error && groups.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT_SIZE.control }}>
            <thead><tr><th style={th}>Message</th><th style={th}>Source</th><th style={th}>Count</th><th style={th}>Accounts</th><th style={th}>Last seen</th><th style={th}>Build</th><th style={th} /></tr></thead>
            <tbody>
              {groups.map((g) => {
                const key = `${g.kind}|${g.source}|${g.rawMessage}`;
                const open = openKey === key;
                return [
                  <tr key={key} style={{ borderTop: "1px solid var(--border-default)" }}>
                    <td style={{ ...td, maxWidth: 420, wordBreak: "break-word" }}>{g.message}</td>
                    <td style={{ ...td, color: "var(--text-secondary)" }}>{(g.source || "").replace(/^event:/, "")}{g.module ? ` · ${g.module}` : ""}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{g.occurrences}</td>
                    <td style={td}>{g.accounts}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }} title={g.lastSeen || ""}>{ago(g.lastSeen)}</td>
                    <td style={td}>{g.lastBuild || "—"}{g.builds > 1 ? ` (+${g.builds - 1})` : ""}</td>
                    <td style={td}>
                      <button type="button" onClick={() => setOpenKey(open ? null : key)} style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", font: "inherit", padding: 0 }}>
                        {open ? "Hide rows" : "Recent rows"}
                      </button>
                    </td>
                  </tr>,
                  open && <tr key={`${key}-rows`}><td colSpan={7}><GroupRows group={g} /></td></tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminPanel>
  );
}
