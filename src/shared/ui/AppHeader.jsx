/* AppHeader — shared two-row chrome for all workspaces.
 *
 * Row 1 (35px): hamburger | logo + wordmark | divider | nav links
 *               || project name (center) ||
 *               save slot | settings | auth control
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
import { useEffect, useState } from "react";
import ProjectBreadcrumb from "./ProjectBreadcrumb.jsx";
import { prefetchModule } from "../../app/modulePrefetch.js";
import { MODULE_ACCENT } from "./moduleAccent.js";

const CHROME = "#14110e";
const LINE   = "#2e2a23";
const MUTED  = "#9b9482";
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
      // iframe doc) so the click loads from cache. Idempotent + best-effort. (B219)
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

const IconBtn = ({ label, children, onClick, style }) => (
  <button
    aria-label={label}
    title={label}
    onClick={onClick}
    style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      width: 28, height: 28, borderRadius: 6,
      border: "none", background: "transparent",
      color: MUTED, cursor: onClick ? "pointer" : "default",
      ...style,
    }}
  >
    {children}
  </button>
);

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
          {/* Hamburger (placeholder — no behavior yet) */}
          <IconBtn label="Menu">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <rect x="1" y="3"    width="12" height="1.5" rx="0.7" />
              <rect x="1" y="6.25" width="12" height="1.5" rx="0.7" />
              <rect x="1" y="9.5"  width="12" height="1.5" rx="0.7" />
            </svg>
          </IconBtn>

          {/* Logo — secondary route to the Dashboard (the labeled crumb is primary, B192) */}
          <button
            onClick={onDashboard || undefined}
            title={onDashboard ? "Dashboard — all projects" : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 6, flex: "none",
              background: "transparent", border: "none",
              cursor: onDashboard ? "pointer" : "default",
              padding: "2px 4px", borderRadius: 6,
            }}
          >
            <span
              style={{
                width: 18, height: 18, borderRadius: 5,
                background: accent, transition: "background 0.25s",
                display: "grid", placeItems: "center", flex: "none",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="2" y="2" width="7" height="12" rx="1" fill="#fff" opacity="0.95" />
                <rect x="10.5" y="2" width="3.5" height="6.5" rx="0.8" fill="#fff" opacity="0.6" />
              </svg>
            </span>
            <span style={{ fontWeight: 800, fontSize: 13.5, color: "#fff", letterSpacing: "-0.01em" }}>
              planyr
            </span>
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

        {/* Right zone — save · settings · auth */}
        <div
          style={{
            flex: 1, display: "flex", alignItems: "center",
            justifyContent: "flex-end", gap: 6, paddingRight: 12,
          }}
        >
          {saveSlot}
          <IconBtn label="Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </IconBtn>
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
  );
}
