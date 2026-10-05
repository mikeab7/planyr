/* Usage (B711905) — totals and the 12-week trend. COUNTS AND DATES ONLY — never plan, project or file
 * content (CLAUDE.md KEY DECISION). Read through admin_usage_overview() (SECURITY DEFINER, is_admin()-gated).
 * The per-account table moved to Users; the trend is a real line chart with labelled axes. */
import { supabase } from "../site-planner/lib/supabase.js";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { Button } from "../../shared/ui/controls.jsx";
import { RADIUS } from "../../shared/ui/radius.js";
import AdminPanel, { Card, PanelState, useAdminLoad } from "./AdminPanel.jsx";
import { fetchUsage, shapeUsage, USAGE_CANNOT_ANSWER } from "./lib/adminPanels.js";
import { niceTicks, shortDay } from "./lib/adminFormat.js";

function Stat({ label, value }) {
  return (
    <div style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.lg, padding: "10px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 22, /* design-exempt: stat numeral */ fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

const SERIES = [
  { key: "plansEdited", label: "Plans edited", color: "var(--accent)" },
  { key: "plansCreated", label: "Plans created", color: "var(--accent-site)" },
  { key: "signups", label: "Sign-ups", color: "var(--accent-schedule)" },
];

/** Line chart with labelled axes: y = count per week, x = week-of date. Solid strokes, direct legend. */
export function TrendChart({ weekly }) {
  const W = 720, H = 240, L = 40, R = 12, T = 12, B = 30;
  const peak = Math.max(1, ...weekly.flatMap((w) => SERIES.map((s) => w[s.key])));
  const { top, ticks } = niceTicks(peak);
  const x = (i) => L + (weekly.length < 2 ? 0 : (i * (W - L - R)) / (weekly.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const every = Math.ceil(weekly.length / 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly sign-ups, plans created and plans edited, last 12 weeks" style={{ width: "100%", height: "auto", display: "block" }}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border-default)" strokeWidth="1" />
          <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize={FONT_SIZE.label} fill="var(--text-secondary)">{v}</text>
        </g>
      ))}
      {weekly.map((w, i) => (i % every === 0 || i === weekly.length - 1) && (
        <text key={w.week} x={x(i)} y={H - 10} textAnchor="middle" fontSize={FONT_SIZE.label} fill="var(--text-secondary)">{shortDay(w.week)}</text>
      ))}
      <text x={4} y={T + 4} fontSize={FONT_SIZE.label} fill="var(--text-secondary)" transform={`rotate(-90 4 ${T + 4})`} textAnchor="end">per week</text>
      {SERIES.map((s) => (
        <g key={s.key}>
          <polyline fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" points={weekly.map((w, i) => `${x(i)},${y(w[s.key])}`).join(" ")} />
          {weekly.map((w, i) => <circle key={w.week} cx={x(i)} cy={y(w[s.key])} r="3" fill={s.color}><title>{`${s.label}, week of ${shortDay(w.week)}: ${w[s.key]}`}</title></circle>)}
        </g>
      ))}
    </svg>
  );
}

export default function UsageSection() {
  const { loading, data, error, reload } = useAdminLoad(() => fetchUsage(supabase), []);
  const u = shapeUsage(data);
  const t = u && u.totals;
  return (
    <AdminPanel
      id="usage" title="Usage"
      blurb={u && u.generatedAt ? `Totals across all accounts, as of ${new Date(u.generatedAt).toLocaleString()}. Counts and dates only.` : "Totals and the 12-week trend — counts and dates only."}
      actions={<Button variant="ghost" size="sm" onClick={reload}>Refresh</Button>}
    >
      <PanelState loading={loading} error={error} empty={!u} emptyText="No usage data." onRetry={reload} />
      {u && (
        <>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
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
          <Card title="Last 12 weeks" aside={(
            <span style={{ display: "inline-flex", gap: 12, fontSize: FONT_SIZE.control }}>
              {SERIES.map((s) => <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span aria-hidden style={{ width: 12, height: 3, background: s.color, display: "inline-block" }} />{s.label}</span>)}
            </span>
          )}>
            <TrendChart weekly={u.weekly} />
            <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginTop: 4 }}>Count per week; the x-axis is the Monday each week starts. Per-account detail is in Users.</div>
          </Card>
          <p style={{ margin: 0, fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>{USAGE_CANNOT_ANSWER}</p>
        </>
      )}
    </AdminPanel>
  );
}
