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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import SheetView from "./components/SheetView.jsx";
import FormulaBar from "./components/FormulaBar.jsx";
import FindReplaceBar from "./components/FindReplaceBar.jsx";
import Ribbon from "./components/Ribbon.jsx";
import { RADIUS } from "../../shared/ui/radius.js";
import { useUndoableState } from "./lib/undoStack.js";
import {
  createSheet, migrateSheet, commitCellText, blankRange, renameColumn, setNumberFormat,
  deleteColumn, addColumn, formatAt, padRowCount, sheetsDiverge, rawAt,
  insertRowAt, deleteRowAt, insertColumnAt, setColumnWidth, setRowHeight, setFreeze,
  styleAt, setCellStyle, applyBorder, clearFormatting,
  paintedStyleAt, applyPaintedStyle, mergeAt, mergeRange, unmergeAt, sortRange, usedRangeEnd,
} from "./lib/sheetModel.js";
import { evaluateSheet, displayFor } from "./lib/sheetEngine.js";
import { copyRange, pasteRange, fillDown, replaceAll, replaceInCellText } from "./lib/sheetOps.js";
import { increaseDecimals, decreaseDecimals, toggleThousands } from "./lib/numberFormats.js";
import { modelSaveState } from "./lib/modelSaveState.js";
import { readZoom, writeZoom } from "./lib/sheetZoom.js";
import { readLocalSheet, writeLocalSheet, loadCloudSheet, saveCloudSheet } from "./lib/modelStore.js";
import { listProjects, reconcileProjects, onProjectsChanged } from "../../shared/projects/projects.js";

const CLOUD_PUSH_DEBOUNCE_MS = 800;

