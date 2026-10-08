/* County requests (B877442) — the admin-facing half of B877440/B877441's "no data available, request it"
 * flow. Reads through admin_list_criteria_requests(), a SECURITY DEFINER RPC gated on is_admin()
 * (db/criteria_requests.sql — never a client SELECT policy). Most-requested first; a wired county sorts to
 * the bottom (lib/criteriaRequestsAdmin.js decides "wired"). Data comes from AdminData (shared with the nav badge). */
import { Button } from "../../shared/ui/controls.jsx";
import AdminPanel, { Chip, PanelState } from "./AdminPanel.jsx";
import { AdminTable, Th, Td, RelTime } from "./AdminTable.jsx";
import { useAdminData } from "./AdminData.jsx";

const FAMILY_LABEL = { detention: "Detention", easement: "Easement", pond: "Pond", floodplain: "Floodplain" };

export default function CriteriaRequestsSection() {
  const { criteria } = useAdminData();
  const rows = criteria.rows;
  return (
    <AdminPanel
      id="criteria" title="County requests"
      blurb={rows.length ? `${criteria.outstanding} outstanding of ${rows.length}. Filed from a plan's “Request criteria” action when a county has none on file.` : "Counties with no detention / easement / pond / floodplain criteria on file, requested from a plan."}
      actions={<Button variant="ghost" size="sm" onClick={criteria.reload}>Refresh</Button>}
    >
      <PanelState loading={criteria.loading} error={criteria.error} empty={rows.length === 0} emptyText="No requests filed yet." emptyHint="When someone asks for a county's criteria from a plan, it lands here." onRetry={criteria.reload} />
      {!criteria.loading && !criteria.error && rows.length > 0 && (
        <AdminTable maxHeight={640} minWidth={640}>
          <thead><tr><Th>County</Th><Th>State</Th><Th>Criteria</Th><Th num>Requests</Th><Th>First asked</Th><Th>Last asked</Th><Th>Status</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.county_key}:${r.family}`}>
                <Td style={{ fontWeight: 600, color: r.wired ? "var(--text-secondary)" : undefined }}>{r.county_label || r.county_key}</Td>
                <Td>{r.state || "—"}</Td>
                <Td>{FAMILY_LABEL[r.family] || r.family}</Td>
                <Td num>{r.request_count}</Td>
                <Td><RelTime iso={r.first_asked} /></Td>
                <Td><RelTime iso={r.last_asked} /></Td>
                <Td><Chip tone={r.wired ? "ok" : "warn"}>{r.wired ? "Wired" : "Outstanding"}</Chip></Td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      )}
    </AdminPanel>
  );
}
