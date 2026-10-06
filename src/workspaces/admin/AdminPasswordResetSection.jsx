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
import { Button } from "../../shared/ui/controls.jsx";
import AdminPanel from "./AdminPanel.jsx";
import { AdminTable, Th, Td, RelTime } from "./AdminTable.jsx";
import { parseAdminHash } from "./lib/adminRoute.js";

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

  // The Users detail panel links here as `#/admin/password-reset?user=<id>` — preselect that account.
  const prefillId = parseAdminHash(typeof window !== "undefined" ? window.location.hash : "").params.user || "";
  useEffect(() => {
    if (!prefillId || !users) return;
    const u = users.find((x) => x.id === prefillId);
    if (u) { setSelected(u.id); setQuery(u.email); setResult(null); setError(null); }
  }, [prefillId, users]);

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

  const field = { padding: "7px 10px", fontSize: FONT_SIZE.control, borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)" };
  return (
    <AdminPanel
      id="password-reset" title="Password reset"
      blurb="Generates a brand-new password and shows it to you once — no email involved. Existing passwords are hashed and can never be displayed."
    >
      {loadError && <div role="alert" style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>Could not load users: {loadError}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input aria-label="Search users" placeholder="Search by name or email…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...field, flex: "1 1 220px" }} />
        <select aria-label="Select a user" value={selected} onChange={(e) => { setSelected(e.target.value); setResult(null); setError(null); }} style={{ ...field, flex: "1 1 260px" }}>
          <option value="">{users == null ? "Loading users…" : "Choose a user…"}</option>
          {filtered.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
        </select>
        <Button disabled={!selected || busy} onClick={reset}>{busy ? "Resetting…" : "Reset password"}</Button>
      </div>

      {error && <div role="alert" style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>{error}</div>}

      {result && (
        <div style={{ padding: 12, border: "1px solid var(--warn-border)", borderRadius: RADIUS.md, background: "var(--warn-bg)" }}>
          <div style={{ fontSize: FONT_SIZE.control, color: "var(--warn-text)", fontWeight: 700, marginBottom: 4 }}>Shown once — copy it now. It cannot be shown again.</div>
          <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>{result.email}</div>
          <div style={{ fontFamily: "monospace", fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)", userSelect: "all", marginTop: 4 }}>{result.password}</div>
        </div>
      )}

      {history && history.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: FONT_SIZE.control, fontWeight: 700 }}>Reset history ({history.length})</summary>
          <div style={{ marginTop: 8 }}>
            <AdminTable maxHeight={260}>
              <thead><tr><Th>When</Th><Th>Reset by</Th><Th>Target</Th></tr></thead>
              <tbody>{history.map((r, i) => <tr key={i}><Td><RelTime iso={r.at} /></Td><Td>{r.admin_email || "—"}</Td><Td>{r.target_email || "—"}</Td></tr>)}</tbody>
            </AdminTable>
          </div>
        </details>
      )}
    </AdminPanel>
  );
}