function EmptyProjectState({ onGoDashboard }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 28, background: "var(--surface-page)" }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 19, fontWeight: 700, color: "var(--text-primary)" }}>No model open</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          A model belongs to a project, the same as a site plan or a set of drawings. Pick or start a project to open its spreadsheet.
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
}) {
  const { value: sheet, commit, undo, redo, reset, canUndo, canRedo } = useUndoableState(createSheet());
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
  // B1007280 — sheet zoom is a per-project VIEW preference (like a browser's own zoom level),
  // never sheet DATA: it doesn't ride the undo stack and doesn't sync to the cloud, so two
  // people (or two tabs) looking at the same model have no reason to share a zoom level.
  const [zoom, setZoom] = useState(() => readZoom(projectId));
  useEffect(() => { setZoom(readZoom(projectId)); }, [projectId]);
  const onZoomChange = useCallback((z) => { setZoom(z); writeZoom(projectId, z); }, [projectId]);

  // STAGE 2 — THE RIBBON (B1007281). Format Painter's captured source ({format, style} — see
  // sheetModel.js's paintedStyleAt) while armed, or null. AutoFilter's on/off switch and its
  // per-column choices (colIndex -> Set of allowed display values; a column absent from the map
  // is unfiltered). All THREE are plain view state — like zoom, never through undo/redo, never
  // synced — but UNLIKE zoom, deliberately NOT persisted across a reload either: a stray armed
  // painter or an active filter surviving a reload would be confusing ("why did my cells just
  // repaint themselves") in a way an unchanged zoom level never is, so both simply reset with
  // the project.
  const [painter, setPainter] = useState(null); // { source: {format, style} } | null
  const [filterOn, setFilterOn] = useState(false);
  const [columnFilters, setColumnFilters] = useState(() => new Map());
  useEffect(() => { setPainter(null); setFilterOn(false); setColumnFilters(new Map()); }, [projectId]);
  // Format Painter needs the CURRENT selection at the moment a click/drag settles (SheetView's
  // onSelectionSettled), not the value selRange held when the painter was armed — a ref mirror,
  // the same pattern zoomRef (SheetView.jsx) already uses for exactly this reason.
  const selRangeRef = useRef(selRange);
  useEffect(() => { selRangeRef.current = selRange; }, [selRange]);

  const openProject = !crossProject && !!projectId;

  /* ---- load: local first (synchronous, always available), then reconcile against the cloud.
   * Local wins whenever it already exists on this device — see the file header for why. */
  useEffect(() => {
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    cloudVersionRef.current = null;
    setStatus("idle");
    setCloudConfirmed(false);
    if (!openProject) { reset(createSheet()); setReady(false); return undefined; }
    const local = readLocalSheet(userId, projectId);
    reset(local ? migrateSheet(local) : createSheet());
    setReady(true);
    let live = true;
    (async () => {
      const r = await loadCloudSheet(projectId);
      if (!live || loadTokenRef.current !== token) return;
      if (r.ok) {
        cloudVersionRef.current = r.version;
        setCloudConfirmed(true);
        if (!local && r.sheet) {
          reset(migrateSheet(r.sheet));
        } else if (local && r.sheet) {
          // Both a local copy AND a saved cloud copy exist. "Local always wins on load" (the
          // file header) means this device keeps showing ITS content — but if that content
          // actually differs from what's in the cloud, the very next edit will silently
          // overwrite the cloud copy at a clean version bump (no CAS conflict, because nothing
          // raced — this device's `cloudVersionRef` is genuinely current). That is a real
          // second-device data-loss path, not a hypothetical one, so it is surfaced loudly
          // rather than left to happen quietly.
          if (sheetsDiverge(migrateSheet(local), migrateSheet(r.sheet))) setStatus("diverged");
        }
      } else if (r.reason === "not-provisioned") {
        setStatus("not-provisioned");
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, openProject, userId]);

  /* Write-through local save on every commit — never debounced (the stored copy must never
   * be staler than the screen: a tab close a moment after typing must not lose that edit). */
  useEffect(() => {
    if (!ready || !openProject) return;
    if (!writeLocalSheet(userId, projectId, sheet)) setStatus("error");
  }, [sheet, ready, openProject, projectId, userId]);

  /* Best-effort, debounced cloud push through the guarded save path. Reads `status` without
   * depending on it — this must fire only on a SHEET change, not on every status transition
   * the push itself causes (that would restart the debounce on its own "saving" flag). */
  useEffect(() => {
    if (!ready || !openProject || !userId) return undefined;
    if (status === "not-provisioned") return undefined; // stop hammering a table that isn't there yet
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      setStatus("saving");
      const r = await saveCloudSheet({ uid: userId, projectId, sheet, expected: cloudVersionRef.current });
      if (r.ok) { cloudVersionRef.current = r.version; setCloudConfirmed(true); setStatus("saved"); }
      else if (r.reason === "not-provisioned") setStatus("not-provisioned");
      else if (r.reason === "conflict") setStatus("conflict");
      else if (r.reason === "unavailable") setStatus("idle");
      else setStatus("error");
    }, CLOUD_PUSH_DEBOUNCE_MS);
    return () => clearTimeout(pushTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, ready, openProject, projectId, userId]);

  // Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z (or +Y), Ctrl+G (Name Box), Ctrl+F / Ctrl+H (Find/Replace) —
  // SheetView deliberately leaves every Ctrl/Cmd chord alone so this can own them, gated on
  // `isActive` the same way Notes gates its own window shortcut: workspaces stay
  // mounted-but-hidden, so an ungated listener fires from a tab nobody is looking at.
  useEffect(() => {
    if (!isActive) return undefined;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
      else if (k === "g") { e.preventDefault(); nameBoxRef.current?.focus(); }
      else if (k === "f") { e.preventDefault(); setFindShowReplace(false); setFindOpen(true); }
      else if (k === "h") { e.preventDefault(); setFindShowReplace(true); setFindOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, undo, redo]);

  const evalResult = useMemo(() => evaluateSheet(sheet), [sheet]);
  const totalRows = sheet.rowCount + padRowCount(sheet, 20);

  const onCommitCell = useCallback((r, c, text) => commit((s) => commitCellText(s, r, c, text)), [commit]);
  const onBlankRange = useCallback((r1, r2, c1, c2) => commit((s) => blankRange(s, r1, r2, c1, c2)), [commit]);
  const onRenameColumn = useCallback((c, name) => commit((s) => renameColumn(s, c, name)), [commit]);
  const onAddColumn = useCallback(() => commit((s) => addColumn(s)), [commit]);

  // Copy/paste/fill-down (items 6/7) — the internal clipboard round-trips a snapshot of raw
  // cell text (see lib/sheetOps.js); paste and fill-down both shift a formula's relative A1
  // references by the destination delta, exactly like dragging Excel's fill handle.
  const onCopy = useCallback((r1, r2, c1, c2) => { clipboardRef.current = copyRange(sheet, r1, r2, c1, c2); }, [sheet]);
  const onPaste = useCallback((targetR, targetC, selR1, selR2, selC1, selC2) => {
    if (!clipboardRef.current) return;
    commit((s) => pasteRange(s, targetR, targetC, clipboardRef.current, selR2, selC2));
  }, [commit]);
  const onFillDown = useCallback((r1, r2, c1, c2) => commit((s) => fillDown(s, r1, r2, c1, c2)), [commit]);

  // Stage 1 structural editing (context-menu driven — see SheetView.jsx's ContextMenu). Every
  // one of these shifts formula references sheet-wide (sheetModel.js's insertRowAt/deleteRowAt/
  // insertColumnAt/deleteColumn), not just the cell that moved.
  const onInsertRowAt = useCallback((rowIndex) => commit((s) => insertRowAt(s, rowIndex)), [commit]);
  const onDeleteRowAt = useCallback((rowIndex) => commit((s) => deleteRowAt(s, rowIndex)), [commit]);
  const onInsertColumnAt = useCallback((colIndex) => commit((s) => insertColumnAt(s, colIndex)), [commit]);
  const onDeleteColumnAt = useCallback((colIndex) => {
    if (sheet.columns.length <= 1) return;
    commit((s) => deleteColumn(s, colIndex));
  }, [commit, sheet.columns.length]);
  const onSetColumnWidth = useCallback((colIndex, width) => commit((s) => setColumnWidth(s, colIndex, width)), [commit]);
  const onSetRowHeight = useCallback((rowIndex, height) => commit((s) => setRowHeight(s, rowIndex, height)), [commit]);
  // Freeze panes goes through the normal commit/undo path like every other edit here — NOT
  // `reset` (that primitive wipes the whole undo history, meant only for adopting a load/sync
  // result, never a user action taken mid-session).
  const onSetFreeze = useCallback((rows, cols) => commit((s) => setFreeze(s, rows, cols)), [commit]);

  // Name Box / Find navigation — a plain jump, not an edit, so it never mints an undo frame.
  // r2/c2 default to r1/c1 so Find's own single-cell `onGoTo(r, c)` call needs no change;
  // the Name Box (B1007280 — "C50:E60" range support) passes all four for a real range.
  const onGoTo = useCallback((r1, c1, r2 = r1, c2 = c1) => setSelRange({ r1, r2, c1, c2 }), [setSelRange]);
  // "Replace" (singular) touches only the ONE cell the Find bar is currently sitting on — every
  // occurrence within that cell's own text, the same substring rule replaceAll uses everywhere
  // else, so "one cell = one match" stays consistent between the counter and the action.
  const onReplaceOne = useCallback((match, find, replace) => {
    const current = rawAt(sheet, match.r, match.c);
    commit((s) => commitCellText(s, match.r, match.c, replaceInCellText(current, find, replace)));
  }, [commit, sheet]);
  const onReplaceAll = useCallback((find, replace) => commit((s) => replaceAll(s, find, replace)), [commit]);

  const activeCol = selRange.c1;
  // Per-cell format (item 4/pro-forma finding): the picker reflects and edits the ACTIVE
  // cell's own format, and applying a preset touches only the currently selected RANGE of
  // cells — never the whole column, which is what let one percent-formatted cell repaint
  // every dollar amount above it in the same column.
  const activeFormat = formatAt(sheet, selRange.r1, selRange.c1);
  const onApplyFormat = useCallback((token) => {
    commit((s) => setNumberFormat(s, selRange.r1, selRange.r2, selRange.c1, selRange.c2, token));
  }, [commit, selRange]);
  const onDeleteColumn = useCallback(() => {
    if (sheet.columns.length <= 1) return;
    commit((s) => deleteColumn(s, activeCol));
    setSelRange({ r1: 0, r2: 0, c1: 0, c2: 0 });
  }, [commit, activeCol, sheet.columns.length]);

  // ---- STAGE 2 — THE RIBBON (B1007281) — every handler below acts on the current SELECTION
  // RANGE, not just the active cell (select B2:D40, hit currency, all of them change), the same
  // contract onApplyFormat above already established.
  const activeStyle = styleAt(sheet, selRange.r1, selRange.c1);
  const mergedHere = !!mergeAt(sheet, selRange.r1, selRange.c1);

  const onSetCellStyle = useCallback((patch) => {
    commit((s) => setCellStyle(s, selRange.r1, selRange.r2, selRange.c1, selRange.c2, patch));
  }, [commit, selRange]);
  const onApplyBorderCmd = useCallback(({ edges, style, mode }) => {
    commit((s) => applyBorder(s, selRange.r1, selRange.r2, selRange.c1, selRange.c2, { edges, style, mode }));
  }, [commit, selRange]);
  const onClearFormattingCmd = useCallback(() => {
    commit((s) => clearFormatting(s, selRange.r1, selRange.r2, selRange.c1, selRange.c2));
  }, [commit, selRange]);
  const onNumberFormatOp = useCallback((op) => {
    const fn = op === "increaseDecimals" ? increaseDecimals : op === "decreaseDecimals" ? decreaseDecimals : toggleThousands;
    commit((s) => setNumberFormat(s, selRange.r1, selRange.r2, selRange.c1, selRange.c2, fn(activeFormat)));
  }, [commit, selRange, activeFormat]);

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
      commit((s) => applyPaintedStyle(s, sr.r1, sr.r2, sr.c1, sr.c2, p.source));
      return null;
    });
  }, [commit]);

  const onMergeToggle = useCallback(() => {
    commit((s) => {
      const m = mergeAt(s, selRange.r1, selRange.c1);
      return m ? unmergeAt(s, selRange.r1, selRange.c1) : mergeRange(s, selRange.r1, selRange.r2, selRange.c1, selRange.c2);
    });
  }, [commit, selRange]);

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
    commit((s) => sortRange(s, r1, r2, selRange.c1, direction));
  }, [commit, selRange, sheet]);

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

  let projectName = "";
  if (projectId) { try { const p = listProjects().find((pp) => pp.id === projectId); if (p) projectName = p.name; } catch (_) {} }
  const currentProject = projectId ? { id: projectId, name: projectName || "Project" } : null;

  return (
    <div data-testid="model-root" style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--surface-page)" }}>
      <AppHeader
        module={shellModule || "model"}
        onSwitch={onShellSwitch}
        onDashboard={onGoDashboard}
        currentProject={currentProject}
        cross={crossProject}
        onSelectProject={(id) => onNavigate?.({ projectId: id, cross: false })}
        onNewProject={onNewProject}
        onSelectOrg={onSelectOrg}
        authControl={authControl}
        accountActive={accountActive}
        saveState={openProject ? modelSaveState(status, accountActive, cloudConfirmed) : null}
        saveDetail={
          status === "not-provisioned" ? "Cloud backup for Model isn't turned on yet — saved on this device only."
          : status === "conflict" ? "This model changed elsewhere — reload to see the latest (your edits here stayed on this device)."
          : status === "diverged" ? "This model has different content saved from another device or browser. What you see here is safe on this device, but saving here will overwrite that other copy. Reload without editing first if you want the other copy instead."
          : undefined
        }
        multiEditOk
        // STAGE 2 ICONOGRAPHY PASS — Undo/Redo moved OUT of row 1 and into the Ribbon's own
        // leading "Actions" group (icon buttons, matching Google Sheets' own toolbar, where
        // Undo/Redo open the row rather than living in a separate header bar). Row 1 no longer
        // needs a toolbarContent at all for this workspace.
      />

      {!openProject ? (
        <EmptyProjectState onGoDashboard={onGoDashboard} />
      ) : (
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
          <Ribbon
            activeFormat={activeFormat}
            activeStyle={activeStyle}
            mergedHere={mergedHere}
            freezeRows={sheet.freezeRows}
            freezeCols={sheet.freezeCols}
            painterArmed={!!painter}
            filterOn={filterOn}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            onSetCellStyle={onSetCellStyle}
            onApplyBorder={onApplyBorderCmd}
            onApplyFormat={onApplyFormat}
            onNumberFormatOp={onNumberFormatOp}
            onClearFormatting={onClearFormattingCmd}
            onFormatPainterToggle={onFormatPainterToggle}
            onMergeToggle={onMergeToggle}
            onInsertRow={onRibbonInsertRow}
            onInsertColumn={onRibbonInsertColumn}
            onDeleteRow={onRibbonDeleteRow}
            onDeleteColumn={onDeleteColumn}
            onSetFreezeTopRow={onSetFreezeTopRow}
            onSetFreezeFirstColumn={onSetFreezeFirstColumn}
            onSetFreezeAtSelection={onSetFreezeAtSelection}
            onUnfreeze={onUnfreeze}
            onSort={onSort}
            onFilterToggle={onFilterToggle}
          />
          <FormulaBar sheet={sheet} row={selRange.r1} col={selRange.c1} onCommit={onCommitCell} onGoTo={onGoTo} nameBoxRef={nameBoxRef} />
          </div>
          <SheetView
            sheet={sheet}
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
          />
          <FindReplaceBar
            open={findOpen}
            showReplace={findShowReplace}
            sheet={sheet}
            onClose={() => setFindOpen(false)}
            onGoTo={onGoTo}
            onReplaceOne={onReplaceOne}
            onReplaceAll={onReplaceAll}
          />
        </>
      )}
    </div>
  );
}
