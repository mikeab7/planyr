/* ProjectBreadcrumb — the Row 1 left-anchored breadcrumb + project switcher.
 *
 * Renders `▦ Dashboard  /  <Project name> ▾` immediately right of the logo, in every
 * workspace (the header component is shared, so the breadcrumb is identical across
 * Site / Schedule / Markup). The "Dashboard" crumb (B192) is always-visible literal
 * text routing to the all-projects view; the project crumb (B191) opens a portal
 * dropdown (search · recent projects newest-first · Recently deleted · New project).
 * ⛔ That dropdown deliberately carries NO "All projects" row and NO crumb-level rename
 * (NEW-1 / NEW-2) — both duplicated a control sitting inches away. See the note at the
 * top of the dropdown body before re-adding either.
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
 *   onDuplicateProject — (id) => void        (NEW-2/B1080546; optional — no uncontrolled fallback,
 *                                              only offered when a caller (Schedule) wires it)
 *   saveState       — "synced"|"saving"|"offline"|"error"|"local"|null  (current project)
 *
 * Per-row rename/delete (B439): every project row carries an ALWAYS-VISIBLE kebab (NEW-2 — it was
 * hover-revealed, which left touch and keyboard users with no rename at all) and a
 * right-click menu (both open the SAME menu — right-click is invisible and dead on touch) with
 * Rename (edits the row label in place) and Delete (a confirm step before acting). In controlled
 * mode (e.g. the Schedule module) the workspace supplies onRenameProject/onDeleteProject to drive
 * its own store over the bridge; uncontrolled (Site Planner / Markup) falls back to the site store.
 *
 * ⛔ B1358128 — a row's own `id` is NOT always a controlled caller's own id. `unionProjectLists`
 * (projectModel.js) shows a site with exactly one linked schedule (or none at all) using the SITE's
 * registry id, standing in for the schedule — a controlled caller's bridge (Schedule module's
 * `onDeleteProject`/`onRenameProject`/`onDuplicateProject`) only understands ITS OWN ids and silently
 * no-ops on anything else (see Scheduler.jsx's `selectSchedule`, which already had to solve this same
 * resolution for picking a project — this extends the identical fix to manage actions, which never got
 * it). `resolveControlledId` below does that resolution before calling out to the bridge; when a row
 * has no controlled entity behind it at all (a project with no linked schedule), rename/delete fall
 * back to the plain site-store action instead of no-op'ing — duplicate has no such fallback (no
 * uncontrolled implementation exists) and surfaces a toast instead of doing nothing.
 *
 * ⛔ B1358128 — AND THE BRIDGE IS NOT THE WHOLE ACTION FOR A REAL PROJECT. Resolving the id was
 * necessary and not sufficient: a resolved row was handed to the bridge and the function RETURNED,
 * so in the Schedule module "Delete project" deleted the SCHEDULE and left `public.sites` untouched
 * — the project was still there everywhere else and came back on reload ("i cant delete projects
 * from the schedule module, so why does it even offer that ability"). Rename had the mirror defect:
 * `unionProjectLists` displays the REGISTRY copy of a linked project, so renaming only the schedule
 * left the visible row unchanged. The rule now: a row the site registry knows is a PROJECT, and is
 * renamed/deleted as one — with the linked schedule carried along; only a schedule-only
 * pseudo-project (Pursuits / Operations, which no `sites` row describes) is bridge-only.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RADIUS } from "./radius.js";
import FloatingNotice from "./FloatingNotice.jsx";
import AnchoredMenu from "./AnchoredMenu.jsx";
import ContextMenu from "./ContextMenu.jsx";
import { NO_AUTOFILL } from "./noAutofill.js";
import { crumbDashboardTitle } from "./dashboardNav.js";
import {
  listProjects, filterProjects, relTime, warmProjectsIfEmpty, reconcileProjects,
  renameProject as storeRename, deleteProject as storeDelete,
  listDeletedProjects, restoreDeletedProject, purgeDeletedProject, purgeExpiredDeletedProjects,
  DELETED_RETENTION_DAYS, activeUid,
} from "../projects/projects.js";
import { resolveCurrentName, withCurrentProject, unionProjectLists, resolveControlledId as resolveControlledIdPure, hasSavedProjectRecord, applyFrozenOrder } from "../projects/projectModel.js";
import { crumbNeedsCompact } from "./breadcrumbFit.js";

// Crumbs sit on the chrome bar, which now themes WITH the app (B318) — so these are
// chrome tokens, not the retired warm-dark hexes (white-on-light was the B341 bug).
const MUTED = "var(--chrome-muted)";
const LINE = "var(--chrome-divider)";
const INK = "var(--chrome-text)";

// NEW-2 (B915536) — a LITERAL duplicate of designTokens.js's FONT_SIZE.control, not an import:
// this file is in the shared ENTRY chunk (AppHeader.jsx imports it directly), and importing
// designTokens.js for the sake of one small object measurably ate the route budget —
// bundle.notesRouteJsBytes went from 0.5 KB to 0.2 KB of headroom. Same reasoning as
// controls.jsx's own RADIUS/FONT/PAD literal-duplicate note. Keep in sync by hand.
const CHROME_FONT_CONTROL = 12; // design-exempt: literal duplicate of FONT_SIZE.control — see the comment above

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

// ORG SCOPE (NEW-1) — a small building glyph for the switcher's "Organization" row, drawn in
// this file's own idiom (stroke, currentColor) rather than a text/emoji glyph — same reasoning
// as PencilIcon/TrashIcon/KebabIcon below.
const OrgIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <rect x="4" y="3" width="10" height="18" rx="1" />
    <rect x="14" y="9" width="6" height="12" rx="1" />
    <line x1="7.5" y1="7" x2="7.5" y2="7.01" />
    <line x1="10.5" y1="7" x2="10.5" y2="7.01" />
    <line x1="7.5" y1="11" x2="7.5" y2="11.01" />
    <line x1="10.5" y1="11" x2="10.5" y2="11.01" />
    <line x1="7.5" y1="15" x2="7.5" y2="15.01" />
    <line x1="10.5" y1="15" x2="10.5" y2="15.01" />
  </svg>
);

/* NEW-2 — the floor a crumb may be squeezed to. Below this the ▾ caret and the icons start to
 * crowd out the name entirely, and a chip too small to aim at is a different way to lose the same
 * click the owner lost to the jurisdiction pill. */
export const CRUMB_MIN_W = 92;
/* NEW-3 — Rename / Delete get REAL icons, in this file's own idiom (stroke, currentColor, the
 * DashboardIcon shape above). What was there: a bare Unicode pencil `✎` and an emoji
 * wastebasket `🗑`. The owner's read — "they just look kinda like shit" — has a precise cause: `✎`
 * is a TEXT glyph, so it renders flat and monochrome in the UI font, while `🗑` resolves to a
 * full-COLOUR emoji from the OS font. Two items in one menu that don't belong to the same visual
 * family, both at the mercy of whatever font the platform picks, and the coloured one ignoring the
 * `--danger` red its own row is set in. Inheriting `currentColor` is the fix for that last part:
 * Delete's icon is now red because its row is red, rather than in spite of it. */
const PencilIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M4 20h4L20 8l-4-4L4 16z" />
    <path d="M14.5 5.5L18.5 9.5" />
  </svg>
);

