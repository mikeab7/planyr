/* Users (NEW-3) — who has signed up and who is using it. One row per account from admin_users_overview()
 * (counts and dates only, never content). Status chips (Active / Quiet / Dormant / Never used) with counts,
 * a search box, sortable columns, a "Hide internal" switch (shared with Overview), and a detail panel per
 * account. The sign-up rate-limit log lives at the bottom (it used to be its own section). */
import { useMemo, useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { Button, ToggleChip } from "../../shared/ui/controls.jsx";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { RADIUS } from "../../shared/ui/radius.js";
import AdminPanel, { Card, Chip, PanelState, useAdminLoad } from "./AdminPanel.jsx";
import { AdminTable, Th, Td, Clip, RelTime, nextSort } from "./AdminTable.jsx";
import { useAdminData } from "./AdminData.jsx";
import { exactTime, fmtDate } from "./lib/adminFormat.js";
import { fetchRecentErrorsForUser, ago } from "./lib/adminPanels.js";
import { goAdminSection } from "./lib/adminRoute.js";
import { groupSupport } from "./lib/adminSupport.js";
import { STATUSES, statusCounts, filterUsers, sortUsers, teamLabel, fetchUserActivity, shapeUserActivity } from "./lib/adminUsers.js";

const TONE = { active: "ok", quiet: "warn", dormant: "neutral", never: "neutral" };
const LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
export const StatusChip = ({ status }) => <Chip tone={TONE[status]} title={STATUSES.find((s) => s.id === status)?.hint}>{LABEL[status]}</Chip>;

function Fact({ k, children }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "4px 0", fontSize: FONT_SIZE.control }}>
      <span style={{ flex: "0 0 108px", color: "var(--text-secondary)", fontWeight: 600 }}>{k}</span>
      <span style={{ minWidth: 0, wordBreak: "break-word", color: "var(--text-primary)" }}>{children}</span>
    </div>
  );
}

