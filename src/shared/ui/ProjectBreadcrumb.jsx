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
 * Props
 *   currentProject  — { id, name } | null   (null = we're on the Dashboard)
 *   accent          — module accent color (New-project highlight + active crumb)
 *   onDashboard     — () => void            (also the logo's secondary route)
 *   onSelectProject — (id, name) => void
 *   onNewProject    — () => void
 *   onRenameProject — (id, newName) => void  (B439; optional — uncontrolled falls back to the store)
 *   onDeleteProject — (id) => void           (B439; optional — uncontrolled falls back to the store)
 *   saveState       — "synced"|"saving"|"offline"|"error"|"local"|null  (current project)
 *
 * Per-row rename/delete (B439): every project row carries a hover-revealed kebab (⋯) and a
 * right-click menu (both open the SAME menu — right-click is invisible and dead on touch) with
 * Rename (edits the row label in place) and Delete (a confirm step before acting). In controlled
 * mode (e.g. the Schedule module) the workspace supplies onRenameProject/onDeleteProject to drive
 * its own store over the bridge; uncontrolled (Site Planner / Markup) falls back to the site store.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AnchoredMenu from "./AnchoredMenu.jsx";
import ContextMenu from "./ContextMenu.jsx";
import { NO_AUTOFILL } from "./noAutofill.js";
import {
  listProjects, filterProjects, relTime, warmProjectsIfEmpty,
  renameProject as storeRename, deleteProject as storeDelete,
  listDeletedProjects, restoreDeletedProject, purgeDeletedProject, purgeExpiredDeletedProjects,
  DELETED_RETENTION_DAYS, activeUid,
} from "../projects/projects.js";
import { resolveCurrentName } from "../projects/projectModel.js";

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

// Per-row manage menu (B439) — Rename / Delete, rendered as its own portal layer ABOVE the
// dropdown's click-away backdrop so a click inside it never closes the parent dropdown.
const menuItem = (extra) => ({
  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
  padding: "7px 9px", borderRadius: 6, border: "none", background: "transparent",
  cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, color: "var(--text-primary)", ...extra,
});
const btnSm = {
  cursor: "pointer", border: "none", borderRadius: 6, padding: "5px 11px",
  fontFamily: "inherit", fontSize: 12, fontWeight: 700,
};

/* The ONE inline rename editor, used by BOTH the per-row menu (B439) and the crumb-level
 * "Rename “…”" row (NEW-4). Module scope, never inside a render body — an inner-defined component
 * is a new type every render, which React remounts, which would drop focus mid-rename. */
function RenameInput({ value, onChange, onCommit, onCancel, label, testId, style }) {
  return (
    <input
      {...NO_AUTOFILL}
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onCommit(); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
      }}
      onBlur={onCommit}
      aria-label={label}
      data-testid={testId}
      style={{
        display: "block", minWidth: 0, padding: "5px 7px", borderRadius: 6, outline: "none",
        fontFamily: "inherit", fontSize: 12.5, color: "var(--text-primary)", background: "var(--surface-page)",
        ...style,
      }}
    />
  );
}

