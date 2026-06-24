/* ProjectBreadcrumb — the Row 1 left-anchored breadcrumb + project switcher.
 *
 * Renders `▦ Dashboard  /  <Project name> ▾` immediately right of the logo, in every
 * workspace (the header component is shared, so the breadcrumb is identical across
 * Site / Schedule / Markup). The "Dashboard" crumb (B192) is always-visible literal
 * text routing to the all-projects view; the project crumb (B191) opens a portal
 * dropdown (search · "All projects" · recent projects newest-first · New project).
 *
 * Persist-before-switch (B193): the workspace flushes the current project on the way
 * out (SitePlanner's unmount flush / Doc Review's persistence flush). This component
 * adds the *surfacing* the owner asked for — a passive ⚠ line in the dropdown plus a
 * transient toast when a switch happens while the cloud is unreachable — so a switch
 * is never silent about an at-risk save, but is also never blocked on one.
 *
 * Rename / delete (B439): each project row exposes a hover-revealed ⋯ kebab (and
 * right-click) that opens a small portal context menu with Rename and Delete. Rename
 * edits the row label in place (Enter/blur commits; Esc cancels; trim; reject empty).
 * Delete shows an inline confirm step before acting. In uncontrolled mode (Site /
 * Markup) the component calls the store directly; in controlled mode (Schedule) it
 * calls the onRenameProject / onDeleteProject callbacks.
 *
 * Props
 *   currentProject  — { id, name } | null   (null = we're on the Dashboard)
 *   accent          — module accent color (New-project highlight + active crumb)
 *   onDashboard     — () => void            (also the logo's secondary route)
 *   onSelectProject — (id, name) => void
 *   onNewProject    — () => void
 *   saveState       — "synced"|"saving"|"offline"|"error"|"local"|null  (current project)
 *   onRenameProject — (id, newName) => void   optional; omit = uncontrolled store
 *   onDeleteProject — (id) => void            optional; omit = uncontrolled store
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AnchoredMenu from "./AnchoredMenu.jsx";
import { listProjects, filterProjects, relTime, renameProject, deleteProject } from "../projects/projects.js";

// Crumbs sit on the chrome bar, which now themes WITH the app (B318) — so these are
// chrome tokens, not the retired warm-dark hexes (white-on-light was the B341 bug).
const MUTED = "var(--chrome-muted)";
const LINE = "var(--chrome-divider)";
const INK = "var(--chrome-text)";

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

// Private-by-default lock (Work Item A gotcha): a project a user lands on is one only
// they can see. The lock keeps that visible, so any future sharing always reads as a
// deliberate act — never an accidental exposure.
const LockIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
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
  padding: 8, borderRadius: 10, background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
  fontFamily: "system-ui, sans-serif",
};

const row = (extra) => ({
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  width: "100%", textAlign: "left", padding: "7px 9px", borderRadius: 7,
  border: "none", background: "transparent", cursor: "pointer",
  fontFamily: "inherit", fontSize: 12.5, color: "var(--text-primary)", ...extra,
});

const divider = { height: 1, background: "var(--border-default)", margin: "6px 4px" };

const ctxItem = (extra) => ({
  display: "block", width: "100%", textAlign: "left",
  padding: "7px 10px", border: "none", borderRadius: 6,
  background: "transparent", cursor: "pointer",
  fontFamily: "inherit", fontSize: 12.5, color: "var(--text-primary)",
  ...extra,
});

export default function ProjectBreadcrumb({
  currentProject,
  accent = "var(--accent-site-text)", // foreground text token (AA), not the fill (B341)
  onDashboard,
  onSelectProject,
  onNewProject,
  saveState,
  // When `projects` is supplied the breadcrumb is "controlled": the workspace owns the
  // list (e.g. the Schedule module feeds in its embedded scheduler's own projects).
  // When omitted it falls back to the Site Planner site store via listProjects().
  projects: controlledProjects,
  // The "home" crumb label — Site → "Map", Schedule → "Dashboard" (B204).
  homeLabel = "Dashboard",
  // Cross-project mode (Work Item A): the file tree spans ALL of the user's projects, so
  // the project crumb reads "All projects" instead of a single name. Off by default.
  cross = false,
  // Rename / delete callbacks (B439). When omitted the component uses the uncontrolled
  // Site store path (renameProject / deleteProject from projects.js). When provided
  // (Schedule bridge) the component calls these instead and the workspace drives the state.
  onRenameProject,
  onDeleteProject,
}) {
  const controlled = Array.isArray(controlledProjects);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [internalProjects, setInternalProjects] = useState([]);
  // Single data-entry guard (B380): drop any falsy entry before it reaches a `p.id` /
  // `p.name` read below — so a controlled caller (e.g. the Schedule module bridging its
  // embedded app's project list) that hasn't fully resolved its data can never trip a
  // "Cannot read properties of undefined" crash in this shared header.
  const projects = (controlled ? controlledProjects : internalProjects).filter(Boolean);
  const [hoverRow, setHoverRow] = useState(null);
  const [toast, setToast] = useState(null); // transient "saved on device" notice (B193)
  const anchorRef = useRef(null);
  const toastTimer = useRef(null);

  // Rename / delete state (B439)
  const [renaming, setRenaming] = useState(null);   // { id, name } | null
  const [ctxMenu, setCtxMenu] = useState(null);     // { id, name, x, y, confirm } | null
  const [deleteErr, setDeleteErr] = useState(null); // error string shown in confirm view
  const skipNextBlurRef = useRef(false);             // prevents blur from committing after Esc

  const refresh = () => { if (!controlled) setInternalProjects(listProjects()); };
  // Keep the (uncontrolled) list fresh: on mount, whenever the dropdown opens, and when
  // another tab changes the site store (same store the Site Planner finder watches).
  // Controlled mode skips this entirely — the workspace pushes updates via the prop.
  useEffect(() => {
    if (controlled) return;
    refresh();
    const onStorage = (e) => { if (!e.key || e.key.startsWith("planarfit:sites")) refresh(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { refresh(); setQ(""); } }, [open]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Surface (don't block) an at-risk save when leaving the current project (B193).
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

  // ── Rename / delete (B439) ────────────────────────────────────────────────

  const openCtxForRow = (x, y, id, name) => {
    // Cancel any in-progress rename on a different row first
    if (renaming && renaming.id !== id) { skipNextBlurRef.current = true; setRenaming(null); }
    setDeleteErr(null);
    // Clamp to viewport so the menu never clips off-screen
    const vw = window.innerWidth, vh = window.innerHeight;
    setCtxMenu({ id, name, x: Math.min(x, vw - 172), y: Math.min(y + 4, vh - 90), confirm: false });
  };

  const closeCtxMenu = () => { setCtxMenu(null); setDeleteErr(null); };

  const startRename = () => {
    if (!ctxMenu) return;
    const { id, name } = ctxMenu;
    closeCtxMenu();
    setRenaming({ id, name });
  };

  const cancelRename = () => {
    skipNextBlurRef.current = true;
    setRenaming(null);
  };

  const commitRename = (id, rawName) => {
    const name = (rawName || "").trim();
    if (!name) { setRenaming(null); return; }
    if (onRenameProject) {
      onRenameProject(id, name);
    } else {
      renameProject(id, name);
      refresh();
    }
    setRenaming(null);
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commitRename(renaming.id, renaming.name); }
    if (e.key === "Escape") { e.stopPropagation(); cancelRename(); }
  };

  const handleRenameBlur = () => {
    if (skipNextBlurRef.current) { skipNextBlurRef.current = false; return; }
    commitRename(renaming.id, renaming.name);
  };

  const handleDeleteConfirm = async () => {
    if (!ctxMenu) return;
    const { id } = ctxMenu;
    setDeleteErr(null);
    const isActive = id === currentProject?.id;
    if (onDeleteProject) {
      onDeleteProject(id);
      closeCtxMenu();
    } else {
      const res = await deleteProject(id).catch((e) => ({ ok: false, error: String(e) }));
      if (!res.ok) { setDeleteErr(res.error || "Delete failed — please try again."); return; }
      closeCtxMenu();
      refresh();
      if (isActive) onDashboard?.();
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  const onDash = !currentProject; // we're at the all-projects view
  const filtered = filterProjects(projects, q);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, flex: "none" }}>
      {/* Dashboard crumb (B192) — literal text, always visible, primary route home */}
      <button
        onClick={goDashboard}
        title={`All projects — ${homeLabel}`}
        aria-current={onDash ? "page" : undefined}
        style={crumbBtn({ color: onDash ? INK : MUTED })}
        onMouseEnter={(e) => { if (!onDash) e.currentTarget.style.color = INK; }}
        onMouseLeave={(e) => { if (!onDash) e.currentTarget.style.color = MUTED; }}
      >
        <DashboardIcon />
        {homeLabel}
      </button>

      <span style={{ color: MUTED, opacity: 0.55, flex: "none", fontSize: 13, padding: "0 1px" }}>/</span>

      {/* Project crumb (B191) — opens the switcher dropdown. In cross-project mode it
          reads "All projects"; on a single project it carries a Private lock. */}
      <button
        ref={anchorRef}
        onClick={() => setOpen((o) => !o)}
        title={cross ? "Browsing all projects" : currentProject ? "Switch project" : "Choose a project"}
        aria-haspopup="menu"
        aria-expanded={open}
        style={crumbBtn({ color: (currentProject || cross) ? INK : MUTED, maxWidth: 240, minWidth: 0 })}
      >
        {currentProject && !cross && (
          <span title="Private — only you can see this project. Sharing is always a deliberate act."
            style={{ flex: "none", color: MUTED, display: "flex", alignItems: "center" }}>
            <LockIcon />
          </span>
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cross ? "All projects" : (currentProject?.name || "Select a project")}
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
            border: "1px solid var(--border-default)", borderRadius: 7, outline: "none",
            fontFamily: "inherit", fontSize: 12.5, color: "var(--text-primary)", background: "var(--surface-page)",
          }}
        />

        {atRisk(saveState) && (
          <div style={{ display: "flex", gap: 7, alignItems: "flex-start", padding: "7px 9px", marginBottom: 4,
            borderRadius: 7, background: "#fef3c7", color: "#92400e", fontSize: 11.5, lineHeight: 1.4 }}>
            <span aria-hidden>⚠</span>
            <span>This project's latest changes are saved on this device — the cloud is unreachable. Switching is safe; they'll sync when you reconnect.</span>
          </div>
        )}

        {/* All projects (Dashboard) — pinned at top, then a divider (B191/B192) */}
        <button
          onClick={goDashboard}
          onMouseEnter={() => setHoverRow("__dash")}
          onMouseLeave={() => setHoverRow(null)}
          style={row({ background: hoverRow === "__dash" ? "var(--hover-ghost)" : (onDash ? "var(--hover-menu)" : "transparent"), fontWeight: 600 })}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)" }}>
            <DashboardIcon size={14} />
            All projects ({homeLabel})
          </span>
          {onDash && <span style={{ color: accent, fontSize: 10.5, fontWeight: 700 }}>current</span>}
        </button>

        <div style={divider} />

        {/* Recent projects — newest-edited first, relative timestamps */}
        <div style={{ maxHeight: 280, overflowY: "auto", margin: "0 -2px", padding: "0 2px" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "10px 9px", fontSize: 12, color: "var(--text-tertiary)" }}>
              {q ? "No matching projects." : "No projects yet — start one below."}
            </div>
          ) : (
            filtered.map((p) => {
              const cur = p.id === currentProject?.id;
              const isRenaming = renaming?.id === p.id;
              const isCtxOpen = ctxMenu?.id === p.id;
              return (
                <div
                  key={p.id}
                  style={{ position: "relative", display: "flex", alignItems: "center" }}
                  onContextMenu={(e) => { e.preventDefault(); openCtxForRow(e.clientX, e.clientY, p.id, p.name); }}
                >
                  {isRenaming ? (
                    /* ── Inline rename input ── */
                    <div style={{ flex: 1, padding: "3px 9px" }}>
                      <input
                        autoFocus
                        value={renaming.name}
                        onChange={(e) => setRenaming((r) => ({ ...r, name: e.target.value }))}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={handleRenameBlur}
                        style={{
                          width: "100%", boxSizing: "border-box",
                          padding: "5px 7px", borderRadius: 5, outline: "none",
                          border: "1px solid var(--accent, #4f6ef7)",
                          fontFamily: "inherit", fontSize: 12.5, color: "var(--text-primary)",
                          background: "var(--surface-page)",
                        }}
                      />
                    </div>
                  ) : (
                    /* ── Normal project row ── */
                    <button
                      onClick={() => pickProject(p.id, p.name)}
                      onMouseEnter={() => setHoverRow(p.id)}
                      onMouseLeave={() => setHoverRow(null)}
                      style={row({
                        flex: 1,
                        paddingRight: 30, // space for the kebab button
                        background: hoverRow === p.id || isCtxOpen ? "var(--hover-ghost)" : (cur ? "var(--hover-menu)" : "transparent"),
                      })}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                        {p.name}
                      </span>
                      {cur
                        ? <span style={{ color: accent, fontSize: 10.5, fontWeight: 700, flex: "none" }}>current</span>
                        : <span style={{ color: "var(--text-tertiary)", fontSize: 11, flex: "none" }}>{relTime(p.updatedAt)}</span>}
                    </button>
                  )}

                  {/* ⋯ kebab — hover-reveal; also persists while ctx menu is open for this row */}
                  {!isRenaming && (
                    <button
                      onMouseEnter={() => setHoverRow(p.id)}
                      onMouseLeave={() => setHoverRow(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        openCtxForRow(r.left, r.bottom, p.id, p.name);
                      }}
                      title="Rename or delete"
                      aria-label="Project options"
                      style={{
                        position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)",
                        width: 22, height: 22, borderRadius: 4,
                        border: "none", background: "transparent", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "var(--text-secondary)", fontSize: 14, lineHeight: 1,
                        opacity: hoverRow === p.id || isCtxOpen ? 1 : 0,
                        pointerEvents: hoverRow === p.id || isCtxOpen ? "auto" : "none",
                        transition: "opacity 0.1s",
                      }}
                    >
                      ⋯
                    </button>
                  )}
                </div>
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
          style={row({ background: hoverRow === "__new" ? "var(--hover-ghost)" : "transparent", color: accent, fontWeight: 700 })}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>＋</span>
            New project
          </span>
        </button>
      </AnchoredMenu>

      {/* Context menu — portal above AnchoredMenu backdrop (z-index 5000 > 4001) */}
      {ctxMenu && createPortal(
        <>
          {/* Click-away backdrop: closes ctx menu without closing the main dropdown */}
          <div onClick={closeCtxMenu} style={{ position: "fixed", inset: 0, zIndex: 4999 }} />
          <div
            style={{
              position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 5000,
              minWidth: 162,
              background: "var(--surface-raised)", color: "var(--text-primary)",
              border: "1px solid var(--border-default)", borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
              padding: 4,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {!ctxMenu.confirm ? (
              <>
                <button
                  onClick={startRename}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-ghost)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  style={ctxItem()}
                >
                  ✎ Rename
                </button>
                <button
                  onClick={() => setCtxMenu((m) => ({ ...m, confirm: true }))}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-ghost)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  style={ctxItem({ color: "var(--danger, #d63032)" })}
                >
                  Delete
                </button>
              </>
            ) : (
              /* Inline confirm step — no window.prompt, no dialog */
              <>
                <div style={{ padding: "6px 10px 4px", fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                  Delete "{ctxMenu.name}"?
                </div>
                {deleteErr && (
                  <div style={{ padding: "3px 10px 5px", fontSize: 11.5, color: "var(--danger, #d63032)" }}>
                    {deleteErr}
                  </div>
                )}
                <div style={{ display: "flex", gap: 4, padding: "2px 4px 4px" }}>
                  <button
                    onClick={() => { setCtxMenu((m) => ({ ...m, confirm: false })); setDeleteErr(null); }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-ghost)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    style={{
                      flex: 1, padding: "5px 0", borderRadius: 5, border: "1px solid var(--border-default)",
                      background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 12,
                      color: "var(--text-primary)",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteConfirm}
                    style={{
                      flex: 1, padding: "5px 0", borderRadius: 5, border: "none",
                      background: "var(--danger, #d63032)", cursor: "pointer",
                      fontFamily: "inherit", fontSize: 12, fontWeight: 700, color: "#fff",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </>,
        document.body,
      )}

      {/* Transient at-risk-switch notice (B193) — non-blocking, auto-dismiss */}
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
