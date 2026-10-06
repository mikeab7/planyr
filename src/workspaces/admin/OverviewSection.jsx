/* Overview (NEW-1) — the landing view: "is anything wrong, and is anyone using it" without scrolling.
 * Headline tiles (each a button into its section), newest sign-ups, top errors. Account counts follow the
 * shared "Hide internal" toggle and say so. All data comes from AdminData (one load, shared). */
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { RADIUS } from "../../shared/ui/radius.js";
import AdminPanel, { Card, Chip, PanelState } from "./AdminPanel.jsx";
import { AdminTable, Th, Td, Clip, RelTime, LinkButton } from "./AdminTable.jsx";
import { useAdminData } from "./AdminData.jsx";
import { filterUsers, overviewStats, newestSignups, statusCounts } from "./lib/adminUsers.js";

function Tile({ label, value, hint, tone, onClick, testid }) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testid}
      style={{
        all: "unset", cursor: "pointer", boxSizing: "border-box", background: "var(--surface-raised)", borderRadius: RADIUS.lg,
        border: `1px solid ${tone === "danger" ? "var(--danger-border)" : tone === "warn" ? "var(--warn-border)" : "var(--border-default)"}`,
        padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0,
      }}
    >
      <span style={{ fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontSize: 26, /* design-exempt: headline numeral */ fontWeight: 700, lineHeight: 1.15, color: tone === "danger" ? "var(--danger-text)" : tone === "warn" ? "var(--warn-text)" : "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>{hint}</span>
    </button>
  );
}

export default function OverviewSection({ go }) {
  const d = useAdminData();
  const { hideInternal, setHideInternal } = d;
  const all = d.users.list;
  const scoped = filterUsers(all, { hideInternal });
  const stats = overviewStats(scoped);
  const counts = statusCounts(scoped);
  const hidden = all.length - scoped.length;
  const scope = hideInternal ? `excluding ${hidden} internal` : "including internal";
  const openSupport = d.support.tickets.open.length;
  const groups = d.errors7.issues.groups;
  const now = Date.now();
  const errors24 = groups.filter((g) => g.lastSeen && now - new Date(g.lastSeen).getTime() < 86_400_000);
  const top = groups.slice(0, 5);
  const loading = d.users.loading || d.support.loading || d.errors7.loading;
  const error = d.users.error || d.support.error || d.errors7.error;
  return (
    <AdminPanel
      id="overview" title="Overview" blurb="Is anything wrong, and is anyone using it."
      actions={(
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: FONT_SIZE.control, fontWeight: 600, color: "var(--text-primary)" }} title="Test and internal accounts (e2e, your own) — the account counts follow this switch">
          <input type="checkbox" checked={hideInternal} onChange={(e) => setHideInternal(e.target.checked)} /> Hide internal accounts
        </label>
      )}
    >
      {loading && <PanelState loading />}
      {!loading && error && <PanelState error={error} onRetry={() => { d.users.reload(); d.support.reload(); d.errors7.reload(); }} />}
      {!loading && (
        <>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Tile testid="tile-accounts" label="Accounts" value={stats.accounts} hint={scope} onClick={() => go("users")} />
            <Tile testid="tile-active7" label="Active, 7 days" value={stats.active7} hint="signed in or edited" onClick={() => go("users")} />
            <Tile testid="tile-active30" label="Active, 30 days" value={stats.active30} hint="signed in or edited" onClick={() => go("users")} />
            <Tile testid="tile-signups" label="New sign-ups, 7 days" value={stats.newSignups7} hint={scope} onClick={() => go("users")} />
            <Tile testid="tile-support" label="Open support" value={openSupport} hint={openSupport ? "waiting on you" : "nothing waiting"} tone={openSupport ? "warn" : undefined} onClick={() => go("support")} />
            <Tile testid="tile-errors" label="Error groups, 24 h" value={errors24.length} hint={`excl. ${d.errors7.issues.deploy.occurrences} deploy reloads (7 d)`} tone={errors24.length ? "danger" : undefined} onClick={() => go("issues")} />
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
            <Card title="Newest sign-ups" aside={<LinkButton onClick={() => go("users")}>All users →</LinkButton>}>
              {scoped.length === 0 ? <PanelState empty emptyText="No accounts yet." /> : (
                <AdminTable maxHeight={260}>
                  <thead><tr><Th>Account</Th><Th>Signed up</Th><Th>Status</Th></tr></thead>
                  <tbody>
                    {newestSignups(scoped, 5).map((u) => (
                      <tr key={u.id}>
                        <Td><Clip max={240}>{u.name ? `${u.name} · ${u.email}` : u.email}</Clip></Td>
                        <Td><RelTime iso={u.createdAt} /></Td>
                        <Td><Chip tone={u.status === "active" ? "ok" : u.status === "never" ? "neutral" : "warn"}>{u.status === "never" ? "Never used" : u.status[0].toUpperCase() + u.status.slice(1)}</Chip></Td>
                      </tr>
                    ))}
                  </tbody>
                </AdminTable>
              )}
              <div style={{ marginTop: 8, fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>
                {counts.active} active · {counts.quiet} quiet · {counts.dormant} dormant · {counts.never} never used
              </div>
            </Card>
            <Card title="Top errors, 7 days" aside={<LinkButton onClick={() => go("issues")}>All issues →</LinkButton>}>
              {top.length === 0 ? <PanelState empty emptyText="No errors in 7 days." emptyHint="Deploy reloads are not counted." /> : (
                <AdminTable maxHeight={260}>
                  <thead><tr><Th>Message</Th><Th num>Count</Th><Th>Last seen</Th></tr></thead>
                  <tbody>
                    {top.map((g) => (
                      <tr key={g.key}>
                        <Td><Clip max={300}>{g.message}</Clip></Td>
                        <Td num style={{ fontWeight: 700 }}>{g.occurrences}</Td>
                        <Td><RelTime iso={g.lastSeen} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </AdminTable>
              )}
            </Card>
          </div>
        </>
      )}
    </AdminPanel>
  );
}
