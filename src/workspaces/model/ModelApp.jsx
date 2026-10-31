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
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
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
import { undoKeyKind, undoKeyOwner, CELL_EDITING_ATTR } from "./lib/undoKeyScope.js";
import { isTextControl } from "../../shared/keyboard/keyScope.js";
import {
  createWorkbook, migrateWorkbook, activeSheetEntry, applyToActiveSheet, setActiveSheet,
  addSheet, duplicateSheet, renameSheet, deleteSheet, reorderSheet,
  workbookInsertRowAt, workbookDeleteRowAt, workbookInsertColumnAt, workbookDeleteColumn,
  commitCellText, blankRange, setNumberFormat, addColumn,
  formatAt, padRowCount, sheetsDiverge, rawAt,
  setColumnWidth, setRowHeight, setFreeze,
  styleAt, setCellStyle, adjustIndent, applyBorder, clearFormatting,
  paintedStyleAt, applyPaintedStyle, mergeAt, mergeRange, unmergeAt, sortRange, usedRangeEnd,
  isInconsistencyDismissed, setInconsistencyDismissed, workbookHasContent,
  setRowsHidden, setColumnsHidden, clearCellRange, DEFAULT_ROW_H,
} from "./lib/sheetModel.js";
import { defineName, renameName, retargetName, deleteName } from "./lib/namedRanges.js";
import { evaluateWorkbook, displayFor } from "./lib/sheetEngine.js";
import { beginOrStepTrace, renderableTrace } from "./lib/traceAudit.js";
import { findInconsistencies } from "./lib/formulaConsistency.js";
import { fillDown, fillTextToCells, replaceAll, replaceInCellText, fillRight, autoSumPlan } from "./lib/sheetOps.js";
import { rangesOf, applyToRanges, isMulti, collapse, MULTI_SELECTION_MESSAGE } from "./lib/selectionModel.js";
// Excel keyboard shortcuts (2026-10-29): the key tables, the Alt key-tip machine, the selection model and
// the real clipboard — all pure modules; this file only wires them to state.
import { chordCommand } from "./lib/keymap.js";
import { START as KEYTIP_START, beginKeyTips, stepKeyTips } from "./lib/keyTips.js";
import { runCommandById } from "./lib/commandRegistry.js";
import { selectionKind, clampSelection, wholeSelectionLabel } from "./lib/selection.js";
import { autofitColumnWidth, autofitRowHeight, canvasMeasure } from "./lib/autofit.js";
import { todayIso, timeText } from "./lib/editShortcuts.js";
import { buildClip, clipToText, clipToHtml, parseClipboard, applyClip, pasteMoveSameSheet, clipIsEmpty } from "./lib/clipboardIO.js";
import { NUMBER_FORMATS } from "./lib/numberFormats.js";
import ShortcutDialog from "./components/ShortcutDialog.jsx";
import KeyTipOverlay from "./components/KeyTipOverlay.jsx";
import { increaseDecimals, decreaseDecimals, toggleThousands } from "./lib/numberFormats.js";
import { modelSaveState } from "./lib/modelSaveState.js";
import { runCloudPush, shownModelStatus } from "./lib/modelPushGate.js";
import { orgCloudOutcome } from "./lib/orgWorkbookOps.js";
import { Button } from "../../shared/ui/controls.jsx";
import { FONT_SIZE, SPACE } from "../../shared/ui/designTokens.js";
import { readZoom, writeZoom } from "./lib/sheetZoom.js";
import { readAutoColor, writeAutoColor } from "./lib/sheetColorMode.js";
import {
  readLocalSheet, writeLocalSheet, readSyncMeta, writeSyncMeta, decideAnonAdoption, loadCloudSheet, saveCloudSheet,
  readLocalOrgIndex, writeLocalOrgIndex, touchLocalOrgIndex, removeLocalOrgIndexEntry,
  listOrgWorkbooksCloud, loadOrgWorkbookCloud, saveOrgWorkbookCloud, renameOrgWorkbookCloud, deleteOrgWorkbookCloud,
} from "./lib/modelStore.js";
import { listProjects, reconcileProjects, onProjectsChanged } from "../../shared/projects/projects.js";
import FileMenu from "./components/FileMenu.jsx";
// Univer spike (owner-only; docs/SPREADSHEET-UNIVER-SPIKE.md) — the switch is the ONLY touch to the existing grid. The grid
// itself is a lazy chunk, so none of @univerjs/* is in any bundle a non-owner (or an owner with the switch off) downloads.
import { useUniverSwitch } from "./lib/univerSwitch.js";
import { warmUniver } from "./lib/univerWarm.js";
const UniverSheet = lazy(() => import("./components/UniverSheet.jsx"));
// NEW-1 (B2587264) — a device that uses the Univer grid starts fetching its chunk the moment THIS chunk runs, in parallel with the
// admin check and the workbook load, instead of after them (measured live: the chunk request began ~250 ms after ModelApp arrived).
// A no-op for any device whose switch is off (lib/univerWarm.js); the real mount below still decides whether the grid shows.
warmUniver();
import OrgWorkbookPicker from "./components/OrgWorkbookPicker.jsx";
import { addSheetFromCsvText, sheetToCsv } from "./lib/csvIO.js";
// NEW-1 (open an uploaded Excel in Spreadsheet) — a Library file opened as an editable workbook.
// Everything heavy (ExcelJS, SheetJS, the parse worker) loads lazily behind lib/fileWorkbookStore.js.
import { useFileWorkbook } from "./lib/useFileWorkbook.js";
import { scopeKeyFor, readActiveFile, setActiveFile, onActiveFileChanged } from "./lib/activeFile.js";
import { spreadsheetKindOf } from "./lib/spreadsheetKind.js";
import { FileBar, FileNotes, FileProblem, FileLoading } from "./components/FileBar.jsx";
import { parseSpreadsheetInWorker, exportWorkbookInWorker } from "./lib/spreadsheetClient.js";
// spreadsheet-live-data-refs — the project's own data (site plan + comps), exposed read-only as
// Site.*/Plan.*/Comp.* formula names (lib/projectRefs.js's own header). `onSiteModelChanged` is a
// cross-workspace notification this feature added to storage.js (mirroring the pre-existing
// `onProjectsChanged` shape exactly) so a live edit made in the still-mounted Site Planner tab
// recalculates a formula here without a reload. `fetchAllComps` is the same async/Supabase-only
// read CompsPanel.jsx uses — there is no synchronous comps cache anywhere in this repo.
import { decideLoadSync, isPlaceholderWorkbook } from "./lib/modelSyncBase.js";
import { buildProjectNames, openPlanId } from "./lib/projectRefs.js";
import { onSiteModelChanged, isCloudActive } from "../site-planner/lib/storage.js";
import { onCompsChanged } from "../../shared/comps/lib/compsChanged.js";
import { supabase } from "../site-planner/lib/supabase.js";
import { fetchPlanRowsForModel, planRowsLoading, planRowsReady, planRowsError, rowsSignature } from "./lib/planRowsSource.js";
import { fetchProjectNameComps } from "./lib/projectCompsFetch.js";

const CLOUD_PUSH_DEBOUNCE_MS = 800;
// Excel round-trip — ALL the heavy xlsx work (read, write, old .xls) runs in ONE Web Worker
// (lib/spreadsheetWorker.js, reached through lib/spreadsheetClient.js, lazily), so opening this tab is
// never slower for someone who never imports or exports and the tab never freezes on a big workbook.

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

/* V537648 — the visible, persistent "two different copies" bar. Module scope
 * (MODULE-SCOPE-COMPONENTS). It stays until the user picks one; nothing is pushed to the cloud
 * while it is up (lib/modelPushGate.js). `showing` says which copy is on screen right now. */
