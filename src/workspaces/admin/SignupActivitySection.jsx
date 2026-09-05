/* Signup activity admin view (B1160721, NEW-2) — visibility for "is signup being flooded"
 * without needing SQL. Reads through admin_list_signup_attempts(), a SECURITY DEFINER RPC
 * gated on is_admin() (src/shared/auth/db/signup_rate_limit.sql) — never a client SELECT
 * policy on the table itself, same discipline as every other admin-gated read in this
 * workspace. Only 'created' rows are ever logged here (see that file's own comment on
 * signup_attempts_log for why a rate-limited attempt can't survive in this table); a
 * rejected flood still shows up in Supabase's own Auth/Postgres logs, and — for the
 * browser-driven case — in the existing Issues-style client_errors telemetry.
 */
import { useEffect, useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { RADIUS } from "../../shared/ui/radius.js";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";

export default function SignupActivitySection() {
  const [state, setState] = useState({ loading: true, rows: null, error: null });

  useEffect(() => {
    let live = true;
    if (!supabase) { setState({ loading: false, rows: [], error: "Not connected." }); return; }
    supabase.rpc("admin_list_signup_attempts", { p_limit: 200 }).then(({ data, error }) => {
      if (!live) return;
      if (error) { setState({ loading: false, rows: [], error: error.message || String(error) }); return; }
      setState({ loading: false, rows: data || [], error: null });
    });
    return () => { live = false; };
  }, []);

  const rows = state.rows || [];
  const now = Date.now();
  const lastHour = rows.filter((r) => now - new Date(r.at).getTime() < 3600_000).length;
  const lastDay = rows.filter((r) => now - new Date(r.at).getTime() < 86_400_000).length;

  return (
    <section
      style={{
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.lg, padding: 18, display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Signup activity</h2>
      <p style={{ margin: 0, fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>
        Accounts created, most recent first — the server-side cap is {rows.length ? `${lastHour} in the last hour, ${lastDay} in the last day` : "not tripped"}.
      </p>
      {state.loading && <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>Loading…</div>}
      {state.error && <div style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>{state.error}</div>}
      {!state.loading && !state.error && rows.length === 0 && (
        <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>No signups logged yet.</div>
      )}
      {!state.loading && !state.error && rows.length > 0 && (
        <div style={{ overflowX: "auto", maxHeight: 220, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT_SIZE.control }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                <th style={{ padding: "4px 10px 4px 0" }}>When</th>
                <th style={{ padding: "4px 10px" }}>Domain</th>
                <th style={{ padding: "4px 0" }}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border-default)" }}>
                  <td style={{ padding: "6px 10px 6px 0", whiteSpace: "nowrap", color: "var(--text-tertiary)" }}>{new Date(r.at).toLocaleString()}</td>
                  <td style={{ padding: "6px 10px" }}>{r.email_domain || "—"}</td>
                  <td style={{ padding: "6px 0" }}>{r.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