// NEW-2/B1080546 — Duplicate, same drawn-icon idiom as Pencil/Trash above (stroke, currentColor).
const DuplicateIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
);

const TrashIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

// NEW-2 — the per-row manage affordance, now a drawn glyph rather than the `⋯` text character it
// was. Same reason as the pair above: a text ellipsis is at the mercy of the platform font, and this
// one sits beside real SVG icons in the same row.
const KebabIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" />
  </svg>
);

// NEW-4/B1343203 — the compact-crumb "more levels this way" marker, same drawn-icon idiom as
// every other glyph in this file (stroke/fill currentColor, never a text character): a text "…"
// or "⋯" is at the mercy of the platform font, which is exactly why this file already replaced
// its own per-row manage affordance (KebabIcon, above) and the pencil/wastebasket glyphs the same
// way. Horizontal, not vertical (KebabIcon's own shape), to read as "more of the TRAIL" rather
// than "more actions".
const CollapsedCrumbIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" />
  </svg>
);

const WarnIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block", marginTop: 1 }}>
    <path d="M12 4L2.5 20h19z" />
    <path d="M12 10v4.5M12 17.4v.1" />
  </svg>
);

// "This project has a linked schedule" (schema v9). Was a 📅 emoji — a colour glyph used as an icon
// in a row of monochrome text, which is the same defect as the wastebasket below it.
const CalendarIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <rect x="3.5" y="5" width="17" height="16" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

// B885137 (NEW-2) — header shrink, owner-approved (2026-08-30/31, "Headers — before / after"
// artboard). height 24→22 (--control-h-sm, matches the row's other 22-tall controls at the
// new density) + fontSize 12.5→11.5 (--font-md) — measured against the LIVE app first (not the
// artboard's assumed "today" baseline, which read 15px/13px vertical padding neither of which
// this component ever had; the real defect was only the wordmark exceeding --font-display, see
// AppHeader.jsx's own note). CRUMB_MIN_W is untouched — NAVIGATION WINS is a floor on
// character count, not on font size, and shrinking the font makes more of that floor's width
// actually show name rather than clip it.
// NEW-3 (design-drift merge) — borderRadius RADIUS.sm → RADIUS.md, independently of the density
// change above: this is a standalone chip sitting directly on the header bar (its rest state is
// transparent/borderless, but its hover/open fill is what makes the shape visible), the same
// category as the row-2 toolbar's File ▾ / dIcon / rbtn buttons — RADIUS.md per radius.js's own
// rule ("sm" is for a control nested inside another rounded surface, which this isn't).
// NEW-1 (B982400) — height 22→26, padding "0 8px"→"0 10px": converges onto the shared
// `SIZE.sm` bundle (controls.jsx) that every other dense row-1/row-2 chrome chip now targets,
// closing two of the seven signatures the item measured ("Map"/"Select a project" were their own
// 22px-tall family, distinct from everything beside them). Kept as a literal token nudge rather
// than swapping in a `Chip`/`MenuTrigger` component: this crumb's hover-color-swap, aria-current
// and warn-icon slot are all bespoke to the breadcrumb's own controlled-vs-uncontrolled
// project list, not a shape a shared primitive should own. Row 1 is 30px tall, so a 26-tall crumb
// still fits with no clipping (`alignItems:"center"` centers it, same as before).
// ⛔ NEW-2 (signature-budget convergence, B1038016) — height 26→30, padding "0 10px"→"0 12px":
// SIZE.sm was itself a DIFFERENT height family from the row's own MenuTrigger-built chips (the
// signed-out "Cloud off" trigger, `SIZE.md` = height 30 / padding "0 12px") sitting right beside
// it, and ui-inventory.mjs's own signature count still carried both as distinct shapes — a
// smaller version of the exact account-pill mismatch this whole design system exists to prevent.
// Bumping the crumb onto SIZE.md merges it with that trigger's signature outright (measured:
// still fits inside the 30px row with room to spare, `alignItems:"center"` keeps it centred) and,
// together with the plan-name chip's matching move (SitePlanner.jsx's `.dbtn` plan crumb), turns
// three previously-distinct chip families (crumb / plan-chip / cloud-off trigger) into one.
const crumbBtn = (extra) => ({
  display: "flex", alignItems: "center", gap: 5, flex: "none",
  height: 30, padding: "0 12px", borderRadius: RADIUS.md,
  border: "none", background: "transparent", cursor: "pointer",
  fontFamily: "inherit", fontSize: CHROME_FONT_CONTROL, fontWeight: 600, whiteSpace: "nowrap",
  ...extra,
});

const panel = {
  padding: 8, borderRadius: RADIUS.md, background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
  fontFamily: "system-ui, sans-serif",
};

const row = (extra) => ({
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  width: "100%", textAlign: "left", padding: "7px 9px", borderRadius: RADIUS.sm,
  border: "none", background: "transparent", cursor: "pointer",
  fontFamily: "inherit", fontSize: CHROME_FONT_CONTROL, color: "var(--text-primary)", ...extra,
});

const divider = { height: 1, background: "var(--border-default)", margin: "6px 4px" };

// Per-row manage menu (B439) — Rename / Delete, rendered as its own portal layer ABOVE the
// dropdown's click-away backdrop so a click inside it never closes the parent dropdown.
const menuItem = (extra) => ({
  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
  padding: "7px 9px", borderRadius: RADIUS.sm, border: "none", background: "transparent",
  cursor: "pointer", fontFamily: "inherit", fontSize: CHROME_FONT_CONTROL, color: "var(--text-primary)", ...extra,
});
const btnSm = {
  cursor: "pointer", border: "none", borderRadius: RADIUS.sm, padding: "5px 11px",
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
        display: "block", minWidth: 0, padding: "5px 7px", borderRadius: RADIUS.sm, outline: "none",
        fontFamily: "inherit", fontSize: CHROME_FONT_CONTROL, color: "var(--text-primary)", background: "var(--surface-page)",
        ...style,
      }}
    />
  );
}

