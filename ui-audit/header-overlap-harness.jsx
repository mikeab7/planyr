/* Dev-only harness (not part of the app build) reproducing the Row-1 header overlap the
 * owner reported: at medium widths the centered jurisdiction badge (flexShrink:0) refuses
 * to yield, so the left breadcrumb (logo + project + plan, all flex:none) spills over it —
 * the "text overlaps and looks like shit" bug. Mounts the REAL AppHeader with a realistic
 * breadcrumb + a wide jurisdiction badge so header-overlap-verify.mjs can measure whether
 * the left/center/right zones' rendered boxes overlap at several viewport widths.
 * Served by `npm run dev`. */
import { createRoot } from "react-dom/client";
import AppHeader from "../src/shared/ui/AppHeader.jsx";
import { ThemeProvider } from "../src/shared/theme/ThemeProvider.jsx";
import JurisdictionBadge from "../src/workspaces/site-planner/components/JurisdictionBadge.jsx";
import { formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";

// The exact shape from the owner's screenshot: City · County · ISD (the long, overlap-prone case).
const badgeLong = {
  ...formatJurisdictionBadge({ city: ["Pearland"], cityCentroid: ["Pearland"], etj: [], county: ["Harris"], isd: ["Houston ISD"] }),
  ageMs: 120000, sourceName: "TxDOT / TxGIO / H-GAC",
};
// What the badge becomes AFTER the ISD is dropped (city · county only).
const badgeShort = {
  ...formatJurisdictionBadge({ city: ["Pearland"], cityCentroid: ["Pearland"], etj: [], county: ["Harris"] }),
  ageMs: 120000, sourceName: "TxDOT / TxGIO / H-GAC",
};

const planCrumb = (
  <button data-testid="plan-crumb" style={{ display: "flex", alignItems: "center", gap: 5, height: 24, padding: "0 8px", borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", color: "var(--chrome-text)" }}>
    Plan A ▾
  </button>
);
const authBtn = (
  <button data-testid="auth-btn" style={{ height: 26, padding: "0 12px", borderRadius: 7, border: "1px solid var(--chrome-divider)", background: "var(--accent-site)", color: "var(--on-accent)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
    Sign in
  </button>
);

function HeaderCase({ scope, badge }) {
  return (
    <div data-scope={scope} style={{ marginBottom: 10 }}>
      <AppHeader
        module="site-planner"
        homeLabel="Map"
        currentProject={{ id: "p1", name: "Pearland Logistics Park — Phase II" }}
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
      {/* long = the reported case (City · County · ISD); short = after dropping the ISD */}
      <HeaderCase scope="long" badge={badgeLong} />
      <HeaderCase scope="short" badge={badgeShort} />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__READY__ = true;
