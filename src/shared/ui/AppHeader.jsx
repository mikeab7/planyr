/* AppHeader — shared two-row chrome for all workspaces.
 *
 * Row 1 (35px): logo + wordmark | divider | nav links
 *               || project name (center) ||
 *               save slot | auth control
 *
 * Row 2 (36px): module tabs (Site · Schedule · Markup)
 *               || toolbar slot (workspace-specific tools) ||
 *
 * Props
 *   module        — active workspace id ('site-planner' | 'scheduler' | 'doc-review')
 *   onSwitch      — (id) => void  — switch to another module
 *   onDashboard   — () => void    — "Dashboard" / "Projects" nav links
 *   centerContent — ReactNode     — project name + chevron dropdown (workspace provides)
 *   saveSlot      — ReactNode     — save/sync badge (workspace provides)
 *   authControl   — ReactNode     — user avatar or sign-in button (Shell provides)
 *   toolbarContent — ReactNode    — module-specific toolbar buttons (workspace provides)
 *
 * Fullscreen: F key hides the header; Esc (or an exit button) restores it.
 * When hidden the workspace's flex: 1 content fills 100 % of viewport height.
 */
import { useEffect, useRef, useState } from "react";
import ProjectBreadcrumb from "./ProjectBreadcrumb.jsx";
import { createMultiTabPresence } from "../presence/multiTab.js";
import BrandMark from "../brand/BrandMark.jsx";
import { prefetchModule } from "../../app/modulePrefetch.js";
import { MODULE_ACCENT } from "./moduleAccent.js";

const CHROME = "#14110e";
const LINE   = "#2e2a23";
// Inactive module tabs: full-opacity, muted-but-legible (meets WCAG AA on CHROME).
// NOT a low-opacity/disabled treatment — inactive must read as clearly clickable. (B167)
const TAB_IDLE = "#c9c3b4";

// Re-exported from the pure accent module (single source of truth) so existing
// `import { MODULE_ACCENT } from "./AppHeader.jsx"` consumers keep working.
export { MODULE_ACCENT };

// Module tab definitions — label + inline SVG icon path group
const MODULES = [
  {
    id: "site-planner",
    label: "Site",
    // simplified ti-map-2 outline (16×16 viewBox)
    icon: (
      <>
        <path d="M3 6.5l5-2.5 5 2.5-1 8-4-2.5-4 2.5z" />
        <line x1="8" y1="4" x2="8" y2="12.5" />
        <line x1="3" y1="6.5" x2="3" y2="14.5" />
      </>
    ),
  },
  {
    id: "scheduler",
    label: "Schedule",
    // simplified ti-calendar outline
    icon: (
      <>
        <rect x="2.5" y="4.5" width="11" height="9.5" rx="1.5" />
        <line x1="2.5" y1="7.5" x2="13.5" y2="7.5" />
        <line x1="6" y1="2.5" x2="6" y2="5.5" />
        <line x1="10" y1="2.5" x2="10" y2="5.5" />
      </>
    ),
  },
  {
    id: "doc-review",
    label: "Markup",
    // simplified ti-pencil outline
    icon: (
      <>
        <path d="M3.5 12.5l7-7 3 3-7 7H3.5v-3z" />
        <line x1="9.5" y1="6.5" x2="11.5" y2="8.5" />
      </>
    ),
  },
];

// One module tab. Inactive tabs are full-opacity and legible (never dimmed/disabled);
// the module accent reveals on hover, and the active tab keeps the accent + a 2px
// underline indicator. Icons are crisp SVG at a fixed 13px (no bitmap scaling). (B167)
function ModuleTab({ m, isActive, onClick }) {
  const [hover, setHover] = useState(false);
  const tabAccent = MODULE_ACCENT[m.id] || "#e8590c";
  return (
    <button
      onClick={onClick}
      // Hover = nav intent: warm the target workspace's chunk (and Schedule's
      // iframe doc) so the click loads from cache. Idempotent + best-effort. (B223)
      onMouseEnter={() => { setHover(true); if (!isActive) prefetchModule(m.id); }}
      onMouseLeave={() => setHover(false)}
      aria-current={isActive ? "page" : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        height: "100%", padding: "0 13px",
        border: "none",
        borderBottom: `2px solid ${isActive ? tabAccent : "transparent"}`,
        background: "transparent",
        color: isActive || hover ? tabAccent : TAB_IDLE,
        fontFamily: "inherit", fontSize: 12.5,
        fontWeight: isActive ? 600 : 500,
        cursor: "pointer", whiteSpace: "nowrap",
        transition: "color 0.15s, border-color 0.15s",
      }}
    >
      <svg
        width="13" height="13" viewBox="0 0 16 16"
        fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
        style={{ flex: "none", display: "block", shapeRendering: "geometricPrecision" }}
      >
        {m.icon}
      </svg>
      {m.label}
    </button>
  );
}

