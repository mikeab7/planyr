/* Issues (B711906, NEW-2) — SHORT by default. Production errors read through admin_error_groups() /
 * admin_error_group_rows() (SECURITY DEFINER, is_admin()-gated; client_errors keeps its INSERT-only
 * policy). Deploy chunk-load errors fold into ONE collapsed line and stay out of the headline count; the
 * rest group by normalised message with their sources listed inside the row (lib/adminIssues.js). Top 10,
 * then pages of 25; 7-day default window; groups first seen in the last 24 h are marked New. */
import { useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { Button, SegmentedControl } from "../../shared/ui/controls.jsx";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { RADIUS } from "../../shared/ui/radius.js";
import AdminPanel, { Chip, PanelState, useAdminLoad } from "./AdminPanel.jsx";
import { AdminTable, Th, Td, Clip, RelTime, LinkButton, nextSort } from "./AdminTable.jsx";
import { exactTime } from "./lib/adminFormat.js";
import { ISSUE_KINDS, ISSUE_WINDOWS, fetchErrorGroups, fetchErrorGroupRows, shapeErrorGroups, groupRowArgs } from "./lib/adminPanels.js";
import { foldIssues, searchIssues, sortIssues, visibleCount } from "./lib/adminIssues.js";

function GroupRows({ group }) {
  const { loading, data, error, reload } = useAdminLoad(async () => {
    const parts = await Promise.all(group.rawKeys.map((k) => fetchErrorGroupRows(supabase, groupRowArgs({ ...k, rawMessage: k.message }))));
    const bad = parts.find((p) => p.error);
    if (bad) return { data: null, error: bad.error };
    return { data: parts.flatMap((p) => p.data || []).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 25), error: null };
  }, [group.key]);
  const rows = data || [];
  return (
    <div style={{ padding: "8px 12px 12px" }}>
      <PanelState loading={loading} error={error} empty={rows.length === 0} emptyText="No rows." onRetry={reload} />
      {rows.map((r) => (
        <details key={r.id} style={{ fontSize: FONT_SIZE.control, padding: "3px 0" }}>
          <summary style={{ cursor: "pointer" }}>
            <span title={exactTime(r.at)}>{new Date(r.at).toLocaleString()}</span> · build {r.build || "?"} · {r.module || "no module"} · {r.user_id ? "signed in" : "signed out"}
          </summary>
          <div style={{ color: "var(--text-secondary)", wordBreak: "break-all" }}>{r.url || "—"}</div>
          <div style={{ color: "var(--text-secondary)", wordBreak: "break-all" }}>{r.user_agent || ""}</div>
          {r.stack && <pre style={{ margin: "4px 0 0", padding: 8, background: "var(--surface-page)", border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, fontSize: FONT_SIZE.label, overflowX: "auto", maxHeight: 220 }}>{r.stack}</pre>}
        </details>
      ))}
    </div>
  );
}

function DeployLine({ deploy }) {
  const [open, setOpen] = useState(false);
  if (deploy.occurrences === 0) return null;
  return (
    <div data-testid="deploy-fold" style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.md, background: "var(--surface-raised)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", flexWrap: "wrap" }}>
        <Chip tone="neutral">Expected</Chip>
        <strong style={{ fontSize: FONT_SIZE.control }}>Deploy reloads — {deploy.occurrences} {deploy.occurrences === 1 ? "occurrence" : "occurrences"} across {deploy.fileCount} {deploy.fileCount === 1 ? "file" : "files"}</strong>
        <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>A tab still running the old build asks for a chunk the new deploy replaced. Not counted as errors.</span>
        <span style={{ flex: 1 }} />
        <LinkButton onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Hide files" : "Show files"}</LinkButton>
      </div>
      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          <AdminTable maxHeight={260}>
            <thead><tr><Th>File</Th><Th>Sources</Th><Th num>Count</Th><Th>Last seen</Th></tr></thead>
            <tbody>{deploy.files.map((f) => <tr key={f.file}><Td>{f.file}</Td><Td>{f.sources.join(", ")}</Td><Td num>{f.occurrences}</Td><Td><RelTime iso={f.lastSeen} /></Td></tr>)}</tbody>
          </AdminTable>
        </div>
      )}
    </div>
  );
}

