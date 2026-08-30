/* County criteria requests (B877442) — the admin-facing half of B877440/B877441's "no data
 * available, request it" flow. Reads through admin_list_criteria_requests(), a SECURITY DEFINER
 * RPC gated on is_admin() (db/criteria_requests.sql — never a client SELECT policy on the table
 * itself, same discipline as admin_users.sql). Lists the counties people have asked for,
 * most-requested first, with the state, when it was first/last asked, and whether criteria have
 * since landed (a wired county sorts to the bottom instead of cluttering the outstanding queue —
 * see lib/criteriaRequestsAdmin.js for how "wired" is decided).
 */
import { useEffect, useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { prepareCriteriaRequestRows } from "./lib/criteriaRequestsAdmin.js";

const FAMILY_LABEL = { detention: "Detention", easement: "Easement", pond: "Pond", floodplain: "Floodplain" };

export default function CriteriaRequestsSection() {
  const [state, setState] = useState({ loading: true, rows: null, error: null });

  useEffect(() => {
    let live = true;
    if (!supabase) { setState({ loading: false, rows: [], error: "Not connected." }); return; }
    supabase.rpc("admin_list_criteria_requests").then(({ data, error }) => {
      if (!live) return;
      if (error) { setState({ loading: false, rows: [], error: error.message || String(error) }); return; }
      setState({ loading: false, rows: prepareCriteriaRequestRows(data), error: null });
    });
    return () => { live = false; };
  }, []);

  const outstanding = (state.rows || []).filter((r) => !r.wired).length;

  return (
    <section
      style={{
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 8,
        gridColumn: "1 / -1", // the one section with a table — take the full row width
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>County criteria requests</h2>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-tertiary)" }}>
        Counties with no detention / easement / pond / floodplain criteria on file, filed from the plan's
        "Request criteria" action. {state.rows && state.rows.length > 0 && `${outstanding} outstanding of ${state.rows.length}.`}
      </p>
      {state.loading && <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>Loading…</div>}
      {state.error && <div style={{ fontSize: 12.5, color: "var(--danger-text)" }}>{state.error}</div>}
      {!state.loading && !state.error && (state.rows || []).length === 0 && (
        <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>No requests filed yet.</div>
      )}
      {!state.loading && !state.error && (state.rows || []).length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                <th style={{ padding: "4px 10px 4px 0" }}>County</th>
                <th style={{ padding: "4px 10px" }}>State</th>
                <th style={{ padding: "4px 10px" }}>Criteria</th>
                <th style={{ padding: "4px 10px" }}>Requests</th>
                <th style={{ padding: "4px 10px" }}>First asked</th>
                <th style={{ padding: "4px 10px" }}>Last asked</th>
                <th style={{ padding: "4px 0" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={`${r.county_key}:${r.family}`} style={{ borderTop: "1px solid var(--border-default)", opacity: r.wired ? 0.55 : 1 }}>
                  <td style={{ padding: "6px 10px 6px 0", fontWeight: 600, color: "var(--text-primary)" }}>{r.county_label || r.county_key}</td>
                  <td style={{ padding: "6px 10px" }}>{r.state || "—"}</td>
                  <td style={{ padding: "6px 10px" }}>{FAMILY_LABEL[r.family] || r.family}</td>
                  <td style={{ padding: "6px 10px", fontVariantNumeric: "tabular-nums" }}>{r.request_count}</td>
                  <td style={{ padding: "6px 10px" }}>{new Date(r.first_asked).toLocaleDateString()}</td>
                  <td style={{ padding: "6px 10px" }}>{new Date(r.last_asked).toLocaleDateString()}</td>
                  <td style={{ padding: "6px 0", fontWeight: 600, color: r.wired ? "var(--success-text)" : "var(--warn-text)" }}>{r.wired ? "Wired ✓" : "Outstanding"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
