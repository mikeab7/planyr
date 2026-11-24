import "../../../shared/schedule/engine/pageEntry.js";
import { OWNER_KIND_ORG, OWNER_KIND_SITE, crossScheduleLabel, ownerOf, pruneScheduleRefs, scheduleLabelParts, setSiteNameResolver } from "../../../shared/schedule/scheduleOwnership.js";
import { OWNER_CAP, ownerDisplayParts, ownerHas, ownerJoin, ownerKey, ownerListOf, removeOwnerFrom, renameOwnerIn } from "../../../shared/schedule/engine/owners.js";
import { DEFAULT_HOLIDAYS, DEFAULT_SETTINGS, HOLIDAY_DEFS, HOLIDAY_SET, NOW, addD, buildHolidaySet, dif, difBD, fd, fdLocal, pd, setHolidaySet, setNOW } from "../../../shared/schedule/engine/calendar.js";
import { _mintTaskSid, fmtD, groupRowsByProject, idPressMovesRows, indentSelection, insertRowAbove, moveSelectionToDestination, outdentSelection, parseFlexDate, promoteChildrenAndDelete, renumberTasks, rowDragArmed, rowDropIntent, rowFloatAtPointer, scheduleExportName, scheduleRowPrefix, sortByVisualOrder, toShortDate } from "../../../shared/schedule/engine/tasks.js";
import { calcEnd, durTooltip, fmtPreds, fmtTaskDuration, normPreds, parseDurationInput, parsePreds, resolveDuration, resolveTaskSpan, rollForwardToWorkday, taskDurUnit, taskDurValue, validatePredEdit } from "../../../shared/schedule/engine/predecessors.js";
import { MEETING_BODY_INDEX, adjacentMeetingDate, agendaDeadline, agendaLeadSummary, boundEditNotice, cadenceSummary, copyMeetingBodyWithNewId, dropDuplicateLagPatch, findMeetingBodyElsewhere, importMeetingBodies, importMeetingBody, joinWithAnd, mbBodiesSameCadence, mbRuleSummary, meetingBindingTrace, meetingBoundInfo, meetingCostDays, meetingDatesInRange, meetingDoubleLagFlag, meetingFloatBD, newPinConflicts, otherScheduleMeetingBodies, pinConflictNotice, positionMissingReport, rebuildMeetingBodyIndex, resolveBoundEdit, settleBoundNotice, startIsPinned, unpinStartPatch } from "../../../shared/schedule/engine/meetings.js";
import { DEFAULT_HEALTH_RULES, RULE_FIELDS, RULE_FIELD_BY_K, cascadeDelta, completionDelta, effectivePercentComplete, getHealthRules, isCompleteTask, leafPercent, opsForField } from "../../../shared/schedule/healthEngine.js";
import { recascadeWithDrift, recomputeAfterStructureChange, recomputeSchedule, touchesSchedule } from "../../../shared/schedule/engine/cascade.js";
import { computeDisplayHealth, computeRolledHealth, reconcileNeedsAttention } from "../../../shared/schedule/engine/health.js";
import { loadDocument } from "../../../shared/schedule/engine/normalize.js";
import { _deepClone, _mEq, _mIsObj, _mStripRev, changedProjectIds, countChangedTaskRows, decomposeForDualWrite, mergeCloudDoc, mergeLocationPhrase, recomposeFromRows } from "../../../shared/schedule/engine/merge.js";
import { MULTI_SELECTION_MESSAGE, addRange, cellsOf, isMulti, makeSelection, rangesOf, selContains, selEdgesAt, selIsRange, selRowsOf, selTouchesCol, selTouchesRow, toggleCellOut, withActive } from "../../../shared/selection/rangeSelection.js";
import { axisVelocity } from "../../../shared/selection/edgeScroll.js";
import { BASE_HK, ContactPicker, DepCell, HDARK, HEALTH, HK, MENU_STOPS_GRID, NO_AUTOFILL, anchorHidden, anchorSurroundings, avatarColor, contactField, getInitials, measuredColWidth, rebuildHEALTH, showToast, useAnchoredPopover } from "./common.jsx";
import { MasterView, installProjectOrderListener } from "./taskReport/TaskReport.jsx";
import { GRID_SCROLL_MEMO, ROW_H, TL_H, escapeHtml, rowWindow, rowWindowTop, setRowH } from "./layout.js";
import { GanttView, resolveLabelAlign, writeLabelAlign } from "./gantt/GanttView.jsx";
import { PAGE_SIZES, buildPDFHtml } from "./gantt/pdfExport.jsx";
import { COLS, COL_BY_K, DEFAULT_GRID_COLS, activeEffectiveCols, activeProjectOf, computeFormulaValues, formulaColsOf, installRowPointerTypeListener, readGridCfg } from "./grid/columns.js";
import { focusGroupIds, focusReselectTarget, focusToggleTarget, gridCellBlank, gridCtrlArrowTarget, stepGridRow, stepVisibleColIdx } from "./grid/gridNav.js";
import { GridView } from "./grid/GridView.jsx";
import { TaskIconPickerHost } from "./grid/pickers.jsx";
import { NOTE_SIZES } from "./grid/headers.jsx";
import { applyTaskFocus, coreChanged, persistViewState, pickActivePid, resolveViewState, stripViewState, withLastActiveSite } from "./viewState.js";
import { isValidColor, isValidFontSize } from "./common/formatConsts.js";
import { DeleteChildrenModal, MoveToModal, SuccessorPromptModal, celebrateTaskComplete, notifyRowsDeleted } from "./dialogs/taskDialogs.jsx";
import { askConfirm } from "./dialogs/confirm.jsx";
import { ProjContextMenu, ProjDropdown, RenameModal } from "./menus/ProjectMenus.jsx";
import { AutomationPanel, FormatPanel, SettingsPanel } from "./panels/SettingsPanels.jsx";
import { MeetingCalendarsModal } from "./panels/MeetingCalendars.jsx";
import { ContactsPanel, HistoryPanel } from "./panels/ContactsHistory.jsx";
import { ErrorBoundary } from "./common/ErrorBoundary.jsx";
import { SuggestionsView } from "./suggestions/SuggestionsView.jsx";
import { NotesModal } from "./panels/NotesModal.jsx";
import { PDFExportModal } from "./panels/PDFExportModal.jsx";
import { TaskContextMenu } from "./menus/TaskMenus.jsx";
import { exposeToHarness } from "./harnessGlobals.js";

const { useState, useEffect, useRef, useMemo, useCallback } = React;








// NEW-1 (B2429233) — THE ONE removal of a schedule from the document. It used to refuse the LAST
// schedule (`projects.length <= 1`) from inside deleteProject, so the shell's confirm closed and
// nothing happened, with no message. There is no real reason to refuse: since B2285440 a document
// with no schedule renders the "No schedules yet" empty state, and the cloud write soft-deletes any
// row missing from the document. So the last schedule deletes like any other and `aPid` becomes
// null (never a dangling id). Returns `d` itself, unchanged, only when `id` names no schedule.
function removeScheduleFromDoc(d, id) {
  if (!d || !d.projects || !d.projects[id]) return d;
  const newProjects = { ...d.projects };
  delete newProjects[id];
  const remaining = Object.keys(newProjects).map(Number);
  const newAPid = d.aPid === id ? (remaining.length ? remaining[0] : null) : d.aPid;
  return pruneScheduleRefs({...d, aPid: newAPid, projects: newProjects});
}
// (end removeScheduleFromDoc)

// NEW-1 (owner dispatch 2026-09-17) — the merge toast itself was never instrumented, so an owner
// report of an inflated count ("687 tasks... +7 more") had no record to check it against; a live
// two-tab sitting was the only way to see one fire. This records every firing — the real schedule
// list and count the toast just showed — as a client_errors event, so the next occurrence on his
// account is a query, not a repro session. Fire-and-forget and best-effort: a lost diagnostic row
// here is not a LOUD-FAILURE case (nothing user-facing depends on it reaching the table), so it
// never throws into the app and never retries. Uses window.__sb (the already-exposed client)
// rather than the module-scoped `sb` so this can sit at module scope, above where `sb` is
// declared, without an ordering dependency — by the time a merge can fire, boot has long finished.
function logMergeToastEvent(changedRows, changedPids, projects) {
  try {
    if (!window.__sb) return;
    const names = (changedPids || []).map(pid => crossScheduleLabel((projects && projects[pid]) || {}));
    const msg = `merge toast fired — ${changedRows} task${changedRows===1?"":"s"} updated across ${names.length} schedule${names.length===1?"":"s"}` +
      (names.length ? `: ${names.join(", ")}` : "");
    window.__sb.from("client_errors").insert({ module: "scheduler", source: "event:merge-toast", message: msg.slice(0, 2000) }).then(() => {}, () => {});
  } catch (e) { /* telemetry must never throw into the app */ }
}
// Initialize with defaults
setHolidaySet(buildHolidaySet(DEFAULT_HOLIDAYS));

// ── Configurable health automation, v2 (B785744 — replaces the fixed 7-condition rule list from
// #1073, which the owner rejected twice: "you've got like two variables here"). The real ask,
// verbatim: "IF 'finish' is in the past, THEN status = Needs Attn, UNLESS status is marked
// COMPLETE" — a Smartsheet/MS-Project-style IF/THEN/UNLESS builder, not a picklist of canned
// sentences. RULE_FIELDS × RULE_OPS is the actual language: pick a FIELD (Finish, Start, Status,
// Owner, %Complete, Cost, Budget, Actual Cost, Predecessor), pick a COMPARISON valid for that
// field's type, give a VALUE. Multiple conditions in a `when`/`unless` group combine with AND/OR.
// A rule is `{id, when:[cond,...], whenCombinator, color, unless:[cond,...], unlessCombinator}` —
// it fires (sets `color`) when its `when` group matches AND its `unless` group does NOT. Rules stay
// an ORDERED list, first FIRING rule wins (owner's explicit choice over "worst color always wins" —
// he already knows and likes the ordered mental model).
//
// Absence-safety, preserved from v1: a MISSING date/text field always fails its condition (except
// the explicit isBlank/isNotBlank tests, whose whole job IS to test absence) — never a silent pass.
// A missing NUMBER field reads as 0 (matches how percentComplete has always been treated: `pct =
// task.percentComplete || 0`), so "% Complete is at least 100" behaves identically whether the field
// is absent or explicitly 0.


// Fix #1e: guard mkt so a bad caller can never crash the app with an invalid date.
// Also supports "blank" tasks: pass start="" AND dur="" (or null) → task is created with
// no start, no end, no duration. Callers that want a real date keep passing valid args.
const mkt = (id, name, start, dur, parentId=null, health="gray", predecessors=[]) => {
  const isBlank = !start && (dur === "" || dur === null || dur === undefined);
  const safeStart = isBlank ? "" : ((start && !isNaN(new Date(start).getTime())) ? start : NOW);
  // Blank tasks are born at 0d (renders "0d", never a bare "d"); dates stay
  // empty until the user types one — calcEnd("", 0) is "" by design.
  const safeDur   = isBlank ? 0 : dur;
  return {
    id, _sid: _mintTaskSid(), name, start: safeStart, end: calcEnd(safeStart, safeDur), duration: safeDur, durUnit: "d", durValue: safeDur, predecessors, health,
    percentComplete: health==="green" ? 100 : health==="yellow" ? 40 : 0,
    parentId, responsibleParty: [], cost: "", notes: [], isExpanded: true,
    meetingBound: false,   // B816 — new tasks are unbound by default; a task binds to a body via its Meeting cell
  };
};

// NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD, 2026-10-06) — tell the shell where this page's schedule-list load stands, so
// the Schedule tab can say "still loading" / "couldn't reach" instead of mistaking an UNLOADED list for an
// EMPTY one (which offered Create on a project that already had three schedules). State is "loading" or
// "failed"; a successful load is announced by the ordinary planar:nav-state, never by this.
window.__planarLoadStatus = "loading";
function postLoadState(state) {
  try {
    if (window.self !== window.top) {
      window.parent.postMessage({ source: "planar-seq", type: "planar:load-state", state }, window.location.origin);
    }
  } catch (_) {}
}
const LOAD_ATTEMPT_TIMEOUT_MS = 20000;   // one read attempt; a hung request is abandoned and retried
const LOAD_RETRY_BASE_MS = 2000, LOAD_RETRY_MAX_MS = 30000;

const SEED = {
  nPid: 4, nTid: {1:12, 2:5, 3:10}, aPid: 3, view: "split", section: "projects", editProjId: null, healthColStyle: "stoplight",
  settings: {...DEFAULT_SETTINGS, holidays:{...DEFAULT_HOLIDAYS}},
  projects: {
    1: { id:1, name:"Hillwood I-10 Logistics", tasks: [
      mkt(1,  "Site Acquisition",       "2025-01-06", 30,  null, "green",  []),
      mkt(2,  "Title Search",            "2025-01-06", 14,  1,    "green",  []),
      mkt(3,  "Environmental Phase I",   "2025-01-13", 21,  1,    "green",  [1]),
      mkt(4,  "Design & Engineering",    "2025-02-03", 60,  null, "yellow", []),
      mkt(5,  "Schematic Design",        "2025-02-03", 21,  4,    "green",  [1]),
      mkt(6,  "Construction Documents",  "2025-02-24", 35,  4,    "yellow", [5]),
      mkt(7,  "Permitting",              "2025-04-01", 45,  null, "yellow", [4]),
      mkt(8,  "Submit Plans",            "2025-04-01", 5,   7,    "green",  [6]),
      mkt(9,  "City Review",             "2025-04-07", 30,  7,    "yellow", [8]),
      mkt(10, "Permit Issued",           "2025-05-07", 0,   7,    "red",    [9]),
      mkt(11, "Construction",            "2025-05-08", 180, null, "gray",   [7]),
    ]},
    2: { id:2, name:"Grand Pkwy Distribution", tasks: [
      mkt(1, "Site Control",  "2025-03-01", 21,  null, "green",  []),
      mkt(2, "Due Diligence", "2025-03-22", 30,  null, "yellow", [1]),
      mkt(3, "Design",        "2025-04-22", 60,  null, "gray",   [2]),
      mkt(4, "Construction",  "2025-06-22", 150, null, "gray",   [3]),
    ]},
    3: { id:3, name:"Sample Project", tasks: [
      mkt(1,  "Project Kick Off",     "2025-06-02", 0,   null, "gray",   []),
      mkt(2,  "Due Diligence",        "2025-06-02", 30,  null, "green",  [1]),
      mkt(3,  "Order Reports",        "2025-06-02", 5,   2,    "green",  []),
      mkt(4,  "Review Reports",       "2025-06-09", 15,  2,    "yellow", [3]),
      mkt(5,  "Entitlements",         "2025-07-14", 60,  null, "gray",   [2]),
      mkt(6,  "Submit Application",   "2025-07-14", 5,   5,    "gray",   []),
      mkt(7,  "Agency Review",        "2025-07-21", 40,  5,    "gray",   [6]),
      mkt(8,  "Approval",             "2025-09-15", 0,   5,    "gray",   [7]),
      mkt(9,  "Construction",         "2025-09-16", 120, null, "gray",   [5]),
    ]},
  },
};
installRowPointerTypeListener();

