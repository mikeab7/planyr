/* Sequence Planyr workspace — embeds the scheduler in-page via iframe.
 * The sequence app's own header is hidden when it detects it's inside an iframe
 * (see public/sequence/index.html — the .in-iframe CSS class). */
import AppHeader from "../../shared/ui/AppHeader.jsx";

export default function Scheduler({ shellModule, onShellSwitch, authControl, onGoDashboard, onOpenProject, onNewProject } = {}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f6f8fa" }}>
      <AppHeader
        module={shellModule || "scheduler"}
        onSwitch={onShellSwitch}
        authControl={authControl}
        // Schedule has no per-project React state (it's an embedded iframe), so the
        // breadcrumb routes through the shell: Dashboard / picking a project / New
        // project all switch into the Site Planner where projects open (B189–B191).
        onDashboard={onGoDashboard}
        currentProject={null}
        onSelectProject={onOpenProject}
        onNewProject={onNewProject}
      />
      <iframe
        src="/sequence/"
        title="Sequence Planyr"
        style={{ flex: 1, border: "none", width: "100%", minHeight: 0, display: "block" }}
      />
    </div>
  );
}