export default function IssuesSection() {
  const [kind, setKind] = useState("error");
  const [days, setDays] = useState(7);
  const [openKey, setOpenKey] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "count", dir: "desc" });
  const [clicks, setClicks] = useState(0);
  const { loading, data, error, reload } = useAdminLoad(() => fetchErrorGroups(supabase, kind, days), [kind, days]);
  const { deploy, groups } = foldIssues(shapeErrorGroups(data));
  const total = groups.reduce((s, g) => s + g.occurrences, 0);
  const shown = sortIssues(searchIssues(groups, q), sort.key, sort.dir);
  const limit = visibleCount(clicks);
  const label = kind === "error" ? "errors" : kind === "event" ? "diagnostic events" : "timing rows";
  const onSort = (key) => { setSort((s) => nextSort(s, key)); setClicks(0); };
  return (
    <AdminPanel
      id="issues" title="Issues"
      blurb={loading || error ? `Production ${label}, grouped.` : `${groups.length} ${groups.length === 1 ? "group" : "groups"}, ${total} ${label} in the last ${days} days${kind === "error" && deploy.occurrences ? " — deploy reloads excluded" : ""}.`}
      actions={(
        <>
          <SegmentedControl value={kind} onChange={(k) => { setKind(k); setClicks(0); }} options={ISSUE_KINDS.map((k) => ({ key: k.id, label: k.label }))} aria-label="Kind" />
          <SegmentedControl value={days} onChange={(d) => { setDays(d); setClicks(0); }} options={ISSUE_WINDOWS.map((w) => ({ key: w.days, label: w.label }))} aria-label="Window" />
          <Button variant="ghost" size="sm" onClick={reload}>Refresh</Button>
        </>
      )}
    >
      <PanelState loading={loading} error={error} onRetry={reload} />
      {!loading && !error && (
        <>
          <input
            aria-label="Search messages" placeholder="Search message or source…" value={q} onChange={(e) => { setQ(e.target.value); setClicks(0); }}
            style={{ maxWidth: 320, padding: "6px 10px", fontSize: FONT_SIZE.control, borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)" }}
          />
          {kind === "error" && <DeployLine deploy={deploy} />}
          {groups.length === 0 && <PanelState empty emptyText="Nothing in this window." emptyHint={kind === "error" ? "No errors besides deploy reloads." : undefined} />}
          {groups.length > 0 && shown.length === 0 && <PanelState empty emptyText="No message matches that search." />}
          {shown.length > 0 && (
            <AdminTable maxHeight={640} minWidth={760}>
              <thead>
                <tr>
                  <Th sortKey="message" sort={sort} onSort={onSort}>Message</Th><Th>Sources</Th>
                  <Th num sortKey="count" sort={sort} onSort={onSort}>Count</Th><Th num sortKey="accounts" sort={sort} onSort={onSort}>Accounts</Th>
                  <Th sortKey="lastSeen" sort={sort} onSort={onSort}>Last seen</Th><Th>Build</Th><Th />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).flatMap((g) => {
                  const open = openKey === g.key;
                  return [
                    <tr key={g.key}>
                      <Td style={{ maxWidth: 420 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {g.isNew && <Chip tone="danger">New</Chip>}
                          <Clip max={380}>{g.message}</Clip>
                        </div>
                      </Td>
                      <Td><span style={{ color: "var(--text-secondary)" }} title={g.sources.map((s) => `${s.source} ×${s.occurrences}`).join("\n")}>{g.sources.map((s) => `${s.source.replace(/^event:/, "")}${g.sources.length > 1 ? ` ×${s.occurrences}` : ""}`).join(", ")}{g.modules.length ? ` · ${g.modules.join(", ")}` : ""}</span></Td>
                      <Td num style={{ fontWeight: 700 }}>{g.occurrences}</Td>
                      <Td num>{g.accounts}</Td>
                      <Td><RelTime iso={g.lastSeen} /></Td>
                      <Td>{g.lastBuild || "—"}{g.builds > 1 ? ` (+${g.builds - 1})` : ""}</Td>
                      <Td><LinkButton onClick={() => setOpenKey(open ? null : g.key)} aria-expanded={open}>{open ? "Hide rows" : "Recent rows"}</LinkButton></Td>
                    </tr>,
                    open && <tr key={`${g.key}-rows`}><td colSpan={7} style={{ borderTop: "1px solid var(--border-default)", background: "var(--surface-page)" }}><GroupRows group={g} /></td></tr>,
                  ];
                })}
              </tbody>
            </AdminTable>
          )}
          {shown.length > limit && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Button variant="ghost" size="sm" onClick={() => setClicks((c) => c + 1)}>Show more</Button>
              <span style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>Showing {limit} of {shown.length}</span>
            </div>
          )}
        </>
      )}
    </AdminPanel>
  );
}
