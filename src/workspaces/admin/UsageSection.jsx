/* Usage (B711905) — "is anyone using this, and how often", from data the database already holds
 * (accounts, last sign-in, row counts, created/updated dates). COUNTS AND DATES ONLY — never plan,
 * project or file content (CLAUDE.md KEY DECISION: not a cross-customer content view). Read through
 * admin_usage_overview() (SECURITY DEFINER, is_admin()-gated). No new tracking. */
import { supabase } from "../site-planner/lib/supabase.js";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { RADIUS } from "../../shared/ui/radius.js";
import AdminPanel, { PanelState, useAdminLoad, th, td } from "./AdminPanel.jsx";
import { fetchUsage, shapeUsage, USAGE_CANNOT_ANSWER, ago } from "./lib/adminPanels.js";

function Stat({ label, value }) {
  return (
    <div style={{ background: "var(--surface-page)", border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "8px 12px", minWidth: 96 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>{value}</div>
      <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function Bar({ value, peak, color }) {
  return <span style={{ display: "inline-block", height: 8, width: `${Math.round((value / peak) * 100)}%`, minWidth: value ? 2 : 0, background: color, borderRadius: 2 }} />;
}

export default function UsageSection() {
  const { loading, data, error, reload } = useAdminLoad(() => fetchUsage(supabase), []);
  const u = shapeUsage(data);
  const t = u && u.totals;
  return (
    <AdminPanel id="usage" title="Usage" blurb="Accounts, sign-ins and how much has been created — counts and dates only.">
      <PanelState loading={loading} error={error} empty={!u} emptyText="No usage data." onRetry={reload} />
      {u && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Stat label="Accounts" value={t.accounts} />
            <Stat label="Signed in, 7 days" value={t.active7} />
            <Stat label="Signed in, 30 days" value={t.active30} />
            <Stat label="Projects" value={t.projects} />
            <Stat label="Plans" value={t.plans} />
            <Stat label="Reviews" value={t.reviews} />
            <Stat label="Files" value={t.files} />
            <Stat label="Schedules" value={t.schedules} />
            <Stat label="Teams" value={t.teams} />
            <Stat label="Team members" value={t.members} />
            <Stat label="Pending invites" value={t.pendingInvites} />
          </div>
          <h3 style={{ margin: "6px 0 0", fontSize: FONT_SIZE.emphasis }}>Last 12 weeks</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT_SIZE.control }}>
              <thead><tr><th style={th}>Week of</th><th style={th}>Sign-ups</th><th style={th}>Plans created</th><th style={th}>Plans edited</th><th style={{ ...th, width: "40%" }} /></tr></thead>
              <tbody>
                {u.weekly.map((w) => (
                  <tr key={w.week} style={{ borderTop: "1px solid var(--border-default)" }}>
                    <td style={td}>{w.week}</td><td style={td}>{w.signups}</td><td style={td}>{w.plansCreated}</td><td style={td}>{w.plansEdited}</td>
                    <td style={td}>
                      <div><Bar value={w.plansEdited} peak={u.peak} color="var(--accent)" /></div>
                      <div><Bar value={w.signups} peak={u.peak} color="var(--text-secondary)" /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={{ margin: "6px 0 0", fontSize: FONT_SIZE.emphasis }}>Accounts</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT_SIZE.control }}>
              <thead><tr><th style={th}>Account</th><th style={th}>Joined</th><th style={th}>Last sign-in</th><th style={th}>Last plan edit</th><th style={th}>Projects</th><th style={th}>Plans</th><th style={th}>Files</th></tr></thead>
              <tbody>
                {u.accounts.map((a) => (
                  <tr key={a.id} style={{ borderTop: "1px solid var(--border-default)" }}>
                    <td style={{ ...td, wordBreak: "break-all" }}>{a.email}</td>
                    <td style={td}>{a.createdAt ? a.createdAt.slice(0, 10) : "—"}</td>
                    <td style={td} title={a.lastSignIn || ""}>{ago(a.lastSignIn)}</td>
                    <td style={td} title={a.lastPlanEdit || ""}>{a.lastPlanEdit ? ago(a.lastPlanEdit) : "—"}</td>
                    <td style={td}>{a.projects}</td><td style={td}>{a.plans}</td><td style={td}>{a.files}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: 0, fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>{USAGE_CANNOT_ANSWER}</p>
        </>
      )}
    </AdminPanel>
  );
}
