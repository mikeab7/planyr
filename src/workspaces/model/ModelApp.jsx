/* Model — the underwriting spreadsheet workspace root.
 *
 * A vertical slice, deliberately: a real 2D sheet (virtualised rows, rectangular selection,
 * keyboard nav, an inline editor and a formula bar) whose formulas evaluate through the
 * SAME shared engine every other module in this repo will eventually share
 * (src/shared/formula/formula.js), imported directly — no mirror, no copy. See
 * lib/sheetModel.js and lib/sheetEngine.js for the two decisions that shape everything else:
 * cell addressing lives in the data layer (not this component), and — ⛔ B891184-FOLLOWUP,
 * corrected after live production testing — a formula belongs to the ONE CELL it was typed
 * into, never a whole column; sheetEngine.js evaluates a dependency graph across cells, using
 * a concurrent session's A1-reference addition to the shared engine (grid[row][col]).
 *
 * PERSISTENCE (lib/modelStore.js): local storage is the write-through save that works today,
 * signed in or not, migration or not. The cloud push rides the SAME guarded save path every
 * other cloud table in this repo uses (src/shared/cloud/serializeWrites.js +
 * optimisticUpsert.js) against `model_sheets` (db/model_sheets.sql) — applied to production
 * 2026-08-31. THERE IS NO CROSS-DEVICE MERGE IN V1: local wins whenever it exists; the cloud
 * copy is adopted only to seed a brand-new device that has never opened this project's model
 * before. A genuine two-device conflict DURING a save (another device bumped the version in the
 * gap between this device's load and its own save) surfaces as a small banner rather than
 * silently overwriting anything, and simply asks for a reload.
 *
 * ⛔ B891184-FOLLOWUP-2 (live production finding, 2026-08-31) — TWO further defects, both fixed
 * here: (1) the cloud push silently failed on every first-ever save (modelStore.js's row never
 * included `id`, a real NOT NULL violation on a table whose primary key is composite
 * (user_id, id) — proven live against production) while the header kept showing a confident
 * green "Synced" badge, because `modelSaveState` treated "idle" (nothing confirmed yet) the same
 * as "confirmed synced." Fixed at the source (modelStore.js + optimisticUpsert.js) and the
 * badge now only claims "Synced" once a real round trip (`cloudConfirmed`) has happened this
 * session. (2) A DIFFERENT, still-open gap the CAS-conflict guard above does NOT cover: it only
 * catches a race that happens DURING a save. If device B opens this project with its OWN older
 * local copy while device A's newer content already sits in the cloud, B's load correctly reads
 * cloud version N (so nothing double-books, no false conflict is raised) but then keeps
 * SHOWING B's stale local content (by the "local always wins on load" rule above) — B's next
 * edit saves cleanly at version N→N+1, silently overwriting A's work with no warning, since
 * nothing in the CAS check knows the CONTENT diverged, only the version. That is now DETECTED
 * at load (`status: "diverged"`, a loud red badge + an explicit banner) — v1 still doesn't
 * merge, but it can no longer clobber another device's saved work in total silence.
 */
import { useProjectName, projectNameOf } from "../../shared/names/names.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import { CRUMB_MIN_W } from "../../shared/ui/ProjectBreadcrumb.jsx";
import SheetView from "./components/SheetView.jsx";
import FormulaBar from "./components/FormulaBar.jsx";
import FindReplaceBar from "./components/FindReplaceBar.jsx";
import NameManager from "./components/NameManager.jsx";
import InconsistencyPanel from "./components/InconsistencyPanel.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import Ribbon, { AuditGroup } from "./components/Ribbon.jsx";
import TabStrip from "./components/TabStrip.jsx";
import { RADIUS } from "../../shared/ui/radius.js";
import { useUndoableState } from "./lib/undoStack.js";
import {
  createWorkbook, migrateWorkbook, activeSheetEntry, applyToActiveSheet, setActiveSheet,
  addSheet, duplicateSheet, renameSheet, deleteSheet, reorderSheet,
  workbookInsertRowAt, workbookDeleteRowAt, workbookInsertColumnAt, workbookDeleteColumn,
  commitCellText, blankRange, renameColumn, setNumberFormat, addColumn,
  formatAt, padRowCount, sheetsDiverge, rawAt,
  setColumnWidth, setRowHeight, setFreeze,
  styleAt, setCellStyle, applyBorder, clearFormatting,
  paintedStyleAt, applyPaintedStyle, mergeAt, mergeRange, unmergeAt, sortRange, usedRangeEnd,
  isInconsistencyDismissed, setInconsistencyDismissed, workbookHasContent,
} from "./lib/sheetModel.js";
import { defineName, renameName, retargetName, deleteName } from "./lib/namedRanges.js";
import { evaluateWorkbook, displayFor } from "./lib/sheetEngine.js";
import { beginOrStepTrace, renderableTrace } from "./lib/traceAudit.js";
import { findInconsistencies } from "./lib/formulaConsistency.js";
import { copyRange, pasteRange, fillDown, replaceAll, replaceInCellText } from "./lib/sheetOps.js";
import { increaseDecimals, decreaseDecimals, toggleThousands } from "./lib/numberFormats.js";
import { modelSaveState } from "./lib/modelSaveState.js";
import { readZoom, writeZoom } from "./lib/sheetZoom.js";
import { readAutoColor, writeAutoColor } from "./lib/sheetColorMode.js";
import {
  readLocalSheet, writeLocalSheet, decideAnonAdoption, loadCloudSheet, saveCloudSheet,
  readLocalOrgIndex, writeLocalOrgIndex, touchLocalOrgIndex, removeLocalOrgIndexEntry,
  listOrgWorkbooksCloud, loadOrgWorkbookCloud, saveOrgWorkbookCloud, renameOrgWorkbookCloud, deleteOrgWorkbookCloud,
} from "./lib/modelStore.js";
import { listProjects, reconcileProjects, onProjectsChanged } from "../../shared/projects/projects.js";
import FileMenu from "./components/FileMenu.jsx";
import OrgWorkbookPicker from "./components/OrgWorkbookPicker.jsx";
import { addSheetFromCsvText, sheetToCsv } from "./lib/csvIO.js";
// spreadsheet-live-data-refs — the project's own data (site plan + comps), exposed read-only as
// Site.*/Plan.*/Comp.* formula names (lib/projectRefs.js's own header). `onSiteModelChanged` is a
// cross-workspace notification this feature added to storage.js (mirroring the pre-existing
// `onProjectsChanged` shape exactly) so a live edit made in the still-mounted Site Planner tab
// recalculates a formula here without a reload. `fetchAllComps` is the same async/Supabase-only
// read CompsPanel.jsx uses — there is no synchronous comps cache anywhere in this repo.
import { buildProjectNames, openConceptName } from "./lib/projectRefs.js";
import { onSiteModelChanged } from "../site-planner/lib/storage.js";
import { onCompsChanged } from "../../shared/comps/lib/compsChanged.js";
import { fetchProjectNameComps } from "./lib/projectCompsFetch.js";

const CLOUD_PUSH_DEBOUNCE_MS = 800;
// Excel round-trip (NEW-1) — lib/xlsxIO.js is dynamically imported (never a static import here)
// so ExcelJS never rides this workspace's own eager chunk; only opening the File menu's Export/
// Import actions ever fetches it. Both directions share one loader so the file downloads once
// regardless of which action the user reaches for first.
let xlsxIOModulePromise = null;
function loadXlsxIO() {
  if (!xlsxIOModulePromise) xlsxIOModulePromise = import("./lib/xlsxIO.js");
  return xlsxIOModulePromise;
}

