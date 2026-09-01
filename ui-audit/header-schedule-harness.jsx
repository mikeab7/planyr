/* B1012560/B1017840 — Dev-only harness (not part of the app build) for the Schedule module's
 * Row-2 header layout: the ONE 3-zone (tabs | center | toolbar) case in this app, since
 * Scheduler.jsx is the only caller that passes `toolbarCenter` to AppHeader.
 *
 * Mounts the REAL AppHeader with the REAL ScheduleCenter/ScheduleActions components (the actual
 * Grid/Split/Gantt segmented control, inbox, zoom cluster, Export▾, dividers, History, Contacts,
 * Automation and Settings) — not an approximation of their widths. Both components are pure
 * React over a `toolbar` state object + a `post` callback; neither needs the embedded Gantt
 * iframe to be present to render, so a fabricated `toolbar` object (shaped exactly like what
 * `Scheduler.jsx` derives from the iframe's postMessage reports) is enough to render their real,
 * on-screen widths with no auth, no network, and no iframe.
 *
 * TWO SCOPES (B1017840) — the toolbar's real width differs by which Schedule view is active:
 * Grid has no zoom cluster (`toolbar.zoomable: false`, the narrower real case); Split/Gantt adds
 * one (`zoomable: true`, wider). The wrap-to-second-line threshold (see AppHeader.jsx's Row-2
 * comment) sits at a different container width for each, so both need their own pass rather than
 * assuming one represents the other.
 *
 * The probe (verify-schedule-header-widths.mjs) resizes the viewport across the reported break
 * point (1108px pre-fix) and down through the width where the row wraps to a second line, and
 * checks two things depending on whether the row is one line or two: on ONE line, every module
 * tab must resolve to itself (elementFromPoint) and the two gaps either side of the center group
 * must be equal; on TWO lines, the center group's content and the toolbar's content must not
 * overlap as real 2D rectangles — never a same-line-assuming 1D left/right gap comparison, which
 * reads a correct two-line wrap as a negative "overlap" simply because the two groups sit at
 * different vertical positions.
 */
import { createRoot } from "react-dom/client";
import AppHeader from "../src/shared/ui/AppHeader.jsx";
import { ThemeProvider } from "../src/shared/theme/ThemeProvider.jsx";
import { ScheduleCenter, ScheduleActions } from "../src/workspaces/scheduler/components/ScheduleToolbar.jsx";

const post = () => {};

const authBtn = (
  <button data-testid="auth-btn" style={{ height: 26, padding: "0 12px", borderRadius: 7, border: "1px solid var(--chrome-divider)", background: "var(--accent-schedule)", color: "var(--on-accent)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
    MM
  </button>
);

function HeaderCase({ scope, zoomable }) {
  const toolbar = {
    ready: true,
    section: "projects",
    reviewOpen: false,
    reviewCount: 3,
    view: zoomable ? "split" : "grid",
    zoomable,
    zoomPct: 100,
    activePanel: null,
  };
  return (
    <div data-scope={scope} style={{ marginBottom: 10 }}>
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
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      {/* "grid" — the narrower real toolbar case (no zoom cluster) */}
      <HeaderCase scope="grid" zoomable={false} />
      {/* "split" — the wider real toolbar case (Split/Gantt views add the zoom cluster) */}
      <HeaderCase scope="split" zoomable />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__READY__ = true;