export default function ProjectBreadcrumb({
  currentProject,
  accent = "var(--accent-site-text)", // foreground text token (AA), not the fill (B341)
  onDashboard,
  // B1128272 — optional override for this crumb's tooltip, used only where the crumb's
  // action genuinely differs from the wordmark's (Schedule). See dashboardNav.js.
  dashboardTitle,
  onSelectProject,
  onNewProject,
  onRenameProject,
  onDeleteProject,
  onDuplicateProject,
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
  // ORG SCOPE (NEW-1) — a third, real switcher destination alongside a project and the
  // Dashboard: true while standing in the Organization (never together with `cross` or a
  // real `currentProject`). `onSelectOrg`, when supplied, adds the entry to the dropdown; a
  // caller that omits it (Scheduler's bridged switcher) simply doesn't offer the row.
  org = false,
  onSelectOrg,
  // Optional trailing crumb rendered right after the project crumb, with the SAME "/"
  // separator as the crumbs above it. The Site Planner passes its plan switcher here so the
  // project name stays in exactly one place and the plan sits beside it: Map / Project / Plan.
  planSlot = null,
  // NEW-4 (B1343203) — phone width (`narrow`) and a ref to Row 1's own scrolling strip (`rowRef`,
  // AppHeader's), so this component can measure ITS OWN budget — how much of the row is visible
  // before it has to scroll — and collapse the MIDDLE crumb (this one, the project) to a compact
  // "…" affordance when the full trail would not fit. The FIRST (Dashboard) and LAST (`planSlot`,
  // when present) crumbs never collapse — only ever the one in between. Off-narrow, or with no
  // `planSlot` (this crumb IS the last one then), it never compacts.
  narrow = false,
  rowRef = null,
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
  // B854xxx/NEW-2 — a controlled caller (Scheduler) is UNIONED with the real, reconciled registry
  // list below, never shown its own bridged list alone — see unionProjectLists' header.
  /* NEW-2 — a snapshot of row ids taken the moment a rename STARTS, held until the dropdown
   * CLOSES, so a mid-edit recency resort can't reposition rows out from under an open editor
   * (see `applyFrozenOrder`'s own header in projectModel.js). `rowButtonRefs` +
   * `pendingRefocusIdRef` are the other half — after a commit, focus is moved to the RENAMED
   * row's own activate button (looked up by id, never by index), so a keystroke that lands
   * after the rename has somewhere correct and predictable to go instead of falling to
   * `document.body`. Declared before `projects` below, which reads `orderSnapshotRef` on every
   * render. */
  const orderSnapshotRef = useRef(null);
  const rowButtonRefs = useRef(new Map());
  const pendingRefocusIdRef = useRef(null);
  // NEW-2 — `applyFrozenOrder` holds the row order steady across an in-progress rename; it is a
  // pass-through the rest of the time.
  const projects = applyFrozenOrder(
    (controlled ? unionProjectLists(controlledProjects, internalProjects) : internalProjects).filter(Boolean),
    orderSnapshotRef.current,
  );
  const [hoverRow, setHoverRow] = useState(null);
  const [toast, setToast] = useState(null); // transient "saved on device" notice (B193)
  const [menuFor, setMenuFor] = useState(null); // {id, name, x, y, confirm} — per-row manage menu (B439)
  const [editingId, setEditingId] = useState(null); // project id being renamed inline (B439)
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
  // NEW-2/B1080546 — Duplicate has no uncontrolled fallback (only Schedule wires it so far), so
  // unlike Rename/Delete it's offered ONLY when the caller explicitly supplies the handler.
  const canDuplicate = !!onDuplicateProject;
  const canManage = canRename || canDelete || canDuplicate;

  // B881666 — `refresh` (and everything that calls it — the storage-event listener registered
  // once at mount, an in-flight warm/reconcile promise resolving later) must always reconcile
  // against the LATEST `currentProject`, never the one closed over when that caller was created.
  // The mount effect below registers its "storage" listener with deps `[controlled]` (a
  // per-instance constant, since a kept-alive workspace's ProjectBreadcrumb never remounts on a
  // later project switch) — so without this ref, that listener's `refresh()` call is permanently
  // bound to whatever `currentProject` was at FIRST mount. A synthetic `notifyProjectsChanged()`
  // storage event fired from ANYWHERE in the app (a rename, a warm, another tab) after the user
  // has since switched projects then re-derives `internalProjects` from a stale project, silently
  // clobbering whatever a later, correct `refresh()` (from opening the dropdown) had produced.
  const currentProjectRef = useRef(currentProject);
  useEffect(() => { currentProjectRef.current = currentProject; }, [currentProject]);

  // B853266/NEW-1 — the project the user is LITERALLY STANDING IN must never be missing from its
  // own switcher: the on-device site-list cache can lag the cloud (a device that missed a sync,
  // a diverged pull), and until reconcileProjects() below catches up this keeps the routed project
  // visible instead of it silently reading as though it doesn't exist. Union, never a swap — every
  // other cached project stays exactly as listProjects() reports it.
  // B854xxx/NEW-2 — this ALWAYS runs now, controlled or not: it is what feeds `internalProjects`,
  // which a controlled caller unions into its own bridged list above. Scheduler was the one route
  // where this whole data layer never ran at all (an early `if (controlled) return`), which is why
  // it alone showed a static, un-reconciled six-project list with no current marker or timestamps.
  //
  // ⛔ B881666 — `currentProject.id` is NOT always the site-GROUP id this registry is keyed by.
  // Scheduler's controlled `currentProject` is the routed site's LINKED SCHEDULE object once one
  // exists (`{id, name, linkedSiteId, linkedSiteName}`) — its `.id` is the schedule's OWN id
  // (a small integer-like string), a different namespace from the site-group ids `listProjects()`
  // returns. Comparing the schedule id against the group-id registry always missed, so this added
  // a SYNTHETIC entry keyed by the schedule id, marked "current" — sitting right next to the real
  // group-id entry for the SAME project (which the row-render's OWN, unrelated `p.id ===
  // currentProject.id` check does not mark current, since its id doesn't match either) — a
  // genuine duplicate: the reported "pinned current" row plus an ordinary timestamped row below
  // it. Resolving through `linkedSiteId` when present reconciles against the SAME identity space
  // the registry actually uses; every other caller (Site Planner, Library, Notes, Review) never
  // sets `linkedSiteId`, so this is a no-op for them.
  const refresh = () => {
    const cp = currentProjectRef.current;
    const registryTarget = cp && cp.linkedSiteId != null ? { id: cp.linkedSiteId, name: cp.linkedSiteName || cp.name } : cp;
    setInternalProjects(withCurrentProject(listProjects(), registryTarget));
  };
  // B475 — warm the signed-in on-device project cache (empty on a cold tab that went straight to Markup,
  // since it only fills after a Site-Planner cloud pull), then re-read. `warming` drives a "Loading
  // projects…" line so the dropdown never shows a misleading "No projects yet" mid-pull. No-ops fast when
  // logged out or already warm. NEW-2 fix: the on-MOUNT attempt usually no-ops on a cold tab because auth
  // hasn't resolved yet (isCloudActive() false) and it never retried — so we ALSO warm on OPEN, by which
  // point auth has settled, which is exactly when the user clicks the switcher and saw it empty.
  const warmThenRefresh = () => {
    setWarming(true);
    warmProjectsIfEmpty().then((warmed) => { if (warmed) refresh(); }).finally(() => setWarming(false));
  };
  // B853266/NEW-1 — warmThenRefresh above only ever pulls a genuinely EMPTY cache, so a cache
  // that already holds some projects but has silently diverged from the cloud never gets another
  // chance (the reported bug: Richfield/Silvestri/Woods Road are real, actively-worked projects
  // missing from a switcher that had plenty of OTHER entries, so the empty-only warm never fired
  // for them). reconcileProjects() always re-pulls when signed in; only run it on the deliberate
  // OPEN moment (never on mount, and throttled) so opening the switcher isn't a network hazard.
  const lastReconcileRef = useRef(0);
  const reconcileThenRefresh = () => {
    const now = Date.now();
    if (now - lastReconcileRef.current < 30000) return;
    lastReconcileRef.current = now;
    setWarming(true);
    reconcileProjects().then((r) => { if (r.warmed) refresh(); }).finally(() => setWarming(false));
  };
  // Keep the registry list fresh: on mount, whenever the dropdown opens, and when another tab
  // changes the site store. B854xxx/NEW-2: this now runs in controlled mode too — a controlled
  // caller unions this data in, so it must be kept live exactly like the uncontrolled path.
  useEffect(() => {
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
  // section simply doesn't render. Never throws into the dropdown. B854xxx/NEW-2: runs regardless
  // of `controlled` — deleting a real project is a registry-level fact, not a route-level one.
  const refreshBin = () => {
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
    if (open) { refresh(); warmThenRefresh(); reconcileThenRefresh(); refreshBin(); setQ(""); }
    else { setMenuFor(null); setEditingId(null); setBinOpen(false); setPurgeFor(null); orderSnapshotRef.current = null; }
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
  // ORG SCOPE (NEW-1) — same shape as pickProject/newProject: close the dropdown, surface an
  // at-risk save on the way out, hand off to the caller.
  const pickOrg = () => { setOpen(false); if (!org) flagIfAtRisk(); onSelectOrg?.(); };

  // A same-tab store write does NOT fire the native 'storage' event, so after an uncontrolled
  // rename/delete we nudge the app's existing planarfit:sites listeners (SitePlannerApp's site/
  // map list + this breadcrumb) to refresh — so the change shows on EVERY surface immediately,
  // not just on reload (B439, "update both surfaces"). Cross-tab already works for free.
  const notifyStoreChange = () => {
    try { window.dispatchEvent(new StorageEvent("storage", { key: "planarfit:sites:v1" })); } catch (_) {}
  };

  /* Telemetry from this file is DYNAMIC on purpose: this breadcrumb is chrome on every route, and
   * `clientErrors.js` statically pulls the Supabase client — the same reason the notes census and
   * the storage engine are reached by `import()` here (see this file's header). These two paths are
   * "this should be impossible" reports, so paying for the chunk only when one fires is free. */
  const reportBreadcrumbDefect = (event, message) => {
    import("../telemetry/clientErrors.js").then((m) => m.reportClientEvent(event, message, {})).catch(() => {});
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
  /* ⛔ `editingWhere` IS GONE, and the trap it guarded went with it — read this before adding a
   * second inline rename editor anywhere in this file.
   *
   * It existed because ONE project id addressed TWO editors: the project's row in the list, and the
   * crumb-level "Rename “…”" row (removed in NEW-2 above). Keyed on `editingId` alone, clicking
   * either mounted BOTH, each with `autoFocus`; the second to mount stole focus from the first,
   * whose `onBlur` then committed and closed it in the same frame — so the rename looked like it
   * simply refused to open, and only in the planner, where the crumb editor existed at all.
   *
   * With the crumb editor removed there is exactly ONE editor per id, so the surface is no longer
   * part of the key and the state was dead weight. ⛔ If a second rename editor is ever reintroduced,
   * the discriminator has to come back WITH it — `editingId` alone cannot address two editors. */
  const startRename = (p) => {
    setMenuFor(null);
    // NEW-2 — take the order snapshot on the FIRST rename of this dropdown session, not on every
    // one: a second rename (of a different row) must not re-freeze onto a layout the first rename
    // has already shuffled away from what's on screen.
    if (!orderSnapshotRef.current) orderSnapshotRef.current = projects.map((pp) => pp.id);
    setEditingId(p.id);
    setEditVal(p.name || "");
  };

  // B1358128 — resolve a switcher row's id to the id a controlled caller's own bridge actually
  // understands, per this file's own top-of-file note. `controlledProjects` is the caller's raw
  // list (e.g. Scheduler.jsx's schedules, each optionally carrying `linkedSiteId`) — NOT the
  // unioned/displayed `projects` above, which is what let a registry-standin id reach the bridge
  // unresolved in the first place. The pure resolution lives in projectModel.js (shared with
  // Scheduler.jsx's selectSchedule, which needed the identical logic for picking a project) —
  // this just supplies `controlled`'s early-out and the current project as the tie-break.
  // Returns null when the row has no controlled entity behind it at all (a project with no
  // linked schedule) — callers fall back to the site store or, for duplicate (no store
  // equivalent), surface a toast instead of silently doing nothing.
  const resolveControlledId = (id) => (controlled ? resolveControlledIdPure(controlledProjects, id, currentProject?.id) : id);

  const commitRename = (id) => {
    const v = (editVal || "").trim();
    setEditingId(null);
    // B1358128 — same refusal as doDelete: renaming "no project" is a defect, not a no-op.
    if (!id) {
      reportBreadcrumbDefect("project-rename-no-target", "the project rename editor had no project behind it");
      flashToast("Something went wrong — that menu lost track of which project it was for, so nothing was renamed.");
      return;
    }
    // NEW-2 — re-anchor keyboard focus to THIS row's own activate button (by id, once the editor
    // closes below), not to whatever now sits at the row's on-screen position. See the ref's own
    // comment near its declaration.
    pendingRefocusIdRef.current = id;
    if (!v) return; // reject empty/whitespace-only — keep the prior name
    const resolvedId = resolveControlledId(id); // no-ops to `id` unchanged when uncontrolled
    /* B1358128 — SAME RULE AS DELETE (see doDelete): a row that names a REAL project is renamed
     * as a PROJECT, and its linked schedule is renamed alongside it. Bridging alone renamed only
     * the schedule, and `unionProjectLists` shows the REGISTRY copy of a linked project — so the
     * row the user just renamed in the Schedule picker kept its old name and the rename read as
     * dead. Only a schedule-only pseudo-project (no registry row) is a bridge-only rename. */
    const isRegistryProject = internalProjects.some((p) => p && p.id === id);
    const bridged = controlled && resolvedId != null && !isRegistryProject;
    // NEW-2 — patch the name in optimistically, before the write even starts. `storeRename`
    // (uncontrolled) is a dynamically-imported async call (projects.js's own header — the engine
    // loads on first use), so a `refresh()` issued right after calling it can still read
    // PRE-rename data; reading that stale copy back into state is exactly the "the renamed name
    // doesn't show up for a beat, as if it were re-read from the server" symptom. Fixing the read
    // path — showing the new name from local state immediately, never waiting on the write to
    // settle — beats racing it harder. A bridged row is the controlled caller's own state to own.
    if (!bridged) {
      setInternalProjects((prev) => prev.map((p) => (p && p.id === id ? { ...p, name: v, updatedAt: Date.now() } : p)));
    }
    if (controlled && resolvedId != null && isRegistryProject) onRenameProject?.(resolvedId, v);
    // NEW-2 — a rename that didn't reach the cloud must SAY so. Both branches now return the
    // store's promise, so a failure surfaces as a toast here instead of the old silent no-op that
    // only showed up later as the name having reverted. (The Site Planner also raises its own
    // header banner; a duplicate line in the dropdown is cheap next to a silent revert.) The
    // reconciling `refresh()` now runs ONLY here, once the write has actually settled — an earlier
    // synchronous call (removed) raced the same dynamic import above and clobbered the optimistic
    // patch with the stale pre-rename read.
    const done = bridged ? onRenameProject(resolvedId, v) : storeRename(id, v);
    Promise.resolve(done).then((res) => {
      if (res && res.ok === false) flashToast(res.error || `“${v}” is saved on this device but couldn't be saved to the cloud — it may come back under its old name when you reload.`);
      if (!bridged) { refresh(); notifyStoreChange(); }
    }).catch(() => {});
  };
  /* NEW-2 — the actual refocus. Runs in a LAYOUT effect (before paint) so it lands in the SAME
   * frame the rename editor unmounts in, rather than leaving a gap where focus has already
   * settled on `document.body` with nothing to correct it. Reads `editingId` as its trigger
   * (it transitions to `null` on both commit and cancel) rather than a dep on the ref itself —
   * a ref write is not a React dependency, so this can only ever be driven by a real state
   * change alongside it. */
  useLayoutEffect(() => {
    const id = pendingRefocusIdRef.current;
    if (id == null) return;
    pendingRefocusIdRef.current = null;
    rowButtonRefs.current.get(id)?.focus();
  }, [editingId]);
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

  /* B1442592 ("An empty new project is never written to the server") — a project born through the
   * Site Planner's LAZY "New project" flow (storage.js's `newBlankSite`/`newSiteFromMap` headers;
   * the root CLAUDE.md's "Project creation is deliberately LAZY" owner constraint) gets no
   * `public.sites` row — and no local plan record either — until its first real edit. Until then
   * it can only ever appear here via `withCurrentProject`'s synthetic "the project you're standing
   * in" placeholder, so `listProjects()` (the real, saved registry `refresh()` reads into
   * `internalProjects`) never contains its id. The confirmation below used to promise "It moves to
   * Recently deleted" unconditionally — false for exactly this project, which has nothing anywhere
   * to move. This is confirmed live against the real RLS/soft-delete path in
   * `db/test/sites_soft_delete_rls.test.sql` (a genuinely saved project DOES get `deleted_at`
   * written; a never-saved id matches zero rows everywhere) — so the fix here is UI honesty, not a
   * delete-path bug. Scoped to uncontrolled mode: a controlled (Schedule) row's id lives in a
   * different namespace `listProjects()` was never going to contain, so this must never fire there.
   * `hasSavedProjectRecord` (projectModel.js) is the pure decision; `listProjects()` here — never
   * `internalProjects`, which already includes the synthetic placeholder — is the real registry. */
  const menuTargetUnsaved = !!(menuFor && menuFor.confirm && !controlled && !hasSavedProjectRecord(menuFor.id, listProjects()));

  const doDelete = (id, { moveNotes = false } = {}) => {
    /* ⛔ LOUD-FAILURE, B1358128 — a MISSING id is a defect in this component, not a project that
     * happens not to exist. Passing it on reached `deleteSiteGroup(undefined)`, which finds no
     * local plans, refuses to ask the cloud (no group id to ask about) and resolves
     * `{ ok: true, removed: 0 }` — zero network traffic, no error, nothing thrown, and the caller
     * carries on as though the delete happened. That is precisely how a delete could rewrite the
     * notes index, navigate the user home, and never touch `public.sites`. Refuse it here, say so,
     * and record it, rather than laundering a bug into a clean-looking no-op. */
    if (!id) {
      reportBreadcrumbDefect("project-delete-no-target", "the project delete confirmation had no project behind it");
      setMenuFor(null);
      flashToast("Something went wrong — that menu lost track of which project it was for, so nothing was deleted. Try again from the project list.");
      return;
    }
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
    /* ⛔ B1358128 — DELETING A PROJECT DELETES THE PROJECT, ON EVERY SURFACE THAT OFFERS IT.
     * This used to hand a controlled row STRAIGHT to the bridge and `return`, so in the Schedule
     * module "Delete project" deleted the SCHEDULE and left `public.sites` completely untouched —
     * the project was still there on every other surface and came back on the next reload. That is
     * the owner's report in as many words: "i cant delete projects from the schedule module, so why
     * does it even offer that ability". A row that names a REAL project (one the site registry
     * knows) is deleted as a project, and its linked controlled entity — the schedule — is deleted
     * alongside it, because the project it belonged to is gone. Only a row with NO registry entry
     * behind it (a schedule-only pseudo-project like Pursuits / Operations, which no `sites` row
     * has ever described) is a bridge-only delete; asking the site store to delete one of those
     * would be asking it about an id from a different namespace. */
    const isRegistryProject = internalProjects.some((p) => p && p.id === id);
    if (onDeleteProject) {
      // B1358128 — `id` may be a registry standin (see resolveControlledId's header) that the
      // bridge cannot resolve on its own; resolve it here rather than pass it through raw, which
      // is exactly what made Delete a silent no-op for a project with exactly one (or zero)
      // linked schedules in the Schedule module.
      const resolvedId = resolveControlledId(id);
      if (resolvedId != null) {
        onDeleteProject(resolvedId); // the bridge removes the linked schedule and routes home
        // A schedule-only row has no project to delete; a real project still does, so fall through.
        if (!isRegistryProject) return;
      }
      // No controlled entity behind this row (e.g. a project with no linked schedule) — fall
      // through to the ordinary site-store delete below rather than silently doing nothing.
    }
    // Uncontrolled (site store), or a controlled row with nothing for the bridge to delete:
    // optimistic local removal + an HONEST cloud-failure surface (B439) —
    // a silent zero-row delete would otherwise reappear on reload claiming it was "deleted".
    // ⛔ B735 (×2) — LOUD-FAILURE, the other reported half: `deleteSiteGroup` (storage.js) resolves
    // `{ ok: true, removed: 0 }`, not an error, when this DEVICE'S local cache holds no plan for the
    // group at all (never pulled, or a stale/emptied cache) — a legitimate "nothing to delete here"
    // outcome that used to read as a silent no-op with no message at all, indistinguishable from the
    // menu simply being broken. Surface it the same way a real cloud failure is surfaced.
    // ⛔ B1303824 — `deleteSiteGroup` now asks the CLOUD directly whenever the local cache is empty
    // (see its own header), so `removed: 0` means neither this device NOR the account has anything
    // by that id — the old "reload and try again" advice no longer applies (a reload can't surface
    // a project that genuinely isn't there).
    Promise.resolve(storeDelete(id)).then((res) => {
      if (res && res.ok === false) flashToast(res.error || "That project couldn't be fully deleted — it may reappear when you reload.");
      else if (res && res.ok && res.removed === 0) flashToast("Nothing was deleted — this project doesn't exist on this device or in your account.");
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
    Promise.resolve(purgeDeletedProject(p.ids, p.id)).then((res) => {
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
  // NEW-4 (B1343203) — the SAME name the visible span below computes inline (kept literal there
  // for an existing source-guard test's sake — see that span's own comment), hoisted here once so
  // the compact-mode aria-label and the hidden measurement twin can't drift from it independently.
  const projectLabel = cross ? "All projects" : org ? "Organization" : (currentName || "Select a project");

  /* NEW-4 (B1343203) — measured (not assumed) compaction of the MIDDLE crumb, per this file's own
   * VIEWPORT-STABLE-style rule: guess wrong either way and you either compact a trail that
   * already fits (needless) or leave the last crumb — the plan actually open — unreachable
   * without scrolling (the reported bug). `projectMeasureRef` is an always-mounted, always-FULL,
   * invisible twin of this crumb (same chrome, same current name, never abbreviated) — reading
   * ITS width rather than a hand-typed constant means the budget can never drift out of sync with
   * a later change to the visible crumb's own icon/caret/warn-triangle chrome. There is no
   * feedback loop to guard against (unlike Row 2's centred-toolbar hysteresis case): the dashboard
   * crumb, the plan crumb and this hidden twin are all measured at their natural, uncompacted
   * size regardless of `crumbCompact`'s own current value.
   */
  const wrapRef = useRef(null);
  const dashboardRef = useRef(null);
  const planSlotRef = useRef(null);
  const projectMeasureRef = useRef(null);
  const [crumbCompact, setCrumbCompact] = useState(false);
  useLayoutEffect(() => {
    // Only ever collapse the MIDDLE crumb: with no trailing `planSlot`, this crumb IS the last
    // one and must survive intact, same as Dashboard.
    if (!narrow || !planSlot || !rowRef) { setCrumbCompact((c) => (c ? false : c)); return undefined; }
    const wrap = wrapRef.current, dash = dashboardRef.current, plan = planSlotRef.current, full = projectMeasureRef.current;
    if (!wrap || !dash || !plan || !full) return undefined;
    const hasRO = typeof ResizeObserver === "function";
    let ro; // read inside `measure`, assigned right after (a closed-over TDZ-safe forward reference)
    let rowObserved = false;
    const measure = () => {
      /* ⛔ `rowRef.current` CAN BE NULL ON THE VERY FIRST CALL, and that is not a bug to fix by
       * retrying blindly — it is React's own commit order. `rowRef` is attached to an ANCESTOR
       * element (AppHeader's row div, which CONTAINS this component), and refs attach bottom-up
       * in the SAME traversal as layout effects: every descendant's ref and layout effect (this
       * one included) completes before an ancestor's own ref is attached. So on first mount this
       * child's layout effect fires before the parent's ref exists. The rAF below re-enters this
       * exact function one frame later, by which point it does — and this same call is what
       * starts observing the row for resize, since it could not be handed to the ResizeObserver
       * any earlier than it existed. */
      const row = rowRef.current;
      if (!row) return;
      if (hasRO && ro && !rowObserved) { ro.observe(row); rowObserved = true; }
      // This component's own left edge is where the breadcrumb starts — a real measured
      // position (never a guessed wordmark-width-plus-gap constant) for how much of Row 1 is
      // visible before it has to scroll.
      const availableWidth = Math.max(0, row.getBoundingClientRect().right - wrap.getBoundingClientRect().left);
      const needsCompact = crumbNeedsCompact({
        availableWidth,
        dashboardWidth: dash.getBoundingClientRect().width,
        projectWidth: Math.max(CRUMB_MIN_W, full.getBoundingClientRect().width),
        planWidth: plan.getBoundingClientRect().width,
        hasPlan: !!planSlot,
      });
      setCrumbCompact((prev) => (prev === needsCompact ? prev : needsCompact));
    };
    measure();
    if (!hasRO) { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const raf = requestAnimationFrame(measure);
    ro = new ResizeObserver(measure);
    ro.observe(wrap); ro.observe(dash); ro.observe(plan); ro.observe(full);
    if (rowRef.current) { ro.observe(rowRef.current); rowObserved = true; }
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [narrow, planSlot, currentName, cross, org, rowRef]);

  return (
    /* NEW-2 — the crumb row may SHRINK (it used to be `flex: "none"`), so that when the header is
       tight the project NAME ellipsises inside its own crumb instead of the whole row being clipped
       by the zone's `overflow: hidden` — which cuts the last crumb's ▾ caret off, the exact thing
       the owner could not click. Each crumb carries its own min-width below, so shrinking can never
       squeeze one to nothing. */
    <div ref={wrapRef} style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, flex: "0 1 auto" }}>
      {/* Dashboard crumb (B192) — literal text, always visible, primary route home. NEW-4/B1343203:
          the FIRST crumb, so it never compacts; `dashboardRef` feeds the compaction measurement
          below. NEW-1/B1343200: `tap-target` floors its hit area at 44x44 without growing the chip. */}
      <button
        ref={dashboardRef}
        className="tap-target"
        data-testid="dashboard-crumb"
        onClick={goDashboard}
        title={crumbDashboardTitle({ homeLabel, dashboardTitle })}
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
          reads "All projects".
          ⛔ NEW-1 (owner rule, "not relevant enough and it doesn't work") — this crumb used to
          carry a Private padlock glyph (a bare, non-interactive `<span title=…>`, never a button
          or a click handler — so "doesn't work" meant it read as tappable and wasn't) ahead of the
          name on every single-project route. Removed outright, not replaced: on a solo account
          every project is private, so the glyph carried no information. Do not re-add it here —
          shared-vs-private state for a project already has a real, working surface: the Site
          Planner's own site list (MapFinder.jsx) shows a "shared with <team>" chip per project via
          sharedWithTeam.js, sourced from the same team_id a project actually shares on. */}
      <button
        ref={anchorRef}
        className="tap-target"
        data-testid="project-crumb"
        data-crumb-compact={crumbCompact ? "1" : undefined}
        onClick={() => setOpen((o) => !o)}
        /* NEW-2 — the tooltip named only "project" outcomes; once the switcher can also open
           the Organization, both branches of that sentence needed a third case.
           NEW-4/B1343203 — compact mode keeps the same title/tooltip, so the full name is still
           one hover (or a screen reader) away even while the visible chip reads "…". */
        title={cross ? "Browsing all projects" : org ? "Browsing your organization's notes, library and agenda" : currentProject ? "Switch project" : "Choose a project or organization"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={crumbCompact ? `Switch project — currently ${projectLabel}` : undefined}
        /* NEW-2 — shrinkable BETWEEN two bounds. The name ellipsises down to the floor and no
           further, so the ⚠ and the ▾ always have room and the crumb never becomes a
           sliver you cannot aim at.
           NEW-4/B1343203 — a THIRD, tighter bound when `crumbCompact` measured that the full
           trail does not fit: the name collapses to "…" and the floor drops from CRUMB_MIN_W
           (a floor sized for a readable abbreviated NAME) down to the tap-target floor itself, so
           collapsing this crumb actually buys back the room the last (plan) crumb needs. */
        style={crumbBtn({
          color: (currentProject || cross || org) ? INK : MUTED, flex: "0 1 auto",
          maxWidth: crumbCompact ? 44 : 240, minWidth: crumbCompact ? 44 : CRUMB_MIN_W,
        })}
      >
        {crumbCompact ? (
          <CollapsedCrumbIcon />
        ) : (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {/* NEW-2 — the same fix, on the crumb's own visible text: it used to fall straight
                to "Select a project" whenever nothing was picked, which is wrong the moment the
                same menu also offers the Organization. */}
            {cross ? "All projects" : org ? "Organization" : (currentName || "Select a project")}
          </span>
        )}
        {/* NEW-3 — the at-risk marker on the crumb itself. Two fixes in one: the `⚠` text glyph
            becomes a drawn triangle (most platforms resolve U+26A0 to a colour emoji), and the
            HARDCODED `#f59e0b` becomes `--warn-text`. The raw hex was the B341 trap exactly — a
            chrome-region component pinning a colour instead of a token, which reads fine until the
            chrome flips theme, and which the contrast audit cannot check. */}
        {!crumbCompact && atRisk(saveState) && (
          <span title="Saved on this device: the cloud is unreachable" aria-hidden
            style={{ flex: "none", color: "var(--warn-text)", display: "grid", placeItems: "center" }}><WarnIcon size={12} /></span>
        )}
        {!crumbCompact && <span style={{ opacity: 0.6, fontSize: 11, flex: "none" }}>▾</span>}
      </button>

      {/* NEW-4 (B1343203) — an always-mounted, always-FULL, invisible twin of the crumb above,
          read by the compaction measurement effect. It is not this crumb's OWN rendered box
          (which shrinks the instant `crumbCompact` flips true) so the decision can never watch
          the effect of its own last answer. */}
      <span
        ref={projectMeasureRef}
        aria-hidden="true"
        style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", ...crumbBtn({ maxWidth: 240, minWidth: CRUMB_MIN_W }) }}
      >
        <span>{projectLabel}</span>
        {atRisk(saveState) && <WarnIcon size={12} />}
        <span style={{ fontSize: 11 }}>▾</span>
      </span>

      {/* Trailing crumb (e.g. the Site Planner's plan switcher). Same "/" separator + crumb
          geometry as the Map/project crumbs, so the three segments read as one breadcrumb.
          NEW-4/B1343203 — the LAST crumb, so it never compacts; `planSlotRef` wraps the REAL
          rendered node (not a duplicate — a plan switcher owns its own open/close state and
          anchor ref, so rendering it twice would fight over both) purely to read its width. */}
      {planSlot && (
        <>
          <span style={{ color: MUTED, opacity: 0.55, flex: "none", fontSize: 13, padding: "0 1px" }}>/</span>
          <span ref={planSlotRef} style={{ display: "flex", alignItems: "center", minWidth: 0 }}>{planSlot}</span>
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
            border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, outline: "none",
            fontFamily: "inherit", fontSize: CHROME_FONT_CONTROL, color: "var(--text-primary)", background: "var(--surface-page)",
          }}
        />

        {atRisk(saveState) && (
          <div style={{ display: "flex", gap: 7, alignItems: "flex-start", padding: "7px 9px", marginBottom: 4,
            borderRadius: RADIUS.sm, background: "var(--surface-page)", border: "1px solid var(--warn-text)", color: "var(--warn-text)", fontSize: CHROME_FONT_CONTROL, lineHeight: 1.4 }}>
            {/* B525: token-themed warn row (was a hardcoded light-amber box that became a light slab in dark mode)
                NEW-3 — and the marker is a drawn triangle now, not a `⚠` text glyph. Same reason as the
                menu icons: most platforms resolve U+26A0 to a COLOUR emoji, which then ignores the
                `--warn-text` token this whole row is deliberately painted in. */}
            <WarnIcon />
            <span>This project's latest changes are saved on this device — the cloud is unreachable. Switching is safe; they'll sync next time you edit or close this tab.</span>
          </div>
        )}

        {/* ⛔ NEW-1 / NEW-2 — TWO ROWS DELIBERATELY REMOVED FROM THE TOP OF THIS DROPDOWN. Do not
            re-add either; each was a SECOND control for something already reachable inches away.
            (Owner, 2026-08-11: "I don't know that I need an all projects map button because I have
            that right to the top left right there. And I don't need a rename Clay & Porter right
            there… there already is the option for the three dots, so I don't need a second option.")

            NEW-1, the "All projects ({homeLabel})" row: it called `goDashboard` — the SAME handler as
            the Dashboard crumb button, which is permanently visible immediately to the LEFT of the
            crumb that opens this dropdown. Its `current` marker is not lost: the crumb already
            carries `aria-current="page"` and switches from MUTED to INK when `onDash`, which is the
            same signal in both the accessibility tree and the colour.

            NEW-2, the "Rename “{currentName}”" row: every project row below has a kebab carrying
            Rename and Delete (B439). It existed because that kebab was hover-revealed and therefore
            "invisible, and dead on touch" — a real concern, so it was NOT simply deleted: the kebab
            is now always rendered (see the row above), which makes it reachable by tap AND by keyboard
            before this crumb-level duplicate went away. One entry point, not two, and not zero.

            What is LEFT here is a project LIST plus a New-project action, which is what a switcher is. */}

        {/* ORG SCOPE (NEW-1) — a real, distinct destination above the project list, exactly
            where the brief asked for it. It is NOT a project row: no id it produces is ever a
            projectId, it never appears in `projects`/`filtered` below, and picking it always
            routes through `onSelectOrg`, never `onSelectProject`. Omitted entirely (not
            disabled) when the caller hasn't wired `onSelectOrg` — see AppHeader's own note on
            why Schedule doesn't offer it this round. */}
        {onSelectOrg && (
          <button
            data-testid="project-org"
            onClick={pickOrg}
            style={row({ background: org ? "var(--hover-menu)" : "transparent", fontWeight: 700, marginBottom: 2 })}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-primary)" }}>
              <OrgIcon />
              Organization
            </span>
            {org && <span style={{ color: accent, fontSize: 10.5, fontWeight: 700 }}>current</span>}
          </button>
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
              const editing = editingId === p.id;
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
                      onCancel={() => { pendingRefocusIdRef.current = p.id; setEditingId(null); }}
                      label={`Rename ${p.name}`}
                      style={{ flex: 1, margin: "2px 4px", border: "1px solid var(--accent-site-text, #2563eb)" }}
                    />
                  ) : (
                    <>
                      <button
                        ref={(el) => { if (el) rowButtonRefs.current.set(p.id, el); else rowButtonRefs.current.delete(p.id); }}
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
                            style={{ flex: "none", display: "grid", placeItems: "center", color: "var(--text-tertiary)" }}
                          ><CalendarIcon /></span>
                        )}
                      </button>
                      {/* ⛔ NEW-2 — THE KEBAB IS ALWAYS RENDERED, AND THAT IS THE PRECONDITION FOR
                          REMOVING THE CRUMB-LEVEL RENAME, NOT A COSMETIC CHANGE.
                          It used to render only while `active` (`hoverRow === p.id`), set purely by
                          onMouseEnter — and the only other route to this menu is `onContextMenu`, a
                          right-click. So on a touch device there was no rename or delete AT ALL, and
                          for a keyboard user the control was not merely invisible but ABSENT FROM THE
                          DOM, so it could not be tabbed to either. The crumb-level rename was
                          covering for that (its own comment said so: "invisible, and dead on touch"),
                          which is why it could not simply be deleted — removing one of two entry
                          points must not leave zero. Present always; hover only BRIGHTENS it, since
                          opacity/colour is presentation and must never be the hit-test gate.
                          The row's timestamp / "current" marker now sits BESIDE it instead of being
                          swapped out by it, so hovering a row no longer hides when it was edited. */}
                      <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, paddingRight: 7 }}>
                        {cur ? (
                          <span style={{ color: accent, fontSize: 10.5, fontWeight: 700 }}>current</span>
                        ) : (
                          <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{relTime(p.updatedAt)}</span>
                        )}
                        {canManage && (
                          <button
                            onClick={(e) => openManageMenu(e, p)}
                            title="Rename or delete"
                            aria-label={`Manage ${p.name}`}
                            data-testid={`project-kebab-${p.id}`}
                            style={{
                              flex: "none", cursor: "pointer", border: "none", background: "transparent",
                              color: active ? "var(--text-secondary)" : "var(--text-tertiary)",
                              borderRadius: RADIUS.sm, padding: "2px 3px", lineHeight: 0, fontFamily: "inherit",
                              display: "grid", placeItems: "center",
                            }}
                          ><KebabIcon /></button>
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
            binned projects (signed out, or a DB without db/sites_soft_delete.sql, reports none).
            B854xxx/NEW-2: no longer gated on `controlled` — deleting a real registry project is a
            fact regardless of which route's switcher you're standing in, so Scheduler shows this
            bin exactly like every other route now that refreshBin() runs there too. */}
        {deleted.length > 0 && (
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
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: CHROME_FONT_CONTROL, color: "var(--text-secondary)" }} title={p.name}>
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

      {/* Per-row manage menu (B439) — Rename / Delete, a SECOND portal layer stacked above the
          dropdown (zIndex 5000 against its 4000).
          ⛔ B1358128 — THIS COMMENT USED TO SAY "above the dropdown's click-away BACKDROP, so
          clicking inside it never closes the parent dropdown", and that stopped being true when
          B1106256 replaced AnchoredMenu's backdrop with a document-level listener. A backdrop
          absorbed the press; a listener sees every press in this portal as "outside" and closed
          the dropdown — which cleared this menu's own target and the inline rename editor
          mid-gesture (see the `[open]` effect and the confirm row's updater). The property is now
          ASSERTED rather than assumed: both menus declare their stacking layer and AnchoredMenu
          stands down for a press inside a higher one (menuLayers.js), and
          e2e/menu-layer-nesting.spec.js fails if a press in this menu ever closes the dropdown
          again. */}
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
                    <PencilIcon /> Rename
                  </button>
                )}
                {canDuplicate && (
                  <button
                    data-testid="project-duplicate"
                    role="menuitem"
                    onClick={() => {
                      setMenuFor(null);
                      // B1358128 — same registry-standin resolution as Rename/Delete; unlike
                      // those two, Duplicate has no site-store fallback (see this file's own
                      // top-of-file note), so a row with nothing behind it says so instead of
                      // silently doing nothing.
                      const resolvedId = resolveControlledId(menuFor.id);
                      if (resolvedId != null) onDuplicateProject(resolvedId);
                      else flashToast("This project has no schedule yet, so there's nothing to duplicate here.");
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-ghost)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    style={menuItem()}
                  >
                    <DuplicateIcon /> Duplicate
                  </button>
                )}
                {canDelete && (
                  <button
                    data-testid="project-delete"
                    role="menuitem"
                    /* ⛔ B1358128 — `(m) => ({ ...m, confirm: true })` HERE IS HOW A PROJECT
                       DELETE BECAME A NO-OP, and it is worth stating plainly because the shape
                       looks harmless. If anything clears `menuFor` in the same React batch as
                       this press (the `[open]` effect below did exactly that, because opening
                       this second portal menu used to close the parent dropdown — see
                       menuLayers.js), the spread of `null` yields `{ confirm: true }`, which is
                       TRUTHY: the menu does not close, it re-renders its confirmation step with
                       the project ERASED. The dialog then says "Delete this project?" and the
                       confirm deletes `undefined` — a clean, silent, zero-row success. A lost
                       target must CLOSE the menu, never survive as a partial one. */
                    onClick={() => setMenuFor((m) => (m ? { ...m, confirm: true } : null))}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-ghost)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    style={menuItem({ color: "var(--danger, #dc2626)" })}
                  >
                    <TrashIcon /> Delete
                  </button>
                )}
              </>
            ) : (
              <div style={{ padding: "5px 7px" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45, marginBottom: 9 }}>
                  {/* NEW-1 — the delete is now recoverable, so the confirm says so instead of the
                      old "can't be undone" (which is no longer true, and made the stakes read higher
                      than they are). Permanent destruction lives behind "Delete forever" in the bin. */}
                  {/* B1303825 — a destructive confirmation must always name its target; a falsy
                      `menuFor.name` (never expected, but not provably impossible — `openManageMenu`
                      snapshots `p.name` at click time) must never render as a blank "Delete ?". */}
                  {/* B1442592 — a project that was never actually saved (lazy "New project" creation;
                      see menuTargetUnsaved's own header above) has nothing anywhere to move to
                      Recently deleted, so the confirmation must not promise that trip. */}
                  {menuTargetUnsaved ? (
                    <>
                      <strong style={{ color: "var(--text-primary)" }}>{menuFor.name || "This project"}</strong> hasn't been saved yet — there's nothing on the server (or this device) to delete. Closing it just leaves it behind; it won't be in Recently deleted.
                    </>
                  ) : (
                    <>
                      Delete <strong style={{ color: "var(--text-primary)" }}>{menuFor.name || "this project"}</strong>? It moves to Recently deleted — you can restore it for {DELETED_RETENTION_DAYS} days.
                    </>
                  )}
                  {/* NEW-3 — say what ELSE is filed here, in as many words, before it goes.
                      Absent when there is nothing to say (PANEL-BREVITY); an unknown count is
                      NAMED as unknown, never rendered as a confident zero. */}
                  {noteCensus?.state === "ready" && noteCensus.noteCount > 0 ? (
                    <div data-testid="project-delete-notes" data-note-count={noteCensus.noteCount} style={{ marginTop: 7, color: "var(--warn-text)", fontWeight: 600 }}>
                      {/* ⛔ NOTES, THEN SUBPAGES — never a TOTAL (NEW-6). A note that has one
                          page under it is one note, and the count in brackets used to fold the
                          note itself into a "pages" figure, so two things read as three. */}
                      {noteCensus.noteCount === 1 ? "1 note is" : `${noteCensus.noteCount} notes are`} filed here
                      {noteCensus.pageCount > noteCensus.noteCount
                        ? ` (+ ${noteCensus.pageCount - noteCensus.noteCount} ${noteCensus.pageCount - noteCensus.noteCount === 1 ? "subpage" : "subpages"})`
                        : ""}. They stay in Notes either way.
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
                    onClick={() => setMenuFor((m) => (m ? { ...m, confirm: false } : null))}
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
                  >{menuTargetUnsaved ? "Close" : "Delete"}</button>
                </div>
              </div>
            )}
          </>
        </ContextMenu>
      )}

      {/* Transient at-risk-switch notice (B193) — non-blocking, auto-dismiss.
          NEW-1 (B1000400) — bottom-centered via the shared FloatingNotice primitive (was its own
          `top:84` fixed portal to document.body, one of three surfaces that each invented this
          position — see docs/DESIGN.md "Floating notifications"). Visual style unchanged. */}
      {toast && (
        <FloatingNotice testId="project-at-risk-toast" maxWidth={520}>
          <div role="status" style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "#1f2a44", color: "#eaf0ff", border: "1px solid #3b5bbf", borderRadius: RADIUS.md,
            padding: "9px 13px", fontSize: CHROME_FONT_CONTROL, fontWeight: 600, fontFamily: "system-ui, sans-serif",
            boxShadow: "0 10px 30px rgba(0,0,0,0.32)",
          }}>
            <span style={{ flex: 1 }}>{toast}</span>
            <button onClick={() => setToast(null)} title="Dismiss" style={{
              flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.16)", color: "#fff",
              border: "none", borderRadius: RADIUS.sm, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700,
            }}>✕</button>
          </div>
        </FloatingNotice>
      )}
    </div>
  );
}