// ── App ───────────────────────────────────────────────────
function App() {
  const [data,       setData]       = useState(null);
  const dataRef = useRef(null);
  useEffect(() => { dataRef.current = data; }, [data]);
  // B1539585 — a ref, not a plain closure `let`, because updateTask's setData(updater) can run its
  // updater EITHER eagerly (synchronously, inline with the dispatch call) OR deferred to the next
  // render, depending on whether React finds other work already pending on this fiber at click time
  // — which in an interactive app is common. A local variable checked immediately after `setData(...)`
  // races the deferred case and silently loses: the check runs with the pre-update `null` before the
  // updater has ever written to it, so the toast never fires. A ref written INSIDE the updater and read
  // by a `[data]`-effect is safe under both timings, because the effect is guaranteed to run only after
  // the render that incorporated the updater's write has committed.
  const rollToastRef = useRef(null);
  useEffect(() => {
    if (rollToastRef.current) { showToast(rollToastRef.current); rollToastRef.current = null; }
  }, [data]);
  // B212 — keyboard column navigation walks the active project's VISIBLE columns in
  // DISPLAY ORDER so the cell cursor always lands on an on-screen column and never on a
  // hidden one (a hidden column has no rendered cell, so the blue selection outline would
  // otherwise vanish). Algorithm unit-tested in src/workspaces/scheduler/lib/gridColNav.js.
  // B583: index into the EFFECTIVE registry (built-ins + this project's formula columns) so
  // a formula column is navigable too and lines up with the row render's ci = allCols.indexOf(c).
  const visibleColIdxs = () => {
    const d = dataRef.current;
    const eff = activeEffectiveCols(d);
    const vis = readGridCfg(d && d.projects?.[d.aPid], d).visible; // column keys, display order
    const idxs = [];
    vis.forEach(k => { const i = eff.findIndex(c => c.k === k); if (i >= 0) idxs.push(i); });
    return idxs;
  };
  // Step the cursor to the adjacent visible column (dir>0 right, dir<0 left), clamped at
  // the first/last visible column. If the cursor sits off-table (its column was hidden, or
  // the initial id column is hidden), snap onto the nearest visible column toward `dir`.
  const stepGridCol = (curIdx, dir) => stepVisibleColIdx(visibleColIdxs(), curIdx, dir);
  const [successorPrompt, setSuccessorPrompt] = useState(null);
  /* NEW-1 — a completion can unblock MORE THAN ONE successor at once (the bulk "Mark Complete"
   * action below can flip several to green in one apply(), and so can hand-picking the Complete
   * pill on more than one row). Each green transition independently schedules its own follow-up
   * prompt 80ms later (see the "fire when task transitions to complete" block), so two completions
   * in the same batch would race to overwrite the single `successorPrompt` slot — whichever
   * setTimeout lands last wins, and the other's follow-up prompt is silently lost. That is exactly
   * the silent-cascade shape the owner ruled out. A small FIFO queue makes it deterministic instead:
   * every triggered prompt is queued, and the queue drains one at a time as each prompt closes —
   * "one hop at a time, prompting again" holds even when the batch had more than one hop to offer. */
  const [successorPromptQueue, setSuccessorPromptQueue] = useState([]);
  useEffect(() => {
    if (!successorPrompt && successorPromptQueue.length > 0) {
      setSuccessorPrompt(successorPromptQueue[0]);
      setSuccessorPromptQueue(q => q.slice(1));
    }
  }, [successorPrompt, successorPromptQueue]);
  const [notesCtx,   setNotesCtx]   = useState(null);
  const [isMobile,   setIsMobile]   = useState(() => typeof window!=='undefined' && window.innerWidth < 768);
  const [mobMenuOpen, setMobMenuOpen] = useState(false);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  // B1241744/B1241745 — WIDTH drives LAYOUT (isMobile above: the 2-row header, the single overflow
  // menu, and — new this session — which Schedule view collapses to one pane). POINTER TYPE drives
  // CONTROL SIZING, and it is a SEPARATE axis: an iPhone in landscape is wide enough (832px+) to
  // clear the 768px isMobile threshold while still being operated with a finger, so a control sized
  // for a mouse there is exactly as unreachable as one on a narrow phone. `coarsePointer` is that
  // second axis — read once, live-updated on the rare device that changes pointer type — and is
  // never used to decide what's SHOWN (only how big it renders).
  const [coarsePointer, setCoarsePointer] = useState(() => typeof window!=='undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    if (typeof window==='undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const h = () => setCoarsePointer(mq.matches);
    (mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h));
    return () => (mq.removeEventListener ? mq.removeEventListener('change', h) : mq.removeListener(h));
  }, []);
  // B1281648 (RECURRENCE ×3 of B1241745) — Split at phone width used to collapse to ONE pane at a
  // time (a `phonePane` state switched by the header pill — see the pill's own history comment
  // below). The owner rejected that shape on a real iPhone across three shipped attempts (#1490,
  // #1497, #1504): a single pane behind the "Split" tab is indistinguishable from just picking
  // Grid or Gantt directly, so it reads as "nothing happens." Split now renders BOTH panes at
  // once, stacked vertically, at every width (`SplitView`'s own `isMobile` branch) — so there is
  // no longer a "which pane is phone-Split showing" question, and this state is gone.
  const [pdfExportOpen, setPdfExportOpen] = useState(false);
  const [projCtx,    setProjCtx]    = useState(null);
  const [taskCtx,    setTaskCtx]    = useState(null);
  const [iconPickerCtx, setIconPickerCtx] = useState(null);   // {taskId, projId, x, y} — the task-icon picker opened from the row's right-click menu (B2671196 ×2)
  // Task-level clipboard for Ctrl+C / Ctrl+X / Ctrl+V. Held in a ref because the
  // global keydown handler runs in a stable effect and would otherwise capture a
  // stale value. Shape: { mode: "copy"|"cut", tasks: [deep-copied subtree(s), concatenated], sourceProjId, sourceRootIds }
  const clipboardRef = useRef(null);
  const pasteSelectRef = useRef(null); // new id of the just-pasted root → select + scroll to it after paste
  const [, setClipboardTick] = useState(0); // bump to force re-render when clipboard changes (for menu/visual cues)
  const [renameModal, setRenameModal] = useState(null);
  const [deleteChoice, setDeleteChoice] = useState(null); // {ids, rowCount, totalCount} | null — delete-with-children prompt
  const [moveToCtx, setMoveToCtx] = useState(null); // {ids, projId} | null — "Move to…" destination-picker modal
  const moveSelectRef = useRef(null); // new id of the moved block's first root row → select + scroll to it after a move
  const [edit,       setEdit]       = useState(null);
  const editLiveRef = useRef(null);   // NEW-1 — the key handler's closure is stale w.r.t. `edit`; this is live
  useEffect(() => { editLiveRef.current = edit; }, [edit]);
  const focusReselectRef = useRef(null);   // NEW-1 — set by Alt+F, consumed by the layout effect below
  const [editStartChar, setEditStartChar] = useState(null);
  const [selectedId,    setSelectedId]    = useState(null);
  const [selRange,      setSelRange]      = useState(null); // {r1,r2,c1,c2} — row/col indices into flatTasks/COLS
  // NEW-1 — _sids of rows inserted under a Focus filter this session: Focus never hides them (view-only,
  // never saved), so an inserted blank row stays on screen without un-focusing its parent. Cleared when
  // any Focus toggle is pressed (re-applying the filter).
  const [focusPins, setFocusPins] = useState(() => new Set());
  const [selectedColIdx, setSelectedColIdx] = useState(0);
  // Keep "today" current within a live session so overdue/due-soon colors and the today line
  // re-evaluate on tab focus and roll over at midnight — no reload needed. NOW is module-scope
  // (read by computeDisplayHealth); bumping todayTick forces the re-render that re-reads it.
  const [, setTodayTick] = useState(0);
  const [, setHealthTick] = useState(0); // bumped after rebuildHEALTH so a new/renamed status renders this beat, not next (B5/M3)
  useEffect(() => {
    // B1161792 (NEW-1) — a health RULE transition (overdue/due-soon) can fire purely from the
    // clock rolling over a day, with no data edit at all, and the reconciliation this effect's
    // sibling `[data]` effect runs (below) only fires on a real edit (`coreChanged`) — it has no
    // notion of the clock. So a genuine date rollover reconciles here too, the one place that
    // already detects one.
    const refresh = () => { const t = fdLocal(new Date()); if (t !== NOW) { setNOW(t); setTodayTick(x => x + 1);
      // isDerivedUpdate stays armed only through the ONE state transition it targets — reset it
      // immediately if reconcileNeedsAttention turns out to be a no-op (same ref back), or the flag
      // would leak forward and wrongly swallow the NEXT real edit's history entry (that edit's own
      // setData would be the one to actually change `data` and consume the still-armed flag).
      isDerivedUpdate.current = true;
      setData(d => { const next = reconcileNeedsAttention(d); if (next === d) isDerivedUpdate.current = false; return next; });
    } };
    const onVis = () => { if (!document.hidden) refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(refresh, 60000);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVis); clearInterval(iv); };
  }, []);
  const [goToFocus,      setGoToFocus]      = useState(null); // {taskId, n} — grid scrolls to + pulses this row after a cross-view jump
  const [offlineFallback, setOfflineFallback] = useState(false);
  // B778/NEW-1 — planar_data now requires sign-in + schedule ownership (RLS), so a signed-out
  // visitor gets denied (42501), not a connectivity failure. Distinct from offlineFallback's
  // "cloud unreachable" so the banner doesn't wrongly tell them to check their connection.
  const [authRequired, setAuthRequired] = useState(false);
  const [driftNotice, setDriftNotice] = useState(null);   // B836 — non-pinned tasks whose saved start the load re-cascade corrected; surfaced loudly (banner)
  const [ancestorPredNotice, setAncestorPredNotice] = useState(null);   // NEW-1 (B1696640) — tasks whose predecessors named their own parent/ancestor; the link was dropped on load
  const [staleNotice, setStaleNotice] = useState(false);
  const didInitialLoad = useRef(false);
  const prevCoreRef = useRef(null);   // B1107680 — last `data` whose CORE (versioned) portion was considered for a cloud save
  const [formatOpen, setFormatOpen] = useState(false);
  const [settingsOpen,    setSettingsOpen]    = useState(false);
  const [settingsSection, setSettingsSection] = useState(null);   // B844 — pre-expand a Settings section
  const [meetingCalOpen,  setMeetingCalOpen]  = useState(false);  // the dedicated Meeting-calendars editor window
  const [automationOpen,  setAutomationOpen]  = useState(false);
  const [contactsOpen,    setContactsOpen]    = useState(false);
  const [historyOpen,     setHistoryOpen]     = useState(false);
  const [reviewOpen,      setReviewOpen]      = useState(false);
  const [reviewRows,      setReviewRows]      = useState([]);
  const [reviewLoading,   setReviewLoading]   = useState(true);
  const [reviewIdx,       setReviewIdx]       = useState(0);
  // B844 — deep-link listener (e.g. an empty "Meeting" cell → set up). The "meetings" detail now
  // opens the dedicated Meeting-calendars window; any other section still opens Settings to it.
  useEffect(() => {
    const openTo = e => {
      if ((e?.detail || null) === "meetings") { setMeetingCalOpen(true); setSettingsOpen(false); }
      else { setSettingsSection(e?.detail || null); setSettingsOpen(true); }
      setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false);
    };
    document.addEventListener("planar-open-settings", openTo);
    return () => document.removeEventListener("planar-open-settings", openTo);
  }, []);
  const [ganttPPD,   setGanttPPD]   = useState(() => {
    const ganttW = window.innerWidth * 0.46; // 46% goes to Gantt in default split view
    return Math.max(1, Math.floor(ganttW / 365));
  });
  const [gridZoom,   setGridZoom]   = useState(() => data?.gridZoom ?? 1.0);
  // The lazy initializer above runs on the FIRST render when `data` is still null, so it always
  // resolves to 1.0; adopt the persisted zoom once the async load sets data (the wheel handler keeps
  // data.gridZoom current, so this one-way sync just restores it instead of always snapping to 100%).
  useEffect(() => { if (data && typeof data.gridZoom === "number") setGridZoom(data.gridZoom); }, [data?.gridZoom]);
  const hoverZoneRef = useRef('gantt');
  const fileHandleRef = useRef(null);
  const fileHtmlRef   = useRef(null);

  // ── Review (suggestions) data: fetch + realtime subscribe; one source feeds both the toolbar badge and the Review panel ──
  useEffect(() => {
    const sb = window.__sb;
    if (!sb) { setReviewLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const { data: list, error } = await sb.from('planar_suggestions')
          .select('*').eq('status', 'pending').order('created_at', { ascending: false });
        if (!alive) return;
        if (!error && list) setReviewRows(list);
      } catch (e) { console.warn("suggestions fetch failed:", e); }
      if (alive) setReviewLoading(false);
    })();
    let channel = null;
    try {
      channel = sb.channel('planar_suggestions_pending')
        .on('postgres_changes', { event:'INSERT', schema:'public', table:'planar_suggestions' }, payload => {
          if (payload && payload.new && payload.new.status === 'pending')
            setReviewRows(R => [payload.new, ...R.filter(r => r.id !== payload.new.id)]);
        })
        .on('postgres_changes', { event:'UPDATE', schema:'public', table:'planar_suggestions' }, payload => {
          if (!payload || !payload.new) return;
          if (payload.new.status !== 'pending') setReviewRows(R => R.filter(r => r.id !== payload.new.id));
          else setReviewRows(R => R.map(r => r.id === payload.new.id ? payload.new : r));
        })
        .on('postgres_changes', { event:'DELETE', schema:'public', table:'planar_suggestions' }, payload => {
          if (payload && payload.old) setReviewRows(R => R.filter(r => r.id !== payload.old.id));
        })
        .subscribe();
    } catch (e) { console.warn("suggestions subscribe failed:", e); }
    return () => { alive = false; try { if (channel) sb.removeChannel(channel); } catch (e) {} };
  }, []);

  // While reviewing, keep the shown project in sync with the active suggestion's project, so the proposed
  // row and its cascade inject into the correct plan grid.
  useEffect(() => {
    if (!reviewOpen || !data) return;
    const a = reviewRows[reviewIdx];
    if (a && a.project_id != null && data.aPid !== a.project_id && data.projects && data.projects[a.project_id]) setData(d => ({ ...d, aPid: a.project_id }));
  }, [reviewOpen, reviewIdx, reviewRows, data?.aPid]);
  const fileSaveTimer = useRef(null);
  const [fileLinked,  setFileLinked]  = useState(false);
  const [savePulse,   setSavePulse]   = useState(false);
  // Sticky save state: "saved" | "saving" | "error". Red ("error") persists
  // until a save actually lands — it never times out or fades on its own.
  const [saveStatus,  setSaveStatus]  = useState("saved");
  const saveSeq       = useRef(0);      // ignore stale resolutions when saves overlap
  const latestData    = useRef(null);   // freshest data, for retries
  const saveStatusRef = useRef("saved");
  useEffect(() => { saveStatusRef.current = saveStatus; }, [saveStatus]);

  // One cloud-save attempt: mark "saving", then "saved"/"error" — unless a
  // newer attempt has superseded this one (then its resolution decides).
  const attemptCloudSave = (d) => {
    const seq = ++saveSeq.current;
    setSaveStatus("saving");
    // B1107680 — the payload never carries the 13 per-tab/per-browser view-state keys; they aren't
    // versioned data and must never bump __rev or ride into a cloud row other tabs watch.
    window.storage.set("hs-v1", JSON.stringify(stripViewState(d)), { label: "auto" })
      .then(res => { if (saveSeq.current === seq) setSaveStatus(res ? "saved" : "error"); })
      .catch(()  => { if (saveSeq.current === seq) setSaveStatus("error"); });
  };
  const [dlOpen,      setDlOpen]      = useState(false);
  const history      = useRef([]);
  const future       = useRef([]);  // Fix #8: redo stack
  const prevData     = useRef(null);
  const isUndoing    = useRef(false);
  // NEW-1 — a DERIVED-field recompute (reconcileNeedsAttention's needsAttentionSince stamp/clear,
  // the holiday recascade) is not a user edit: it's a `[data]` effect reacting to data IT JUST
  // helped produce, so its own `setData` re-triggers this same history-capture effect. Without this
  // flag that reactive write pushes an extra, invisible snapshot onto `history` right after every
  // real edit whose side effect flips some task's red/not-red status (most commonly a date edit,
  // since the default overdue/due-soon rules are date-driven) — and because the flag-mismatch that
  // triggered the recompute is now fixed, RESTORING that snapshot via Ctrl+Z immediately re-triggers
  // the same recompute again, which re-pushes an equivalent snapshot right back. The visible fields
  // (the date the user actually typed) never move, and every further Ctrl+Z repeats the same cycle —
  // the real prior edit sits one level further back and can never be reached. Owner repro: Goose
  // Creek Master Schedule task 168, "P&Z Public Hearing & Consideration" 9/10→9/30 — 9/10 was
  // overdue-red under the default rule (9/11 "today"), 9/30 was not, and Ctrl+Z never got past that
  // flip. Set this ref (like `isUndoing`) immediately before any `setData` whose ONLY job is to
  // re-derive a field from `data` that was already current — never for a real user action.
  const isDerivedUpdate = useRef(false);
  const flatTasksRef = useRef([]);
  const lastSelIdxRef = useRef(null);   // NEW-1 — see the layout effect beside flatTasks
  // NEW-1 — the flat index of the first task row whose top is inside the grid's viewport (below the sticky
  // header), read from the DOM at the instant of the key press. stepGridRow's last-resort anchor when a lost
  // selection has no known position. null when no grid is mounted.
  const viewportTopFlatIdx = (tasks) => {
    const g = document.querySelector('[data-grid-scroll="1"]'); if (!g) return null;
    const top = g.getBoundingClientRect().top;
    for (const r of g.querySelectorAll("[data-task-row]")) {
      const b = r.getBoundingClientRect();
      if (b.top >= top + 20) { const id = r.getAttribute("data-task-row"); const i = tasks.findIndex(t => String(t.id) === id); if (i >= 0) return i; }
    }
    return null;
  };
  const projIdRef    = useRef(null);
  const prevHolKey   = useRef(null);
  const skipHolRecasc = useRef(false);
  const prevHealthKey = useRef(null); // serialized customHealth+labelOverrides; detects real status-config changes (B5/M3)

  // Capture a snapshot AFTER every data change, except undo/redo operations and derived recomputes
  // (NEW-1 — a derived recompute folds into the CURRENT snapshot instead of becoming its own step,
  // exactly like an undo/redo restore already does).
  useEffect(() => {
    if (!data) return;
    if (isUndoing.current) { isUndoing.current = false; prevData.current = data; return; }
    if (isDerivedUpdate.current) { isDerivedUpdate.current = false; prevData.current = data; return; }
    if (prevData.current !== null) {
      history.current = [...history.current.slice(-19), prevData.current]; // cap undo at 20 deep snapshots (was 50) to bound memory on large boards
      future.current = []; // any new edit invalidates the redo stack
    }
    prevData.current = data;
  }, [data]);











  // ⛔ RETIRED (2026-08-25, B752848 owner correction): normalizeToV9 used to seed the now-deleted
  // `healthOverride` flag on load (green/red/paused → override:true). The flag and everything that
  // read it are gone, so this migration has nothing left to do; removed rather than left as a no-op,
  // per "delete it completely." Every call site below now calls normalizeToV8 directly.



  // Shared "apply a loaded / imported / restored data blob" pipeline. normalizeIds + ensureContacts are
  // defined INSIDE the load effect below, so importJSON + version-restore route through this ref rather
  // than re-calling them out of scope — calling them directly was a ReferenceError (import was broken).
  const applyLoadedDataRef = useRef(null);
  // NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD) — the initial read can fail or hang (a slow/unreachable cloud). Inside
  // the shell a failed read must NOT fall back to the embedded demo SEED (that made an unreachable cloud look
  // like a working account, and its edits could then autosave over the real one): `data` stays null, the shell
  // is told "failed", and this effect re-runs on `loadTick` — on a backoff timer and on the shell's Retry.
  const [loadTick, setLoadTick] = useState(0);
  const loadAttemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false, retryTimer = null;   // a superseded attempt (Retry) must never apply its late result
    (async () => {


      // Expose the full normalize + cascade pipeline so importJSON + version-restore can reuse it (they
      // can't call normalizeIds/ensureContacts directly — those are scoped to this effect). Set
      // synchronously on mount, before the first await, so it's ready before any user import/restore.
      applyLoadedDataRef.current = (parsed) => {
        let d = loadDocument(parsed);
        d._pinnedClean = true;
        setHolidaySet(buildHolidaySet(d.settings?.holidays || DEFAULT_HOLIDAYS));
        const driftFound = [];   // B836 — same drift surfacing on import / version-restore
        const ancestorFound = [];   // NEW-1 (B1696640) — same ancestor-predecessor repair on import / version-restore
        Object.keys(d.projects).forEach(pid => {
          let tasks = d.projects[pid].tasks.map(({_pinStart, __wasDirectEdit, ...t}) => t);
          d.projects[pid] = {...d.projects[pid], tasks: recascadeWithDrift(tasks, pid, d.projects[pid].name || pid, driftFound, ancestorFound)};
        });
        if (driftFound.length) { setDriftNotice(driftFound); console.warn("[planar cascade-drift] imported/restored data had saved starts out of sync with predecessors (auto-recalculated, B835/B836):", driftFound); }
        if (ancestorFound.length) { setAncestorPredNotice(ancestorFound); console.warn("[planar ancestor-pred] imported/restored data had a task naming its own parent/ancestor as a predecessor (dropped, NEW-1):", ancestorFound); }
        try { window.storage.reseedScheduleBaseline && window.storage.reseedScheduleBaseline(d); } catch {}   // NEW-1 (2026-09-25) — see reseedScheduleBaseline's own header
        setData(resolveViewState(d));   // B1107680 — never let an import/restore's snapshot-time aPid/view yank this tab elsewhere
        // NEW-1 (B1696640) — this path runs well after the initial mount, so the normal
        // coreChanged-driven autosave effect (below) picks up the repair on its own; no explicit
        // save needed here the way the very-first-load path (below) requires one.
      };
      try {
        const _isMobile = window.innerWidth < 768;
        // Supabase is the source of truth for live edits — check it first.
        // __PLANAR_DATA__ is the seed used only when Supabase has no record yet.
        window.__planarCloudError = false; window.__planarAuthRequired = false;
        let r = null, readThrew = false, timer = null;
        try {
          r = await Promise.race([
            window.storage.get("hs-v1"),
            new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("hs-v1 read timed out")), LOAD_ATTEMPT_TIMEOUT_MS); }),
          ]);
        } catch { readThrew = true; }
        clearTimeout(timer);
        if (cancelled) return;
        if (readThrew) window.__planarCloudError = true;
        if (!r && window.__planarCloudError && window.self !== window.top) {
          window.__planarLoadStatus = "failed";
          postLoadState("failed");
          const n = ++loadAttemptRef.current;
          console.warn("[planar load] schedule read failed (attempt " + n + ") — retrying; nothing is written until it loads.");
          retryTimer = setTimeout(() => setLoadTick(t => t + 1), Math.min(LOAD_RETRY_MAX_MS, LOAD_RETRY_BASE_MS * Math.pow(2, n - 1)));
          return;
        }
        if (r) {
          const d = loadDocument(JSON.parse(r.value));
          // NOTE: a narrow viewport forces the GRID layout at RENDER time (see the body switch),
          // never by mutating the persisted `view` — baking "grid" into saved data let one phone
          // session overwrite the desktop's saved split/gantt preference across every device.
          // Enforce predecessor relationships on load
          // One-time migration: strip stale pinnedStart flags; after this only intentional pins persist
          const needsPinClean = !d._pinnedClean;
          d._pinnedClean = true;
          setHolidaySet(buildHolidaySet(d.settings?.holidays || DEFAULT_HOLIDAYS));
          const driftFound = [];   // B836 — collect non-pinned tasks whose saved start the recompute corrected
          const ancestorFound = [];   // NEW-1 (B1696640) — collect tasks whose predecessors named their own parent/ancestor
          Object.keys(d.projects).forEach(pid => {
            let tasks = d.projects[pid].tasks.map(t => {
              const {_pinStart, __wasDirectEdit, pinnedStart, ...rest} = t;
              if (!needsPinClean && pinnedStart) rest.pinnedStart = true; // preserve intentional pins
              return rest;
            });
            d.projects[pid] = {...d.projects[pid], tasks: recascadeWithDrift(tasks, pid, d.projects[pid].name || pid, driftFound, ancestorFound)};
          });
          if (driftFound.length) { setDriftNotice(driftFound); console.warn("[planar cascade-drift] saved starts that didn't match their predecessor chain were auto-recalculated on load (B835/B836):", driftFound); }
          if (ancestorFound.length) {
            setAncestorPredNotice(ancestorFound);
            console.warn("[planar ancestor-pred] a task named its own parent/ancestor as a predecessor — link dropped and dates recalculated (NEW-1):", ancestorFound);
            // NEW-1 (B1696640) — this repair happens on the very-first-load path, which the normal
            // autosave effect deliberately SKIPS (loading must never mint a new version on its own —
            // that's what made two freshly-opened tabs fight, B1107680). Without an explicit save
            // here, the corrected predecessors never reach storage, so the NEXT load re-reads the
            // same broken link and shows the same notice again — exactly the "fires on every load"
            // defect this item exists to end. attemptCloudSave strips view state itself
            // (stripViewState), so it doesn't need the resolved `d` resolveViewState below produces.
            attemptCloudSave(d);
          }
          try { window.storage.reseedScheduleBaseline && window.storage.reseedScheduleBaseline(d); } catch {}   // NEW-1 (2026-09-25) — see reseedScheduleBaseline's own header; THE fix for the reported false "saved elsewhere" banner
          setData(resolveViewState(d)); return;   // B1107680 — migrate the 13 view-state keys off the cloud doc on first read
        }
        // First load (Supabase empty) — seed from inline data or SEED constant
        const seed = window.__PLANAR_DATA__ || SEED;
        const d = loadDocument(seed);
          // Enforce predecessor relationships on load (seed data — no stale pins)
          setHolidaySet(buildHolidaySet(d.settings?.holidays || DEFAULT_HOLIDAYS));
          d._pinnedClean = true;
          // NEW-1 (B1696640) — a hand-embedded __PLANAR_DATA__ seed (or a future SEED edit) can
          // carry the same ancestor-predecessor bug as a real stored doc; route it through the same
          // strip+notice as the other two load paths rather than the bare recomputeSchedule this used
          // to call directly. No explicit save here — there's no stored doc yet to protect, and the
          // FIRST real save (of any edit) persists the already-clean result.
          const seedAncestorFound = [];
          Object.keys(d.projects).forEach(pid => {
            let tasks = d.projects[pid].tasks.map(({_pinStart, __wasDirectEdit, ...t}) => t);
            d.projects[pid] = {...d.projects[pid], tasks: recascadeWithDrift(tasks, pid, d.projects[pid].name || pid, [], seedAncestorFound)};
          });
          if (seedAncestorFound.length) {
            setAncestorPredNotice(seedAncestorFound);
            console.warn("[planar ancestor-pred] seed data had a task naming its own parent/ancestor as a predecessor (dropped, NEW-1):", seedAncestorFound);
          }
        if (window.__planarCloudError) setOfflineFallback(true);
        else if (window.__planarAuthRequired) setAuthRequired(true);
        try { window.storage.reseedScheduleBaseline && window.storage.reseedScheduleBaseline(d); } catch {}   // NEW-1 (2026-09-25) — see reseedScheduleBaseline's own header
        setData(resolveViewState(d));
      } catch {
        const d = loadDocument(window.__PLANAR_DATA__ || SEED);
        setOfflineFallback(true);
        try { window.storage.reseedScheduleBaseline && window.storage.reseedScheduleBaseline(d); } catch {}   // NEW-1 (2026-09-25) — no-op unless this account was already flipped before the error
        setData(resolveViewState(d));
      }
    })();
    return () => { cancelled = true; clearTimeout(retryTimer); };
  }, [loadTick]);

  useEffect(() => {
    if (!data) return;
    latestData.current = data;
    persistViewState(prevCoreRef.current, data);   // B1107680 — cheap, local-only; never touches the cloud

    // Don't re-save on initial load -- loading shouldn't mint a new version (that collision is what
    // made two freshly-opened tabs fight). B1107680 — and never re-save on a VIEW-ONLY change either:
    // navigating projects / resizing a column / zooming used to rewrite the whole versioned document
    // and bump __rev, which is exactly what made every OTHER open tab see a phantom "a newer version
    // was saved on another device" conflict from a mere navigation.
    const isFirstLoad = !didInitialLoad.current;
    if (isFirstLoad) didInitialLoad.current = true;
    const coreIsNew = coreChanged(prevCoreRef.current, data);
    prevCoreRef.current = data;
    if (!isFirstLoad && coreIsNew) attemptCloudSave(data);

    // Everything below derives from data.settings/data.projects (core, versioned fields) — skip it
    // entirely on a view-only change (VIEW-INDEPENDENT-ONCE: work whose inputs are the model/settings
    // must not be redone because the view moved). Always runs on first load.
    if (isFirstLoad || coreIsNew) {
      // Rebuild holiday set whenever settings change
      setHolidaySet(buildHolidaySet(data.settings?.holidays || DEFAULT_HOLIDAYS));
      setRowH(Math.min(34, Math.max(20, data.settings?.rowHeight || 24)));
      rebuildHEALTH(data.settings?.customHealth || [], data.settings?.healthLabelOverrides || {});
      // rebuildHEALTH mutates the module-scope HEALTH/HK/HDARK globals but doesn't itself
      // re-render; without this nudge a just-added/renamed status shows up one beat late
      // (you'd have to click around). Force one render when the status config actually
      // changed — keyed so it fires only on real changes, never looping (B5/M3).
      const healthKey = JSON.stringify([data.settings?.customHealth, data.settings?.healthLabelOverrides]);
      if (prevHealthKey.current !== null && healthKey !== prevHealthKey.current) setHealthTick(x => x + 1);
      prevHealthKey.current = healthKey;
      // Recascade all task dates when holidays change
      const holKey = JSON.stringify(data.settings?.holidays);
      if (!skipHolRecasc.current && holKey !== prevHolKey.current && prevHolKey.current !== null) {
        prevHolKey.current = holKey;
        skipHolRecasc.current = true;
        // Recompute from the LIVE `d` inside the updater, not the effect's closure snapshot — otherwise a
        // setData that lands between this effect's render and its callback (a realtime suggestion insert, an
        // autosave merge, a rapid second edit) would be clobbered by the stale projects map (data loss).
        // NEW-1 — this recascade is the automatic CONSEQUENCE of the holiday-settings edit that
        // triggered it, not a separate action; fold it into that same undo step (see isDerivedUpdate above).
        isDerivedUpdate.current = true;
        setData(d => {
          const newProjects = {};
          Object.entries(d.projects).forEach(([id, proj]) => {
            let tasks = proj.tasks.map(t => {
              if (t.pinnedEnd && t.end) return t;                        // preserve a locked finish (B616) — never re-derive its end
              const r = resolveTaskSpan(t); return {...t, end: r.end, duration: r.duration};  // unit-aware re-derive (days/weeks vs calendar)
            });
            tasks = recomputeSchedule(tasks);
            newProjects[id] = {...proj, tasks};
          });
          return {...d, projects: newProjects};
        });
      } else {
        if (skipHolRecasc.current) skipHolRecasc.current = false;
        else prevHolKey.current = holKey;
      }
      // B1161792 (NEW-1) — reconcile needsAttentionSince on every real data change (a task edit,
      // a rule/settings change, or the first load of an existing schedule). `reconcileNeedsAttention`
      // is a no-op (same `d` back) when nothing needs restamping, so this can't loop against its own
      // write. The complementary date-rollover case (health flips red with no edit at all) is
      // covered by the `refresh()` callback above.
      // NEW-1 — this write is a DERIVED restamp of a field the edit above already committed, not a
      // second edit; fold it into the same undo step (isDerivedUpdate — see its declaration for the
      // undo-stuck bug this fixes). Reset the flag immediately on a no-op (same ref back) so it can
      // never leak forward and swallow a later, unrelated edit's own history entry.
      isDerivedUpdate.current = true;
      setData(d => { const next = reconcileNeedsAttention(d); if (next === d) isDerivedUpdate.current = false; return next; });
    }
    if (fileHandleRef.current && fileHtmlRef.current) {
      clearTimeout(fileSaveTimer.current);
      fileSaveTimer.current = setTimeout(async () => {
        try {
          const tag = `<script id="planar-data">window.__PLANAR_DATA__=${JSON.stringify(data)};<\/script>`;
          let html = fileHtmlRef.current;
          if (html.includes('<script id="planar-data">')) {
            html = html.replace(/<script id="planar-data">[\s\S]*?<\/script>/, tag);
          } else {
            html = html.replace('<body>', '<body>\n' + tag);
          }
          fileHtmlRef.current = html;
          const writable = await fileHandleRef.current.createWritable();
          await writable.write(html);
          await writable.close();
        } catch(e) { console.warn('Auto-save failed:', e); }
      }, 700);
    }
  }, [data]);

  // Green save pulse — fires only when Supabase confirms the write, so gray
  // means "not yet confirmed" rather than "feature not set up"
  useEffect(() => {
    let t;
    const onSaved = () => { setSavePulse(true); setOfflineFallback(false); clearTimeout(t); t = setTimeout(() => setSavePulse(false), 1500); };
    window.addEventListener("planar:cloud-saved", onSaved);
    return () => { window.removeEventListener("planar:cloud-saved", onSaved); clearTimeout(t); };
  }, []);

  // While unsaved, retry automatically — every 20s, and the moment the
  // connection comes back. Red clears itself the instant a retry lands.
  useEffect(() => {
    if (saveStatus !== "error") return;
    const retry = () => { if (latestData.current) attemptCloudSave(latestData.current); };
    const iv = setInterval(retry, 20000);
    window.addEventListener("online", retry);
    return () => { clearInterval(iv); window.removeEventListener("online", retry); };
  }, [saveStatus]);

  // -- Multi-device live-refresh -- every 20s (and on focus / reconnect / tab
  // switch) ask the cloud whether another device saved a newer version. A clean
  // tab (everything saved) takes the latest: silently if it's backgrounded, or
  // via a one-click banner if you're looking at it. A tab with unsaved edits is
  // never auto-clobbered -- it just shows the banner. The storage-layer guard is
  // the hard backstop that blocks a stale save no matter what.
  // NEW-1 (false-conflict/merge-toast inflation, owner report 2026-09-17) — this poll used to be
  // the only thing that ever SET the banner, with nothing to CLEAR it: once true, staleNotice
  // stayed true even after a later successful save/merge caught this tab up, so the banner could
  // sit on screen telling him to reload long after there was nothing left to reload for (and could
  // show at the same moment a "merged" toast just confirmed the opposite). Self-heals below: not
  // newer any more → clear it, the same way it was set.
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || !window.storage || !window.storage.checkRemote) return;
      try {
        const r = await window.storage.checkRemote("hs-v1");
        if (!r || !r.ok) return;
        if (!r.newer) { setStaleNotice(false); return; }
        if (saveStatusRef.current === "saved" && document.hidden) { window.location.reload(); return; }
        // NEW-1 (false "newer version" banner on a flipped account, owner report 2026-09-25) — a
        // CLEAN (nothing unsaved), VISIBLE tab reporting "newer" almost always means some OTHER
        // instance of this same account (another keep-alive Scheduler iframe, another open tab) just
        // wrote — there is nothing of THIS tab's own to lose, so silently catch up instead of
        // nagging for a manual reload. A DIRTY tab (unsaved edits) still gets the banner below — it
        // has something to protect and a silent overwrite would be the wrong failure mode.
        if (saveStatusRef.current === "saved" && !document.hidden && window.storage.silentRefresh) {
          const fresh = await window.storage.silentRefresh("hs-v1");
          if (fresh && applyLoadedDataRef.current) { applyLoadedDataRef.current(fresh); setStaleNotice(false); return; }
        }
        setStaleNotice(true);
      } catch (e) {}
    };
    const iv = setInterval(check, 20000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => { stopped = true; clearInterval(iv); window.removeEventListener("focus", check); window.removeEventListener("online", check); document.removeEventListener("visibilitychange", check); };
  }, []);

  // The storage guard fired -- a save was blocked because the cloud moved ahead.
  useEffect(() => {
    const onStale = () => setStaleNotice(true);
    window.addEventListener("planar:stale", onStale);
    return () => window.removeEventListener("planar:stale", onStale);
  }, []);

  // B864(b) — a sibling tab's newer save was AUTO-MERGED with ours (a calendar it added, a task it edited).
  // Adopt the result so this tab's in-memory state converges with the cloud; reconcile against our CURRENT
  // state (mergeCloudDoc(ancestor, current, merged)) so any edit made during the save round-trip survives.
  useEffect(() => {
    const onMerged = (e) => {
      const merged = e && e.detail && e.detail.value;
      const anc = e && e.detail && e.detail.base;
      if (!merged || !merged.projects) return;
      // NEW-3 (B1696642) — this merge is detected purely from the cloud ROW's rev number, which
      // carries no tab/window/device identity. The old "from another tab" wording claimed a scope
      // this app can never actually know (it fires identically for another window or another device
      // entirely — the owner saw it while working in only one tab) — say only what's known: that
      // something changed elsewhere, and how many rows it touched.
      // NEW-1 (owner follow-on 2026-09-16) — "elsewhere" used to mean only "some other tab/device";
      // it never said WHICH of the account's schedules the merge actually landed in, even though the
      // cloud document holds every schedule under every project and a merge can land in one the user
      // isn't even looking at. changedProjectIds + mergeLocationPhrase name it (dropping the name
      // when the only schedule touched is the one already on screen — nothing to disambiguate there).
      const changedRows = countChangedTaskRows(anc, merged);
      const changedPids = changedProjectIds(anc, merged);
      const where = mergeLocationPhrase(merged.projects, changedPids, dataRef.current?.aPid);
      // NEW-1 (false "newer version"/empty merge toast on a flipped account, owner report
      // 2026-09-25) — a "merge" whose result is byte-identical to what this tab already had is not
      // news: it's the per-schedule write path (writeScheduleRowsPrimary) reconciling a rev this tab
      // was simply a save behind on, with no actual content difference (see reseedScheduleBaseline
      // and writeOneScheduleRow's identical-content adoption). countChangedTaskRows alone only
      // checks TASK content; also require the merged doc's whole `projects` tree to be byte-equal to
      // the ancestor's, so a real non-task change (a schedule's name/linkedSiteId) still toasts.
      const trulyEmpty = changedRows === 0 && _mEq(merged.projects, anc && anc.projects);
      setData(cur => {
        if (!cur) return applyTaskFocus(merged);
        try { return applyTaskFocus(mergeCloudDoc(anc, cur, merged)); } catch { return applyTaskFocus(merged); }   // NEW-1 (2026-10-02) — a merged-in remote doc carries no `focused`
      });
      // NEW-1 — a successful merge means this tab is caught up (its own save just became the new
      // top cloud version), so any "reload for the latest" banner is now stale advice — clear it
      // rather than let a toast saying "merged" and a banner saying "reload" sit on screen together
      // (the owner's report, verbatim: a banner "keeps appearing" alongside a green merge toast).
      setStaleNotice(false);
      if (!trulyEmpty && typeof showToast === "function") {
        const msg = changedRows > 0
          ? `Merged in changes saved elsewhere — ${changedRows} task${changedRows===1?"":"s"} updated${where ? " " + where : ""}.`
          : "Merged in changes saved elsewhere.";
        showToast(msg, { type: "info", duration: 4000 });
        logMergeToastEvent(changedRows, changedPids, merged.projects);
      }
    };
    window.addEventListener("planar:merged", onMerged);
    return () => window.removeEventListener("planar:merged", onMerged);
  }, []);

  // Last line of defense: if the tab is closed while the latest changes
  // haven't reached the cloud, the browser asks for confirmation first.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (saveStatusRef.current === "saved") return;
      e.preventDefault(); e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // True while any blocking overlay (modal / context menu / panel) is open. Read by the global key
  // handler below so document-level grid shortcuts (Delete / Insert / undo / paste / arrows) can't
  // fire on the hidden grid behind a modal — e.g. Delete behind the Successor prompt was clearing /
  // deleting the still-selected row or cell. A ref (not an effect dep) keeps the always-attached key
  // listener fresh without re-binding it every time a panel opens.
  const overlayOpenRef = useRef(false);
  useEffect(() => {
    overlayOpenRef.current = !!(successorPrompt || notesCtx || projCtx || taskCtx || renameModal ||
      deleteChoice || pdfExportOpen || formatOpen || settingsOpen || automationOpen || contactsOpen ||
      historyOpen || reviewOpen || meetingCalOpen);
  }, [successorPrompt, notesCtx, projCtx, taskCtx, renameModal, deleteChoice, pdfExportOpen, formatOpen,
      settingsOpen, automationOpen, contactsOpen, historyOpen, reviewOpen, meetingCalOpen]);

  /* NEW-1 — ⛔ THE GUARD ABOVE ASKS "IS AN OVERLAY OPEN?" AND THE RIGHT QUESTION IS "DID THIS
   * KEYSTROKE BEGIN WHILE ONE WAS?" — those differ for exactly one keystroke, the one that
   * DISMISSES the overlay, and that is the keystroke that caused the bug.
   *
   * Measured: press Enter on the successor prompt and the modal applies and closes itself
   * synchronously, so by the time this same event reaches the document-level handler below the ref
   * already reads false. The handler then does what Enter on a picker column is designed to do —
   * fire a synthetic click on the dot and open the picker — so the status menu the user had just
   * closed REAPPEARS. It is not the first menu left orphaned; it is a second one, opened by the
   * keystroke that dismissed the prompt. Enter left a menu up 7/7; Escape 0/7; the ✕ button 0/7;
   * and with no prompt in play, picking a swatch left one up 0/9.
   *
   * WHY LATCHING AND NOT "THE MODAL SWALLOWS THE KEY": making SuccessorPromptModal call
   * stopImmediatePropagation fixes SuccessorPromptModal. Thirteen overlays feed the ref above, and
   * the next one added would arrive with the same hole — the defect is in the QUESTION the guard
   * asks, not in any one modal's manners. Latching in capture (window capture runs before anything
   * on document, and before React's root handler) records the answer while it is still true, so
   * every overlay is covered by construction and no modal has to remember anything.
   *
   * It deliberately does NOT touch the legitimate feature: with no overlay in play the latch is
   * false at keydown, and Enter on a picker column still opens the picker. Both directions asserted
   * in ui-audit/verify-grid-overlay-input.mjs. */
  const overlayAtKeyStartRef = useRef(false);
  useEffect(() => {
    const latch = () => { overlayAtKeyStartRef.current = overlayOpenRef.current; };
    window.addEventListener("keydown", latch, true);
    return () => window.removeEventListener("keydown", latch, true);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      // A modal/menu owns the keyboard — don't run grid shortcuts behind it. `overlayAtKeyStart`
      // also covers the keystroke that DISMISSED the overlay: by the time that one arrives here the
      // modal has already closed itself, so the live ref reads false and the grid would act on a key
      // the user aimed at the modal (NEW-1 — that is what re-opened the status menu).
      if (overlayOpenRef.current || overlayAtKeyStartRef.current) return;
      const tag = document.activeElement.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Insert" && !typing) {
        e.preventDefault();
        if (!e.repeat) insertTask();
        return;
      }
      // NEW-1 (B2455200) — Alt+F toggles Focus for the group of the TOP selected row (see focusToggleTarget).
      // e.code, not e.key: with Alt held a Mac reports "ƒ". Never while a cell is being edited (an input has
      // focus, or the editor state is open) — then the key is left entirely alone. Outside editing,
      // preventDefault always runs (even when there is no group to toggle) so Chrome's own File menu never
      // opens on Windows: Alt+F is ours everywhere on the grid, consistently.
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === "KeyF" &&
          !typing && !document.activeElement?.isContentEditable && !editLiveRef.current) {
        e.preventDefault();
        if (e.repeat) return;
        const ids = rowRangeSelIds();
        toggleGroupFocus(ids.length ? ids[0] : selectedId, selectedId);
        return;
      }
      if (e.key === "Delete" && !typing) {
        if (!e.repeat && selectedId !== null) {
          e.preventDefault();
          const lastColIdx = activeEffectiveCols(dataRef.current).length - 1;
          // B2530690 — EVERY range must be a full row for Delete to remove rows (ID-column select, Ctrl+click on
          // row numbers); any cell range in the mix makes Delete clear contents instead, as in Excel.
          const isFullRow = selRange && rangesOf(selRange).every(g => g.c1 === 0 && g.c2 === lastColIdx);
          if (isFullRow) {
            // Delete every row in the selected span (ID-column drag /
            // shift-click) — asks first if any of them have subtasks (requestDelete);
            // otherwise deletes immediately, exactly as before.
            const ids = fullRowSelIds();
            requestDelete(ids.length ? ids : [selectedId]);
            return;
          }
          // Multi-cell range delete (Excel-style): blank every editable, non-locked, non-picker cell in
          // the span — mirrors the fill path (typing into a range fills the whole range), which Delete
          // previously didn't match (it only cleared the focused cell).
          const cols = activeEffectiveCols(dataRef.current);
          if (selIsRange(selRange)) {
            const ftasks = flatTasksRef.current;
            // every cell of every range, grouped by row so each task gets ONE updateTask (one undo step overall)
            const byRow = new Map();
            cellsOf(selRange).forEach(({r, c}) => { if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push(c); });
            for (const [r, cs] of byRow) {
              const t = ftasks[r]; if (!t) continue;
              const patch = {};
              for (const c of cs) {
                const col = cols[c];
                if (!col?.e || col.t === "health" || col.t === "notes") continue;
                if (t.hasChildren && (col.k==="start"||col.k==="end"||col.k==="duration"||col.t==="cost")) continue;
                patch[col.k] = (col.k === "duration" || col.k === "percentComplete") ? 0 : "";
              }
              if (Object.keys(patch).length) updateTask(t.id, patch);
            }
            return;
          }
          // Fix #7: Delete on a single cell clears its value (Excel-style)
          const col = cols[selectedColIdx];
          if (col?.e && col.t !== "health" && col.t !== "notes") {
            const selTask = flatTasksRef.current.find(t => t.id === selectedId);
            const isParentDateLocked = selTask?.hasChildren && (col.k==="start"||col.k==="end"||col.k==="duration"||col.t==="cost");
            if (!isParentDateLocked) {
              const blank = (col.k === "duration" || col.k === "percentComplete") ? 0 : "";
              updateTask(selectedId, {[col.k]: blank});
            }
          }
        }
        return;
      }
      // NEW-1 (B2451776) — Ctrl/Cmd+Arrow: jump across blank cells like Excel (the rule and the definition of
      // "blank" live in src/workspaces/scheduler/lib/gridCtrlNav.js; the three functions are mirrored near
      // stepGridRow). NAVIGATION MODE ONLY: a focused input / an open cell editor (editLiveRef) / a contentEditable
      // all fall through untouched so Ctrl+Arrow still moves by word in the text. preventDefault runs only once the
      // grid has an anchor to move from. Ctrl+Shift+Arrow extends the Shift+Arrow range from its moving end.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing && selectedId !== null &&
          !document.activeElement?.isContentEditable && !editLiveRef.current &&
          (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const flat = flatTasksRef.current;
        const NEW_ROW = "__NEW_TASK__";
        const anchorRow = selectedId === NEW_ROW ? flat.length : flat.findIndex(t => t.id === selectedId);
        if (anchorRow < 0) return;                       // the selected row is hidden / gone — nothing to anchor on
        e.preventDefault();
        const proj = activeProjectOf(dataRef.current);
        const eff = activeEffectiveCols(dataRef.current);
        let formulas = null, succIds = null;             // built lazily — only if a scan actually reaches such a column
        const env = {
          formula: (id, k) => { if (!formulas) formulas = computeFormulaValues(flat, formulaColsOf(proj), proj); return formulas[id]?.[k]; },
          predCount: arr => normPreds(arr).length,
          succCount: id => {
            if (!succIds) { succIds = new Set(); (proj?.tasks || []).forEach(t => normPreds(t.predecessors).forEach(p => succIds.add(p.id))); }
            return succIds.has(id) ? 1 : 0;
          },
          ownerCount: t => ownerListOf(t).length,
          floatDays: t => t.hasChildren ? null : meetingFloatBD(t, fdLocal(new Date())),
          costDays: t => t.hasChildren ? null : meetingCostDays(t, MEETING_BODY_INDEX[t.meetingBodyId]),
        };
        // "+ New task" (row === flat.length) is a blank row to scan THROUGH, never a destination.
        const blankAt = (r, c) => r >= flat.length || !eff[c] ? true : gridCellBlank(flat[r], eff[c], env);
        const colMasters = visibleColIdxs();
        if (e.shiftKey) {
          if (selectedId === NEW_ROW) return;            // Shift+Arrow ignores "+ New task" too
          const cur = selRange || {r1:anchorRow, r2:anchorRow, c1:selectedColIdx, c2:selectedColIdx};
          const t = gridCtrlArrowTarget(e.key, flat.length, colMasters, cur.r2, cur.c2, blankAt);
          if (t) {
            setSelRange(withActive(cur, {r1:cur.r1, c1:cur.c1, r2:t.row, c2:t.col}));
            // the range's moving end is not the selection, so the grid's selection-chase doesn't follow it — ask it to
            document.dispatchEvent(new CustomEvent("planar-reveal-cell", {detail: {row: t.row, col: t.col}}));
          }
          return;
        }
        const t = gridCtrlArrowTarget(e.key, flat.length, colMasters, anchorRow, selectedColIdx, blankAt);
        if (t) {
          setSelectedColIdx(t.col);
          if (t.row !== anchorRow && flat[t.row]) setSelectedId(flat[t.row].id);
          setSelRange(null);
        }
        return;
      }
      // Fix #8: Ctrl/Cmd+Z → undo; Ctrl+Y / Ctrl+Shift+Z → redo
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          if (history.current.length > 0) {
            const prev = history.current[history.current.length - 1];
            history.current = history.current.slice(0, -1);
            future.current = [...future.current, dataRef.current];  // push the LIVE current state (the keydown effect omits `data` from its deps, so the closure `data` is stale — using it stored wrong redo snapshots and lost the redone edit)
            isUndoing.current = true;
            setData(prev);
          }
          return;
        }
        if (k === "y" || (k === "z" && e.shiftKey)) {
          e.preventDefault();
          if (future.current.length > 0) {
            const next = future.current[future.current.length - 1];
            future.current = future.current.slice(0, -1);
            history.current = [...history.current, dataRef.current];  // live current state, not the stale closure `data` (see undo branch)
            isUndoing.current = true;
            setData(next);
          }
          return;
        }
        // Ctrl/Cmd+C — copy the selected task (and its whole subtree) to the task clipboard, or the
        // WHOLE active row selection when selectedId is part of one (structuralTargets — same rule
        // indent/outdent/delete already use). Only fires when the row is selected at task level (no
        // cell-text selection); the typing-guard above already prevents this from stealing copy from
        // input fields.
        if (k === "c" && !e.shiftKey && selectedId !== null) {
          e.preventDefault();
          copyTaskById(structuralTargets(selectedId));
          return;
        }
        // Ctrl/Cmd+X — cut: same as copy, but the next paste removes the source.
        if (k === "x" && !e.shiftKey && selectedId !== null) {
          e.preventDefault();
          cutTaskById(structuralTargets(selectedId));
          return;
        }
        // Ctrl/Cmd+V — paste the clipboard's subtree below the currently-selected task,
        // as a sibling at the target's level. Internal predecessors are remapped; external
        // ones stay valid in the same project.
        if (k === "v" && !e.shiftKey && selectedId !== null) {
          e.preventDefault();
          pasteTaskAfter(selectedId);
          return;
        }
      }
      // Alt+Shift+Right → indent (make subtask of row above) — acts on the WHOLE selected row
      // range when one is active, not just the anchor cell (see rowRangeSelIds/structuralTargets).
      if (e.altKey && e.shiftKey && e.key === "ArrowRight" && !typing) {
        e.preventDefault();
        if (!e.repeat && selectedId !== null) { const ids = blockOnlyTargets(selectedId); if (ids) indentSelectionByIds(ids); }
        return;
      }
      // Alt+Shift+Left → outdent (promote one level up) — same whole-selection scope as indent.
      if (e.altKey && e.shiftKey && e.key === "ArrowLeft" && !typing) {
        e.preventDefault();
        if (!e.repeat && selectedId !== null) { const ids = blockOnlyTargets(selectedId); if (ids) outdentSelectionByIds(ids); }
        return;
      }
      // Fix #2: Tab / Shift+Tab — advance to next/previous column (Excel-style)
      if (e.key === "Tab" && !typing && selectedId !== null) {
        e.preventDefault();
        if (e.shiftKey) {
          setSelectedColIdx(i => stepGridCol(i, -1));
        } else {
          setSelectedColIdx(i => stepGridCol(i, +1));
        }
        setSelRange(null);
        return;
      }
      // Fix #9: Shift+Arrow — extend selection range
      if (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !typing && selectedId !== null) {
        const arrowKeys = ["ArrowDown","ArrowUp","ArrowLeft","ArrowRight"];
        if (arrowKeys.includes(e.key)) {
          e.preventDefault();
          const ftasks = flatTasksRef.current;
          const anchorRi = ftasks.findIndex(t => t.id === selectedId);
          if (anchorRi >= 0) {
            const cur = selRange || {r1:anchorRi, r2:anchorRi, c1:selectedColIdx, c2:selectedColIdx};
            let {r1, r2, c1, c2} = cur;
            if (e.key === "ArrowDown")  r2 = Math.min(ftasks.length - 1, r2 + 1);
            if (e.key === "ArrowUp")    r2 = Math.max(0, r2 - 1);
            if (e.key === "ArrowRight") c2 = stepGridCol(c2, +1);
            if (e.key === "ArrowLeft")  c2 = stepGridCol(c2, -1);
            setSelRange(withActive(cur, {r1, r2, c1, c2}));   // B2530690 — only the newest range extends
          }
          return;
        }
      }
      // Shift+Space — select entire current row
      if (e.shiftKey && e.key === " " && !e.ctrlKey && !e.metaKey && !typing && selectedId !== null) {
        e.preventDefault();
        const tasks = flatTasksRef.current;
        const ri = tasks.findIndex(t => t.id === selectedId);
        if (ri >= 0) setSelRange({r1:ri, r2:ri, c1:0, c2:activeEffectiveCols(dataRef.current).length-1});
        return;
      }
            // Enter / F2 — open edit with existing value; notes → open modal; pickers → open picker
      if (!e.altKey && !e.ctrlKey && !e.metaKey && !typing && selectedId !== null &&
          (e.key === "Enter" || e.key === "F2")) {
        if (selectedId === "__NEW_TASK__") {
          e.preventDefault();
          openNameEditOnReveal.current = true;
          addTask();
          return;
        }
        const col = activeEffectiveCols(dataRef.current)[selectedColIdx];
        if (col) {
          e.preventDefault();
          if (col.t === "notes") {
            const pid = projIdRef.current;
            if (pid !== null) setNotesCtx({taskId: selectedId, projectId: pid});
          } else if (col.k === "health" || col.k === "status") {
                        // Fix #5: Enter on a picker column opens its picker (same as Alt+Down)
            const cell = document.querySelector(`[data-picker-cell="${col.k}-${selectedId}"]`);
            const trigger = cell?.querySelector("[data-health-dot], span[style]") || cell?.firstElementChild;
            trigger?.click();
          } else if (col.e) {
              const selTask = flatTasksRef.current.find(t => t.id === selectedId);
              const isParentDateLocked = selTask?.hasChildren && (col.k==="start"||col.k==="end"||col.k==="duration"||col.t==="cost");
              if (!isParentDateLocked) setEdit({taskId: selectedId, col: col.k});
          }
          return;
        }
      }
      // Type-to-edit — any printable key opens the cell and seeds it with that character
      if (!e.altKey && !e.ctrlKey && !e.metaKey && !typing && selectedId !== null && e.key.length === 1) {
        if (selectedId === "__NEW_TASK__") return; // no-op on the "+ New task" affordance
        const col = activeEffectiveCols(dataRef.current)[selectedColIdx];
        if (col) {
          if (col.t === "notes") {
            const pid = projIdRef.current;
            if (pid !== null) { e.preventDefault(); setNotesCtx({taskId: selectedId, projectId: pid, initChar: e.key}); }
            return;
          }
          if (col.e && col.t !== "health") {
            const selTask = flatTasksRef.current.find(t => t.id === selectedId);
            const isParentDateLocked = selTask?.hasChildren && (col.k==="start"||col.k==="end"||col.k==="duration"||col.t==="cost");
            if (isParentDateLocked) return;
            // Fix #3: numeric columns reject non-digit type-to-edit (matches Grid view behaviour)
            const isNum = col.k === "duration" || col.k === "percentComplete";
            if (isNum && !/\d/.test(e.key)) return;
            e.preventDefault();
            setEdit({taskId: selectedId, col: col.k});
            setEditStartChar(e.key);
            return;
          }
        }
      }
      // Alt+Down — open picker for health and status columns
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowDown" && !typing && selectedId !== null) {
        const col = activeEffectiveCols(dataRef.current)[selectedColIdx];
        if (col?.k === "health" || col?.k === "status") {
          e.preventDefault();
          const cell = document.querySelector(`[data-picker-cell="${col.k}-${selectedId}"]`);
          const trigger = cell?.querySelector("[data-health-dot], span[style]") || cell?.firstElementChild;
          trigger?.click();
          return;
        }
      }
      // Plain arrow keys — cell navigation (no modifiers, not typing)
      if (!e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && !typing) {
        const isArrow = e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight";
        if (isArrow) {
          // Close any open picker when navigating away
          document.dispatchEvent(new CustomEvent("planar-picker-open", {detail: "nav"}));
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          // NEW-1 — one row from where the selection IS (or, if its row is hidden / deleted, from the gap it
          // left), via stepGridRow. The old inline fallbacks sent a lost selection to the first or last row.
          e.preventDefault();
          const tasks = flatTasksRef.current;
          const target = stepGridRow(tasks, activeProjectOf(dataRef.current)?.tasks || [], selectedId,
            e.key === "ArrowDown" ? +1 : -1, lastSelIdxRef.current, viewportTopFlatIdx(tasks));
          if (target != null) { setSelectedId(target); setSelRange(null); }
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSelectedColIdx(i => stepGridCol(i, +1));
          setSelRange(null);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSelectedColIdx(i => stepGridCol(i, -1));
          setSelRange(null);
          return;
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // NOTE: deleteTask/insertTask/requestDelete/indentSelectionByIds/outdentSelectionByIds/
    // structuralTargets/rowRangeSelIds/fullRowSelIds are intentionally NOT in this dependency
    // array. They are defined later in this component; the by-id helpers are stable
    // (useCallback([])) and read the current selection via `selectedId`/`selRange`, which ARE
    // dependencies here — so the listener re-binds (capturing the fresh selection) whenever either
    // changes. Referencing the helpers directly here would read them before initialization if the
    // build ever kept `const` block-scoping instead of hoisting to `var`.
  }, [selectedId, selectedColIdx, selRange, isUndoing]);

  // NEW-1 (B2455200) — the Alt+F action: flips `focused` through updateTask, i.e. EXACTLY what the summary row's
  // Focus chip does, so it is undoable the same way (one history step, Ctrl+Z). A multi-row selection
  // collapses to its top row (the toggle changes which rows exist, so the old row range would be stale). The
  // insert pins are dropped in the same batch (a Focus toggle re-applies the filter — the focusSig effect does
  // it too, but one render later). The selection follows below, in the focusSig layout effect.
  const toggleGroupFocus = (anchorId, selId) => {
    const all = activeProjectOf(dataRef.current)?.tasks || [];
    const gid = focusToggleTarget(all, anchorId);
    if (gid == null) return;
    const g = all.find(t => t.id === gid);
    if (!g) return;
    focusReselectRef.current = { selId };   // the row that IS selected (a range's cursor), not the range's top row
    setFocusPins(p => (p.size ? new Set() : p));
    setSelRange(null);
    updateTask(gid, { focused: !g.focused });
    // The chip is only drawn on an EXPANDED summary with something to hide; when it is not, say what happened.
    const row = (flatTasksRef.current || []).find(t => t.id === gid);
    if (!(row && row.isExpanded && row.hideableCount > 0))
      showToast(`Focus ${g.focused ? "off" : "on"} for "${g.name || "Untitled"}"` + (g.isExpanded ? " — nothing to hide in it yet" : " — expand the group to see it"), { type: "success", duration: 2500 });
  };

  // Ctrl+scroll → zoom Gantt timeline instead of browser zoom
  // RAF-throttled so rapid scrolling doesn't overwhelm React with renders
  const zoomRafRef = useRef(null);
  const zoomAccRef = useRef(0);
  useEffect(() => {
    // NEW-1 (2026-11-03) — a NON-PASSIVE wheel listener on the window makes the browser hold EVERY wheel notch until the
    // page's main thread has run it, so a busy frame (a row commit, a recompute) stalls the scroll itself — the grid
    // "sticks" and then jumps. The handler only ever acts when Ctrl/Cmd is down, so it is registered ONLY while one is
    // (keydown → add, keyup / blur → remove); a plain wheel never meets a blocking listener.
    // NEW-1 (2026-11-06, B2693?) — "i want ctrl zoom to always work if im hovering over the schedule". The gate above armed
    // from this frame's OWN key events only, so with keyboard focus anywhere else in the app (the header, a project switcher,
    // another panel) a Ctrl press never reached the frame, no listener existed, and Ctrl+wheel zoomed the BROWSER PAGE. It is
    // now armed from three more places, none of which leaves a blocking listener at rest (measured: a permanent one adds
    // ~15 ms to EVERY wheel→scroll at every CPU speed — docs on the B2644624 / NEW-1 entries):
    //   · any pointer event over the frame that carries the modifier (a pointer event reports Ctrl/Cmd even when the key went
    //     to another document — covers "Ctrl held in the address bar, then the mouse moves in");
    //   · the shell forwards Ctrl/Cmd down/up/blur from ITS window (`planar:modifier-keys`, Scheduler.jsx) — covers focus
    //     anywhere in the app, with the pointer resting still;
    //   · (unchanged) this frame's own keydown/keyup/blur.
    // NOT covered, by design: focus outside the page document with the pointer not moving after Ctrl goes down, and a
    // trackpad pinch (Chrome sends it as a ctrl+wheel with no key at all).
    let armed = false;
    const arm = on => {
      if (on === armed) return; armed = on;
      if (on) window.addEventListener("wheel", onWheel, {passive: false});
      else window.removeEventListener("wheel", onWheel);
    };
    const onKey = e => arm(!!(e.ctrlKey || e.metaKey));
    const onPointer = e => arm(!!(e.ctrlKey || e.metaKey));
    const onShellKeys = e => {
      if (!e || e.origin !== window.location.origin) return; // same-origin shell only (audit batch A)
      const m = e && e.data;
      if (!m || m.source !== "planar-shell" || m.type !== "planar:modifier-keys") return;
      arm(!!(m.ctrl || m.meta));
    };
    const onBlur = () => arm(false);
    const onWheel = e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAccRef.current += e.deltaY;
      if (zoomRafRef.current) return;
      zoomRafRef.current = requestAnimationFrame(() => {
        const delta = zoomAccRef.current;
        zoomAccRef.current = 0;
        zoomRafRef.current = null;
        if (hoverZoneRef.current === 'grid') {
          setGridZoom(z => {
            const factor = delta < 0 ? 1.12 : 1 / 1.12;
            const nz = Math.max(0.5, Math.min(2.0, Math.round(z * factor * 100) / 100));
            setData(d => ({...d, gridZoom: nz}));
            return nz;
          });
        } else {
          setGanttPPD(z => {
            const factor = delta < 0 ? 1.15 : 1 / 1.15;
            return Math.max(1, Math.min(80, Math.round(z * factor * 10) / 10));
          });
        }
      });
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("pointermove", onPointer, {capture: true, passive: true});
    window.addEventListener("pointerdown", onPointer, {capture: true, passive: true});
    window.addEventListener("message", onShellKeys);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("pointermove", onPointer, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("message", onShellKeys);
      window.removeEventListener("blur", onBlur);
      arm(false);
      if (zoomRafRef.current) cancelAnimationFrame(zoomRafRef.current);
    };
  }, []);

  const updateTask = useCallback((taskId, updates, projId=null) => {
    const updatesIn = updates;   // the caller's patch; inside the updater `updates` is the gate's rewritten COPY (resolveBoundEdit), this one feeds the post-setData health prompt
    setData(d => {
      const pid = projId ?? d.aPid;
      // NEW-1 (2026-11-03) — a date reaching a meeting-bound row from an EDIT is resolved forward to a real
      // meeting HERE, before anything is stored: the one choke point for typed Start/Finish, range fill,
      // the task editor, suggestion approval and (re)binding. See resolveBoundEdit.
      const boundEdit = resolveBoundEdit(d.projects[pid]?.tasks || [], taskId, updatesIn, id => MEETING_BODY_INDEX[id]);
      const updates = boundEdit.updates;
      const _origStart = ((d.projects[pid]?.tasks || []).find(t => t.id === taskId) || {}).start || "";
      const _beforeTasks = d.projects[pid]?.tasks || [];   // NEW-1 — the pre-edit flags, for the "did THIS edit create a conflict" diff
      const _prevBoundStart = {};   // B816 — capture bound-task meeting dates BEFORE the edit, to detect rolls
      (d.projects[pid]?.tasks || []).forEach(t => { if (t.meetingBound && t.start) _prevBoundStart[t.id] = t.start; });
      let tasks = d.projects[pid].tasks.map(t => {
        if (t.id !== taskId) return t;
        const u = {...t, ...updates, ...completionDelta(t, updates)};   // B1953795 (S2) — keep status + % consistent on every leaf edit
        // ⛔ RULES-DECIDE (2026-08-25, owner correction) — RETIRED: a directly-picked status (StatusPicker /
        // context menu / grid cell / master-view cell) used to auto-stamp the override flag on every
        // plain color pick, silently opting the task out of automation forever — that's the exact
        // defect behind "why is an overdue task not turning red" (a single ordinary status click on a
        // task set healthOverride, and rules could never touch it again). The flag itself is now gone
        // (computeDisplayHealth never reads it), so an ordinary pick just writes `health`, full stop.
        // Sanitize rowColor — only allow known hex colors or null
        if ('rowColor' in updates) u.rowColor = isValidColor(updates.rowColor) ? updates.rowColor : null;
        // Sanitize per-task text-format overrides to strict booleans (so junk data can't render)
        if ('bold' in updates)      u.bold      = !!updates.bold;
        if ('italic' in updates)   u.italic    = !!updates.italic;
        // NEW-2 — underline/textColor/fontSize follow the exact same sanitize-on-write shape as
        // bold/italic/rowColor above: a strict boolean, a known-hex-or-null color, a clamped-or-null size.
        if ('underline' in updates) u.underline = !!updates.underline;
        if ('textColor' in updates) u.textColor = isValidColor(updates.textColor) ? updates.textColor : null;
        if ('fontSize' in updates)  u.fontSize  = isValidFontSize(updates.fontSize) ? updates.fontSize : null;
        // NEW-1 (task icons) — `icons` is its OWN field (0–2 emoji / "c:<name>" ids), never part of the name. Sanitised on
        // write like the format fields above; an empty list DELETES the key so an icon-free schedule is byte-identical to today.
        if ('icons' in updates) { const ic = PlanyrTaskIcons.normalizeTaskIcons(updates.icons); if (ic.length) u.icons = ic; else delete u.icons; }
        if ('predecessors' in updates) {
          u.predecessors = normPreds(updates.predecessors);
          // Editing a predecessor is an explicit instruction to let the cascade
          // control this task's start. Clear any manual pin so it takes effect.
          delete u.pinnedStart;
        }
        // Fold a duration edit into the typed-intent model (durValue/durUnit); a legacy programmatic
        // {duration} edit (range-fill / import) maps to days so back-compat consumers are unaffected.
        if ('duration' in updates && !('durValue' in updates) && !('durUnit' in updates)) { u.durUnit = 'd'; u.durValue = Math.max(0, Math.trunc(Number(updates.duration) || 0)); }
        if (('durValue' in updates) || ('durUnit' in updates)) { u.durUnit = u.durUnit || 'd'; if (u.durValue == null) u.durValue = 0; }
        const durEdited = ('duration' in updates) || ('durValue' in updates) || ('durUnit' in updates);
        if ((durEdited || ('start' in updates)) && !('end' in updates)) {
          // Duration or start is the source of truth → derive end + working-day count from the unit.
          // EXCEPT when a finish is locked (B616): the locked end wins; cascadeDates back-calcs the
          // start and flags a conflict — never let a duration edit silently overwrite the lock.
          if (!(u.pinnedEnd && u.end)) { const r = resolveDuration(u.start, taskDurValue(u), taskDurUnit(u)); u.end = r.end; u.duration = r.duration; }
        }
        else if ('end' in updates && !('start' in updates)) {
          // Typing a Finish PINS it as a hard-finish constraint (B616), mirroring the start lock.
          // Setting a Finish on a task that has no Start anchors a 1-day task on that date instead
          // of leaving duration "" (which rendered a bare "d") and letting the cascade wipe it.
          if (u.end && !u.start) { u.start = u.end; u.durUnit = 'd'; u.durValue = 1; u.duration = 1; }
          else { u.duration = (u.start && u.end) ? Math.max(0, difBD(u.start, u.end) + 1) : 0; u.durUnit = 'd'; u.durValue = u.duration; }  // numeric 0, never "" (no bare "d")
          u.pinnedEnd = !!u.end;                    // a real typed finish locks; clearing it unlocks (flow resumes)
        }
        // Start directly set (drag/manual date): pin position, successors still cascade from new end
        if ('start' in updates && !('predecessors' in updates)) u.pinnedStart = true;
        // NEW-1 — binding a dated row: its own date moves forward to a real meeting WITHOUT pinning it.
        if (boundEdit.startOverride) { u.start = boundEdit.startOverride; u.end = boundEdit.startOverride; }
        return u;
      });
      // When health changes on a parent, cascade to all descendants
      if ('health' in updates) {
        const getDescIds = (id, all) => {
          const kids = all.filter(t => t.parentId === id);
          return [...kids.map(k => k.id), ...kids.flatMap(k => getDescIds(k.id, all))];
        };
        const descIds = new Set(getDescIds(taskId, tasks));
        if (descIds.size > 0) {
          // ⛔ RULES-DECIDE (2026-08-25, owner correction): this cascade used to also set the
          // override flag on every descendant so it couldn't immediately be undone by a firing
          // rule. That flag is gone — a rule now decides every
          // cascaded descendant's displayed color exactly like any other task, same as the parent.
          tasks = tasks.map(t => descIds.has(t.id) ? {...t, health: updates.health, ...cascadeDelta(t, updates.health)} : t);
        }
      }
      if (touchesSchedule(updates)) {   // B835 (recurrence ×2) — fires for durValue/durUnit (typed duration) + pinnedStart/pinnedEnd (unpin/unlock) too, not just {duration}/{start}
        tasks = recomputeSchedule(tasks);
        // B816 — a bound task whose meeting moved from a prior meeting rolled a cycle; announce it
        // (once). Written to rollToastRef (not shown directly) — see its declaration for why: this
        // updater can run either synchronously or on a deferred render, and only the ref survives
        // both timings (B1539585).
        const editedT = tasks.find(t => t.id === taskId);
        // NEW-1 — the row the person edited announces ITS OWN move (below), never as an "agenda closed" roll.
        // B2642096 ×2 — settled against the CASCADED row: never announce a move the row didn't make.
        const _settled = settleBoundNotice(boundEdit, editedT && editedT.start);
        if (_settled && !rollToastRef.current) rollToastRef.current = boundEditNotice(_settled, editedT && editedT.name, fmtD);
        for (const t of tasks) {
          const prev = _prevBoundStart[t.id];
          if (t.id === taskId && ('start' in updates || 'end' in updates || boundEdit.rebinding)) continue;
          if (!rollToastRef.current && t.meetingBound && prev && t.start && t.start !== prev) {
            const body = MEETING_BODY_INDEX[t.meetingBodyId];
            if (body && !body.agendaLead) rollToastRef.current = `${t.name || "Task"} moved to ${fmtD(t.start)}, the next ${body.name || "meeting"} meeting.`;   // no filing lead: nothing "closed"
            else rollToastRef.current = `${t.name || "Task"} moved to ${fmtD(t.start)} — the ${fmtD(prev)} agenda closed ${fmtD(body ? agendaDeadline(body, prev) : "")}.`;
          }
        }
        // NEW-1 — binding a predecessor-driven, dated row: the engine (deadline rule) chose the meeting; say so.
        if (!rollToastRef.current && boundEdit.rebinding && editedT && editedT.meetingBound && _origStart && editedT.start && editedT.start !== _origStart) {
          const body = MEETING_BODY_INDEX[editedT.meetingBodyId];
          rollToastRef.current = `${editedT.name || "Task"} moved to ${fmtD(editedT.start)}, the next ${(body && body.name) || "meeting"} meeting${body && body.agendaLead ? " whose agenda is still open" : ""}.`;
        }
        // NEW-1 (owner decision) — a typed date HOLDS and he is told when this edit created a conflict (his date earlier
        // than the predecessor allows, or the predecessor moving past a typed date). One shared check, shared with the preview.
        const _typedDate = !!((('start' in updates) && updates.start) || (('end' in updates) && updates.end));
        const _pcMsg = pinConflictNotice(newPinConflicts(_beforeTasks, tasks, _typedDate ? [taskId] : []), _typedDate ? taskId : null, fmtD);
        if (_pcMsg) { const cur = rollToastRef.current || ""; if (!cur.includes(_pcMsg)) rollToastRef.current = cur ? cur + " " + _pcMsg : _pcMsg; }
      }
      return {...d, projects: {...d.projects, [pid]: {...d.projects[pid], tasks}}};
    });
    // ── Successor prompt: fire when task transitions to complete ──
    if (updates.health === 'green') {
      const snap = dataRef.current;
      if (snap) {
        const pid2 = projId ?? snap.aPid;
        const oldTask = snap.projects[pid2]?.tasks.find(t => t.id === taskId);
        if (oldTask && oldTask.health !== 'green') {
          // Ring & Spark toast: fire just after React paints the green state.
          // Bottom-anchored, so it stays visible when the successor prompt
          // opens at 80ms (and works from any view — grid, master, review).
          setTimeout(() => celebrateTaskComplete(oldTask.name), 60);
          setTimeout(() => {
            const d = dataRef.current;
            if (!d) return;
            const p = d.projects[pid2];
            if (!p) return;
            const completedTask = p.tasks.find(t => t.id === taskId);
            if (!completedTask) return;
            const successors = p.tasks.filter(t =>
              normPreds(t.predecessors).some(pr => pr.id === taskId) && t.health !== 'green'
            );
            // Only prompt when the completion actually unblocks something — i.e. there's at
            // least one Not Started (gray) successor to advance. Successors that are already
            // In Progress or Needs Attention need no review, so completing a task whose
            // successors are all already active opens nothing (the celebration still fires).
            // Already-active successors still ride along as context when the prompt does open.
            const hasReadyToStart = successors.some(t => t.health === 'gray');
            if (hasReadyToStart) {
              // NEW-1 — queued, not set directly: see the queue-drain effect near successorPrompt's
              // declaration. A batch completion (the modal's own "Mark Complete") can fire this twice
              // in close succession; queueing keeps both prompts instead of the second clobbering the first.
              // B1873361 — projName is the qualified crossScheduleLabel, not the bare schedule name:
              // two schedules can share a name, so context shown here must say which one.
              setSuccessorPromptQueue(q => [...q, { completedTask, projId: pid2, projName: crossScheduleLabel(p), successors }]);
            }
          }, 80);
        }
      }
    }
  }, []);

  // ── Multi-row delete ──────────────────────────────────────
  // Deletes several tasks (plus all their subtasks) in one pass — used by the
  // Delete key and the right-click menu when a full-row selection spans
  // multiple rows. Same pipeline as single delete (renumberTasks remaps ids
  // and drops dangling predecessor refs), so behavior matches exactly.
  // Selecting a parent together with its children is fine — the Set makes the
  // sweep idempotent. Shows a confirmation toast; Ctrl+Z restores everything.
  const deleteTasks = useCallback((taskIds) => {
    if (!taskIds || taskIds.length === 0) return;
    const pid = dataRef.current?.aPid;
    const all = dataRef.current?.projects?.[pid]?.tasks || [];
    const del = new Set();
    const mark = id => { del.add(id); all.filter(t => t.parentId === id).forEach(t => mark(t.id)); };
    taskIds.forEach(mark);
    const rowCount = taskIds.length, totalCount = del.size;
    setData(d => {
      const proj = d.projects[d.aPid];
      if (!proj) return d;
      // B501: recompute parent roll-ups + cascade after removal (matching indent/outdent/
      // paste/move) — else a deleted child leaves the parent summary bar/row showing a stale
      // span for work that no longer exists, until an unrelated edit re-triggers a rollup.
      return {...d, projects: {...d.projects, [d.aPid]: {...proj, tasks: renumberTasks(recomputeAfterStructureChange(proj.tasks.filter(t => !del.has(t.id))))}}};
    });
    notifyRowsDeleted(rowCount, totalCount);
  }, []);

  // Ids of every task in the current FULL-ROW selection (made by ID-column
  // click / drag / shift-click — the range spans all columns). Returns an
  // empty array when the selection isn't full-row, so callers fall back to
  // single-task behavior.
  const fullRowSelIds = () => {
    if (!selRange) return [];
    const lastColIdx = activeEffectiveCols(dataRef.current).length - 1;
    // B2530690 — with several ranges, the rows of ALL of them, but only when every one is a full-width row
    // selection (a cell range among them is a "clear contents" selection, not a "delete rows" one).
    if (!rangesOf(selRange).every(g => g.c1 === 0 && g.c2 === lastColIdx)) return [];
    const ft = flatTasksRef.current || [];
    return selRowsOf(selRange, ft.length - 1).map(r => ft[r].id);
  };

  // Ids of every task in the current row selection, regardless of which COLUMNS it spans.
  // Indent/outdent are row-level structural moves, never ambiguous with "clear cell content" the
  // way keyboard Delete is (fullRowSelIds' full-column requirement exists only to make THAT
  // distinction) — so a drag/shift-click selection made by dragging across the Name column (not
  // the ID column) still moves the whole block. Returns [] for a single row or no selection at
  // all, so callers fall back to [selectedId] exactly as before this existed.
  const rowRangeSelIds = () => {
    if (!selRange) return [];
    const ft = flatTasksRef.current || [];
    const rows = selRowsOf(selRange, ft.length - 1);   // B2530690 — every range's rows (copy / cut take all of them)
    if (rows.length <= 1) return [];
    return rows.map(r => ft[r].id);
  };

  // Resolve "the ids a structural op (indent/outdent/delete) should act on" for a caller that
  // has a definite anchor task (the right-clicked row, or the keyboard selection) — the row range
  // when the anchor is part of one, else just the anchor alone. One shared rule for both entry
  // points so they can never again diverge into "acts on the whole selection" vs "acts on one row."
  const structuralTargets = (anchorId) => {
    const ids = rowRangeSelIds();
    return ids.length > 1 && ids.includes(anchorId) ? ids : [anchorId];
  };
  // B2530690 — indent / outdent / "Move to…" / drag-reorder are built on ONE contiguous block of rows (see the
  // header of indentSelection). With several ranges selected they refuse, out loud — never act on part of the
  // selection or on none of it in silence. Returns null when refused.
  const blockOnlyTargets = (anchorId) => {
    if (isMulti(selRange)) { showToast(MULTI_SELECTION_MESSAGE, { type: "warn" }); return null; }
    return structuralTargets(anchorId);
  };

  // ── Delete-with-children: ask, never silently cascade or silently promote ──────────────────
  // Owner correction (verbatim): "maybe it should delete all the subtasks... or allow all subtasks
  // to get migrated to the next task above" — followed by "don't give me a menu, just... an option
  // to delete all subtasks with it or allow subtasks to get migrated." A row with NO children is
  // untouched by this — deletes immediately, exactly as before, no prompt, no extra click.
  const requestDelete = useCallback((taskIds) => {
    if (!taskIds || taskIds.length === 0) return;
    const pid = dataRef.current?.aPid;
    const all = dataRef.current?.projects?.[pid]?.tasks || [];
    const hasAnyChildren = taskIds.some(id => all.some(t => t.parentId === id));
    if (!hasAnyChildren) {
      // No subtasks anywhere in this selection — delete immediately, no prompt, no extra click,
      // exactly as before this existed.
      deleteTasks(taskIds);
      setSelectedId(null); setSelRange(null);
      return;
    }
    // The TRUE total, including any collapsed/hidden descendants — the number that matters on a
    // real schedule is how much is actually being removed, not how many rows happen to be
    // rendered when the prompt appears. Selection is left alone here so Cancel leaves it intact;
    // the modal's own choice handlers clear it once a delete actually happens.
    const del = new Set();
    const mark = id => { del.add(id); all.filter(t => t.parentId === id).forEach(t => mark(t.id)); };
    taskIds.forEach(mark);
    setDeleteChoice({ ids: taskIds, rowCount: taskIds.length, totalCount: del.size });
  }, [deleteTasks]);

  const promoteAndDeleteTasks = useCallback((taskIds) => {
    setData(d => {
      const pid = d.aPid;
      const proj = d.projects[pid];
      if (!proj) return d;
      const newTasks = promoteChildrenAndDelete(proj.tasks, taskIds);
      return {...d, projects: {...d.projects, [pid]: {...proj, tasks: renumberTasks(recomputeAfterStructureChange(newTasks))}}};
    });
    notifyRowsDeleted(taskIds.length, taskIds.length); // exactly these rows go; every child survives, promoted
  }, []);

  // ── Formatting scope (row vs cell) ────────────────────────
  // The right-click menu's format toolbar targets whatever was selected when
  // it opened: a full-row selection containing the clicked row formats the
  // row(s) — task-level bold/italic/rowColor, the original behavior — while
  // any other selection formats just the selected cell(s) via per-cell
  // entries stored on the task as cellFmt: { [colKey]: {bold, italic, fill} }.
  const fmtTargets = () => {
    const rowIds = fullRowSelIds();
    if (rowIds.length && taskCtx && rowIds.includes(taskCtx.task.id)) return {mode: 'row', ids: rowIds};
    const ft = flatTasksRef.current || [];
    const cells = [];
    if (selRange && ft.length) {
      const eff = activeEffectiveCols(dataRef.current);
      // B2530690 — every cell of every range (one format pass, one undo step)
      for (const {r, c} of cellsOf(selRange)) { const ck = eff[c]?.k; if (ck && ft[r]) cells.push({taskId: ft[r].id, colKey: ck}); }
    } else if (taskCtx) {
      cells.push({taskId: taskCtx.task.id, colKey: activeEffectiveCols(dataRef.current)[selectedColIdx]?.k || 'name'});
    }
    return {mode: 'cell', cells};
  };

  // Merge a format patch ({bold}/{italic}/{fill}/{underline}/{color}/{size}, or clearAll) into
  // the current targets in ONE data pass (one undo step), then patch the open menu's task
  // snapshot so its toolbar indicators update live.
  // NEW-2 (chat, 2026-09-11) — underline/color(text)/size ride the exact same patch/merge/prune
  // shape bold/italic/fill already use: a row-level field on the task, a per-cell entry inside
  // cellFmt[colKey], pruned back out the moment an entry has nothing truthy left in it.
  const applyFormatAndSync = (patch, {clearAll = false} = {}) => {
    const tgt = fmtTargets();
    const pid = taskCtx?.projId ?? dataRef.current?.aPid;
    const mergeCell = (entry) => {
      const e = {...(entry || {})};
      if ('bold' in patch) e.bold = patch.bold;
      if ('italic' in patch) e.italic = patch.italic;
      if ('fill' in patch) e.fill = patch.fill;
      if ('underline' in patch) e.underline = patch.underline;
      if ('color' in patch) e.color = patch.color;
      if ('size' in patch) e.size = patch.size;
      return (e.bold || e.italic || e.fill || e.underline || e.color || e.size) ? e : null; // prune empty entries
    };
    setData(d => {
      const proj = d.projects[pid]; if (!proj) return d;
      let tasks;
      if (tgt.mode === 'row') {
        const idset = new Set(tgt.ids);
        tasks = proj.tasks.map(t => {
          if (!idset.has(t.id)) return t;
          if (clearAll) { const {cellFmt: _cellFmt, ...rest} = t; return {...rest, rowColor: null, bold: false, italic: false, underline: false, textColor: null, fontSize: null}; }
          const u = {...t};
          if ('bold' in patch) u.bold = patch.bold;
          if ('italic' in patch) u.italic = patch.italic;
          if ('fill' in patch) u.rowColor = patch.fill;
          if ('underline' in patch) u.underline = patch.underline;
          if ('color' in patch) u.textColor = patch.color;
          if ('size' in patch) u.fontSize = patch.size;
          return u;
        });
      } else {
        const byTask = {};
        tgt.cells.forEach(({taskId, colKey}) => { (byTask[taskId] = byTask[taskId] || []).push(colKey); });
        tasks = proj.tasks.map(t => {
          const cols = byTask[t.id]; if (!cols) return t;
          const cf = {...(t.cellFmt || {})};
          cols.forEach(k => {
            const e = clearAll ? null : mergeCell(cf[k]);
            if (e) cf[k] = e; else delete cf[k];
          });
          if (Object.keys(cf).length) return {...t, cellFmt: cf};
          const {cellFmt: _cellFmt, ...rest} = t; return rest;
        });
      }
      return {...d, projects: {...d.projects, [pid]: {...proj, tasks}}};
    });
    setTaskCtx(c => {
      if (!c) return c;
      const t = {...c.task};
      if (tgt.mode === 'row') {
        if (clearAll) { t.rowColor = null; t.bold = false; t.italic = false; t.underline = false; t.textColor = null; t.fontSize = null; delete t.cellFmt; }
        else {
          if ('bold' in patch) t.bold = patch.bold;
          if ('italic' in patch) t.italic = patch.italic;
          if ('fill' in patch) t.rowColor = patch.fill;
          if ('underline' in patch) t.underline = patch.underline;
          if ('color' in patch) t.textColor = patch.color;
          if ('size' in patch) t.fontSize = patch.size;
        }
      } else {
        const key = activeEffectiveCols(dataRef.current)[selectedColIdx]?.k || 'name';
        const cf = {...(t.cellFmt || {})};
        const e = clearAll ? null : mergeCell(cf[key]);
        if (e) cf[key] = e; else delete cf[key];
        if (Object.keys(cf).length) t.cellFmt = cf; else delete t.cellFmt;
      }
      return {...c, task: t};
    });
  };

  // Toolbar state for the open context menu: which indicators light up, what
  // the eraser may clear, and a small scope label ("Cell", "Row", "3 rows"…).
  // In cell mode the eraser only clears cell formats — row-level formatting
  // is cleared by selecting the row (ID column) and erasing there.
  // NEW-2 — `size` additionally reports the sentinel 'mixed' rather than any one selected cell's/
  // row's number when the targets disagree, so the toolbar's size box can show blank instead of
  // a wrong number (item (e)); `count`/`unit` feed the toolbar's plain "N cell(s) SELECTED" readout.
  const ctxFmtState = () => {
    if (!taskCtx) return null;
    const tgt = fmtTargets();
    const ft = flatTasksRef.current || [];
    const oneOrMixed = vals => { const uniq = new Set(vals); return uniq.size <= 1 ? (vals[0] ?? null) : 'mixed'; };
    // NEW-2 — the size the anchor cell/row is ACTUALLY rendering at right now when no explicit
    // override is set, so Grow/Shrink steps off the size the user is looking at rather than a
    // flat guess. Without this, "Grow" on a never-formatted level-0 task name (which already
    // renders at 13) silently no-ops on its first click, because the LEVEL_SIZES table below is
    // the exact one `Cell()`'s name-column case already uses for its own default.
    const LEVEL_SIZES = [13, 12, 11.5, 11];
    const naturalSizeOf = (task, colKey) => colKey === 'name' ? LEVEL_SIZES[Math.min(task?.level || 0, 3)] : 12;
    if (tgt.mode === 'row') {
      const t = taskCtx.task;
      const sizes = tgt.ids.map(id => (id === t.id ? t : ft.find(x => x.id === id))?.fontSize ?? null);
      return {mode: 'row', bold: !!t.bold, italic: !!t.italic, underline: !!t.underline,
        fill: t.rowColor || null, color: t.textColor || null, size: oneOrMixed(sizes), naturalSize: naturalSizeOf(t, 'name'),
        hasAny: !!(t.bold || t.italic || t.underline || t.rowColor || t.textColor || t.fontSize || (t.cellFmt && Object.keys(t.cellFmt).length)),
        count: tgt.ids.length || 1, unit: tgt.ids.length > 1 ? 'rows' : 'row',
        scopeLabel: tgt.ids.length > 1 ? `${tgt.ids.length} rows` : 'Row'};
    }
    const key = activeEffectiveCols(dataRef.current)[selectedColIdx]?.k || 'name';
    const e = taskCtx.task.cellFmt?.[key] || {};
    // NEW-2 — the anchor cell (taskCtx.task / key) reads its OWN just-applied cellFmt straight
    // off the live taskCtx snapshot, same as `e` above — never off `ft` (flatTasksRef), which is
    // a ref refreshed in an effect AFTER commit and so is one render stale right after a format
    // click. `ft` is still right for every OTHER cell in a multi-cell selection, which is the
    // only reason this can't just read `e` for everything. Missing this for `size` alone (while
    // bold/italic/fill/underline/color already read `e`) is exactly what produced a size box
    // that lagged one click behind the cell it was editing — caught live in this session by
    // growing text twice in one open toolbar and diffing the box against the painted cell.
    const cellFmtOf = (taskId, colKey) => (taskId === taskCtx.task.id && colKey === key) ? e : (ft.find(x => x.id === taskId)?.cellFmt?.[colKey]);
    const hasAny = tgt.cells.some(({taskId, colKey}) => {
      const f = cellFmtOf(taskId, colKey);
      return !!(f && (f.bold || f.italic || f.underline || f.fill || f.color || f.size));
    });
    const sizes = tgt.cells.map(({taskId, colKey}) => cellFmtOf(taskId, colKey)?.size ?? null);
    return {mode: 'cell', bold: !!e.bold, italic: !!e.italic, underline: !!e.underline,
      fill: e.fill || null, color: e.color || null, size: oneOrMixed(sizes), naturalSize: naturalSizeOf(taskCtx.task, key), hasAny,
      count: tgt.cells.length || 1, unit: tgt.cells.length > 1 ? 'cells' : 'cell',
      scopeLabel: tgt.cells.length > 1 ? `${tgt.cells.length} cells` : 'Cell'};
  };

  // NEW-1 (B1638832) — set by goToTask (a person clicking a row's "Open row in <project>" link, or any
  // other in-embed jump); consumed by the nav-state emit effect below so the shell can tell a deliberate
  // jump from the embed merely RE-ANNOUNCING where it already was. Never set by a shell message.
  const rowJumpRef = useRef(false);
  // ── Jump to a task's row from anywhere (dashboard, modals) ──
  // Expands any collapsed ancestors (a hidden row can't be scrolled to),
  // switches to the task's project, and hands GridView a goToFocus token so it
  // scrolls the row into a comfortable position and pulses it on landing.
  // Gantt-only view flips to split, since there's no grid row to land on.
  const goToTask = useCallback((pid, taskId) => {
    rowJumpRef.current = true; // NEW-1 (B1638832) — the next nav-state announcement carries `rowLink` (see the emit effect)
    setData(d => {
      const proj = d.projects[pid];
      if (!proj) return d;
      const byId = {};
      proj.tasks.forEach(t => { byId[t.id] = t; });
      const toExpand = new Set();
      let p = byId[taskId]?.parentId;
      while (p != null && byId[p]) { toExpand.add(p); p = byId[p].parentId; }
      const needsExpand = [...toExpand].some(id => !byId[id].isExpanded);
      const tasks = needsExpand
        ? proj.tasks.map(t => toExpand.has(t.id) && !t.isExpanded ? {...t, isExpanded: true} : t)
        : proj.tasks;
      return {...d, section: 'projects', aPid: pid,
        view: d.view === 'gantt' ? 'split' : d.view,
        projects: {...d.projects, [pid]: {...proj, tasks}}};
    });
    setSelectedId(taskId);
    setSelectedColIdx(0);
    setSelRange(null);
    setGoToFocus({taskId, n: Date.now()}); // fresh token each jump, even to the same row
  }, []);

  // Reveal a freshly-inserted row Excel-style: select it (no edit field — typing a letter
  // begins editing, exactly like a spreadsheet) and let the existing select→scroll effect
  // bring it into view. Each insert expands & un-spotlights the new row's ancestors inside
  // its (pure) data update so the row can never land hidden; revealRef carries the
  // post-renumber id out, and rAF applies the selection after the commit.
  const revealRef = useRef(null);
  const openNameEditOnReveal = useRef(false);
  const revealInserted = useCallback(() => {
    const shouldOpenEdit = openNameEditOnReveal.current;
    openNameEditOnReveal.current = false;
    requestAnimationFrame(() => {
      const id = revealRef.current; revealRef.current = null;
      if (id == null) return;
      setSelectedId(id); setSelRange(null);
      const ni = COLS.findIndex(c => c.k === "name");
      if (ni >= 0) setSelectedColIdx(ni);
      if (shouldOpenEdit) {
        requestAnimationFrame(() => setEdit({taskId: id, col: "name"}));
      }
    });
  }, []);

  const addTask = useCallback(() => {
    setData(d => {
      const pid = d.aPid;
      // Collision-proof id: nTid can go stale (paste/duplicate grow the task
      // count without bumping it, and load-time renumbering compacts ids to
      // 1..n) — and a duplicate id poisons renumberTasks' remap table,
      // scrambling parent links. Always allocate above every existing id.
      const maxId = Math.max(0, ...d.projects[pid].tasks.map(t=>t.id));
      const id = Math.max(d.nTid[pid] ?? 1, maxId + 1);
      // Inherit parentId from the last task in visual order (same rule as insertTask)
      const visualOrder = sortByVisualOrder(d.projects[pid].tasks);
      const lastTask = visualOrder.length > 0 ? visualOrder[visualOrder.length - 1] : null;
      const newParentId = lastTask ? lastTask.parentId : null;
      const task = mkt(id, "", "", "", newParentId);
      let tasks = [...d.projects[pid].tasks, task];
      // expand & un-spotlight ancestors so the new row can't be hidden
      const anc = new Set(); { let p = newParentId; while (p != null) { anc.add(p); const par = tasks.find(t => t.id === p); p = par ? par.parentId : null; } }
      if (anc.size) tasks = tasks.map(t => anc.has(t.id) ? {...t, isExpanded: true, focused: t.id === newParentId ? false : t.focused} : t);
      const finalArr = sortByVisualOrder(tasks);
      revealRef.current = finalArr.indexOf(task) + 1;
      return {...d, nTid: {...d.nTid, [pid]: id+1}, projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(finalArr)}}};
    });
    revealInserted();
  }, []);

  const deleteTask = useCallback((taskId) => {
    setData(d => {
      const pid = d.aPid;
      const del = new Set();
      const mark = id => { del.add(id); d.projects[pid].tasks.filter(t => t.parentId === id).forEach(t => mark(t.id)); };
      mark(taskId);
      // B501: recompute roll-ups/cascade after removal (see deleteTasks) so a deleted child
      // doesn't leave its parent summary span stale until the next unrelated edit.
      return {...d, projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(recomputeAfterStructureChange(d.projects[pid].tasks.filter(t => !del.has(t.id))))}}};
    });
    if (selectedId === taskId) setSelectedId(null);
  }, [selectedId]);

  // NEW-1 — the one insert-above path (Insert key + context menu). Never touches isExpanded / focused:
  // the new row is pinned visible past its parent's Focus filter instead (focusPinsRef, by _sid), so the
  // rows Focus hides stay hidden and the row just added doesn't vanish into them.
  const insertAboveAnchor = useCallback((anchorId) => {
    const visibleIds = (flatTasksRef.current || []).map(t => t.id);
    const sid = _mintTaskSid();
    setData(d => {
      const pid = d.aPid;
      const newTask = { ...mkt(0, "", "", "", null), _sid: sid };
      const tasks = insertRowAbove(d.projects[pid].tasks, visibleIds, anchorId, newTask);
      const finalArr = sortByVisualOrder(tasks);
      revealRef.current = finalArr.findIndex(t => t._sid === sid) + 1;
      return { ...d, projects: { ...d.projects, [pid]: { ...d.projects[pid], tasks: renumberTasks(finalArr) } } };
    });
    setFocusPins(p => { const n = new Set(p); n.add(sid); return n; });
    revealInserted();
  }, []);

  // NEW-1 — Insert key: a new row directly above the selection in the VISIBLE order (Excel / MS Project
  // parity), with no Focus filter or collapsed subtree opened. All positioning is insertRowAbove (pure,
  // shared with the context menu's insertTaskAbove). A multi-row selection inserts ONE row above its top.
  const insertTask = useCallback(() => {
    const flat = flatTasksRef.current || [];
    let anchorId = selectedId;
    if (isMulti(selRange)) { showToast(MULTI_SELECTION_MESSAGE, { type: "warn" }); return; }   // B2530690
    if (selRange && selRange.r1 !== selRange.r2) {
      const top = flat[Math.min(selRange.r1, selRange.r2)];
      if (top) anchorId = top.id;
    }
    insertAboveAnchor(anchorId);
  }, [selectedId, selRange]);

  // (indentTask/outdentTask removed — the keyboard handler now calls the identical
  //  indentSelectionByIds/outdentSelectionByIds helpers below with the resolved selection. B255,
  //  extended to whole-selection scope by B<NEW> — see structuralTargets/rowRangeSelIds.)

  const insertTaskBelow = useCallback((taskId) => {
    setData(d => {
      const pid = d.aPid;
      const rawTasks = d.projects[pid].tasks;
      const flatOrder = [];
      const walk = (parentId) => {
        rawTasks.filter(t => t.parentId === parentId).forEach(t => {
          flatOrder.push(t);
          if (t.isExpanded) walk(t.id);
        });
      };
      walk(null);
      const flatIdx = taskId !== null ? flatOrder.findIndex(t => t.id === taskId) : flatOrder.length - 1;
      const targetTask = flatIdx >= 0 ? flatOrder[flatIdx] : null;
      const newParentId = targetTask ? targetTask.parentId : null;
      // New tasks start blank (see insertTask)
      const newTask = mkt(0, "", "", "", newParentId);
      let tasks = [...rawTasks];
      if (!targetTask) { tasks.push(newTask); }
      else { const rawIdx = tasks.findIndex(t => t.id === targetTask.id); tasks.splice(rawIdx + 1, 0, newTask); }
      const anc = new Set(); { let p = newParentId; while (p != null) { anc.add(p); const par = tasks.find(t => t.id === p); p = par ? par.parentId : null; } }
      if (anc.size) tasks = tasks.map(t => anc.has(t.id) ? {...t, isExpanded: true, focused: t.id === newParentId ? false : t.focused} : t);
      revealRef.current = tasks.indexOf(newTask) + 1;
      return { ...d, projects: { ...d.projects, [pid]: { ...d.projects[pid], tasks: renumberTasks(tasks) } } };
    });
    revealInserted();
  }, []);

  // insertTaskAbove: takes taskId directly to avoid stale-closure bug in context menu
  // (context menu called setSelectedId + insertTask() but state update is async,
  //  so insertTask() always saw the old selectedId — not the right-clicked row)
  const insertTaskAbove = useCallback((taskId) => { insertAboveAnchor(taskId); }, []);

  // Deadline row: a milestone spliced directly above its bound anchor, linked via deadlineForTaskId
  // so the cascade post-pass keeps it on the anchor's call/file-by date forever. The link is set with
  // the anchor's PRE-renumber id — renumberTasks remaps it alongside parentId/predecessors.
  const addDeadlineTask = useCallback((anchorId, projId = null) => {
    setData(d => {
      const pid = projId ?? d.aPid;
      const proj = d.projects[pid];
      if (!proj) return d;
      const rawTasks = proj.tasks || [];
      const anchor = rawTasks.find(t => t.id === anchorId);
      if (!anchor || !anchor.meetingBound) return d;
      const body = MEETING_BODY_INDEX[anchor.meetingBodyId];
      const newTask = { ...mkt(0, `Deadline — ${(body && body.name) || "meeting"}`, "", "", anchor.parentId), deadlineForTaskId: anchor.id };
      const tasks = [...rawTasks];
      const rawIdx = tasks.findIndex(t => t.id === anchorId);
      if (rawIdx === -1) tasks.push(newTask); else tasks.splice(rawIdx, 0, newTask);
      // Cascade BEFORE renumber (ids still match the link), so the row lands already dated.
      return { ...d, projects: { ...d.projects, [pid]: { ...proj, tasks: renumberTasks(recomputeAfterStructureChange(tasks)) } } };
    });
  }, []);

  const addSubtask = useCallback((taskId) => {
    setData(d => {
      const pid = d.aPid;
      // Same collision guard as addTask — never trust a stale nTid
      const maxId = Math.max(0, ...d.projects[pid].tasks.map(t=>t.id));
      const id = Math.max(d.nTid[pid] ?? 1, maxId + 1);
      // New tasks start blank (see insertTask)
      const task = mkt(id, "", "", "", taskId);
      let tasks = [...d.projects[pid].tasks, task];
      // expand & un-spotlight the parent and every ancestor so the new child can't be hidden
      const anc = new Set([taskId]); { let p = taskId; while (p != null) { const par = tasks.find(t => t.id === p); p = par ? par.parentId : null; if (p != null) anc.add(p); } }
      tasks = tasks.map(t => anc.has(t.id) ? {...t, isExpanded: true, focused: t.id === taskId ? false : t.focused} : t);
      revealRef.current = id;
      return {...d, nTid: {...d.nTid, [pid]: id+1}, projects: {...d.projects, [pid]: {...d.projects[pid], tasks}}};
    });
    revealInserted();
  }, []);

  const duplicateTask = useCallback((taskId) => {
    setData(d => {
      const pid = d.aPid;
      const tasks = d.projects[pid].tasks;
      const src = tasks.find(t => t.id === taskId);
      if (!src) return d;
      // Same collision guard as addTask — never trust a stale nTid
      const nid = Math.max(d.nTid[pid] ?? 1, Math.max(0, ...tasks.map(t=>t.id)) + 1);
      // NEW-1 — a duplicate is a genuinely NEW task, not a continuation of `src`; give it its own
      // _sid rather than inheriting src's (spreading `...src` would otherwise carry src's _sid
      // straight onto the copy, and the diff/merge machinery would then see one identity claiming
      // to be two different rows).
      const copy = {...src, id: nid, _sid: _mintTaskSid(), name: src.name + " (Copy)", notes: src.notes.map(n => ({...n}))};
      const srcIdx = tasks.findIndex(t => t.id === taskId);
      let newTasks = [...tasks];
      newTasks.splice(srcIdx + 1, 0, copy);
      const anc = new Set(); { let p = copy.parentId; while (p != null) { anc.add(p); const par = newTasks.find(t => t.id === p); p = par ? par.parentId : null; } }
      if (anc.size) newTasks = newTasks.map(t => anc.has(t.id) ? {...t, isExpanded: true, focused: t.id === copy.parentId ? false : t.focused} : t);
      revealRef.current = newTasks.indexOf(copy) + 1;
      return {...d, nTid: {...d.nTid, [pid]: nid+1}, projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(newTasks)}}};
    });
    revealInserted();
  }, []);

  // ─── Task clipboard (Ctrl+C / Ctrl+X / Ctrl+V) ──────────────────────────────
  // Collects the task + every descendant as a deep-copied subtree so children come
  // along with their parent. Copies preserve formatting (rowColor/bold/italic),
  // predecessors, dates, notes — everything. Stored in clipboardRef so the global
  // keydown handler reads fresh state without re-binding on every change.
  //
  // NEW-ROWMOVE — MEASURED (see the harness/backlog writeup for the full per-surface table): before
  // this change, all three of copy/cut/paste operated on `selectedId` ALONE — the drag/shift-click
  // ANCHOR row — and silently ignored every other row in an active multi-row `selRange`. A 6-row
  // selection copied exactly 1 row's subtree, with no error and no indication anything was dropped;
  // paste then inserted only that one subtree. Fixed the same way as indent/outdent/delete: every
  // entry point now resolves the WHOLE selection via structuralTargets first (taskIds, plural) and
  // collectSubtreeFor runs once per ROOT id in that selection (a selected parent + its own selected
  // child collect once, as one subtree — not twice — via rootsOfSelection, the same "root = parent
  // not itself selected" rule indentSelection uses).
  const collectSubtreeFor = (rootId, allTasks) => {
    const out = [];
    const walk = id => {
      const t = allTasks.find(x => x.id === id);
      if (!t) return;
      out.push({...t, notes: (t.notes||[]).map(n => ({...n})), predecessors: (t.predecessors||[]).map(p => ({...p})), ...(Array.isArray(t.icons) ? {icons: [...t.icons]} : {})});   // NEW-1 — icons travel with a copied/pasted row
      allTasks.filter(x => x.parentId === id).forEach(c => walk(c.id));
    };
    walk(rootId);
    return out;
  };
  const rootsOfSelection = (taskIds, allTasks) => {
    const idSet = new Set(taskIds);
    const byId = new Map(allTasks.map(t => [t.id, t]));
    return taskIds.filter(id => byId.has(id) && !idSet.has(byId.get(id).parentId));
  };
  const copyTaskById = useCallback((taskIds) => {
    const ids = Array.isArray(taskIds) ? taskIds : [taskIds];
    const pid = dataRef.current?.aPid;
    const tasks = dataRef.current?.projects?.[pid]?.tasks;
    if (!tasks) return;
    const rootIds = rootsOfSelection(ids, tasks);
    const subtree = rootIds.flatMap(id => collectSubtreeFor(id, tasks));
    if (subtree.length === 0) return;
    clipboardRef.current = { mode: "copy", tasks: subtree, sourceProjId: pid, sourceRootIds: rootIds };
    setClipboardTick(t => t + 1);
    const extra = subtree.length - rootIds.length;
    const label = rootIds.length > 1 ? `${rootIds.length} tasks` : `“${subtree[0].name || "task"}”`;
    showToast(`Copied ${label}${extra > 0 ? ` + ${extra} subtask${extra > 1 ? "s" : ""}` : ""}`, { duration: 1800 });
  }, []);
  const cutTaskById = useCallback((taskIds) => {
    const ids = Array.isArray(taskIds) ? taskIds : [taskIds];
    const pid = dataRef.current?.aPid;
    const tasks = dataRef.current?.projects?.[pid]?.tasks;
    if (!tasks) return;
    const rootIds = rootsOfSelection(ids, tasks);
    const subtree = rootIds.flatMap(id => collectSubtreeFor(id, tasks));
    if (subtree.length === 0) return;
    clipboardRef.current = { mode: "cut", tasks: subtree, sourceProjId: pid, sourceRootIds: rootIds };
    setClipboardTick(t => t + 1);
    const extra = subtree.length - rootIds.length;
    const label = rootIds.length > 1 ? `${rootIds.length} tasks` : `“${subtree[0].name || "task"}”`;
    showToast(`Cut ${label}${extra > 0 ? ` + ${extra} subtask${extra > 1 ? "s" : ""}` : ""} — paste to move`, { duration: 1800 });
  }, []);
  const pasteTaskAfter = useCallback((targetId) => {
    const cb = clipboardRef.current;
    if (!cb || targetId == null) return;
    // NEW-4/B1080548 — cross-schedule paste (copy in one project, paste into another; the same
    // clipboard already supports this, since `pid` below is read fresh at paste time, not pinned
    // to the source). Precompute the "how many links can't survive" figure the same way `n` below
    // already is — from `cb` alone, before setData — so the toast can report it without depending
    // on updater-timing. A predecessor whose id is in the pasted set is INTERNAL and always
    // survives (remapped below); one that isn't is EXTERNAL — it points at a task left behind in
    // the source schedule. Same-project, that raw id still resolves to a real task and is kept
    // (unchanged from before). Cross-project it CANNOT survive: the destination has its own,
    // unrelated id space, so keeping the raw id risks silently rewiring onto whatever task happens
    // to share that number there — exactly the danger the owner flagged. Drop it instead, and say
    // so, rather than leaving that failure to renumberTasks' silent id-doesn't-exist prune.
    const pastedOldIds = new Set(cb.tasks.map(t => t.id));
    const crossProjectPaste = cb.sourceProjId !== dataRef.current?.aPid;
    const droppedLinkCount = crossProjectPaste
      ? cb.tasks.reduce((n, t) => n + (t.predecessors || []).filter(p => p && !pastedOldIds.has(p.id)).length, 0)
      : 0;
    setData(d => {
      const pid = d.aPid;
      const tasks = d.projects[pid].tasks;
      const target = tasks.find(t => t.id === targetId);
      if (!target) return d;

      // Remap old subtree IDs to a temporary high range so they can't collide with
      // existing IDs; sortByVisualOrder + renumberTasks below normalizes back to 1..N.
      const baseTempId = Math.max(0, ...tasks.map(t => t.id)) + 1000;
      const idMap = {};
      cb.tasks.forEach((t, i) => { idMap[t.id] = baseTempId + i; });

      const crossProject = cb.sourceProjId !== pid;
      const rootOldIds = new Set(cb.sourceRootIds || [cb.sourceRootId]); // sourceRootId: back-compat for a clipboard filled before this change
      // NEW-1 — cut+paste is a MOVE (the same logical task, new position): keep its _sid so a
      // diff/merge recognizes it as unchanged rather than "deleted here, added there". Copy+paste
      // duplicates it into a genuinely new row and must never carry the source's _sid onto it (the
      // clipboard's deep-copy in collectSubtreeFor preserves `_sid` from the live source, so this is
      // the one place a copy-mode paste has to explicitly override it).
      const pasted = cb.tasks.map(t => ({
        ...t,
        id: idMap[t.id],
        _sid: cb.mode === "cut" ? t._sid : _mintTaskSid(),
        // Each subtree's own root becomes a sibling of the target (same parent), in the SAME
        // relative order they were selected in; inner tasks keep their parent inside their own
        // subtree (remapped to the new IDs).
        parentId: rootOldIds.has(t.id) ? target.parentId : (idMap[t.parentId] ?? null),
        // Predecessor rewiring: internal (within the pasted subtree) → new ID, always. External
        // (points outside the subtree) → same-project, keep the original ID (it still resolves to
        // a real task there); cross-project, DROP it — the id space is unrelated in the
        // destination and keeping it risks silently rewiring onto an unrelated task that happens
        // to share that number (NEW-4/B1080548). renumberTasks below still prunes anything left
        // dangling for any other reason, as a backstop.
        predecessors: (t.predecessors || [])
          .map(p => (idMap[p.id] != null ? { ...p, id: idMap[p.id] } : (crossProject ? null : p)))
          .filter(Boolean),
      }));

      // Insert right after the target row in raw array order; sortByVisualOrder will
      // produce the correct visual ordering (target's whole subtree first, then pasted).
      const result = [...tasks];
      const targetIdx = result.findIndex(t => t.id === target.id);
      result.splice(targetIdx + 1, 0, ...pasted);

      // Cut: delete the source subtree from this project (move semantics). On copy mode,
      // the source stays. Cross-project cut is also handled (only delete if same project).
      let final = result;
      if (cb.mode === "cut" && cb.sourceProjId === pid) {
        const sourceIds = new Set(cb.tasks.map(t => t.id));
        // Move semantics: the source subtree is removed under its OLD ids and re-inserted under
        // new ids. Any OTHER task that depended on a moved task still points at its old id, which
        // no longer exists → renumberTasks would silently drop that dependency. Rewire every
        // remaining task's predecessors from the old subtree ids to the new ones (idMap). Pasted
        // tasks already carry new ids (not keys in idMap → unchanged); external preds are unchanged.
        final = result.filter(t => !sourceIds.has(t.id))
          .map(t => ({ ...t, predecessors: (t.predecessors || []).map(p => (p && idMap[p.id] !== undefined ? { ...p, id: idMap[p.id] } : p)) }));
      }

      // Normalize ordering/IDs, and record where the pasted root landed so we can select it.
      // recomputeAfterStructureChange refreshes parent roll-ups for the new placement (it
      // preserves array order + ids, so the rootIdx lookup below stays valid).
      const sorted = recomputeAfterStructureChange(sortByVisualOrder(final));
      const firstRootOldId = (cb.sourceRootIds || [cb.sourceRootId])[0];
      const rootTempId = idMap[firstRootOldId];
      const rootIdx = sorted.findIndex(t => t.id === rootTempId);
      pasteSelectRef.current = rootIdx >= 0 ? rootIdx + 1 : null; // renumberTasks assigns id = index + 1 — selects the FIRST pasted root

      return {
        ...d,
        projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(sorted)}}
      };
    });
    const n = cb.tasks.length;
    // NEW-4/B1080548 — LOUD-FAILURE: a paste that silently lost dependency logic is worse than one
    // that was refused outright, so say exactly how many links didn't survive rather than leaving
    // it to be discovered later as a schedule that "looks pasted" but doesn't cascade right.
    const dropMsg = droppedLinkCount > 0
      ? ` — ${droppedLinkCount} link${droppedLinkCount > 1 ? "s" : ""} to ${droppedLinkCount > 1 ? "tasks" : "a task"} left in the source schedule ${droppedLinkCount > 1 ? "were" : "was"} dropped`
      : "";
    showToast(`Pasted ${n} task${n > 1 ? "s" : ""}${dropMsg}`, { duration: droppedLinkCount > 0 ? 5000 : 1600 });
    // Cut is one-shot (move semantics); copy stays in the clipboard for repeated pastes.
    if (cb.mode === "cut") { clipboardRef.current = null; setClipboardTick(t => t + 1); }
  }, []);

  // After a paste commits, select the pasted root so it highlights and the grid scrolls to it.
  useEffect(() => {
    if (pasteSelectRef.current == null) return;
    const id = pasteSelectRef.current;
    pasteSelectRef.current = null;
    setSelectedId(id);
    setSelRange(null);
    setSelectedColIdx(1);
  }, [data]);

  // B<NEW> — both entry points (Alt+Shift+Right/Left and the right-click menu) now resolve the
  // FULL selected row range first (see rowRangeSelIds below) and pass every id through in one
  // batch — one setData call, one undo step, one recompute, matching the pre-existing single-row
  // behaviour exactly when the selection is just one row. The tree-mutation itself lives in the
  // pure indentSelection/outdentSelection above so it can be exercised without a live DOM.
  const indentSelectionByIds = useCallback((taskIds) => {
    setData(d => {
      const pid = d.aPid;
      const newTasks = indentSelection(d.projects[pid].tasks, taskIds);
      if (!newTasks) return d;
      return {...d, projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(recomputeAfterStructureChange(sortByVisualOrder(newTasks)))}}};
    });
  }, []);

  const outdentSelectionByIds = useCallback((taskIds) => {
    setData(d => {
      const pid = d.aPid;
      const newTasks = outdentSelection(d.projects[pid].tasks, taskIds);
      if (!newTasks) return d;
      return {...d, projects: {...d.projects, [pid]: {...d.projects[pid], tasks: renumberTasks(recomputeAfterStructureChange(sortByVisualOrder(newTasks)))}}};
    });
  }, []);

  // NEW-ROWMOVE — the single commit point for BOTH the drag-and-drop row reorder (GridView's
  // rowgrip drag) and the "Move to…" command: one setData call, one recompute, so ONE undo step
  // covers the whole gesture regardless of how many rows moved or how far. taskIds is resolved by
  // the CALLER via structuralTargets(anchorId) (see shared.moveRows below), exactly like
  // indentSelectionByIds/outdentSelectionByIds already resolve their targets before calling in.
  const moveSelectionByIds = useCallback((taskIds, destParentId, insertAfterId) => {
    setData(d => {
      const pid = d.aPid;
      const proj = d.projects[pid];
      if (!proj) return d;
      const newTasks = moveSelectionToDestination(proj.tasks, taskIds, destParentId, insertAfterId);
      if (!newTasks) return d;
      const sorted = sortByVisualOrder(newTasks);
      // Track where the block landed (pre-renumber) so the effect below can restore selection to
      // it — renumberTasks assigns id = index + 1, the same trick pasteSelectRef already uses.
      const byId = new Map(proj.tasks.map(t => [t.id, t]));
      const rootIds = taskIds.filter(id => byId.has(id) && !taskIds.includes(byId.get(id).parentId));
      const firstIdx = rootIds.length ? sorted.findIndex(t => t.id === rootIds[0]) : -1;
      moveSelectRef.current = firstIdx >= 0 ? firstIdx + 1 : null;
      return {...d, projects: {...d.projects, [pid]: {...proj, tasks: renumberTasks(recomputeAfterStructureChange(sorted))}}};
    });
  }, []);

  // After a move commits, select the block's first root so it highlights and the grid scrolls to
  // it — same pattern as the paste-select effect below (search pasteSelectRef).
  useEffect(() => {
    if (moveSelectRef.current == null) return;
    const id = moveSelectRef.current;
    moveSelectRef.current = null;
    setSelectedId(id);
    setSelRange(null);
    setSelectedColIdx(1);
  }, [data]);

  const addProject = useCallback(async (opts) => {
    // opts (optional) = { name, ownerKind, linkedSiteId, linkedSiteName } — used by the
    // cross-module "create a schedule connected to this site" flow. Guard against a click event
    // being passed as the first arg (the in-app + dropdown buttons call addProject() bare).
    const o = (opts && typeof opts === "object" && !("nativeEvent" in opts)) ? opts : {};
    // EVERY SCHEDULE HAS AN OWNER. A bare addProject() — the in-app "+" button, which the shell
    // hides — used to mint a schedule owned by NOTHING; that unowned state is what this model
    // removes, so a bare create now explicitly belongs to the ORGANIZATION (the container the
    // owner asked for: "everything lives under something"), and the shell's own New-schedule
    // flow always passes a real, chosen owner. `ownerKind` is written unconditionally so no
    // path can leave it absent and fall back to inference.
    const ownerKind = o.linkedSiteId != null ? OWNER_KIND_SITE : OWNER_KIND_ORG;

    // B1777120 — once this account is flipped, a schedule's id is a real Postgres identity value,
    // reserved by an actual INSERT before the project is ever added to local state — never a
    // client-guessed `nPid` two tabs could independently mint the same value from (acceptance:
    // "task and project ids cannot collide when two tabs create rows at the same moment"). The
    // row is inserted with a placeholder `data` (no `id` yet — Postgres hasn't assigned one until
    // the INSERT returns) and immediately patched with the real id embedded, so every row this
    // account ever holds still carries `data.id === id`, matching every other read site's
    // assumption. window.storage.insertSchedule seeds scheduleBase/scheduleKnownRev itself so the
    // very next autosave for this schedule is an ordinary guarded UPDATE, not a second insert.
    if (window.storage && window.storage.scheduleRowsAuthoritative) {
      const id = await window.storage.insertSchedule({
        name: o.name || null, ownerKind,
        linkedSiteId: o.linkedSiteId ?? null, linkedSiteName: o.linkedSiteName ?? null,
      });
      if (id == null) {
        if (typeof showToast === "function") showToast("Couldn't create a new schedule — please try again.", { type: "error", duration: 6000 });
        return;
      }
      setData(d => {
        if (!d) return d;
        const proj = { id, name: o.name || `Project ${id}`, tasks: [], ownerKind };
        if (o.linkedSiteId != null) { proj.linkedSiteId = o.linkedSiteId; proj.linkedSiteName = o.linkedSiteName || null; }
        const nd = {...d, nPid: Math.max(d.nPid, id + 1), aPid: id, nTid: {...d.nTid, [id]: 1},
          projects: {...d.projects, [id]: proj}};
        return o.linkedSiteId != null ? withLastActiveSite(nd, o.linkedSiteId, id) : nd;
      });
      return;
    }

    setData(d => {
      if (!d) return d; // B644 — pre-load call: data not loaded yet, nothing to add onto
      const id = d.nPid;
      const proj = {id, name: o.name || `Project ${id}`, tasks: [], ownerKind};
      if (o.linkedSiteId != null) { proj.linkedSiteId = o.linkedSiteId; proj.linkedSiteName = o.linkedSiteName || null; }
      const nd = {...d, nPid: id+1, aPid: id, nTid: {...d.nTid, [id]: 1},
        projects: {...d.projects, [id]: proj}};
      // NEW-1 — a newly-created linked schedule is the one to come back to on this site later.
      return o.linkedSiteId != null ? withLastActiveSite(nd, o.linkedSiteId, id) : nd;
    });
  }, []);

  const renameProject = useCallback((id, name) => {
    // Guard a stale/non-existent id (e.g. a deleted project still in the shell breadcrumb): spreading
    // {...undefined, name} would mint a malformed ghost project (no id, no tasks) that white-screens the
    // schedule when activated. Matches the existence guard nav-link / nav-select already have.
    setData(d => (d && d.projects && d.projects[id]) ? {...d, editProjId: null, projects: {...d.projects, [id]: {...d.projects[id], name}}} : d);
  }, []);

  // Pure: builds the new project object (a copy of `src`) for a chosen `newId`. Split out of
  // duplicateProject so the id-allocation flow (B1777120 — an INSERT-first reservation once
  // flipped) and the legacy client-counter flow can share the exact same copy logic.
  const buildDuplicateProject = (src, newId) => {
    // B816 — RE-ID the copied meeting bodies so the copy's bodies are globally unique. Same-id bodies
    // in two projects would collapse in MEETING_BODY_INDEX → editing one would move the other's hearings.
    const bodyIdMap = {};
    const copiedBodies = Array.isArray(src.meetingBodies) ? src.meetingBodies.map((mb, i) => {
      const copy = copyMeetingBodyWithNewId(mb, i);
      if (mb && mb.id) bodyIdMap[mb.id] = copy.id;
      return copy;
    }) : undefined;
    const newTasks = src.tasks.map(t => ({...t, notes: t.notes.map(n => ({...n})),
      ...(Array.isArray(t.icons) ? {icons: [...t.icons]} : {}),   // NEW-1 — task icons ride along with the copy (a fresh array, not shared)
      ...(t.meetingBodyId && bodyIdMap[t.meetingBodyId] ? {meetingBodyId: bodyIdMap[t.meetingBodyId]} : {})}));
    // Spread ...src so the copy keeps the project's column layout (colConfig), label alignment, and
    // user-defined Formula columns — the old literal dropped all of them. Deep-copy formulaCols so
    // editing the copy can't mutate the original.
    //
    // ⛔ THE COPY KEEPS ITS OWNER (changed with the ownership model). It previously dropped
    // `linkedSiteId`, because back then the link was a ONE-schedule-per-site pointer and a
    // second schedule claiming the same site was ambiguous by construction. A project may now
    // hold several schedules, so that reason is gone — and leaving the old behaviour in place
    // would mean every "Duplicate" silently emigrated the copy to the ORGANIZATION, which is
    // both surprising ("duplicate this project's schedule" plainly means another schedule for
    // the same project) and the exact class of silent, unasked-for ownership change this work
    // exists to remove. The copy is a sibling under the same owner.
    return {...src, id: newId, name: src.name + " (Copy)", tasks: newTasks,
      formulaCols: Array.isArray(src.formulaCols) ? src.formulaCols.map(fc => ({...fc})) : undefined,
      meetingBodies: copiedBodies};               // B815/B816 — deep-copied AND re-ided (see above)
  };

  const duplicateProject = useCallback(async (id) => {
    // B1777120 — same reasoning as addProject: once flipped, the copy's id is a real Postgres
    // identity value reserved by an actual INSERT before it ever reaches local state, never a
    // client-guessed `nPid` two tabs could collide on.
    if (window.storage && window.storage.scheduleRowsAuthoritative) {
      const src = dataRef.current && dataRef.current.projects && dataRef.current.projects[id];
      if (!src) return;
      const maxTid = src.tasks.length ? Math.max(...src.tasks.map(t => t.id)) + 1 : 1;
      const newId = await window.storage.insertSchedule({
        name: src.name + " (Copy)", ownerKind: src.ownerKind,
        linkedSiteId: src.linkedSiteId ?? null, linkedSiteName: src.linkedSiteName ?? null,
        projectData: buildDuplicateProject(src, null),   // id filled in by insertSchedule once known
      });
      if (newId == null) {
        if (typeof showToast === "function") showToast("Couldn't duplicate this schedule — please try again.", { type: "error", duration: 6000 });
        return;
      }
      setData(d => {
        if (!d || !d.projects || !d.projects[id]) return d;
        const copy = buildDuplicateProject(d.projects[id], newId);
        const nd = {...d, nPid: Math.max(d.nPid, newId + 1), nTid: {...d.nTid, [newId]: maxTid}, aPid: newId,
          projects: {...d.projects, [newId]: copy}};
        rebuildMeetingBodyIndex(nd);
        return copy.linkedSiteId != null ? withLastActiveSite(nd, copy.linkedSiteId, newId) : nd;
      });
      return;
    }

    setData(d => {
      const src = d.projects[id];
      const newId = d.nPid;
      const copy = buildDuplicateProject(src, newId);
      const maxTid = copy.tasks.length ? Math.max(...copy.tasks.map(t => t.id)) + 1 : 1;
      const nd = {
        ...d,
        nPid: newId + 1,
        nTid: {...d.nTid, [newId]: maxTid},
        aPid: newId,
        projects: {...d.projects, [newId]: copy},
      };
      rebuildMeetingBodyIndex(nd);
      // The copy is now the one to come back to on this site — duplicateProject already switches
      // to it (aPid), and without this the site's last-active pointer would still name the
      // original, so a later return to the project would silently snap away from the copy.
      return src.linkedSiteId != null ? withLastActiveSite(nd, src.linkedSiteId, newId) : nd;
    });
  }, []);

  const deleteProject = useCallback(async (id, { skipConfirm = false } = {}) => {
    // J3 — the confirm is asked BEFORE the state update (it used to run inside the updater, which React may call twice).
    if (!skipConfirm) {
      const d0 = latestData.current;
      const proj0 = d0?.projects?.[id];
      if (!proj0) return;
      const taskCount0 = proj0.tasks?.length || 0;
      // B1873361 — a destructive confirm names the qualified label, not the bare name: deleting
      // the WRONG one of two identically-named schedules is exactly the costly mistake this
      // disambiguation exists to prevent.
      if (!(await askConfirm({
        title: `Delete project "${crossScheduleLabel(proj0)}"?`,
        body: `This removes ${taskCount0} task${taskCount0===1?"":"s"}.\n\nA backup snapshot will be saved — you can restore it from Version History.`,
        confirmLabel: "Delete", danger: true,
      }))) return;
    }
    setData(d => {
      if (!d || !d.projects || !d.projects[id]) return d; // B644 — null-safe pre-load; B2429233 — the last schedule is deletable
      const _proj = d.projects[id];
      // A labeled snapshot of the PRE-delete state is written before the deletion is applied, so the user can restore it
      // from the History panel. The shell breadcrumb (B440) already confirms inline, so it passes skipConfirm.
      // Fire-and-forget the labeled snapshot of the PRE-delete state
      try { window.storage.set("hs-v1", JSON.stringify(stripViewState(d)), { label: "pre-delete-project", skipSanity: true }); } catch {}
      // Invariant 6— a delete prunes the deleted schedule's per-schedule bookkeeping: its
      // next-task-id counter (`nTid`) and any "last schedule I looked at" pointer aimed at it
      // (`lastActiveBySite`). Neither was ever pruned, so production still carried counters for
      // ids 4, 8–14, 17 and 18 — schedules deleted long ago — inside a document that is the ENTIRE
      // account in one row, where that growth is unbounded. pruneScheduleRefs asks the LIVE set
      // rather than the removed id, so it cannot miss a map by forgetting to name it here, and a
      // stale pointer left by any other path is swept at the same time.
      return removeScheduleFromDoc(d, id);
    });
  }, []);

  // ── Embedded-mode bridge (Planyr shell) ───────────────────────────────────
  // Inside the Planyr shell this app runs in an iframe with its OWN header (the
  // project picker + Dashboard/Projects toggle) hidden. Bridge that navigation to
  // the shell's shared Row-1 breadcrumb over postMessage, so the Schedule module's
  // picker drives THIS app's projects (Goose Creek, Grand Port, …) — not the Site
  // Planner's. Same-origin, so messages are targeted to window.location.origin.
  const inShell = typeof window !== "undefined" && window.self !== window.top;
  // B2285440 — a per-tab aPid that points at a schedule that no longer exists (deleted on another device)
  // is repointed at a real one. aPid is VIEW state (stripped from every save — see stripViewState), so this
  // is a view move, never a data write. With NO schedule at all there is nothing to point at: the render
  // below shows the empty state instead.
  useEffect(() => {
    if (!data) return;
    const pid = pickActivePid(data.projects, data.aPid);
    if (pid != null && pid !== data.aPid) setData(d => (d && d.aPid !== pid) ? { ...d, aPid: pid } : d);
  }, [data && data.aPid, data && data.projects]);
  const navSigRef = useRef("");
  useEffect(() => {
    if (!inShell || !data) return;
    // NEW-1 (B1638832) — consume the row-jump flag on the first effect after it was set, whether or not
    // the announcement below is emitted (an unchanged signature emits nothing, and a stale flag must never
    // ride a later, ambient re-announcement).
    const rowLink = rowJumpRef.current; rowJumpRef.current = false;
    // Carry the cross-module link (linkedSiteId/Name) so the shell can map this schedule ↔ a
    // Site Planner project (group_id) and keep the project the same across the header tabs.
    // B1404352 — taskCount rides along so the shell's per-schedule delete confirmation can name
    // what it's about to remove ("This removes 8 tasks") without a second round-trip.
    const list = Object.values(data.projects || {}).map(p => ({ id: p.id, name: p.name, ownerKind: ownerOf(p).kind, linkedSiteId: p.linkedSiteId ?? null, linkedSiteName: p.linkedSiteName ?? null, taskCount: Array.isArray(p.tasks) ? p.tasks.length : 0 }));
    const sig = JSON.stringify([data.section ?? "projects", data.aPid ?? null, list]);
    if (sig === navSigRef.current) return; // only emit when the nav state actually changes
    navSigRef.current = sig;
    try {
      window.parent.postMessage({
        source: "planar-seq", type: "planar:nav-state",
        section: data.section ?? "projects", activeId: data.aPid ?? null, projects: list,
        ...(rowLink ? { rowLink: true } : {}),
      }, window.location.origin);
    } catch (_) {}
  }, [data, inShell]);
  // NEW-1 (B1991040) — the shell tells this page every project's LIVE name (planar:site-names) so a
  // schedule's "<Project> / <Schedule>" label resolves by linked id at read time instead of trusting
  // the `linkedSiteName` snapshot stored in the document (see scheduleOwnership.js `liveSiteName`).
  // A render-only tick: nothing here touches `data`, so it can never dirty or write the document.
  const [, setSiteNamesTick] = React.useState(0);
  useEffect(() => {
    const onNames = (e) => {
      if (!e || e.origin !== window.location.origin) return; // same-origin shell only (audit batch A)
      const m = e && e.data;
      if (!m || m.source !== "planar-shell" || m.type !== "planar:site-names") return;
      const names = m.names && typeof m.names === "object" ? m.names : {};
      setSiteNameResolver((id) => (id != null && names[id]) || null);
      setSiteNamesTick((n) => n + 1);
    };
    window.addEventListener("message", onNames);
    return () => window.removeEventListener("message", onNames);
  }, []);
  // NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD) — the two shell messages that matter BEFORE the document has loaded
  // (the handler below drops everything until `data` exists): the shell's nav-request is answered with
  // where the load stands, and its Retry restarts the read. Neither writes anything.
  useEffect(() => {
    if (!inShell) return;
    const onLoadMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      const m = e.data;
      if (!m || m.source !== "planar-shell" || latestData.current) return;
      if (m.type === "planar:nav-request") postLoadState(window.__planarLoadStatus === "failed" ? "failed" : "loading");
      else if (m.type === "planar:retry-load") { window.__planarLoadStatus = "loading"; setLoadTick(t => t + 1); }
    };
    window.addEventListener("message", onLoadMsg);
    return () => window.removeEventListener("message", onLoadMsg);
  }, [inShell]);
  useEffect(() => {
    if (!inShell) return;
    const onMsg = (e) => {
      // These messages mutate state (switch project, open dashboard, create a project),
      // so only accept them from the same-origin shell — never a cross-origin embedder.
      if (e.origin !== window.location.origin) return;
      const m = e.data;
      if (!m || m.source !== "planar-shell") return;
      // B644 — `data` is null until the async hs-v1 load resolves, and every branch below
      // reads or mutates it. A functional updater queued now runs INSIDE the next useState
      // render, so a null `d.projects` read there throws and lands App in the error
      // boundary ("Cannot read properties of null (reading 'projects')" — the fresh-project
      // / cold-boot first paint). Drop shell messages until data exists: the shell re-posts
      // nav intents on every tab switch and retries nav-request, so an early drop self-heals
      // the moment the load lands (nav-request already no-op'd pre-load by design).
      if (!latestData.current) return;
      if (m.type === "planar:nav-request") {
        // The shell's loader asks us to (re-)announce our nav state, so a missed or slow first
        // emit can't strand it on its fallback timer. Answer from the latest data — a no-op until
        // it's loaded (the shell retries, and the data-change emit above also fires once it loads).
        const d = latestData.current;
        if (d) {
          // Carry the cross-module link fields, identical to the primary data-change emit above —
          // a stripped {id,name} reply (when it lands last before the shell stops polling) made the
          // shell drop linkedSiteId, falsely showing the "no schedule linked" panel over an already-
          // linked project and minting a duplicate schedule on "Create".
          const list = Object.values(d.projects || {}).map(p => ({ id: p.id, name: p.name, ownerKind: ownerOf(p).kind, linkedSiteId: p.linkedSiteId ?? null, linkedSiteName: p.linkedSiteName ?? null, taskCount: Array.isArray(p.tasks) ? p.tasks.length : 0 }));
          try { window.parent.postMessage({ source: "planar-seq", type: "planar:nav-state",
            section: d.section ?? "projects", activeId: d.aPid ?? null, projects: list }, window.location.origin); } catch (_) {}
        }
        return;
      }
      // Tell the shell a cross-module link was set/cleared/created, so it can mirror the
      // lightweight hint onto the Site Planner side (it can't read this app's backend).
      const emitLinkChanged = (siteId, scheduleId, name) => {
        try {
          window.parent.postMessage({ source: "planar-seq", type: "planar:link-changed",
            siteId: siteId ?? null, scheduleId: scheduleId ?? null, name: name ?? null }, window.location.origin);
        } catch (_) {}
      };
      if (m.type === "planar:nav-select" && m.id != null) {
        setData(d => {
          const proj = d.projects && d.projects[m.id];
          if (!proj) return d;
          const nd = { ...d, section: "projects", aPid: m.id };
          return proj.linkedSiteId != null ? withLastActiveSite(nd, proj.linkedSiteId, m.id) : nd;
        });
      } else if (m.type === "planar:nav-select-by-site" && m.siteId != null) {
        // Project-aware header tabs: activate the schedule linked to this Site Planner project
        // (group_id). No link yet → leave state untouched; the shell shows the resolution panel.
        setData(d => {
          const linked = Object.values(d.projects || {}).filter(p => p && p.linkedSiteId != null && p.linkedSiteId === m.siteId);
          if (!linked.length) return d;
          // NEW-1 (recurrence of B1080547, owner report 2026-09-07: "how come I still can't make
          // multiple schedules per project?") — a site can carry SEVERAL linked schedules once
          // B1080547 lifted the one-schedule-per-site constraint. Always resolving to whichever
          // sorts first (lowest id — always the oldest, by construction) meant creating a second
          // or third schedule and then coming back later (a fresh tab — see B1107680's aPid
          // migration above — or simply navigating elsewhere and back) silently snapped the grid
          // back to the ORIGINAL schedule every time, with no visible sign the newer ones still
          // existed. Prefer whichever schedule was last recorded active for this site; fall back
          // to the first-linked only when nothing is remembered yet (a brand-new link).
          const preferredId = d.lastActiveBySite ? d.lastActiveBySite[m.siteId] : null;
          const match = (preferredId != null && linked.find(p => p.id === preferredId)) || linked[0];
          // No-op if that schedule is ALREADY active in the projects section — return the same
          // state object so React doesn't re-run the auto-save effect. The shell re-posts this on
          // every switch; without the guard a burst of identical carry-ins fired a burst of saves
          // that tripped the optimistic-save guard against this tab's own write (the false "newer
          // version saved on another device" banner, B560).
          if (d.aPid === match.id && (d.section ?? "projects") === "projects") return d;
          return withLastActiveSite({ ...d, section: "projects", aPid: match.id }, m.siteId, match.id);
        });
      } else if (m.type === "planar:nav-link" && m.id != null) {
        // Set (m.siteId present) or clear (m.siteId null) the link on an existing schedule.
        setData(d => {
          if (!d.projects || !d.projects[m.id]) return d;
          const proj = { ...d.projects[m.id] };
          const base = { ...d, section: "projects", aPid: m.id };
          if (m.siteId != null) {
            proj.linkedSiteId = m.siteId; proj.linkedSiteName = m.siteName || null;
            return withLastActiveSite({ ...base, projects: { ...d.projects, [m.id]: proj } }, m.siteId, m.id);
          }
          // Unlinking a schedule from its project MOVES it to the organization — it does not
          // return it to the unowned state, which this model no longer has. Without this the one
          // remaining path back to "belongs to nothing" would still be open.
          delete proj.linkedSiteId; delete proj.linkedSiteName;
          proj.ownerKind = OWNER_KIND_ORG;
          return { ...base, projects: { ...d.projects, [m.id]: proj } };
        });
        emitLinkChanged(m.siteId ?? null, m.id, m.siteName ?? null);
      } else if (m.type === "planar:nav-create-linked") {
        // Create a new schedule pre-named after + linked to a Site Planner project, then open it.
        // addProject mints id = current nPid, so capture it for the mirror message.
        const newId = latestData.current ? latestData.current.nPid : null;
        // `m.ownerKind` is the owner the New-schedule modal actually chose. An org-owned create
        // arrives with siteId null, so addProject's own owner derivation already lands it on the
        // organization — this passes it through explicitly so the choice is carried, not re-guessed.
        addProject({ name: m.name, ownerKind: m.ownerKind ?? null, linkedSiteId: m.siteId ?? null, linkedSiteName: m.siteName ?? null });
        setData(d => ({ ...d, section: "projects" }));
        if (newId != null && m.siteId != null) emitLinkChanged(m.siteId, newId, m.siteName ?? null);
      } else if (m.type === "planar:nav-dashboard") {
        setData(d => ({ ...d, section: "reports" }));
      } else if (m.type === "planar:nav-new") {
        addProject();
        setData(d => ({ ...d, section: "projects" }));
      } else if (m.type === "planar:nav-duplicate" && m.id != null) {
        // NEW-2/B1080546 — deep-copy from the shell breadcrumb's kebab menu (duplicateProject
        // already exists and already strips linkedSiteId/linkedSiteName — see its own header —
        // this was previously reachable only from the in-iframe project list, which the shell
        // hides). duplicateProject also switches to the copy (sets aPid), so land on it directly.
        if (latestData.current && latestData.current.projects && latestData.current.projects[m.id]) {
          duplicateProject(m.id);
          setData(d => ({ ...d, section: "projects" }));
        }
      } else if (m.type === "planar:nav-rename" && m.id != null && typeof m.name === "string") {
        // B440 — rename from the shell breadcrumb. The breadcrumb already trimmed/validated;
        // guard once more so an empty name can never blank a project label.
        const name = m.name.trim();
        if (name) renameProject(m.id, name);
      } else if (m.type === "planar:nav-delete" && m.id != null) {
        // B440 — delete from the shell breadcrumb (already confirmed inline → skipConfirm).
        // If the deleted project was the active one, route home to the Dashboard (reports),
        // matching the "the open project no longer exists → go home" behavior.
        const projCount = latestData.current ? Object.keys(latestData.current.projects || {}).length : 0;
        const wasActive = latestData.current && latestData.current.aPid === m.id;
        deleteProject(m.id, { skipConfirm: true });
        // Route home only when a schedule actually remains to land on: deleting the LAST schedule
        // (B2429233) leaves the document's own "No schedules yet" empty state, which is the right
        // place to stay (there is no Dashboard worth routing to).
        if (wasActive && projCount > 1) setData(d => ({ ...d, section: "reports" }));
      } else if (m.type === "planar:nav-select-task" && m.siteId != null && (m.taskId != null || m.taskSid != null)) {
        // B1953795 (S3) — a caller that knows the task's STABLE `_sid` (the Dashboard feeds) sends it; a task
        // `id` is a row position that shifts on every insert above it, so an id sent from a stale read (or
        // from stored data renumbered on load) can name a DIFFERENT task. With a sid we resolve the CURRENT
        // id here and never fall back to the positional id.
        // B1161792 (NEW-1) — the Dashboard's "Needs attention" card jumping straight to one task,
        // not just its project. Resolve the schedule linked to the Site Planner project (same
        // lookup planar:nav-select-by-site uses above), then reuse the existing internal
        // goToTask jump — the same one the in-app Master view's row and the successor-prompt
        // modal already use — rather than inventing a second "select a task" mechanism.
        // NEW-1 (B1080547 recurrence) — a site can now carry several linked schedules, and a
        // task id is only meaningful within ONE of them (small per-schedule sequential integers)
        // — a bare "first linked" guess is the same defect as planar:nav-select-by-site above,
        // and here it can land on an unrelated task that happens to share the id in the wrong
        // schedule. Prefer the last-active schedule WHEN it actually contains the task (resolves
        // a genuine id collision the way the user's own recent activity would suggest); otherwise
        // whichever linked schedule does contain it (the unambiguous single-owner case); otherwise
        // the last-active one anyway (task not found — best guess); otherwise the first linked.
        const linkedForTask = latestData.current ? Object.values(latestData.current.projects || {}).filter(p => p && p.linkedSiteId != null && p.linkedSiteId === m.siteId) : [];
        const preferredForTask = latestData.current && latestData.current.lastActiveBySite ? latestData.current.lastActiveBySite[m.siteId] : null;
        const preferredScheduleForTask = preferredForTask != null ? linkedForTask.find(p => p.id === preferredForTask) : null;
        const bySid = m.taskSid != null;
        const hasTask = (p) => p && Array.isArray(p.tasks) && p.tasks.some(t => bySid ? t._sid === m.taskSid : t.id === m.taskId);
        const match = (hasTask(preferredScheduleForTask) && preferredScheduleForTask)
          || linkedForTask.find(hasTask)
          || preferredScheduleForTask
          || linkedForTask[0];
        if (match) {
          const target = bySid ? match.tasks.find(t => t._sid === m.taskSid) : null;
          if (bySid && !target) setData(d => ({ ...d, section: "projects", aPid: match.id }));   // task gone: land on its schedule, never a wrong row
          else goToTask(match.id, bySid ? target.id : m.taskId);
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [inShell, addProject, renameProject, deleteProject, duplicateProject, goToTask]);

  // ── Embedded-mode TOOLBAR bridge (Planyr shell, B388) ──────────────────────
  // The shell hides our in-iframe action toolbar (`.in-iframe .app-header`) and re-renders
  // those controls up in its own unified header. So when embedded: (1) report the toolbar's
  // live state up, and (2) accept the shell's toolbar commands and run the SAME actions our
  // own buttons do. Standalone (not embedded) is untouched — `inShell` gates both halves and
  // the in-iframe buttons keep their own handlers.
  const tbSigRef = useRef("");
  useEffect(() => {
    if (!inShell || !data) return;
    const sec = data.section ?? "projects";
    const section = sec === "suggestions" ? "projects" : sec;
    // B1281648 — effective view is simply `data.view` at every width now: Split renders both
    // panes stacked at phone width instead of collapsing to one, so there is no longer a
    // width-dependent override here. Must match the body switch below exactly, or the shell's
    // lifted zoom control (which reads `zoomable` off this) can disagree with what is on screen.
    const view = data.view ?? "grid";
    const state = {
      view, section, isMobile: !!isMobile,
      zoomPct: Math.round((ganttPPD || 22) / 6 * 100),
      zoomable: section === "projects" && (view === "split" || view === "gantt"),
      reviewCount: reviewRows.length,
      reviewOpen: !!reviewOpen,
      saveStatus, savePulse: !!savePulse, fileLinked: !!fileLinked,
      // B566 — bridge the offline/cloud-unreachable condition up too, so the unified header
      // cloud badge can show the honest amber "offline" state instead of a false-green "synced":
      // on a failed initial cloud READ, offlineFallback is set while saveStatus still reads its
      // initial "saved" (no write has been attempted yet), which would otherwise map to synced.
      offlineFallback: !!offlineFallback,
      // B778/NEW-1 — signed-out (or not on the schedule's team), distinct from offlineFallback.
      authRequired: !!authRequired,
      activePanel: settingsOpen ? "settings" : automationOpen ? "automation"
        : contactsOpen ? "contacts" : formatOpen ? "format" : historyOpen ? "history" : null,
    };
    const sig = JSON.stringify(state);
    if (sig === tbSigRef.current) return; // only emit when the toolbar state actually changes
    tbSigRef.current = sig;
    try {
      window.parent.postMessage({ source: "planar-seq", type: "planar:toolbar-state", ...state }, window.location.origin);
    } catch (_) {}
  }, [inShell, data, isMobile, ganttPPD, reviewRows, reviewOpen, saveStatus, savePulse, fileLinked,
      offlineFallback, authRequired, settingsOpen, automationOpen, contactsOpen, formatOpen, historyOpen]);

  useEffect(() => {
    if (!inShell) return;
    const onCmd = (e) => {
      // Same-origin shell only — these commands mutate state / trigger downloads. (Same strict
      // guards as the nav bridge: exact origin + the planar-shell source discriminator.)
      if (e.origin !== window.location.origin) return;
      const m = e.data;
      if (!m || m.source !== "planar-shell") return;
      switch (m.type) {
        case "planar:view-set":
          if (m.view) setData(d => d ? { ...d, view: m.view } : d);
          break;
        case "planar:review-toggle": {
          const opening = !reviewOpen;
          if (opening && reviewRows.length && data && data.projects) {
            const a = reviewRows[Math.min(reviewIdx, reviewRows.length - 1)];
            if (a && a.project_id != null && data.projects[a.project_id] && data.aPid !== a.project_id) setData(d => ({ ...d, aPid: a.project_id }));
          }
          setReviewOpen(opening);
          break;
        }
        case "planar:zoom":
          if (m.dir === "in") setGanttPPD(z => Math.min(80, Math.ceil(z * 1.35)));
          else if (m.dir === "out") setGanttPPD(z => Math.max(1, Math.floor(z / 1.35)));
          break;
        case "planar:export":
          if (m.mode === "pdf") setPdfExportOpen(true); else exportHTML();
          break;
        case "planar:save":
          if (saveStatus === "error") { if (latestData.current) attemptCloudSave(latestData.current); }
          else openFile();
          break;
        case "planar:history":
          setHistoryOpen(true); setSettingsOpen(false); setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false);
          break;
        case "planar:contacts":
          setContactsOpen(o => !o); setSettingsOpen(false); setAutomationOpen(false); setFormatOpen(false);
          break;
        case "planar:automation":
          setAutomationOpen(o => !o); setSettingsOpen(false); setContactsOpen(false); setFormatOpen(false);
          break;
        case "planar:settings":
          setSettingsOpen(o => !o); setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false);
          break;
        case "planar:format":
          setFormatOpen(o => !o); setSettingsOpen(false); setAutomationOpen(false); setContactsOpen(false);
          break;
        default: break;
      }
    };
    window.addEventListener("message", onCmd);
    return () => window.removeEventListener("message", onCmd);
  }, [inShell, data, reviewOpen, reviewRows, reviewIdx, saveStatus]);

  const proj = activeProjectOf(data);

  const flatTasks = useMemo(() => {
    if (!proj) return [];
    const settings = data?.settings; // healthRules (or legacy cfRules) for computeDisplayHealth — Focus must classify by the SAME status the grid shows (B717)
    const childSet = focusGroupIds(proj.tasks);
    const byId = {};
    const kidsBy = new Map();
    proj.tasks.forEach(t => {
      byId[t.id] = t;
      if (!kidsBy.has(t.parentId)) kidsBy.set(t.parentId, []);
      kidsBy.get(t.parentId).push(t);
    });
    const kidsOf = id => kidsBy.get(id) || [];

    // Rolled status of a task's whole subtree: "done" (every descendant complete),
    // "upcoming" (every descendant not-started), "paused" (every descendant paused),
    // or "active" (anything in progress / needs-attention / mixed).
    const statusMemo = {};
    const rolledStatus = id => {
      if (statusMemo[id] !== undefined) return statusMemo[id];
      const kids = kidsOf(id);
      let res;
      if (kids.length === 0) {
        // B717 single-source-of-truth: classify a leaf by the SAME status the grid shows
        // (computeDisplayHealth applies cfRules), NOT the raw stored health. Otherwise an
        // overdue Not-Started task renders red "Needs Attn." via overdueRed yet is classed
        // "upcoming" off its raw gray health → Focus wrongly hides it. Now red/yellow-promoted
        // (overdueRed / dueSoonYellow) both map to "active" and survive Focus, matching the grid.
        const h = computeDisplayHealth(byId[id], settings, byId);
        res = h === "green" ? "done" : h === "gray" ? "upcoming" : h === "paused" ? "paused" : "active";
      } else {
        const ss = kids.map(k => rolledStatus(k.id));
        res = ss.every(s => s === "done") ? "done"
            : ss.every(s => s === "upcoming") ? "upcoming"
            : ss.every(s => s === "paused") ? "paused"
            : "active";
      }
      statusMemo[id] = res;
      return res;
    };
    // A child (leaf OR sub-group) is hideable by Focus when its whole subtree is
    // done, not-started, or paused. Anything with in-progress/needs-attention work stays.
    const hideStatusOf = id => { const s = rolledStatus(id); return s === "active" ? null : s; };

    // Cost roll-up: a parent's cost is the sum of its descendant leaf costs (read-only,
    // like dates); a leaf shows its own entered value. Computed for display only.
    const costMemo = {};
    const costOf = id => {
      if (id in costMemo) return costMemo[id];
      const kids = kidsOf(id);
      // Include the node's OWN value too (0 for a normal parent → no change), so a cost entered on a
      // task BEFORE it gained children isn't silently dropped from the total (it's locked from editing,
      // so it would otherwise be stranded in the saved data, invisible + uneditable).
      const v = kids.length ? (Number(byId[id]?.cost) || 0) + kids.reduce((s, c) => s + costOf(c.id), 0) : (Number(byId[id]?.cost) || 0);
      costMemo[id] = v; return v;
    };
    // B212 — same bottom-up roll-up for the optional Budget / Actual columns.
    const _fieldMemo = {};
    const sumOf = (id, field) => {
      const k = field + ":" + id;
      if (k in _fieldMemo) return _fieldMemo[k];
      const kids = kidsOf(id);
      const v = kids.length ? (Number(byId[id]?.[field]) || 0) + kids.reduce((s, c) => s + sumOf(c.id, field), 0) : (Number(byId[id]?.[field]) || 0);
      _fieldMemo[k] = v; return v;
    };

    const out = [];
    const walk = (parentId, level) => {
      const parent = parentId === null ? null : byId[parentId];
      let children = kidsOf(parentId);
      if (parent && parent.focused) children = children.filter(c => !hideStatusOf(c.id) || focusPins.has(c._sid));
      children.forEach(t => {
        const hasChildren = childSet.has(t.id);
        // Separate counts of what Focus would hide: completed, paused, not-started
        let hideableDone = 0, hideableUpcoming = 0, hideablePaused = 0;
        if (hasChildren) {
          kidsOf(t.id).forEach(c => {
            const hs = focusPins.has(c._sid) ? null : hideStatusOf(c.id);
            if (hs === "done") hideableDone++;
            else if (hs === "upcoming") hideableUpcoming++;
            else if (hs === "paused") hideablePaused++;
          });
        }
        out.push({...t, level, hasChildren, hideableDone, hideableUpcoming, hideablePaused,
          hideableCount: hideableDone + hideableUpcoming + hideablePaused, rolledCost: costOf(t.id),
          rolledBudget: sumOf(t.id,"budget"), rolledActual: sumOf(t.id,"actualCost")});
        if (t.isExpanded) walk(t.id, level + 1);
      });
    };
    walk(null, 0);
    return out;
  }, [proj, data?.settings, NOW, focusPins]); // settings→cfRules, NOW→overdue rollover: keep Focus in sync with the grid's display health (B717)

  // Keep a ref in sync so the keydown handler can read tasks without a stale closure. NEW-1 — a LAYOUT
  // effect, not a passive one: it lands in the same commit as the state, so a key pressed right after an
  // edit can never read the previous (or an empty) list.
  React.useLayoutEffect(() => { flatTasksRef.current = flatTasks; }, [flatTasks]);
  // NEW-1 — a Focus toggle (any task's `focused` changing, keyed by _sid so a renumber is not a toggle)
  // re-applies the filter: rows pinned visible by an insert drop back under it.
  const focusSig = (proj?.tasks || []).filter(t => t.focused).map(t => t._sid).join(",");
  React.useEffect(() => { setFocusPins(p => (p.size ? new Set() : p)); }, [focusSig]);
  // NEW-1 (B2455200) — after an Alt+F toggle commits, a selection whose row Focus just hid moves to its
  // nearest visible ancestor (the parent summary row) instead of staying on an invisible row. Runs only for
  // a toggle the key made (focusReselectRef), never for a chip click or an undo.
  React.useLayoutEffect(() => {
    const r = focusReselectRef.current; if (!r) return;
    focusReselectRef.current = null;
    const next = focusReselectTarget(proj?.tasks || [], new Set(flatTasks.map(t => t.id)), r.selId);
    if (next != null && next !== r.selId) setSelectedId(next);
  }, [focusSig]);
  // NEW-1 — the flat index the selection was last SEEN at. When its row is deleted (selection → null) the
  // arrow keys re-anchor here instead of jumping to the first / last row (stepGridRow). Only ever written
  // while the selection is actually in the list, so a hide or a delete leaves the last real position.
  React.useLayoutEffect(() => {
    if (selectedId == null || selectedId === "__NEW_TASK__") return;
    const i = flatTasks.findIndex(t => t.id === selectedId);
    if (i >= 0) lastSelIdxRef.current = i;
  }, [selectedId, flatTasks]);
  useEffect(() => { projIdRef.current = data?.aPid ?? null; }, [data]);
  // Clear the start char whenever edit mode closes
  useEffect(() => { if (!edit) setEditStartChar(null); }, [edit]);

  const succMap = useMemo(() => {
    if (!proj) return {};
    const m = {};
    proj.tasks.forEach(t => normPreds(t.predecessors).forEach(p => { (m[p.id] = m[p.id] || []).push(t.id); }));
    return m;
  }, [proj]);

  const getTaskName = useCallback((id) => proj?.tasks.find(t => t.id === id)?.name ?? `#${id}`, [proj]);

  const liveNotesTask = notesCtx
    ? data?.projects[notesCtx.projectId]?.tasks.find(t => t.id === notesCtx.taskId)
    : null;

  const dl = (content, name, type) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], {type}));
    a.download = name; a.click();
  };
  const openFile = async () => {
    if (!window.showOpenFilePicker) { showToast('Auto-save requires Chrome or Edge.', { type: "warn", duration: 4000 }); return; }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'planar HTML file', accept: { 'text/html': ['.html'] } }],
        multiple: false,
      });
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return;
      const file = await handle.getFile();
      fileHtmlRef.current = await file.text();
      fileHandleRef.current = handle;
      setFileLinked(true);
    } catch(e) { /* cancelled */ }
  };

  const exportJSON = () => dl(JSON.stringify(data, null, 2), `${scheduleExportName(Object.values(data.projects))}.json`, "application/json");
  const importJSON = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async ev => {
      let parsed;
      try { parsed = JSON.parse(ev.target.result); }
      catch { showToast("Import failed — not valid JSON.", { type: "error", duration: 4000 }); return; }
      // Validate it has the shape we expect (projects object with tasks arrays)
      if (!parsed || typeof parsed !== "object" || !parsed.projects || typeof parsed.projects !== "object") {
        showToast("Import failed — missing 'projects' object.", { type: "error", duration: 4000 });
        return;
      }
      const taskCount = Object.values(parsed.projects).reduce((n, p) => n + (Array.isArray(p?.tasks) ? p.tasks.length : 0), 0);
      const projCount = Object.keys(parsed.projects).length;
      const curTaskCount = data ? Object.values(data.projects || {}).reduce((n, p) => n + (p.tasks?.length || 0), 0) : 0;
      if (!(await askConfirm({
        title: "Replace current data with this import?",
        body: `Current: ${Object.keys(data?.projects||{}).length} projects, ${curTaskCount} tasks\nIncoming: ${projCount} projects, ${taskCount} tasks\n\nA backup snapshot of the current state is saved first.`,
        confirmLabel: "Replace", danger: true,
      }))) {
        return;
      }
      // Snapshot the current state with a pre-import label BEFORE applying
      if (data) { try { window.storage.set("hs-v1", JSON.stringify(stripViewState(data)), { label: "pre-import", skipSanity: true }); } catch {} }
      // Route the import through the SAME shared normalize + cascade pipeline the cloud/seed load and
      // version-restore use (B4), so old/partial backups get migrated (predecessor format, holidays,
      // ids, contacts) and dates recomputed. (This used to inline the pipeline, calling normalizeIds/
      // ensureContacts directly — but those are scoped INSIDE the load effect, so the call threw
      // ReferenceError and import was silently broken. The ref closes over them.)
      if (applyLoadedDataRef.current) applyLoadedDataRef.current(parsed);
      else setData(parsed);
      showToast(`Imported ${projCount} project${projCount===1?"":"s"}, ${taskCount} task${taskCount===1?"":"s"}.`, { type: "success", duration: 3000 });
    };
    r.readAsText(f);
    e.target.value = "";
  };
  const exportHTML = () => {
    // B1873361 (PDF-PARITY) — this always exports EVERY schedule on the account together (no
    // per-project selection, unlike buildPDFHtml's Web Snapshot), so two same-named schedules
    // (the owner's own two "Master Schedule"s) are guaranteed to appear side by side; the
    // section header is the qualified crossScheduleLabel, never the bare name.
    const rows = Object.values(data.projects).map(p =>
      `<h2>${escapeHtml(crossScheduleLabel(p))}</h2><table><tr><th>ID</th><th>Task</th><th>Start</th><th>End</th><th>Dur</th><th>Status</th><th>%</th><th>Owner</th></tr>` +
      p.tasks.map(t => { const h = HEALTH[t.health] || HEALTH.gray; const pct = effectivePercentComplete(t, p.tasks); return `<tr><td>${escapeHtml(t.id)}</td><td>${escapeHtml(t.name)}</td><td>${escapeHtml(fmtD(t.start))}</td><td>${escapeHtml(fmtD(t.end))}</td><td>${Number(t.duration)||0}d</td><td style="color:${escapeHtml(h.dot)}">${escapeHtml(h.label)}</td><td>${pct}%</td><td>${escapeHtml(ownerJoin(ownerListOf(t))||"—")}</td></tr>`; }).join("") +
      `</table>`).join("");
    // Title from the real data, not a hardcoded legacy project name / old brand:
    // a single project uses its name, multiple use the Planyr brand.
    const names = Object.values(data.projects).map(p => p.name).filter(Boolean);
    const title = names.length === 1 ? names[0] : "Planyr Schedule";
    dl(`<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title><style>body{font-family:monospace;background:#0d1117;color:#e6edf3;padding:24px}h1{color:#e6a817;margin-bottom:24px}h2{color:#58a6ff;margin:24px 0 8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #30363d;padding:6px 10px;text-align:left;font-size:12px}th{background:#161b22;color:#8b949e}</style></head><body><h1>${escapeHtml(title)} — ${new Date().toLocaleDateString()}</h1>${rows}</body></html>`,
      `${scheduleExportName(Object.values(data.projects))}.html`, "text/html");  // match the Site Planner PDF filename format
  };

  const rolledHealthMap = useMemo(() => proj ? computeRolledHealth(proj.tasks, data.settings) : {}, [proj?.tasks, data?.settings]);

  if (!data) return (
    <div style={{height:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",color:"#e6a817",fontFamily:"'Inter',system-ui,sans-serif",fontSize:14,letterSpacing:".1em"}}>LOADING...</div>
  );

  // B2285440 — no active schedule (every schedule deleted, or none yet): a visible, honest empty state,
  // never a crash. Nothing is written until the person presses the button.
  if (!proj) return (
    <div data-schedule-empty="1" style={{height:"100vh",background:"var(--bg)",color:"var(--txt)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,fontFamily:"'Inter',system-ui,sans-serif",textAlign:"center",padding:24}}>
      <div style={{fontSize:16,fontWeight:700}}>No schedules yet</div>
      <div style={{fontSize:13,maxWidth:360,lineHeight:1.5}}>This account has no schedule to show. Create one to start planning — nothing has been removed.</div>
      <button onClick={() => addProject()} style={{cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,background:"var(--accent)",color:"var(--on-accent,#fff)",border:"none",borderRadius:6,padding:"8px 16px"}}>New schedule</button>
    </div>
  );

  const setHoverZone = zone => { hoverZoneRef.current = zone; };
  // moveRows: resolved fresh every render (NOT a useCallback) so it always closes over the CURRENT
  // selRange/flatTasksRef — the same freshness structuralTargets itself already relies on for the
  // keyboard indent/outdent entry points. anchorId is the row whose drag handle was grabbed (or the
  // right-clicked/context row for "Move to…"); structuralTargets expands it to the whole active
  // selection when the anchor is part of one, exactly like indent/outdent do.
  const moveRows = (anchorId, destParentId, insertAfterId) => moveSelectionByIds(structuralTargets(anchorId), destParentId, insertAfterId);
  const shared = {tasks: flatTasks, succMap, updateTask, deleteTask, getTaskName, proj, setData, setNotesCtx, edit, setEdit, editStartChar, selectedId, setSelectedId, selRange, setSelRange, selectedColIdx, setSelectedColIdx, goToFocus, setGoToFocus, ganttPPD, setGanttPPD, gridZoom, setHoverZone, insertTask, insertTaskBelow, addTask, addSubtask, duplicateTask, setTaskCtx, rolledHealthMap, healthColStyle: data.healthColStyle || "stoplight", setHealthColStyle: v => setData(d => ({...d, healthColStyle: v})), data, moveRows, isMobile};

  let section = data.section ?? "projects";
  if (section === "suggestions") section = "projects";   // Suggestions tab removed — Review now lives inside Projects

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"var(--bg)",color:"var(--txt)",overflow:"hidden"}}>

      {/* HEADER */}
      {offlineFallback && (
        <div style={{background:"#fef2f2",borderBottom:"1px solid #fecaca",color:"#991b1b",padding:"7px 14px",
          display:"flex",alignItems:"center",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
          <span style={{fontSize:14,flexShrink:0}}>⚠</span>
          <span style={{flex:1}}>
            <strong>Cloud unreachable — showing the offline copy embedded in this file.</strong>{" "}
            It may be out of date, and changes will not save. Fix the connection, then reload.
          </span>
          <button onClick={()=>window.location.reload()}
            style={{flexShrink:0,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,
              background:"var(--bg)",border:"1px solid #fca5a5",color:"#991b1b",borderRadius:5,padding:"4px 12px"}}>
            Reload
          </button>
        </div>
      )}
      {authRequired && !offlineFallback && (
        <div style={{background:"#fffbeb",borderBottom:"1px solid #fde68a",color:"#92400e",padding:"7px 14px",
          display:"flex",alignItems:"center",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0}}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          <span style={{flex:1}}>
            <strong>Sign in to see this schedule.</strong>{" "}
            Showing a blank starter copy —{" "}
            {window.self === window.top
              /* Standalone /sequence/ has no sign-in form of its own (NEW-1): the link opens Planyr's sign-in panel on the
                 Schedule tab. Embedded in Planyr, the header's Sign in button (top right) is the way. */
              ? <a data-testid="sequence-signin-link" href="/?app&auth=signin#/schedule" style={{color:"inherit",fontWeight:700}}>sign in to Planyr</a>
              : <>use Sign in at the top right of Planyr</>}
            , then reload.
          </span>
        </div>
      )}
      {staleNotice && !offlineFallback && !authRequired && (
        <div style={{background:"#fffbeb",borderBottom:"1px solid #fde68a",color:"#92400e",padding:"7px 14px",
          display:"flex",alignItems:"center",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
          <span style={{fontSize:14,flexShrink:0}}>&#8635;</span>
          <span style={{flex:1}}>
            {/* NEW-3 (B1696642) — this fires from a rev check against the cloud row alone, which
                carries no tab/window/device identity. "Another device" claimed a scope this app can't
                actually see (it could equally be another tab on THIS device) — say only what's known. */}
            {/* NEW-1 (owner follow-on 2026-09-16) — this banner can be read in a tab that's no longer
                on the schedule the reader thinks it is (two projects can each hold a "Master
                Schedule"), so it now names the ONE thing it always knows for free: which schedule
                THIS TAB currently has open (data.aPid) — never the schedule that changed remotely
                (checkRemote only reads the cloud row's __rev scalar, not its projects, so that's
                genuinely unknowable without fetching the whole document on every 20s poll). Always
                shown, never dropped for "the schedule on screen" — that exemption is for a per-row
                notice sitting right next to the row it names; this is a standalone banner with no
                grid underneath it to supply that context. */}
            <strong>A newer version was saved elsewhere.</strong>{" "}
            {saveStatus==="saved"
              ? `Reload to load the latest version of ${crossScheduleLabel(data.projects?.[data.aPid])}.`
              : `You have unsaved changes in ${crossScheduleLabel(data.projects?.[data.aPid])} -- reloading replaces them with the newer version. Your copy is kept in Version History either way.`}
          </span>
          <button onClick={async ()=>{
              // NEW-1 (false-conflict/merge-toast inflation, owner report 2026-09-17) — this banner
              // offers to reload over a tab that may hold edits which never reached the cloud
              // (saveStatus !== "saved"), and a bare reload discards them with nothing saved
              // anywhere — despite the copy above promising "kept in Version History either way",
              // a promise the code never actually backed. Flush first, through the SAME auto-save
              // path a real edit already takes: it merges this tab's edits onto the newer cloud via
              // the existing guard, or — if a merge genuinely can't happen — snapshots this tab's
              // copy as 'stale-block' (_rawSet's own existing fallback), so the edits are preserved
              // one way or the other before the page goes away.
              // NEW-2 (B1629619, 2026-09-18) — "unsaved changes" as read by `saveStatus` means the
              // in-memory `data` object hasn't reached the cloud; it says nothing about a cell
              // editor that's still open with typed-but-not-yet-committed text (name/date/cost/etc.
              // -- the "text" editor class, EDITOR-EXIT-CONTRACT). That keystroke never made it into
              // `data` at all -- every one of this grid's text cells commits on blur
              // (onBlur={e=>commit(taskId,col,e.target.value)}, reading the DOM input's OWN current
              // value, not a stale React closure) -- so blurring whatever's focused is both safe (a
              // no-op if nothing's open) and sufficient (it reads the live keystrokes, not a copy).
              // The wait lets that blur's setData/updateTask land in `data` (and from there into
              // `latestData.current`, synced by its own effect) before this reads it.
              const ae = document.activeElement;
              if (ae && typeof ae.blur === "function" && ae !== document.body) {
                ae.blur();
                await new Promise(r => setTimeout(r, 50));
              }
              const d = latestData.current;
              if (d && saveStatusRef.current !== "saved") {
                try { await window.storage.set("hs-v1", JSON.stringify(stripViewState(d)), { label: "auto" }); } catch {}
              }
              window.location.reload();
            }}
            style={{flexShrink:0,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,
              background:"var(--bg)",border:"1px solid #fcd34d",color:"#92400e",borderRadius:5,padding:"4px 12px"}}>
            Reload
          </button>
        </div>
      )}
      {ancestorPredNotice && ancestorPredNotice.length > 0 && (() => {
        // NEW-1 (B1696640) — LOUD surface for the load-time repair above: a task whose predecessor
        // named its own parent/ancestor (that link can never converge — a summary row's dates are the
        // ROLLUP of its children, so the two halves chase each other forever) had the link dropped and
        // its dates recalculated. One notice, once — the repair is persisted immediately (see the load
        // effect), so it doesn't recur on the next open the way it did before this fix.
        // NEW-1 (owner follow-on 2026-09-16) — a row here can belong to ANY schedule in the account,
        // not just the one on screen, so the schedule's own name alone is ambiguous (two projects can
        // each hold a "Master Schedule"); scheduleRowPrefix prints the full disambiguating
        // "<Project> / <Schedule>" label for a row elsewhere and nothing for a row already on screen.
        const flat = ancestorPredNotice.flatMap(p => (p.tasks || []).map(t => ({...t, project: p.project, pid: p.pid})));
        const n = flat.length;
        const shown = flat.slice(0, 3);
        const extra = n - shown.length;
        return (
          <div style={{background:"#fffbeb",borderBottom:"1px solid #fde68a",color:"#92400e",padding:"7px 14px",
            display:"flex",alignItems:"flex-start",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
            <span style={{fontSize:14,flexShrink:0}}>&#9888;</span>
            <span style={{flex:1}}>
              <strong>{n} task{n===1?"":"s"} named {n===1?"its own":"their own"} parent summary row as a predecessor — the link would loop forever, so it was removed and {n===1?"its date was":"their dates were"} recalculated.</strong>{" "}
              {shown.map((t, i) => (
                <React.Fragment key={t.pid + ":" + t.id}>
                  {i > 0 ? "; " : ""}
                  <span onClick={() => goToTask(t.pid, t.id)} title="Click to jump to this row"
                    style={{cursor:"pointer", textDecoration:"underline", textDecorationStyle:"dotted"}}>
                    {scheduleRowPrefix(data.projects, t.pid, data.aPid)}#{t.id} "{t.name}"
                  </span>
                </React.Fragment>
              ))}
              {extra > 0 ? `; +${extra} more` : ""}. Add back a real dependency (a sibling task, not the summary row) if one was intended.
            </span>
            <button onClick={()=>setAncestorPredNotice(null)}
              style={{flexShrink:0,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,
                background:"var(--bg)",border:"1px solid #fcd34d",color:"#92400e",borderRadius:5,padding:"4px 12px"}}>
              Dismiss
            </button>
          </div>
        );
      })()}
      {driftNotice && driftNotice.length > 0 && (() => {
        // B836 — LOUD surface for cascade drift the load quietly corrected. A non-pinned task whose
        // SAVED start didn't match its predecessor chain (B835) used to be re-derived in silence,
        // hiding the fact that the stored value was ever wrong. Now the correction is announced so
        // the user can confirm it matches their intent (or pin/lag a gap that was deliberate).
        // NEW-2 (B1696641) — each named row now carries its own ID and jumps to the row on click:
        // project NAME alone doesn't disambiguate (an account can hold several same-named projects,
        // and a project can hold several same-named tasks), but the ID always does.
        // NEW-1 (owner follow-on 2026-09-16) — and the schedule's own name alone STILL doesn't
        // disambiguate which PROJECT it belongs to (two projects can each hold a "Master Schedule");
        // scheduleRowPrefix prints "<Project> / <Schedule>" for a row in a different schedule than
        // the one on screen, and nothing when the row is already in view.
        const flat = driftNotice.flatMap(p => (p.tasks || []).map(t => ({...t, project: p.project, pid: p.pid})));
        const n = flat.length;
        const shown = flat.slice(0, 3);
        const extra = n - shown.length;
        return (
          <div style={{background:"#fffbeb",borderBottom:"1px solid #fde68a",color:"#92400e",padding:"7px 14px",
            display:"flex",alignItems:"flex-start",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
            <span style={{fontSize:14,flexShrink:0}}>&#9888;</span>
            <span style={{flex:1}}>
              <strong>{n} saved task {n===1?"date was":"dates were"} out of sync with {n===1?"its":"their"} predecessor{n===1?"":"s"} and {n===1?"has":"have"} been recalculated.</strong>{" "}
              {shown.map((t, i) => (
                <React.Fragment key={t.pid + ":" + t.id}>
                  {i > 0 ? "; " : ""}
                  <span onClick={() => goToTask(t.pid, t.id)} title="Click to jump to this row"
                    style={{cursor:"pointer", textDecoration:"underline", textDecorationStyle:"dotted"}}>
                    {scheduleRowPrefix(data.projects, t.pid, data.aPid)}#{t.id} "{t.name}" {fmtD(t.from) || "(no date)"}→{fmtD(t.to)}
                  </span>
                </React.Fragment>
              ))}
              {extra > 0 ? `; +${extra} more` : ""}. Check they match your intended schedule — if a gap was deliberate, pin the date or add a lag.
            </span>
            <button onClick={()=>setDriftNotice(null)}
              style={{flexShrink:0,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,
                background:"var(--bg)",border:"1px solid #fcd34d",color:"#92400e",borderRadius:5,padding:"4px 12px"}}>
              Dismiss
            </button>
          </div>
        );
      })()}
      {(() => {
        // B616 — LOUD, unmissable surface for locked-finish conflicts in the active project. A
        // conflicted task keeps its locked finish; this banner makes the user resolve it rather
        // than the schedule silently overrunning or overwriting the lock.
        // NEW-2 (B1696641) — same "names a task, not a row" gap driftNotice had: add the row ID and
        // make each named row jump to it (this banner is already scoped to the active project, so no
        // project-name ambiguity here — just the row).
        // NEW-1 (owner follow-on 2026-09-16) — reviewed for the same cross-project ambiguity as
        // driftNotice/ancestorPredNotice: `data.aPid` scopes this filter, so every row it can ever
        // show is already the schedule on screen. No prefix to add — there's nothing to disambiguate.
        const cft = (data?.projects?.[data.aPid]?.tasks || []).filter(t => t.finishConflict);
        if (!cft.length) return null;
        const shown = cft.slice(0, 3);
        const extra = cft.length - shown.length;
        return (
          <div style={{background:"#fef2f2",borderBottom:"1px solid #fecaca",color:"#991b1b",padding:"7px 14px",
            display:"flex",alignItems:"center",gap:10,fontSize:12.5,lineHeight:1.45,flexShrink:0,zIndex:31}}>
            <span style={{fontSize:14,flexShrink:0}}>⚠</span>
            <span style={{flex:1}}>
              <strong>{cft.length} task{cft.length>1?"s":""} can’t meet {cft.length>1?"their":"its"} locked finish date.</strong>{" "}
              The predecessor chain needs more time than the locked finish allows
              ({shown.map((t, i) => (
                <React.Fragment key={t.id}>
                  {i > 0 ? ", " : ""}
                  <span onClick={() => goToTask(data.aPid, t.id)} title="Click to jump to this row"
                    style={{cursor:"pointer", textDecoration:"underline", textDecorationStyle:"dotted"}}>
                    #{t.id} "{t.name||("Task "+t.id)}"
                  </span>
                </React.Fragment>
              ))}{extra > 0 ? `, +${extra} more` : ""}).
              Move the finish, shorten the duration, or change the dependency.
            </span>
          </div>
        );
      })()}
      <div className="app-header" style={{minHeight:46,background:"var(--bg)",borderBottom:"1px solid var(--bd2)",display:"flex",alignItems:"center",flexWrap:"wrap",rowGap:6,columnGap:8,padding:"6px 14px",flexShrink:0,zIndex:30}}>

        {/* Logo — hidden when embedded (the shell chrome already shows the Planyr wordmark) */}
        <svg className="hdr-logo" height="26" viewBox="0 0 196 52" xmlns="http://www.w3.org/2000/svg" style={{flexShrink:0,marginRight:8,display:"block"}}>
          <g transform="translate(0,6)">
            <rect x="0"  y="0"  width="44" height="7"  rx="2" fill="#4f46e5"/>
            <rect x="10" y="13" width="33" height="7"  rx="2" fill="#4f46e5"/>
            <rect x="17" y="26" width="39" height="7"  rx="2" fill="#4f46e5"/>
            <path d="M44,3.5 L50,3.5 L50,16.5 L10,16.5" stroke="#4f46e5" strokeWidth="1.2" fill="none" opacity="0.32"/>
            <polygon points="10,16.5 15,13.5 15,19.5" fill="#4f46e5" opacity="0.32"/>
            <path d="M43,16.5 L52,16.5 L52,29.5 L17,29.5" stroke="#4f46e5" strokeWidth="1.2" fill="none" opacity="0.32"/>
            <polygon points="17,29.5 22,26.5 22,32.5" fill="#4f46e5" opacity="0.32"/>
          </g>
          <text x="62" y="36" fontFamily="'Inter',system-ui,sans-serif" fontSize="34" fontWeight="400" letterSpacing="-1.5" fill="#3730a3">planyr</text>
        </svg>

        {/* Mode toggle pill */}
        <div className="hdr-mode" style={{display:"flex",background:"#f0f0f0",borderRadius:7,padding:"3px",gap:2,flexShrink:0}}>
          {[["reports","Dashboard"],["projects","Projects"]].map(([s,label]) => (
            <button key={s} onClick={()=>setData(d=>({...d,section:s}))}
              style={{border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:section===s?600:500,
                letterSpacing:".01em",padding:"5px 12px",borderRadius:5,transition:"all .15s",
                background:section===s?"#fff":"transparent",
                color:section===s?"var(--amber)":"var(--mut)",
                boxShadow:section===s?"0 1px 3px rgba(0,0,0,0.12)":"none"}}>
              {label}
            </button>
          ))}
        </div>

        {/* Project picker — only in projects mode (hidden while reviewing: the queue drives the project) */}
        {section === "projects" && !reviewOpen && (
          <div className="hdr-project" style={{display:"flex",alignItems:"center",gap:8,marginLeft:8,flexShrink:0}}>
            <div style={{width:1,height:22,background:"var(--bd2)",flexShrink:0}} />
            <ProjDropdown data={data} setData={setData} addProject={addProject} setProjCtx={setProjCtx} />
          </div>
        )}

        {/* View switcher — hidden while reviewing (review is grid-only; prevents losing review state on remount).
            This is the ONLY view switcher at every width, and it is now the SAME simple pill at
            every width: tap a tab, `data.view` becomes that tab, and the tapped tab highlights.
            B1281648 (RECURRENCE ×3 of B1241745) — a prior mechanism here had Split, at phone
            width, collapse to ONE pane and repoint Grid/Gantt taps at a `phonePane` state instead
            of leaving Split. The owner rejected that shape on his own iPhone across three shipped
            builds (#1490, #1497, #1504): a single pane behind the "Split" tab looks and behaves
            exactly like just tapping Grid or Gantt, so it read as "Split does nothing" every time,
            no matter how the pill's own highlight was fixed. Split now renders BOTH panes at once,
            stacked, at every width (see `SplitView`'s own `isMobile` branch) — so there is no
            "which pane" state to route around here any more, and this pill needs no special case
            for phone width at all. */}
        {section === "projects" && !reviewOpen && (
          <div className="hdr-view" style={{display:"flex",background:"#f0f0f0",borderRadius:7,padding:"3px",gap:2,marginLeft:8,flexShrink:0}}>
            {[["grid","Grid"],["split","Split"],["gantt","Gantt"]].map(([v,label]) => {
              const active = data.view === v;
              return (
                <button key={v} onClick={()=>setData(d=>({...d,view:v}))}
                  style={{border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:active?600:500,
                    letterSpacing:".01em",padding:"5px 12px",borderRadius:5,transition:"all .15s",
                    background:active?"#fff":"transparent",
                    color:active?"var(--amber)":"var(--mut)",
                    boxShadow:active?"0 1px 3px rgba(0,0,0,0.12)":"none"}}>
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {/* Review toggle — only in projects mode; flips the in-place review panel on/off */}
        {section === "projects" && (
          <button onClick={()=>{
              const opening = !reviewOpen;
              if (opening && reviewRows.length && data && data.projects) {
                const a = reviewRows[Math.min(reviewIdx, reviewRows.length-1)];
                if (a && a.project_id != null && data.projects[a.project_id] && data.aPid !== a.project_id) setData(d=>({...d, aPid:a.project_id}));
              }
              setReviewOpen(opening);
            }} title="Review suggested updates from forwarded emails"
            className="hdr-review"
            style={{marginLeft:8,flexShrink:0,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,
              letterSpacing:".01em",display:"flex",alignItems:"center",gap:6,padding:"5px 9px",borderRadius:7,transition:"all .15s",
              border: reviewOpen ? "1px solid var(--amber)" : "1px solid var(--bd2)",
              background: reviewOpen ? "#eef2ff" : "var(--surf)",
              color: (reviewOpen || reviewRows.length) ? "var(--amber)" : "var(--mut)"}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block"}}>
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
            {reviewRows.length > 0 && (
              <span style={{fontSize:11,fontWeight:700,color:"#fff",background:"var(--amber)",borderRadius:20,
                padding:"1px 7px",minWidth:18,textAlign:"center",lineHeight:1.5}}>{reviewRows.length}</span>
            )}
          </button>
        )}

        {/* Spacer */}
        <div style={{flex:1}} />

        {/* Right action group — desktop: all buttons inline; mobile: overflow menu */}
        <div className="hdr-actions" style={{display:"flex",alignItems:"center",gap:5,flexShrink:0,marginLeft:"auto"}}>

          {/* B1241744 — the phone Gantt zoom control: the desktop pair below is INSIDE the
              `!isMobile` branch and never reaches a phone at all, which is exactly how the
              controls-too-small failure was reported ("hit the controls") once Gantt itself
              stopped being silently replaced by Grid. Same two buttons, touch-sized (44px —
              the WCAG/platform floor CONTROL_H.touch also uses) under a coarse pointer only;
              a narrow desktop window with a mouse keeps the desktop pair's own compact size. */}
          {/* B1281648 — Split now always shows its Gantt pane too (stacked), so the phone zoom
              control applies whenever a Gantt is on screen at all: "gantt" or "split". */}
          {isMobile && (data.view==="gantt" || data.view==="split") && (
            <div style={{display:"flex",alignItems:"center",gap:coarsePointer?4:1}}>
              <button style={{padding:"0 10px",fontSize:15,height:coarsePointer?44:26,minWidth:coarsePointer?44:26,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--bd2)",borderRadius:5,background:"none",color:"var(--mut)",cursor:"pointer"}} title="Zoom out" onClick={()=>setGanttPPD(z=>Math.max(1,Math.floor(z/1.35)))}>−</button>
              <span style={{fontSize:11,color:"var(--mut)",width:30,textAlign:"center",userSelect:"none"}}>{Math.round(ganttPPD/6*100)}%</span>
              <button style={{padding:"0 10px",fontSize:15,height:coarsePointer?44:26,minWidth:coarsePointer?44:26,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--bd2)",borderRadius:5,background:"none",color:"var(--mut)",cursor:"pointer"}} title="Zoom in" onClick={()=>setGanttPPD(z=>Math.min(80,Math.ceil(z*1.35)))}>+</button>
            </div>
          )}

          {isMobile ? (
            /* MOBILE: single overflow button containing Download/Import/Auto-Save */
            <div style={{position:"relative"}}>
              {mobMenuOpen && <div style={{position:"fixed",inset:0,zIndex:998}} onClick={()=>setMobMenuOpen(false)} />}
              <button onClick={()=>setMobMenuOpen(o=>!o)} aria-label="More actions"
                style={{background:mobMenuOpen?"#eef2ff":saveStatus==="error"?"#fef2f2":"none",
                  border:saveStatus==="error"?"1px solid #fca5a5":"1px solid var(--bd2)",cursor:"pointer",
                  borderRadius:5,padding:"6px 10px",display:"flex",alignItems:"center",gap:3,
                  color:saveStatus==="error"?"#dc2626":mobMenuOpen?"var(--amber)":"var(--mut)",transition:"all .12s"}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
              </button>
              {mobMenuOpen && (
                <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:"var(--bg)",
                  border:"1px solid var(--bd2)",borderRadius:8,boxShadow:"0 6px 24px rgba(0,0,0,.14)",
                  zIndex:999,minWidth:220,padding:"6px 0",overflow:"hidden"}}>
                  {/* Auto-Save status row */}
                  <div onClick={()=>{ if (saveStatus==="error") { if (latestData.current) attemptCloudSave(latestData.current); } else { openFile(); } setMobMenuOpen(false);}}
                    style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:9,borderBottom:"1px solid var(--bd)"}}>
                    <span style={{width:9,height:9,borderRadius:"50%",flexShrink:0,
                      background:saveStatus==="error"?"#dc2626":fileLinked?"#16a34a":"var(--bd2)"}} />
                    <div style={{display:"flex",flexDirection:"column",gap:1}}>
                      <span style={{fontSize:13,color:saveStatus==="error"?"#dc2626":"var(--txt)",fontWeight:saveStatus==="error"?600:500}}>{saveStatus==="error"?"Not saved — tap to retry":fileLinked?"Backup File Linked":"Link Backup File"}</span>
                      <span style={{fontSize:10,color:saveStatus==="error"?"#dc2626":"var(--mut)"}}>{saveStatus==="error"?"Changes have NOT reached the cloud":fileLinked?"Cloud + local file":"Cloud auto-save is always on"}</span>
                    </div>
                  </div>
                  {/* Download options */}
                  <div onClick={()=>{exportHTML();setMobMenuOpen(false);}} style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:9}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--mut)",flexShrink:0}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <div style={{display:"flex",flexDirection:"column",gap:1}}>
                      <span style={{fontSize:13,color:"var(--txt)",fontWeight:500}}>Web Snapshot</span>
                      <span style={{fontSize:10,color:"var(--mut)"}}>Quick plain task tables · .html</span>
                    </div>
                  </div>
                  <div data-testid="open-history-mobile" onClick={()=>{setHistoryOpen(true);setMobMenuOpen(false);}} style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:9}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--mut)",flexShrink:0}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <div style={{display:"flex",flexDirection:"column",gap:1}}>
                      <span style={{fontSize:13,color:"var(--txt)",fontWeight:500}}>Version History</span>
                      <span style={{fontSize:10,color:"var(--mut)"}}>Browse &amp; restore snapshots</span>
                    </div>
                  </div>
                  <div onClick={()=>{setPdfExportOpen(true);setMobMenuOpen(false);}} style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:9,borderBottom:"1px solid var(--bd)"}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--mut)",flexShrink:0}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <div style={{display:"flex",flexDirection:"column",gap:1}}>
                      <span style={{fontSize:13,color:"var(--txt)",fontWeight:500}}>Export PDF</span>
                      <span style={{fontSize:10,color:"var(--mut)"}}>Print-ready exhibit</span>
                    </div>
                  </div>
                  {/* Automation */}
                  <div onClick={()=>{setAutomationOpen(o=>!o);setMobMenuOpen(false);}}
                    style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:9,borderTop:"1px solid var(--bd)"}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{color:"var(--mut)",flexShrink:0}}>
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                    <div style={{display:"flex",flexDirection:"column",gap:1}}>
                      <span style={{fontSize:13,color:"var(--txt)",fontWeight:500}}>Automation</span>
                      <span style={{fontSize:10,color:"var(--mut)"}}>Auto-status rules</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (<>
          {section==="projects" && (
            <button className={formatOpen ? "btn act" : "btn"} title="Format — row height & bar labels"
              onClick={()=>{setFormatOpen(o=>!o); setSettingsOpen(false); setAutomationOpen(false); setContactsOpen(false);}}
              style={{padding:"0 7px",height:21,display:"flex",alignItems:"center",marginRight:5}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
                <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
              </svg>
            </button>
          )}
          {/* Zoom — only in split/gantt. B1241744 — height reads `coarsePointer`, NOT `isMobile`:
              this branch also serves a phone in LANDSCAPE (832px+ clears the 768px isMobile
              threshold while the pointer stays exactly as coarse — the "iPad in landscape" case
              the phone decision names), which is where the reported "controls too small to hit"
              failure actually lived. A standard fine-pointer desktop measures coarsePointer=false
              and renders at the original 21px — pixel-identical to before. */}
          {section==="projects" && !isMobile && (data.view==="split"||data.view==="gantt") && (
            <div style={{display:"flex",alignItems:"center",gap:coarsePointer?4:1,paddingRight:5,borderRight:"1px solid var(--bd2)"}}>
              <button className="btn" style={{padding:coarsePointer?"0 12px":"0 6px",fontSize:coarsePointer?15:13,height:coarsePointer?44:21,minWidth:coarsePointer?44:undefined,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--bd2)"}} title="Zoom out" onClick={()=>setGanttPPD(z=>Math.max(1,Math.floor(z/1.35)))}>−</button>
              <span style={{fontSize:11,color:"var(--mut)",width:30,textAlign:"center",userSelect:"none"}}>{Math.round(ganttPPD/6*100)}%</span>
              <button className="btn" style={{padding:coarsePointer?"0 12px":"0 6px",fontSize:coarsePointer?15:13,height:coarsePointer?44:21,minWidth:coarsePointer?44:undefined,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--bd2)"}} title="Zoom in" onClick={()=>setGanttPPD(z=>Math.min(80,Math.ceil(z*1.35)))}>+</button>
            </div>
          )}

          {/* Export menu — deliverables only; data backup/restore lives in Version History */}
          <div style={{position:"relative"}}>
            {dlOpen && <div style={{position:"fixed",inset:0,zIndex:998}} onClick={()=>setDlOpen(false)} />}
            <button className="btn" onClick={()=>setDlOpen(o=>!o)} title="Export — PDF exhibit or web snapshot"
              style={{display:"flex",alignItems:"center",gap:4,padding:"0 8px",height:21,lineHeight:1}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              <span style={{fontSize:8,opacity:.5}}>▾</span>
            </button>
            {dlOpen && (
              <div style={{position:"absolute",top:"calc(100% + 5px)",right:0,background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:7,boxShadow:"0 4px 16px rgba(0,0,0,0.12)",zIndex:999,minWidth:192,padding:"4px 0",overflow:"hidden"}}>
                <div onClick={()=>{setPdfExportOpen(true);setDlOpen(false);}} style={{padding:"8px 14px",cursor:"pointer",display:"flex",flexDirection:"column",gap:2}} onMouseEnter={e=>e.currentTarget.style.background="#f6f8fa"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span style={{fontSize:12,color:"var(--txt)",fontWeight:500}}>PDF / Print Exhibit</span>
                  <span style={{fontSize:10,color:"var(--mut)"}}>Formatted pages — share or file</span>
                </div>
                <div style={{height:1,background:"var(--bd)",margin:"2px 0"}} />
                <div onClick={()=>{exportHTML();setDlOpen(false);}} style={{padding:"8px 14px",cursor:"pointer",display:"flex",flexDirection:"column",gap:2}} onMouseEnter={e=>e.currentTarget.style.background="#f6f8fa"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span style={{fontSize:12,color:"var(--txt)",fontWeight:500}}>Web Snapshot</span>
                  <span style={{fontSize:10,color:"var(--mut)"}}>Quick plain task tables · .html</span>
                </div>
              </div>
            )}
          </div>


          <div style={{width:1,height:20,background:"var(--bd2)",flexShrink:0}} />

          {/* Save indicator — sticky tri-state. Gray = saved (quiet). Amber = write
              in flight. RED = latest changes did NOT reach the cloud; stays red,
              retries automatically, click retries now. Green flash on each save. */}
          <button className="btn"
            onClick={saveStatus === "error"
              ? () => { if (latestData.current) attemptCloudSave(latestData.current); }
              : openFile}
            title={saveStatus === "error" ? "Changes NOT saved to cloud — retrying automatically. Click to retry now."
              : saveStatus === "saving" ? "Saving to cloud…"
              : (savePulse ? "Saved to cloud ✓" : "All changes saved to cloud")
                + (fileLinked ? " · also writing to linked file" : " — click to also back up to a local file")}
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"3px 8px",
              fontSize:11,fontWeight:600,
              color: saveStatus === "error" ? "#dc2626" : savePulse ? "#16a34a" : saveStatus === "saving" ? "#b45309" : "var(--mut)",
              borderColor: saveStatus === "error" ? "#fca5a5" : savePulse ? "#86efac" : (fileLinked ? "#bbf7d0" : undefined),
              background: saveStatus === "error" ? "#fef2f2" : savePulse ? "#f0fdf4" : undefined,
              boxShadow: savePulse && saveStatus !== "error" ? "0 0 0 3px #dcfce7" : "none",
              cursor: saveStatus === "saving" ? "progress" : undefined,
              transition:"color .25s, background .25s, border-color .25s, box-shadow .25s"}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            {saveStatus === "error" && "Not saved"}
          </button>


          {/* Version History — icon-only; tooltip names it */}
          <button data-testid="open-history-desktop" onClick={()=>{setHistoryOpen(true); setSettingsOpen(false); setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false);}}
            title="Version history — browse & restore snapshots"
            className={historyOpen ? "btn act" : "btn"}
            style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"3px 8px"}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
              <polyline points="12 7 12 12 15 14"/>
            </svg>
          </button>

          {/* Contacts — icon-only; tooltip names it */}
          <button onClick={()=>{setContactsOpen(o=>!o); setSettingsOpen(false); setAutomationOpen(false); setFormatOpen(false);}} title="Contacts"
            className={contactsOpen ? "btn act" : "btn"}
            style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"3px 8px"}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </button>

          {/* Automation */}
          <button onClick={()=>{setAutomationOpen(o=>!o); setSettingsOpen(false); setContactsOpen(false); setFormatOpen(false);}} title="Automation rules"
            className={automationOpen ? "btn act" : "btn"}
            style={{display:"flex",alignItems:"center",gap:5,fontSize:11,padding:"0 9px",height:21,lineHeight:1}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            Automation
          </button>

          {/* Settings */}
          <button onClick={()=>{setSettingsOpen(o=>!o); setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false);}} title="Settings"
            className={settingsOpen ? "btn act" : "btn"}
            style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"3px 8px"}}
          ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block"}}>
              <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg></button>
          </>)}

          {/* Settings — always visible (mobile + desktop) */}
          {isMobile && (
            <button onClick={()=>setSettingsOpen(o=>!o)} title="Settings"
              style={{background:settingsOpen?"#eef2ff":"none",border:"1px solid var(--bd2)",cursor:"pointer",
                fontFamily:"inherit",padding:"6px 8px",borderRadius:5,lineHeight:1,
                color:settingsOpen?"var(--amber)":"var(--mut)",transition:"all .12s"}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block"}}>
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          )}

        </div>
      </div>

      {settingsOpen    && <SettingsPanel    data={data} setData={setData} onClose={()=>setSettingsOpen(false)} openFile={openFile} fileLinked={fileLinked} initialSection={settingsSection} onOpenMeetingCalendars={()=>setMeetingCalOpen(true)} />}
      {meetingCalOpen  && <MeetingCalendarsModal
        projName={proj?.name}
        bodies={(activeProjectOf(data) || {}).meetingBodies || []}
        otherSchedules={otherScheduleMeetingBodies(data, data.aPid)}
        onChange={next => setData(d => {
          const p = d.projects && d.projects[d.aPid];
          if (!p) return d;
          const nd = {...d, projects:{...d.projects, [d.aPid]:{...p, meetingBodies: next}}};
          rebuildMeetingBodyIndex(nd);   // B816 — keep the global index fresh so the next cascade uses the edited cadence
          // Re-cascade immediately (same discipline as the Holidays editor): a cadence/lead edit must
          // move bound tasks + deadline rows NOW, not on the next unrelated task edit.
          const proj2 = nd.projects[nd.aPid];
          nd.projects = {...nd.projects, [nd.aPid]: {...proj2, tasks: recomputeSchedule((proj2.tasks || []).map(t => ({...t})))}};
          return nd;
        })}
        onClose={()=>setMeetingCalOpen(false)} />}
      {formatOpen      && <FormatPanel      data={data} setData={setData} onClose={()=>setFormatOpen(false)} />}
      {automationOpen  && <AutomationPanel  data={data} setData={setData} onClose={()=>setAutomationOpen(false)} />}
      {contactsOpen    && <ContactsPanel    data={data} setData={setData} onClose={()=>setContactsOpen(false)} />}
      {historyOpen     && <HistoryPanel     data={data} setData={setData} exportJSON={exportJSON} importJSON={importJSON} applyLoadedData={(parsed)=>applyLoadedDataRef.current?.(parsed)} onClose={()=>setHistoryOpen(false)} />}
      {successorPrompt && <SuccessorPromptModal prompt={successorPrompt} updateTask={updateTask} onClose={()=>setSuccessorPrompt(null)} onOpenTask={(pid, taskId)=>{ goToTask(pid, taskId); setSuccessorPrompt(null); }} />}
      {deleteChoice && (
        <DeleteChildrenModal
          rowCount={deleteChoice.rowCount}
          totalCount={deleteChoice.totalCount}
          onCascade={() => { deleteTasks(deleteChoice.ids); setSelectedId(null); setSelRange(null); setDeleteChoice(null); }}
          onPromote={() => { promoteAndDeleteTasks(deleteChoice.ids); setSelectedId(null); setSelRange(null); setDeleteChoice(null); }}
          onCancel={() => setDeleteChoice(null)}
        />
      )}
      {moveToCtx && (
        <MoveToModal
          tasks={(data.projects[moveToCtx.projId] || {}).tasks || []}
          sourceIds={moveToCtx.ids}
          onCommit={(destParentId, insertAfterId) => { moveSelectionByIds(moveToCtx.ids, destParentId, insertAfterId); setMoveToCtx(null); }}
          onCancel={() => setMoveToCtx(null)}
        />
      )}

      {/* BODY */}
      <div style={{flex:1,overflow:"hidden",display:"flex"}}>
        <ErrorBoundary key={data.view}>
        {/* B1281648 — effective view is just `data.view` at every width now (must match the
            toolbar-bridge copy above exactly). Split renders at every width — `SplitView` itself
            branches on `isMobile` (carried in `shared`) to stack its two panes vertically on a
            phone instead of the desktop's resizable side-by-side layout; Grid/Gantt are always
            full-height, single-pane, unchanged at any width. */}
        {section === "projects" && !reviewOpen && (data.view ?? "grid")==="grid"  && <GridView   {...shared} />}
        {section === "projects" && !reviewOpen && (data.view ?? "grid")==="gantt" && <GanttView  tasks={flatTasks} updateTask={updateTask} pxPerDay={ganttPPD} onZoomChange={setGanttPPD} rolledHealthMap={rolledHealthMap} proj={proj} onMouseEnter={()=>setHoverZone('gantt')} selectedId={selectedId} setSelectedId={setSelectedId} settings={data.settings} />}
        {section === "projects" && !reviewOpen && data.view==="split" && <SplitView  {...shared} />}
        {section === "reports"                         && <MasterView data={data} setData={setData} updateTask={updateTask} setNotesCtx={setNotesCtx} goToTask={goToTask} />}
        {section === "projects" && reviewOpen           && <SuggestionsView data={data} updateTask={updateTask} setData={setData} rows={reviewRows} setRows={setReviewRows} loading={reviewLoading} onClose={()=>setReviewOpen(false)} gridProps={shared} activeIdx={reviewIdx} setActiveIdx={setReviewIdx} />}
        </ErrorBoundary>
      </div>

      {liveNotesTask && (
        <NotesModal task={liveNotesTask} projectId={notesCtx.projectId} initChar={notesCtx?.initChar||null} updateTask={updateTask} onClose={() => setNotesCtx(null)} />
      )}
      {pdfExportOpen && (
        <PDFExportModal data={data} activePid={data.aPid} setData={setData} onClose={() => setPdfExportOpen(false)} />
      )}

      {iconPickerCtx && (
        <TaskIconPickerHost ctx={iconPickerCtx} tasks={(data.projects[iconPickerCtx.projId] || {}).tasks || []} updateTask={updateTask} onClose={() => setIconPickerCtx(null)} />
      )}

      {taskCtx && (
        <TaskContextMenu
          x={taskCtx.x} y={taskCtx.y}
          task={taskCtx.task}
          projId={taskCtx.projId}
          onInsertAbove={() => { insertTaskAbove(taskCtx.task.id); setTaskCtx(null); }}
          onInsertBelow={() => { insertTaskBelow(taskCtx.task.id); setTaskCtx(null); }}
          onAddSubtask={() => { addSubtask(taskCtx.task.id); setTaskCtx(null); }}
          onDuplicate={() => { duplicateTask(taskCtx.task.id); setTaskCtx(null); }}
          onCutTask={() => { cutTaskById(structuralTargets(taskCtx.task.id)); setTaskCtx(null); }}
          onCopyTaskFull={() => { copyTaskById(structuralTargets(taskCtx.task.id)); setTaskCtx(null); }}
          onPasteTask={() => { pasteTaskAfter(taskCtx.task.id); setTaskCtx(null); }}
          hasClipboard={!!clipboardRef.current}
          onIndent={() => { const ids = blockOnlyTargets(taskCtx.task.id); if (ids) indentSelectionByIds(ids); setTaskCtx(null); }}
          onOutdent={() => { const ids = blockOnlyTargets(taskCtx.task.id); if (ids) outdentSelectionByIds(ids); setTaskCtx(null); }}
          onMoveTo={() => { const ids = blockOnlyTargets(taskCtx.task.id); if (ids) setMoveToCtx({ ids, projId: taskCtx.projId }); setTaskCtx(null); }}
          canOutdent={(() => {
            const targets = structuralTargets(taskCtx.task.id);
            const ts = (data.projects[taskCtx.projId] || {}).tasks || [];
            const byId = new Map(ts.map(t => [t.id, t]));
            return targets.some(id => (byId.get(id)?.parentId ?? null) !== null);
          })()}
          meetingBodies={(data.projects[taskCtx.projId] || {}).meetingBodies || []}
          otherBodies={otherScheduleMeetingBodies(data, taskCtx.projId).flatMap(g => g.bodies.map(b => ({ pid: g.pid, schedName: g.schedName, body: b })))}
          bindCount={(() => { const ids = fullRowSelIds(); return ids.length > 1 && ids.includes(taskCtx.task.id) ? ids.length : 1; })()}
          boundTasks={(() => {
            // Bound LEAF tasks this row could serve as the deadline row for (exclude self + parents).
            const ts = (data.projects[taskCtx.projId] || {}).tasks || [];
            const parents = new Set(ts.filter(t => t.parentId != null).map(t => t.parentId));
            return ts.filter(t => t.meetingBound && t.meetingBodyId && t.id !== taskCtx.task.id && !parents.has(t.id)).map(t => ({ id: t.id, name: t.name || `Task ${t.id}` }));
          })()}
          deadlineAnchorName={(() => {
            if (taskCtx.task.deadlineForTaskId == null) return null;
            const a = ((data.projects[taskCtx.projId] || {}).tasks || []).find(t => t.id === taskCtx.task.deadlineForTaskId);
            return a ? (a.name || `Task ${a.id}`) : null;
          })()}
          onBindMeeting={bodyId => {
            // Right-click inside a multi-row selection binds the whole selection (mirror the delete semantics).
            // Binding clears any deadline link — the two snap modes are mutually exclusive.
            const ids = fullRowSelIds();
            const targets = ids.length > 1 && ids.includes(taskCtx.task.id) ? ids : [taskCtx.task.id];
            targets.forEach(id => updateTask(id, {meetingBound:true, meetingBodyId:bodyId, deadlineForTaskId:null}, taskCtx.projId));
            setTaskCtx(null);
          }}
          onUnbindMeeting={() => {
            const ids = fullRowSelIds();
            const targets = ids.length > 1 && ids.includes(taskCtx.task.id) ? ids : [taskCtx.task.id];
            targets.forEach(id => updateTask(id, {meetingBound:false, meetingBodyId:null, pinnedMeetingDate:undefined}, taskCtx.projId));
            setTaskCtx(null);
          }}
          onImportBindMeeting={(srcPid, srcBodyId) => {
            // NEW-1 (B1824576) — "reuse a meeting calendar from another schedule": copies the body
            // into THIS schedule (deduping against an identical-cadence body already here) and
            // binds the current selection to it, in one step. Mirrors onBindMeeting above, with
            // the copy-in as an extra setData ahead of the per-task updateTask loop.
            const ids = fullRowSelIds();
            const targets = ids.length > 1 && ids.includes(taskCtx.task.id) ? ids : [taskCtx.task.id];
            const projId = taskCtx.projId;
            const srcBody = ((data.projects[srcPid] || {}).meetingBodies || []).find(b => b.id === srcBodyId);
            if (!srcBody) { setTaskCtx(null); return; }
            const destBodies = (data.projects[projId] || {}).meetingBodies || [];
            const { bodies: nextBodies, id: newBodyId } = importMeetingBody(destBodies, srcBody);
            if (nextBodies !== destBodies) {
              setData(d => {
                const p = d.projects[projId];
                if (!p) return d;
                const nd = {...d, projects: {...d.projects, [projId]: {...p, meetingBodies: nextBodies}}};
                rebuildMeetingBodyIndex(nd);
                return nd;
              });
            }
            targets.forEach(id => updateTask(id, {meetingBound:true, meetingBodyId:newBodyId, deadlineForTaskId:null}, projId));
            setTaskCtx(null);
          }}
          onAddDeadlineRow={() => { addDeadlineTask(taskCtx.task.id, taskCtx.projId); setTaskCtx(null); }}
          onLinkAsDeadline={anchorId => { updateTask(taskCtx.task.id, {deadlineForTaskId: anchorId, meetingBound:false, meetingBodyId:null, pinnedMeetingDate:undefined}, taskCtx.projId); setTaskCtx(null); }}
          onUnlinkDeadline={() => { updateTask(taskCtx.task.id, {deadlineForTaskId: null}, taskCtx.projId); setTaskCtx(null); }}
          onAddMeetingCalendar={() => { setMeetingCalOpen(true); setSettingsOpen(false); setAutomationOpen(false); setContactsOpen(false); setFormatOpen(false); setTaskCtx(null); }}
          onStepMeeting={iso => { if (iso) updateTask(taskCtx.task.id, {pinnedMeetingDate: iso}, taskCtx.projId); setTaskCtx(null); }}
          onDelete={() => {
            // Right-click inside a multi-row selection deletes the whole selection — asks first
            // if any row in it has subtasks (requestDelete); otherwise deletes immediately.
            const ids = fullRowSelIds();
            requestDelete(ids.length > 1 && ids.includes(taskCtx.task.id) ? ids : [taskCtx.task.id]);
            setTaskCtx(null);
          }}
          deleteCount={(() => { const ids = fullRowSelIds(); return ids.length > 1 && ids.includes(taskCtx.task.id) ? ids.length : 1; })()}
          onSetHealth={hk => { updateTask(taskCtx.task.id, {health: hk}, taskCtx.projId); setTaskCtx(null); }}
          hasIcons={window.PlanyrTaskIcons.normalizeTaskIcons(taskCtx.task.icons).length > 0}
          onSetIcon={() => { setIconPickerCtx({taskId: taskCtx.task.id, projId: taskCtx.projId, x: taskCtx.x, y: taskCtx.y}); setTaskCtx(null); }}
          onRemoveIcon={() => { updateTask(taskCtx.task.id, {icons: []}, taskCtx.projId); setTaskCtx(null); }}
          fmt={ctxFmtState()}
          onSetRowColor={color => applyFormatAndSync({fill: color ?? null})}
          onSetBold={v   => applyFormatAndSync({bold: v})}
          onSetItalic={v => applyFormatAndSync({italic: v})}
          onSetUnderline={v => applyFormatAndSync({underline: v})}
          onSetTextColor={color => applyFormatAndSync({color: color ?? null})}
          onSetFontSize={size => applyFormatAndSync({size: size ?? null})}
          onClearFormat={() => applyFormatAndSync({}, {clearAll: true})}
          onClose={() => setTaskCtx(null)}
        />
      )}

      {projCtx && (
        <ProjContextMenu
          x={projCtx.x} y={projCtx.y}
          projId={projCtx.id}
          canDelete={true}
          onRename={() => { setRenameModal({id: projCtx.id, name: data.projects[projCtx.id]?.name || ""}); setProjCtx(null); }}
          onDuplicate={() => { duplicateProject(projCtx.id); setProjCtx(null); }}
          onDelete={() => { deleteProject(projCtx.id); setProjCtx(null); }}
          onClose={() => setProjCtx(null)}
        />
      )}

      {renameModal && (
        <RenameModal
          name={renameModal.name}
          onConfirm={name => { renameProject(renameModal.id, name); setRenameModal(null); }}
          onClose={() => setRenameModal(null)}
        />
      )}
    </div>
  );
}

// ── SplitView ─────────────────────────────────────────────
// B1281648 (RECURRENCE ×3 of B1241745) — dispatches to the phone-width stacked layout or the
// desktop resizable side-by-side layout. See PhoneSplitView's own header comment for why the
// phone shape changed from "one pane at a time" to "both panes, stacked."
function SplitView(props) {
  return props.isMobile ? <PhoneSplitView {...props} /> : <DesktopSplitView {...props} />;
}

// ── PhoneSplitView (stacked, B1281648) ───────────────────
// The owner's report, verbatim, on a real iPhone after three prior shipped fixes (#1490, #1497,
// #1504): "Nothing happens, it's stays or goes to gant or grid." Every prior fix kept Split
// showing exactly ONE pane at phone width (first via its own switcher, then via the header's
// existing Grid/Split/Gantt pill) — which is indistinguishable from just picking Grid or Gantt
// directly, so from his chair Split was a dead button no matter how correctly the pill's own
// highlight tracked it. THE FIX IS STRUCTURAL, not another highlight tweak: at phone width, Split
// now renders the task grid AND the Gantt chart at the same time, one above the other, each in
// its own independently-scrolling pane, with a visible divider between them — so it is
// immediately obvious Split is a third thing, never a relabelled Grid or Gantt. Grid and Gantt
// picked directly are UNCHANGED — still full-height, single-pane, at every width.
// Deliberately NOT draggable/resizable (unlike the desktop divider below) — a touch-drag divider
// risks fighting the page's own vertical scroll gestures, and the brief did not ask for resize;
// the split ratio reuses the existing Settings › "default split" percentage (the same number that
// already means "how much of Split's space goes to grid vs. gantt" on desktop) so a session that
// prefers more Gantt there gets the same preference here, clamped to a range that keeps either
// phone pane from shrinking to nothing.
function PhoneSplitView(props) {
  const settings = props.data?.settings || DEFAULT_SETTINGS;
  const topPct = Math.min(70, Math.max(30, settings.defaultSplit || 60));
  return (
    <div data-split-stack="1" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
      <div data-split-pane="grid" style={{flex:`0 0 ${topPct}%`,minHeight:0,overflow:"hidden",display:"flex"}}>
        <GridView {...props} />
      </div>
      <div data-split-divider="1" style={{height:9,flexShrink:0,background:"var(--bd2)",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{width:32,height:3,borderRadius:2,background:"var(--mut)",opacity:0.5}} />
      </div>
      <div data-split-pane="gantt" style={{flex:1,minHeight:0,overflow:"hidden",display:"flex"}}>
        <GanttView tasks={props.tasks} updateTask={props.updateTask} pxPerDay={props.ganttPPD} onZoomChange={props.setGanttPPD} rolledHealthMap={props.rolledHealthMap} proj={props.proj} onMouseEnter={()=>props.setHoverZone?.('gantt')} selectedId={props.selectedId} setSelectedId={props.setSelectedId} settings={props.data?.settings} rowZoom={props.gridZoom || 1} />
      </div>
    </div>
  );
}

// ── DesktopSplitView (resizable) ──────────────────────────
function DesktopSplitView(props) {
  const settings = props.data?.settings || DEFAULT_SETTINGS;
  const gridRef      = useRef(null);
  const ganttRef     = useRef(null);
  const [split, setSplit] = useState(() => settings.defaultSplit || 60);
  const containerRef = useRef(null);
  const divDragging  = useRef(false);
  const [snapMode, setSnapMode]     = useState(() => settings.snapDefault !== false);
  const [dragging,  setDragging]    = useState(false);
  const [_hintY,    setHintY]       = useState(0);
  const snapModeRef = useRef(settings.snapDefault !== false);
  useEffect(() => { snapModeRef.current = snapMode; }, [snapMode]);
  // Stay in sync when settings change
  useEffect(() => {
    const v = settings.snapDefault !== false;
    setSnapMode(v);
    snapModeRef.current = v;
  }, [settings.snapDefault]);

  // NEW-1 (2026-11-03) — keep the two panes level WITHOUT ever writing a stale value back at the pane being scrolled.
  // The old guard (`lock`, released on the next animation frame) ignored every second scroll event of the pane the
  // person was actually driving, and — because the rAF fires in the same frame as the echo event it was meant to
  // swallow — could let the OTHER pane's echo through, rewriting the driven pane to where it was a frame ago (which
  // also cancels a smooth wheel scroll in flight). Now: each programmatic write remembers the exact value it wrote, and
  // the scroll event that write causes is recognised by that value and dropped — nothing else is ever ignored.
  const echo = useRef({ grid: null, gantt: null });
  const sync = src => e => {
    const st = e.currentTarget.scrollTop, dst = src === "grid" ? "gantt" : "grid";
    if (echo.current[src] === st) { echo.current[src] = null; return; }          // our own write coming back
    echo.current[src] = null;
    const other = src === "grid" ? ganttRef.current : gridRef.current;
    if (!other || other.scrollTop === st) return;
    other.scrollTop = st;
    const landed = other.scrollTop;
    if (landed === st) {                                                          // a scroll event WILL follow — recognise it
      echo.current[dst] = landed;
      requestAnimationFrame(() => requestAnimationFrame(() => { if (echo.current[dst] === landed) echo.current[dst] = null; }));
    }
  };

  const liveColWidths = useRef(null); // updated by GridView via onColWidths

  const onDividerDown = e => {
    e.preventDefault();
    divDragging.current = true;
    setDragging(true);
    setHintY(e.clientY);
    // Measure the grid's vertical scrollbar width — it sits inside the grid pane and would otherwise cover the last column
    const gridScroll = containerRef.current.querySelector('[data-grid-scroll="1"]');
    const scrollbarW = gridScroll ? Math.max(0, gridScroll.offsetWidth - gridScroll.clientWidth) : 0;
    const snapOffset = scrollbarW + 2; // scrollbar + small breathing room past the column edge
    // Use actual rendered column widths if available, fall back to COLS defaults
    const cw = liveColWidths.current;
    // B212 — snap to the VISIBLE columns in their configured order (cw is {order, widths}).
    const order = (cw && cw.order) || DEFAULT_GRID_COLS;
    const widths = (cw && cw.widths) || {};
    const colEdges = order.reduce((acc, k) => { acc.push((acc[acc.length-1]||0) + (widths[k] ?? COL_BY_K[k]?.w ?? 100)); return acc; }, []);
    const move = ev => {
      if (!divDragging.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const rawPx = ev.clientX - rect.left;
      let pct;
      if (snapModeRef.current) {
        const nearest = colEdges.reduce((best, edge) =>
          Math.abs(edge - rawPx) < Math.abs(best - rawPx) ? edge : best, colEdges[0]);
        pct = Math.min(82, Math.max(18, (nearest + snapOffset) / rect.width * 100));
      } else {
        pct = Math.min(82, Math.max(18, rawPx / rect.width * 100));
      }
      setSplit(pct);
    };
    // Snap mode jumps the divider to the nearest column edge, so the pointer is routinely OUTSIDE the grab zone mid-drag.
    const release = window.pinSchedCursor("col-resize", { onExit: () => up() });
    const up = () => {
      divDragging.current = false;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      release();
      setTimeout(() => setDragging(false), 5000);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  return (
    <div ref={containerRef} style={{flex:1,display:"flex",overflow:"hidden",userSelect:"none"}}>
      <div style={{width:`${split}%`,overflow:"hidden",display:"flex",flexShrink:0}}>
        <GridView {...props} scrollRef={gridRef} onScroll={sync("grid")} onColWidths={w => { liveColWidths.current = w; }} />
      </div>
      <div style={{width:1,background:"var(--bd2)",cursor:"col-resize",flexShrink:0,zIndex:20,transition:"background .15s",position:"relative"}}
        onMouseDown={onDividerDown}
        onMouseEnter={e=>e.currentTarget.style.background="var(--blue)"}
        onMouseLeave={e=>e.currentTarget.style.background="var(--bd2)"}>
        {/* Grab zone extends only rightward into the Gantt — never back into the grid */}
        <div style={{position:"absolute",top:0,bottom:0,left:0,right:-9,cursor:"col-resize",zIndex:21}}
          onMouseDown={onDividerDown}
          onMouseEnter={e=>e.currentTarget.parentElement.style.background="var(--blue)"}
          onMouseLeave={e=>e.currentTarget.parentElement.style.background="var(--bd2)"} />
        {dragging && ReactDOM.createPortal(
          <div onMouseDown={e=>e.stopPropagation()}
            style={{position:"fixed", top: 12, right: 16, transform: "none",
              background:"#1f2328", borderRadius:6, padding:"3px 4px",
              display:"flex", gap:3, zIndex:9999, boxShadow:"0 2px 10px rgba(0,0,0,0.25)",
              pointerEvents:"all"}}>
            {[{label:"Snap", val:true},{label:"Free", val:false}].map(({label,val}) => (
              <span key={label}
                onMouseDown={e => { e.stopPropagation(); e.preventDefault(); setSnapMode(val); snapModeRef.current = val; }}
                style={{padding:"3px 10px", borderRadius:4, fontSize:11, cursor:"pointer",
                  fontFamily:"'Inter',system-ui,sans-serif", fontWeight:500, whiteSpace:"nowrap",
                  background: snapMode===val ? "var(--amber)" : "transparent",
                  color: snapMode===val ? "#fff" : "#9ca3af",
                  transition:"background .12s,color .12s"}}>
                {label}
              </span>
            ))}
          </div>,
          document.body
        )}
      </div>
      <div style={{flex:1,overflow:"hidden",display:"flex"}}>
        <GanttView tasks={props.tasks} updateTask={props.updateTask} pxPerDay={props.ganttPPD} onZoomChange={props.setGanttPPD} scrollRef={ganttRef} onScroll={sync("gantt")} rolledHealthMap={props.rolledHealthMap} proj={props.proj} onMouseEnter={()=>props.setHoverZone?.('gantt')} selectedId={props.selectedId} setSelectedId={props.setSelectedId} settings={props.data?.settings} rowZoom={props.gridZoom || 1} />
      </div>
    </div>
  );
}
installProjectOrderListener();

// ── Supabase cloud storage — syncs across all devices ──
// Layer 1: every save also writes to planar_history (throttled for 'auto' label).
// Layer 2: sanity-check refuses silent overwrite if task count drops drastically.
// Layer 3: RLS policies (server-side) prevent DELETE via anon key — see README.
(function() {
  // B408 consolidation (2026-07-11): scheduler data now lives in the MAIN Planyr project
  // (planyr-production, ref lyeqzkuiwngunutlkkmi) — same planar_* tables, data migrated + verified.
  const SUPABASE_URL = "https://lyeqzkuiwngunutlkkmi.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5ZXF6a3Vpd25ndW51dGxra21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNjc0NjMsImV4cCI6MjA5Njk0MzQ2M30.1jyFWeEPWDR4-YYu5azWbWQN8P48cgyZCBqfOwrAnlk";
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  window.__sb = sb;            // exposed for the Suggestions view (planar_suggestions subscribe)
  const TABLE = "planar_data";
  const HISTORY_TABLE = "planar_history";

  // Throttle auto-label history writes — keep at most one per AUTO_HISTORY_MS
  const AUTO_HISTORY_MS = 30 * 1000;
  let lastAutoHistoryAt = 0;

  // Sanity-check: if old data has >20 tasks and new payload has <50%, ask before overwriting
  const SANITY_MIN_TASKS = 20;
  const SANITY_DROP_RATIO = 0.5;

  // -- Concurrency guard -- a per-tab "version stamp" so a stale tab can't
  // silently overwrite newer data another device saved. The stamp (__rev) lives
  // inside the JSON value; this tab remembers the rev it loaded or last wrote
  // (knownRev[k]) and refuses any auto-save once the cloud has moved past it.
  const knownRev = {};
  const baseByKey = {};   // B864(b) — the doc THIS tab last loaded or saved (the 3-way merge ancestor)
  const staleSnapped = {};
  const revOf = (p) => (p && typeof p.__rev === "number") ? p.__rev : 0;

  // B1777120 — THE AUTHORITY FLIP: per-schedule-row primary write path. Parallel to
  // knownRev/baseByKey/staleSnapped above, but keyed per SCHEDULE id (string), since each
  // schedule is now its own CAS row once an account is flipped (schedule_account_index.
  // rows_authoritative — see schedules_authority_flip.sql). indexKnownRev/indexBase play the
  // same role for the one account-wide schedule_account_index row (settings/lastActiveBySite/
  // nPid/nTid/migration flags). Seeded exactly once per load, by readFromScheduleRows below.
  const scheduleKnownRev = {};
  const scheduleBase = {};
  const scheduleStaleSnapped = {};
  let indexKnownRev = 0;
  let indexBase = null;
  let scheduleRowsAuthoritative = false;   // mirrored onto window.storage.scheduleRowsAuthoritative below
  const scheduleLastAutoHistoryAt = {};    // per-schedule throttle, mirrors lastAutoHistoryAt but per id
  const SCHEDULE_SANITY_MIN_TASKS = 20;
  const SCHEDULE_SANITY_DROP_RATIO = 0.5;
  // mergeCloudDoc / _mStripRev / _deepClone are defined at module scope (B864(b)) so both this storage
  // layer AND the App's reconcile listener share one implementation.

  // B1777120 — THE AUTHORITY FLIP, read side. Authority is decided PER ACCOUNT by
  // schedule_account_index.rows_authoritative, set by an operator only after a fresh decompose
  // has been proven to reconstruct the live blob exactly (see schedules_authority_flip.sql) — an
  // account that has never been flipped reads the blob exactly as before this item shipped; this
  // is not a global switch. SCHEDULE_ROWS_FORCE_FLAG is a local dev/test override (force ON even
  // if the account isn't flipped); SCHEDULE_ROWS_DISABLE_FLAG is an emergency kill-switch (force
  // OFF even if flipped) an operator can hand a stuck browser without waiting on a deploy. Both
  // live in localStorage, never a shareable query param.
  const SCHEDULE_ROWS_FORCE_FLAG = "planar:scheduleRowsRead";
  const SCHEDULE_ROWS_DISABLE_FLAG = "planar:scheduleRowsDisable";
  const scheduleRowsForced = () => { try { return localStorage.getItem(SCHEDULE_ROWS_FORCE_FLAG) === "1"; } catch { return false; } };
  const scheduleRowsDisabled = () => { try { return localStorage.getItem(SCHEDULE_ROWS_DISABLE_FLAG) === "1"; } catch { return false; } };
  const setScheduleRowsAuthoritative = (v) => { scheduleRowsAuthoritative = v; try { window.storage.scheduleRowsAuthoritative = v; } catch {} };
  // Reads schedule_account_index + schedules and recomposes the "hs-v1" shape from them. Returns
  // null on ANY absence, disable-override, non-flipped account, or failure (RLS denial, a thrown
  // error) so the caller falls back to the blob unconditionally — never a partial or wrong
  // document. Attaches the REAL current __rev (a cheap separate read, same shape as checkRemote
  // below) so the existing knownRev bookkeeping in `get` stays correct for the returned blob-
  // shaped value. Also seeds the PER-SCHEDULE + index baselines (scheduleKnownRev/scheduleBase/
  // indexKnownRev/indexBase) the write path below diffs every future save against — this is the
  // ONLY place those are seeded, since a real page reads "hs-v1" exactly once per load.
  let rowsReadFailed = false;
  const readFromScheduleRows = async (k) => {
    try {
      if (k !== "hs-v1" || scheduleRowsDisabled()) { setScheduleRowsAuthoritative(false); return null; }
      const { data: userRes } = await sb.auth.getUser();
      const ownerUid = userRes && userRes.user && userRes.user.id;
      if (!ownerUid) { setScheduleRowsAuthoritative(false); return null; }
      const [idxRes, schedRes, revRes] = await Promise.all([
        sb.from("schedule_account_index").select("*").eq("user_id", ownerUid).maybeSingle(),
        sb.from("schedules").select("*").eq("user_id", ownerUid).is("deleted_at", null),
        sb.from(TABLE).select("rev:value->>__rev").eq("key", k).maybeSingle(),
      ]);
      // NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD) — an ERRORED read is not "this account isn't flipped": falling through
      // to the planar_data blob there would show (and let the user edit) a stale pre-flip copy of an account
      // whose real data lives in the rows. Flag it so get() reports a failed read instead.
      if (idxRes.error || schedRes.error) { rowsReadFailed = true; setScheduleRowsAuthoritative(false); return null; }
      if (!idxRes.data) { setScheduleRowsAuthoritative(false); return null; }
      const authoritative = !!idxRes.data.rows_authoritative || scheduleRowsForced();
      setScheduleRowsAuthoritative(authoritative);
      if (!authoritative) return null;
      const recomposed = recomposeFromRows(idxRes.data, schedRes.data);
      if (!recomposed) return null;
      Object.keys(scheduleKnownRev).forEach(kk => delete scheduleKnownRev[kk]);
      Object.keys(scheduleBase).forEach(kk => delete scheduleBase[kk]);
      (Array.isArray(schedRes.data) ? schedRes.data : []).forEach(row => {
        if (!row || row.id == null) return;
        const rk = String(row.id);
        scheduleKnownRev[rk] = typeof row.rev === "number" ? row.rev : 0;
        scheduleBase[rk] = row.data;
      });
      indexKnownRev = typeof idxRes.data.rev === "number" ? idxRes.data.rev : 0;
      indexBase = decomposeForDualWrite(recomposed).index;
      const rev = (revRes.data && revRes.data.rev != null) ? (parseInt(revRes.data.rev, 10) || 0) : 0;
      return { ...recomposed, __rev: rev };
    } catch {
      rowsReadFailed = true;   // a thrown read (network / timeout) — see the note on the errored read above
      setScheduleRowsAuthoritative(false);
      return null;
    }
  };

  // NEW-1 (false "A newer version was saved elsewhere" banner + empty "Merged in changes saved
  // elsewhere" toast on a flipped/rows_authoritative account, owner report 2026-09-25) —
  // readFromScheduleRows above necessarily seeds scheduleBase from the RAW stored row.data (it runs
  // before the App's normalize pipeline exists at all), but the in-app document is NEVER byte-equal
  // to that raw row: normalizeToV8/normalizeIds/ensureContacts/normalizeOwnerLists/
  // recascadeWithDrift rebuild every task object, and stripViewState strips the 13 top-level
  // view-state keys plus each task's own `focused`. So writeScheduleRowsPrimary's
  // `_mEq(s.data, base)` no-op check (below) was comparing apples to oranges on the FIRST save of
  // every load -- every schedule read as "changed" and got rewritten even with zero user edits,
  // which is exactly what made concurrent instances of the same idle account refuse each other's
  // writes (measured: three identical-rev refusals on one schedule inside one second) and raise the
  // banner over content that was never actually in conflict.
  //
  // Called once, right after the App finishes normalizing a freshly loaded/restored/seeded doc (the
  // load effect below, every path that produces a `d` it is about to hand to setData), so storage
  // holds the SAME shape it will actually diff against on the very next save -- making that save a
  // genuine no-op instead of a full rewrite. `doc` is handed in BEFORE stripViewState (same as
  // attemptCloudSave's own caller does) -- this applies the identical strip itself so the baseline
  // matches exactly what a real save would send. Deliberately leaves scheduleKnownRev untouched:
  // revs came from the real rows in readFromScheduleRows, and normalizing the DOCUMENT never moves
  // which rev the DATABASE is at. A no-op (silent return) for an account that isn't flipped, or
  // before readFromScheduleRows has run at all this session.
  const reseedScheduleBaseline = (doc) => {
    try {
      if (!scheduleRowsAuthoritative || !doc || typeof doc !== "object" || !doc.projects) return;
      const decomposed = decomposeForDualWrite(stripViewState(doc));
      if (!decomposed) return;
      decomposed.schedules.forEach(s => { scheduleBase[String(s.id)] = _deepClone(s.data); });
      indexBase = _deepClone(decomposed.index);
    } catch {}
  };

  const countTasks = (parsed) => {
    try {
      if (!parsed || !parsed.projects) return 0;
      return Object.values(parsed.projects).reduce((n, p) => n + (p.tasks?.length || 0), 0);
    } catch { return 0; }
  };
  const countProjects = (parsed) => {
    try { return Object.keys(parsed?.projects || {}).length; } catch { return 0; }
  };

  // Retention: keep the newest KEEP_SNAPSHOTS rows per key; prune the rest.
  // Without this the table grows by a full copy of the dataset every ~30s of
  // editing, forever — which bloats the database and slows everything down.
  const KEEP_SNAPSHOTS = 120;
  let _snapCount = 0;
  const _prune = async (k) => {
    try {
      // Find the timestamp of the (KEEP+1)th-newest snapshot, delete older.
      const { data, error } = await sb.from(HISTORY_TABLE)
        .select("created_at").eq("key", k)
        .order("created_at", { ascending: false })
        .range(KEEP_SNAPSHOTS, KEEP_SNAPSHOTS);
      if (error || !data || !data.length) return;
      const { error: delErr } = await sb.from(HISTORY_TABLE)
        .delete().eq("key", k).lt("created_at", data[0].created_at);
      if (delErr && !_prune._warned) {
        _prune._warned = true;
        console.warn("history prune blocked (RLS?). Run periodically in SQL editor:",
          "delete from planar_history where id not in (select id from planar_history order by created_at desc limit " + KEEP_SNAPSHOTS + ");");
      }
    } catch {}
  };

  // Insert a history row. Best-effort — fails silently if table doesn't exist
  // or RLS blocks the insert. Never blocks the main save.
  const _snapshot = async (k, parsed, label, byteSize) => {
    try {
      const { error } = await sb.from(HISTORY_TABLE).insert({
        key: k,
        value: parsed,
        label: label || "auto",
        task_count: countTasks(parsed),
        project_count: countProjects(parsed),
        byte_size: byteSize,
      });
      if (error) {
        // Only warn on first failure per session — table likely doesn't exist yet
        if (!_snapshot._warned) { _snapshot._warned = true; console.warn("history snapshot failed (run setup SQL?):", error.message); }
      } else if ((++_snapCount % 10) === 1) {
        _prune(k);   // fire-and-forget, every ~10th snapshot
      }
    } catch (e) {
      if (!_snapshot._warned) { _snapshot._warned = true; console.warn("history snapshot exception:", e); }
    }
  };

  // B1777120 — best-effort, non-blocking mirror of a successful "hs-v1" cloud save into the
  // normalized public.schedules / public.schedule_account_index tables. planar_data stays
  // authoritative — this NEVER blocks, retries, or surfaces an error into the primary save
  // path (called fire-and-forget from _rawSet, never awaited); a failure here is reported
  // (LOUD-FAILURE, via console.warn — there is no user-facing surface for a background mirror
  // that changes nothing the user can see) and simply tried again on the next save.
  // Deliberately does NOT tombstone a schedule that disappeared from this save's projects —
  // that reconciliation is schedules_decompose_from_planar_data()'s job (re-run by hand via
  // the Supabase MCP), kept out of the hot client save path on purpose. See
  // schedules_normalization.sql's header for why this is scaffolding, not the authority flip:
  // nothing anywhere in this app reads from these two tables yet except the opt-in dual-read
  // path below, which defaults off.
  const _dualWriteWarned = { flag: false };
  const dualWriteScheduleRows = async (k, doc) => {
    try {
      if (k !== "hs-v1") return;   // only the one real document shape this decomposes
      const decomposed = decomposeForDualWrite(doc);
      if (!decomposed) return;
      const { data: userRes } = await sb.auth.getUser();
      const ownerUid = userRes && userRes.user && userRes.user.id;
      if (!ownerUid) return;   // signed out — nothing to attribute rows to

      await sb.from("schedule_account_index").upsert({
        user_id: ownerUid,
        n_pid: decomposed.index.nPid,
        n_tid: decomposed.index.nTid,
        last_active_by_site: decomposed.index.lastActiveBySite,
        settings: decomposed.index.settings,
        migration_flags: decomposed.index.migrationFlags,
      }, { onConflict: "user_id" });

      if (!decomposed.schedules.length) return;
      const { data: existingRows } = await sb.from("schedules").select("id, rev").eq("user_id", ownerUid);
      const revById = new Map((existingRows || []).map(r => [r.id, r.rev]));
      const rows = decomposed.schedules.map(s => ({
        id: s.id,
        user_id: ownerUid,
        linked_site_id: s.linkedSiteId,
        linked_site_name: s.linkedSiteName,
        name: s.name,
        data: s.data,
        // Strictly-increasing on every dual-write so schedules_enforce_version_monotonic never
        // refuses it. A refusal here (a race with another concurrent dual-write) is harmless —
        // the whole point of this mirror is that it's best-effort; the NEXT save fixes it.
        rev: (revById.has(s.id) ? revById.get(s.id) : -1) + 1,
        deleted_at: null,
      }));
      await sb.from("schedules").upsert(rows, { onConflict: "id" });
    } catch (e) {
      if (!_dualWriteWarned.flag) { _dualWriteWarned.flag = true; console.warn("[schedule dual-write] best-effort decompose failed (planar_data is unaffected):", e); }
    }
  };

  // B1777120 — THE AUTHORITY FLIP, write side. Everything below is reached ONLY when
  // scheduleRowsAuthoritative is true for the signed-in account (readFromScheduleRows already
  // proved a real, migrated schedule_account_index row exists) — an account that has never been
  // flipped never calls any of this and keeps writing the blob exactly as before.

  // Per-schedule history: reuses planar_history (same table, schema, RLS, pruning) with a new
  // key shape ("schedule:<id>") instead of the whole-account "hs-v1" — "write new [snapshots]
  // per schedule" per this item's own acceptance text. Fire-and-forget, matching _snapshot's own
  // non-blocking shape; task_count/project_count are computed for a SINGLE project object, not a
  // whole doc, so this does not reuse _snapshot/countTasks/countProjects directly.
  const writeScheduleHistorySnapshot = (scheduleId, projData, label) => {
    try {
      if ((label || "auto") === "auto") {
        const now = Date.now();
        const last = scheduleLastAutoHistoryAt[scheduleId] || 0;
        if (now - last < AUTO_HISTORY_MS) return;
        scheduleLastAutoHistoryAt[scheduleId] = now;
      }
      const taskCount = (projData && Array.isArray(projData.tasks)) ? projData.tasks.length : 0;
      let byteSize = 0; try { byteSize = JSON.stringify(projData).length; } catch {}
      sb.from(HISTORY_TABLE).insert({
        key: "schedule:" + scheduleId, value: projData, label: label || "auto",
        task_count: taskCount, project_count: 1, byte_size: byteSize,
      }).then(({ error }) => {
        if (error && !writeScheduleHistorySnapshot._warned) {
          writeScheduleHistorySnapshot._warned = true;
          console.warn("per-schedule history snapshot failed (run setup SQL?):", error.message);
        }
      });
    } catch (e) {
      if (!writeScheduleHistorySnapshot._warned) { writeScheduleHistorySnapshot._warned = true; console.warn("per-schedule history snapshot exception:", e); }
    }
  };

  // The guarded write for ONE schedules row. `.select("id")` is required to SEE a refusal —
  // same reasoning as _rawSet's own attemptWrite below (a bare `.update()` with no `.select()`
  // sends `Prefer: return=minimal`, so PostgREST reports success whether
  // schedules_enforce_version_monotonic silently skipped the row or genuinely wrote it).
  const attemptScheduleWrite = async (id, data, baseRev) => {
    const newRev = (typeof baseRev === "number" ? baseRev : 0) + 1;
    const { data: rows, error } = await sb.from("schedules").update({
      data, rev: newRev,
      name: (data && typeof data.name === "string") ? data.name : "",
      linked_site_id: (data && data.linkedSiteId != null) ? data.linkedSiteId : null,
      linked_site_name: (data && data.linkedSiteName != null) ? data.linkedSiteName : null,
    }).eq("id", id).select("id");
    return { error, refused: !error && Array.isArray(rows) && rows.length === 0, newRev };
  };

  // Guarded write for ONE schedule — mirrors _rawSet's own Layer 0/2 + CAS-retry-once shape,
  // scoped to a single row so a stale write to schedule A can never touch schedule B (B1777120
  // acceptance: "a write to one schedule cannot modify another schedule's row").
  const writeOneScheduleRow = async (ownerUid, id, newData, { skipSanity, label }) => {
    const key = String(id);
    const curRev = scheduleKnownRev[key];
    const curData = scheduleBase[key];

    if (curRev === undefined) {
      // Unknown to this tab — a restore/import resurrecting an id (NEVER a race two tabs could
      // hit for a genuinely NEW schedule: addProject/duplicateProject always insert the row
      // FIRST and seed scheduleBase before that id can ever reach this path — see those
      // functions). Try a fresh INSERT; a 23505 conflict means the row already existed (another
      // tab's own insert, or this tab's cache was simply behind), so fall through to the
      // ordinary guarded update below, which re-reads fresh regardless.
      const { error: insErr } = await sb.from("schedules").insert({
        id, user_id: ownerUid, name: (newData && newData.name) || "", data: newData, rev: 0,
        linked_site_id: (newData && newData.linkedSiteId != null) ? newData.linkedSiteId : null,
        linked_site_name: (newData && newData.linkedSiteName != null) ? newData.linkedSiteName : null,
      });
      if (!insErr) {
        scheduleKnownRev[key] = 0; scheduleBase[key] = _deepClone(newData);
        writeScheduleHistorySnapshot(id, newData, label);
        return { merged: null };
      }
      if (insErr.code !== "23505") { console.error("[schedule rows] insert failed for schedule " + id + ":", insErr); return null; }
    } else if (!skipSanity) {
      const oldN = (curData && Array.isArray(curData.tasks)) ? curData.tasks.length : 0;
      const newN = (newData && Array.isArray(newData.tasks)) ? newData.tasks.length : 0;
      if (oldN > SCHEDULE_SANITY_MIN_TASKS && newN < oldN * SCHEDULE_SANITY_DROP_RATIO) {
        writeScheduleHistorySnapshot(id, curData, "safety-block");
        console.error("[schedule guard] Refused save for schedule " + id + ": tasks would drop " + oldN + " -> " + newN + ".");
        if (typeof showToast === "function") showToast("Save blocked for one schedule -- tasks would drop " + oldN + "->" + newN + ". Old state backed up.", { type: "error", duration: 6000 });
        return null;
      }
    }

    const baseRev = scheduleKnownRev[key] || 0;
    let attempt = await attemptScheduleWrite(id, newData, baseRev);
    if (attempt.error) { console.error("[schedule rows] write error for schedule " + id + ":", attempt.error); return null; }

    let payload = newData, mergedResult = null;
    if (attempt.refused) {
      const { data: row2, error: readErr } = await sb.from("schedules").select("data, rev").eq("id", id).maybeSingle();
      if (readErr || !row2) {
        if (!scheduleStaleSnapped[key]) { scheduleStaleSnapped[key] = true; writeScheduleHistorySnapshot(id, newData, "stale-block"); }
        console.error("[schedule guard] Write refused for schedule " + id + " and the current row could not be re-read afterward.");
        return null;
      }
      // NEW-1 (false "newer version"/empty-merge-toast on a flipped account, owner report
      // 2026-09-25) — a refusal whose cloud content is BYTE-IDENTICAL to what this tab tried to
      // write is not a conflict: some OTHER instance of this same account (another keep-alive
      // Scheduler iframe, another open tab) already wrote the identical data and bumped rev first.
      // Adopt its rev/data and stop here — no second CAS write, no stale-block snapshot, no
      // premerge-ours snapshot, no merge dance. Without this, every such race (measured live: three
      // identical-rev refusals on one schedule id inside one second) fell through to a real 3-way
      // merge attempt that could itself lose the race and raise the "saved elsewhere" banner over
      // content that was never actually in conflict.
      if (_mEq(row2.data, newData)) {
        scheduleKnownRev[key] = row2.rev;
        scheduleBase[key] = _deepClone(row2.data);
        scheduleStaleSnapped[key] = false;
        return { merged: null };
      }
      const base = scheduleBase[key];
      let merged = null;
      if (base !== undefined) { try { merged = mergeCloudDoc(base, newData, row2.data); } catch (e) { merged = null; } }
      if (!merged || !_mIsObj(merged)) {
        if (!scheduleStaleSnapped[key]) { scheduleStaleSnapped[key] = true; writeScheduleHistorySnapshot(id, newData, "stale-block"); }
        console.error("[schedule guard] Save blocked for schedule " + id + " (merge unavailable): cloud rev " + row2.rev + " is ahead of this tab.");
        return null;
      }
      // NEW-1 (same item) — the 3-way merge can itself resolve to exactly what the cloud row
      // already holds (this tab's own intended change was already fully present there via someone
      // else's write). Adopt without a second write rather than re-sending an identical payload.
      if (_mEq(merged, row2.data)) {
        scheduleKnownRev[key] = row2.rev;
        scheduleBase[key] = _deepClone(row2.data);
        scheduleStaleSnapped[key] = false;
        return { merged: null };
      }
      writeScheduleHistorySnapshot(id, newData, "premerge-ours");
      attempt = await attemptScheduleWrite(id, merged, row2.rev);
      if (attempt.error || attempt.refused) {
        if (!scheduleStaleSnapped[key]) { scheduleStaleSnapped[key] = true; writeScheduleHistorySnapshot(id, merged, "stale-block"); }
        console.error("[schedule guard] Save blocked for schedule " + id + ": lost the race twice in a row.");
        return null;
      }
      payload = merged; mergedResult = merged;
    }

    scheduleKnownRev[key] = attempt.newRev;
    scheduleBase[key] = _deepClone(payload);
    scheduleStaleSnapped[key] = false;
    writeScheduleHistorySnapshot(id, payload, label);
    return { merged: mergedResult };
  };

  // Guarded write for the ONE schedule_account_index row (settings/lastActiveBySite/nPid/nTid/
  // migration flags) — same CAS-retry-once shape as writeOneScheduleRow, independent of every
  // schedule row so a settings change never contends with a task edit in any schedule.
  const writeIndexRow = async (ownerUid, newIndex) => {
    const baseRev = indexKnownRev || 0;
    const newRev = baseRev + 1;
    const payload = {
      n_pid: newIndex.nPid, n_tid: newIndex.nTid, last_active_by_site: newIndex.lastActiveBySite,
      settings: newIndex.settings, migration_flags: newIndex.migrationFlags,
      rows_authoritative: true, rev: newRev,
    };
    const { data: rows, error } = await sb.from("schedule_account_index").update(payload).eq("user_id", ownerUid).select("user_id");
    if (error) { console.error("[schedule rows] index write error:", error); return null; }
    if (!(Array.isArray(rows) && rows.length === 0)) {
      indexKnownRev = newRev; indexBase = _deepClone(newIndex);
      return { merged: null };
    }
    const { data: row2, error: readErr } = await sb.from("schedule_account_index").select("*").eq("user_id", ownerUid).maybeSingle();
    if (readErr || !row2) { console.error("[schedule rows] index write refused and could not be re-read afterward"); return null; }
    const rowIndex = { nPid: row2.n_pid, nTid: row2.n_tid || {}, lastActiveBySite: row2.last_active_by_site || {}, settings: row2.settings || {}, migrationFlags: row2.migration_flags || {} };
    let merged = null;
    if (indexBase !== null) { try { merged = mergeCloudDoc(indexBase, newIndex, rowIndex); } catch (e) { merged = null; } }
    if (!merged) { console.error("[schedule rows] index write blocked -- merge unavailable"); return null; }
    const { data: rows2, error: err2 } = await sb.from("schedule_account_index").update({
      n_pid: merged.nPid, n_tid: merged.nTid, last_active_by_site: merged.lastActiveBySite,
      settings: merged.settings, migration_flags: merged.migrationFlags,
      rows_authoritative: true, rev: row2.rev + 1,
    }).eq("user_id", ownerUid).select("user_id");
    if (err2 || (Array.isArray(rows2) && rows2.length === 0)) { console.error("[schedule rows] index write blocked -- lost the race twice"); return null; }
    indexKnownRev = row2.rev + 1; indexBase = _deepClone(merged);
    return { merged };
  };

  // THE PRIMARY WRITE PATH for a flipped account — decomposes the whole "hs-v1"-shaped doc into
  // ONLY the pieces that actually changed since this tab's own last-known-good baseline, and
  // writes each independently: a write to one schedule can never modify another's row (B1777120
  // acceptance criterion, proven by construction — each writeOneScheduleRow call targets exactly
  // one `id`). Reassembles a whole-doc `planar:merged` event when anything merged so the App's
  // existing reconcile listener (mergeCloudDoc(ancestor, current, merged)) needs no changes at
  // all — it already treats "everything except a couple of fields is byte-identical to what I
  // sent" as "only those fields changed elsewhere", which is exactly what happened.
  const writeScheduleRowsPrimary = async (parsed, v, { skipSanity, label }) => {
    const { data: userRes } = await sb.auth.getUser();
    const ownerUid = userRes && userRes.user && userRes.user.id;
    if (!ownerUid) { console.error("[schedule rows] no signed-in user -- cannot save"); return null; }

    const decomposed = decomposeForDualWrite(parsed);
    if (!decomposed) return null;

    let mergedForApp = null;
    let anythingMerged = false;
    let anyFailure = false;
    let deleteRefused = false;   // B2429233 — a soft-delete the database refused (not a stale-tab condition: no "reload" banner)
    const ensureMergedForApp = () => { if (!mergedForApp) mergedForApp = _deepClone(parsed); return mergedForApp; };

    if (indexBase === null || !_mEq(decomposed.index, indexBase)) {
      const idxResult = await writeIndexRow(ownerUid, decomposed.index);
      if (idxResult === null) {
        anyFailure = true;
      } else if (idxResult.merged) {
        const m = ensureMergedForApp();
        m.nPid = idxResult.merged.nPid; m.nTid = idxResult.merged.nTid;
        m.lastActiveBySite = idxResult.merged.lastActiveBySite; m.settings = idxResult.merged.settings;
        Object.assign(m, idxResult.merged.migrationFlags);
        anythingMerged = true;
      }
    }

    const currentIds = new Set(decomposed.schedules.map(s => String(s.id)));
    for (const s of decomposed.schedules) {
      const key = String(s.id);
      const base = scheduleBase[key];
      if (base !== undefined && _mEq(s.data, base)) continue;   // unchanged -- nothing to write
      const result = await writeOneScheduleRow(ownerUid, s.id, s.data, { skipSanity, label });
      if (result === null) { anyFailure = true; continue; }
      if (result.merged) {
        const m = ensureMergedForApp();
        m.projects = { ...m.projects, [key]: result.merged };
        anythingMerged = true;
      }
    }

    for (const key of Object.keys(scheduleBase)) {
      if (currentIds.has(key)) continue;   // still present -- nothing to tombstone
      // B2429233 LOUD-FAILURE — supabase-js RETURNS {error} instead of throwing, so the old try/catch
      // never saw a refused soft-delete and the schedule base was dropped as if it had worked: the
      // row stayed in the database and came back on reload with nothing said. Check the result (an
      // error, or zero rows touched = refused by RLS), keep the base so the NEXT save retries it,
      // and say so.
      let softDeleteFailed = null;
      try {
        const sd = await sb.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", Number(key)).select("id");
        if (sd.error) softDeleteFailed = sd.error;
        else if (!Array.isArray(sd.data) || sd.data.length === 0) softDeleteFailed = { message: "no row was updated", code: "0 rows" };
      } catch (e) { softDeleteFailed = e; }
      if (softDeleteFailed) {
        console.error("[schedule rows] soft-delete failed for schedule " + key, softDeleteFailed);
        deleteRefused = true;
        try {
          const now = Date.now();
          if (now - (window.__planarSaveFailToastAt || 0) >= 8000) {
            window.__planarSaveFailToastAt = now;
            if (typeof showToast === "function") showToast("A deleted schedule could NOT be removed from the cloud (" + (softDeleteFailed.code || softDeleteFailed.status || "error") + "). It may come back when you reload — try the delete again.", { type: "error", duration: 10000 });
            window.dispatchEvent(new CustomEvent("planar:cloud-save-failed", { detail: { key: "hs-v1", code: softDeleteFailed.code } }));
          }
        } catch (e) {}
        continue;
      }
      delete scheduleBase[key]; delete scheduleKnownRev[key]; delete scheduleStaleSnapped[key];
    }

    if (anythingMerged) {
      try { window.dispatchEvent(new CustomEvent("planar:merged", { detail: { key: "hs-v1", base: _deepClone(parsed), value: mergedForApp } })); } catch {}
    }
    if (deleteRefused) return null;   // already toasted + planar:cloud-save-failed above; never announce "saved"
    try { window.dispatchEvent(new CustomEvent("planar:cloud-saved", { detail: { key: "hs-v1" } })); } catch {}

    if (anyFailure && !anythingMerged) {
      try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: "hs-v1" } })); } catch {}
      return null;
    }
    return { key: "hs-v1", value: v };
  };

  window.storage = {
    scheduleRowsAuthoritative: false,   // B1777120 — live-updated by setScheduleRowsAuthoritative; read by addProject/duplicateProject
    // NEW-1 (2026-09-25) — see reseedScheduleBaseline's own header above.
    reseedScheduleBaseline,
    // NEW-1 (2026-09-25) — re-reads the real schedule rows + index row and reseeds every baseline
    // from them (readFromScheduleRows already does the reseeding as a side effect; this just gives
    // the App a way to trigger that read on demand). Used by the live-refresh poll below to catch a
    // clean, visible tab up SILENTLY when another instance of the same account wrote first, instead
    // of nagging it with the "reload for the latest" banner over content it has nothing of its own
    // to lose. Returns the recomposed doc (same shape `get` returns) or null for an account that
    // isn't flipped / has no rows yet / hit a read error.
    silentRefresh: async (k) => {
      try {
        if (k !== "hs-v1" || !scheduleRowsAuthoritative) return null;
        return await readFromScheduleRows(k);
      } catch { return null; }
    },
    get: async (k) => {
      try {
        if (k === "hs-v1") { rowsReadFailed = false; window.__planarHs1Read = "pending"; }
        // B1777120 — THE AUTHORITY FLIP: readFromScheduleRows itself decides whether this
        // account is flipped (schedule_account_index.rows_authoritative), the disable
        // kill-switch, and the dev force-on override — this call is unconditional for "hs-v1"
        // and returns null (falling straight through to the blob read below, exactly as before
        // this item shipped) for every account that has not been deliberately flipped.
        if (k === "hs-v1") {
          const fromRows = await readFromScheduleRows(k);
          if (fromRows) {
            const val = JSON.stringify(fromRows);
            knownRev[k] = revOf(fromRows);
            baseByKey[k] = _mStripRev(_deepClone(fromRows));
            window.__planarHs1Read = "ok";
            return { key: k, value: val };
          }
          if (rowsReadFailed) { window.__planarCloudError = true; window.__planarHs1Read = "error"; return null; }
        }
        const { data, error } = await sb.from(TABLE).select("value").eq("key", k).single();
        if (error || !data) {
          // PGRST116 = "no rows" — a clean empty table, not an outage.
          // 42501 = RLS/grant denied this request — signed out or not on the schedule's
          // team, not a connectivity problem (B778/NEW-1: planar_data now requires an
          // authenticated, owner-or-team-scoped request).
          if (error && error.code === "42501") { window.__planarAuthRequired = true; if (k === "hs-v1") window.__planarHs1Read = "auth"; }
          else if (error && error.code !== "PGRST116") { window.__planarCloudError = true; if (k === "hs-v1") window.__planarHs1Read = "error"; }
          else if (k === "hs-v1") window.__planarHs1Read = "empty";
          return null;
        }
        if (k === "hs-v1") window.__planarHs1Read = "ok";
        const val = typeof data.value === "string" ? data.value : JSON.stringify(data.value);
        try { const p = typeof data.value === "string" ? JSON.parse(data.value) : data.value; knownRev[k] = revOf(p); baseByKey[k] = _mStripRev(_deepClone(p)); } catch { knownRev[k] = 0; }
        return { key: k, value: val };
      } catch { window.__planarCloudError = true; if (k === "hs-v1") window.__planarHs1Read = "error"; return null; }
    },
    // The unserialized write — see the `set` wrapper below, which is what callers actually use.
    _rawSet: async (k, v, opts = {}) => {
      try {
        // NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD) — THE WRITE GUARD. No hs-v1 write may leave this page unless the
        // document was really READ first: a read that is still pending or that failed means whatever this
        // page holds (nothing, or the embedded demo copy) is NOT the account's data, and writing it would
        // overwrite the cloud with an empty/partial list. Refused loudly, never queued, never retried here.
        if (k === "hs-v1" && (window.__planarHs1Read === undefined || window.__planarHs1Read === "pending" || window.__planarHs1Read === "error")) {
          console.error("[planar guard] hs-v1 write refused: the schedule document has not been read from the cloud (" + (window.__planarHs1Read || "unread") + "). Nothing was written.");
          try { window.dispatchEvent(new CustomEvent("planar:write-refused-unloaded", { detail: { key: k, read: window.__planarHs1Read || "unread" } })); } catch {}
          return null;
        }
        let parsed;
        try { parsed = JSON.parse(v); } catch { parsed = v; }

        const label = opts.label || "auto";
        const isAuto = label === "auto";
        const skipSanity = !!opts.skipSanity;

        // B1777120 — THE AUTHORITY FLIP, write side. Once this account is flipped, an "hs-v1"
        // save no longer touches planar_data at all -- it decomposes into per-schedule/per-index
        // CAS writes. planar_data_refuse_post_flip_write (schedules_authority_flip.sql) is the
        // database-level backstop for a stale cached tab whose JS predates this branch and still
        // reaches the code below anyway.
        if (k === "hs-v1" && scheduleRowsAuthoritative && parsed && typeof parsed === "object" && parsed.projects) {
          return await writeScheduleRowsPrimary(parsed, v, { skipSanity, label });
        }

        // Read the current cloud row ONCE -- used for both the concurrency guard
        // (Layer 0) and the task-drop sanity check (Layer 2). If the read fails,
        // cloudRev stays null and we fail "open" (let the save proceed).
        let cloudRev = null, oldParsed = null;
        if (parsed && typeof parsed === "object" && parsed.projects) {
          try {
            const cur = await sb.from(TABLE).select("value").eq("key", k).single();
            if (cur.data && cur.data.value) {
              oldParsed = typeof cur.data.value === "string" ? JSON.parse(cur.data.value) : cur.data.value;
              cloudRev = revOf(oldParsed);
            } else if (cur.error && cur.error.code === "PGRST116") {
              cloudRev = 0;
            }
          } catch (e) { /* read failed -- leave cloudRev null (fail open) */ }
        }

        // NEW-1 (false-conflict/merge-toast inflation, owner report 2026-09-17) — an autosave whose
        // content is UNCHANGED from what's already on the cloud (ignoring __rev) must never write at
        // all: no upsert, no rev bump, no history snapshot, no merge dance. Without this, a tab whose
        // ONLY "edit" was view-state churn that leaked into core data (a per-task field the
        // stripViewState pass above missed, the measured case being `focused`) still round-trips a
        // save that bumps __rev — which every OTHER open tab then reads as a genuine conflict, purely
        // from a tab that changed nothing a person would call an edit. This tab still converges:
        // knownRev/baseByKey are updated from the read already done, so the next REAL edit compares
        // against the true current cloud state. A miss here (key-order differences JSON.stringify is
        // sensitive to) just falls through to a redundant-but-harmless write — the existing behavior
        // — never the reverse: a genuine content difference can never be mistaken for a no-op.
        if (isAuto && !skipSanity && oldParsed && cloudRev != null && _mEq(_mStripRev(parsed), _mStripRev(oldParsed))) {
          knownRev[k] = cloudRev;
          baseByKey[k] = _mStripRev(_deepClone(oldParsed));
          staleSnapped[k] = false;
          return { key: k, value: v };
        }

        // Layer 0: concurrency guard. Auto-saves only -- explicit actions
        // (restore/import/delete/recascade pass skipSanity) are intentional
        // overwrites and pass through, becoming the newest version.
        // B864(b) — the cloud moved ahead of this tab (a sibling wrote). The old behavior BLOCKED the save
        // and forced a reload, which dropped THIS tab's edits from the cloud (and, when the loser was the
        // tab that had a just-created meeting calendar, orphaned the binding). Now we 3-way MERGE our edits
        // onto the newer cloud so BOTH survive; only if we lack a base ancestor do we fall back to blocking.
        if (isAuto && !skipSanity && cloudRev != null && cloudRev > (knownRev[k] || 0)) {  // treat an unknown base rev as 0 (seed/offline-fallback load never set knownRev) — matches checkRemote
          const base = baseByKey[k];
          const preOurs = _mStripRev(_deepClone(parsed));   // this tab's doc as of save-start (the App reconcile ancestor)
          if (base !== undefined && oldParsed && _mIsObj(parsed)) {
            let merged;
            try { merged = mergeCloudDoc(base, preOurs, _mStripRev(oldParsed)); } catch (e) { merged = null; }
            if (merged && _mIsObj(merged)) {
              // Snapshot the pre-merge doc so a bad merge is always recoverable, then continue with the merge.
              await _snapshot(k, parsed, "premerge-ours", v.length);
              staleSnapped[k] = false;
              // The App must adopt the merged doc so its IN-MEMORY state converges with the cloud (else the
              // next save, seeing the sibling's addition as a "delete" vs its new base, would drop it again).
              // It reconciles the merge against its CURRENT state via mergeCloudDoc(preOurs, current, merged),
              // so any edit made during this save's round-trip is preserved (preOurs is their common ancestor).
              const mergedForApp = _deepClone(merged);
              parsed = merged;   // fall through to Layer 2 + rev-stamp + write; oldParsed/cloudRev already read
              console.info("[planar guard] Cloud rev " + cloudRev + " was ahead of this tab (" + (knownRev[k] || 0) + "); auto-merged our edits onto it (both copies in Version History).");
              try { window.dispatchEvent(new CustomEvent("planar:merged", { detail: { key: k, cloudRev: cloudRev, knownRev: knownRev[k], base: preOurs, value: mergedForApp } })); } catch {}
            } else {
              if (!staleSnapped[k]) { staleSnapped[k] = true; await _snapshot(k, parsed, "stale-block", v.length); }
              console.error("[planar guard] Save blocked (merge unavailable): cloud rev " + cloudRev + " is ahead of this tab (" + knownRev[k] + "). Reload to get the latest; your copy is saved as 'stale-block'.");
              try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: k, cloudRev: cloudRev, knownRev: knownRev[k] } })); } catch {}
              return null;
            }
          } else {
            if (!staleSnapped[k]) { staleSnapped[k] = true; await _snapshot(k, parsed, "stale-block", v.length); }
            console.error("[planar guard] Save blocked: cloud rev " + cloudRev + " is ahead of this tab (" + knownRev[k] + "). Reload to get the latest; your copy is saved as 'stale-block'.");
            try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: k, cloudRev: cloudRev, knownRev: knownRev[k] } })); } catch {}
            return null;
          }
        }

        // Layer 2: pre-save sanity check (auto-saves only -- manual labels trusted)
        if (isAuto && !skipSanity && oldParsed) {
          const oldN = countTasks(oldParsed);
          const newN = countTasks(parsed);
          if (oldN > SANITY_MIN_TASKS && newN < oldN * SANITY_DROP_RATIO) {
            await _snapshot(k, oldParsed, "safety-block", JSON.stringify(oldParsed).length);
            console.error("[planar safety] Refused save: tasks would drop " + oldN + " -> " + newN + ". Old data snapshotted as 'safety-block'.");
            if (typeof showToast === "function") {
              showToast("Save blocked -- tasks would drop " + oldN + "->" + newN + ". Old state backed up.", { type: "error", duration: 6000 });
            }
            return null;
          }
        }

        // NEW-1 (B1629618, 2026-09-18) — the actual write is now ALSO guarded server-side, by
        // planar_data_version_monotonic_guard.sql: a BEFORE UPDATE trigger on public.planar_data
        // refuses any UPDATE whose value->>'__rev' does not strictly exceed the row's CURRENT
        // stored rev. That closes the gap Layer 0 above cannot: Layer 0 is a read-then-write check,
        // so two tabs can each pass it (each reading a cloudRev that really was current at the
        // moment it read) and still race each other to the ACTUAL write below -- whichever commits
        // SECOND must lose even though its own pre-write read looked clean. `.select("key")` is
        // required to SEE that a refusal happened at all: a plain `.upsert()` with no `.select()`
        // sends `Prefer: return=minimal`, so PostgREST reports success whether the trigger silently
        // skipped the row (0 rows touched) or genuinely wrote it -- the exact "a refused save tells
        // nobody" defect this repo already hit once for public.sites (B1693264). An empty `data`
        // array with no `error` IS the refusal signal.
        // B2095121 LOUD-FAILURE: a refused cloud write (e.g. 403 RLS 42501 on planar_data for an account whose
        // 'hs-v1' key is owned by another user) used to reach ONLY the console, while the grid still showed the
        // edit as saved and a reload threw it away. Say so, once per burst.
        const reportCloudSaveFailed = (err) => {
          try {
            const now = Date.now();
            if (now - (window.__planarSaveFailToastAt || 0) < 8000) return;
            window.__planarSaveFailToastAt = now;
            // NEW-1 (B2189604) — a permission refusal (42501 / 403) means this schedule document belongs to another
            // account, so the honest word is "view only", not a failed save: say so in amber, and still say the edit
            // is not kept. Every other failure keeps the red LOUD-FAILURE toast.
            if (err && (err.code === "42501" || err.status === 403)) {
              showToast("View only — this schedule belongs to another account, so your change is not saved. Create your own schedule to edit.", { type: "warn", duration: 10000 });
            } else {
              showToast("Your change did NOT save to the cloud (" + ((err && (err.code || err.status)) || "error") + "). It is only on this screen — reloading will lose it.", { type: "error", duration: 10000 });
            }
            window.dispatchEvent(new CustomEvent("planar:cloud-save-failed", { detail: { key: k, code: err && err.code } }));
          } catch (e) {}
        };
        const attemptWrite = async (payload, baseRevForStamp) => {
          const toWrite = _deepClone(payload);
          if (toWrite && typeof toWrite === "object") toWrite.__rev = baseRevForStamp + 1;
          const { data, error } = await sb.from(TABLE).upsert({ key: k, value: toWrite }, { onConflict: "key" }).select("key");
          return { toWrite: toWrite, error: error, refused: !error && Array.isArray(data) && data.length === 0 };
        };
        // Re-derive a merge against whichever cloud row actually won the race, mirroring Layer 0's
        // own merge shape (same base/preOurs/mergeCloudDoc), so a refusal converges the same honest
        // way a pre-write staleness detection already does.
        const mergeOnto = (theirsParsed) => {
          const base = baseByKey[k];
          const preOurs = _mStripRev(_deepClone(parsed));
          if (base === undefined || !_mIsObj(parsed)) return null;
          let merged;
          try { merged = mergeCloudDoc(base, preOurs, _mStripRev(theirsParsed)); } catch (e) { merged = null; }
          return (merged && _mIsObj(merged)) ? { merged: merged, preOurs: preOurs } : null;
        };

        let attempt = await attemptWrite(parsed, cloudRev != null ? cloudRev : (knownRev[k] || 0));
        if (attempt.error) { console.error("Supabase set error:", attempt.error); reportCloudSaveFailed(attempt.error); return null; }

        if (attempt.refused) {
          let freshOld = null, freshRev = null;
          try {
            const cur2 = await sb.from(TABLE).select("value").eq("key", k).single();
            if (cur2.data && cur2.data.value) {
              freshOld = typeof cur2.data.value === "string" ? JSON.parse(cur2.data.value) : cur2.data.value;
              freshRev = revOf(freshOld);
            }
          } catch (e) {}

          if (freshOld == null || freshRev == null) {
            if (!staleSnapped[k]) { staleSnapped[k] = true; await _snapshot(k, parsed, "stale-block", v.length); }
            console.error("[planar guard] Write refused by the server and the current cloud row could not be re-read afterward. Your copy is saved as 'stale-block'.");
            try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: k, cloudRev: freshRev, knownRev: knownRev[k] } })); } catch {}
            return null;
          } else if (skipSanity) {
            // An explicit checkpoint (pre-delete/pre-import/pre-restore/pre-recascade) means "this
            // exact version becomes newest" -- re-sequence it against whoever actually won the race
            // and retry once. Never silently dropped: a second refusal is a LOUD failure, since these
            // are exactly the moments (about to delete/import/restore) where losing it is worst.
            attempt = await attemptWrite(parsed, freshRev);
            if (attempt.error) { console.error("Supabase set error (explicit retry):", attempt.error); reportCloudSaveFailed(attempt.error); return null; }
            if (attempt.refused) {
              console.error("[planar guard] Explicit save ('" + label + "') was refused twice in a row -- a checkpoint could not be recorded.");
              if (typeof showToast === "function") showToast("Couldn't save a checkpoint before this action -- please try again.", { type: "error", duration: 6000 });
              await _snapshot(k, parsed, "stale-block", v.length);
              return null;
            }
          } else {
            const mergeResult = mergeOnto(freshOld);
            if (!mergeResult) {
              if (!staleSnapped[k]) { staleSnapped[k] = true; await _snapshot(k, parsed, "stale-block", v.length); }
              console.error("[planar guard] Save blocked (merge unavailable after a refused write): cloud rev " + freshRev + " is ahead of this tab. Reload to get the latest; your copy is saved as 'stale-block'.");
              try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: k, cloudRev: freshRev, knownRev: knownRev[k] } })); } catch {}
              return null;
            }
            await _snapshot(k, parsed, "premerge-ours", v.length);
            staleSnapped[k] = false;
            parsed = mergeResult.merged;
            attempt = await attemptWrite(parsed, freshRev);
            if (attempt.error) { console.error("Supabase set error (merge retry):", attempt.error); reportCloudSaveFailed(attempt.error); return null; }
            if (attempt.refused) {
              // A third writer landed in the retry's own window too -- vanishingly rare in practice,
              // but never loop or silently drop this tab's edits: block honestly instead.
              if (!staleSnapped[k]) { staleSnapped[k] = true; await _snapshot(k, parsed, "stale-block", v.length); }
              console.error("[planar guard] Save blocked: lost the race twice in a row. Reload to get the latest; your copy is saved as 'stale-block'.");
              try { window.dispatchEvent(new CustomEvent("planar:stale", { detail: { key: k, cloudRev: freshRev, knownRev: knownRev[k] } })); } catch {}
              return null;
            }
            console.info("[planar guard] Write was refused by the server (another save landed first); re-merged our edits onto it and saved (both copies in Version History).");
            try { window.dispatchEvent(new CustomEvent("planar:merged", { detail: { key: k, cloudRev: freshRev, knownRev: knownRev[k], base: mergeResult.preOurs, value: _deepClone(mergeResult.merged) } })); } catch {}
          }
        }

        parsed = attempt.toWrite;
        if (parsed && typeof parsed === "object") { knownRev[k] = parsed.__rev; baseByKey[k] = _mStripRev(_deepClone(parsed)); }   // B864(b): the just-written doc is the new merge ancestor
        staleSnapped[k] = false;

        // Tell the UI a cloud write landed -- drives the green save pulse in the header
        try { window.dispatchEvent(new CustomEvent("planar:cloud-saved", { detail: { key: k } })); } catch {}

        // B1777120 — best-effort, fire-and-forget mirror into the normalized schedule rows.
        // Never awaited: must add zero latency to this save and must never affect its outcome.
        dualWriteScheduleRows(k, parsed);

        // Layer 1: write a history snapshot (throttled for auto)
        const now = Date.now();
        const shouldSnapshot = !isAuto || (now - lastAutoHistoryAt) >= AUTO_HISTORY_MS;
        if (shouldSnapshot) {
          if (isAuto) lastAutoHistoryAt = now;
          _snapshot(k, parsed, label, v.length);
        }
        return { key: k, value: v };
      } catch { return null; }
    },
    // B1777120 — collision-proof schedule creation for a flipped account. Reserves a real
    // Postgres identity value via INSERT (never a client-guessed nPid two tabs could race on —
    // acceptance criterion 5), then patches the row with its own id embedded in `data` (every
    // other read site in this app assumes `proj.id === <its own key>`) and seeds
    // scheduleBase/scheduleKnownRev so the very next autosave for this schedule is an ordinary
    // guarded UPDATE, not a second insert attempt. Returns the new id, or null on any failure
    // (LOUD-FAILURE — the caller must never add an unsaved project to local state on a null).
    insertSchedule: async ({ name, ownerKind, linkedSiteId, linkedSiteName, projectData } = {}) => {
      try {
        const { data: userRes } = await sb.auth.getUser();
        const ownerUid = userRes && userRes.user && userRes.user.id;
        if (!ownerUid) return null;
        const { data: row, error } = await sb.from("schedules").insert({
          user_id: ownerUid,
          linked_site_id: linkedSiteId ?? null,
          linked_site_name: linkedSiteName ?? null,
          name: name || "",
          data: {},
          rev: 0,
        }).select("id").single();
        if (error || !row) { console.error("[schedule rows] insertSchedule failed:", error); return null; }
        const id = row.id;
        const finalName = name || ("Project " + id);
        const proj = projectData ? { ...projectData, id } : { id, name: finalName, tasks: [], ownerKind };
        if (linkedSiteId != null) { proj.linkedSiteId = linkedSiteId; proj.linkedSiteName = linkedSiteName || null; }
        const { error: updErr } = await sb.from("schedules").update({ name: proj.name || finalName, data: proj, rev: 1 }).eq("id", id);
        if (updErr) { console.error("[schedule rows] insertSchedule: could not finalize row", id, updErr); return null; }
        scheduleKnownRev[String(id)] = 1;
        scheduleBase[String(id)] = _deepClone(proj);
        return id;
      } catch (e) { console.error("[schedule rows] insertSchedule exception:", e); return null; }
    },
    // List history snapshots for a key, newest first.
    getHistory: async (k, limit = 100) => {
      try {
        const { data, error } = await sb.from(HISTORY_TABLE)
          .select("id, key, label, task_count, project_count, byte_size, created_at")
          .eq("key", k)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error || !data) return [];
        return data;
      } catch { return []; }
    },
    // Fetch the full value for a single history row.
    getHistoryValue: async (id) => {
      try {
        const { data, error } = await sb.from(HISTORY_TABLE).select("value").eq("id", id).single();
        if (error || !data) return null;
        return typeof data.value === "string" ? data.value : JSON.stringify(data.value);
      } catch { return null; }
    },
    delete: async (k) => {
      try {
        const { error } = await sb.from(TABLE).delete().eq("key", k);
        if (error) return null;
        return { key: k, deleted: true };
      } catch { return null; }
    },
    list: async (prefix) => {
      try {
        let q = sb.from(TABLE).select("key");
        if (prefix) q = q.like("key", prefix + "%");
        const { data, error } = await q;
        if (error || !data) return { keys: [] };
        return { keys: data.map(r => r.key) };
      } catch { return { keys: [] }; }
    },
    // Cheap "has the cloud moved ahead?" check for the live-refresh poll --
    // pulls only the version stamp, not the whole dataset.
    // B1777120 — once flipped, "hs-v1" no longer has a single moving __rev (planar_data is
    // frozen at whatever it held at flip time), so "newer?" is answered by summing every known
    // schedule's rev + the index row's rev and comparing against a fresh sum. Any real write
    // anywhere increases SOME row's rev by >=1, so this can't miss a genuine change; it CAN miss
    // the specific case of a schedule being soft-deleted elsewhere (its rev leaves the sum
    // entirely rather than increasing it) -- a known, accepted gap in this early-warning UI poll
    // only, never in the CAS-write path itself, which still merges/refuses correctly regardless.
    checkRemote: async (k) => {
      try {
        if (k === "hs-v1" && scheduleRowsAuthoritative) {
          const { data: userRes } = await sb.auth.getUser();
          const ownerUid = userRes && userRes.user && userRes.user.id;
          if (!ownerUid) return { ok: false };
          const [schedAgg, idxRes] = await Promise.all([
            sb.from("schedules").select("rev").eq("user_id", ownerUid).is("deleted_at", null),
            sb.from("schedule_account_index").select("rev").eq("user_id", ownerUid).maybeSingle(),
          ]);
          if (schedAgg.error || idxRes.error) return { ok: false };
          const cloudTotal = (schedAgg.data || []).reduce((n, r) => n + (r.rev || 0), 0) + ((idxRes.data && idxRes.data.rev) || 0);
          const knownTotal = Object.values(scheduleKnownRev).reduce((n, r) => n + (r || 0), 0) + (indexKnownRev || 0);
          return { ok: true, cloudRev: cloudTotal, knownRev: knownTotal, newer: cloudTotal > knownTotal };
        }
        const { data, error } = await sb.from(TABLE).select("rev:value->>__rev").eq("key", k).single();
        if (error || !data) return { ok: false };
        const cloudRev = data.rev == null ? 0 : (parseInt(data.rev, 10) || 0);
        const kr = knownRev[k] == null ? 0 : knownRev[k];
        return { ok: true, cloudRev: cloudRev, knownRev: kr, newer: cloudRev > kr };
      } catch { return { ok: false }; }
    },
  };

  // B851 recurrence (route↔grid divergence + false "newer version" banner) — the real cause, per
  // a forced-ordering simulation of this exact read-then-write guard: `_rawSet` above has NO
  // serialization. Every `data` change (a task edit, AND every carry-in re-drive — Scheduler.jsx's
  // carry-in effect posts on every app-wide project switch, even while the Schedule tab isn't
  // visible, B1342/NEW-2) fires its own unconditional `attemptCloudSave`. Browsing a few Site
  // Planner projects in a row before landing on Schedule can therefore have two or more real saves
  // to "hs-v1" in flight at once. `_rawSet`'s `cloudRev > knownRev[k]` guard is a plain client-side
  // read-then-write check with no server-side compare-and-swap: when two overlapping saves from
  // THIS tab complete OUT OF ORDER, whichever one's upsert lands LAST simply overwrites the cloud —
  // even if it was the FIRST one issued and its content is now stale, and even though the rev
  // sequence still looks monotonic to the guard, so NO conflict is ever detected (a silent clobber:
  // the reported wrong-project grid). In other interleavings the same gap makes this tab's OWN
  // in-flight write look like a foreign "newer version" to a LATER save from the same tab, tripping
  // the merge/block path and firing the false "a newer version was saved on another device" banner —
  // exactly B851's own prior diagnosis of that symptom, which its fix (killing REDUNDANT reposts of
  // an already-active schedule) never covered, because these are DIFFERENT, legitimately distinct
  // saves, not duplicates of the same one.
  //
  // The fix: serialize every write to a given key. At most one `_rawSet` call is ever in flight per
  // key. Two adjacent, still-unstarted AUTO saves (the fungible "here is the current `data`" saves
  // attemptCloudSave issues) coalesce into one — only the latest payload is worth writing, nothing
  // an even-newer `data` doesn't already contain is lost. An EXPLICIT save (skipSanity: true — the
  // pre-delete/pre-import/pre-restore/pre-recascade checkpoints, an intentional "persist THIS exact
  // version" call) is never coalesced away and never has a later auto-save coalesce past it — it
  // keeps its own place in line, so those checkpoints still land as their own distinct cloud
  // version. This closes the race at its root for every caller without touching the carry-in/nav
  // logic at all — that logic was never wrong; the storage layer underneath it never guaranteed
  // saves wouldn't overlap. Proven via ui-audit/stress/scheduler-engine.mjs's mergeCloudDoc mirror +
  // a forced-ordering harness: 2 of 3 realistic network-timing interleavings silently clobber the
  // correct value before this fix, 0 of 3 after it (see test/schedulerSaveQueue.test.js).
  const _saveQueue = {};   // key -> array of not-yet-started jobs, FIFO
  const _saveRunning = {}; // key -> true while a _rawSet call is in flight for that key
  const _drainSaveQueue = (k) => {
    if (_saveRunning[k]) return;
    const q = _saveQueue[k];
    if (!q || !q.length) return;
    _saveRunning[k] = true;
    const job = q.shift();
    window.storage._rawSet(k, job.v, job.opts)
      .then((res) => job.waiters.forEach((w) => w.resolve(res)))
      .catch((err) => job.waiters.forEach((w) => w.reject(err)))
      .finally(() => { _saveRunning[k] = false; _drainSaveQueue(k); });
  };
  window.storage.set = (k, v, opts = {}) => new Promise((resolve, reject) => {
    const isAuto = (opts.label || "auto") === "auto" && !opts.skipSanity;
    const q = _saveQueue[k] || (_saveQueue[k] = []);
    const tail = q[q.length - 1];
    if (isAuto && tail && tail.auto) { tail.v = v; tail.opts = opts; tail.waiters.push({ resolve, reject }); }
    else q.push({ v, opts, auto: isAuto, waiters: [{ resolve, reject }] });
    _drainSaveQueue(k);
  });
})();

ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary><App /></ErrorBoundary>
);

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  removeScheduleFromDoc: [() => removeScheduleFromDoc],
  logMergeToastEvent: [() => logMergeToastEvent],
  mkt: [() => mkt],
  postLoadState: [() => postLoadState],
  LOAD_ATTEMPT_TIMEOUT_MS: [() => LOAD_ATTEMPT_TIMEOUT_MS],
  LOAD_RETRY_BASE_MS: [() => LOAD_RETRY_BASE_MS],
  LOAD_RETRY_MAX_MS: [() => LOAD_RETRY_MAX_MS],
  SEED: [() => SEED],
  App: [() => App],
  SplitView: [() => SplitView],
  PhoneSplitView: [() => PhoneSplitView],
  DesktopSplitView: [() => DesktopSplitView],
});