function UserDetail({ user, onClose, goReset }) {
  const d = useAdminData();
  const act = useAdminLoad(() => fetchUserActivity(supabase, user.id), [user.id]);
  const errs = useAdminLoad(() => fetchRecentErrorsForUser(supabase, user.id, 8), [user.id]);
  const open = d.support.tickets.open.filter((t) => t.userId === user.id);
  const { items: supportItems, groups: supportGroups } = groupSupport(open);
  const internal = d.isInternal(user.email);
  return (
    <Card
      title={user.name || user.email}
      aside={<Button variant="ghost" size="sm" onClick={onClose} aria-label="Close details">Close</Button>}
      style={{ alignSelf: "start" }}
    >
      <div data-testid="user-detail">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          <StatusChip status={user.status} />
          {internal && <Chip tone="info">Internal</Chip>}
        </div>
        <Fact k="Email">{user.email}</Fact>
        <Fact k="Company / team">{teamLabel(user) || "—"}</Fact>
        <Fact k="Signed up"><span title={exactTime(user.createdAt)}>{fmtDate(user.createdAt)}</span> via {user.provider}</Fact>
        <Fact k="Email confirmed">{user.confirmed ? "Yes" : "No"}</Fact>
        <Fact k="Last sign-in"><RelTime iso={user.lastSignIn} empty="never" /></Fact>
        <Fact k="Last activity"><RelTime iso={user.lastActivity} empty="none yet" /></Fact>
        <Fact k="Owns">{user.projects} projects · {user.plans} plans · {user.files} files · {user.reviews} reviews · {user.schedules} schedules</Fact>

        <h4 style={{ margin: "12px 0 4px", fontSize: FONT_SIZE.control, fontWeight: 700 }}>Recent activity (dates only)</h4>
        <PanelState loading={act.loading} error={act.error} onRetry={act.reload} />
        {!act.loading && !act.error && shapeUserActivity(act.data).map((g) => (
          <div key={g.key} style={{ fontSize: FONT_SIZE.control, padding: "2px 0" }}>
            <strong>{g.label}</strong>{" "}
            {g.dates.length === 0 ? <span style={{ color: "var(--text-secondary)" }}>none</span> : (
              <span style={{ color: "var(--text-secondary)" }}>{g.dates.map((x, i) => <span key={i} title={exactTime(x)}>{i ? ", " : ""}{ago(x)}</span>)}</span>
            )}
          </div>
        ))}

        <h4 style={{ margin: "12px 0 4px", fontSize: FONT_SIZE.control, fontWeight: 700 }}>Open support items</h4>
        {open.length === 0 ? <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>None.</div> : (
          <>
            {supportItems.map((t) => (
              <div key={t.id} style={{ fontSize: FONT_SIZE.control, padding: "2px 0" }}><Chip tone={t.category === "slow" ? "warn" : "danger"}>{t.category === "slow" ? "Slow" : "Problem"}</Chip> {t.description} · <RelTime iso={t.at} /></div>
            ))}
            {supportGroups.map((g) => <div key={g.key} style={{ fontSize: FONT_SIZE.control, padding: "2px 0" }}><Chip tone="warn">Slow</Chip> {g.label}</div>)}
          </>
        )}

        <h4 style={{ margin: "12px 0 4px", fontSize: FONT_SIZE.control, fontWeight: 700 }}>Recent errors</h4>
        <PanelState loading={errs.loading} error={errs.error} onRetry={errs.reload} />
        {!errs.loading && !errs.error && ((errs.data || []).length === 0 ? <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>None.</div> : (errs.data || []).map((r) => (
          <div key={r.id} style={{ fontSize: FONT_SIZE.label, padding: "2px 0", color: "var(--text-secondary)", wordBreak: "break-word" }}><RelTime iso={r.at} /> · {r.module || "—"} · {r.message || "(no message)"}</div>
        )))}

        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <Button size="sm" variant="ghost" onClick={() => goReset(user.id)}>Reset password…</Button>
          {user.email !== d.selfEmail && <Button size="sm" variant="ghost" onClick={() => d.toggleMarked(user.email)}>{d.marked.has(user.email.toLowerCase()) ? "Unmark internal" : "Mark as internal"}</Button>}
        </div>
      </div>
    </Card>
  );
}

function SignupLog() {
  const { loading, data, error, reload } = useAdminLoad(async () => {
    if (!supabase) return { data: null, error: "Not connected." };
    const { data: rows, error: e } = await supabase.rpc("admin_list_signup_attempts", { p_limit: 200 });
    return e ? { data: null, error: e.message || String(e) } : { data: rows || [], error: null };
  }, []);
  const rows = data || [];
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: FONT_SIZE.control, fontWeight: 700, color: "var(--text-primary)" }}>Sign-up log (server-side rate limit)</summary>
      <div style={{ marginTop: 8 }}>
        <PanelState loading={loading} error={error} empty={rows.length === 0} emptyText="No sign-ups logged yet." onRetry={reload} />
        {!loading && !error && rows.length > 0 && (
          <AdminTable maxHeight={240}>
            <thead><tr><Th>When</Th><Th>Domain</Th><Th>Outcome</Th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}><Td><RelTime iso={r.at} /></Td><Td>{r.email_domain || "—"}</Td><Td>{r.outcome}</Td></tr>)}</tbody>
          </AdminTable>
        )}
      </div>
    </details>
  );
}

const COLS = [
  ["name", "Name"], ["email", "Email"], ["org", "Company / team"], ["createdAt", "Signed up"], ["lastSignIn", "Last sign-in"], ["lastActivity", "Last activity"],
  ["projects", "Projects", true], ["plans", "Plans", true], ["files", "Files", true], ["reviews", "Reviews", true], ["schedules", "Schedules", true], ["status", "Status"],
];