export default function ProjectBreadcrumb({
  currentProject,
  accent = "var(--accent-site-text)", // foreground text token (AA), not the fill (B341)
  onDashboard,
  onSelectProject,
  onNewProject,
  onRenameProject,
  onDeleteProject,
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
  // Optional trailing crumb rendered right after the project crumb, with the SAME "/"
  // separator as the crumbs above it. The Site Planner passes its plan switcher here so the
  // project name stays in exactly one place and the plan sits beside it: Map / Project / Plan.
  planSlot = null,
}) {
  const controlled = Array.isArray(controlledProjects);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [internalProjects, setInternalProjects] = useState([]);
  const [warming, setWarming] = useState(false); // B475/NEW-2 — a cloud project-cache warm is in flight (cold signed-in tab)
  // Single data-entry guard (B380): drop any falsy entry before it reaches a `p.id` /
  // `p.name` read below — so a controlled caller (e.g. the Schedule module bridging its
  // embedded app's project list) that hasn't fully resolved its data can never trip a
  // "Cannot read properties of undefined" crash in this shared header.
  const projects = (controlled ? controlledProjects : internalProjects).filter(Boolean);
  const [hoverRow, setHoverRow] = useState(null);
  const [toast, setToast] = useState(null); // transient "saved on device" notice (B193)
  const [menuFor, setMenuFor] = useState(null); // {id, name, x, y, confirm} — per-row manage menu (B439)
  const [editingId, setEditingId] = useState(null); // project id being renamed inline (B439)
  const [editingWhere, setEditingWhere] = useState("row"); // WHICH editor owns it — "row" | "crumb" (NEW-4)
  const [editVal, setEditVal] = useState("");
  // Recently deleted (NEW-1) — the restore bin. Deleting a project soft-deletes it, so the plans
  // AND their elements survive and a restore returns the project whole.
  const [deleted, setDeleted] = useState([]);       // [{ id, name, ids, deletedAt }]
  const [binOpen, setBinOpen] = useState(false);
  const [binBusy, setBinBusy] = useState(null);     // group id of an in-flight restore/purge
  const [purgeFor, setPurgeFor] = useState(null);   // group id awaiting "delete forever" confirmation
  const anchorRef = useRef(null);
  const toastTimer = useRef(null);

  // Rename/Delete are available when the workspace wired the props (controlled, e.g. Schedule) OR
  // when we're uncontrolled and can drive the site store directly (Site Planner / Markup). B439.
  const canRename = !!onRenameProject || !controlled;
  const canDelete = !!onDeleteProject || !controlled;
  const canManage = canRename || canDelete;

  const refresh = () => { if (!controlled) setInternalProjects(listProjects()); };
  // B475 — warm the signed-in on-device project cache (empty on a cold tab that went straight to Markup,
  // since it only fills after a Site-Planner cloud pull), then re-read. `warming` drives a "Loading
  // projects…" line so the dropdown never shows a misleading "No projects yet" mid-pull. No-ops fast when
  // logged out or already warm. NEW-2 fix: the on-MOUNT attempt usually no-ops on a cold tab because auth
  // hasn't resolved yet (isCloudActive() false) and it never retried — so we ALSO warm on OPEN, by which
  // point auth has settled, which is exactly when the user clicks the switcher and saw it empty.
  const warmThenRefresh = () => {
    if (controlled) return;
    setWarming(true);
    warmProjectsIfEmpty().then((warmed) => { if (warmed) refresh(); }).finally(() => setWarming(false));
  };
  // Keep the (uncontrolled) list fresh: on mount, whenever the dropdown opens, and when another tab
  // changes the site store. Controlled mode skips this entirely — the workspace pushes updates via the prop.
  useEffect(() => {
    if (controlled) return;
    refresh();
    warmThenRefresh();
    const onStorage = (e) => { if (!e.key || e.key.startsWith("planarfit:sites")) refresh(); };
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("storage", onStorage); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled]);
  // Recently deleted (NEW-1): read the bin when the dropdown opens, and take the lazy 30-day purge
  // pass at the same time (anything past retention gets the real DELETE then — the site_elements
  // cascade is correct at that point). Signed-out / pre-migration DBs report unsupported and the
  // section simply doesn't render. Never throws into the dropdown.
  const refreshBin = () => {
    if (controlled) return;
    listDeletedProjects()
      .then((r) => { if (r && r.ok && r.supported) setDeleted(r.projects || []); else setDeleted([]); })
      .catch(() => setDeleted([]));
    purgeExpiredDeletedProjects()
      .then((r) => {
        if (r && r.purged > 0) listDeletedProjects().then((r2) => { if (r2 && r2.ok) setDeleted(r2.projects || []); }).catch(() => {});
        if (r && r.failed > 0) flashToast("Some expired items in Recently deleted couldn't be cleared — they'll be retried next time this list opens.");
      })
      .catch(() => {});
  };
  useEffect(() => {
    if (open) { refresh(); warmThenRefresh(); refreshBin(); setQ(""); }
    else { setMenuFor(null); setEditingId(null); setBinOpen(false); setPurgeFor(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Surface (don't block) an at-risk save when leaving the current project (B193).
  const flagIfAtRisk = () => {
    if (!atRisk(saveState)) return;
    clearTimeout(toastTimer.current);
    setToast("Your latest changes are saved on this device. The cloud is unreachable — they'll sync the next time you make a change or close this tab.");
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  const goDashboard = () => { setOpen(false); flagIfAtRisk(); onDashboard?.(); };
  const pickProject = (id, name) => {
    setOpen(false);
    if (id !== currentProject?.id) flagIfAtRisk();
    onSelectProject?.(id, name);
  };
  const newProject = () => { setOpen(false); flagIfAtRisk(); onNewProject?.(); };

  // A same-tab store write does NOT fire the native 'storage' event, so after an uncontrolled
  // rename/delete we nudge the app's existing planarfit:sites listeners (SitePlannerApp's site/
  // map list + this breadcrumb) to refresh — so the change shows on EVERY surface immediately,
  // not just on reload (B439, "update both surfaces"). Cross-tab already works for free.
  const notifyStoreChange = () => {
    try { window.dispatchEvent(new StorageEvent("storage", { key: "planarfit:sites:v1" })); } catch (_) {}
  };

  // Transient toast helper, reused for an honest delete-failure surface (B439).
  const flashToast = (msg, ms = 7000) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  };

  // Open the per-row manage menu (B439) — from a right-click (at the cursor) or the kebab
  // (just under the button). preventDefault stops the browser's native context menu; the menu
  // is its own portal above the dropdown's backdrop, so opening it never closes the dropdown.
  const openManageMenu = (e, p) => {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX || r.left;
    const y = (e.clientY || r.bottom) + 2;
    setMenuFor({ id: p.id, name: p.name, x, y, confirm: false });
  };
  /* ⛔ `editingWhere` is NOT redundant with `editingId` — one identity, two editors is a trap.
   * The SAME project id addresses two inline editors: its row in the list, and (NEW-4) the crumb-
   * level "Rename “…”" row for the open project. Keyed on `editingId` alone, clicking either one
   * mounted BOTH, each with `autoFocus`; the second to mount stole focus from the first, whose
   * `onBlur` then committed and closed the editor in the same frame. It looked like the rename
   * simply refused to open, and only in the planner (where the crumb-level editor exists at all).
   * So the surface is part of the key, and exactly one editor is ever live. */
  const startRename = (p, where = "row") => { setMenuFor(null); setEditingWhere(where); setEditingId(p.id); setEditVal(p.name || ""); };
  const commitRename = (id) => {
    const v = (editVal || "").trim();
    setEditingId(null);
    if (!v) return; // reject empty/whitespace-only — keep the prior name
    // NEW-2 — a rename that didn't reach the cloud must SAY so. Both branches now return the
    // store's promise, so a failure surfaces as a toast here instead of the old silent no-op that
    // only showed up later as the name having reverted. (The Site Planner also raises its own
    // header banner; a duplicate line in the dropdown is cheap next to a silent revert.)
    const done = onRenameProject ? onRenameProject(id, v) : storeRename(id, v);
    Promise.resolve(done).then((res) => {
      if (res && res.ok === false) flashToast(res.error || `“${v}” is saved on this device but couldn't be saved to the cloud — it may come back under its old name when you reload.`);
      if (!controlled) { refresh(); notifyStoreChange(); }
    }).catch(() => {});
    // Reflect the new name immediately. Uncontrolled mode owns the local `internalProjects`
    // list, and a same-tab store write does NOT fire the native 'storage' event — so without an
    // explicit refresh the just-edited row (and every other planarfit:sites surface) keeps the
    // OLD name and the rename reads as if it reverted. This must run for BOTH branches: the Site
    // Planner supplies onRenameProject yet is still UNcontrolled, and the old code only refreshed
    // in the bare `else`, so that path never updated. Controlled mode (Schedule) gets its list
    // pushed back through the bridge prop, so skip it there. (rename-revert)
    if (!controlled) { refresh(); notifyStoreChange(); }
  };
  /* ---- WHAT ELSE IS FILED HERE (NEW-3) ---------------------------------------------------
   *
   * ⛔ DELETING A PROJECT USED TO ORPHAN ITS NOTES IN SILENCE. The note-delete confirmation
   * already does this well — it says "Delete 2?" and then "Deleted DEV COORDINATION and its
   * 2 pages. It is in the bin for 30 days." — and project deletion said nothing at all, so
   * notes filed to a deleted pursuit simply reappeared later under a "from a project you
   * deleted" heading, which is where the owner found two of them a week afterwards. This is
   * that same honesty, one level up.
   *
   * ⛔ THE NOTES MODULE IS REACHED BY A **DYNAMIC** IMPORT AND FOR A HARD REASON. This
   * breadcrumb is chrome on every route; a static import would hoist the notes storage tier
   * into the chunk every route downloads and breach the bundle budgets (the same rule that
   * keeps the storage panel off the header). Loading it when the menu opens costs nothing
   * until somebody actually goes to delete a project. A failure to load is NOT fatal and is
   * NOT silent either: the count reads as unknown and the confirmation says so, rather than
   * claiming a confident zero. */
  const [noteCensus, setNoteCensus] = useState(null);   // { state, noteCount, pageCount } | null
  useEffect(() => {
    if (!menuFor?.confirm) { setNoteCensus(null); return undefined; }
    let live = true;
    setNoteCensus({ state: "loading" });
    (async () => {
      try {
        const notes = await import("../../workspaces/notes/lib/notesProjectLink.js");
        const c = notes.projectNotes(activeUid(), menuFor.id);
        if (live) setNoteCensus(c.unknown ? { state: "failed" } : { state: "ready", ...c });
      } catch (_) {
        if (live) setNoteCensus({ state: "failed" });
      }
    })();
    return () => { live = false; };
  }, [menuFor?.confirm, menuFor?.id]);

  const doDelete = (id, { moveNotes = false } = {}) => {
    const wasCurrent = id === currentProject?.id;
    setMenuFor(null);
    /* Move FIRST, delete second. The other order leaves a window in which the project is
     * gone and its notes still point at it — which is precisely the orphan being avoided. */
    if (moveNotes) {
      import("../../workspaces/notes/lib/notesProjectLink.js")
        .then((notes) => {
          const r = notes.moveNotesBetweenProjects(activeUid(), id, null);
          if (!r.ok) flashToast(r.error || "Those notes couldn't be moved, so they are still filed under the deleted project.");
          else if (r.moved) flashToast(`${r.moved === 1 ? "1 note" : `${r.moved} notes`} moved to “Not in a project”.`, 5000);
        })
        .catch(() => flashToast("Those notes couldn't be moved, so they are still filed under the deleted project."));
    }
    if (onDeleteProject) {
      onDeleteProject(id); // controlled (Schedule) — the bridge deletes + routes home in the embedded app
      return;
    }
    // Uncontrolled (site store): optimistic local removal + an HONEST cloud-failure surface (B439) —
    // a silent zero-row delete would otherwise reappear on reload claiming it was "deleted".
    Promise.resolve(storeDelete(id)).then((res) => {
      if (res && res.ok === false) flashToast(res.error || "That project couldn't be fully deleted — it may reappear when you reload.");
      refresh();
      notifyStoreChange();
    });
    refresh();
    notifyStoreChange();
    if (wasCurrent) onDashboard?.(); // the open project no longer exists → go to all-projects
  };

  // Restore a binned project (NEW-1). Because the delete was soft, no site_elements cascade ever
  // fired — the project comes back WHOLE, not as the gutted empty shell the old resurrection bug
  // produced. restoreDeletedProject re-pulls, so the list/map reflect it immediately.
  const doRestore = (p) => {
    setBinBusy(p.id);
    Promise.resolve(restoreDeletedProject(p.ids)).then((res) => {
      if (!res || res.ok === false) flashToast((res && res.error) || `“${p.name}” couldn't be restored — check your connection and try again.`);
      refresh(); refreshBin(); notifyStoreChange();
    }).catch(() => flashToast(`“${p.name}” couldn't be restored — check your connection and try again.`))
      .finally(() => setBinBusy(null));
  };
  // "Delete forever" — the only user-facing HARD delete, and the only path that destroys elements.
  const doPurge = (p) => {
    setBinBusy(p.id); setPurgeFor(null);
    Promise.resolve(purgeDeletedProject(p.ids)).then((res) => {
      if (!res || res.ok === false) flashToast((res && res.error) || `“${p.name}” couldn't be permanently deleted — check your connection and try again.`);
      refreshBin();
    }).catch(() => flashToast(`“${p.name}” couldn't be permanently deleted — check your connection and try again.`))
      .finally(() => setBinBusy(null));
  };

  const onDash = !currentProject; // we're at the all-projects view
  const filtered = filterProjects(projects, q);
  // Show the current project's LIVE name (auto-update-name): after an inline rename here — or a
  // rename in another tab — the freshly-refreshed `projects` list carries the new name even when
  // the parent's `currentProject` prop is still the pre-rename value (Review/Library derive it
  // from the route id, not the store). Falls back to the prop when the list can't resolve it.
  const currentName = resolveCurrentName(currentProject, projects);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, flex: "none" }}>
      {/* Dashboard crumb (B192) — literal text, always visible, primary route home */}
      <button
        onClick={goDashboard}
        title={`All projects: ${homeLabel}`}
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
        data-testid="project-crumb"
        onClick={() => setOpen((o) => !o)}
        title={cross ? "Browsing all projects" : currentProject ? "Switch project" : "Choose a project"}
        aria-haspopup="menu"
        aria-expanded={open}
        style={crumbBtn({ color: (currentProject || cross) ? INK : MUTED, maxWidth: 240, minWidth: 0 })}
      >
        {currentProject && !cross && (
          <span title="Private: only you can see this project. Sharing is always a deliberate act."
            style={{ flex: "none", color: MUTED, display: "flex", alignItems: "center" }}>
            <LockIcon />
          </span>
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cross ? "All projects" : (currentName || "Select a project")}
        </span>
        {atRisk(saveState) && (
          <span title="Saved on this device: the cloud is unreachable" aria-hidden
            style={{ flex: "none", color: "#f59e0b", fontSize: 11 }}>⚠</span>
        )}
        <span style={{ opacity: 0.6, fontSize: 11, flex: "none" }}>▾</span>
      </button>

      {/* Trailing crumb (e.g. the Site Planner's plan switcher). Same "/" separator + crumb
          geometry as the Map/project crumbs, so the three segments read as one breadcrumb. */}
      {planSlot && (
        <>
          <span style={{ color: MUTED, opacity: 0.55, flex: "none", fontSize: 13, padding: "0 1px" }}>/</span>
          {planSlot}
        </>
      )}

      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef}
        placement="below-left" width={304} gap={8} panelStyle={panel}>
        {/* Search */}
        <input
          {...NO_AUTOFILL}
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
            borderRadius: 7, background: "var(--surface-page)", border: "1px solid var(--warn-text)", color: "var(--warn-text)", fontSize: 11.5, lineHeight: 1.4 }}>
            {/* B525: token-themed warn row (was a hardcoded light-amber box that became a light slab in dark mode) */}
            <span aria-hidden>⚠</span>
            <span>This project's latest changes are saved on this device — the cloud is unreachable. Switching is safe; they'll sync next time you edit or close this tab.</span>
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

        {/* NEW-4 — rename THIS project, where the owner actually looks for it. Until now the only
            rename was a right-click (or a hover-revealed kebab) on a row in a list — invisible, and
            dead on touch. The crumb the user just opened is the control that NAMES the project they
            are looking at, so renaming it belongs here. It reuses the SAME inline editor and the
            SAME commitRename write path as the per-row menu — one rename implementation, not two. */}
        {canRename && currentProject?.id && (
          <>
            <div style={divider} />
            {editingId === currentProject.id && editingWhere === "crumb" ? (
              <RenameInput
                value={editVal}
                onChange={setEditVal}
                onCommit={() => commitRename(currentProject.id)}
                onCancel={() => setEditingId(null)}
                label={`Rename ${currentName}`}
                testId="project-rename-current-input"
                style={{ width: "100%", margin: "2px 0", padding: "6px 8px", border: `1px solid ${accent}`, borderRadius: 7 }}
              />
            ) : (
              <button
                data-testid="project-rename-current"
                onClick={() => startRename({ id: currentProject.id, name: currentName }, "crumb")}
                onMouseEnter={() => setHoverRow("__rename")}
                onMouseLeave={() => setHoverRow(null)}
                style={row({ background: hoverRow === "__rename" ? "var(--hover-ghost)" : "transparent" })}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span aria-hidden style={{ fontSize: 12, opacity: 0.8 }}>✎</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Rename “{currentName}”
                  </span>
                </span>
              </button>
            )}
          </>
        )}

        <div style={divider} />

        {/* Recent projects — newest-edited first, relative timestamps */}
        <div style={{ maxHeight: 280, overflowY: "auto", margin: "0 -2px", padding: "0 2px" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "10px 9px", fontSize: 12, color: "var(--text-tertiary)" }}>
              {q ? "No matching projects." : (warming ? "Loading projects…" : "No projects yet — start one below.")}
            </div>
          ) : (
            filtered.map((p) => {
              const cur = p.id === currentProject?.id;
              const editing = editingId === p.id && editingWhere === "row";
              const active = hoverRow === p.id || menuFor?.id === p.id; // row highlighted while its menu is open
              return (
                <div
                  key={p.id}
                  data-testid={`project-row-${p.id}`}
                  onContextMenu={canManage ? (e) => openManageMenu(e, p) : undefined}
                  onMouseEnter={() => setHoverRow(p.id)}
                  onMouseLeave={() => setHoverRow(null)}
                  style={row({ padding: 0, background: active ? "var(--hover-ghost)" : (cur ? "var(--hover-menu)" : "transparent") })}
                >
                  {editing ? (
                    <RenameInput
                      value={editVal}
                      onChange={setEditVal}
                      onCommit={() => commitRename(p.id)}
                      onCancel={() => setEditingId(null)}
                      label={`Rename ${p.name}`}
                      style={{ flex: 1, margin: "2px 4px", border: "1px solid var(--accent-site-text, #2563eb)" }}
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => pickProject(p.id, p.name)}
                        title={p.name}
                        style={row({ flex: 1, minWidth: 0, background: "transparent" })}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                          {p.name}
                        </span>
                        {/* Cross-module connectedness (schema v9): a project that has a linked
                            schedule shows a small calendar chip, so the connection is visible at a
                            glance in the switcher. Site is implicit (every project IS a site). */}
                        {p.scheduleProjectId != null && (
                          <span
                            title="Has a linked schedule"
                            aria-label="Has a linked schedule"
                            style={{ flex: "none", fontSize: 10.5, opacity: 0.85 }}
                          >📅</span>
                        )}
                      </button>
                      <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, paddingRight: 7 }}>
                        {canManage && active ? (
                          <button
                            onClick={(e) => openManageMenu(e, p)}
                            title="Rename or delete"
                            aria-label={`Manage ${p.name}`}
                            data-testid={`project-kebab-${p.id}`}
                            style={{
                              flex: "none", cursor: "pointer", border: "none", background: "transparent",
                              color: "var(--text-secondary)", borderRadius: 5, padding: "0 5px",
                              fontSize: 16, lineHeight: 1, fontFamily: "inherit",
                            }}
                          >⋯</button>
                        ) : cur ? (
                          <span style={{ color: accent, fontSize: 10.5, fontWeight: 700 }}>current</span>
                        ) : (
                          <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{relTime(p.updatedAt)}</span>
                        )}
                      </span>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Recently deleted (NEW-1) — the restore bin. Only rendered when the account actually has
            binned projects (signed out, or a DB without db/sites_soft_delete.sql, reports none). */}
        {!controlled && deleted.length > 0 && (
          <>
            <div style={divider} />
            <button
              data-testid="project-bin-toggle"
              onClick={() => { setBinOpen((v) => !v); setPurgeFor(null); }}
              onMouseEnter={() => setHoverRow("__bin")}
              onMouseLeave={() => setHoverRow(null)}
              aria-expanded={binOpen}
              style={row({ background: hoverRow === "__bin" ? "var(--hover-ghost)" : "transparent", color: "var(--text-secondary)", fontWeight: 700 })}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>{binOpen ? "▾" : "▸"}</span>
                ↺ Recently deleted · {deleted.length}
              </span>
            </button>
            {binOpen && (
              <div data-testid="project-bin" style={{ maxHeight: 190, overflowY: "auto" }}>
                <div style={{ padding: "2px 11px 7px", fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.45 }}>
                  Restorable for {DELETED_RETENTION_DAYS} days — everything in the project comes back with it.
                </div>
                {deleted.map((p) => (
                  <div key={p.id} style={row({ padding: "4px 7px 4px 11px", gap: 6, background: "transparent" })}>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: "var(--text-secondary)" }} title={p.name}>
                      {p.name}
                    </span>
                    <span style={{ flex: "none", color: "var(--text-tertiary)", fontSize: 11 }}>{relTime(p.deletedAt)}</span>
                    {purgeFor === p.id ? (
                      <>
                        <button
                          data-testid={`project-purge-confirm-${p.id}`}
                          disabled={binBusy === p.id}
                          onClick={() => doPurge(p)}
                          style={{ ...btnSm, flex: "none", padding: "3px 8px", fontSize: 11, background: "var(--danger, #dc2626)", color: "#fff" }}
                        >Delete forever</button>
                        <button
                          onClick={() => setPurgeFor(null)}
                          style={{ ...btnSm, flex: "none", padding: "3px 8px", fontSize: 11, background: "var(--hover-menu)", color: "var(--text-primary)" }}
                        >Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          data-testid={`project-restore-${p.id}`}
                          disabled={binBusy === p.id}
                          onClick={() => doRestore(p)}
                          title={`Restore ${p.name}`}
                          style={{ ...btnSm, flex: "none", padding: "3px 8px", fontSize: 11, background: "var(--hover-menu)", color: "var(--text-primary)" }}
                        >{binBusy === p.id ? "Working…" : "Restore"}</button>
                        <button
                          onClick={() => setPurgeFor(p.id)}
                          title={`Permanently delete ${p.name}`}
                          aria-label={`Permanently delete ${p.name}`}
                          style={{ flex: "none", border: "none", background: "transparent", color: "var(--danger-text, #dc2626)", cursor: "pointer", fontSize: 14, padding: "0 4px", fontFamily: "inherit" }}
                        >×</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

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

      {/* Per-row manage menu (B439) — Rename / Delete, a SECOND portal layer above the dropdown's
          click-away backdrop, so clicking inside it never closes the parent dropdown. */}
      {menuFor && (
        <ContextMenu
          x={menuFor.x} y={menuFor.y} onClose={() => setMenuFor(null)}
          minWidth={180} zIndex={5000}
          className="" role="menu" ariaLabel="Project actions" /* B557 */
          testId="project-manage-menu"
          panelStyle={{ ...panel, padding: 5 }}
        >
          <>
            {!menuFor.confirm ? (
              <>
                {canRename && (
                  <button
                    data-testid="project-rename"
                    role="menuitem"
                    onClick={() => startRename(menuFor)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-ghost)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    style={menuItem()}
                  >
                    <span aria-hidden style={{ fontSize: 12, opacity: 0.8 }}>✎</span> Rename
                  </button>
                )}
                {canDelete && (
                  <button
                    data-testid="project-delete"
                    role="menuitem"
                    onClick={() => setMenuFor((m) => ({ ...m, confirm: true }))}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-ghost)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    style={menuItem({ color: "var(--danger, #dc2626)" })}
                  >
                    <span aria-hidden style={{ fontSize: 12 }}>🗑</span> Delete
                  </button>
                )}
              </>
            ) : (
              <div style={{ padding: "5px 7px" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45, marginBottom: 9 }}>
                  {/* NEW-1 — the delete is now recoverable, so the confirm says so instead of the
                      old "can't be undone" (which is no longer true, and made the stakes read higher
                      than they are). Permanent destruction lives behind "Delete forever" in the bin. */}
                  Delete <strong style={{ color: "var(--text-primary)" }}>{menuFor.name}</strong>? It moves to Recently deleted — you can restore it for {DELETED_RETENTION_DAYS} days.
                  {/* NEW-3 — say what ELSE is filed here, in as many words, before it goes.
                      Absent when there is nothing to say (PANEL-BREVITY); an unknown count is
                      NAMED as unknown, never rendered as a confident zero. */}
                  {noteCensus?.state === "ready" && noteCensus.noteCount > 0 ? (
                    <div data-testid="project-delete-notes" data-note-count={noteCensus.noteCount} style={{ marginTop: 7, color: "var(--warn-text)", fontWeight: 600 }}>
                      {noteCensus.noteCount === 1 ? "1 note is" : `${noteCensus.noteCount} notes are`} filed here
                      {noteCensus.pageCount > noteCensus.noteCount ? ` (${noteCensus.pageCount} pages)` : ""}. They stay in Notes either way.
                    </div>
                  ) : null}
                  {noteCensus?.state === "failed" ? (
                    <div data-testid="project-delete-notes-unknown" style={{ marginTop: 7, color: "var(--warn-text)", fontWeight: 600 }}>
                      Couldn’t check whether any notes are filed here.
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button
                    onClick={() => setMenuFor((m) => ({ ...m, confirm: false }))}
                    style={{ ...btnSm, background: "var(--hover-menu)", color: "var(--text-primary)" }}
                  >Cancel</button>
                  {noteCensus?.state === "ready" && noteCensus.noteCount > 0 ? (
                    <button
                      data-testid="project-delete-move-notes"
                      onClick={() => doDelete(menuFor.id, { moveNotes: true })}
                      style={{ ...btnSm, background: "var(--hover-menu)", color: "var(--text-primary)" }}
                    >Move notes out &amp; delete</button>
                  ) : null}
                  <button
                    data-testid="project-delete-confirm"
                    onClick={() => doDelete(menuFor.id)}
                    style={{ ...btnSm, background: "var(--danger, #dc2626)", color: "#fff" }}
                  >Delete</button>
                </div>
              </div>
            )}
          </>
        </ContextMenu>
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