function sanitizeFilename(name) {
  return String(name || "Workbook").replace(/[\\/:*?"<>|]+/g, "_").trim() || "Workbook";
}

/** The DocReview.jsx-established pattern for "hand the browser a Blob to save" — a throwaway
 *  object URL + a synthetic <a download>, clicked and immediately discarded. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function EmptyProjectState({ onGoDashboard }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 28, background: "var(--surface-page)" }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 19, fontWeight: 700, color: "var(--text-primary)" }}>No spreadsheet open</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          A spreadsheet belongs to a project, the same as a site plan or a set of drawings. Pick or start a project to open it.
        </p>
        <button
          type="button"
          onClick={onGoDashboard}
          style={{ height: 32, padding: "0 16px", borderRadius: 8, border: "1px solid var(--accent-model)", background: "var(--accent-model)", color: "var(--on-accent-model)", font: "inherit", fontSize: 13.5, fontWeight: 650, cursor: "pointer" }}
        >Go to Dashboard</button>
      </div>
    </div>
  );
}

export default function ModelApp({
  isActive, shellModule, onShellSwitch, authControl, accountActive, userId,
  projectId, crossProject, onNavigate, onGoDashboard, onNewProject, onSelectOrg,
  // ORG SCOPE (NEW-1, B1912209) — standing in the Organization, not any project (route.js's
  // `org` field; mutually exclusive with `projectId`/`crossProject` by construction — see
  // `orgMode` below). Unlike a project's single workbook, Organization holds SEVERAL — the
  // picker (`OrgWorkbookPicker.jsx`) chooses one before this component's existing grid/ribbon/
  // File-menu UI (unchanged, reused verbatim) has anything to show.
  org = false,
}) {
  const { value: workbook, commit, undo, redo, reset, canUndo, canRedo } = useUndoableState(createWorkbook());
  // STAGE 3 (NEW-1) — which sheet TAB is currently being VIEWED. Deliberately kept OUTSIDE the
  // undo-tracked `workbook` value, the same way zoom/painter/filterOn already are below: a plain
  // tab click is navigation, not a content edit, and must never mint (or be reverted by) an undo
  // frame. `workbook.activeSheetId` itself still exists (sheetModel.js's pure functions need
  // SOME notion of "active" and it's what a fresh load seeds this from) and IS updated by real
  // content operations that also pick a new active sheet (add/duplicate/delete) — see those
  // handlers below, each of which syncs this state explicitly right after committing. A plain
  // tab click never touches `workbook` at all. If an undo/redo ever lands on a workbook whose
  // stored `activeSheetId` no longer matches this sheet id (e.g. undoing past an "Add Sheet"),
  // the render below falls back defensively and a small effect resyncs this state to match.
  const [activeSheetId, setActiveSheetId] = useState(() => workbook.activeSheetId);
  const activeEntry = workbook.sheets.find((s) => s.id === activeSheetId) || activeSheetEntry(workbook);
  useEffect(() => { if (activeEntry.id !== activeSheetId) setActiveSheetId(activeEntry.id); }, [activeEntry.id, activeSheetId]);
  const sheet = activeEntry.sheet;
  const sheetName = activeEntry.name;
  const [selRange, setSelRange] = useState({ r1: 0, r2: 0, c1: 0, c2: 0 });
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error | conflict | not-provisioned | diverged
  // Whether a REAL cloud round trip (a successful load or a successful save) has happened this
  // session for the CURRENT project. Distinct from `status`, which can be "idle" — meaning
  // nothing failed but nothing was ever confirmed either — the exact ambiguity that used to let
  // the badge claim "Synced" for a project that had never actually reached the cloud.
  const [cloudConfirmed, setCloudConfirmed] = useState(false);
  // B1076480: the on-device project-name cache (listProjects()) is only populated after a cloud
  // pull — Notes.jsx/Scheduler.jsx warm it on mount, but this workspace never did, so a fresh
  // tab/deep-link/reload landing straight in Model saw an empty cache and the breadcrumb fell back
  // to the literal word "Project" instead of the real name.
  // ⛔ `warmProjectsIfEmpty()` (what Notes/Scheduler use) is NOT enough on its own — it's gated on
  // the WHOLE cache being empty (`loadSiteSummaries().length === 0`), so it no-ops for the more
  // likely real case: a cache that already holds OTHER projects but has quietly diverged and is
  // simply missing/stale for THIS one (documented gap, B853266 — "the switcher can be opened a
  // hundred times and it will keep serving the same stale snapshot"). That fix only reaches the
  // project SWITCHER dropdown (reconcile only runs when it's opened, in ProjectBreadcrumb.jsx) —
  // the crumb TEXT itself, resolved via resolveCurrentName()'s synthetic-entry fallback, is still
  // exposed the moment this workspace is a fresh mount. reconcileProjects() is the always-pull
  // sibling (no empty-cache gate) — call it once on mount, then keep listening so a later cloud
  // pull (from anywhere in the app) self-heals the breadcrumb too.
  // Deliberately unread — its only job is to force the re-render that picks up the newly-warmed
  // cache in the plain `projectName` computation below (B1128 dead-store convention: `_` prefix).
  const [_projectsTick, setProjectsTick] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try { await reconcileProjects(); } catch (_) {}
      if (live) setProjectsTick((n) => n + 1);
    })();
    const off = onProjectsChanged(() => { if (live) setProjectsTick((n) => n + 1); });
    return () => { live = false; off(); };
  }, []);
  // spreadsheet-live-data-refs — the two live inputs Site.*/Plan.*/Comp.* project names are built
  // from (lib/projectRefs.js). `comps` is re-fetched on mount and on every project switch
  // (compsStore.js is async/Supabase-only, no sync cache — see that module's own header);
  // `siteTick` bumps on a DEBOUNCED site-content-changed notification, so a burst of drag-frame
  // saves in the (possibly hidden) Site Planner tab recomputes the site model once, not per save.
  const [comps, setComps] = useState([]);
  // B1953796 (R4) — comps are re-read on project switch AND whenever a comp is written elsewhere
  // (the Site Planner's Comps panel, same mounted app) or this workspace becomes active/visible
  // again, so Comp.<title>.* never quotes a stale rate. Token-guarded: the newest read wins.
  const compsReq = useRef(0);
  const refetchComps = useCallback(async () => {
    const tok = ++compsReq.current;
    const { data, error } = await fetchProjectNameComps();
    if (tok === compsReq.current && !error) setComps(data || []); // a FAILED read keeps the last-known list
  }, []);
  useEffect(() => { refetchComps(); }, [projectId, refetchComps]);
  useEffect(() => { if (isActive) refetchComps(); }, [isActive, refetchComps]);
  useEffect(() => {
    const off = onCompsChanged(refetchComps);
    const onVis = () => { if (document.visibilityState === "visible") refetchComps(); };
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => { off(); window.removeEventListener("focus", onVis); document.removeEventListener("visibilitychange", onVis); };
  }, [refetchComps]);
  const [siteTick, setSiteTick] = useState(0);
  const siteTickTimer = useRef(0);
  useEffect(() => {
    const off = onSiteModelChanged(() => {
      clearTimeout(siteTickTimer.current);
      siteTickTimer.current = window.setTimeout(() => setSiteTick((n) => n + 1), 600);
    });
    return () => { off(); clearTimeout(siteTickTimer.current); };
  }, []);
  const projectNames = useMemo(() => buildProjectNames(projectId, { comps }), [projectId, comps, siteTick]);
  // spreadsheet-concept-crumb (NEW-1) — the header dropped the concept/scheme segment the Site tab
  // shows (Map / Project / Concept ▾), so once a project held more than one concept there was no
  // way to tell, from this tab alone, which scheme's geometry Site.*/Plan.* were quoting — exactly
  // the ambiguity #1516 fixed the RESOLUTION half of. Same trigger as `projectNames` above
  // (`siteTick`, bumped by `onSiteModelChanged` — which a plan switch's `flushSite()` fires too, so
  // this reads live the instant the Site tab's plan crumb changes), and the identical resolution
  // (`openConceptName` shares `projectRefs.js`'s one `loadOpenSite`) — no second "which scheme is
  // open" answer to drift from what the sheet is actually evaluating.
  const conceptName = useMemo(() => openConceptName(projectId), [projectId, siteTick]);
  const cloudVersionRef = useRef(null);
  const pushTimer = useRef(0);
  const loadTokenRef = useRef(0);
  // Ctrl+C/Ctrl+V's INTERNAL clipboard (item 6) — see lib/sheetOps.js's header for why this is
  // deliberately not the OS clipboard. A ref, not state: copying never re-renders anything.
  const clipboardRef = useRef(null);
  // ⛔ B891184-FOLLOWUP (live production finding, 2026-08-31): the toolbar overflowed a 729px
  // window — measured, the number-format picker's own box sat 22.7px past the viewport edge,
  // reachable to a script but not to a real click. Every formatting control (incl. Undo/Redo,
  // since the ICONOGRAPHY pass) now lives in the Ribbon below, which does its own width-aware
  // collapsing (lib/ribbonLayout.js) — row 1 (AppHeader) carries no toolbarContent for this
  // workspace at all any more.
  // Stage 1 — Name Box (Ctrl+G focuses it) and Find/Replace (Ctrl+F / Ctrl+H).
  const nameBoxRef = useRef(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findShowReplace, setFindShowReplace] = useState(false);
  // Stage 3 pt 2 (NEW-1) — the Name Manager panel's own open/closed state, the same "plain view
  // state, not sheet data" convention findOpen already uses one line above.
  const [nameManagerOpen, setNameManagerOpen] = useState(false);
  // NEW-1 (command palette, owner chat block) — the palette's own open/closed state, same
  // convention. `tabStripRef`/`fileMenuRef` let a palette command ("Rename Sheet", "Import
  // Excel File") drive the SAME imperative entry points (`startRename`/`openImportXlsx`/
  // `openImportCsv`) those components' own UI already uses — see their own headers.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const tabStripRef = useRef(null);
  const fileMenuRef = useRef(null);
  // B1290496 — `sheetViewRef` lets the Name Box (FormulaBar.jsx) hand DOM focus back to the grid
  // once a typed jump lands. Navigating from the Name Box calls `onGoTo` (below) same as a mouse
  // click does, but a mouse click also focuses the grid container as a side effect of the click
  // itself (SheetView's own `cellClick`) — the Name Box has no such side effect, so without this
  // the grid's `selRange` moves but DOM focus is left on nothing (the box blurs to `document.body`)
  // and every keystroke typed right after is silently discarded.
  const sheetViewRef = useRef(null);
  const focusGrid = useCallback(() => sheetViewRef.current?.focusGrid(), []);
  // STAGE 3 (NEW-1) — trace precedents/dependents. Plain view state, like `zoom`/`painter` below
  // — never through the undo stack, never synced to the cloud. `null` = no trace active; see
  // lib/traceAudit.js's own header for the shape. Cleared on ANY real workbook edit (the effect
  // below, keyed on `workbook`) since a trace's captured cell keys can be invalidated by a
  // structural change (a row/column insert/delete moving or deleting the very cells it named).
  const [trace, setTrace] = useState(null);
  useEffect(() => { setTrace(null); }, [workbook]);
  // STAGE 3 (NEW-2) — the Inconsistencies panel's own open/closed state, same convention as
  // `nameManagerOpen` — mutually exclusive with Find/Replace and the Name Manager (see
  // `onToggleInconsistencyPanel` below and the two other panels' own toggles).
  const [inconsistencyPanelOpen, setInconsistencyPanelOpen] = useState(false);
  // Stage 1's Ctrl+F / Ctrl+H opened Find/Replace inline in the keydown handler below; pulled
  // out into named callbacks (NEW-1, command palette) so the palette's "Find"/"Replace" commands
  // open the exact SAME bar the same way — one definition of "what opening Find means," not a
  // second copy of these four lines.
  const onOpenFind = useCallback(() => { setFindShowReplace(false); setFindOpen(true); setNameManagerOpen(false); setInconsistencyPanelOpen(false); }, []);
  const onOpenReplace = useCallback(() => { setFindShowReplace(true); setFindOpen(true); setNameManagerOpen(false); setInconsistencyPanelOpen(false); }, []);
  // ORG SCOPE (NEW-1) — hoisted above the view-preference hooks below so they can key on the
  // right thing (a project id, or an org workbook id) without reordering any hook relative to
  // the rest of this component. `orgMode` requires `projectId` to be null BY CONSTRUCTION
  // (route.js never sets `org` and `projectId` together — invariant §14, docs/DATA.md), checked
  // here too rather than trusted blindly. The fuller org-scope block further down
  // (openOrgWorkbook/openWorkbook/storageKey, the workbook list + its CRUD) builds on these two.
  const orgMode = !!org && !crossProject && !projectId;
  const [orgWorkbookId, setOrgWorkbookId] = useState(null);
  const viewPrefsKey = orgMode ? orgWorkbookId : projectId;

  // B1007280 — sheet zoom is a per-workbook VIEW preference (like a browser's own zoom level),
  // never sheet DATA: it doesn't ride the undo stack and doesn't sync to the cloud, so two
  // people (or two tabs) looking at the same model have no reason to share a zoom level.
  const [zoom, setZoom] = useState(() => readZoom(viewPrefsKey));
  useEffect(() => { setZoom(readZoom(viewPrefsKey)); }, [viewPrefsKey]);
  const onZoomChange = useCallback((z) => { setZoom(z); writeZoom(viewPrefsKey, z); }, [viewPrefsKey]);

  // STAGE 3 (NEW-2) — the input/formula/cross-sheet-link colour toggle. Same "view preference,
  // not sheet data" treatment as zoom: never through undo/redo, never synced to the cloud (a
  // colleague looking at the same cloud model has no reason to share this device's toggle), but
  // — UNLIKE painter/filterOn — persisted across a reload, because it's a standing display
  // choice ("I turned this off because I use my own font colours") rather than a mid-task
  // gesture that would be confusing to find still armed after a reload.
  const [autoColor, setAutoColorState] = useState(() => readAutoColor(viewPrefsKey));
  useEffect(() => { setAutoColorState(readAutoColor(viewPrefsKey)); }, [viewPrefsKey]);
  const onAutoColorToggle = useCallback(() => {
    setAutoColorState((v) => { const next = !v; writeAutoColor(viewPrefsKey, next); return next; });
  }, [viewPrefsKey]);

  // STAGE 2 — THE RIBBON (B1007281). Format Painter's captured source ({format, style} — see
  // sheetModel.js's paintedStyleAt) while armed, or null. AutoFilter's on/off switch and its
  // per-column choices (colIndex -> Set of allowed display values; a column absent from the map
  // is unfiltered). All THREE are plain view state — like zoom, never through undo/redo, never
  // synced — but UNLIKE zoom, deliberately NOT persisted across a reload either: a stray armed
  // painter or an active filter surviving a reload would be confusing ("why did my cells just
  // repaint themselves") in a way an unchanged zoom level never is, so both simply reset with
  // the workbook.
  const [painter, setPainter] = useState(null); // { source: {format, style} } | null
  const [filterOn, setFilterOn] = useState(false);
  const [columnFilters, setColumnFilters] = useState(() => new Map());
  useEffect(() => { setPainter(null); setFilterOn(false); setColumnFilters(new Map()); }, [viewPrefsKey]);
  // Format Painter needs the CURRENT selection at the moment a click/drag settles (SheetView's
  // onSelectionSettled), not the value selRange held when the painter was armed — a ref mirror,
  // the same pattern zoomRef (SheetView.jsx) already uses for exactly this reason.
  const selRangeRef = useRef(selRange);
  useEffect(() => { selRangeRef.current = selRange; }, [selRange]);

  const openProject = !crossProject && !!projectId;

  // ORG SCOPE (NEW-1), continued from `orgMode`/`orgWorkbookId` above (hoisted for the view-
  // preference hooks). A stray prop combination (org true but projectId also somehow set) falls
  // through `orgMode`'s own guard to the plain empty state in the render below, rather than
  // silently mis-happening on whatever `projectId` last named (the "URL is a hint, not an
  // address" trap B1020928 warns against).
  const [orgWorkbooks, setOrgWorkbooks] = useState(() => readLocalOrgIndex(userId));
  const [orgListLoading, setOrgListLoading] = useState(false);
  const [orgListNotice, setOrgListNotice] = useState(null);
  const openOrgWorkbook = orgMode && !!orgWorkbookId;
  // The umbrella "is a workbook actually open" condition — a project's own single workbook, or a
  // chosen org workbook. Mutually exclusive by construction (`orgMode` already requires no
  // `projectId`), so `storageKey` below is never ambiguous about which one it names.
  const openWorkbook = openProject || openOrgWorkbook;
  const storageKey = openProject ? projectId : (openOrgWorkbook ? orgWorkbookId : null);
  const orgWorkbookName = useMemo(
    () => orgWorkbooks.find((w) => w.id === orgWorkbookId)?.name || "Untitled workbook",
    [orgWorkbooks, orgWorkbookId],
  );
  // Leaving Organization (switching tabs elsewhere, or picking a project) always drops back to
  // the workbook list — never carry a stale workbook selection into a context that no longer
  // names it.
  useEffect(() => { if (!orgMode) setOrgWorkbookId(null); }, [orgMode]);
  // The workbook LIST: local cache first (instant, and all a signed-out account has), then
  // reconciled against the cloud (source of truth once reachable) — the same "local first, then
  // reconcile" shape the single-workbook load effect below uses for CONTENT, applied here to the
  // LIST of what exists. A workbook this device created but hasn't synced yet stays in the merged
  // list even if the cloud fetch doesn't (yet) know about it.
  useEffect(() => {
    if (!orgMode) return undefined;
    setOrgWorkbooks(readLocalOrgIndex(userId));
    setOrgListNotice(null);
    let live = true;
    setOrgListLoading(true);
    (async () => {
      const r = await listOrgWorkbooksCloud();
      if (!live) return;
      if (r.ok) {
        const cloudIds = new Set(r.rows.map((w) => w.id));
        const localOnly = readLocalOrgIndex(userId).filter((w) => !cloudIds.has(w.id));
        const merged = [...r.rows, ...localOnly].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        setOrgWorkbooks(merged);
        writeLocalOrgIndex(userId, merged);
      } else if (r.reason === "not-provisioned") {
        setOrgListNotice("Cloud backup for organization workbooks isn't turned on yet — saved on this device only.");
      }
    })().finally(() => { if (live) setOrgListLoading(false); });
    return () => { live = false; };
  }, [orgMode, userId]);

  const onOrgCreate = useCallback(() => {
    const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `wb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const name = "Untitled workbook";
    const wb = createWorkbook();
    writeLocalSheet(userId, id, wb);
    setOrgWorkbooks(touchLocalOrgIndex(userId, { id, name, updatedAt: Date.now() }));
    setOrgWorkbookId(id);
    if (userId) saveOrgWorkbookCloud({ uid: userId, id, name, sheet: wb, expected: null }).catch(() => {});
  }, [userId]);
  const onOrgOpen = useCallback((id) => setOrgWorkbookId(id), []);
  const onOrgRename = useCallback((id, name) => {
    setOrgWorkbooks(touchLocalOrgIndex(userId, { id, name, updatedAt: Date.now() }));
    if (userId) renameOrgWorkbookCloud(userId, id, name).catch(() => {});
  }, [userId]);
  const onOrgDelete = useCallback((id) => {
    setOrgWorkbooks(removeLocalOrgIndexEntry(userId, id));
    setOrgWorkbookId((cur) => (cur === id ? null : cur));
    if (userId) deleteOrgWorkbookCloud(userId, id).catch(() => {});
  }, [userId]);
  const onBackToOrgWorkbooks = useCallback(() => setOrgWorkbookId(null), []);

  /* ---- load: local first (synchronous, always available), then reconcile against the cloud.
   * Local wins whenever it already exists on this device — see the file header for why. Reads
   * `storageKey` (a project id, or an org workbook id — never both, see `openWorkbook` above);
   * the cloud half branches on which one is actually open. */
  useEffect(() => {
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    cloudVersionRef.current = null;
    setStatus("idle");
    setCloudConfirmed(false);
    if (!openWorkbook) { const wb = createWorkbook(); reset(wb); setActiveSheetId(wb.activeSheetId); setReady(false); return undefined; }
    const local = readLocalSheet(userId, storageKey);
    const initialWorkbook = local ? migrateWorkbook(local) : createWorkbook();
    reset(initialWorkbook);
    setActiveSheetId(initialWorkbook.activeSheetId);
    setReady(true);
    let live = true;
    (async () => {
      const r = openProject ? await loadCloudSheet(projectId) : await loadOrgWorkbookCloud(orgWorkbookId);
      if (!live || loadTokenRef.current !== token) return;
      if (r.ok) {
        cloudVersionRef.current = r.version;
        setCloudConfirmed(true);
        // R3 — a workbook made signed-out (scope "local") is adopted once into this account's scope.
        const anon = openProject && userId && !local ? readLocalSheet(null, storageKey) : null;
        const adoption = decideAnonAdoption({ userId, userLocal: local, cloudSheet: r.sheet, cloudOk: true, anonLocal: anon,
          diverges: anon && r.sheet ? sheetsDiverge(migrateWorkbook(anon), migrateWorkbook(r.sheet)) : false });
        if (adoption === "adopt") {
          const adopted = migrateWorkbook(anon); // the write-through + debounced push effects persist it under this account
          reset(adopted);
          setActiveSheetId(adopted.activeSheetId);
        } else if (!local && r.sheet) {
          if (adoption === "diverged") setStatus("diverged");
          const cloudWorkbook = migrateWorkbook(r.sheet);
          reset(cloudWorkbook);
          setActiveSheetId(cloudWorkbook.activeSheetId);
        } else if (local && r.sheet) {
          // Both a local copy AND a saved cloud copy exist. "Local always wins on load" (the
          // file header) means this device keeps showing ITS content — but if that content
          // actually differs from what's in the cloud, the very next edit will silently
          // overwrite the cloud copy at a clean version bump (no CAS conflict, because nothing
          // raced — this device's `cloudVersionRef` is genuinely current). That is a real
          // second-device data-loss path, not a hypothetical one, so it is surfaced loudly
          // rather than left to happen quietly.
          if (sheetsDiverge(migrateWorkbook(local), migrateWorkbook(r.sheet))) setStatus("diverged");
        }
      } else if (r.reason === "not-provisioned") {
        setStatus("not-provisioned");
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, openWorkbook, openProject, projectId, orgWorkbookId, userId]);

  /* Write-through local save on every commit — never debounced (the stored copy must never
   * be staler than the screen: a tab close a moment after typing must not lose that edit). */
  useEffect(() => {
    if (!ready || !openWorkbook) return;
    if (!writeLocalSheet(userId, storageKey, workbook)) setStatus("error");
  }, [workbook, ready, openWorkbook, storageKey, userId]);

  /* Best-effort, debounced cloud push through the guarded save path. Reads `status` without
   * depending on it — this must fire only on a WORKBOOK change, not on every status transition
   * the push itself causes (that would restart the debounce on its own "saving" flag). */
  useEffect(() => {
    if (!ready || !openWorkbook || !userId) return undefined;
    if (status === "not-provisioned") return undefined; // stop hammering a table that isn't there yet
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      setStatus("saving");
      const r = openProject
        ? await saveCloudSheet({ uid: userId, projectId, sheet: workbook, expected: cloudVersionRef.current })
        : await saveOrgWorkbookCloud({ uid: userId, id: orgWorkbookId, name: orgWorkbookName, sheet: workbook, expected: cloudVersionRef.current });
      if (r.ok) {
        cloudVersionRef.current = r.version; setCloudConfirmed(true); setStatus("saved");
        if (!openProject) setOrgWorkbooks(touchLocalOrgIndex(userId, { id: orgWorkbookId, name: orgWorkbookName, updatedAt: Date.now() }));
      }
      else if (r.reason === "not-provisioned") setStatus("not-provisioned");
      else if (r.reason === "conflict") setStatus("conflict");
      else if (r.reason === "unavailable") setStatus("idle");
      else setStatus("error");
    }, CLOUD_PUSH_DEBOUNCE_MS);
    return () => clearTimeout(pushTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbook, ready, openWorkbook, openProject, projectId, orgWorkbookId, orgWorkbookName, userId]);

  // Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z (or +Y), Ctrl+G (Name Box), Ctrl+F / Ctrl+H (Find/Replace) —
  // SheetView deliberately leaves every Ctrl/Cmd chord alone so this can own them, gated on
  // `isActive` the same way Notes gates its own window shortcut: workspaces stay
  // mounted-but-hidden, so an ungated listener fires from a tab nobody is looking at.
  useEffect(() => {
    if (!isActive) return undefined;
    const onKey = (e) => {
      // STAGE 3 (NEW-1) — Esc clears an active trace, the "way to clear" the build brief asks
      // for, alongside the ribbon's own Remove Arrows button. A no-op when no trace is active.
      // ⛔ MEASURED LIVE: a ribbon control collapsed into the "More ▾" overflow (Ribbon.jsx's
      // MoreMenu — common even at an ordinary desktop width, since this module's own ribbon is
      // already dense) leaves that popover open after a click (pre-existing behavior — closed
      // only by Escape, its own outside-click, or the trigger). Escape is the natural way to
      // dismiss it, but this listener is a bare `window` one and would fire on the SAME
      // keypress — clearing a trace the very click that opened More was reaching for. So: a
      // floating menu/panel with current focus gets Escape FIRST (its own handler closes it);
      // this only clears the trace when nothing else is already claiming the key.
      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey) {
        if (e.target instanceof Element && e.target.closest('.menu, [role="dialog"]')) return;
        setTrace((t) => (t ? null : t));
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
      else if (k === "g") { e.preventDefault(); nameBoxRef.current?.focus(); }
      else if (k === "f") { e.preventDefault(); onOpenFind(); }
      else if (k === "h") { e.preventDefault(); onOpenReplace(); }
      // NEW-1 (command palette, owner chat block) — Ctrl/Cmd+K. Notes' own QuickOpen already
      // claims this chord for that (separate, mounted-but-hidden when this workspace is active)
      // workspace, so there's no live collision to guard against.
      else if (k === "k") { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, undo, redo, onOpenFind, onOpenReplace]);

  // STAGE 3 (NEW-1) — evaluated across the WHOLE WORKBOOK, always, regardless of which sheet is
  // currently visible: a cross-sheet formula on one sheet needs every OTHER sheet's cells (its
  // own formulas included) to be live inputs, not just the one tab the user happens to be
  // looking at. `.get(activeSheetId)` slices out the visible sheet's own results for
  // SheetView/displayFor/etc, which stay unaware anything changed.
  const workbookEval = useMemo(() => evaluateWorkbook(workbook, { projectNames }), [workbook, projectNames]);
  const evalResult = workbookEval.get(activeEntry.id);
  const totalRows = sheet.rowCount + padRowCount(sheet, 20);

  // ⛔ B1117408 (owner brief 2026-09-03) — every write below must land on the sheet CURRENTLY
  // BEING VIEWED (`activeSheetId`, the plain-navigation state declared above `sheet`/`sheetName`),
  // never on `workbook.activeSheetId`'s OWN stored copy. A bare tab click deliberately never
  // touches that field (see `activeSheetId`'s own header a few lines up) — a plain tab is
  // navigation, not a content edit, and must never mint an undo frame — so `workbook.activeSheetId`
  // is free to sit stale after a tab switch with nothing wrong having happened YET. The bug this
  // fixes: every handler below used to call `applyToActiveSheet(wb, …)` / `workbookInsertRowAt(wb,
  // …)` directly, which resolve the target sheet from that same stale `workbook.activeSheetId` —
  // so typing into the tab you just switched TO silently committed into the tab you were just ON.
  // Composing `setActiveSheet(wb, activeSheetId)` into the SAME `commit` call as the real edit
  // (rather than syncing it as a separate, un-history'd write) means "which sheet is on screen"
  // and "which sheet this edit lands on" are the same value by construction, on EVERY commit,
  // however far undo/redo has wandered in between — there is no second stored copy left to drift.
  const applyActive = useCallback(
    (fn, ...args) => commit((wb) => applyToActiveSheet(setActiveSheet(wb, activeSheetId), fn, ...args)),
    [commit, activeSheetId],
  );
  const applyStructuralActive = useCallback(
    (fn, ...args) => commit((wb) => fn(setActiveSheet(wb, activeSheetId), ...args)),
    [commit, activeSheetId],
  );

  const onCommitCell = useCallback((r, c, text) => applyActive(commitCellText, r, c, text), [applyActive]);
  const onBlankRange = useCallback((r1, r2, c1, c2) => applyActive(blankRange, r1, r2, c1, c2), [applyActive]);
  const onRenameColumn = useCallback((c, name) => applyActive(renameColumn, c, name), [applyActive]);
  const onAddColumn = useCallback(() => applyActive(addColumn), [applyActive]);

  // STAGE 3 (NEW-1) — the sheet tab strip. `onSelectSheetTab` is pure navigation (see the
  // `activeSheetId` state's own header above — never through `commit`); the other four are real
  // content edits and go through the undo stack like everything else, syncing the view's
  // `activeSheetId` afterward since add/duplicate/delete all pick a new active sheet themselves.
  const onSelectSheetTab = useCallback((id) => setActiveSheetId(id), []);
  const onAddSheetTab = useCallback(() => {
    const next = addSheet(workbook);
    commit(next);
    setActiveSheetId(next.activeSheetId);
  }, [commit, workbook]);
  const onDuplicateSheetTab = useCallback((id) => {
    const next = duplicateSheet(workbook, id);
    if (next === workbook) return;
    commit(next);
    setActiveSheetId(next.activeSheetId);
  }, [commit, workbook]);
  const onRenameSheetTab = useCallback((id, name) => commit((wb) => renameSheet(wb, id, name)), [commit]);
  const onDeleteSheetTab = useCallback((id) => {
    const next = deleteSheet(workbook, id);
    if (next === workbook) return;
    commit(next);
    setActiveSheetId(next.activeSheetId);
  }, [commit, workbook]);
  const onReorderSheetTab = useCallback((from, to) => commit((wb) => reorderSheet(wb, from, to)), [commit]);
  // NEW-1 (command palette) — "add/rename/duplicate/delete sheet" from the palette acts on the
  // CURRENTLY VIEWED sheet, calling the exact same onXSheetTab handlers TabStrip's own UI does
  // (a click, the right-click menu, a double-click-to-rename). `onRenameSheetCurrent` opens the
  // SAME inline editor a double-click does, via TabStrip's own imperative handle — never a second
  // rename mechanism.
  const onDuplicateSheetCurrent = useCallback(() => onDuplicateSheetTab(activeSheetId), [onDuplicateSheetTab, activeSheetId]);
  const onRenameSheetCurrent = useCallback(() => tabStripRef.current?.startRename(activeSheetId), [activeSheetId]);
  const onDeleteSheetCurrent = useCallback(() => onDeleteSheetTab(activeSheetId), [onDeleteSheetTab, activeSheetId]);

  // Excel round-trip (NEW-1, owner chat block) — FileMenu.jsx's four actions. `fileBusy` disables
  // the File button for the duration of an export/import (both are async — ExcelJS's own parse/
  // write is not instant on a real multi-sheet workbook); `fileNotice` is the one LOUD-FAILURE /
  // import-summary line FileMenu renders next to the button, auto-dismissed below. A plain
  // successful EXPORT gets no notice at all (the browser's own download UI is feedback enough,
  // PANEL-BREVITY) — only an IMPORT (which changes what's on screen) or a genuine error does.
  const [fileBusy, setFileBusy] = useState(false);
  const [fileNotice, setFileNotice] = useState(null); // { kind: "warn" | "error", text } | null
  useEffect(() => {
    if (!fileNotice) return undefined;
    const t = setTimeout(() => setFileNotice(null), 9000);
    return () => clearTimeout(t);
  }, [fileNotice]);
  // NEW-1 (owner chat block, 2026-09-05) — Import Excel replaces the WHOLE workbook, and used to
  // do it unconditionally: importing a two-sheet file into a workbook that already had a real
  // Sheet1 silently discarded it, with nothing in the label or the flow saying so (Ctrl+Z recovers
  // it, but that doesn't survive a reload, so it isn't a substitute for asking first). A file is
  // only ever queued here — never read/parsed yet — while `workbookHasContent(workbook)` says the
  // CURRENT workbook has something in it to lose; an empty workbook (a brand-new project, or one
  // nobody has typed into) still imports immediately, no prompt, exactly as before.
  const [pendingXlsxImport, setPendingXlsxImport] = useState(null); // { file, sheetCount } | null

  const currentFileBaseName = useCallback(() => {
    if (openOrgWorkbook) return sanitizeFilename(orgWorkbookName);
    let name = "Workbook";
    if (projectId) name = projectNameOf(projectId, "") || name;
    return sanitizeFilename(name);
  }, [projectId, openOrgWorkbook, orgWorkbookName]);

  const onExportXlsx = useCallback(async () => {
    setFileBusy(true);
    try {
      const { exportWorkbookToXlsxBlob } = await loadXlsxIO();
      const blob = await exportWorkbookToXlsxBlob(workbook, { projectNames });
      downloadBlob(blob, `${currentFileBaseName()}.xlsx`);
    } catch (e) {
      setFileNotice({ kind: "error", text: `Export to Excel failed: ${e?.message || e}` });
    } finally { setFileBusy(false); }
  }, [workbook, currentFileBaseName, projectNames]);

  const onExportCsv = useCallback(() => {
    try {
      const csv = sheetToCsv(sheet, evalResult);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      downloadBlob(blob, `${sanitizeFilename(sheetName)}.csv`);
    } catch (e) {
      setFileNotice({ kind: "error", text: `Export to CSV failed: ${e?.message || e}` });
    }
  }, [sheet, evalResult, sheetName]);

  const runXlsxImport = useCallback(async (file) => {
    setFileBusy(true);
    try {
      const { importXlsxToWorkbook } = await loadXlsxIO();
      const buf = await file.arrayBuffer();
      const { workbook: imported, unsupportedCount } = await importXlsxToWorkbook(buf);
      commit(imported);
      setActiveSheetId(imported.activeSheetId);
      setFileNotice({
        kind: "warn",
        text: unsupportedCount > 0
          ? `Imported "${file.name}" — ${unsupportedCount} formula${unsupportedCount === 1 ? "" : "s"} used an unsupported function and were kept as values (hover the marked cells). Ctrl+Z undoes the import.`
          : `Imported "${file.name}". Ctrl+Z undoes the import.`,
      });
    } catch (e) {
      // NEW-2 (owner chat block, 2026-09-05) — xlsxIO.js's own importXlsxToWorkbook already turns
      // any raw ExcelJS/JSZip failure into one plain sentence before it ever reaches here (see its
      // header), so `e.message` is always safe to show verbatim now — never string-built from a
      // dependency's own developer-facing text.
      setFileNotice({ kind: "error", text: `Could not read "${file.name}" as an Excel file: ${e?.message || e}` });
    } finally { setFileBusy(false); }
  }, [commit]);

  const onImportXlsxFile = useCallback((file) => {
    if (workbookHasContent(workbook)) { setPendingXlsxImport({ file, sheetCount: workbook.sheets.length }); return; }
    runXlsxImport(file);
  }, [workbook, runXlsxImport]);

  const onConfirmXlsxImport = useCallback(() => {
    const pending = pendingXlsxImport;
    setPendingXlsxImport(null);
    if (pending) runXlsxImport(pending.file);
  }, [pendingXlsxImport, runXlsxImport]);

  const onCancelXlsxImport = useCallback(() => setPendingXlsxImport(null), []);

  const onImportCsvFile = useCallback(async (file) => {
    setFileBusy(true);
    try {
      const text = await file.text();
      const desiredName = file.name.replace(/\.csv$/i, "") || "Imported";
      const next = addSheetFromCsvText(workbook, text, desiredName);
      commit(next);
      setActiveSheetId(next.activeSheetId);
      setFileNotice({ kind: "warn", text: `Imported "${file.name}" as a new sheet. Ctrl+Z undoes the import.` });
    } catch (e) {
      // NEW-2's "check the CSV path too" (owner chat block): csvIO.js's parser is hand-rolled with
      // no dependency to leak a developer-facing error out of (parseCsv never throws — any bytes
      // decode to SOME set of rows/cells; `file.text()` reading a real File object doesn't throw
      // either). Nothing here composes a library's own internal message, so this is left as is.
      setFileNotice({ kind: "error", text: `Could not read "${file.name}" as CSV: ${e?.message || e}` });
    } finally { setFileBusy(false); }
  }, [workbook, commit]);

  // NEW-1 (command palette) — "Import Excel File"/"Import CSV File" click the SAME hidden file
  // input FileMenu's own "Import Excel…"/"Import CSV…" menu items click, via its imperative
  // handle — never a second file-picker trigger.
  const onOpenImportXlsx = useCallback(() => fileMenuRef.current?.openImportXlsx(), []);
  const onOpenImportCsv = useCallback(() => fileMenuRef.current?.openImportCsv(), []);

  // Copy/paste/fill-down (items 6/7) — the internal clipboard round-trips a snapshot of raw
  // cell text (see lib/sheetOps.js); paste and fill-down both shift a formula's relative A1
  // references by the destination delta, exactly like dragging Excel's fill handle. All three
  // operate on the ACTIVE sheet only — pasting a cross-sheet formula's qualifier rides through
  // untouched (rewriteFormulaForCopy preserves it — see formula.js's own header).
  const onCopy = useCallback((r1, r2, c1, c2) => { clipboardRef.current = copyRange(sheet, r1, r2, c1, c2); }, [sheet]);
  const onPaste = useCallback((targetR, targetC, selR1, selR2, selC1, selC2) => {
    if (!clipboardRef.current) return;
    applyActive(pasteRange, targetR, targetC, clipboardRef.current, selR2, selC2);
  }, [applyActive]);
  const onFillDown = useCallback((r1, r2, c1, c2) => applyActive(fillDown, r1, r2, c1, c2), [applyActive]);

  // Stage 1 structural editing (context-menu driven — see SheetView.jsx's ContextMenu). Every
  // one of these shifts formula references sheet-wide on the ACTIVE sheet AND sweeps every
  // OTHER sheet for a cross-sheet reference into it (Stage 3, NEW-1 — see the `workbook*`
  // wrappers in sheetModel.js for why this needs a workbook-level function, not a plain
  // per-sheet mutator).
  const onInsertRowAt = useCallback((rowIndex) => applyStructuralActive(workbookInsertRowAt, rowIndex), [applyStructuralActive]);
  const onDeleteRowAt = useCallback((rowIndex) => applyStructuralActive(workbookDeleteRowAt, rowIndex), [applyStructuralActive]);
  const onInsertColumnAt = useCallback((colIndex) => applyStructuralActive(workbookInsertColumnAt, colIndex), [applyStructuralActive]);
  const onDeleteColumnAt = useCallback((colIndex) => {
    if (sheet.columns.length <= 1) return;
    applyStructuralActive(workbookDeleteColumn, colIndex);
  }, [applyStructuralActive, sheet.columns.length]);
  const onSetColumnWidth = useCallback((colIndex, width) => applyActive(setColumnWidth, colIndex, width), [applyActive]);
  const onSetRowHeight = useCallback((rowIndex, height) => applyActive(setRowHeight, rowIndex, height), [applyActive]);
  // Freeze panes goes through the normal commit/undo path like every other edit here — NOT
  // `reset` (that primitive wipes the whole undo history, meant only for adopting a load/sync
  // result, never a user action taken mid-session).
  const onSetFreeze = useCallback((rows, cols) => applyActive(setFreeze, rows, cols), [applyActive]);

  // Name Box / Find navigation — a plain jump, not an edit, so it never mints an undo frame.
  // r2/c2 default to r1/c1 so Find's own single-cell `onGoTo(r, c)` call needs no change;
  // the Name Box (B1007280 — "C50:E60" range support) passes all four for a real range.
  const onGoTo = useCallback((r1, c1, r2 = r1, c2 = c1) => setSelRange({ r1, r2, c1, c2 }), [setSelRange]);
  // "Replace" (singular) touches only the ONE cell the Find bar is currently sitting on — every
  // occurrence within that cell's own text, the same substring rule replaceAll uses everywhere
  // else, so "one cell = one match" stays consistent between the counter and the action.
  const onReplaceOne = useCallback((match, find, replace) => {
    const current = rawAt(sheet, match.r, match.c);
    applyActive(commitCellText, match.r, match.c, replaceInCellText(current, find, replace));
  }, [applyActive, sheet]);
  const onReplaceAll = useCallback((find, replace) => applyActive(replaceAll, find, replace), [applyActive]);

  // Stage 3 pt 2 (NEW-1) — named ranges. Every one of these commits (one undo frame each, like
  // every other edit here); validation itself happens in the Name Manager UI (validateNameText)
  // BEFORE it ever calls onDefineName/onRenameName, matching sheetModel.js's own "mutators are
  // pure setters, validation lives at the UI boundary" convention.
  const onDefineName = useCallback((name, rect) => applyActive(defineName, name, rect), [applyActive]);
  const onRenameName = useCallback((oldName, newName) => applyActive(renameName, oldName, newName), [applyActive]);
  const onRetargetName = useCallback((name, rect) => applyActive(retargetName, name, rect), [applyActive]);
  const onDeleteName = useCallback((name) => applyActive(deleteName, name), [applyActive]);
  // Both this panel and Find/Replace float at the same fixed screen position (top-right — see
  // each component's own header), so they never coexist: opening one closes the other, rather
  // than reserving a second screen position that would crowd the owner's real 729px-wide window.
  const onToggleNameManager = useCallback(() => {
    setNameManagerOpen((o) => { if (!o) { setFindOpen(false); setInconsistencyPanelOpen(false); } return !o; });
  }, []);

  // STAGE 3 (NEW-1) — trace precedents/dependents. Clicking the SAME button again on the SAME
  // selection extends the trace one level further (lib/traceAudit.js's `beginOrStepTrace`
  // decides that from the existing `trace` vs. the new click); clicking the OTHER trace button,
  // or a different cell, starts fresh. `graph` is sheetEngine.js's own read-only walk of the
  // ALREADY-COMPUTED dependency graph (workbookEval, below) — tracing costs nothing beyond the
  // recalc that already ran this render.
  const graph = workbookEval.graph;
  const onTracePrecedents = useCallback(() => {
    setTrace((t) => beginOrStepTrace(t, "precedents", activeEntry.id, selRange.r1, selRange.c1, graph));
  }, [activeEntry.id, selRange, graph]);
  const onTraceDependents = useCallback(() => {
    setTrace((t) => beginOrStepTrace(t, "dependents", activeEntry.id, selRange.r1, selRange.c1, graph));
  }, [activeEntry.id, selRange, graph]);
  const onClearTrace = useCallback(() => setTrace(null), []);
  // A cross-sheet marker click (SheetView.jsx) — pure navigation, the same "plain tab click,
  // never through commit" convention `onSelectSheetTab` above already uses.
  const onNavigateTrace = useCallback((sheetId, row, col) => {
    setActiveSheetId(sheetId);
    setSelRange({ r1: row, r2: row, c1: col, c2: col });
  }, []);
  const renderedTrace = useMemo(() => renderableTrace(trace, graph, activeEntry.id), [trace, graph, activeEntry.id]);

  // STAGE 3 (NEW-2) — inconsistent-formula flags for the ACTIVE sheet, recomputed fresh on every
  // sheet change (pure, no persisted state of its own — see lib/formulaConsistency.js's header).
  // `activeFlags` is what's actually drawn/listed — everything the FULL list holds minus what's
  // been explicitly dismissed (`sheet.dismissedInconsistencies`, the one piece of state about
  // these flags that DOES persist).
  const allInconsistencies = useMemo(() => findInconsistencies(sheet), [sheet]);
  const activeInconsistencies = useMemo(
    () => allInconsistencies.filter((f) => !isInconsistencyDismissed(sheet, f.row, f.col)),
    [allInconsistencies, sheet],
  );
  const onDismissInconsistency = useCallback((row, col) => {
    applyActive(setInconsistencyDismissed, row, col, true);
  }, [applyActive]);
  const onToggleInconsistencyPanel = useCallback(() => {
    setInconsistencyPanelOpen((o) => { if (!o) { setFindOpen(false); setNameManagerOpen(false); } return !o; });
  }, []);

  const activeCol = selRange.c1;
  // Per-cell format (item 4/pro-forma finding): the picker reflects and edits the ACTIVE
  // cell's own format, and applying a preset touches only the currently selected RANGE of
  // cells — never the whole column, which is what let one percent-formatted cell repaint
  // every dollar amount above it in the same column.
  const activeFormat = formatAt(sheet, selRange.r1, selRange.c1);
  const onApplyFormat = useCallback((token) => {
    applyActive(setNumberFormat, selRange.r1, selRange.r2, selRange.c1, selRange.c2, token);
  }, [applyActive, selRange]);
  const onDeleteColumn = useCallback(() => {
    if (sheet.columns.length <= 1) return;
    applyStructuralActive(workbookDeleteColumn, activeCol);
    setSelRange({ r1: 0, r2: 0, c1: 0, c2: 0 });
  }, [applyStructuralActive, activeCol, sheet.columns.length]);

  // ---- STAGE 2 — THE RIBBON (B1007281) — every handler below acts on the current SELECTION
  // RANGE, not just the active cell (select B2:D40, hit currency, all of them change), the same
  // contract onApplyFormat above already established.
  const activeStyle = styleAt(sheet, selRange.r1, selRange.c1);
  const mergedHere = !!mergeAt(sheet, selRange.r1, selRange.c1);

  const onSetCellStyle = useCallback((patch) => {
    applyActive(setCellStyle, selRange.r1, selRange.r2, selRange.c1, selRange.c2, patch);
  }, [applyActive, selRange]);
  const onApplyBorderCmd = useCallback(({ edges, style, mode }) => {
    applyActive(applyBorder, selRange.r1, selRange.r2, selRange.c1, selRange.c2, { edges, style, mode });
  }, [applyActive, selRange]);
  const onClearFormattingCmd = useCallback(() => {
    applyActive(clearFormatting, selRange.r1, selRange.r2, selRange.c1, selRange.c2);
  }, [applyActive, selRange]);
  const onNumberFormatOp = useCallback((op) => {
    const fn = op === "increaseDecimals" ? increaseDecimals : op === "decreaseDecimals" ? decreaseDecimals : toggleThousands;
    applyActive(setNumberFormat, selRange.r1, selRange.r2, selRange.c1, selRange.c2, fn(activeFormat));
  }, [applyActive, selRange, activeFormat]);

  // Format Painter — arm/disarm on click (capturing the CURRENT active cell's format+style);
  // applying happens in onSelectionSettled below, fired by SheetView the moment the user's next
  // click or drag actually settles on a target — see that prop's own header note for why.
  const onFormatPainterToggle = useCallback(() => {
    setPainter((p) => (p ? null : { source: paintedStyleAt(sheet, selRange.r1, selRange.c1) }));
  }, [sheet, selRange]);
  const onSelectionSettled = useCallback(() => {
    setPainter((p) => {
      if (!p) return p;
      const sr = selRangeRef.current;
      applyActive(applyPaintedStyle, sr.r1, sr.r2, sr.c1, sr.c2, p.source);
      return null;
    });
  }, [applyActive]);

  const onMergeToggle = useCallback(() => {
    applyActive((s) => {
      const m = mergeAt(s, selRange.r1, selRange.c1);
      return m ? unmergeAt(s, selRange.r1, selRange.c1) : mergeRange(s, selRange.r1, selRange.r2, selRange.c1, selRange.c2);
    });
  }, [applyActive, selRange]);

  // Insert/Delete (Cells group) act on the single active row/column — the right-click context
  // menu (SheetView.jsx) is the multi-row/column-aware path; the ribbon mirrors Excel's own
  // ribbon behavior for a plain cell selection.
  const onRibbonInsertRow = useCallback(() => onInsertRowAt(selRange.r1), [onInsertRowAt, selRange]);
  const onRibbonInsertColumn = useCallback(() => onInsertColumnAt(selRange.c1), [onInsertColumnAt, selRange]);
  const onRibbonDeleteRow = useCallback(() => onDeleteRowAt(selRange.r1), [onDeleteRowAt, selRange]);

  const onSetFreezeTopRow = useCallback(() => onSetFreeze(1, sheet.freezeCols), [onSetFreeze, sheet.freezeCols]);
  const onSetFreezeFirstColumn = useCallback(() => onSetFreeze(sheet.freezeRows, 1), [onSetFreeze, sheet.freezeRows]);
  const onSetFreezeAtSelection = useCallback(() => onSetFreeze(selRange.r1, selRange.c1), [onSetFreeze, selRange]);
  const onUnfreeze = useCallback(() => onSetFreeze(0, 0), [onSetFreeze]);

  // Sort (Sort & Filter). A one-row/one-cell selection sorts the WHOLE contiguous used range of
  // the active column instead of no-op'ing — Excel's own "select one cell, hit Sort" behavior,
  // and far more useful on a real pro-forma than requiring an exact range be dragged first.
  const onSort = useCallback((direction) => {
    let r1 = selRange.r1, r2 = selRange.r2;
    if (r1 === r2) { const used = usedRangeEnd(sheet); r1 = 0; r2 = used ? used.row : 0; }
    applyActive(sortRange, r1, r2, selRange.c1, direction);
  }, [applyActive, selRange, sheet]);

  const onFilterToggle = useCallback(() => setFilterOn((v) => !v), []);
  const onSetColumnFilter = useCallback((colIndex, allowedOrNull) => {
    setColumnFilters((prev) => {
      const next = new Map(prev);
      if (allowedOrNull) next.set(colIndex, allowedOrNull); else next.delete(colIndex);
      return next;
    });
  }, []);
  // The WHOLE AutoFilter mechanism on the reading side is "which rows does the active filter set
  // hide" — SheetView/rowLayout.js do the rest (a hidden row renders at zero height, see
  // rowLayout.js's own header). Skipped entirely (null) the moment no column has an active
  // filter, so a sheet that never uses AutoFilter pays nothing for it.
  const hiddenRows = useMemo(() => {
    if (columnFilters.size === 0) return null;
    const hidden = new Set();
    for (let r = 0; r < sheet.rowCount; r++) {
      for (const [colIndex, allowed] of columnFilters) {
        if (!allowed.has(displayFor(sheet, evalResult, r, colIndex))) { hidden.add(r); break; }
      }
    }
    return hidden;
  }, [sheet, evalResult, columnFilters]);

  // ⛔ NEW-1 (command palette, owner chat block) — THE ONE `ctx` BAG, built once per render and
  // handed to three consumers: the Ribbon (the reduced Home ribbon), the permanent Formula
  // Auditing toolbar (`AuditGroup`, AppHeader row 1) and the command palette itself. Every
  // handler below is the SAME function a UI control this session already renders calls — this
  // object is assembly, not a second implementation of any of them (lib/commandRegistry.js's own
  // header spells out why that's the whole point).
  const ctx = {
    activeFormat, activeStyle: activeStyle || {}, mergedHere, freezeRows: sheet.freezeRows, freezeCols: sheet.freezeCols,
    painterArmed: !!painter, filterOn, autoColor, onAutoColorToggle,
    canUndo, canRedo, onUndo: undo, onRedo: redo,
    onSetCellStyle, onApplyBorder: onApplyBorderCmd, onApplyFormat, onNumberFormatOp, onClearFormatting: onClearFormattingCmd,
    onFormatPainterToggle, onMergeToggle,
    onInsertRow: onRibbonInsertRow, onInsertColumn: onRibbonInsertColumn, onDeleteRow: onRibbonDeleteRow, onDeleteColumn,
    canDeleteColumn: sheet.columns.length > 1,
    onSetFreezeTopRow, onSetFreezeFirstColumn, onSetFreezeAtSelection, onUnfreeze,
    onSort, onFilterToggle,
    nameManagerOpen, onToggleNameManager,
    traceMode: renderedTrace?.mode || null, traceLevel: renderedTrace?.level ?? 0,
    traceTruncated: !!renderedTrace?.truncated, traceNoFurther: !!renderedTrace?.noFurther, traceCellCount: renderedTrace?.cellCount ?? 0,
    onTracePrecedents, onTraceDependents, onClearTrace,
    inconsistencyCount: activeInconsistencies.length, inconsistencyPanelOpen, onToggleInconsistencyPanel,
    // Palette-only reach (never rendered as their own ribbon group — see ribbonLayout.js's header).
    onOpenFind, onOpenReplace,
    onAddSheetTab, onDuplicateSheetCurrent, onRenameSheetCurrent, onDeleteSheetCurrent, sheetCount: workbook.sheets.length,
    onExportXlsx, onExportCsv, onOpenImportXlsx, onOpenImportCsv,
    zoom, onZoomChange,
  };

  const projectName = useProjectName(projectId, ""); // shared/names — the one live source
  const currentProject = projectId ? { id: projectId, name: projectName || "Untitled project" } : null;

  // spreadsheet-concept-crumb (NEW-1) — a trailing breadcrumb crumb, same slot/geometry the Site
  // tab's own plan switcher occupies (ProjectBreadcrumb.jsx's `planSlot`), naming which concept the
  // sheet's Site.*/Plan.* values are quoting. `null` (no trailing crumb at all) when the project has
  // never touched the Site Planner — nothing to name, same as `Site.Acres` reading `#REF!` then.
  // Read-only here on purpose: switching concepts is the Site tab's own affordance (its plan
  // crumb), so this jumps there rather than duplicating that switcher's state/menu in this workspace.
  const conceptCrumb = openProject && conceptName ? (
    <button
      type="button"
      className="dbtn"
      onClick={() => onShellSwitch?.("site-planner")}
      title={`“${conceptName}” is the open scheme — its Site plan is what Site.*/Plan.* formulas read. Click to switch to the Site tab.`}
      data-testid="model-concept-crumb"
      style={{
        display: "flex", alignItems: "center", gap: 5, flex: "0 1 auto", minWidth: CRUMB_MIN_W, maxWidth: 200,
        height: 30, padding: "0 12px", borderRadius: RADIUS.md, border: "none",
        background: "transparent", cursor: "pointer", fontFamily: "inherit",
        fontSize: 12, fontWeight: 500, color: "var(--chrome-text)", whiteSpace: "nowrap",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{conceptName}</span>
    </button>
  ) : null;

  return (
    <div data-testid="model-root" style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--surface-page)" }}>
      <AppHeader
        module={shellModule || "model"}
        onSwitch={onShellSwitch}
        onDashboard={onGoDashboard}
        currentProject={currentProject}
        cross={crossProject}
        // ORG SCOPE (NEW-1) — passed through like every other org-capable workspace; the
        // breadcrumb reads "Organization" (never a blank/half-built crumb) while `currentProject`
        // stays null, matching Notes/Library/Scheduler's own treatment exactly.
        org={org}
        onSelectProject={(id) => onNavigate?.({ projectId: id, cross: false, org: false })}
        onNewProject={onNewProject}
        onSelectOrg={onSelectOrg}
        planSlot={conceptCrumb}
        authControl={authControl}
        accountActive={accountActive}
        saveState={openWorkbook ? modelSaveState(status, accountActive, cloudConfirmed) : null}
        saveDetail={
          status === "not-provisioned" ? "Cloud backup for Spreadsheet isn't turned on yet — saved on this device only."
          : status === "conflict" ? "This spreadsheet changed elsewhere — reload to see the latest (your edits here stayed on this device)."
          : status === "diverged" ? "This spreadsheet has different content saved from another device or browser. What you see here is safe on this device, but saving here will overwrite that other copy. Reload without editing first if you want the other copy instead."
          : undefined
        }
        multiEditOk
        // STAGE 2 ICONOGRAPHY PASS — Undo/Redo moved OUT of row 1 and into the Ribbon's own
        // leading "Actions" group (icon buttons, matching Google Sheets' own toolbar, where
        // Undo/Redo open the row rather than living in a separate header bar). Row 1 carries the
        // Excel round-trip File menu (NEW-1) — since there's no workbook to export/import before
        // a project is open — plus, since this pass, the module's OWN differentiators
        // (NEW-1, command palette): Trace Precedents/Dependents/Remove Arrows + the
        // Inconsistencies toggle now have a PERMANENT, always-visible home here rather than
        // riding the Home ribbon's own width-aware collapse (lib/ribbonLayout.js no longer lists
        // an "audit" group at all — see its header). `AuditGroup` is the SAME component/buttons/
        // testids Stage 3 shipped, just reused from a different call site with the same `ctx`.
        toolbarContent={openWorkbook ? (
          <>
            {/* ORG SCOPE (NEW-1) — the one door back to the workbook list; a project's own
                single workbook has no list to return to, so this never renders there. */}
            {openOrgWorkbook && (
              <button
                type="button"
                data-testid="org-workbook-back"
                onClick={onBackToOrgWorkbooks}
                title="Back to your organization's workbook list"
                style={{ height: 30, padding: "0 10px", borderRadius: RADIUS.md, border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)", color: "var(--chrome-text)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >‹ Workbooks</button>
            )}
            <FileMenu
              ref={fileMenuRef}
              busy={fileBusy}
              notice={fileNotice}
              confirmReplace={pendingXlsxImport ? {
                text: `Replace this workbook's ${pendingXlsxImport.sheetCount} sheet${pendingXlsxImport.sheetCount === 1 ? "" : "s"} with "${pendingXlsxImport.file.name}"?`,
                onConfirm: onConfirmXlsxImport,
                onCancel: onCancelXlsxImport,
              } : null}
              onExportXlsx={onExportXlsx}
              onExportCsv={onExportCsv}
              onImportXlsxFile={onImportXlsxFile}
              onImportCsvFile={onImportCsvFile}
            />
            <span aria-hidden="true" style={{ width: 1, height: 18, flex: "none", background: "var(--chrome-divider)" }} />
            <AuditGroup ctx={ctx} />
          </>
        ) : undefined}
      />

      {openWorkbook ? (
        <>
          {/* Round 3 visual pass (B1087904, owner verbatim: "rerun the loop to make it
              pretty, also i dont like the square edging"). The ribbon and formula bar used to be
              two full-bleed strips running edge to edge with 90-degree corners, separated by
              hairline rules — the owner's own read: "reads as stacked strips bolted to a window,
              not as a document inside an application." They are tightly coupled (the name box
              and formula bar both act on whatever the ribbon is formatting), so they join into
              ONE contained chrome card here — panel radius, inset from the window edges with the
              SAME margin the sheet card below uses, sitting on the app background rather than
              bleeding into it — with a single hairline divider marking the seam between the two
              rows inside it. `overflow: hidden` is load-bearing: it's what clips the ribbon's own
              square content to the card's rounded top corners (CHROME-NEVER-EATS-A-PRESS is not
              at issue here — nothing inside is chrome floating OVER content).
              ⛔ Round 4 — MEASURED live that this card and the sheet card below it were flush,
              0px gap, not detached. Round 3's own bottom margin here was 0 (see the sibling
              comment in SheetView.jsx, corrected in the same commit as this one) on the theory
              that the sheet card's own top margin would supply the seam — but these two cards are
              siblings inside ModelApp's ROOT FLEX COLUMN, and flex items never collapse margins
              against each other the way ordinary block siblings do, so two zeros summed to a real,
              visible zero: doubled hairlines pressed edge to edge, not two objects. The gap is now
              carried entirely by THIS card's own bottom margin (SPACE.md) — the sheet card's own
              top margin stays 0, so there is still exactly one gap, never a doubled one. */}
          <div
            data-testid="model-toolbar-card"
            style={{
              flex: "none", margin: 8, overflow: "hidden", // SPACE.md literal (all four sides) — see designTokens.js note above
              background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.lg,
              // Round 4 — the LIGHTER of the module's two card shadow levels (design-exempt: no
              // shadow-color token yet repo-wide). Round 3 gave this card and the sheet card
              // below it the SAME shadow, which reads as one flat weight rather than "tools you
              // are holding, floating above the paper" — the sheet card (SheetView.jsx, same
              // reasoning) now carries the stronger of the two.
              boxShadow: "0 1px 3px rgba(0,0,0,0.07)", // design-exempt: no shadow-color token yet repo-wide
            }}
          >
          <Ribbon ctx={ctx} />
          <FormulaBar sheet={sheet} row={selRange.r1} col={selRange.c1} onCommit={onCommitCell} onGoTo={onGoTo} nameBoxRef={nameBoxRef} focusGrid={focusGrid} />
          </div>
          {/* NEW-1 (B1251888) — Find/Replace, Name Manager, and the Inconsistencies panel all
              render IN NORMAL FLOW here, below the header row and the ribbon/formula-bar card
              above it, never as a `position: fixed` overlay guessing a top offset. A fixed-offset
              overlay is exactly what let all three drift over the header row's File menu +
              Formula Auditing buttons once pull request 1487 moved Formula Auditing there — a
              flow sibling structurally cannot cover chrome that sits earlier in the same column,
              at any window width, so the class of bug can't recur here. The three are mutually
              exclusive (opening one closes the others — see onOpenFind/onToggleNameManager/
              onToggleInconsistencyPanel below), so only one ever occupies this flow slot at once. */}
          <FindReplaceBar
            open={findOpen}
            showReplace={findShowReplace}
            sheet={sheet}
            onClose={() => setFindOpen(false)}
            onGoTo={onGoTo}
            onReplaceOne={onReplaceOne}
            onReplaceAll={onReplaceAll}
          />
          <NameManager
            open={nameManagerOpen}
            sheet={sheet}
            selRange={selRange}
            onClose={() => setNameManagerOpen(false)}
            onGoTo={onGoTo}
            onDefineName={onDefineName}
            onRenameName={onRenameName}
            onRetargetName={onRetargetName}
            onDeleteName={onDeleteName}
          />
          <InconsistencyPanel
            open={inconsistencyPanelOpen}
            flags={activeInconsistencies}
            onClose={() => setInconsistencyPanelOpen(false)}
            onGoTo={onGoTo}
            onDismiss={onDismissInconsistency}
          />
          <SheetView
            ref={sheetViewRef}
            sheet={sheet}
            sheetName={sheetName}
            evalResult={evalResult}
            totalRows={totalRows}
            selRange={selRange}
            setSelRange={setSelRange}
            onCommit={onCommitCell}
            onBlankRange={onBlankRange}
            onRenameColumn={onRenameColumn}
            onAddColumn={onAddColumn}
            onCopy={onCopy}
            onPaste={onPaste}
            onFillDown={onFillDown}
            onInsertRowAt={onInsertRowAt}
            onDeleteRowAt={onDeleteRowAt}
            onInsertColumnAt={onInsertColumnAt}
            onDeleteColumnAt={onDeleteColumnAt}
            onSetColumnWidth={onSetColumnWidth}
            onSetRowHeight={onSetRowHeight}
            onSetFreeze={onSetFreeze}
            zoom={zoom}
            onZoomChange={onZoomChange}
            hiddenRows={hiddenRows}
            onSelectionSettled={onSelectionSettled}
            filterOn={filterOn}
            columnFilters={columnFilters}
            onSetColumnFilter={onSetColumnFilter}
            autoColor={autoColor}
            trace={renderedTrace}
            onNavigateTrace={onNavigateTrace}
            inconsistencies={activeInconsistencies}
            onApplyBorder={onApplyBorderCmd}
            onSort={onSort}
            onToggleNameManager={onToggleNameManager}
          />
          <TabStrip
            ref={tabStripRef}
            sheets={workbook.sheets}
            activeSheetId={activeEntry.id}
            onSelect={onSelectSheetTab}
            onAdd={onAddSheetTab}
            onRename={onRenameSheetTab}
            onDuplicate={onDuplicateSheetTab}
            onDelete={onDeleteSheetTab}
            onReorder={onReorderSheetTab}
          />
          <CommandPalette open={paletteOpen} ctx={ctx} onClose={() => setPaletteOpen(false)} />
        </>
      ) : orgMode ? (
        // ORG SCOPE (NEW-1) — Organization holds SEVERAL workbooks (unlike a project's one), so
        // this is the list to choose from before the grid above has anything to show.
        <OrgWorkbookPicker
          workbooks={orgWorkbooks}
          loading={orgListLoading}
          notice={orgListNotice}
          onOpen={onOrgOpen}
          onCreate={onOrgCreate}
          onRename={onOrgRename}
          onDelete={onOrgDelete}
        />
      ) : (
        <EmptyProjectState onGoDashboard={onGoDashboard} />
      )}
    </div>
  );
}
