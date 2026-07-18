/* Dev-only harness (not part of the app build) reproducing the exact screenshot state for
 * the NEW-2 header jurisdiction-badge doubling/overlap report: the "0 MUESCHKE RD, TOMBALL"
 * site (an address-shaped, long project name) with an "Unincorporated · Harris County" badge.
 * Mounts the REAL AppHeader + JurisdictionBadge so a headless probe can screenshot the badge
 * and measure whether the badge text can visually double / overlap the breadcrumb at the
 * widths the owner hits (window narrowed with the Parcels panel docked). Served by `npm run dev`. */
import { createRoot } from "react-dom/client";
import AppHeader from "../src/shared/ui/AppHeader.jsx";
import { ThemeProvider } from "../src/shared/theme/ThemeProvider.jsx";
import JurisdictionBadge from "../src/workspaces/site-planner/components/JurisdictionBadge.jsx";
import { formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";

// The exact reported case: unincorporated parcel → "Unincorporated · Harris County".
const badgeUninc = {
  ...formatJurisdictionBadge({ city: [], cityCentroid: [], etj: [], county: ["Harris"] }),
  ageMs: 120000, sourceName: "TxDOT / TxGIO / H-GAC",
};
// A worst-case straddle (long) unincorporated-plus-edge string, to stress truncation.
const badgeLong = {
  ...formatJurisdictionBadge({ city: [], cityCentroid: [], etj: ["Tomball", "Houston"], county: ["Harris", "Montgomery"] }),
  ageMs: 120000, sourceName: "TxDOT / TxGIO / H-GAC",
};

const planCrumb = (
  <button data-testid="plan-crumb" style={{ display: "flex", alignItems: "center", gap: 5, height: 24, padding: "0 8px", borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", color: "var(--chrome-text)" }}>
    Plan A ▾
  </button>
);
const authBtn = (
  <button data-testid="auth-btn" style={{ height: 26, padding: "0 12px", borderRadius: 7, border: "1px solid var(--chrome-divider)", background: "var(--accent-site)", color: "var(--on-accent)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
    MM
  </button>
);

function HeaderCase({ scope, badge }) {
  return (
    <div data-scope={scope} style={{ marginBottom: 10 }}>
      <AppHeader
        module="site-planner"
        homeLabel="Map"
        currentProject={{ id: "p1", name: "0 MUESCHKE RD, TOMBALL" }}
        onSelectProject={() => {}}
        onNewProject={() => {}}
        planSlot={planCrumb}
        saveState="synced"
        multiEditOk
        centerContent={<JurisdictionBadge badge={badge} />}
        authControl={authBtn}
        accountActive
        toolbarContent={<button style={{ fontSize: 12 }}>File ▾</button>}
      />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <HeaderCase scope="uninc" badge={badgeUninc} />
      <HeaderCase scope="long" badge={badgeLong} />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__READY__ = true;
