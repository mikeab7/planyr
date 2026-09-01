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
import AppHeader, { useNarrow } from "../../shared/ui/AppHeader.jsx";
import SheetView from "./components/SheetView.jsx";
import FormulaBar from "./components/FormulaBar.jsx";
import FindReplaceBar from "./components/FindReplaceBar.jsx";
import NumberFormatPicker from "./components/NumberFormatPicker.jsx";
import { useUndoableState } from "./lib/undoStack.js";
import {
  createSheet, migrateSheet, commitCellText, blankRange, renameColumn, setNumberFormat,
  deleteColumn, addColumn, formatAt, padRowCount, sheetsDiverge, rawAt,
  insertRowAt, deleteRowAt, insertColumnAt, setColumnWidth, setRowHeight, setFreeze,
} from "./lib/sheetModel.js";
import { evaluateSheet } from "./lib/sheetEngine.js";
import { copyRange, pasteRange, fillDown, replaceAll, replaceInCellText } from "./lib/sheetOps.js";
import { modelSaveState } from "./lib/modelSaveState.js";
import { readZoom, writeZoom } from "./lib/sheetZoom.js";
import { readLocalSheet, writeLocalSheet, loadCloudSheet, saveCloudSheet } from "./lib/modelStore.js";
import { listProjects } from "../../shared/projects/projects.js";

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
  const cloudVersionRef = useRef(null);
  const pushTimer = useRef(0);
  const loadTokenRef = useRef(0);
  // Ctrl+C/Ctrl+V's INTERNAL clipboard (item 6) — see lib/sheetOps.js's header for why this is
  // deliberately not the OS clipboard. A ref, not state: copying never re-renders anything.
  const clipboardRef = useRef(null);
  // ⛔ B891184-FOLLOWUP (live production finding, 2026-08-31): the toolbar overflowed a 729px
  // window — measured, the number-format picker's own box sat 22.7px past the viewport edge,
  // reachable to a script but not to a real click. AppHeader's shared "narrow" mode (≤760px)
  // already turns the toolbar row into a horizontal-scroll strip, but with NO visible
  // scrollbar and no drag affordance for a mouse — undiscoverable on a resized desktop window
  // (as opposed to a touch phone, where a swipe is the obvious first thing to try). So Model's
  // own toolbar shrinks itself at the SAME breakpoint instead of leaning on that scroll strip:
  // icon-only Undo/Redo, a narrower format-picker (NumberFormatPicker's own `compact` prop),
  // and "Delete column" — the one rare, borderline-destructive action — tucked behind a small
  // "⋯" popover rather than sitting in the always-visible row.
  const narrow = useNarrow();
  const [showMore, setShowMore] = useState(false);
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
        toolbarContent={openProject ? (
          <div style={{ display: "flex", alignItems: "center", gap: narrow ? 4 : 8 }}>
            <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" style={toolbarBtnStyle(canUndo, narrow)}>{narrow ? "↶" : "↶ Undo"}</button>
            <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" style={toolbarBtnStyle(canRedo, narrow)}>{narrow ? "↷" : "↷ Redo"}</button>
            <span style={{ width: 1, alignSelf: "stretch", background: "var(--border-default)" }} />
            <NumberFormatPicker token={activeFormat} onChange={onApplyFormat} compact={narrow} />
            {narrow ? (
              <div style={{ position: "relative" }}>
                <button type="button" onClick={() => setShowMore((v) => !v)} title="More" aria-label="More column actions" aria-haspopup="menu" aria-expanded={showMore} style={toolbarBtnStyle(true, true)}>⋯</button>
                {showMore && (
                  <>
                    <div onClick={() => setShowMore(false)} style={{ position: "fixed", inset: 0, zIndex: 89 }} />
                    {/* No box-shadow: this repo has no shadow-color token yet (docs/DESIGN.md's
                        token layer doesn't cover it — plenty of pre-existing raw-color shadow
                        literals already carry that debt elsewhere), and this menu doesn't need
                        to add one; the border + raised surface read as popped-over content
                        without it. */}
                    <div role="menu" style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 90, minWidth: 140, padding: 4, borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--surface-raised)" }}>
                      <button
                        type="button"
                        onClick={() => { setShowMore(false); onDeleteColumn(); }}
                        disabled={sheet.columns.length <= 1}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6, border: "none", background: "transparent", color: sheet.columns.length > 1 ? "var(--text-primary)" : "var(--text-tertiary)", font: "inherit", fontSize: 12.5, cursor: sheet.columns.length > 1 ? "pointer" : "default" }}
                      >Delete column</button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button type="button" onClick={onDeleteColumn} disabled={sheet.columns.length <= 1} title="Delete this column" style={toolbarBtnStyle(sheet.columns.length > 1)}>Delete column</button>
            )}
          </div>
        ) : null}
      />

      {!openProject ? (
        <EmptyProjectState onGoDashboard={onGoDashboard} />
      ) : (
        <>
          <FormulaBar sheet={sheet} row={selRange.r1} col={selRange.c1} onCommit={onCommitCell} onGoTo={onGoTo} nameBoxRef={nameBoxRef} />
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

function toolbarBtnStyle(enabled, narrow) {
  return {
    height: 26, padding: narrow ? "0 7px" : "0 10px", borderRadius: 6, border: "1px solid var(--border-default)",
    background: "var(--surface-page)", color: enabled ? "var(--text-primary)" : "var(--text-tertiary)",
    font: "inherit", fontSize: 12, cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.55,
  };
}
