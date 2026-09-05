/* Admin password reset (B1160722, NEW-3) — reset a teammate's password from inside the
 * app, no email involved. The server-side gate is what actually matters (is_admin() runs
 * INSIDE admin_reset_user_password() and admin_list_users(), so this control being
 * reachable is a convenience, never the security boundary — see
 * src/workspaces/admin/db/admin_reset_password.sql). This never displays an EXISTING
 * password (bcrypt hashes are one-way; there is nothing to read back) — it only ever
 * generates a brand new one, shown ONCE right after generation.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { RADIUS } from "../../shared/ui/radius.js";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";

const userLabel = (u) => {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return name ? `${name} — ${u.email}` : u.email;
};

export default function AdminPasswordResetSection() {
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { email, password } — shown once
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null);

  const loadUsers = () => {
    if (!supabase) { setLoadError("Not connected."); return; }
    supabase.rpc("admin_list_users").then(({ data, error: e }) => {
      if (e) { setLoadError(e.message || String(e)); return; }
      setUsers(data || []);
    });
  };
  const loadHistory = () => {
    if (!supabase) return;
    supabase.rpc("admin_list_password_resets", { p_limit: 50 }).then(({ data }) => setHistory(data || []));
  };

  useEffect(() => { loadUsers(); loadHistory(); }, []);

  const filtered = useMemo(() => {
    const list = users || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) => userLabel(u).toLowerCase().includes(q));
  }, [users, query]);

  const reset = async () => {
    if (!selected) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const { data, error: e } = await supabase.rpc("admin_reset_user_password", { p_target_user_id: selected });
      if (e) { setError(e.message || String(e)); return; }
      const u = (users || []).find((x) => x.id === selected);
      setResult({ email: (u && u.email) || selected, password: data });
      loadHistory();
    } finally { setBusy(false); }
  };

  return (
    <section
      style={{
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.lg, padding: 18, display: "flex", flexDirection: "column", gap: 8,
        gridColumn: "1 / -1",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Reset a user's password</h2>
      <p style={{ margin: 0, fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>
        Generates a brand-new password and shows it to you once — no email involved. Existing passwords
        are hashed and can never be displayed; this doesn't read one, it creates one.
      </p>

      {loadError && <div style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>{loadError}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          aria-label="Search users"
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: "1 1 220px", padding: "7px 10px", fontSize: 13, borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)" }}
        />
        <select
          aria-label="Select a user"
          value={selected}
          onChange={(e) => { setSelected(e.target.value); setResult(null); setError(null); }}
          style={{ flex: "1 1 260px", padding: "7px 10px", fontSize: 13, borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)" }}
        >
          <option value="">{users == null ? "Loading users…" : "Choose a user…"}</option>
          {filtered.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
        </select>
        <button
          type="button"
          disabled={!selected || busy}
          onClick={reset}
          style={{
            border: "1px solid var(--accent)", borderRadius: RADIUS.md, background: "var(--accent)",
            color: "var(--on-accent)", font: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 700,
            padding: "7px 14px", cursor: !selected || busy ? "default" : "pointer", opacity: !selected || busy ? 0.6 : 1,
          }}
        >
          {busy ? "Resetting…" : "Reset password"}
        </button>
      </div>

      {error && <div style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 4, padding: 12, border: "1px solid var(--warn-text)", borderRadius: RADIUS.md, background: "var(--surface-page)" }}>
          <div style={{ fontSize: FONT_SIZE.control, color: "var(--warn-text)", fontWeight: 700, marginBottom: 4 }}>
            Shown once — copy it now. It cannot be shown again.
          </div>
          <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>{result.email}</div>
          <div style={{ fontFamily: "monospace", fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)", userSelect: "all", marginTop: 4 }}>
            {result.password}
          </div>
        </div>
      )}

      {history && history.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>
            Reset history ({history.length})
          </summary>
          <div style={{ overflowX: "auto", marginTop: 6 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT_SIZE.control }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  <th style={{ padding: "4px 10px 4px 0" }}>When</th>
                  <th style={{ padding: "4px 10px" }}>Reset by</th>
                  <th style={{ padding: "4px 0" }}>Target</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border-default)" }}>
                    <td style={{ padding: "6px 10px 6px 0", whiteSpace: "nowrap", color: "var(--text-tertiary)" }}>{new Date(r.at).toLocaleString()}</td>
                    <td style={{ padding: "6px 10px" }}>{r.admin_email || "—"}</td>
                    <td style={{ padding: "6px 0" }}>{r.target_email || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