// B298 — track whether the same project is open in another same-browser tab (BroadcastChannel),
// so the header can warn that editing in two tabs can conflict. Degrades to "no peers" where
// BroadcastChannel is unavailable. Cross-device conflicts are caught server-side by B297.
function useMultiTab(projectId) {
  const [state, setState] = useState({ otherCount: 0, sameProjectTabs: 0, conflictRisk: false });
  const ref = useRef(null);
  useEffect(() => {
    const p = createMultiTabPresence({ project: projectId });
    ref.current = p;
    p.onChange(setState);
    p.start();
    const bye = () => p.stop();
    window.addEventListener("pagehide", bye); // 'bye' so other tabs clear promptly on close
    return () => { window.removeEventListener("pagehide", bye); p.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (ref.current) ref.current.setProject(projectId); }, [projectId]); // keep presence in sync as the project changes
  return state;
}

export default function AppHeader({
  module = "site-planner",
  onSwitch,
  onDashboard,
  centerContent,
  saveSlot,
  authControl,
  toolbarContent,
  // Project breadcrumb / switcher (B191–B193). When onSelectProject is provided the
  // breadcrumb renders right of the logo; workspaces that don't wire it (none, now)
  // simply omit it and the left zone stays logo-only.
  currentProject = null,
  onSelectProject,
  onNewProject,
  saveState,
  // Optional: a workspace-supplied project list (B203 — Schedule feeds in its embedded
  // scheduler's own projects) and a home-crumb label override (B204 — Site → "Map").
  projects,
  homeLabel,
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const multiTab = useMultiTab(currentProject ? currentProject.id : null); // B298 — same-project-in-another-tab warning

  useEffect(() => {
    const handle = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) return;
      if (e.key === "f" || e.key === "F") setFullscreen((v) => !v);
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  const accent = MODULE_ACCENT[module] || "#e8590c";

  // When fullscreen, render only a floating exit button; the header collapses
  // to 0 height so the workspace canvas fills the full viewport.
  if (fullscreen) {
    return (
      <button
        onClick={() => setFullscreen(false)}
        title="Exit fullscreen (Esc)"
        style={{
          position: "fixed", top: 10, right: 12, zIndex: 9999,
          padding: "5px 12px", borderRadius: 8,
          background: "rgba(20,17,14,0.72)", color: "rgba(255,255,255,0.85)",
          border: "1px solid rgba(255,255,255,0.18)",
          cursor: "pointer", fontFamily: "system-ui, sans-serif",
          fontSize: 11.5, fontWeight: 600,
        }}
      >
        ✕ Exit fullscreen
      </button>
    );
  }

  return (
    <>
    <header
      style={{
        flex: "none",
        background: CHROME,
        borderBottom: `1px solid ${LINE}`,
        position: "relative",
        zIndex: 60,
      }}
    >
      {/* ── Row 1 — 35px (−20% from 44 per B169; contents stay vertically centered) ── */}
      <div style={{ height: 35, display: "flex", alignItems: "center" }}>

        {/* Left zone */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4, paddingLeft: 12, minWidth: 0 }}>
          {/* Logo — the Planyr brand mark + wordmark (BrandMark, theme-aware).
              Also a secondary route to the Dashboard (the labeled crumb is primary, B192). */}
          <button
            onClick={onDashboard || undefined}
            title={onDashboard ? "Dashboard — all projects" : undefined}
            style={{
              display: "flex", alignItems: "center", flex: "none",
              background: "transparent", border: "none",
              cursor: onDashboard ? "pointer" : "default",
              padding: "2px 4px", borderRadius: 6,
            }}
          >
            <BrandMark size={20} tile={false} wordmark surface="dark" />
          </button>

          {/* Project breadcrumb / switcher (B191–B193) — immediately right of the wordmark */}
          {onSelectProject && (
            <>
              <span style={{ width: 1, height: 18, background: LINE, flex: "none", margin: "0 4px" }} />
              <ProjectBreadcrumb
                currentProject={currentProject}
                accent={accent}
                onDashboard={onDashboard}
                onSelectProject={onSelectProject}
                onNewProject={onNewProject}
                saveState={saveState}
                projects={projects}
                homeLabel={homeLabel}
              />
            </>
          )}
        </div>

        {/* Center zone — project name */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, maxWidth: "40%", padding: "0 8px",
          }}
        >
          {centerContent}
        </div>

        {/* Right zone — save · auth */}
        <div
          style={{
            flex: 1, display: "flex", alignItems: "center",
            justifyContent: "flex-end", gap: 6, paddingRight: 12,
          }}
        >
          {saveSlot}
          {authControl}
        </div>
      </div>

      {/* ── Row 2 — 36px ────────────────────────────────────────────── */}
      <div style={{ height: 36, display: "flex", alignItems: "center", borderTop: `1px solid ${LINE}` }}>

        {/* Module tabs */}
        <div style={{ display: "flex", alignItems: "stretch", height: "100%", paddingLeft: 4, flex: "none" }}>
          {MODULES.map((m) => (
            <ModuleTab
              key={m.id}
              m={m}
              isActive={m.id === module}
              onClick={() => onSwitch && onSwitch(m.id)}
            />
          ))}
        </div>

        {/* Toolbar slot */}
        <div
          style={{
            flex: 1, display: "flex", alignItems: "center",
            justifyContent: "flex-end", paddingRight: 6,
            minWidth: 0, gap: 4,
            overflow: "hidden",
          }}
        >
          {toolbarContent}
        </div>
      </div>
    </header>
    {/* B298 — non-blocking warning when the SAME project is open in another same-browser tab.
        Clears automatically when that tab closes/navigates (its 'bye' / TTL prunes it). */}
    {multiTab.conflictRisk && (
      <div role="status" style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 5999, maxWidth: 660, display: "flex", alignItems: "center", gap: 10, background: "#3f2d12", color: "#fff", border: "1px solid #f59e0b", borderRadius: 10, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 6px 22px rgba(0,0,0,0.3)" }}>
        <span>⧉ This project is open in <b>another tab</b>. Editing it in more than one tab can conflict — work in a single tab to be safe.</span>
      </div>
    )}
    </>
  );
}