function DivergedBar({ showing, onKeepDevice, onUseCloud }) {
  const text = showing === "cloud"
    ? "This spreadsheet has a different copy saved on this device from before you signed in. You're seeing the cloud copy. Nothing will be saved to the cloud until you choose which to keep."
    : "This spreadsheet has a different copy saved in the cloud (from another device or browser). You're seeing this device's copy. Nothing will be saved to the cloud until you choose which to keep.";
  return (
    <div
      role="alert"
      data-testid="model-diverged-bar"
      style={{
        flex: "none", display: "flex", alignItems: "center", flexWrap: "wrap", gap: SPACE.md,
        margin: `${SPACE.md}px ${SPACE.md}px 0`, padding: `${SPACE.sm}px ${SPACE.lg}px`,
        background: "var(--danger-bg)", color: "var(--text-primary)", border: "1px solid var(--danger)", borderRadius: RADIUS.md,
        fontSize: FONT_SIZE.control, lineHeight: 1.45,
      }}
    >
      <span style={{ flex: "1 1 260px", fontWeight: 600 }}>{text}</span>
      <Button variant="ghost" size="sm" data-testid="model-diverged-use-cloud" onClick={onUseCloud}>Use the cloud copy</Button>
      <Button variant="ghost" size="sm" data-testid="model-diverged-keep-device" onClick={onKeepDevice}>Keep this device's copy</Button>
    </div>
  );
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
  const { value: workbook, commit: commitRaw, undo: undoRaw, redo: redoRaw, reset, canUndo, canRedo } = useUndoableState(createWorkbook());
  // B2450528 — "the person changed it" vs "a load adopted it". Only commit/undo/redo raise this flag
  // (reset never does), and the local write-through effect consumes it to mark the stored copy DIRTY
  // (edited since it was last confirmed against the cloud — see lib/modelSyncBase.js).
  const userEditRef = useRef(false);
  const commit = useCallback((u) => { userEditRef.current = true; commitRaw(u); }, [commitRaw]);
  const undo = useCallback(() => { userEditRef.current = true; undoRaw(); }, [undoRaw]);
  const redo = useCallback(() => { userEditRef.current = true; redoRaw(); }, [redoRaw]);
  // Univer spike — `univer.active` is true only for a CONFIRMED is_admin() user who turned "Try the new grid" on (this device).
  // While it is, Univer owns the keyboard and the clipboard, so the grid-level window listeners below stand down (`gridKeysOn`).
  const univer = useUniverSwitch(userId);
  const univerOn = univer.active;
  const gridKeysOn = isActive && !univerOn;
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
  /* B1953797 (H2) — a SIGNED-IN plan's geometry is element ROWS, not the local mirror (which is a slim
   * header on any device that has not opened the plan). Fetch the open plan's rows so Site.Acres /
   * Plan.BuildingN.SF read the same source of truth the Map and Dashboard do, with an explicit
   * loading / error state (projectRefs.js turns those into a labelled #N/A — never #REF! or a stale
   * number for "not fetched"). Refreshes on: plan/project change · a site-content notification
   * (`siteTick` — the Site Planner's own commits, remote rows applied there included) · the tab
   * regaining focus · a realtime change on the plan's element rows (best effort — the focus/tick paths
   * are the floor). Signed out: `null` → the local mirror stays the one authority, as before. */
  const [planRows, setPlanRows] = useState(null);
  const [rowsTick, setRowsTick] = useState(0);
  const cloudOn = isCloudActive();
  const openPlan = useMemo(() => (cloudOn ? openPlanId(projectId) : null), [cloudOn, projectId, siteTick, _projectsTick]);
  useEffect(() => {
    if (!openPlan) { setPlanRows(null); return undefined; }
    let live = true;
    // First look at a plan (or a different plan) is LOADING; a refresh of the same plan keeps what it
    // has (stale-while-revalidate) so the sheet does not flicker to #N/A on every commit.
    setPlanRows((cur) => (cur && cur.planId === openPlan ? cur : planRowsLoading(openPlan)));
    const t = window.setTimeout(async () => {
      const r = await fetchPlanRowsForModel(openPlan);
      if (!live) return;
      setPlanRows((cur) => {
        if (!r.ok) return planRowsError(openPlan, r.error);
        if (cur && cur.planId === openPlan && cur.status === "ready" && rowsSignature(cur.rows) === rowsSignature(r.rows)) return cur;
        return planRowsReady(openPlan, r.rows);
      });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [openPlan, siteTick, rowsTick]);
  useEffect(() => {
    if (!openPlan) return undefined;
    const bump = () => setRowsTick((n) => n + 1);
    const onVis = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", bump);
    let ch = null, debounce = 0;
    try {
      if (supabase) {
        ch = supabase.channel(`model-plan-rows:${openPlan}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "site_elements", filter: "site_id=eq." + openPlan },
            () => { clearTimeout(debounce); debounce = window.setTimeout(bump, 800); })
          .subscribe();
      }
    } catch (_) { /* realtime is a bonus: focus + siteTick keep the numbers current without it */ }
    return () => {
      document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", bump); clearTimeout(debounce);
      try { if (ch && supabase) supabase.removeChannel(ch); } catch (_) {}
    };
  }, [openPlan]);
  const projectNames = useMemo(() => buildProjectNames(projectId, { comps, planRows }), [projectId, comps, siteTick, _projectsTick, planRows]);
  // NEW-1 (2026-10-29) — no plan/concept crumb here: only the Site tab is plan-scoped, so the
  // Spreadsheet header reads "Dashboard / <Project> ▾" (the old spreadsheet-concept-crumb is gone,
  // and shared/ui/crumbScope.js would not draw a trailing crumb on this module anyway).
  const cloudVersionRef = useRef(null);
  // B2450528 — the sync base (modelSyncBase.js): `baseVersionRef` = the cloud version this device's copy was
  // last confirmed against, `dirtyRef` = it holds edits not yet confirmed uploaded, `workbookRef` = the
  // workbook on screen RIGHT NOW (so a cloud answer that lands after a keystroke decides on the edited copy).
  const baseVersionRef = useRef(null);
  const dirtyRef = useRef(false);
  const workbookRef = useRef(null);
  workbookRef.current = workbook;
  const [cloudSettled, setCloudSettled] = useState(false); // the cloud load has answered (any way) for this workbook
  const pushTimer = useRef(0);
  // V537648 — the debounced push reads these at FIRE time (lib/modelPushGate.js). `statusRef`
  // mirrors `status`; `divergedRef` is the divergence HOLD — a latch set synchronously the moment
  // the load detects local ≠ cloud, released only by a fresh load or the user's own resolution
  // (the two buttons in the "different copies" bar). `divergedCopiesRef` keeps both sides so the
  // user can pick either one; `diverged` is its render mirror.
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const divergedRef = useRef(false);
  const divergedCopiesRef = useRef(null); // { device, cloud, showing: "device" | "cloud" } | null
  const [diverged, setDiverged] = useState(false);
  const [pushNonce, setPushNonce] = useState(0); // bumped by a resolution so the push runs even with no edit
  const markDiverged = useCallback((copies) => {
    divergedRef.current = true;
    divergedCopiesRef.current = copies;
    clearTimeout(pushTimer.current);
    setDiverged(true);
    setStatus("diverged");
  }, []);
  const loadTokenRef = useRef(0);
  // ⛔ CLIPBOARD (2026-10-29) — Ctrl+C / Ctrl+X / Ctrl+V use the REAL system clipboard through the browser's native
  // copy / cut / paste events (lib/clipboardIO.js; the listeners are below the ctx bag). `internalClipRef` is only the
  // FALLBACK for a browser that hands the event no clipboardData. `clipMark` is the dashed "marching" outline around the
  // copied / cut range ({ sheetId, rect, mode, id }); `pendingCutRef` is the cut still waiting for its paste.
  const internalClipRef = useRef(null);
  const [clipMark, setClipMark] = useState(null);
  const pendingCutRef = useRef(null);
  const consumedCutsRef = useRef(new Set());
  const clearClipMark = useCallback(() => { setClipMark(null); pendingCutRef.current = null; }, []);
  // A one-line, auto-dismissing message for anything a shortcut could not do — LOUD-FAILURE: no silent no-op.
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);
  const showNotice = useCallback((msg) => {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 7000);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const [dialog, setDialog] = useState(null);       // ShortcutDialog spec | null
  const [keyTip, setKeyTip] = useState(KEYTIP_START); // the Alt key-tip sequence in progress
  const keyTipRef = useRef(KEYTIP_START);
  const ctxRef = useRef(null);                      // the latest ctx bag — key handlers run commands against THIS
  const liveRef = useRef(null);                     // the latest sheet / selection / eval for window-level listeners
  const lastActionRef = useRef(null);               // F4 "repeat last action": { name, args } of a ctx handler
  const clipFnsRef = useRef(null);                  // this render's copy / paste functions (the document listeners call THROUGH it)
  const pushImmediateRef = useRef(false);           // Ctrl+S: the next cloud push fires with no debounce wait
  const nextPushDelay = () => { const d = pushImmediateRef.current ? 0 : CLOUD_PUSH_DEBOUNCE_MS; pushImmediateRef.current = false; return d; };
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
  const formulaBarRef = useRef(null); // NEW-1 — its pending text is committed before a sheet change
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
  // NEW-1 (open an uploaded Excel) — FILE MODE: the Spreadsheet is showing a Library file, remembered
  // per place (this project / the Organization). It wins over the project's own workbook until
  // "Close file". The pointer is lib/activeFile.js (written by the Shell when a Library row is
  // clicked); the content is the Library file itself (lib/fileWorkbook.js) — never a copy.
  const fileScopeKey = scopeKeyFor({ projectId: crossProject ? null : projectId, org: orgMode });
  const [activeFileId, setActiveFileId] = useState(() => readActiveFile(fileScopeKey));
  const fileScopeRef = useRef(fileScopeKey);
  useEffect(() => { fileScopeRef.current = fileScopeKey; setActiveFileId(readActiveFile(fileScopeKey)); }, [fileScopeKey]);
  useEffect(() => onActiveFileChanged((scope, id) => { if (scope === fileScopeRef.current) setActiveFileId(id); }), []);
  const fileMode = !!activeFileId;
  const viewPrefsKey = fileMode ? `file:${activeFileId}` : (orgMode ? orgWorkbookId : projectId);

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
  const openWorkbook = fileMode || openProject || openOrgWorkbook;
  const storageKey = openProject ? projectId : (openOrgWorkbook ? orgWorkbookId : null);
  const orgWorkbookName = useMemo(
    () => orgWorkbooks.find((w) => w.id === orgWorkbookId)?.name || "Untitled workbook",
    [orgWorkbooks, orgWorkbookId],
  );
  // NEW-1 — the file's own load / debounced save / status. Hands the parsed workbook to the same
  // undo-tracked state the other two modes use; `onFileChanged` re-points the remembered file when a
  // save of an .xls/.csv created its .xlsx copy (or an original opened on its copy).
  const fw = useFileWorkbook({
    fileId: activeFileId, userId, workbook,
    onLoaded: (wb) => { reset(wb); setActiveSheetId(wb.activeSheetId); },
    onFileChanged: (id) => setActiveFile(fileScopeRef.current, id),
  });
  // Declared AFTER `fw` and `fileMode` (a `const` read earlier is a TDZ crash — it took the Spreadsheet down on the live build).
  const shownStatus = fileMode ? fw.status : shownModelStatus(status, diverged);
  // NEW-2 (Univer save path) — the Univer grid hands its edits over after a short debounce, so EVERY way out of it asks the
  // grid to flush first: Export, the grid toggle, hiding the module tab, closing a file, a project / workbook / file change,
  // the page closing. `flushUniver()` is synchronous and idempotent and returns the workbook AS IT IS NOW (the edit included).
  // An URGENT save is also persisted right here, synchronously: React would not render before a closing page dies, and the
  // write-through effect only runs after a render. Same safety net the regular grid has — the stored copy is never staler
  // than the screen — and the same dirty mark, so the next load pushes it (decideLoadSync "push-local"), never a "different copy" bar.
  const univerHandleRef = useRef(null);
  const readyRef = useRef(false); readyRef.current = ready;
  const fwRef = useRef(fw); fwRef.current = fw;
  const univerScope = fileMode ? `file:${fw.loadGen}` : (storageKey ? `${orgMode ? "org" : "project"}:${storageKey}` : "none");
  const scopeRef = useRef(univerScope); scopeRef.current = univerScope;
  const persistUniverNow = useCallback((scope, wb) => {
    if (scope.fileMode) { fwRef.current.noteWorkbookNow(wb, scope.fileId); return true; }
    if (!readyRef.current || !scope.key) return true;
    if (!writeLocalSheet(scope.userId, scope.key, wb)) { setStatus("error"); return false; }
    writeSyncMeta(scope.userId, scope.key, { baseVersion: baseVersionRef.current, dirty: true });
    if (scopeRef.current === scope.id) dirtyRef.current = true;
    return true;
  }, []);
  /** The grid is going away because the project / workbook CHANGED: the regular push effect for the one being left is cancelled by
   *  the change, so start its upload here (best effort — the dirty local copy written above is the net, and the next open of
   *  that workbook pushes it). A failure raises nothing on the badge: the badge now describes the workbook being OPENED. */
  const uploadLeavingUniver = useCallback((scope, wb) => {
    if (!scope.cloud) return;
    const expected = cloudVersionRef.current;
    const p = scope.cloud.projectId
      ? saveCloudSheet({ uid: scope.userId, projectId: scope.cloud.projectId, sheet: wb, expected })
      : saveOrgWorkbookCloud({ uid: scope.userId, id: scope.cloud.orgId, name: scope.cloud.name, sheet: wb, expected });
    Promise.resolve(p).then((r) => {
      if (!r || !r.ok) return;
      const stored = readLocalSheet(scope.userId, scope.key);
      if (stored && sheetsDiverge(stored, wb)) return;   // edited again since — that copy stays dirty and uploads on its own
      writeSyncMeta(scope.userId, scope.key, { baseVersion: r.version, dirty: false });
    }).catch(() => {});
  }, []);
  const reportUniverSaveError = useCallback((err, stage) => {
    setStatus("error");
    setFileNotice({ kind: "error", text: "Your last edit in the new grid could not be saved yet. It will be retried — keep this tab open." });
    import("../../shared/telemetry/clientErrors.js").then((m) => m.reportClientEvent("model-univer-save-failed", String((err && err.message) || err), { stage })).catch(() => {});
  }, []);
  /** Save a workbook the Univer grid just emitted. `scope` is the workbook that grid was SHOWING — a grid that is going away
   *  because the project / file changed must save into the OLD one and never into whatever replaced it. */
  const onUniverChange = (next, _notes, meta) => {
    const scope = {
      id: univerScope, key: storageKey, userId, fileMode, fileId: activeFileId,
      cloud: !fileMode && userId && cloudSettled && !divergedRef.current && statusRef.current !== "not-provisioned"
        ? (openProject ? { projectId } : { orgId: orgWorkbookId, name: orgWorkbookName }) : null,
    };
    if (meta && meta.urgent) {
      if (!persistUniverNow(scope, next)) return;
      if (scopeRef.current !== scope.id) uploadLeavingUniver(scope, next);
    }
    if (scopeRef.current === scope.id) { commit(() => next); if (next.activeSheetId) setActiveSheetId(next.activeSheetId); }
  };
  const flushUniver = useCallback(() => {
    const h = univerHandleRef.current;
    return h ? h.flush({ urgent: true }) : null;   // { workbook, changed, ok } | null (the regular grid is showing)
  }, []);
  // Leaving the workbook the grid is showing (project, org workbook, file) or hiding the tab: flush BEFORE the swap. A layout
  // effect's cleanup runs ahead of every passive effect, including the load effect that replaces the workbook and the file
  // hook's "start uploading what I'm leaving" step — both then see the newest edit.
  useLayoutEffect(() => () => { flushUniver(); }, [univerScope, activeFileId, flushUniver]);
  useEffect(() => { if (!isActive) flushUniver(); }, [isActive, flushUniver]);
  const setUniverOn = useCallback(async (on) => {
    const h = univerHandleRef.current;
    if (h) {
      await Promise.race([h.commitEditing ? h.commitEditing() : null, new Promise((r) => setTimeout(r, 400))]);
      flushUniver();
    } else { sheetViewRef.current?.commitPending?.(); formulaBarRef.current?.commitPending?.(); }
    univer.setOn(on);
  }, [flushUniver, univer]);
  const closeFile = useCallback(async () => {
    flushUniver();
    const ok = await fw.flush();
    if (!ok) return; // the bar already shows why it couldn't save; never close over unsaved edits
    setActiveFile(fileScopeRef.current, null);
  }, [fw, flushUniver]);
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

  // NEW-3 — every index op READS the cloud result. The three store functions never throw — they
  // RESOLVE `{ ok:false, reason, error }` — so the old `.catch(() => {})` on each was dead code and
  // the resolved failure was never read: a delete that the cloud refused vanished from the picker
  // and was back on the next visit (the list effect above re-merges cloud rows), a rename held
  // until the next cloud list reverted it, and a create existed on this device only with no notice.
  // `orgCloudOutcome` (lib/orgWorkbookOps.js, unit-tested) is the one decision; the notice lands on
  // the picker (the surface the op was made on) and on the header badge via `status`, the same
  // surface the content push reports through.
  const applyOrgOutcome = useCallback((op, r, id) => {
    const o = orgCloudOutcome(op, r, { id });
    if (o.notice) setOrgListNotice(o.notice);
    if (o.status) setStatus(o.status);
    if (o.telemetry) import("../../shared/telemetry/clientErrors.js").then((m) => m.reportClientEvent(o.telemetry.kind, o.telemetry.message, o.telemetry.extra)).catch(() => {});
    return o;
  }, []);
  // B2584320 — the workbook OPENS only once its first cloud row exists (or the create has said why not). It used to open at
  // once and race the insert: the open-time load ran first, found no row, and left the version unknown — so the first edit's
  // push was an INSERT too and the database refused it as a duplicate (409), and no edit to a new organization workbook ever
  // reached the cloud until the page was reloaded. Opening on the create's answer makes that load find version 1.
  const orgCreatingRef = useRef(false);
  const onOrgCreate = useCallback(async () => {
    if (orgCreatingRef.current) return;
    orgCreatingRef.current = true;
    try {
      const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `wb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const name = "Untitled workbook";
      const wb = createWorkbook();
      writeLocalSheet(userId, id, wb);
      setOrgWorkbooks(touchLocalOrgIndex(userId, { id, name, updatedAt: Date.now() }));
      if (userId) {
        let r;
        try { r = await saveOrgWorkbookCloud({ uid: userId, id, name, sheet: wb, expected: null }); } catch (e) { r = { ok: false, reason: "error", error: String((e && e.message) || e) }; }
        applyOrgOutcome("create", r, id); // a refusal is still said out loud; the workbook opens on this device either way
      }
      setOrgWorkbookId(id);
    } finally { orgCreatingRef.current = false; }
  }, [userId, applyOrgOutcome]);
  const onOrgOpen = useCallback((id) => setOrgWorkbookId(id), []);
  const onOrgRename = useCallback((id, name) => {
    setOrgWorkbooks(touchLocalOrgIndex(userId, { id, name, updatedAt: Date.now() }));
    if (userId) renameOrgWorkbookCloud(userId, id, name).then((r) => applyOrgOutcome("rename", r, id));
  }, [userId, applyOrgOutcome]);
  // DELETE mirrors deleteSite's "tombstone, ask the server, remove locally only on confirmed
  // removal" rule (site-planner/lib/storage.js): the local index entry is dropped only once the
  // cloud tombstone landed (or the cloud genuinely holds nothing — not-provisioned / unavailable /
  // signed out). On a refusal the row stays in the picker with the notice beside it.
  const onOrgDelete = useCallback(async (id) => {
    const r = userId ? await deleteOrgWorkbookCloud(userId, id) : undefined;
    const o = applyOrgOutcome("delete", r, id);
    if (!o.applyLocal) return;
    setOrgWorkbooks(removeLocalOrgIndexEntry(userId, id));
    setOrgWorkbookId((cur) => (cur === id ? null : cur));
  }, [userId, applyOrgOutcome]);
  const onBackToOrgWorkbooks = useCallback(() => setOrgWorkbookId(null), []);

  /* ---- load: local first (synchronous, always available), then reconcile against the cloud.
   * Local wins whenever it already exists on this device — see the file header for why. Reads
   * `storageKey` (a project id, or an org workbook id — never both, see `openWorkbook` above);
   * the cloud half branches on which one is actually open. */
  useEffect(() => {
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    cloudVersionRef.current = null;
    // V537648 — a fresh load re-decides divergence from scratch (a reload of a still-divergent
    // copy re-detects it below, so this never silently forgets an unresolved one).
    divergedRef.current = false;
    divergedCopiesRef.current = null;
    setDiverged(false);
    setStatus("idle");
    setCloudConfirmed(false);
    setCloudSettled(false);
    userEditRef.current = false;
    baseVersionRef.current = null;
    dirtyRef.current = false;
    if (fileMode) return undefined; // NEW-1 — a Library file is open: useFileWorkbook owns the load
    if (!openWorkbook) { const wb = createWorkbook(); reset(wb); setActiveSheetId(wb.activeSheetId); setReady(false); return undefined; }
    const local = readLocalSheet(userId, storageKey);
    // B2450528 — the sync base this device's stored copy carries. No stored copy = a placeholder the
    // write-through is about to write: it is CLEAN (it can never win a fight with the cloud copy).
    const meta0 = local ? readSyncMeta(userId, storageKey) : null;
    if (!local) writeSyncMeta(userId, storageKey, { baseVersion: null, dirty: false });
    baseVersionRef.current = meta0 ? meta0.baseVersion : null;
    dirtyRef.current = !!(meta0 && meta0.dirty);
    const initialWorkbook = local ? migrateWorkbook(local) : createWorkbook();
    reset(initialWorkbook);
    setActiveSheetId(initialWorkbook.activeSheetId);
    setReady(true);
    let live = true;
    /** Show `wb` as the on-screen copy and record the outcome in the sync base. Never a user edit. */
    const adoptWorkbook = (wb, { base, dirty }) => {
      userEditRef.current = false;
      reset(wb);
      setActiveSheetId(wb.activeSheetId);
      baseVersionRef.current = base; dirtyRef.current = dirty;
      writeSyncMeta(userId, storageKey, { baseVersion: base, dirty });
    };
    (async () => {
      let r;
      try { r = openProject ? await loadCloudSheet(projectId) : await loadOrgWorkbookCloud(orgWorkbookId); }
      catch (_) { r = { ok: false, reason: "error" }; }
      if (!live || loadTokenRef.current !== token) return;
      if (r.ok) {
        cloudVersionRef.current = r.version;
        setCloudConfirmed(true);
        // R3 — a workbook made signed-out (scope "local") is adopted once into this account's scope.
        const anon = openProject && userId && !local ? readLocalSheet(null, storageKey) : null;
        const anonWb = anon ? migrateWorkbook(anon) : null;
        const adoption = decideAnonAdoption({ userId, userLocal: local, cloudSheet: r.sheet, cloudOk: true, anonLocal: anon,
          // A never-edited signed-out placeholder is not "a different copy" — it can't hold work.
          diverges: anonWb && r.sheet ? sheetsDiverge(anonWb, migrateWorkbook(r.sheet)) && !isPlaceholderWorkbook(anonWb) : false });
        const editedMeanwhile = dirtyRef.current; // a keystroke landed before the cloud answered
        if (adoption === "adopt") {
          // the write-through + debounced push effects persist it under this account; it is unsynced work
          adoptWorkbook(anonWb, { base: r.version, dirty: true });
          setPushNonce((n) => n + 1);
        } else if (!local && r.sheet && !editedMeanwhile) {
          const cloudWorkbook = migrateWorkbook(r.sheet);
          if (adoption === "diverged") markDiverged({ device: anonWb, cloud: cloudWorkbook, showing: "cloud" });
          adoptWorkbook(cloudWorkbook, { base: r.version, dirty: false });
        } else {
          // Both sides may hold something. "Local wins on load" is only safe when this device's copy is
          // provably newer or equal; otherwise the very next edit would silently overwrite the other copy
          // (a clean CAS bump — nothing raced). Decide from the sync base (lib/modelSyncBase.js), on the
          // workbook as it is NOW (the person may have typed while the cloud was answering).
          // ⛔ V537648 — and DETECTING a divergence is not enough: the debounced push scheduled at mount
          // used to fire anyway. `markDiverged` latches the hold the push body checks at fire time.
          const localNow = workbookRef.current || migrateWorkbook(local);
          const cloudWorkbook = r.sheet ? migrateWorkbook(r.sheet) : null;
          const meta = readSyncMeta(userId, storageKey);
          const verdict = decideLoadSync({
            local: localNow, cloud: cloudWorkbook, cloudVersion: r.version, meta,
            sameContent: cloudWorkbook ? !sheetsDiverge(localNow, cloudWorkbook) : false,
            localIsPlaceholder: isPlaceholderWorkbook(localNow),
          });
          if (verdict.action === "adopt-cloud") adoptWorkbook(cloudWorkbook, { base: r.version, dirty: false });
          else if (verdict.action === "in-sync") { baseVersionRef.current = r.version; dirtyRef.current = false; writeSyncMeta(userId, storageKey, { baseVersion: r.version, dirty: false }); }
          else if (verdict.action === "push-local") { dirtyRef.current = true; baseVersionRef.current = r.version; writeSyncMeta(userId, storageKey, { baseVersion: r.version, dirty: true }); setPushNonce((n) => n + 1); }
          else if (verdict.action === "no-cloud-copy") {
            dirtyRef.current = verdict.dirty;
            writeSyncMeta(userId, storageKey, { baseVersion: null, dirty: verdict.dirty });
            if (verdict.dirty) setPushNonce((n) => n + 1);
          } else markDiverged({ device: localNow, cloud: cloudWorkbook, showing: "device" });
        }
      } else if (r.reason === "not-provisioned") {
        setStatus("not-provisioned");
      }
      setCloudSettled(true);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, openWorkbook, openProject, projectId, orgWorkbookId, userId, fileMode]);

  /* Write-through local save on every commit — never debounced (the stored copy must never
   * be staler than the screen: a tab close a moment after typing must not lose that edit). */
  const prevFileModeRef = useRef(fileMode);
  useEffect(() => {
    // The commit in which file mode flips still holds the OTHER mode's workbook (the load that swaps it runs in
    // this same pass) — writing it now would put a Library file's cells into the project's slot, or the reverse.
    const flipped = prevFileModeRef.current !== fileMode;
    prevFileModeRef.current = fileMode;
    if (flipped) return;
    if (!ready || !openWorkbook || fileMode) return; // a Library file keeps its own safety copy (lib/fileDraft.js), never the project's slot
    if (!writeLocalSheet(userId, storageKey, workbook)) setStatus("error");
    // B2450528 — a PERSON'S edit (commit/undo/redo — never a load's reset) makes the stored copy dirty:
    // edited since it was last confirmed against the cloud version `baseVersionRef`.
    if (userEditRef.current) {
      userEditRef.current = false;
      dirtyRef.current = true;
      writeSyncMeta(userId, storageKey, { baseVersion: baseVersionRef.current, dirty: true });
    }
  }, [workbook, ready, openWorkbook, storageKey, userId, fileMode]);

  // B2450528 — a push landed: the stored copy is now confirmed against `version`, and clean unless something newer
  // was typed while it was in flight.
  const noteSynced = useCallback((version, pushedWorkbook) => {
    baseVersionRef.current = version;
    if (workbookRef.current === pushedWorkbook) dirtyRef.current = false;
    writeSyncMeta(userId, storageKey, { baseVersion: version, dirty: dirtyRef.current });
  }, [userId, storageKey]);

  /* Best-effort, debounced cloud push through the guarded save path. Reads `status` without
   * depending on it — this must fire only on a WORKBOOK change, not on every status transition
   * the push itself causes (that would restart the debounce on its own "saving" flag).
   * ⛔ V537648 — `runCloudPush` re-asks the gate from REFS when the timer FIRES (see its header). */
  useEffect(() => {
    if (!ready || !openWorkbook || !userId || fileMode) return undefined; // fileMode: the Library file is the save target
    if (status === "not-provisioned") return undefined; // stop hammering a table that isn't there yet
    if (divergedRef.current) return undefined; // V537648 — held until the user picks a copy
    if (!cloudSettled || !dirtyRef.current) return undefined; // B2450528
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      runCloudPush({
        readGate: () => ({ status: statusRef.current, diverged: divergedRef.current }),
        save: async () => (openProject
          ? await saveCloudSheet({ uid: userId, projectId, sheet: workbook, expected: cloudVersionRef.current })
          : await saveOrgWorkbookCloud({ uid: userId, id: orgWorkbookId, name: orgWorkbookName, sheet: workbook, expected: cloudVersionRef.current })),
        setStatus,
        onSaved: (version) => {
          cloudVersionRef.current = version; setCloudConfirmed(true);
          noteSynced(version, workbook);
          if (!openProject) setOrgWorkbooks(touchLocalOrgIndex(userId, { id: orgWorkbookId, name: orgWorkbookName, updatedAt: Date.now() }));
        },
      });
    }, nextPushDelay());
    return () => clearTimeout(pushTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbook, ready, openWorkbook, openProject, projectId, orgWorkbookId, orgWorkbookName, userId, pushNonce, fileMode, cloudSettled]);

  /* V537648 — the ONLY two ways out of a divergence besides opening a different workbook. Both
   * are explicit user choices; neither deletes anything (the copy not chosen is reachable by
   * Ctrl+Z, because the switch is a normal undoable commit, and a signed-out copy is never
   * touched). Releasing the hold re-arms the ordinary push, which still goes through the CAS
   * guard — so if the cloud moved AGAIN in the meantime, that surfaces as a conflict. */
  const releaseDivergence = useCallback(() => {
    divergedRef.current = false;
    divergedCopiesRef.current = null;
    setDiverged(false);
    setStatus("idle");
    setPushNonce((n) => n + 1);
  }, []);
  // B2450528 — the choice is also the new sync base: keeping this device's copy is unsynced work based on the
  // cloud version it was just shown against; using the cloud copy is clean against that same version.
  const onKeepDeviceCopy = useCallback(() => {
    const c = divergedCopiesRef.current;
    if (c && c.showing === "cloud") { commit(c.device); setActiveSheetId(c.device.activeSheetId); }
    baseVersionRef.current = cloudVersionRef.current; dirtyRef.current = true;
    writeSyncMeta(userId, storageKey, { baseVersion: baseVersionRef.current, dirty: true });
    releaseDivergence();
  }, [commit, releaseDivergence, userId, storageKey]);
  const onUseCloudCopy = useCallback(() => {
    const c = divergedCopiesRef.current;
    baseVersionRef.current = cloudVersionRef.current;
    if (c && c.showing === "device") { commit(c.cloud); setActiveSheetId(c.cloud.activeSheetId); dirtyRef.current = true; }
    else dirtyRef.current = false;
    writeSyncMeta(userId, storageKey, { baseVersion: baseVersionRef.current, dirty: dirtyRef.current });
    releaseDivergence();
  }, [commit, releaseDivergence, userId, storageKey]);

  // Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z (or +Y), Ctrl+G (Name Box), Ctrl+F / Ctrl+H (Find/Replace) —
  // SheetView deliberately leaves every Ctrl/Cmd chord alone so this can own them, gated on
  // `isActive` the same way Notes gates its own window shortcut: workspaces stay
  // mounted-but-hidden, so an ungated listener fires from a tab nobody is looking at.
  useEffect(() => {
    if (!gridKeysOn) return undefined;
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
        clearClipMark(); // Escape also drops the copied / cut range outline (and cancels a pending cut)
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      // NEW-1 (2026-10-29) — undo/redo belong to the TEXT being typed (cell editor, formula bar,
      // Name Box, column rename, Find bar…): leave the key to the field's own native undo, or to
      // SheetView's editor history. Only with no text control owning the keyboard does the sheet's
      // undo stack fire. See lib/undoKeyScope.js.
      if (undoKeyKind(e) && undoKeyOwner({
        textControl: isTextControl(e.target),
        cellEditorOpen: !!(e.target instanceof Element && e.target.closest(`[${CELL_EDITING_ATTR}]`)),
      }) === "text") return;
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
  }, [gridKeysOn, undo, redo, onOpenFind, onOpenReplace, clearClipMark]);

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
    (fn, ...args) => {
      // NEW-2 — insert/delete of rows or columns shifts every address, so the extra ranges (stored by index)
      // would point at the wrong cells: keep the active range only.
      setSelRange((s) => collapse(s));
      commit((wb) => fn(setActiveSheet(wb, activeSheetId), ...args));
    },
    [commit, activeSheetId],
  );

  const onCommitCell = useCallback((r, c, text) => {
    clearClipMark(); // typing into a cell cancels a pending cut and drops the copy outline (Excel)
    if (String(text).includes("\n")) {
      // Alt+Enter new lines: Excel turns Wrap Text on for the cell and grows the row to show every line.
      applyActive((s) => {
        let n = setCellStyle(commitCellText(s, r, c, text), r, r, c, c, { wrap: true });
        if (!n.rowHeights[r]) n = setRowHeight(n, r, Math.ceil(String(text).split("\n").length * 12.5 * 1.25 + 6));
        return n;
      });
    } else applyActive(commitCellText, r, c, text);
  }, [applyActive, clearClipMark]);
  // NEW-2 — a command on a multi-range selection is ONE commit (one undo step) that threads the sheet through
  // every selected range; `sel` is a selection ({r1..c2, extra?}) or an explicit list of ranges.
  const applyActiveRanges = useCallback((sel, fn, ...args) => {
    const rs = Array.isArray(sel) ? sel : rangesOf(sel);
    commit((wb) => applyToActiveSheet(setActiveSheet(wb, activeSheetId), (s) => applyToRanges(s, rs, fn, ...args)));
  }, [commit, activeSheetId]);
  const onBlankRanges = useCallback((ranges) => { clearClipMark(); applyActiveRanges(ranges, blankRange); }, [applyActiveRanges, clearClipMark]);
  const onFillDownRanges = useCallback((ranges) => applyActiveRanges(ranges, fillDown), [applyActiveRanges]);
  const onFillText = useCallback((cells, text, fromR, fromC) => { clearClipMark(); applyActive(fillTextToCells, cells, text, fromR, fromC); }, [applyActive, clearClipMark]);
  const onAddColumn = useCallback(() => applyActive(addColumn), [applyActive]);

  // STAGE 3 (NEW-1) — the sheet tab strip. `onSelectSheetTab` is pure navigation (see the
  // `activeSheetId` state's own header above — never through `commit`); the other four are real
  // content edits and go through the undo stack like everything else, syncing the view's
  // `activeSheetId` afterward since add/duplicate/delete all pick a new active sheet themselves.
  // NEW-1 (2026-10-29) — every way of changing which sheet is showing first COMMITS whatever is
  // half-typed (cell editor, formula bar) to the sheet being left, exactly like Excel. Without it
  // the editor state outlived the tab change and the next Enter wrote the text into the NEW sheet.
  // The commit goes through `applyActive`'s CURRENT `activeSheetId`, so this must run before any
  // `setActiveSheetId` below; it is queued as an ordinary functional commit, so the sheet-changing
  // commits after it compose on top of it (they build from the latest workbook, not `workbook`).
  const commitPendingEntry = useCallback(() => {
    sheetViewRef.current?.commitPending?.();
    formulaBarRef.current?.commitPending?.();
  }, []);
  // (NEW-2: a multi-range selection belongs to the sheet it was made on — switching tabs keeps the active cell only.)
  const onSelectSheetTab = useCallback((id) => { commitPendingEntry(); setActiveSheetId(id); setSelRange((s) => collapse(s)); }, [commitPendingEntry]);
  const onAddSheetTab = useCallback(() => {
    commitPendingEntry();
    const id = addSheet(workbook).activeSheetId; // ids come from `nextSheetId`, which a cell edit never moves
    commit((wb) => addSheet(wb));
    setActiveSheetId(id);
  }, [commit, workbook, commitPendingEntry]);
  const onDuplicateSheetTab = useCallback((sheetId) => {
    if (duplicateSheet(workbook, sheetId) === workbook) return;
    commitPendingEntry();
    const id = duplicateSheet(workbook, sheetId).activeSheetId;
    commit((wb) => duplicateSheet(wb, sheetId));
    setActiveSheetId(id);
  }, [commit, workbook, commitPendingEntry]);
  const onRenameSheetTab = useCallback((id, name) => commit((wb) => renameSheet(wb, id, name)), [commit]);
  const onDeleteSheetTab = useCallback((sheetId) => {
    const next = deleteSheet(workbook, sheetId);
    if (next === workbook) return;
    commitPendingEntry();
    commit((wb) => deleteSheet(wb, sheetId));
    setActiveSheetId(next.activeSheetId);
  }, [commit, workbook, commitPendingEntry]);
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
  // NEW-2 — a short, visible message from the grid (Excel's "This action won't work on multiple selections").
  const onNotice = useCallback((text) => setFileNotice({ kind: "warn", text }), []);
  // NEW-1 (owner chat block, 2026-09-05) — Import Excel replaces the WHOLE workbook, and used to
  // do it unconditionally: importing a two-sheet file into a workbook that already had a real
  // Sheet1 silently discarded it, with nothing in the label or the flow saying so (Ctrl+Z recovers
  // it, but that doesn't survive a reload, so it isn't a substitute for asking first). A file is
  // only ever queued here — never read/parsed yet — while `workbookHasContent(workbook)` says the
  // CURRENT workbook has something in it to lose; an empty workbook (a brand-new project, or one
  // nobody has typed into) still imports immediately, no prompt, exactly as before.
  const [pendingXlsxImport, setPendingXlsxImport] = useState(null); // { file, sheetCount } | null

  const currentFileBaseName = useCallback(() => {
    if (fileMode && fw.name) return sanitizeFilename(fw.name.replace(/\.[A-Za-z0-9]+$/, ""));
    if (openOrgWorkbook) return sanitizeFilename(orgWorkbookName);
    let name = "Workbook";
    if (projectId) name = projectNameOf(projectId, "") || name;
    return sanitizeFilename(name);
  }, [projectId, openOrgWorkbook, orgWorkbookName, fileMode, fw.name]);

  /** NEW-2 — what Export writes is the workbook as it is NOW: with the Univer grid showing, an edit still inside its save
   *  debounce is flushed first and read straight from the grid (the React state is a render behind it). null = the flush FAILED
   *  (already reported) — the export must not go ahead with a stale copy. */
  const workbookForExport = useCallback(() => {
    const r = flushUniver();
    if (!r) return workbook;
    if (!r.ok || !r.workbook) { setFileNotice({ kind: "error", text: "Export stopped: the latest edit in the new grid could not be saved first. Try again in a moment." }); return null; }
    return r.workbook;
  }, [flushUniver, workbook]);

  const onExportXlsx = useCallback(async () => {
    setFileBusy(true);
    try {
      const wbNow = workbookForExport();
      if (!wbNow) return;
      const blob = await exportWorkbookInWorker(wbNow, { projectNames });
      downloadBlob(blob, `${currentFileBaseName()}.xlsx`);
    } catch (e) {
      setFileNotice({ kind: "error", text: `Export to Excel failed: ${e?.message || e}` });
    } finally { setFileBusy(false); }
  }, [workbookForExport, currentFileBaseName, projectNames]);

  const onExportCsv = useCallback(() => {
    try {
      const wbNow = workbookForExport();
      if (!wbNow) return;
      // Straight from the flushed workbook when the Univer grid is showing; otherwise exactly what is on screen, as before.
      const entry = wbNow === workbook ? activeEntry : (wbNow.sheets.find((e) => e.id === activeSheetId) || activeSheetEntry(wbNow));
      const csv = wbNow === workbook ? sheetToCsv(sheet, evalResult) : sheetToCsv(entry.sheet, evaluateWorkbook(wbNow, { projectNames }).get(entry.id));
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      downloadBlob(blob, `${sanitizeFilename(entry.name)}.csv`);
    } catch (e) {
      setFileNotice({ kind: "error", text: `Export to CSV failed: ${e?.message || e}` });
    }
  }, [workbookForExport, workbook, activeEntry, activeSheetId, sheet, evalResult, projectNames]);

  const runXlsxImport = useCallback(async (file) => {
    setFileBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const { workbook: imported, unsupportedCount } = await parseSpreadsheetInWorker(buf, file.name);
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
      setFileNotice({ kind: "error", text: e?.message || `Could not read “${file.name}” as an Excel file.` }); // SpreadsheetFileError messages already name the file
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

  // NEW-1 — the file's untouched first upload (the oldest stored version), straight to disk.
  const onDownloadOriginal = useCallback(async () => {
    setFileBusy(true);
    try {
      const got = await fw.downloadOriginal();
      if (!got) { setFileNotice({ kind: "error", text: "Couldn’t read the original upload from your Library. Check your connection and try again." }); return; }
      downloadBlob(got.blob, got.name);
    } catch (e) {
      setFileNotice({ kind: "error", text: `Couldn’t download the original: ${e?.message || e}` });
    } finally { setFileBusy(false); }
  }, [fw]);

  // NEW-1 — "Open Excel or CSV file…": the in-module door to the SAME place a Library click lands. The
  // file is FILED in the Library under this project (or the Organization) first — one document, never a
  // disconnected import — and then opened from there.
  const onOpenFileFromComputer = useCallback(async (file) => {
    if (!file) return;
    if (!spreadsheetKindOf(file.name)) { setFileNotice({ kind: "error", text: `“${file.name}” isn’t an Excel or CSV file. Choose a .xlsx, .xls or .csv file.` }); return; }
    if (!orgMode && !(openProject && projectId)) { setFileNotice({ kind: "error", text: "Open a project (or switch to the Organization) first — the file is saved in its Library." }); return; }
    setFileBusy(true);
    try {
      const { fileNewReview } = await import("../doc-review/lib/reviewStore.js");
      const res = await fileNewReview({
        projectId: orgMode ? null : projectId, project: orgMode ? "" : (projectNameOf(projectId, "") || ""),
        discipline: "Other", orgScope: orgMode, blob: file, fileName: file.name,
      });
      if (!res.ok || res.uploadFailed) {
        setFileNotice({ kind: "error", text: `Couldn’t save “${file.name}” to your Library: ${res.error || res.driveError || "check your connection and that you’re signed in"}.` });
        return;
      }
      setActiveFile(fileScopeRef.current, res.id);
    } catch (e) {
      setFileNotice({ kind: "error", text: `Couldn’t open “${file.name}”: ${e?.message || e}` });
    } finally { setFileBusy(false); }
  }, [orgMode, openProject, projectId]);

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
    commitPendingEntry(); // NEW-1 — leaving a sheet commits what was typed on it
    setActiveSheetId(sheetId);
    setSelRange({ r1: row, r2: row, c1: col, c2: col });
  }, [commitPendingEntry]);
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
    applyActiveRanges(selRange, setNumberFormat, token);
  }, [applyActiveRanges, selRange]);
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
    applyActiveRanges(selRange, setCellStyle, patch);
  }, [applyActiveRanges, selRange]);
  const onAdjustIndent = useCallback((delta) => {
    applyActiveRanges(selRange, adjustIndent, delta);
  }, [applyActiveRanges, selRange]);
  const onApplyBorderCmd = useCallback(({ edges, style, mode }) => {
    applyActiveRanges(selRange, applyBorder, { edges, style, mode });
  }, [applyActiveRanges, selRange]);
  const onClearFormattingCmd = useCallback(() => {
    applyActiveRanges(selRange, clearFormatting);
  }, [applyActiveRanges, selRange]);
  const onNumberFormatOp = useCallback((op) => {
    const fn = op === "increaseDecimals" ? increaseDecimals : op === "decreaseDecimals" ? decreaseDecimals : toggleThousands;
    applyActiveRanges(selRange, setNumberFormat, fn(activeFormat));
  }, [applyActiveRanges, selRange, activeFormat]);

  // Format Painter — arm/disarm on click (capturing the CURRENT active cell's format+style);
  // applying happens in onSelectionSettled below, fired by SheetView the moment the user's next
  // click or drag actually settles on a target — see that prop's own header note for why.
  const onFormatPainterToggle = useCallback(() => {
    setPainter((p) => (p ? null : { source: paintedStyleAt(sheet, selRange.r1, selRange.c1) }));
  }, [sheet, selRange]);
  const onSelectionSettled = useCallback(() => {
    setPainter((p) => {
      if (!p) return p;
      applyActiveRanges(selRangeRef.current, applyPaintedStyle, p.source);
      return null;
    });
  }, [applyActiveRanges]);

  const onMergeToggle = useCallback(() => {
    if (isMulti(selRange)) { onNotice(MULTI_SELECTION_MESSAGE); return; }
    applyActive((s) => {
      const m = mergeAt(s, selRange.r1, selRange.c1);
      return m ? unmergeAt(s, selRange.r1, selRange.c1) : mergeRange(s, selRange.r1, selRange.r2, selRange.c1, selRange.c2);
    });
  }, [applyActive, selRange, onNotice]);

  // Insert/Delete (Cells group) act on the single active row/column — the right-click context
  // menu (SheetView.jsx) is the multi-row/column-aware path; the ribbon mirrors Excel's own
  // ribbon behavior for a plain cell selection.
  // (NEW-2: these act on ONE row/column, so a multi-range selection gets Excel's message instead of a guess.)
  const onRibbonInsertRow = useCallback(() => { if (isMulti(selRange)) onNotice(MULTI_SELECTION_MESSAGE); else onInsertRowAt(selRange.r1); }, [onInsertRowAt, selRange, onNotice]);
  const onRibbonInsertColumn = useCallback(() => { if (isMulti(selRange)) onNotice(MULTI_SELECTION_MESSAGE); else onInsertColumnAt(selRange.c1); }, [onInsertColumnAt, selRange, onNotice]);
  const onRibbonDeleteRow = useCallback(() => { if (isMulti(selRange)) onNotice(MULTI_SELECTION_MESSAGE); else onDeleteRowAt(selRange.r1); }, [onDeleteRowAt, selRange, onNotice]);

  const onSetFreezeTopRow = useCallback(() => onSetFreeze(1, sheet.freezeCols), [onSetFreeze, sheet.freezeCols]);
  const onSetFreezeFirstColumn = useCallback(() => onSetFreeze(sheet.freezeRows, 1), [onSetFreeze, sheet.freezeRows]);
  const onSetFreezeAtSelection = useCallback(() => onSetFreeze(selRange.r1, selRange.c1), [onSetFreeze, selRange]);
  const onUnfreeze = useCallback(() => onSetFreeze(0, 0), [onSetFreeze]);

  // Sort (Sort & Filter). A one-row/one-cell selection sorts the WHOLE contiguous used range of
  // the active column instead of no-op'ing — Excel's own "select one cell, hit Sort" behavior,
  // and far more useful on a real pro-forma than requiring an exact range be dragged first.
  const onSort = useCallback((direction) => {
    if (isMulti(selRange)) { onNotice(MULTI_SELECTION_MESSAGE); return; }
    let r1 = selRange.r1, r2 = selRange.r2;
    if (r1 === r2) { const used = usedRangeEnd(sheet); r1 = 0; r2 = used ? used.row : 0; }
    applyActive(sortRange, r1, r2, selRange.c1, direction);
  }, [applyActive, selRange, sheet, onNotice]);

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
    const manual = sheet.hiddenRows && Object.keys(sheet.hiddenRows).length > 0 ? sheet.hiddenRows : null; // Ctrl+9
    if (columnFilters.size === 0 && !manual) return null;
    const hidden = new Set(manual ? Object.keys(manual).map(Number) : []);
    if (columnFilters.size === 0) return hidden;
    for (let r = 0; r < sheet.rowCount; r++) {
      for (const [colIndex, allowed] of columnFilters) {
        if (!allowed.has(displayFor(sheet, evalResult, r, colIndex))) { hidden.add(r); break; }
      }
    }
    return hidden;
  }, [sheet, evalResult, columnFilters]);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⛔ EXCEL SHORTCUTS (owner, 2026-10-29: "muscle memory is the spec") — every handler below is a ctx entry the
  // command registry runs; the key tables (lib/keymap.js, lib/keyTips.js) only pick WHICH one. Plain closures over
  // this render's state: `ctxRef` (below) is re-pointed at every render, so a key handler always runs the latest.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const selNorm = clampSelection(sheet, selRange);
  const selKind = selectionKind(sheet, selRange);
  const eachIndex = (a, b, fn) => { for (let i = a; i <= b; i++) fn(i); };
  // NEW-2 (B2530689) — Excel's answer to a command that needs ONE rectangle when several ranges are selected: say so,
  // never a silent no-op and never "acts on the last range only".
  const refuseMulti = () => {
    if (!isMulti(liveRef.current.selRange)) return false;
    onNotice(MULTI_SELECTION_MESSAGE); // the same banner the grid's own multi-range refusals use (model-file-notice)
    return true;
  };

  // ---- clipboard -------------------------------------------------------------------------------
  // Scope: the grid / toolbar owns the clipboard events ONLY when no text control (cell editor, formula bar, name box,
  // find bar, a dialog's field) has focus — native text copy / paste keeps working there — and no page text is selected.
  const clipboardScopeOk = (e) => {
    if (!isActive) return false;
    const el = (document.activeElement && document.activeElement !== document.body ? document.activeElement : e.target);
    if (el && el.closest) {
      if (el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="dialog"]')) return false;
      if (!el.closest('[data-testid="model-root"]')) return false;
    }
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim() !== "" && !(el && el.closest && el.closest('[data-testid="model-sheet"]'))) return false;
    return true;
  };

  // The used-range clamp: a whole column / row / sheet copies its USED part (Excel does the same), never 1000 blank rows.
  const clipSelection = () => {
    const live = liveRef.current;
    const s = clampSelection(live.sheet, live.selRange);
    const kind = selectionKind(live.sheet, live.selRange);
    const used = usedRangeEnd(live.sheet);
    if (kind === "columns" || kind === "sheet") s.r2 = Math.max(s.r1, Math.min(s.r2, used ? used.row : s.r1));
    if (kind === "rows" || kind === "sheet") s.c2 = Math.max(s.c1, Math.min(s.c2, used ? used.col : s.c1));
    return s;
  };

  // Copy / cut: put text/plain (TSV of the displayed values) + text/html (styled table + Planyr marker) on the clipboard.
  // `clipboardData` is the native event's; with none (a browser that refuses it) the async API, then the internal ref.
  const performCopy = (clipboardData, cut) => {
    if (refuseMulti()) return false;
    const live = liveRef.current;
    const sel = clipSelection();
    const clip = buildClip(live.sheet, sel, { hiddenRows: live.hiddenRows });
    const displayAt = (r, c) => displayFor(live.sheet, live.evalResult, r, c);
    const text = clipToText(clip, displayAt), html = clipToHtml(clip, displayAt);
    internalClipRef.current = clip;
    let wrote = false;
    if (clipboardData) {
      try { clipboardData.setData("text/plain", text); clipboardData.setData("text/html", html); wrote = true; } catch { wrote = false; }
    }
    if (!wrote && navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new window.ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })])
        .catch(() => showNotice("Couldn't write to the system clipboard — pasting inside Planyr still works."));
      wrote = true;
    }
    if (!wrote) showNotice("Couldn't write to the system clipboard — pasting inside Planyr still works.");
    setClipMark({ sheetId: live.activeSheetId, rect: sel, mode: cut ? "cut" : "copy", id: clip.id });
    pendingCutRef.current = cut ? { id: clip.id, sheetId: live.activeSheetId, rect: sel } : null;
    return wrote;
  };

  // Paste: whatever arrived (a Planyr marker, an Excel / Docs / web table, or plain text) becomes one Clip and goes in at
  // the selection — ONE undo step. A cut pasted in the window that cut it MOVES (source cleared, references follow).
  const performPaste = ({ html = "", text = "", noClipboardData = false }) => {
    if (refuseMulti()) return;
    const live = liveRef.current;
    let clip = parseClipboard({ html, text });
    // The internal copy is a fallback for a browser that handed the event NO clipboardData at all — never for a clipboard
    // that is merely empty or holds something else (that would paste a stale copy over what the user just copied elsewhere).
    if (!clip && noClipboardData && internalClipRef.current) clip = internalClipRef.current;
    if (!clip || clipIsEmpty(clip)) { showNotice("Nothing to paste — the clipboard holds no cells or text."); return; }
    try {
      const sel = clampSelection(live.sheet, live.selRange);
      const cut = pendingCutRef.current;
      const isMove = !!(cut && clip.id && clip.id === cut.id && !consumedCutsRef.current.has(cut.id));
      let dest = null;
      if (isMove && cut.sheetId === live.activeSheetId) {
        commit((wb) => { const r = pasteMoveSameSheet(setActiveSheet(wb, live.activeSheetId), live.activeSheetId, clip, cut, sel); dest = r.dest; return r.workbook; });
      } else if (isMove) {
        // cut on another tab: the cells move here; formulas elsewhere that pointed at the old cells are NOT re-pointed
        commit((wb) => {
          const wb1 = setActiveSheet(wb, live.activeSheetId);
          const r = applyToActiveSheet(wb1, (sh) => { const x = applyClip(sh, clip, sel); dest = x.dest; return x.sheet; });
          return { ...r, sheets: r.sheets.map((e) => (e.id === cut.sheetId ? { ...e, sheet: clearCellRange(e.sheet, cut.rect.r1, cut.rect.r2, cut.rect.c1, cut.rect.c2) } : e)) };
        });
        showNotice("Moved to this sheet. Formulas that pointed at the old cells were not updated.");
      } else {
        applyActive((sh) => { const x = applyClip(sh, clip, sel); dest = x.dest; return x.sheet; });
      }
      if (isMove) { consumedCutsRef.current.add(cut.id); clearClipMark(); }
      if (dest) setSelRange({ r1: dest.r1, r2: dest.r2, c1: dest.c1, c2: dest.c2 });
    } catch (err) {
      showNotice(`Paste failed: ${err && err.message ? err.message : "unknown error"}`); // LOUD-FAILURE
    }
  };

  // Menu / palette entry points use the SAME functions: copy & cut ask the browser to run its own copy / cut (which fires the
  // event the listener below handles); paste reads the clipboard asynchronously — if the browser refuses, say so.
  const onClipboardCommand = (which) => {
    sheetViewRef.current?.focusGrid();
    if (which === "paste") {
      if (!navigator.clipboard || !navigator.clipboard.read) { showNotice("Your browser won't let a menu read the clipboard — press Ctrl+V instead."); return; }
      navigator.clipboard.read().then(async (items) => {
        let html = "", text = "";
        for (const item of items) {
          if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
          if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
        }
        performPaste({ html, text });
      }).catch(() => showNotice("Your browser blocked reading the clipboard from the menu — press Ctrl+V instead."));
      return;
    }
    let fired = false;
    const probe = () => { fired = true; };
    document.addEventListener(which, probe, true);
    let ok = false;
    try { ok = document.execCommand(which); } catch { ok = false; }
    document.removeEventListener(which, probe, true);
    if (!ok || !fired) performCopy(null, which === "cut"); // the browser would not run it: write through the async API
  };

  // ---- Alt+Enter wrap, Ctrl+Enter fill -----------------------------------------------------------
  const onFillRight = () => applyActiveRanges(selRange, fillRight);

  // ---- date / time / copy-from-above / autosum ------------------------------------------------------
  const onInsertDate = () => {
    const { r1: r, c1: c } = selNorm;
    clearClipMark();
    applyActive((s) => { const n = commitCellText(s, r, c, todayIso()); return formatAt(n, r, c) ? n : setNumberFormat(n, r, r, c, c, "mm/dd/yyyy"); });
  };
  const onInsertTime = () => { clearClipMark(); applyActive(commitCellText, selNorm.r1, selNorm.c1, timeText()); };
  const onCopyAbove = (kind) => {
    const { r1: r, c1: c } = selNorm;
    if (r === 0) { showNotice("There is no cell above to copy from."); return; }
    const raw = rawAt(sheet, r - 1, c);
    const text = kind === "value" && raw.trim().startsWith("=") ? displayFor(sheet, evalResult, r - 1, c) : raw;
    clearClipMark();
    applyActive(commitCellText, r, c, text);
  };
  const onAutoSum = () => {
    const plan = autoSumPlan(sheet, selNorm.r1, selNorm.r2, selNorm.c1, selNorm.c2);
    if (plan.length === 0) { showNotice("AutoSum: no numbers above or to the left of this cell."); return; }
    clearClipMark();
    applyActive((s) => plan.reduce((acc, p) => commitCellText(acc, p.r, p.c, p.text), s));
    setSelRange({ r1: plan[0].r, r2: plan[plan.length - 1].r, c1: plan[0].c, c2: plan[plan.length - 1].c });
  };
  const onRepeatLast = () => {
    const last = lastActionRef.current;
    const fn = last && ctxRef.current && ctxRef.current[last.name];
    if (!fn) { showNotice("Nothing to repeat yet."); return; }
    fn(...last.args);
  };

  // ---- clear -----------------------------------------------------------------------------------------
  const onClearContents = () => onBlankRanges(rangesOf(selRange));
  const onClearAll = () => { clearClipMark(); applyActiveRanges(selRange, clearCellRange); };

  // ---- widths / heights / autofit -----------------------------------------------------------------------
  const usedLastRow = () => { const u = usedRangeEnd(sheet); return u ? u.row : 0; };
  const onAutofit = (axis) => {
    if (refuseMulti()) return;
    if (axis === "columns") {
      const widths = [];
      eachIndex(selNorm.c1, selNorm.c2, (c) => widths.push([c, autofitColumnWidth(sheet, evalResult, c, canvasMeasure)]));
      applyActive((s) => widths.reduce((acc, [c, w]) => setColumnWidth(acc, c, w), s));
    } else {
      const last = selKind === "columns" || selKind === "sheet" ? Math.max(selNorm.r1, Math.min(selNorm.r2, usedLastRow())) : selNorm.r2;
      const heights = [];
      eachIndex(selNorm.r1, last, (r) => heights.push([r, autofitRowHeight(sheet, evalResult, r, (c) => (sheet.columns[c]?.width || 120), canvasMeasure)]));
      applyActive((s) => heights.reduce((acc, [r, h]) => setRowHeight(acc, r, h), s));
    }
  };
  const openDialog = (spec) => setDialog(spec);
  const onOpenDialog = (kind) => {
    if ((kind === "column-width" || kind === "row-height") && refuseMulti()) return;
    if (kind === "column-width") {
      openDialog({
        title: "Column width", submitLabel: "OK",
        fields: [{ key: "w", label: selNorm.c1 === selNorm.c2 ? "Width" : "Width (every selected column)", type: "number", min: 1, value: String(sheet.columns[selNorm.c1]?.width || 120) }],
        run: ({ w }) => { const n = Number(w); if (Number.isFinite(n) && n > 0) applyActive((s) => { let acc = s; eachIndex(selNorm.c1, selNorm.c2, (c) => { acc = setColumnWidth(acc, c, n); }); return acc; }); },
      });
    } else if (kind === "row-height") {
      openDialog({
        title: "Row height", submitLabel: "OK",
        fields: [{ key: "h", label: selNorm.r1 === selNorm.r2 ? "Height" : "Height (every selected row)", type: "number", min: 1, value: String(sheet.rowHeights[selNorm.r1] || DEFAULT_ROW_H) }],
        run: ({ h }) => { const n = Number(h); if (Number.isFinite(n) && n > 0) applyActive((s) => { let acc = s; eachIndex(selNorm.r1, selNorm.r2, (r) => { acc = setRowHeight(acc, r, n); }); return acc; }); },
      });
    } else if (kind === "number-format") {
      const cur = activeFormat || null;
      const preset = NUMBER_FORMATS.find((f) => (f.token || null) === cur);
      openDialog({
        title: "Number format", submitLabel: "OK",
        fields: [
          { key: "preset", label: "Format", type: "select", value: preset ? preset.id : "custom", options: [...NUMBER_FORMATS.map((f) => ({ value: f.id, label: f.label })), { value: "custom", label: "Custom…" }] },
          { key: "custom", label: "Custom format", type: "text", value: preset ? "" : (cur || ""), hint: "Used when Format is Custom — for example 0.0\"x\"" },
        ],
        run: ({ preset: p, custom }) => {
          if (p === "custom") onApplyFormat(custom.trim() || null);
          else onApplyFormat((NUMBER_FORMATS.find((f) => f.id === p) || NUMBER_FORMATS[0]).token);
        },
      });
    }
  };

  // ---- hide / unhide --------------------------------------------------------------------------------------
  const onHide = (axis) => {
    if (refuseMulti()) return;
    if (axis === "rows") {
      if (selNorm.r1 === 0 && selNorm.r2 >= sheet.rowCount - 1) { showNotice("Can't hide every row."); return; }
      applyActive(setRowsHidden, selNorm.r1, selNorm.r2, true);
      let nr = selNorm.r2 + 1;
      while (nr < sheet.rowCount && sheet.hiddenRows?.[nr]) nr++;
      if (nr >= sheet.rowCount) { nr = selNorm.r1 - 1; while (nr > 0 && sheet.hiddenRows?.[nr]) nr--; }
      nr = Math.max(0, nr);
      setSelRange({ r1: nr, r2: nr, c1: selNorm.c1, c2: selNorm.c1 });
    } else {
      if (sheet.columns.every((col, i) => col.hidden || (i >= selNorm.c1 && i <= selNorm.c2))) { showNotice("Can't hide every column."); return; }
      applyActive(setColumnsHidden, selNorm.c1, selNorm.c2, true);
      let nc = selNorm.c2 + 1;
      while (nc < sheet.columns.length && sheet.columns[nc].hidden) nc++;
      if (nc >= sheet.columns.length) { nc = selNorm.c1 - 1; while (nc > 0 && sheet.columns[nc].hidden) nc--; }
      nc = Math.max(0, nc);
      setSelRange({ r1: selNorm.r1, r2: selNorm.r1, c1: nc, c2: nc });
    }
  };
  // Unhide: the hidden rows / columns inside the selection; a single selected line also reaches the hidden run right beside it
  // (a hidden row can't be selected, so Excel's "select around it" is offered by adjacency here).
  const onUnhide = (axis) => {
    if (refuseMulti()) return;
    const isHidden = axis === "rows" ? (i) => !!sheet.hiddenRows?.[i] : (i) => !!sheet.columns[i]?.hidden;
    const max = axis === "rows" ? sheet.rowCount - 1 : sheet.columns.length - 1;
    let lo = axis === "rows" ? selNorm.r1 : selNorm.c1, hi = axis === "rows" ? selNorm.r2 : selNorm.c2;
    if (lo === hi) { while (lo > 0 && isHidden(lo - 1)) lo--; while (hi < max && isHidden(hi + 1)) hi++; }
    let any = false;
    for (let i = lo; i <= hi; i++) if (isHidden(i)) { any = true; break; }
    if (!any) { showNotice(`No hidden ${axis} here.`); return; }
    if (axis === "rows") applyActive(setRowsHidden, lo, hi, false); else applyActive(setColumnsHidden, lo, hi, false);
  };

  // ---- insert / delete (Ctrl+Shift+= , Ctrl+-) ---------------------------------------------------------------
  const insertRows = (at, n) => applyStructuralActive((wb) => { let acc = wb; for (let i = 0; i < n; i++) acc = workbookInsertRowAt(acc, at); return acc; });
  const insertColumns = (at, n) => applyStructuralActive((wb) => { let acc = wb; for (let i = 0; i < n; i++) acc = workbookInsertColumnAt(acc, at); return acc; });
  const deleteRows = (a, b) => applyStructuralActive((wb) => { let acc = wb; for (let i = b; i >= a; i--) acc = workbookDeleteRowAt(acc, i); return acc; });
  const deleteColumns = (a, b) => {
    if (sheet.columns.length - (b - a + 1) < 1) { showNotice("A sheet needs at least one column."); return; }
    applyStructuralActive((wb) => { let acc = wb; for (let i = b; i >= a; i--) acc = workbookDeleteColumn(acc, i); return acc; });
  };
  const onInsertCells = () => {
    if (refuseMulti()) return;
    if (selKind === "rows") insertRows(selNorm.r1, selNorm.r2 - selNorm.r1 + 1);
    else if (selKind === "columns") insertColumns(selNorm.c1, selNorm.c2 - selNorm.c1 + 1);
    else if (selKind === "sheet") showNotice("Select a row, a column or some cells to insert at.");
    else {
      const s0 = { ...selNorm };
      openDialog({
        title: "Insert", submitLabel: "OK",
        fields: [{ key: "what", type: "radio", value: "row", options: [{ value: "row", label: "Entire row" }, { value: "col", label: "Entire column" }] }],
        run: ({ what }) => (what === "row" ? insertRows(s0.r1, s0.r2 - s0.r1 + 1) : insertColumns(s0.c1, s0.c2 - s0.c1 + 1)),
      });
    }
  };
  const onDeleteCells = () => {
    if (refuseMulti()) return;
    if (selKind === "rows") deleteRows(selNorm.r1, selNorm.r2);
    else if (selKind === "columns") deleteColumns(selNorm.c1, selNorm.c2);
    else if (selKind === "sheet") showNotice("Select a row, a column or some cells to delete.");
    else {
      const s0 = { ...selNorm };
      openDialog({
        title: "Delete", submitLabel: "OK",
        fields: [{ key: "what", type: "radio", value: "row", options: [{ value: "row", label: "Entire row" }, { value: "col", label: "Entire column" }] }],
        run: ({ what }) => (what === "row" ? deleteRows(s0.r1, s0.r2) : deleteColumns(s0.c1, s0.c2)),
      });
    }
  };

  // ---- sheets, save, merge & centre, colour menus ----------------------------------------------------------------
  const onSheetStep = (dir) => {
    const i = workbook.sheets.findIndex((e) => e.id === activeEntry.id);
    const next = workbook.sheets[i + dir];
    if (next) { commitPendingEntry(); setActiveSheetId(next.id); } // B2540736 — leaving a sheet commits what was typed on it
  };
  const onSaveNow = () => {
    if (fileMode) { fw.flush?.(); showNotice(fw.cloudConfirmed ? "Saving the file…" : "Saving…"); return; }
    if (userId && status !== "not-provisioned" && !divergedRef.current) {
      // main's push effect only fires for edits not yet confirmed uploaded (dirtyRef) — say so when there are none
      if (!dirtyRef.current) { showNotice("Everything is already saved to your account."); return; }
      pushImmediateRef.current = true;
      setPushNonce((n) => n + 1);
      showNotice("Saving to your account…");
    } else showNotice(userId ? "Saved on this device — the cloud copy is on hold (see the badge above)." : "Saved on this device — sign in to back it up to your account.");
  };
  const onMergeCenter = () => { if (!refuseMulti()) applyActive(mergeCenterPlan); };
  const mergeCenterPlan = (s) => {
    let acc = s;
    for (let r = selNorm.r1; r <= selNorm.r2; r++) { if (!mergeAt(acc, r, selNorm.c1)) acc = mergeRange(acc, r, r, selNorm.c1, selNorm.c2); }
    return setCellStyle(acc, selNorm.r1, selNorm.r2, selNorm.c1, selNorm.c2, { align: "center" });
  };
  const onOpenColorMenu = (which) => {
    const detail = { which, claimed: false };
    window.dispatchEvent(new CustomEvent("model-open-color-menu", { detail }));
  };
  // "repeat last action" (F4): the formatting / structure handlers below record themselves by NAME so the repeat runs the
  // CURRENT version (with the current selection), not the one that was live when the action first ran.
  const recd = (name, fn) => (...args) => { lastActionRef.current = { name, args }; return fn(...args); };

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
    onSetCellStyle: recd("onSetCellStyle", onSetCellStyle), onAdjustIndent: recd("onAdjustIndent", onAdjustIndent), onApplyBorder: recd("onApplyBorder", onApplyBorderCmd),
    onApplyFormat: recd("onApplyFormat", onApplyFormat), onNumberFormatOp: recd("onNumberFormatOp", onNumberFormatOp),
    onClearFormatting: recd("onClearFormatting", onClearFormattingCmd),
    onFormatPainterToggle, onMergeToggle: recd("onMergeToggle", onMergeToggle),
    onInsertRow: recd("onInsertRow", onRibbonInsertRow), onInsertColumn: recd("onInsertColumn", onRibbonInsertColumn),
    onDeleteRow: recd("onDeleteRow", onRibbonDeleteRow), onDeleteColumn: recd("onDeleteColumn", onDeleteColumn),
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
    // Excel shortcuts block (2026-10-29) — see the handler block above.
    onClipboardCommand, onFillRight, onInsertDate, onInsertTime, onCopyAbove, onAutoSum, onRepeatLast,
    onClearAll, onClearContents, onAutofit, onOpenDialog, onHide, onUnhide, onInsertCells, onDeleteCells,
    onSheetStep, onSaveNow, onMergeCenter, onOpenColorMenu,
    onCancelCut: clearClipMark,
  };
  ctxRef.current = ctx;
  clipFnsRef.current = { performCopy, performPaste, clipboardScopeOk };
  liveRef.current = { sheet, workbook, activeSheetId: activeEntry.id, evalResult, selRange, hiddenRows };

  /* ---- the window-level listeners (re-armed only when the workspace is shown / hidden) ---------------------------------
   * Everything they run goes through `ctxRef` / `liveRef`, so they never close over a stale render. */
  const runCommand = useCallback((id) => {
    if (!ctxRef.current) return false;
    return runCommandById(id, ctxRef.current);
  }, []);

  // (1) Excel's Ctrl / F-key / Alt+= chords -> registry commands (lib/keymap.js). Inside the in-cell editor only the four
  // font-style chords fire; any other text control (formula bar, name box, find bar, a dialog) keeps every key.
  useEffect(() => {
    if (!gridKeysOn) return undefined;
    const onKey = (e) => {
      if (keyTipRef.current.active) return; // an Alt sequence owns the keyboard (handled in the capture listener below)
      const t = e.target instanceof Element ? e.target : null;
      const editing = !!(t && t.closest("[data-cell-editor]"));
      if (!editing && t && t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const id = chordCommand(e, { editing });
      if (!id) return;
      e.preventDefault();
      runCommand(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gridKeysOn, runCommand]);

  // (2) The Alt key-tip sequence. Press and release Alt ALONE -> the sequence opens; letters follow Excel's Home / View paths
  // (lib/keyTips.js); Esc backs out a level; an unmatched key, a second Alt or any click cancels. Capture phase, so while a
  // sequence is open NOTHING else (the grid's type-to-edit, a ribbon button) sees the letters. Alt+Enter / Alt+click / Alt+= are
  // chords, not "Alt alone": any other key or a mouse press between Alt down and up cancels the arming.
  useEffect(() => {
    if (!gridKeysOn) return undefined;
    let armed = false;
    const setTip = (st) => { keyTipRef.current = st; setKeyTip(st); };
    const scopeOk = (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t && t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return false;
      return !t || !!t.closest('[data-testid="model-root"]') || t === document.body;
    };
    const down = (e) => {
      if (e.key === "Alt") {
        if (e.repeat) { if (keyTipRef.current.active || armed) e.preventDefault(); return; }
        if (keyTipRef.current.active) { e.preventDefault(); e.stopPropagation(); setTip(KEYTIP_START); armed = false; return; }
        armed = !e.ctrlKey && !e.metaKey && !e.shiftKey && scopeOk(e);
        return;
      }
      armed = false;
      if (!keyTipRef.current.active) return;
      e.preventDefault(); e.stopPropagation();
      const { state, run } = stepKeyTips(keyTipRef.current, e.key);
      setTip(state);
      if (run && !runCommand(run)) showNotice("That command isn't available right now.");
    };
    const up = (e) => {
      if (e.key !== "Alt") return;
      if (armed && !keyTipRef.current.active) {
        // preventDefault on the Alt KEYUP is what stops Windows browsers focusing their own menu bar
        e.preventDefault(); e.stopPropagation();
        setTip(beginKeyTips());
      } else if (keyTipRef.current.active) { e.preventDefault(); }
      armed = false;
    };
    const cancel = () => { armed = false; if (keyTipRef.current.active) setTip(KEYTIP_START); };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("mousedown", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("mousedown", cancel, true);
      window.removeEventListener("blur", cancel);
      keyTipRef.current = KEYTIP_START;
    };
  }, [gridKeysOn, runCommand, showNotice]);

  // (3) The real clipboard: native copy / cut / paste EVENTS (no permission prompt) — see lib/clipboardIO.js. The functions are
  // reached through `clipFnsRef` (re-pointed every render) so a listener armed once never writes into a stale sheet / tab.
  useEffect(() => {
    if (!gridKeysOn) return undefined;
    const onCopyEvent = (e, cut) => {
      const F = clipFnsRef.current;
      if (!F || !F.clipboardScopeOk(e)) return;
      if (e.clipboardData) e.preventDefault();
      F.performCopy(e.clipboardData, cut);
    };
    const onCopy = (e) => onCopyEvent(e, false);
    const onCut = (e) => onCopyEvent(e, true);
    const onPasteEvent = (e) => {
      const F = clipFnsRef.current;
      if (!F || !F.clipboardScopeOk(e)) return;
      e.preventDefault();
      const cd = e.clipboardData;
      F.performPaste(cd ? { html: cd.getData("text/html"), text: cd.getData("text/plain") } : { noClipboardData: true });
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPasteEvent);
    return () => { document.removeEventListener("copy", onCopy); document.removeEventListener("cut", onCut); document.removeEventListener("paste", onPasteEvent); };
  }, [gridKeysOn]);

  const projectName = useProjectName(projectId, ""); // shared/names — the one live source
  const currentProject = projectId ? { id: projectId, name: projectName || "Untitled project" } : null;

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
        authControl={authControl}
        accountActive={accountActive}
        saveState={openWorkbook ? modelSaveState(shownStatus, accountActive, fileMode ? fw.cloudConfirmed : cloudConfirmed) : null}
        saveDetail={
          shownStatus === "not-provisioned" ? "Cloud backup for Spreadsheet isn't turned on yet — saved on this device only."
          : shownStatus === "conflict" ? (fileMode ? "This file was changed somewhere else — use “Show the Library’s version” in the bar above the sheet (your edits here are kept on this device)." : "This spreadsheet changed elsewhere — reload to see the latest (your edits here stayed on this device).")
          : shownStatus === "diverged" ? "This spreadsheet has different content saved from another device or browser. Nothing is being saved to the cloud until you choose which copy to keep, using the bar above the sheet."
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
              onOpenFile={onOpenFileFromComputer}
              univerSwitch={univer.available ? { on: univer.on, setOn: setUniverOn } : null}
            />
            {!univerOn && (
              <>
                <span aria-hidden="true" style={{ width: 1, height: 18, flex: "none", background: "var(--chrome-divider)" }} />
                <AuditGroup ctx={ctx} />
              </>
            )}
          </>
        ) : undefined}
      />

      {openWorkbook && fileMode && fw.phase === "error" ? (
        <FileProblem
          message={fw.error?.message || "This file couldn’t be opened."}
          canRetry={["download", "timeout", "error", "worker"].includes(fw.error?.code)}
          onRetry={fw.retryOpen}
          onClose={() => setActiveFile(fileScopeRef.current, null)}
        />
      ) : openWorkbook && fileMode && fw.phase !== "ready" ? (
        <FileLoading name={fw.name} />
      ) : openWorkbook ? (
        <>
          {fileMode && (
            <>
              <FileBar
                name={fw.name}
                inPlace={fw.inPlace}
                saving={fw.status === "saving"}
                saveError={fw.saveError}
                conflict={fw.status === "conflict"}
                hasOriginal={fw.hasOriginal}
                onDownloadOriginal={onDownloadOriginal}
                onClose={closeFile}
                onRetry={fw.retrySave}
                onReload={fw.reloadFromLibrary}
              />
              <FileNotes notes={fw.notes} fileKey={activeFileId} />
            </>
          )}
          {diverged && (
            <DivergedBar
              showing={divergedCopiesRef.current?.showing || "device"}
              onKeepDevice={onKeepDeviceCopy}
              onUseCloud={onUseCloudCopy}
            />
          )}
          {univerOn ? (
            // Univer spike (owner-only, switch on) — Univer's own toolbar, formula bar, grid and sheet tabs replace the four
            // pieces below. Edits come back as a whole Planyr workbook through the SAME `commit` (and so the same write-through,
            // cloud push, file-mode save and undo frame) as every other edit — persistence is not touched.
            <Suspense fallback={<div role="status" style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 12, color: "var(--text-secondary)" }}>Loading the new grid…</div>}>
              <UniverSheet
                key={univerScope}
                workbook={workbook}
                projectNames={projectNames}
                onChange={onUniverChange}
                onNotice={showNotice}
                onError={reportUniverSaveError}
                onReady={(h) => { univerHandleRef.current = h; }}
              />
            </Suspense>
          ) : (
          <>
          {/* NEW-1 (2026-10-29, owner-approved mockup) — the toolbar and formula bar are FLAT, full-width strips
              directly under the module tabs. They replace the Round 3/4 (B1087904) floating card — rounded
              corners, drop shadow, an 8px margin on every side over the page-grey band — which the owner read as
              wasted space ("I want it back for rows"). One wrapper only so the two strips stay one unit in this
              flex column (find-bar / name-manager flow siblings sit below it): no margin, no radius, no shadow,
              no outer border; each strip carries its own single hairline bottom border (Ribbon.jsx, FormulaBar.jsx).
              `data-testid="model-toolbar-card"` is kept for the existing specs. */}
          <div
            data-testid="model-toolbar-card"
            style={{ flex: "none", background: "var(--surface-raised)" }}
          >
          <Ribbon ctx={ctx} />
          <FormulaBar ref={formulaBarRef} sheet={sheet} row={selRange.r1} col={selRange.c1} selRange={selRange} onCommit={onCommitCell} onGoTo={onGoTo} nameBoxRef={nameBoxRef} focusGrid={focusGrid} />
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
            onBlankRanges={onBlankRanges}
            onFillDownRanges={onFillDownRanges}
            onFillText={onFillText}
            onNotice={onNotice}
            onAddColumn={onAddColumn}
            onFillDown={onFillDown}
            onCommand={runCommand}
            cutRange={clipMark && clipMark.sheetId === activeEntry.id ? clipMark.rect : null}
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
          </>
          )}
          <CommandPalette open={paletteOpen} ctx={ctx} onClose={() => setPaletteOpen(false)} />
          <KeyTipOverlay state={keyTip} />
          {dialog && <ShortcutDialog spec={dialog} onClose={() => { setDialog(null); focusGrid(); }} />}
          {notice && (
            <div
              role="status" data-testid="model-notice"
              style={{ position: "fixed", left: "50%", bottom: 48, transform: "translateX(-50%)", zIndex: 65, maxWidth: "calc(100vw - 32px)", padding: "6px 12px", background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: RADIUS.md }}
            >{notice}</div>
          )}
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
