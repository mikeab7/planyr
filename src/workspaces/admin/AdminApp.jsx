/* AdminApp (B711904 / NEW-1) — Michael's own internal operator page.
 *
 * NOT a workspace: no header tab, not in the module switcher, mounts only when AdminGate has confirmed the
 * signed-in user is on the admin allowlist. Layout (NEW-1): a left section nav (a select at phone width)
 * showing ONE section at a time, with count badges on the ones that have something waiting. The selected
 * section lives in the hash — `#/admin/<section>`, bare `#/admin` = Overview — so reload and back/forward
 * keep it (lib/adminRoute.js). Sections read through is_admin()-gated RPCs; the datasets shared by Overview,
 * the badges and the sections load once in AdminData. See CLAUDE.md "No cross-customer admin view": this is
 * Michael's view of the product he runs — never a view of customers' plans, projects or files.
 */
import { useCallback, useEffect, useState } from "react";
import { RADIUS } from "../../shared/ui/radius.js";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { Button } from "../../shared/ui/controls.jsx";
import { AdminDataProvider, useAdminData } from "./AdminData.jsx";
import OverviewSection from "./OverviewSection.jsx";
import UsersSection from "./UsersSection.jsx";
import IssuesSection from "./IssuesSection.jsx";
import SupportSection from "./SupportSection.jsx";
import UsageSection from "./UsageSection.jsx";
import CriteriaRequestsSection from "./CriteriaRequestsSection.jsx";
import ParcelCoverageSection from "./ParcelCoverageSection.jsx";
import AdminPasswordResetSection from "./AdminPasswordResetSection.jsx";
import OpsSection from "./OpsSection.jsx";
import { SECTIONS } from "./lib/adminSections.js";
import { parseAdminHash, goAdminSection } from "./lib/adminRoute.js";

/** The current section id, following the hash (back/forward, reload, typed). */
export function useAdminSection() {
  const read = () => parseAdminHash(typeof window !== "undefined" ? window.location.hash : "").section;
  const [section, setSection] = useState(read);
  useEffect(() => {
    const on = () => setSection(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((id) => goAdminSection(id), []);
  return [section, go];
}

/** Counts of things waiting, per section id (0 / undefined = no badge). */
function useBadges() {
  const d = useAdminData();
  return {
    support: d.support.tickets.open.length,
    issues: d.errors7.issues.groups.filter((g) => g.isNew).length,
    criteria: d.criteria.outstanding,
  };
}

function Nav({ section, go }) {
  const badges = useBadges();
  return (
    <>
      {/* phone width: one select (CSS-free media switch via the two blocks below) */}
      <nav aria-label="Admin sections" className="admin-nav-wide" style={{ display: "flex", flexDirection: "column", gap: 2, padding: 10, borderRight: "1px solid var(--chrome-divider)", background: "var(--surface-raised)", minWidth: 190, overflow: "auto" }}>
        {SECTIONS.map((s) => {
          const on = s.id === section; const n = badges[s.id];
          return (
            <button
              key={s.id} type="button" onClick={() => go(s.id)} aria-current={on ? "page" : undefined} data-testid={`admin-nav-${s.id}`}
              style={{ all: "unset", cursor: "pointer", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: RADIUS.md, fontSize: FONT_SIZE.emphasis, fontWeight: on ? 700 : 500, background: on ? "var(--accent)" : "transparent", color: on ? "var(--on-accent)" : "var(--text-primary)" }}
            >
              <span style={{ flex: 1 }}>{s.title}</span>
              {n > 0 && <span data-testid={`admin-badge-${s.id}`} style={{ minWidth: 18, textAlign: "center", padding: "0 6px", borderRadius: RADIUS.pill, fontSize: FONT_SIZE.label, fontWeight: 700, background: on ? "var(--on-accent)" : "var(--danger-bg)", color: on ? "var(--accent)" : "var(--danger-text)", border: on ? "none" : "1px solid var(--danger-border)" }}>{n}</span>}
            </button>
          );
        })}
      </nav>
      <div className="admin-nav-narrow" style={{ padding: "8px 14px", borderBottom: "1px solid var(--chrome-divider)", background: "var(--surface-raised)" }}>
        <select aria-label="Admin section" value={section} onChange={(e) => go(e.target.value)} data-testid="admin-nav-select" style={{ width: "100%", padding: "8px 10px", fontSize: FONT_SIZE.emphasis, fontWeight: 600, borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)" }}>
          {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.title}{badges[s.id] > 0 ? ` (${badges[s.id]})` : ""}</option>)}
        </select>
      </div>
    </>
  );
}

function Body({ section, go }) {
  switch (section) {
    case "users": return <UsersSection go={go} />;
    case "issues": return <IssuesSection />;
    case "support": return <SupportSection />;
    case "usage": return <UsageSection />;
    case "criteria": return <CriteriaRequestsSection />;
    case "parcel-coverage": return <ParcelCoverageSection />;
    case "password-reset": return <AdminPasswordResetSection />;
    case "ops": return <OpsSection />;
    default: return <OverviewSection go={go} />;
  }
}

export default function AdminApp({ onExit, user }) {
  const [section, go] = useAdminSection();
  return (
    <AdminDataProvider selfEmail={user?.email || null}>
      <div data-testid="admin-app" style={{ height: "100%", overflow: "hidden", background: "var(--surface-page)", display: "flex", flexDirection: "column", pointerEvents: "auto" }}>
        <style>{`
          .admin-shell{display:flex;flex:1;min-height:0}
          .admin-nav-narrow{display:none}
          @media (max-width: 760px){ .admin-shell{flex-direction:column} .admin-nav-wide{display:none !important} .admin-nav-narrow{display:block} }
        `}</style>
        <header style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", background: "var(--chrome-bg)", borderBottom: "1px solid var(--chrome-divider)" }}>
          <h1 style={{ margin: 0, fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--chrome-text)" }}>Admin</h1>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={onExit}>Back to Planyr</Button>
        </header>
        <div className="admin-shell">
          <Nav section={section} go={go} />
          <main data-testid="admin-main" style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18 }}>
            <div style={{ maxWidth: 1280, margin: "0 auto" }}><Body section={section} go={go} /></div>
          </main>
        </div>
      </div>
    </AdminDataProvider>
  );
}
