/* AdminApp (B711904 / NEW-1) — Michael's own internal operator page.
 *
 * NOT a workspace: it carries no header tab, isn't in the module switcher, and mounts only
 * when Shell.jsx has already confirmed (via AdminGate) that the signed-in user is on the
 * admin allowlist. Sections (lib/adminSections.js order): Issues, Problem reports, Support,
 * Usage, Signup activity, County criteria requests, Password reset, Ops — each reads through its own
 * is_admin()-gated RPC. See CLAUDE.md's "No admin /
 * cross-user data access" decision: this is Michael's own view of the product he runs,
 * gated to his own account, never a support-agent view over customer data.
 */
import { RADIUS } from "../../shared/ui/radius.js";
import IssuesSection from "./IssuesSection.jsx";
import SupportSection from "./SupportSection.jsx";
import UsageSection from "./UsageSection.jsx";
import OpsSection from "./OpsSection.jsx";
import CriteriaRequestsSection from "./CriteriaRequestsSection.jsx";
import ReportsSection from "./ReportsSection.jsx";
import SignupActivitySection from "./SignupActivitySection.jsx";
import AdminPasswordResetSection from "./AdminPasswordResetSection.jsx";

export default function AdminApp({ onExit }) {
  return (
    <div
      data-testid="admin-app"
      style={{
        height: "100%", overflow: "auto", background: "var(--surface-page)",
        display: "flex", flexDirection: "column", pointerEvents: "auto",
      }}
    >
      <header
        style={{
          flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "10px 18px",
          background: "var(--chrome-bg)", borderBottom: "1px solid var(--chrome-divider)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--chrome-text)" }}>Admin</h1>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onExit}
          style={{
            border: "1px solid var(--border-strong)", borderRadius: RADIUS.md, background: "transparent",
            color: "var(--chrome-muted)", font: "inherit", fontSize: 12, fontWeight: 600,
            padding: "5px 12px", cursor: "pointer",
          }}
        >
          Back to Planyr
        </button>
      </header>
      <div style={{ flex: 1, minHeight: 0, padding: 18, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", minWidth: 0 }}>
        {/* Order = lib/adminSections.js: the sections he acts on first. */}
        <IssuesSection />
        <ReportsSection />
        <SupportSection />
        <UsageSection />
        <SignupActivitySection />
        <CriteriaRequestsSection />
        <AdminPasswordResetSection />
        <OpsSection />
      </div>
    </div>
  );
}
