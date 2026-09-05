/* Problem reports admin view (B842866) — the owner-only read half of the global "help / report
 * a problem" control (src/app/HelpReportControl.jsx). Reads through
 * admin_list_problem_reports(), a SECURITY DEFINER RPC gated on is_admin()
 * (src/shared/reports/problem_reports.sql) — never a client SELECT policy on the table
 * itself, same discipline as admin_users.sql / criteria_requests.sql. RLS proof (live,
 * self-rolling-back): src/shared/reports/test/problem_reports_rls.test.sql.
 */
import { useEffect, useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { RADIUS } from "../../shared/ui/radius.js";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";

const CATEGORY_LABEL = { problem: "Problem", slow: "Slow" };

function contextLine(ctx) {
  if (!ctx || typeof ctx !== "object") return "—";
  const parts = [];
  if (ctx.route) parts.push(ctx.route);
  if (ctx.build) parts.push(`build ${ctx.build}`);
  if (Number.isFinite(ctx.viewportW) && Number.isFinite(ctx.viewportH)) parts.push(`${ctx.viewportW}×${ctx.viewportH}`);
  if (ctx.plan) parts.push(`plan ${ctx.plan}`);
  if (ctx.captureTaken != null) parts.push(ctx.captureTaken ? "capture taken" : "no capture");
  if (ctx.captureDelivered != null) parts.push(ctx.captureDelivered ? "delivered" : "undelivered");
  return parts.length ? parts.join(" · ") : "—";
}

export default function ReportsSection() {
  const [state, setState] = useState({ loading: true, rows: null, error: null });
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let live = true;
    if (!supabase) { setState({ loading: false, rows: [], error: "Not connected." }); return; }
    supabase.rpc("admin_list_problem_reports").then(({ data, error }) => {
      if (!live) return;
      if (error) { setState({ loading: false, rows: [], error: error.message || String(error) }); return; }
      setState({ loading: false, rows: data || [], error: null });
    });
    return () => { live = false; };
  }, []);

  const slowCount = (state.rows || []).filter((r) => r.category === "slow").length;

  return (
    <section
      style={{
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.lg, padding: 18, display: "flex", flexDirection: "column", gap: 8,
        gridColumn: "1 / -1",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Problem reports</h2>
      <p style={{ margin: 0, fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>
        Filed from the "Report a problem" / "Something was slow" control on every screen, signed in or not.
        {state.rows && state.rows.length > 0 && ` ${state.rows.length} total, ${slowCount} marked slow.`}
      </p>
      {state.loading && <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>Loading…</div>}
      {state.error && <div style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>{state.error}</div>}
      {!state.loading && !state.error && (state.rows || []).length === 0 && (
        <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>No reports filed yet.</div>
      )}
      {!state.loading && !state.error && (state.rows || []).length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT_SIZE.control }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                <th style={{ padding: "4px 10px 4px 0" }}>When</th>
                <th style={{ padding: "4px 10px" }}>Kind</th>
                <th style={{ padding: "4px 10px" }}>From</th>
                <th style={{ padding: "4px 10px" }}>Description</th>
                <th style={{ padding: "4px 0" }}>Context</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r) => {
                const open = openId === r.id;
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border-default)", verticalAlign: "top" }}>
                    <td style={{ padding: "6px 10px 6px 0", whiteSpace: "nowrap", color: "var(--text-tertiary)" }}>{new Date(r.at).toLocaleString()}</td>
                    <td style={{ padding: "6px 10px", fontWeight: 700, color: r.category === "slow" ? "var(--warn-text)" : "var(--text-primary)" }}>{CATEGORY_LABEL[r.category] || r.category}</td>
                    <td style={{ padding: "6px 10px" }}>{r.user_email || (r.user_id ? "signed in" : "signed out")}</td>
                    <td style={{ padding: "6px 10px", maxWidth: 360, whiteSpace: "pre-wrap" }}>{r.description || "—"}</td>
                    <td style={{ padding: "6px 0" }}>
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : r.id)}
                        style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.control, padding: 0, textAlign: "left" }}
                      >
                        {open ? "Hide" : contextLine(r.context)}
                      </button>
                      {open && (
                        <pre style={{ margin: "6px 0 0", padding: 8, background: "var(--surface-page)", border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, fontSize: FONT_SIZE.label, overflowX: "auto", maxWidth: 420 }}>
                          {JSON.stringify(r.context || {}, null, 2)}
                        </pre>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
