/* Headless harness for the phone-header work (B1343200-B1343203 — touch targets, scroll
 * affordance, active-tab visibility, breadcrumb compaction). Mounts the REAL AppHeader (with a
 * REAL ProjectBreadcrumb + a plan-crumb stand-in matching the Site Planner's own crumb geometry,
 * a real toolbar row, and every module tab) so `verify-header-touch-targets.mjs` measures actual
 * rendered boxes, never a hand-built mock of the header's own layout.
 *
 * Configurable via the query string so one page serves every adjacent case the item's own table
 * asks for, without rebuilding the harness per case:
 *   ?project=short|long   — the project crumb's name (long = the owner's real longest, Goose Creek)
 *   ?plan=none|short|long — the trailing plan crumb; `none` reproduces a 2-crumb workspace (no
 *                           middle crumb to ever compact)
 *   ?module=<id>          — which module tab starts active (site-planner default; try `model`,
 *                           the LAST tab, for the "active tab off-screen on load" case)
 * A small out-of-band control strip (NOT part of AppHeader) lets the verify script switch modules
 * after mount, to exercise NEW-3's "leave and return" re-scroll without a full page reload.
 * Served by `npm run dev`. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import AppHeader from "../src/shared/ui/AppHeader.jsx";
import { ThemeProvider } from "../src/shared/theme/ThemeProvider.jsx";

const params = new URLSearchParams(window.location.search);
// "long" matches the owner's OWN reported strings verbatim (his iPhone screenshot: "Goose Creek"
// / "Phase II - Revision") — the real case this item has to solve. "stress" is deliberately
// LONGER than anything reported, to probe the genuine floor where even a compacted middle crumb
// plus the plan crumb's own existing ellipsis cap cannot both fit — the brief's own "scrolling
// stays available" fallback, not a claim that NOTHING ever needs a scroll.
const PROJECT_NAMES = { short: "Bain", long: "Goose Creek", stress: "Goose Creek Industrial Park Redevelopment Phase" };
const PLAN_NAMES = { short: "A", long: "Phase II - Revision", stress: "Phase II - Revision 3 (Concept, Revised Again)" };

const project = params.get("project") || "long";
const planMode = params.get("plan") || "long";
const startModule = params.get("module") || "site-planner";

// A stand-in for the Site Planner's own trailing plan crumb (SitePlanner.jsx's
// `plannerPlanCrumb`) — same testid + tap-target class, close enough geometry (height 30, padding
// 0 12px, a floor/ceiling on width) that the harness reproduces the real overflow math without
// pulling in the whole Site Planner workspace (its own boot cost is exactly what this harness
// exists to avoid).
function PlanCrumb({ name }) {
  return (
    <button
      className="dbtn tap-target"
      data-testid="plan-crumb"
      title="Switch or rename plan"
      style={{
        display: "flex", alignItems: "center", gap: 5, flex: "none",
        height: 30, padding: "0 12px", borderRadius: 8, border: "none",
        background: "transparent", cursor: "pointer", fontFamily: "inherit",
        fontSize: 12, fontWeight: 500, color: "var(--chrome-text)",
        maxWidth: 200, minWidth: 92, whiteSpace: "nowrap",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      <span data-testid="plan-caret" style={{ color: "var(--chrome-muted)", fontSize: 10.5, flex: "none" }}>▾</span>
    </button>
  );
}

const rightTools = (
  <>
    <button data-testid="toolbar-probe">Export</button>
    <button>Save</button>
  </>
);

function App() {
  const [module, setModule] = useState(startModule);
  return (
    <ThemeProvider>
      {/* Out-of-band, NOT part of AppHeader — proves NEW-3 re-scrolls on a real `onSwitch`
          callback, the same one the header's own tabs call, not a special test-only path. */}
      <div style={{ padding: 4, display: "flex", gap: 4 }}>
        {["site-planner", "scheduler", "doc-review", "library", "notes", "model"].map((m) => (
          <button key={m} data-testid={`switch-${m}`} onClick={() => setModule(m)}>{m}</button>
        ))}
      </div>
      <AppHeader
        module={module}
        onSwitch={setModule}
        onDashboard={() => {}}
        homeLabel="Map"
        currentProject={{ id: "p1", name: PROJECT_NAMES[project] || PROJECT_NAMES.long }}
        onSelectProject={() => {}}
        onNewProject={() => {}}
        planSlot={planMode === "none" ? null : <PlanCrumb name={PLAN_NAMES[planMode] || PLAN_NAMES.long} />}
        saveState="synced"
        toolbarContent={rightTools}
        accountActive={false}
      />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__READY__ = true;
