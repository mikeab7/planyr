/* Dev-only harness (not part of the app build) for the header's NAVIGATION-vs-JURISDICTION
 * contention. Mounts the REAL AppHeader + ProjectBreadcrumb + JurisdictionBadge so a headless
 * probe can measure boxes AND ask `elementFromPoint` what each pixel of the plan chip actually
 * resolves to.
 *
 * IT COVERS TWO REPORTS, and the second is why the plan chip is now the real component's shape:
 *   NEW-2 (earlier)  — the badge text "doubling" / spilling at narrowed widths.
 *   NEW-2 (this one) — "if I am looking at a site on a normal sized laptop screen, I can't change
 *                      between the concepts or the plans because the unincorporated / city of
 *                      Houston / ETJ / Harris County chip is too big and it covers it."
 *
 * ⛔ THE SCOPES ARE THE OWNER'S OWN CASES, NOT SHORT INVENTED ONES — a short jurisdiction string
 * cannot show this defect at any width, which is exactly how it shipped. `bain` is the reported
 * plan; `portfolio` is the LONGEST string his 28 sites produce (Goose Creek's 14-lot Baytown split,
 * which names the city, the share, the remainder's ETJ, the county and the district in one line).
 * Served by `npm run dev`. */
import { createRoot } from "react-dom/client";
import AppHeader from "../src/shared/ui/AppHeader.jsx";
import { ThemeProvider } from "../src/shared/theme/ThemeProvider.jsx";
import JurisdictionBadge from "../src/workspaces/site-planner/components/JurisdictionBadge.jsx";
import { formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";

const src = { ageMs: 120000, sourceName: "TxDOT / TxGIO / H-GAC" };

// The exact reported case: unincorporated parcel → "Unincorporated · Harris County".
const badgeUninc = {
  ...formatJurisdictionBadge({ city: [], cityCentroid: [], etj: [], county: ["Harris"] }),
  ...src,
};
// A worst-case straddle (long) unincorporated-plus-edge string, to stress truncation.
const badgeLong = {
  ...formatJurisdictionBadge({ city: [], cityCentroid: [], etj: ["Tomball", "Houston"], county: ["Harris", "Montgomery"] }),
  ...src,
};
/* THE OWNER'S REPORTED PILL, on Bain / "Concept - Original": unincorporated land reached by the
 * City of Houston ETJ, in Harris County, with the school district appended (B764). */
const badgeBain = {
  ...formatJurisdictionBadge(
    { city: [], cityCentroid: [], etj: ["Houston"], county: ["Harris"], isd: ["Katy ISD"] },
  ),
  ...src,
};
/* THE LONGEST STRING HIS PORTFOLIO PRODUCES — Goose Creek: 6 of 14 tested lots inside Baytown's
 * limits, the other 8 inside Baytown's own ETJ. Every clause of the split model fires at once. */
const badgePortfolio = {
  ...formatJurisdictionBadge({
    city: ["Baytown"], cityAll: [], citySome: ["Baytown"], cityCentroid: [],
    etj: ["Baytown"], county: ["Harris"], isd: ["Goose Creek CISD"],
    cityCoverage: { inCity: 6, tested: 14 },
    sources: [{ id: "city", state: "ok" }, { id: "etj", state: "ok" }, { id: "county", state: "ok" }],
  }),
  ...src,
};

/* The plan crumb, in the SHAPE THE PLANNER ACTUALLY RENDERS (SitePlanner's `plannerPlanCrumb`):
 * a label span that ellipsis-truncates plus a NON-SHRINKING caret. The caret is the specific
 * thing his report is about — "it covers it" — so a harness whose chip has no caret cannot see
 * the defect. */
function PlanCrumb({ label }) {
  return (
    <div style={{ position: "relative", flex: "none", minWidth: 0 }}>
      <button
        data-testid="plan-crumb"
        style={{
          display: "flex", alignItems: "center", gap: 5, height: 24, padding: "0 8px", borderRadius: 6,
          border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit",
          fontSize: 12.5, fontWeight: 500, color: "var(--chrome-text)", maxWidth: 200, whiteSpace: "nowrap",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span data-testid="plan-caret" style={{ color: "var(--chrome-muted)", fontSize: 11, flex: "none" }}>▾</span>
      </button>
    </div>
  );
}

const authBtn = (
  <button data-testid="auth-btn" style={{ height: 26, padding: "0 12px", borderRadius: 7, border: "1px solid var(--chrome-divider)", background: "var(--accent-site)", color: "var(--on-accent)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
    MM
  </button>
);

function HeaderCase({ scope, badge, project, plan }) {
  return (
    <div data-scope={scope} style={{ marginBottom: 10 }}>
      <AppHeader
        module="site-planner"
        homeLabel="Map"
        currentProject={{ id: "p1", name: project }}
        onSelectProject={() => {}}
        onNewProject={() => {}}
        planSlot={<PlanCrumb label={plan} />}
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

/* ── NEW-1 — THE CENTRING CASES (`verify-header-center.mjs`) ────────────────────────────────────
 * The owner's second report on this header: "now the jurisdiction is not centered." The chip was
 * centred inside its slot; the SLOT was the leftover space between the two side groups, so the chip's
 * position was a function of how long the project and plan names are.
 *
 * ⛔ THE MATRIX IS THE POINT: the LONGEST and SHORTEST label shapes crossed with the LONGEST and
 * SHORTEST breadcrumbs. One case cannot show this — the claim under test is that the chip's centre
 * does NOT move between them, which needs at least the four corners to be false. The `crumb` axis is
 * also what proves this was never a regression from the label-text change: the pre-fix offset tracks
 * the BREADCRUMB (a rename moves the chip) and not the label. */
const CRUMB_SHORT = { project: "A", plan: "P" };
const CRUMB_LONG = { project: "Goose Creek Assemblage — North Tract", plan: "Concept - Original (renamed 2026)" };
// The shortest label the formatter can produce, and the longest his portfolio produces.
const badgeShortest = { ...formatJurisdictionBadge({ city: [], cityCentroid: [], etj: [], county: [] }), ...src };

function App() {
  return (
    <ThemeProvider>
      <HeaderCase scope="uninc" badge={badgeUninc} project="0 MUESCHKE RD, TOMBALL" plan="Plan A" />
      <HeaderCase scope="long" badge={badgeLong} project="0 MUESCHKE RD, TOMBALL" plan="Plan A" />
      <HeaderCase scope="bain" badge={badgeBain} project="Bain" plan="Concept - Original" />
      <HeaderCase scope="portfolio" badge={badgePortfolio} project="Goose Creek Assemblage" plan="Concept - Original" />
      <HeaderCase scope="ctr-short-short" badge={badgeShortest} {...CRUMB_SHORT} />
      <HeaderCase scope="ctr-short-long" badge={badgeShortest} {...CRUMB_LONG} />
      <HeaderCase scope="ctr-long-short" badge={badgePortfolio} {...CRUMB_SHORT} />
      <HeaderCase scope="ctr-long-long" badge={badgePortfolio} {...CRUMB_LONG} />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__READY__ = true;
