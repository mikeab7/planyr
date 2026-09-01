/* B1012560 — Dev-only harness (not part of the app build) for the Schedule module's Row-2
 * header layout: the ONE 3-zone (tabs | center | toolbar) case in this app, since Scheduler.jsx
 * is the only caller that passes `toolbarCenter` to AppHeader.
 *
 * Mounts the REAL AppHeader with the REAL ScheduleCenter/ScheduleActions components (the actual
 * Grid/Split/Gantt segmented control, inbox, zoom cluster, Export▾, dividers, History, Contacts,
 * Automation and Settings) — not an approximation of their widths. Both components are pure
 * React over a `toolbar` state object + a `post` callback; neither needs the embedded Gantt
 * iframe to be present to render, so a fabricated `toolbar` object (shaped exactly like what
 * `Scheduler.jsx` derives from the iframe's postMessage reports) is enough to render their real,
 * on-screen widths with no auth, no network, and no iframe.
 *
 * The probe (verify-schedule-header-widths.mjs) resizes the viewport across the reported break
 * point (1108px pre-fix) and down to 1024/960/900, and sweeps every module tab with
 * `elementFromPoint` — same technique as verify-header-nav-clickable.mjs uses for Row 1.
 */
import { createRoot } from "react-dom/client";
import AppHeader from "../src/shared/ui/AppHeader.jsx";
import { ThemeProvider } from "../src/shared/theme/ThemeProvider.jsx";
import { ScheduleCenter, ScheduleActions } from "../src/workspaces/scheduler/components/ScheduleToolbar.jsx";

// A representative reported toolbar state — Projects section, Grid view, zoomable (so the
// zoom cluster renders, matching a Split/Gantt view's real width), a nonzero review count (so
// the inbox badge renders at its real width too).
const toolbar = {
  ready: true,
  section: "projects",
  reviewOpen: false,
  reviewCount: 3,
  view: "grid",
  zoomable: true,
  zoomPct: 100,
  activePanel: null,
};
const post = () => {};

const authBtn = (
  <button data-testid="auth-btn" style={{ height: 26, padding: "0 12px", borderRadius: 7, border: "1px solid var(--chrome-divider)", background: "var(--accent-schedule)", color: "var(--on-accent)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
    MM
  </button>
);

function App() {
  return (
    <ThemeProvider>
      <AppHeader
        module="scheduler"
        homeLabel="Dashboard"
        currentProject={{ id: "p1", name: "Bain" }}
        onSelectProject={() => {}}
        onNewProject={() => {}}
        saveState="synced"
        multiEditOk
        authControl={authBtn}
        accountActive
        toolbarCenter={<ScheduleCenter toolbar={toolbar} post={post} />}
        toolbarContent={<ScheduleActions toolbar={toolbar} post={post} />}
      />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__READY__ = true;