export default function UsersSection({ go }) {
  const d = useAdminData();
  const { hideInternal, setHideInternal } = d;
  const [status, setStatus] = useState(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "lastActivity", dir: "desc" });
  const [sel, setSel] = useState(null);
  const base = useMemo(() => filterUsers(d.users.list, { hideInternal, query }), [d.users.list, hideInternal, query]);
  const counts = statusCounts(base);
  const rows = useMemo(() => sortUsers(status ? base.filter((u) => u.status === status) : base, sort.key, sort.dir), [base, status, sort]);
  const selected = sel && d.users.list.find((u) => u.id === sel);
  const hiddenCount = d.users.list.length - filterUsers(d.users.list, { hideInternal: true }).length;
  const goReset = (id) => goAdminSection("password-reset", { user: id });
  return (
    <AdminPanel
      id="users" title="Users"
      blurb={`${rows.length} of ${d.users.list.length} accounts shown. Counts and dates only — never their plans, projects or files.`}
      actions={(
        <>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: FONT_SIZE.control, fontWeight: 600 }} title="Test and internal accounts (e2e, your own)">
            <input type="checkbox" checked={hideInternal} onChange={(e) => setHideInternal(e.target.checked)} data-testid="hide-internal" /> Hide internal{hiddenCount ? ` (${hiddenCount})` : ""}
          </label>
          <Button variant="ghost" size="sm" onClick={d.users.reload}>Refresh</Button>
        </>
      )}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          aria-label="Search name or email" placeholder="Search name or email…" value={query} onChange={(e) => setQuery(e.target.value)}
          style={{ flex: "1 1 220px", maxWidth: 320, padding: "6px 10px", fontSize: FONT_SIZE.control, borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)" }}
        />
        <ToggleChip active={status === null} onClick={() => setStatus(null)}>All {base.length}</ToggleChip>
        {STATUSES.map((s) => <ToggleChip key={s.id} active={status === s.id} title={s.hint} onClick={() => setStatus(status === s.id ? null : s.id)}>{s.label} {counts[s.id]}</ToggleChip>)}
      </div>
      <PanelState loading={d.users.loading} error={d.users.error} empty={rows.length === 0} emptyText="No accounts match." emptyHint={hideInternal ? "Internal accounts are hidden — turn that off to see them." : undefined} onRetry={d.users.reload} />
      {!d.users.loading && !d.users.error && rows.length > 0 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "2 1 520px", minWidth: 0 }}>
          <AdminTable maxHeight={560} minWidth={selected ? 0 : 1000}>
            <thead>
              <tr>{COLS.map(([k, label, num]) => <Th key={k} sortKey={k} sort={sort} num={num} onSort={(key) => setSort((s) => nextSort(s, key))}>{label}</Th>)}</tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} onClick={() => setSel(u.id === sel ? null : u.id)} data-testid="user-row" style={{ cursor: "pointer", background: u.id === sel ? "var(--surface-page)" : undefined }}>
                  <Td style={{ fontWeight: 600 }}><Clip max={170}>{u.name || "—"}</Clip></Td>
                  <Td><Clip max={220}>{u.email}</Clip>{u.internal && <> <Chip tone="info">Internal</Chip></>}</Td>
                  <Td><Clip max={180}>{teamLabel(u) || "—"}</Clip></Td>
                  <Td style={{ whiteSpace: "nowrap" }}><span title={exactTime(u.createdAt)}>{fmtDate(u.createdAt)}</span></Td>
                  <Td><RelTime iso={u.lastSignIn} empty="never" /></Td>
                  <Td><RelTime iso={u.lastActivity} empty="none" /></Td>
                  <Td num>{u.projects}</Td><Td num>{u.plans}</Td><Td num>{u.files}</Td><Td num>{u.reviews}</Td><Td num>{u.schedules}</Td>
                  <Td><StatusChip status={u.status} /></Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
          </div>
          {selected && <div style={{ flex: "1 1 300px", minWidth: 0 }}><UserDetail user={selected} onClose={() => setSel(null)} goReset={goReset} /></div>}
        </div>
      )}
      <SignupLog />
    </AdminPanel>
  );
}
