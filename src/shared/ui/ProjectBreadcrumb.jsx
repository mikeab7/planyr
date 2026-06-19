/* ProjectBreadcrumb — the Row 1 left-anchored breadcrumb + project switcher.
 *
 * Renders `▦ Dashboard  /  <Project name> ▾` immediately right of the logo, in every
 * workspace (the header component is shared, so the breadcrumb is identical across
 * Site / Schedule / Markup). The "Dashboard" crumb (B190) is always-visible literal
 * text routing to the all-projects view; the project crumb (B189) opens a portal
 * dropdown (search · "All projects" · recent projects newest-first · New project).
 *
 * Persist-before-switch (B191): the workspace flushes the current project on the way
 * out (SitePlanner's unmount flush / Doc Review's persistence flush). This component
 * adds the *surfacing* the owner asked for — a passive ⚠ line in the dropdown plus a
 * transient toast when a switch happens while the cloud is unreachable — so a switch
 * is never silent about an at-risk save, but is also never blocked on one.
 *
 * Props
 *   currentProject  — { id, name } | null   (null = we're on the Dashboard)
 *   accent          — module accent color (New-project highlight + active crumb)
 *   onDashboard     — () => void            (also the logo's secondary route)
 *   onSelectProject — (id, name) => void
 *   onNewProject    — () => void
 *   saveState       — "synced"|"saving"|"offline"|"error"|"local"|null  (current project)
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AnchoredMenu from "./AnchoredMenu.jsx";
import { listProjects, filterProjects, relTime } from "../projects/projects.js";

const MUTED = "#9b9482";
const LINE = "#2e2a23";
const INK = "#ece7db";

// A cloud write that may not have reached the server. "saving" is in-flight (the
// flush will complete it) so it's not surfaced as at-risk; offline/error are.
const atRisk = (s) => s === "offline" || s === "error";

const DashboardIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <rect x="4" y="4" width="6" height="8" rx="1" />
    <rect x="4" y="16" width="6" height="4" rx="1" />
    <rect x="14" y="12" width="6" height="8" rx="1" />
    <rect x="14" y="4" width="6" height="4" rx="1" />
  </svg>
);

const crumbBtn = (extra) => ({
  display: "flex", alignItems: "center", gap: 5, flex: "none",
  height: 24, padding: "0 8px", borderRadius: 6,
  border: "none", background: "transparent", cursor: "pointer",
  fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
  ...extra,
});

const panel = {
  padding: 8, borderRadius: 10, background: "#fff", color: "#2c2a26",
  border: "1px solid #e7e2d6", boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
  fontFamily: "system-ui, sans-serif",
};

const row = (extra) => ({
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  width: "100%", textAlign: "left", padding: "7px 9px", borderRadius: 7,
  border: "none", background: "transparent", cursor: "pointer",
  fontFamily: "inherit", fontSize: 12.5, color: "#2c2a26", ...extra,
});

const divider = { height: 1, background: "#ece7db", margin: "6px 4px" };

export default function ProjectBreadcrumb({
  currentProject,
  accent = "#1D9E75",
  onDashboard,
  onSelectProject,
  onNewProject,
  saveState,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [projects, setProjects] = useState([]);
  const [hoverRow, setHoverRow] = useState(null);
  const [toast, setToast] = useState(null); // transient "saved on device" notice (B191)
  const anchorRef = useRef(null);
  const toastTimer = useRef(null);

  const refresh = () => setProjects(listProjects());
  // Keep the list fresh: on mount, whenever the dropdown opens, and when another tab
  // changes the site store (same store the Site Planner finder watches).
  useEffect(() => {
    refresh();
    const onStorage = (e) => { if (!e.key || e.key.startsWith("planarfit:sites")) refresh(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => { if (open) { refresh(); setQ(""); } }, [open]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Surface (don't block) an at-risk save when leaving the current project (B191).
  const flagIfAtRisk = () => {
    if (!atRisk(saveState)) return;
    clearTimeout(toastTimer.current);
    setToast("Your latest changes are saved on this device. The cloud is unreachable — they'll sync automatically when you reconnect.");
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  const goDashboard = () => { setOpen(false); flagIfAtRisk(); onDashboard?.(); };
  const pickProject = (id, name) => {
    setOpen(false);
    if (id !== currentProject?.id) flagIfAtRisk();
    onSelectProject?.(id, name);
  };
  const newProject = () => { setOpen(false); flagIfAtRisk(); onNewProject?.(); };

  const onDash = !currentProject; // we're at the all-projects view
  const filtered = filterProjects(projects, q);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, flex: "none" }}>
      {/* Dashboard crumb (B190) — literal text, always visible, primary route home */}
      <button
        onClick={goDashboard}
        title="All projects — Dashboard"
        aria-current={onDash ? "page" : undefined}
        style={crumbBtn({ color: onDash ? "#fff" : MUTED })}
        onMouseEnter={(e) => { if (!onDash) e.currentTarget.style.color = INK; }}
        onMouseLeave={(e) => { if (!onDash) e.currentTarget.style.color = MUTED; }}
      >
        <DashboardIcon />
        Dashboard
      </button>

      <span style={{ color: MUTED, opacity: 0.55, flex: "none", fontSize: 13, padding: "0 1px" }}>/</span>

      {/* Project crumb (B189) — opens the switcher dropdown */}
      <button
        ref={anchorRef}
        onClick={() => setOpen((o) => !o)}
        title={currentProject ? "Switch project" : "Choose a project"}
        aria-haspopup="menu"
        aria-expanded={open}
        style={crumbBtn({ color: currentProject ? "#fff" : MUTED, maxWidth: 240, minWidth: 0 })}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {currentProject?.name || "Select a project"}
        </span>
        {atRisk(saveState) && (
          <span title="Saved on this device — the cloud is unreachable" aria-hidden
            style={{ flex: "none", color: "#f59e0b", fontSize: 11 }}>⚠</span>
        )}
        <span style={{ opacity: 0.6, fontSize: 11, flex: "none" }}>▾</span>
      </button>

      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef}
        placement="below-left" width={304} gap={8} panelStyle={panel}>
        {/* Search */}
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search projects…"
          style={{
            width: "100%", boxSizing: "border-box", padding: "7px 9px", marginBottom: 6,
            border: "1px solid #e0dacc", borderRadius: 7, outline: "none",
            fontFamily: "inherit", fontSize: 12.5, color: "#2c2a26", background: "#faf8f3",
          }}
        />

        {atRisk(saveState) && (
          <div style={{ display: "flex", gap: 7, alignItems: "flex-start", padding: "7px 9px", marginBottom: 4,
            borderRadius: 7, background: "#fef3c7", color: "#92400e", fontSize: 11.5, lineHeight: 1.4 }}>
            <span aria-hidden>⚠</span>
            <span>This project's latest changes are saved on this device — the cloud is unreachable. Switching is safe; they'll sync when you reconnect.</span>
          </div>
        )}

        {/* All projects (Dashboard) — pinned at top, then a divider (B189/B190) */}
        <button
          onClick={goDashboard}
          onMouseEnter={() => setHoverRow("__dash")}
          onMouseLeave={() => setHoverRow(null)}
          style={row({ background: hoverRow === "__dash" ? "#f1eee6" : (onDash ? "#f6f4ee" : "transparent"), fontWeight: 600 })}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#4a463d" }}>
            <DashboardIcon size={14} />
            All projects (Dashboard)
          </span>
          {onDash && <span style={{ color: accent, fontSize: 10.5, fontWeight: 700 }}>current</span>}
        </button>

        <div style={divider} />

        {/* Recent projects — newest-edited first, relative timestamps */}
        <div style={{ maxHeight: 280, overflowY: "auto", margin: "0 -2px", padding: "0 2px" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "10px 9px", fontSize: 12, color: "#8a8475" }}>
              {q ? "No matching projects." : "No projects yet — start one below."}
            </div>
          ) : (
            filtered.map((p) => {
              const cur = p.id === currentProject?.id;
              return (
                <button
                  key={p.id}
                  onClick={() => pickProject(p.id, p.name)}
                  onMouseEnter={() => setHoverRow(p.id)}
                  onMouseLeave={() => setHoverRow(null)}
                  style={row({ background: hoverRow === p.id ? "#f1eee6" : (cur ? "#f6f4ee" : "transparent") })}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                    {p.name}
                  </span>
                  {cur
                    ? <span style={{ color: accent, fontSize: 10.5, fontWeight: 700, flex: "none" }}>current</span>
                    : <span style={{ color: "#a39c8b", fontSize: 11, flex: "none" }}>{relTime(p.updatedAt)}</span>}
                </button>
              );
            })
          )}
        </div>

        <div style={divider} />

        {/* New project — pinned at the bottom */}
        <button
          onClick={newProject}
          onMouseEnter={() => setHoverRow("__new")}
          onMouseLeave={() => setHoverRow(null)}
          style={row({ background: hoverRow === "__new" ? "#f1eee6" : "transparent", color: accent, fontWeight: 700 })}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>＋</span>
            New project
          </span>
        </button>
      </AnchoredMenu>

      {/* Transient at-risk-switch notice (B191) — non-blocking, auto-dismiss */}
      {toast && createPortal(
        <div role="status" style={{
          position: "fixed", top: 84, left: "50%", transform: "translateX(-50%)", zIndex: 9000,
          maxWidth: 520, display: "flex", alignItems: "center", gap: 10,
          background: "#1f2a44", color: "#eaf0ff", border: "1px solid #3b5bbf", borderRadius: 10,
          padding: "9px 13px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif",
          boxShadow: "0 10px 30px rgba(0,0,0,0.32)",
        }}>
          <span style={{ flex: 1 }}>{toast}</span>
          <button onClick={() => setToast(null)} title="Dismiss" style={{
            flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.16)", color: "#fff",
            border: "none", borderRadius: 6, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700,
          }}>✕</button>
        </div>,
        document.body,
      )}
    </div>
  );
}
