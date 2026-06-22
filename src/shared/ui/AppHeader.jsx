/* AppHeader — shared two-row chrome for all workspaces.
 *
 * Row 1 (35px): logo + wordmark | divider | nav links
 *               || project name (center) ||
 *               save slot | auth control
 *
 * Row 2 (44px): module tabs (Site · Schedule · Markup)
 *               || toolbar slot (workspace-specific tools) ||
 * Row 2 is intentionally TALLER than Row 1 (B357): the tools row is where the work
 * happens, so it carries the visual weight; the nav row stays thin. Don't equalise them
 * — near-identical heights are what made "which row matters?" ambiguous.
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
import AnchoredMenu from "./AnchoredMenu.jsx";
import { createMultiTabPresence } from "../presence/multiTab.js";
import BrandMark from "../brand/BrandMark.jsx";
import { prefetchModule } from "../../app/modulePrefetch.js";
import { MODULE_ACCENT } from "./moduleAccent.js";
import { useTheme } from "../theme/ThemeProvider.jsx";

// Chrome colors are theme tokens (var(--chrome-*)) so the header themes WITH the app
// (B318): light theme = light chrome, dark theme = dark chrome.
const CHROME = "var(--chrome-bg-elev)";
const LINE   = "var(--chrome-divider)";
// Inactive module tabs: full-opacity, muted-but-legible (meets WCAG AA on the chrome).
// NOT a low-opacity/disabled treatment — inactive must read as clearly clickable. (B167)
const TAB_IDLE = "var(--chrome-tab-inactive)";
// Per-module accent: the FILL (the 2px underline) is fixed in both themes; the active
// tab TEXT uses the -text token, which swaps by theme (sits on chrome). (B318)
const ACCENT_FILL = { "site-planner": "var(--accent-site)", "scheduler": "var(--accent-schedule)", "doc-review": "var(--accent-markup)" };
const ACCENT_TEXT = { "site-planner": "var(--accent-site-text)", "scheduler": "var(--accent-schedule-text)", "doc-review": "var(--accent-markup-text)" };

// Light / Dark / System theme options. The picker now lives inside the row-1 Settings
// gear popover (B342) rather than sitting open in the header — decluttered, but still one
// click and reachable signed-out. Pure local theme switch (reads/sets the ThemeProvider,
// whose matchMedia "System" listener is independent of where this control mounts). (B317)
const THEME_OPTS = [
  { id: "light",  label: "Light",  hint: "Always light",            icon: <><circle cx="8" cy="8" r="3.1" /><path d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1" /></> },
  { id: "dark",   label: "Dark",   hint: "Always dark",             icon: <path d="M13 9.4A5.2 5.2 0 0 1 6.6 3 5.2 5.2 0 1 0 13 9.4Z" /> },
  { id: "system", label: "System", hint: "Match your computer",     icon: <><rect x="2" y="3" width="12" height="8" rx="1" /><path d="M6 13.4h4M8 11.4v2" /></> },
];

const settingsPanel = {
  padding: 6, borderRadius: 10, background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
  fontFamily: "system-ui, sans-serif",
};

// Settings gear (row-1 right zone) → popover hosting the display-theme picker. Always
// present, signed in or out, so the theme switch never depends on the account menu. (B342)
function SettingsMenu({ mode, setMode }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings — display theme"
        style={{
          display: "grid", placeItems: "center", width: 30, height: 26, borderRadius: 7,
          border: `1px solid ${LINE}`, background: "var(--chrome-bg)", color: "var(--chrome-text)",
          cursor: "pointer", flex: "none",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchor}
        placement="below-right" width={206} gap={8} panelStyle={settingsPanel}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)", padding: "4px 8px 6px" }}>
          Display theme
        </div>
        {THEME_OPTS.map((o) => {
          const on = mode === o.id;
          return (
            <button
              key={o.id}
              onClick={() => setMode(o.id)}
              aria-pressed={on}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                padding: "8px 9px", borderRadius: 7, border: "none", cursor: "pointer",
                fontFamily: "inherit", background: on ? "var(--hover-ghost)" : "transparent", color: "var(--text-primary)",
              }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--hover-ghost)"; }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
                {o.icon}
              </svg>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: on ? 700 : 500 }}>{o.label}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)" }}>{o.hint}</span>
              </span>
              {on && <span aria-hidden style={{ color: "var(--accent-site-text)", fontWeight: 800, fontSize: 13 }}>✓</span>}
            </button>
          );
        })}
      </AnchoredMenu>
    </>
  );
}

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
  const fill = ACCENT_FILL[m.id] || "var(--accent)";
  const textCol = ACCENT_TEXT[m.id] || "var(--accent)";
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
        borderBottom: `2px solid ${isActive ? fill : "transparent"}`,
        background: "transparent",
        color: isActive || hover ? textCol : TAB_IDLE,
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

// B313 — track whether the same project is open in another same-browser tab (BroadcastChannel),
// so the header can warn that editing in two tabs can conflict. Degrades to "no peers" where
// BroadcastChannel is unavailable. Cross-device conflicts are caught server-side by B314.
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
  // Whether a real account is signed in. The same-project-in-another-tab warning
  // (B313) only applies to signed-in accounts: a logged-out, device-only session
  // starts fresh and should never see the cross-tab conflict banner — it protects
  // saved cloud work, not anonymous local browsing (which was falsely nagging on
  // mobile). Defaults off so any unwired caller stays silent.
  accountActive = false,
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const { mode, resolved, setMode } = useTheme();
  const multiTab = useMultiTab(accountActive && currentProject ? currentProject.id : null); // B313 — same-project-in-another-tab warning (signed-in only)

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

  // The breadcrumb uses `accent` as foreground TEXT ("current" / "New project"), so it
  // must be the AA-passing -text token, never the fill (fill-as-text = 3.4:1, B341/B318).
  const accent = ACCENT_TEXT[module] || "var(--accent)";

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
            <BrandMark size={20} tile={false} wordmark surface={resolved === "dark" ? "dark" : "light"} />
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
          <SettingsMenu mode={mode} setMode={setMode} />
          {authControl}
        </div>
      </div>

      {/* ── Row 2 — 44px (taller than Row 1: the tools row earns the weight, B357) ── */}
      <div style={{ height: 44, display: "flex", alignItems: "center", borderTop: `1px solid ${LINE}` }}>

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
    {/* B313 — non-blocking warning when the SAME project is open in another same-browser tab.
        Clears automatically when that tab closes/navigates (its 'bye' / TTL prunes it). */}
    {accountActive && multiTab.conflictRisk && (
      <div role="status" style={{ position: "fixed", top: 84, left: "50%", transform: "translateX(-50%)", zIndex: 5999, maxWidth: 660, display: "flex", alignItems: "center", gap: 10, background: "#3f2d12", color: "#fff", border: "1px solid #f59e0b", borderRadius: 10, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 6px 22px rgba(0,0,0,0.3)" }}>
        <span>⧉ This project is open in <b>another tab</b>. Editing it in more than one tab can conflict — work in a single tab to be safe.</span>
      </div>
    )}
    </>
  );
}
