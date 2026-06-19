/* Sequence Planyr workspace — embeds the scheduler in-page via iframe.
 * The sequence app's own header is hidden when it detects it's inside an iframe
 * (see public/sequence/index.html — the .in-iframe CSS class), so its project
 * navigation is bridged up to the shell's shared Row-1 breadcrumb over postMessage
 * (B203). The embedded app emits its OWN project list + active project + section
 * ("planar:nav-state"); this component renders them in the breadcrumb and posts back
 * select / dashboard / new-project commands. That makes the Schedule picker show
 * SCHEDULE projects (Goose Creek, Grand Port, …) and switch them in place — instead
 * of listing the Site Planner's sites and bouncing into the Site Planner. */
import { useEffect, useRef, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";

export default function Scheduler({ shellModule, onShellSwitch, authControl } = {}) {
  const iframeRef = useRef(null);
  const [projects, setProjects] = useState([]);   // [{id, name}] from the embedded app
  const [activeId, setActiveId] = useState(null);  // its active project id (aPid)
  const [section, setSection] = useState("projects"); // "projects" | "reports" (Dashboard)

  // Receive the embedded scheduler's nav state (its own projects — not the Site
  // Planner's). It re-emits on load and on every project add/rename/delete/switch.
  useEffect(() => {
    const onMsg = (e) => {
      const m = e.data;
      if (!m || m.source !== "planar-seq" || m.type !== "planar:nav-state") return;
      setProjects(Array.isArray(m.projects) ? m.projects : []);
      setActiveId(m.activeId ?? null);
      setSection(m.section || "projects");
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Same-origin iframe, so target its exact origin (not "*").
  const post = (msg) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { source: "planar-shell", ...msg }, window.location.origin,
      );
    } catch (_) {}
  };

  // On the Dashboard (reports) view no single project is "current" — the Dashboard
  // crumb reads as current and the project crumb invites a pick.
  const currentProject = section === "reports"
    ? null
    : (projects.find((p) => p.id === activeId) || null);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f6f8fa" }}>
      <AppHeader
        module={shellModule || "scheduler"}
        onSwitch={onShellSwitch}
        authControl={authControl}
        homeLabel="Dashboard"
        // The breadcrumb drives the EMBEDDED scheduler (its own projects), not the
        // Site Planner: pick a project → switch to its Gantt; Dashboard → the reports
        // overview; New project → add one in the scheduler.
        currentProject={currentProject}
        projects={projects}
        onSelectProject={(id) => post({ type: "planar:nav-select", id })}
        onDashboard={() => post({ type: "planar:nav-dashboard" })}
        onNewProject={() => post({ type: "planar:nav-new" })}
      />
      <iframe
        ref={iframeRef}
        src="/sequence/"
        title="Sequence Planyr"
        style={{ flex: 1, border: "none", width: "100%", minHeight: 0, display: "block" }}
      />
    </div>
  );
}
