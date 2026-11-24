import { GRID_SCROLL_MEMO, ROW_H, TL_H, rowWindow, rowWindowTop } from "../layout.js";
import { idPressMovesRows, parseFlexDate, rowDragArmed, rowDropIntent, rowFloatAtPointer, toShortDate } from "../../../../shared/schedule/engine/tasks.js";
import { MULTI_SELECTION_MESSAGE, addRange, isMulti, makeSelection, rangesOf, selContains, selEdgesAt, selIsRange, selRowsOf, selTouchesCol, selTouchesRow, toggleCellOut, withActive } from "../../../../shared/selection/rangeSelection.js";
import { HEALTH, NO_AUTOFILL, measuredColWidth, showToast } from "../common.jsx";
import { axisVelocity } from "../../../../shared/selection/edgeScroll.js";
import { MEETING_BODY_INDEX } from "../../../../shared/schedule/engine/meetings.js";
import { fmtPreds, normPreds, parseDurationInput, parsePreds, rollForwardToWorkday, validatePredEdit } from "../../../../shared/schedule/engine/predecessors.js";
import { NOW, pd } from "../../../../shared/schedule/engine/calendar.js";
import { effectivePercentComplete } from "../../../../shared/schedule/healthEngine.js";
import { ownerDisplayParts, ownerListOf } from "../../../../shared/schedule/engine/owners.js";
import { computeDisplayHealth } from "../../../../shared/schedule/engine/health.js";
import { COLS, DEFAULT_GRID_COLS, buildFormulaRowColumns, computeFormulaValues, effectiveColsOf, formulaCalendar, formulaColsOf, formulaColumnNames, formulaToday, lastRowPointerType, readGridCfg, writeGridCfg } from "./columns.js";
import { GRID_LINE, GRID_LINE_RANGE, pinnedFillLayers } from "./gridStyle.js";
import { FormulaColumnEditor, GridColumnsChooser, GridHeaderMenu, HealthColHeader, NotesColHeader, StatusHeaderDropdown } from "./headers.jsx";
import { HealthPicker, StatusPicker } from "./pickers.jsx";
import { Cell } from "./Cell.jsx";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef, useMemo } = React;


export function GridView({tasks, succMap, updateTask, deleteTask, getTaskName, proj, setData, setNotesCtx, edit, setEdit, editStartChar, selectedId, setSelectedId, selRange, setSelRange, selectedColIdx, setSelectedColIdx, goToFocus, setGoToFocus, scrollRef, onScroll, setTaskCtx, insertTask, insertTaskBelow, addTask, addSubtask, duplicateTask, rolledHealthMap, healthColStyle, setHealthColStyle, data, gridZoom=1, setHoverZone, onColWidths, review, moveRows}) {
  // Predecessor lookup for the "a predecessor is late" health condition — memoized on the
  // project's own task array so it's built once per data change, not once per row.
  const taskById = useMemo(() => { const m = {}; (proj?.tasks||[]).forEach(t => m[t.id] = t); return m; }, [proj?.tasks]);
  const [winTop, setWinTop] = useState(0);      // NEW-1 — first row of the CHUNK the scroll is in (not the raw scrollTop)
  const localRef = useRef(null);
  const ref = scrollRef || localRef;
  const vh = (ref.current?.clientHeight || window.innerHeight) - 80;
  const emptyPad = Math.max(100, Math.ceil(vh / ROW_H) + 40);
  const totalRows = tasks.length + emptyPad;
  const { startIdx, endIdx } = rowWindow(winTop, (ref.current?.clientHeight || window.innerHeight), totalRows);

  const isDraggingCells = useRef(false);
  const cellDragPin = useRef(null);   // release fn of the `cell` cursor pin while a range-select drag spans 2+ cells
  const _healthClickSel = useRef(null); // captures selRange at health/status mousedown before collapse
  const colBtnRef       = useRef(null); // NEW-1/B1350080 — header-row Columns (⋯) button, anchors the chooser panel

  // ── NEW-ROWMOVE — drag-and-drop row reorder ────────────────────────────────────────────────
  // Deliberately NO React state at all during the move: everything the drag needs (which rows,
  // where the cursor is, what's currently highlighted) lives on rowDragRef, and the live
  // insertion-line/highlight paint is done by writing DOM styles directly through refs on an
  // internal requestAnimationFrame loop. So a drag across the owner's 529-row schedule causes
  // ZERO re-renders of the row list for however long the gesture lasts — moveRows (passed down
  // from App, see `shared`) is called EXACTLY ONCE, on drop, which is the one setData/undo-step/
  // recompute (and the one render) the whole gesture produces.
  const rowDragRef  = useRef(null); // {ids, blocked, overIdx, overPos, overTaskId, lastClientY, rafId} while ARMED (past the drag threshold)
  const rowDragCancelRef = useRef(null); // tears down the press/drag in flight — a release that was never seen must not outlive the next press
  useEffect(() => () => { rowDragCancelRef.current?.(); }, []);
  const dragLineRef = useRef(null);   // insertion-line indicator DOM node
  const dragNestRef = useRef(null);   // NEW-ROWNEST — nest-under / blocked-target box DOM node

  // Ids the drag should move: the WHOLE active row-selection range when the grabbed row is part of
  // one, else just the grabbed row — the exact same rule App's structuralTargets applies to
  // indent/outdent/cut/copy, reimplemented locally off the props GridView already has (selRange,
  // tasks — the same flat array App's own rowRangeSelIds reads via flatTasksRef) so the drag can
  // resolve its target set at mousedown without waiting on a round-trip through App.
  const dragTargetIds = (anchorId) => {
    if (!selRange) return [anchorId];
    const r1 = Math.max(0, Math.min(selRange.r1, selRange.r2));
    const r2 = Math.min(tasks.length - 1, Math.max(selRange.r1, selRange.r2));
    if (r2 <= r1) return [anchorId];
    const ids = tasks.slice(r1, r2 + 1).map(t => t.id);
    return ids.includes(anchorId) ? ids : [anchorId];
  };

  // NEW-1 (2026-10-28) — A PRESS IS A CLICK UNTIL THE POINTER HAS REALLY TRAVELLED. The drag used to arm on
  // mousedown: rows dimmed, the page cursor pinned to "grabbing", the drop target painted, and the per-frame
  // loop below auto-scrolling the grid whenever the pointer sat near its top/bottom edge — all with a motionless
  // mouse. A plain click near the edge therefore slid other rows under the stationary pointer, and because a
  // grip press has no click path, its release committed the drop wherever the rows had slid to ("I've barely
  // moved or maybe not even moved by the time I've clicked, and it still moves it"). Now the press only RECORDS
  // where it started; nothing is painted, pinned, scrolled or committed until the held pointer has travelled
  // past rowDragThreshold (mouse < pen < touch). A release before that is a click (opts.onClick, if any); a
  // release back within the threshold of the press point writes nothing; a context menu, focus loss, Escape or a
  // button released out of sight cancels instead of leaving a half-armed drag to be dropped by the next click.
  const startRowDrag = (e, anchorTaskId, opts = null) => {
    if (review || e.button !== 0) return;
    const onClick = opts && opts.onClick;   // a press that never travels (an ID-cell press inside the selection, a grip click) is a click
    if (rowDragCancelRef.current) rowDragCancelRef.current();
    const ids = dragTargetIds(anchorTaskId);
    // Full blocked set (dragged rows + every descendant, from the FULL project tree so a
    // COLLAPSED descendant still blocks a drop into its own ancestor being dragged).
    const allTasks = proj?.tasks || [];
    const blocked = new Set(ids);
    let grew = true;
    while (grew) { grew = false; allTasks.forEach(t => { if (t.parentId != null && blocked.has(t.parentId) && !blocked.has(t.id)) { blocked.add(t.id); grew = true; } }); }

    const startX = e.clientX, startY = e.clientY;
    const state = { ids, blocked, lastClientX: startX, lastClientY: startY, rafId: null, overGapIndex: null, intent: null, moved: false };
    const pointerType = lastRowPointerType;
    let releaseCursor = null, finished = false;
    const el0 = ref.current;
    // Cached ONCE (not per animation frame) — the x-offset where the Task Name column's own text
    // starts, so the insertion-line indicator can be drawn at that same x. Uniform across every
    // row (fixed column widths), so any currently-rendered row's cell answers for all of them.
    const nameCellEl = el0 ? el0.querySelector('[data-col-key="name"]') : null;
    const nameIndentBase = nameCellEl ? nameCellEl.offsetLeft : 0;
    const nameCellW = nameCellEl ? nameCellEl.offsetWidth : 0;

    // The drop decision itself (gap vs nest vs blocked, and the depth rule) is the module-level
    // rowDropIntent / resolveDropParent above — pure, so the unit tests exercise the real code. This
    // closure only paints it and, on release, commits it.
    const intentAt = () => {
      const el = ref.current;
      if (!el || !tasks.length) return { kind: "none" };
      const rect = el.getBoundingClientRect();
      const zoom = el.offsetHeight ? rect.height / el.offsetHeight : (gridZoom || 1);
      return rowDropIntent(tasks, state.blocked, rowFloatAtPointer(state.lastClientY, rect.top, el.scrollTop, zoom, TL_H, ROW_H));
    };

    const computeAndPaint = () => {
      const el = ref.current;
      if (!el || !tasks.length) return;
      const rect = el.getBoundingClientRect();
      const intent = intentAt();
      state.intent = intent;
      state.overGapIndex = intent.kind === "gap" ? intent.gapIndex : null;
      const paintTop = intent.kind === "gap" ? intent.gapIndex * ROW_H : null;
      const level = intent.kind === "gap" ? intent.level : 0;

      if (dragLineRef.current) {
        dragLineRef.current.style.display = paintTop != null ? "block" : "none";
        if (paintTop != null) {
          dragLineRef.current.style.top = `${paintTop - 1.5}px`;
          // The line starts at the SAME x the dropped row's own name text would start at — so
          // the picture and the depth rule always agree: flush with a sibling's indent reads as
          // "beside", indented one step further reads as "inside". Matches Cell's own
          // `paddingLeft:4+task.level*14` for the name column exactly (name cell's real DOM
          // offset + that formula), so it's pixel-true, not an approximation.
          dragLineRef.current.style.left = `${nameIndentBase + 4 + level * 14}px`;
        }
      }

      // NEW-ROWNEST — the nest-under / blocked target: a box around the WHOLE hovered row (a line
      // between rows can never read as "inside this row"), blue for a legal nest, red dashed for a row
      // that is being dragged or sits inside one. Imperative like the line — no React state.
      const nb = dragNestRef.current;
      if (nb) {
        const showBox = intent.kind === "into" || (intent.kind === "blocked" && state.moved);
        nb.style.display = showBox ? "block" : "none";
        if (showBox) {
          const bad = intent.kind === "blocked";
          nb.style.top = `${intent.index * ROW_H}px`;
          nb.style.height = `${ROW_H}px`;
          nb.style.border = bad ? "2px dashed #dc2626" : "2px solid var(--blue)";
          nb.style.background = bad ? "rgba(220,38,38,0.10)" : "rgba(37,99,235,0.14)";
          nb.setAttribute("data-drag-nest-kind", bad ? "blocked" : "into");
          const chip = nb.firstChild;
          if (chip) {
            chip.textContent = bad ? "Not allowed" : "Nest inside";
            chip.style.background = bad ? "#dc2626" : "var(--blue)";
            chip.style.left = `${Math.max(0, nameIndentBase + nameCellW - 86)}px`;
          }
        }
      }

      // Auto-scroll near the top/bottom edge of the viewport — continuous while the cursor sits
      // in the edge band, not just on mousemove, so holding still near the edge keeps scrolling.
      const EDGE = 36, MAX_SPEED = 14;
      const y = state.lastClientY - rect.top;
      let dy = 0;
      if (y < EDGE) dy = -MAX_SPEED * (1 - Math.max(0, y) / EDGE);
      else if (y > rect.height - EDGE) dy = MAX_SPEED * (1 - Math.max(0, rect.height - y) / EDGE);
      if (dy) el.scrollTop = Math.max(0, el.scrollTop + dy);
    };

    const tick = () => {
      if (!rowDragRef.current) return; // drag ended
      computeAndPaint();
      state.rafId = requestAnimationFrame(tick);
    };

    // ARM — the held pointer has travelled past the threshold: only now does anything pick up, paint, pin or scroll.
    const arm = () => {
      // B2530690 — a drag of rows needs ONE contiguous block; with several ranges selected it says so (out loud)
      // instead of moving part of the selection. A press that never travels is still a click (handled above).
      if (isMulti(selRange)) { showToast(MULTI_SELECTION_MESSAGE, { type: "warn" }); cancel(); return; }
      state.moved = true;
      rowDragRef.current = state;
      // The cursor stays the grab hand for the WHOLE drag (pinned at the root: every cell, header and Gantt row paints its own
      // inline cursor, which a body-level cursor loses to). Escape / blur / pointercancel CANCEL the drop (no move).
      releaseCursor = window.pinSchedCursor("grabbing", { onExit: () => cancel() });
      document.body.style.userSelect = "none";
      // Mark the dragged row(s) as IN-FLIGHT, once — dimmed with a dashed outline (reads as "lifted out"; the row's slot
      // can't vacate without reflowing every row below it, the per-mousemove re-render this design forbids). Only
      // currently-rendered (virtualized) rows are found; cosmetic cue, not the source of truth for what moves.
      if (el0) ids.forEach(id => { const r = el0.querySelector(`[data-task-row="${id}"]`); if (r) { r.style.opacity = "0.45"; r.style.outline = "1.5px dashed var(--blue)"; r.style.outlineOffset = "-1.5px"; } });
      computeAndPaint(); // paint at the pointer's current position before the first frame
      state.rafId = requestAnimationFrame(tick);
    };
    // Everything the gesture installed comes off here — pressed-and-never-armed, armed, committed or cancelled alike.
    const teardown = () => {
      if (finished) return false;
      finished = true;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("contextmenu", cancel, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", cancel);
      if (rowDragCancelRef.current === cancel) rowDragCancelRef.current = null;
      if (state.rafId != null) cancelAnimationFrame(state.rafId);
      if (releaseCursor) releaseCursor();
      if (state.moved) {
        document.body.style.userSelect = "";
        if (dragLineRef.current) dragLineRef.current.style.display = "none";
        if (dragNestRef.current) dragNestRef.current.style.display = "none";
        // Clear the dim + in-flight outline. A SUCCESSFUL move re-renders every row from scratch (fresh inline styles)
        // anyway; this matters for the no-op/cancelled-drop case, where no setData fires and these exact DOM nodes
        // would otherwise stay dimmed/outlined forever.
        const elEnd = ref.current;
        if (elEnd) ids.forEach(id => { const r = elEnd.querySelector(`[data-task-row="${id}"]`); if (r) { r.style.opacity = ""; r.style.outline = ""; r.style.outlineOffset = ""; } });
      }
      rowDragRef.current = null;
      return true;
    };
    // Abandon the press/drag with NO click and NO drop.
    function cancel() { teardown(); }
    function onKey(ev) { if (ev.key === "Escape") cancel(); }
    function onMove(ev) {
      if (ev.buttons === 0) { cancel(); return; }   // the button came up where we could not see it (context menu, another window)
      state.lastClientX = ev.clientX; state.lastClientY = ev.clientY;
      if (!state.moved && rowDragArmed(pointerType, ev.clientX - startX, ev.clientY - startY)) arm();
    }
    function onUp(ev) {
      if (finished) return;
      if (ev && typeof ev.clientX === "number") { state.lastClientX = ev.clientX; state.lastClientY = ev.clientY; }
      const wasArmed = state.moved;
      // Read the drop where the pointer ACTUALLY is at release (the last frame's paint can be a frame stale).
      const intent = wasArmed ? intentAt() : null;
      teardown();
      // A press that never travelled is a click, not a drag (an ID-cell press inside the selection; a grip click).
      if (!wasArmed) { if (onClick) onClick(); return; }
      // Armed, but let go back at the press point: nothing was asked for, so nothing is written (no reorder, no
      // parent/date change, no undo entry, no sync).
      if (!rowDragArmed(pointerType, state.lastClientX - startX, state.lastClientY - startY)) return;
      if (intent && intent.kind === "gap" && moveRows) {
        moveRows(anchorTaskId, intent.destParentId, intent.insertAfterId);
      } else if (intent && intent.kind === "into" && moveRows) {
        // NEW-ROWNEST — nest under the hovered row. A row with no children becomes a SUMMARY row:
        // its own start/finish/duration are replaced by the roll-up of what was just put under it
        // (the same thing indent does). Say so — never a silent change; Ctrl+Z restores the lot.
        const target = allTasks.find(t => t.id === intent.targetId);
        const wasLeaf = target && !allTasks.some(t => t.parentId === target.id);
        moveRows(anchorTaskId, intent.destParentId, intent.insertAfterId);
        if (wasLeaf && target) showToast(`"${target.name || "Untitled"}" is now a summary row — its dates and duration roll up from the rows under it. Ctrl+Z undoes the move.`, { type: "success", duration: 5000 });
      } else if (intent && intent.kind === "blocked") {
        showToast("A row can't be moved into itself or its own sub-rows.", { type: "error", duration: 3500 });
      }
    }
    rowDragCancelRef.current = cancel;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("contextmenu", cancel, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", cancel);
  };

  useEffect(() => {
    const up = () => { isDraggingCells.current = false; if (cellDragPin.current) { cellDragPin.current(); cellDragPin.current = null; } };
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, []);

  // NEW-3 — keyboard navigation hands the highlight to the keyboard. While a nav key is the last thing that
  // happened, the grid carries data-kbnav (CSS then drops the row-HOVER outline); only a REAL pointer move — its
  // coordinates differ from where the pointer sat when the key went down — gives hover back. A scroll or a
  // re-render under a parked pointer can synthesize a pointermove at the SAME coordinates, which is ignored, so a
  // row sliding under a still mouse never re-lights. Imperative on purpose: a re-render per keystroke is not free.
  useEffect(() => {
    const NAV = new Set(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Tab","PageUp","PageDown","Home","End","Enter"]);
    const ptr = { x: null, y: null }, at = { x: null, y: null };
    const onKey = e => { if (!NAV.has(e.key)) return; const el = ref.current; if (!el) return;
      at.x = ptr.x; at.y = ptr.y; el.setAttribute("data-kbnav", "1"); };
    const onMove = e => { ptr.x = e.clientX; ptr.y = e.clientY;
      const el = ref.current; if (!el || !el.hasAttribute("data-kbnav")) return;
      if (e.clientX !== at.x || e.clientY !== at.y) el.removeAttribute("data-kbnav"); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointermove", onMove, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointermove", onMove, true); };
  }, []);

  // Is cell (ri, ci) inside ANY selected range? (B2530690 — the selection is a list of ranges now; the shared
  // model in the RANGE-SELECTION block is the one place that answers it.)
  const inRange = (ri, ci) => selContains(selRange, ri, ci);
  // Box-shadow string for selection outline on edge cells
  const selShadow = (ri, ci, selected, active) => {
    if (active) return "inset 0 0 0 2px var(--blue)";
    if (!selected || !selRange) return "none";
    const ed = selEdgesAt(selRange, ri, ci);
    const s=[];
    if(ed.top) s.push("inset 0 2px 0 0 #2563eb");
    if(ed.bottom) s.push("inset 0 -2px 0 0 #2563eb");
    // (B2160464) no inner 1px row separator here any more: every cell now draws its OWN bottom line
    // (GRID_LINE_RANGE inside a range), so an inset one would stack a second blue line beside it.
    if(ed.left) s.push("inset 2px 0 0 0 #2563eb");
    // when the range reaches the LAST visible column, the right edge belongs to the row's filler strip (its far end)
    if(ed.right && !(stripJoinsRange && ci===stripCi)) s.push("inset -2px 0 0 0 #2563eb");
    return s.join(",");
  };
  // The ONE press / drag-enter / right-click behaviour of a body cell. The row's right-edge FILLER strip
  // (NEW-1) calls these same three with the row's last visible column, so a press in the leftover width
  // selects the row exactly as a press on that row's own last cell does (shift-extend and drag included).
  // B2530690 — ONE drag session for every gesture that extends a cell / row range (a cell press, a Ctrl+press that
  // adds a range, an ID-column press). It mirrors the Spreadsheet's beginRangeDrag (B2452528): window listeners
  // + a rAF loop, the row under the pointer found by COORDINATES (so a row that is not rendered yet is still
  // reachable) and the grid scrolling while the pointer sits at/past an edge — even held perfectly still. The
  // speed ramp is the shared edgeScroll.axisVelocity. Nothing extends or scrolls until the pointer has really
  // travelled (a press near the edge is a click, not a drag — the lesson of NEW-1's row drag). `apply(ri, ci)`
  // gets the cell the selection should reach; `onEnd(reason, moved)` is "up" | "cancel".
  const cellSessionRef = useRef(null);
  const skipColClickRef = useRef(false);   // a Ctrl+click that TOOK a cell out of the selection: the click that follows must not re-aim the active column at it
  const liveGridRef = useRef({ tasks, allCols: [], gridZoom, stripCi: -1 });   // refreshed every render, right after stripCi is known (below). ⛔ never name a const declared LATER in this component here: the compiled production build keeps const block-scoping (TDZ) where the in-browser Babel page used in dev does not
  const beginCellDrag = (startEvent, { rowMode, apply, onEnd }) => {
    cellSessionRef.current?.stop("cancel");
    const el = ref.current;
    if (!el) return;
    const pointer = { x: startEvent.clientX, y: startEvent.clientY };
    const start = { x: startEvent.clientX, y: startEvent.clientY };
    let raf = 0, lastT = 0, lastKey = "", moved = false, lastCi = null;
    isDraggingCells.current = true;
    const reach = () => {
      const g = liveGridRef.current;
      if (!g.tasks.length) return;
      const rect = el.getBoundingClientRect();
      const zoom = el.offsetHeight ? rect.height / el.offsetHeight : (g.gridZoom || 1);
      const rf = Math.floor(rowFloatAtPointer(pointer.y, rect.top, el.scrollTop, zoom, TL_H, ROW_H));
      const r = Math.max(0, Math.min(g.tasks.length - 1, rf));
      let c = rowMode ? 0 : lastCi;
      if (!rowMode) {
        // The column under the pointer, found on the element actually painted there (so a pinned column that
        // covers a scrolled one answers as itself); a pointer outside the grid is clamped to its nearest cell.
        const x = Math.max(rect.left + 2, Math.min(rect.right - 3, pointer.x));
        const y = Math.max(rect.top + (TL_H + 2) * zoom, Math.min(rect.bottom - 3, pointer.y));
        const hit = document.elementFromPoint(x, y);
        const cell = hit && hit.closest ? hit.closest("[data-task-row] [data-col-key]") : null;
        if (cell) { const k = cell.getAttribute("data-col-key"); const i = g.allCols.findIndex(col => col.k === k); if (i >= 0) c = i; }
        else if (hit && hit.closest && hit.closest("[data-grid-strip]") && g.stripCi >= 0) c = g.stripCi;
        if (c == null) return;
        lastCi = c;
      }
      const key = r + ":" + c;
      if (key !== lastKey) { lastKey = key; apply(r, c); }
    };
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (!moved) return;
      const dt = lastT ? Math.min(64, now - lastT) : 16;
      lastT = now;
      const g = liveGridRef.current;
      const rect = el.getBoundingClientRect();
      const zoom = el.offsetHeight ? rect.height / el.offsetHeight : (g.gridZoom || 1);
      const vy = axisVelocity(pointer.y - rect.top, TL_H * zoom, rect.height);
      if (vy) el.scrollTop += (vy * dt) / 1000;
      if (!rowMode) {
        const pin = pinRef.current || { lw: 0, rw: 0 };
        const vx = axisVelocity(pointer.x - rect.left, pin.lw * zoom, rect.width - pin.rw * zoom);
        if (vx) el.scrollLeft += (vx * dt) / 1000;
      }
      reach();   // re-target every frame: scrolling moves which cell sits under a still pointer
    };
    const onMove = (ev) => {
      if (ev.buttons === 0) { stop("up"); return; }   // a release we never saw
      pointer.x = ev.clientX; pointer.y = ev.clientY;
      if (!moved) {
        if (Math.abs(pointer.x - start.x) + Math.abs(pointer.y - start.y) < 3) return;
        moved = true;
        // A range-select drag that has travelled shows the `cell` cursor until the button is released
        // (pinned, driven by the gesture — never by a ref read at render, which left it stuck after mouseup).
        if (!cellDragPin.current) cellDragPin.current = window.pinSchedCursor("cell", { onExit: () => { isDraggingCells.current = false; cellDragPin.current = null; } });
      }
      reach();
    };
    const onUp = () => stop("up");
    const onCancel = () => stop("cancel");
    const stop = (reason) => {
      if (cellSessionRef.current !== session) return;
      cellSessionRef.current = null;
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onCancel);
      isDraggingCells.current = false;
      if (cellDragPin.current) { cellDragPin.current(); cellDragPin.current = null; }
      onEnd?.(reason, moved);
    };
    const session = { stop };
    cellSessionRef.current = session;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onCancel);
    raf = requestAnimationFrame(tick);
  };
  useEffect(() => () => cellSessionRef.current?.stop("cancel"), []);
  // The selection as it stands BEFORE a press: the range list, or — after keyboard navigation cleared it — the
  // one active cell.
  const currentSelection = () => {
    if (selRange) return selRange;
    const ri0 = selectedId != null ? tasks.findIndex(t => t.id === selectedId) : -1;
    return ri0 >= 0 ? { r1: ri0, r2: ri0, c1: selectedColIdx ?? 0, c2: selectedColIdx ?? 0 } : null;
  };
  // The ONE press / right-click behaviour of a body cell. The row's right-edge FILLER strip (NEW-1) calls the same
  // with the row's last visible column, so a press in the leftover width selects the row exactly as a press on that
  // row's own last cell does (shift-extend, Ctrl-add and drag included).
  const cellMouseDown = (e, task, ri, c, ci) => {
    if (e.button !== 0) return;
    skipColClickRef.current = false;
    const additive = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;   // B2530690 — Ctrl/Cmd+press adds a range
    const lastCol = allCols.length - 1;
    // Shift+click — Excel-style: extend selection from anchor (current selectedId/selectedColIdx)
    // to this cell. Anchor stays put so subsequent shift-clicks/shift-arrows continue from it. Only the NEWEST
    // range extends; earlier ranges (Ctrl+click) stay as they are.
    if (e.shiftKey && selectedId !== null) {
      e.preventDefault();
      const anchorRi = tasks.findIndex(t => t.id === selectedId);
      const anchorCi = selectedColIdx ?? 0;
      if (anchorRi >= 0) {
        const cur = selRange || null;
        // ID column shift-click extends to full rows
        if (c.k === "id") {
          setSelRange(withActive(cur, {r1: anchorRi, r2: ri, c1: 0, c2: lastCol}));
        } else {
          setSelRange(withActive(cur, {r1: anchorRi, r2: ri, c1: anchorCi, c2: ci}));
        }
        // Keep focus on the grid container; keyboard nav is handled at the document level.
        setTimeout(()=>ref.current?.focus({preventScroll:true}), 0);
        return;
      }
    }
    // Health dot: the HealthPicker opens itself on mousedown.
    // Here we only sync row/column selection — no drag-select from the dot.
    if (c.k === "health" && e.target.closest("[data-health-dot]")) {
      setSelectedId(task.id);
      setSelectedColIdx(ci);
      // Keep an active multi-row range that COVERS this row so the picker fills the whole
      // range — the mouse path used to collapse here, so a multi-row health/status fill
      // silently changed only the clicked cell while the keyboard path filled every row.
      // Only collapse when the click is OUTSIDE the range (a fresh single selection).
      const inSpan = selRange && selTouchesRow(selRange, ri);
      if (!inSpan) setSelRange({r1:ri, r2:ri, c1:ci, c2:ci});
      return;
    }
    // ID column — Excel row-header behavior: click selects the
    // whole row, and dragging up/down extends the selection
    // across full rows (rowMode: all columns whichever column the pointer crosses). Ctrl+press adds this row
    // as another range.
    if (c.k === "id") {
      // B2445008 (×2) — the ID cell of a row inside a multi-row selection is a pick-up handle for the
      // whole selection (the 8px grip was the only way in, and the owner drags by the ID he selected by).
      if (!review && !e.ctrlKey && !e.metaKey && !e.altKey && idPressMovesRows(selRange, ri, allCols.length)) {
        e.preventDefault();
        startRowDrag(e, task.id, { onClick: () => { setSelectedId(task.id); setSelectedColIdx(0); setSelRange({r1:ri, r2:ri, c1:0, c2:allCols.length-1}); } });
        return;
      }
      const base = additive ? rangesOf(currentSelection()) : undefined;
      setSelectedId(task.id);
      setSelectedColIdx(0);
      setSelRange(makeSelection({r1:ri, r2:ri, c1:0, c2:lastCol}, base));
      beginCellDrag(e, { rowMode: true, apply: (r) => { setSelRange(makeSelection({r1:ri, r2:r, c1:0, c2:lastCol}, base)); const t = tasks[r]; if (t) { setSelectedId(t.id); setSelectedColIdx(0); } } });
      return;
    }
    // Everywhere else: pure Excel — drag starts immediately on mousedown
    if (additive) {
      // Ctrl+click adds this cell as a NEW range (the earlier ones stay highlighted) and Ctrl+drag grows it. A
      // Ctrl+press on an already-selected cell is a toggle, decided on release: no drag = take that cell OUT.
      const prev = currentSelection();
      const wasSel = selContains(prev, ri, ci);
      const base = rangesOf(prev);
      setSelectedId(task.id);
      setSelectedColIdx(ci);
      setSelRange(addRange(prev, {r1:ri, r2:ri, c1:ci, c2:ci}));
      beginCellDrag(e, {
        apply: (r, cc) => { setSelRange(makeSelection({r1:ri, r2:r, c1:ci, c2:cc}, base)); const t = tasks[r]; if (t) { setSelectedId(t.id); setSelectedColIdx(cc); } },
        onEnd: (reason, moved) => {
          if (reason !== "up" || !wasSel || moved) return;
          const next = toggleCellOut(prev, ri, ci);
          setSelRange(next);
          const t = tasks[next.r1];
          if (t) { setSelectedId(t.id); setSelectedColIdx(next.c1); skipColClickRef.current = true; }
        },
      });
      return;
    }
    setSelectedId(task.id);
    setSelectedColIdx(ci);
    setSelRange({r1:ri, r2:ri, c1:ci, c2:ci});
    beginCellDrag(e, { apply: (r, cc) => { setSelRange({r1:ri, r2:r, c1:ci, c2:cc}); const t = tasks[r]; if (t) { setSelectedId(t.id); setSelectedColIdx(cc); } } });
  };
  const cellContextMenu = (e, task, ri, c, ci) => {
    e.preventDefault(); e.stopPropagation();
    // Excel semantics: right-clicking INSIDE the current
    // selection keeps it (so the menu can act on the whole
    // thing — e.g. "Delete N Rows"); right-clicking OUTSIDE
    // collapses the selection to this cell so the previous
    // click's highlight never lingers alongside this one.
    if (!inRange(ri, ci)) setSelRange({r1:ri, r2:ri, c1:ci, c2:ci});
    setSelectedId(task.id); setSelectedColIdx(ci);
    if (setTaskCtx) setTaskCtx({task, projId: proj?.id, x: e.clientX, y: e.clientY});
  };
  // (NEW-2) the old "rows × columns" size pill that used to paint in the header's leftover width is GONE — it
  // was a readout only (nothing read it back) and nobody could tell what "14 × 18" meant. `hasRange` is still the
  // one "a multi-cell selection exists" test the range paint below keys off.
  const hasRange = selIsRange(selRange);

  const colWidthsRef = useRef(null);
  const pinRef = useRef({ lw: 0, rw: 0, l: [], r: [], w: {} });   // NEW-1 — pinned-column geometry for the reveal effect

  // B463922 (×2) — a toggle click sets this to the row it just EXPANDED, so the layout effect
  // below can prefer it over a stale `selectedId`. Expand-only: collapsing never needs its own
  // row protected (nothing new needs to become visible), so leaving it null there keeps the
  // existing selectedId/top-of-viewport anchor in charge, unchanged. See the click handler
  // below (search `expandAnchorRef.current = task.id`) and the layout effect that consumes it.
  const expandAnchorRef = useRef(null);
  // Set for exactly one effect pass when the layout effect below chose the expand-anchor over
  // `selectedId` — tells the next effect (which otherwise chases `selectedId` back into view) to
  // sit this one out, so it doesn't undo the reveal it just decided to prioritize.
  const suppressSelChaseRef = useRef(false);

  // ── B463922 — hold the row you are working on STILL when the list re-lays out ──────────
  // Collapsing (or expanding) a group ABOVE the row you are editing changes how much content
  // sits above it, so with no compensation that row slides up or down the screen by the whole
  // height of what appeared or vanished — under a cursor that has not moved. Rows here are
  // ABSOLUTELY POSITIONED inside a spacer, so the browser's own scroll anchoring cannot help:
  // an out-of-flow row is never an anchor candidate (measured — inserting 500px above this
  // container moves scrollTop by exactly 0). So the app owns the adjustment explicitly, which
  // is VIEWPORT-STABLE (a): fold the MEASURED delta into the scroll position in the SAME frame
  // as the re-layout, in a LAYOUT effect (before paint), so nothing is ever seen to move.
  //
  // The anchor is, in priority order: (1) a row just EXPANDED by a click, so what he opened it
  // to see is what stays put — UNLESS a cell editor is actually open elsewhere, in which case
  // losing keystrokes is worse than a delayed reveal and the edit keeps priority; (2) the
  // selected row while it is on screen; (3) otherwise the row at the top of the viewport.
  //
  // (×2, B548xxx-class recurrence, owner repro 2026-08-18): "clicking to open up the ALTA &
  // Topo Survey stuff... jumps me down to the middle of the schedule so I can't even see what I
  // just opened." Measured cause: a stale `selectedId` — a row merely clicked earlier, with no
  // editor open, sitting BELOW the toggle and still on screen — was winning the anchor. Holding
  // IT fixed forced the toggled row and its brand-new children off screen above by exactly the
  // height of what was revealed (144px for 6 rows in the reproduction). The old priority was
  // right for protecting a live edit against an unrelated background change; it was wrong for
  // the click whose entire point was to reveal the rows it just threw away.
  //
  // When the anchor row itself disappears (you collapsed the group it lives in) we walk UP the
  // previous list to the nearest row that survived, which is its parent.
  const heldListRef = useRef(tasks);
  // NEW-1 (recurrence of B463922, ×3) — companion to suppressSelChaseRef: records whether the
  // selected row was ACTUALLY on screen before this tasks change, so the passive "keep selectedId
  // visible" effect below can tell a real selection change (always chase, as today) from a
  // tasks-only change (collapse, undo, a cloud merge, a recompute, a Gantt drag, a status change —
  // none of which touched selectedId/selectedColIdx), which must chase ONLY when the selection was
  // already on screen — never drag the view back to a selection the user has since scrolled away
  // from. Defaults false: on a fresh mount this effect's own `prev === tasks` bail below never
  // runs, so a remount relies on the scroll-memory restore instead of forcing a chase.
  const selChaseAllowedRef = useRef(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    const prev = heldListRef.current;
    heldListRef.current = tasks;
    const expandAnchorId = expandAnchorRef.current;
    expandAnchorRef.current = null;
    if (!el || prev === tasks || !prev.length || !tasks.length) return;
    const st = el.scrollTop;
    // Index into the PREVIOUS list of the row sitting at the top of the viewport. React has not
    // touched the scroll position, so `st` is still the pre-commit value the old list was laid
    // out against. (Row N's document top is TL_H + N*ROW_H — the sticky header holds TL_H.)
    const topIdx = Math.max(0, Math.min(prev.length - 1, Math.round((st - TL_H) / ROW_H)));
    let anchorIdx = topIdx;
    let usedExpandAnchor = false;
    let selOnScreen = false;
    if (expandAnchorId != null && edit == null) {
      const ei = prev.findIndex(t => t.id === expandAnchorId);
      if (ei >= 0) { anchorIdx = ei; usedExpandAnchor = true; }
    }
    if (!usedExpandAnchor && selectedId != null) {
      const si = prev.findIndex(t => t.id === selectedId);
      const sTop = TL_H + si * ROW_H;
      if (si >= 0 && sTop >= st + TL_H && sTop + ROW_H <= st + el.clientHeight) { anchorIdx = si; selOnScreen = true; }
    }
    suppressSelChaseRef.current = usedExpandAnchor;
    selChaseAllowedRef.current = selOnScreen;
    // The anchor row may itself have been collapsed away — walk up to the nearest survivor.
    let now = -1;
    while (anchorIdx >= 0) {
      now = tasks.findIndex(t => t.id === prev[anchorIdx].id);
      if (now >= 0) break;
      anchorIdx--;
    }
    if (now < 0) return;
    const delta = (now - anchorIdx) * ROW_H;
    if (delta) el.scrollTop = Math.max(0, st + delta);
  }, [tasks]);

  // B548xxx — a row-height change (Format panel slider) rescales every row's absolute `top`,
  // but the raw pixel scrollTop doesn't rescale with it: measured, changing 24px rows to 34px
  // rows with no compensation threw the row that had been on screen clean out of the rendered
  // window (virtualisation dropped it) with ZERO app scroll write — the same "view abandoned,
  // not dragged" failure shape as the B463922 layout-count case, just triggered by a style
  // knob instead of a row count. Same anchor priority as that effect (selected row while it's
  // on screen, else the row at the top of the viewport) and the same algebra: holding a row's
  // index N fixed on screen across a uniform per-row rescale needs scrollTop += N*(new−old);
  // that reduces to the fractional top-of-viewport case when N is a fraction, so one formula
  // covers both anchors.
  const heldRowHRef = useRef(ROW_H);
  React.useLayoutEffect(() => {
    const el = ref.current;
    const prevRH = heldRowHRef.current;
    heldRowHRef.current = ROW_H;
    if (!el || prevRH === ROW_H) return;
    const st = el.scrollTop;
    let anchor = (st - TL_H) / prevRH;
    if (selectedId != null) {
      const si = tasks.findIndex(t => t.id === selectedId);
      const sTop = TL_H + si * prevRH;
      if (si >= 0 && sTop >= st + TL_H && sTop + prevRH <= st + el.clientHeight) anchor = si;
    }
    el.scrollTop = Math.max(0, st + anchor * (ROW_H - prevRH));
  }, [ROW_H]);

  // NEW-1 (B2451776) — the two scroll-into-view moves of the selection chase below, as closures so the grid can
  // ALSO reveal a cell that is not the selection: Ctrl+Shift+Arrow moves a range's far end (the selection itself
  // stays at the anchor), and asks for it via the "planar-reveal-cell" event. Bodies are the chase effect's own,
  // moved verbatim — row N's document top is TL_H + N*ROW_H (the sticky header holds TL_H).
  const revealRowIdx = idx => {
    const el = ref.current;
    if (!el || !(idx >= 0)) return;
    const rowTop = TL_H + idx * ROW_H, rowBottom = rowTop + ROW_H;
    const visTop = el.scrollTop + TL_H, visBottom = el.scrollTop + el.clientHeight;
    if (rowTop < visTop)            el.scrollTop = rowTop - TL_H;
    else if (rowBottom > visBottom) el.scrollTop = rowBottom - el.clientHeight;
  };
  const revealColKey = selKey => {
    const el = ref.current;
    if (!el) return;
    // Horizontal reveal: measure from the columns ACTUALLY rendered (the visible set in
    // display order) — not COLS.slice, which would sum hidden columns' widths and scroll
    // to the wrong place when columns are hidden or reordered.
    const pin = pinRef.current || { lw: 0, rw: 0, l: [], r: [], w: {} };
    const cw = { ...(colWidthsRef.current || {}), ...pin.w };     // DISPLAY widths (the Task cap applies)
    const dispPos = selKey ? colOrder.indexOf(selKey) : -1;
    if (dispPos >= 0) {
      // +2: every row/header starts after its 2px left border (the selection/review marker), so a column's
      // true offset in the scrolled content is 2px more than the sum of the widths before it.
      const colLeft  = 2 + colOrder.slice(0, dispPos).reduce((s, k) => s + (cw[k] || colByK[k]?.w || 0), 0);
      const colRight = colLeft + (cw[selKey] || colByK[selKey]?.w || 0);
      // NEW-1 — the pinned columns cover the edges of the scrollport, so "visible" is the strip BETWEEN
      // them; a pinned column itself is always visible and never needs a scroll.
      const selPinned = pin.l.includes(selKey) || pin.r.includes(selKey);
      const visLeft  = el.scrollLeft + pin.lw, visRight = el.scrollLeft + el.clientWidth - pin.rw;
      if (!selPinned) {
        if (colLeft < visLeft)          el.scrollLeft = colLeft - pin.lw;
        else if (colRight > visRight)   el.scrollLeft = colRight - (el.clientWidth - pin.rw);
      }
    }
  };
  const revealCellRef = useRef(null);
  revealCellRef.current = (row, masterCol) => { revealRowIdx(row); revealColKey(allCols[masterCol]?.k); };
  useEffect(() => {
    const on = e => { const d = e.detail || {}; if (revealCellRef.current) revealCellRef.current(d.row, d.col); };
    document.addEventListener("planar-reveal-cell", on);
    return () => document.removeEventListener("planar-reveal-cell", on);
  }, []);

  const chasedSelRef = useRef({ id: selectedId, col: selectedColIdx });
  useEffect(() => {
    const suppressSelChase = suppressSelChaseRef.current;
    suppressSelChaseRef.current = false;
    const prevSel = chasedSelRef.current;
    chasedSelRef.current = { id: selectedId, col: selectedColIdx };
    if (selectedId === null) return;
    const el = ref.current;
    if (!el) return;
    // NEW-1 (recurrence of B463922, ×3) — a real selection change (arrow keys, Tab, a fresh
    // click, a dashboard/successor-prompt jump) always chases the row into view, same as always.
    // A TASKS-ONLY change chases only when the selected row was already on screen before it
    // (selChaseAllowedRef, set by the anchor effect above from the very same commit) — otherwise
    // this effect (which re-runs on every `tasks` change purely because `tasks` is in its deps)
    // was dragging the view back to a selection the user had long since scrolled away from.
    const selMoved = prevSel.id !== selectedId || prevSel.col !== selectedColIdx;
    const shouldChase = selMoved || selChaseAllowedRef.current;
    const idx = tasks.findIndex(t => t.id === selectedId);
    if (idx >= 0 && !suppressSelChase && shouldChase) {
      // Omitting TL_H in revealRowIdx nudged the topmost fully-visible row up by one header height on a
      // plain click/select — bug C of NEW-1.
      revealRowIdx(idx);
    }
    revealColKey(allCols[selectedColIdx]?.k);
  }, [selectedId, selectedColIdx, tasks]);

  // While reviewing, scroll the proposed/target row into view whenever the active target changes.
  const rvAnchorId = review ? (tasks.find(t => t.__rvTarget)?.id ?? tasks.find(t => t.__rvProposed)?.id ?? null) : null;
  const [rvEdit, setRvEdit] = useState(null); // which proposed-row field is being edited: "end" | "owner" | null
  useEffect(() => { setRvEdit(null); }, [rvAnchorId]);
  useEffect(() => {
    if (!review || rvAnchorId == null) return;
    const el = ref.current; if (!el) return;
    const idx = tasks.findIndex(t => t.__rvTarget) >= 0 ? tasks.findIndex(t => t.__rvTarget) : tasks.findIndex(t => t.__rvProposed);
    if (idx < 0) return;
    // Same TL_H alignment as the goToFocus landing effect below (NEW-1) — row N's document top is
    // TL_H + N*ROW_H, the sticky header holds TL_H.
    const id = setTimeout(() => { el.scrollTop = Math.max(0, TL_H + idx * ROW_H - Math.min(120, el.clientHeight / 3)); }, 50);
    return () => clearTimeout(id);
  }, [rvAnchorId]);

  // ── Cross-view jump landing ───────────────────────────────
  // When App hands us a goToFocus token (dashboard ↗, successor-prompt open),
  // place the row about a third down the viewport — not pinned to an edge the
  // way the plain selection-keeper does — then pulse its outline so the eye
  // lands on it. The 60ms delay lets the section/project switch paint first.
  useEffect(() => {
    if (!goToFocus) return;
    const el = ref.current; if (!el) return;
    const idx = tasks.findIndex(t => t.id === goToFocus.taskId);
    if (idx < 0) return;
    const id = setTimeout(() => {
      // Row N's document top is TL_H + N*ROW_H — the sticky header holds TL_H (same formula the
      // selection-chase effect above uses). Omitting it here landed the row one header height
      // higher than intended.
      el.scrollTop = Math.max(0, TL_H + idx * ROW_H - Math.min(120, el.clientHeight / 3));
      // NEW-1 (bug E, recurrence of B463922 ×3) — App never cleared this token, so it stayed
      // truthy in App state after landing; a LATER remount (any view switch, a phone-breakpoint
      // stack remount) is a brand-new effect instance that runs on mount regardless of whether its
      // deps "changed", and replayed the jump to this same — by then likely unrelated — row.
      // Clear it here, once the scroll write above is actually committed, so a later remount sees
      // goToFocus already null and does nothing. Deliberately NOT cleared synchronously at the top
      // of this effect: `setGoToFocus` there re-renders App with a new `goToFocus` reference before
      // this very `setTimeout` fires, and a dependency change on THIS SAME effect runs its own
      // cleanup first — `clearTimeout(id)` — canceling the landing scroll before it ever happens
      // (measured: the jump then landed nowhere, silently). Clearing after the write is committed
      // has nothing left to race. Guarded on the token (`n`) so this can't clobber a NEWER jump
      // that landed first (shouldn't happen given effect ordering, but it's a one-line guard).
      setGoToFocus?.(gf => (gf && gf.n === goToFocus.n) ? null : gf);
      // The row may not exist in the DOM until the virtualizer re-renders for
      // the new scrollTop — give React a beat before looking it up.
      setTimeout(() => {
        const rowEl = el.querySelector(`[data-task-row="${goToFocus.taskId}"]`);
        if (rowEl && rowEl.animate) rowEl.animate(
          [{boxShadow:"inset 0 0 0 2px #2563eb", offset:0},
           {boxShadow:"inset 0 0 0 2px #2563eb", offset:.45},
           {boxShadow:"inset 0 0 0 2px rgba(37,99,235,0)"}],
          {duration:1100, easing:"ease-out"}
        );
      }, 120);
    }, 60);
    return () => clearTimeout(id);
  }, [goToFocus]);

  // NEW-1 (recurrence of B463922, ×3) — restore this project's last scroll position on mount
  // (bug D: a Grid↔Gantt↔Split view switch remounts this whole component via App's
  // `<ErrorBoundary key={data.view}>`, which otherwise resets to the top every time). Skipped
  // while a goToFocus jump is pending — that jump is a deliberate "go here", so it wins over
  // "go back to where I was". A layout effect so it applies before paint, same as every other
  // scroll-position write in this file.
  const gridMemoKey = proj?.id ?? null;
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || gridMemoKey == null) return;
    const saved = GRID_SCROLL_MEMO.get(gridMemoKey);
    if (saved != null && !goToFocus) { el.scrollTop = saved; setWinTop(rowWindowTop(el.scrollTop)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridMemoKey]);

  const handleScroll = e => {
    if (gridMemoKey != null) GRID_SCROLL_MEMO.set(gridMemoKey, e.currentTarget.scrollTop);
    setWinTop(rowWindowTop(e.currentTarget.scrollTop)); if (onScroll) onScroll(e);
    const el = e.currentTarget, l = el.scrollLeft > 1, r = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
    setScrollSide(p => (p.l === l && p.r === r ? p : { l, r }));     // NEW-1 — only re-renders when a pin edge flips
  };

  const applyUpdate = (id, col, val) => {
    if (col==="start"||col==="end") {
      const raw = String(val ?? "").trim();
      if (!raw) { updateTask(id,{[col]:""}); return; }                  // cleared → unschedule that endpoint (was: silently reverted)
      let p = parseFlexDate(raw);
      if (!p) { showToast("Couldn't read that date — try M/D or M/D/YY"); return; }  // was: silently reverted, no feedback
      // NEW-1 — a meeting-bound row is a milestone on a MEETING day, which the body's own calendar decides
      // (a Saturday meeting is a real meeting): skip the working-day roll for it, or a typed 12/12 (Sat) would
      // roll to Monday and then jump PAST the real meeting. updateTask/resolveBoundEdit resolves it forward.
      const _bt = tasks.find(x => x.id === id);
      const _boundHere = !!(_bt && _bt.meetingBound && !_bt.hasChildren && MEETING_BODY_INDEX[_bt.meetingBodyId]);
      // The schedule runs on WORKING days — a Start/Finish can't sit on a weekend or holiday (B624).
      // Roll a non-working-day entry FORWARD to the next working day and say why, rather than silently
      // accepting it. rollForwardToWorkday skips Sat/Sun + HOLIDAY_SET; a working day is unchanged.
      const rolled = _boundHere ? p : rollForwardToWorkday(p);
      if (rolled !== p) {
        const wd = pd(p).getDay();
        const why = (wd === 0 || wd === 6) ? "a weekend" : "a holiday";
        showToast(`${col==="end" ? "Finish" : "Start"} moved to ${toShortDate(rolled)} — you picked ${why}.`, { type: "info" });
        p = rolled;
      }
      if (col==="end") {
        const t = tasks.find(x => x.id === id);
        if (t && !_boundHere && t.start && p < t.start) { showToast("Finish can't be before Start — change the Start date first."); return; }  // was: silently collapsed to a 0-day milestone, losing the typed date
      }
      updateTask(id,{[col]:p});
    }
    else if (col==="percentComplete") {
      const pt = tasks.find(x => x.id === id);
      if (pt && pt.hasChildren) { showToast("% Complete on a parent row rolls up from its tasks — edit the tasks (or set the parent's status to cascade)."); return; }
      updateTask(id,{percentComplete:Math.max(0,Math.min(100,parseInt(val)||0))});
    }
    else if (col==="duration") {
      // B615: parse the typed unit — days/weeks = working days, months/years = calendar-real.
      // An unparseable string surfaces a VISIBLE inline error, never silently coercing to 0.
      const parsed = parseDurationInput(val);
      if (parsed.error) { showToast(parsed.error); return; }
      updateTask(id,{durValue: parsed.value, durUnit: parsed.unit});   // updateTask derives duration + end from the unit
    }
    else if (col==="predecessors") {
      // Drop self-references (Fix #16), references to ids that don't exist, and references
      // that would create a circular dependency — each surfaced with a toast so the edit is
      // honest rather than silently stored-but-inert / silently-wrong.
      const { preds, selfRemoved, unknownIds, cyclic, ancestor } = validatePredEdit(proj?.tasks || tasks, id, parsePreds(val));
      if (selfRemoved) showToast(`Task ${id} can't be its own predecessor — removed.`);
      else if (cyclic.length) showToast(`That would create a circular dependency (task ${cyclic.join(", ")}) — ignored.`);
      else if (ancestor.length) showToast(`Task ${ancestor.join(", ")} is this task's own summary row — a summary's dates come FROM its tasks, not the other way around. Ignored.`);
      else if (unknownIds.length) showToast(`No task ${unknownIds.join(", ")} in this project — ignored.`);
      updateTask(id, {predecessors: preds});
    }
    else if (col==="health"||col==="status") { updateTask(id,{health:val}); }
    else if (col==="cost"||col==="budget"||col==="actualCost") { const n=String(val).replace(/[^0-9.]/g,""); updateTask(id,{[col]: n==="" ? "" : (parseFloat(n)||0)}); }
    else updateTask(id,{[col]:val});
  };

  /* B1341728 — the WRITE half of commit, split out so a write-through (tokens-class) editor can
   * save what it shows WITHOUT closing itself. Range-fill semantics are byte-for-byte the ones
   * `commit` has always had; `commit` is now exactly this plus closing the editor, nothing else. */
  const applyCommit = (taskId, col, val) => {
    const isHealthOp = col === "health" || col === "status";
    if (hasRange && selRange) {
      const ci = COLS.findIndex(c => c.k === col);
      const ri = tasks.findIndex(t => t.id === taskId);
      if (isHealthOp ? selTouchesRow(selRange, ri) : inRange(ri, ci)) {
        if (col === "name" || col === "notes" || col === "predecessors") {
          // These are never range-filled (filling one name across many rows is destructive), but the
          // focused cell's OWN edit must still commit — the old loop skipped every row and returned,
          // silently discarding the typed value when a row/range selection covered the edited cell.
          applyUpdate(taskId, col, val);
        } else {
          // B2530690 — every range, not just the active one: a row is filled when the column's cell sits in a range
          // (a health/status fill takes every row any range touches).
          for (const r of selRowsOf(selRange, tasks.length - 1)) {
            if (!isHealthOp && !inRange(r, ci)) continue;
            const t = tasks[r];
            // Don't fill a parent's rolled-up fields: dates self-correct via rollupParentDates, but
            // cost/budget/actual have no rollup-on-write, so a filled value would persist invisibly into
            // cloud-save + JSON/CSV export. Matches the single-cell parent lock.
            if (t && !(t.hasChildren && (col==="start"||col==="end"||col==="duration"||col==="cost"||col==="budget"||col==="actualCost"))) applyUpdate(t.id, col, val);
          }
        }
        return;
      }
    }
    applyUpdate(taskId, col, val);
  };

  const commit = (taskId, col, val) => { applyCommit(taskId, col, val); setEdit(null); };

  const commitAndAdvance = (taskId, col, val) => {
    // Fix #6: capture the next task's id BEFORE commit so the date cascade
    // can't reshuffle rows and land the cursor on the wrong task.
    const idxBefore = tasks.findIndex(t => t.id === taskId);
    const nextIdBefore = tasks[idxBefore + 1]?.id ?? null;
    commit(taskId, col, val);
    if (nextIdBefore !== null) setSelectedId(nextIdBefore);
    // A date / dependency edit can re-sort rows via the cascade, so the flat-index selRange is now stale
    // (its highlight + Shift-Arrow anchor would point at whatever rows moved into that span); drop it so
    // the next selection re-derives cleanly. Non-reordering edits (owner/cost/…) keep their range.
    if (col === "start" || col === "end" || col === "duration" || col === "predecessors") setSelRange(null);
  };

  // ── Per-project column config (B212) ────────────────────────
  // The left table's columns — which, order, widths — are configured PER PROJECT and persist
  // through the existing cloud-save path (writeGridCfg → setData → autosave). COLS is the
  // master available-field registry; `cfg.visible` is this project's ordered, shown subset.
  // (Legacy global gridColOrder/gridColWidths migrate in via readGridCfg on first read.)
  const pid = proj?.id;
  // B583 — the project's effective column registry: built-in COLS + user Formula columns.
  const formulaCols = useMemo(() => formulaColsOf(proj), [proj?.formulaCols]);
  const allCols = useMemo(() => effectiveColsOf(proj), [proj?.formulaCols]);
  const colByK = useMemo(() => Object.fromEntries(allCols.map(c => [c.k, c])), [allCols]);
  // B844 — proj.meetingBodies / proj.tasks are in the deps so the meeting-column auto-show (readGridCfg)
  // recomputes when a body is defined or a task is bound; without them the memo went stale and the Meeting /
  // Float / Cost columns never appeared until an unrelated column change forced a recompute.
  const cfg = useMemo(() => readGridCfg(proj, data), [proj?.colConfig, proj?.formulaCols, proj?.meetingBodies, proj?.tasks, data.gridColOrder, data.gridColWidths, pid]);
  const colOrder = cfg.visible;
  // B583 — per-row computed values for every Formula column, evaluated AFTER the date
  // cascade has settled (this renders from the already-cascaded `tasks`). Dependent
  // formula columns are computed in topological order; cycles surface as #CIRC!.
  // Shape: { [taskId]: { [colKey]: { ok, error, display, value } } }.
  const formulaValues = useMemo(
    () => computeFormulaValues(tasks, formulaCols, proj),
    [tasks, formulaCols, data.settings?.holidays, NOW]
  );
  // Live width override during a drag-resize: kept local so the drag stays smooth, then
  // committed to the project config on mouse-up (calling setData mid-render warns/loops).
  const [liveW, setLiveW] = useState(null); // { k, w } | null
  const widthOf = (k) => (liveW && liveW.k === k ? liveW.w : (cfg.widths[k] ?? colByK[k]?.w ?? 100));
  const colWidths = useMemo(() => { const o = {}; allCols.forEach(c => { o[c.k] = (liveW && liveW.k === c.k ? liveW.w : (cfg.widths[c.k] ?? c.w)); }); return o; }, [cfg, liveW, allCols]);
  // Sync the ref during render so handlers reading colWidthsRef.current always see current widths.
  colWidthsRef.current = colWidths;
  useEffect(() => { if (onColWidths) onColWidths({ order: colOrder, widths: colWidths }); }, [colWidths, colOrder]);

  const orderedCols = colOrder.map(k => colByK[k]).filter(Boolean);
  // ── NEW-1 (Schedule grid holds at narrow widths) — pinned columns + a pane-relative Task cap ──────
  // Owner: "I want the frame to always work regardless of the size of computer or screen." Sideways
  // scrolling already lived inside this container (the page never scrolled — measured); what was missing
  // was ANY pinned column, so ID/Task scrolled away and the ●/status tail was cut off. Now ID + Task pin
  // LEFT (the leading run of those columns), a trailing ●/Status run pins RIGHT, and the Task column is
  // capped at about half THIS PANE'S width (Split's pane, not the window) so START/FINISH stay visible.
  // The cap is a DISPLAY width only — the saved/resized width (cfg.widths, colWidths, onColWidths → the
  // Split divider snap) is untouched, so widening the window gives the user's width back. Pins switch off
  // entirely when they'd eat most of a very small pane (an 18% Split divider), so the grid just scrolls.
  const [gridW, setGridW] = useState(0);                       // this pane's inner width, in content px
  const [scrollSide, setScrollSide] = useState({ l: false, r: false }); // content is under the left / right pins
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => setGridW(Math.floor(el.getBoundingClientRect().width / (gridZoom || 1)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [gridZoom]);
  const NAME_MIN_W = 100;
  const nameCap = (leftOthers) => Math.max(NAME_MIN_W, Math.floor(gridW * 0.5) - leftOthers);
  let pinL = []; for (const c of orderedCols) { if (c.k === "id" || c.k === "name") pinL.push(c.k); else break; }
  let pinR = []; for (let i = orderedCols.length - 1; i >= 0; i--) { const k = orderedCols[i].k; if (k === "health" || k === "status") pinR.unshift(k); else break; }
  const dispW = { ...colWidths };
  if (gridW > 0 && pinL.includes("name")) dispW.name = Math.min(colWidths.name, nameCap(pinL.includes("id") ? colWidths.id : 0));
  if (pinL.length + pinR.length >= orderedCols.length) { pinL = []; pinR = []; }   // nothing left to scroll under them
  const pinLW = pinL.reduce((s, k) => s + dispW[k], 0), pinRW = pinR.reduce((s, k) => s + dispW[k], 0);
  if (gridW > 0 && pinLW + pinRW > gridW * 0.8) { pinL = []; pinR = []; }       // tiny pane: don't pin
  const pinOn = pinL.length + pinR.length > 0;
  const pinLeftOff = (k) => pinL.slice(0, pinL.indexOf(k)).reduce((s, x) => s + dispW[x], 0);
  const pinRightOff = (k) => pinR.slice(pinR.indexOf(k) + 1).reduce((s, x) => s + dispW[x], 0);
  const pinCls = (k) => (k === pinL[pinL.length - 1] ? `pin-edge-l${scrollSide.l ? " pin-on" : ""}` : k === pinR[0] ? `pin-edge-r${scrollSide.r ? " pin-on" : ""}` : "");
  // `fill` = the cell's own opaque look (row colour / header surface); layered over --bg so even a
  // translucent row colour is opaque once pinned and scrolled content never shows through.
  // NEW-1 (row highlight reaches ID + Task) — `fills` is listed BOTTOM → TOP (row colour first, then the
  // cell's own range tint / per-cell fill). CSS paints the FIRST background-image layer on TOP, so the
  // stack is reversed (`pinnedFillLayers`): the old code listed the row colour first and it painted over
  // the tint and the fill, which is why a selection or a cell fill showed from START rightward and
  // stopped short of the frozen ID / Task cells.
  const pinStyle = (k, fills, z) => {
    if (!pinL.includes(k) && !pinR.includes(k)) return null;
    const layers = pinnedFillLayers(fills);
    return { position: "sticky", zIndex: z, ...(pinL.includes(k) ? { left: pinLeftOff(k) } : { right: pinRightOff(k) }),
      backgroundColor: "var(--bg)", ...(layers ? { backgroundImage: layers } : {}) };
  };
  const syncScrollSide = (el) => {
    if (!el) return; const l = el.scrollLeft > 1, r = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
    setScrollSide(p => (p.l === l && p.r === r ? p : { l, r }));
  };
  const totalW = orderedCols.reduce((s, c) => s + dispW[c.k], 0);
  useEffect(() => { syncScrollSide(ref.current); }, [gridW, totalW, pinOn]);
  pinRef.current = { lw: pinLW, rw: pinRW, l: pinL, r: pinR, w: dispW };   // read by the keyboard reveal effect
  const hiddenCols = allCols.filter(c => !colOrder.includes(c.k)); // available-but-not-shown
  // Effective-registry indices of the visible columns, in display order — drives in-cell Tab
  // navigation through the SHOWN columns only (passed to Cell). B583: index into allCols
  // (built-ins + formula columns) so a formula column is navigable too and lines up with the
  // row render's ci = allCols.indexOf(c). Mirrors stepVisibleColIdx (gridColNav.js).
  const colMasterIdxs = orderedCols.map(c => allCols.indexOf(c));
  // NEW-1 — the leftover width right of the last column ("the strip"). Each row carries a flex-filling filler cell
  // there so the strip reads as the row continuing: same tint (the row's own background), the same solid cell line,
  // the multi-row selection highlight + outline running to the pane's edge, and a press selecting the row exactly as
  // a press on its last visible cell does. It is flex:1 1 0, so it is zero-width (and adds no scroll width) when the
  // columns already fill the pane.
  const stripCol = orderedCols[orderedCols.length - 1];
  const stripCi = stripCol ? allCols.indexOf(stripCol) : -1;
  liveGridRef.current = { tasks, allCols, gridZoom, stripCi };
  const stripJoinsRange = hasRange && selTouchesCol(selRange, stripCi);
  const stripShadow = (ri) => {
    if (!stripJoinsRange || !inRange(ri, stripCi)) return "none";
    const ed = selEdgesAt(selRange, ri, stripCi);
    const sh = [];
    if (ed.top) sh.push("inset 0 2px 0 0 #2563eb");
    if (ed.bottom) sh.push("inset 0 -2px 0 0 #2563eb");
    sh.push("inset -2px 0 0 0 #2563eb");
    return sh.join(",");
  };

  // If the selected column is no longer on screen — hidden via the Columns chooser, or the
  // initial id column hidden in this layout — snap the cursor to the nearest visible column
  // so the blue selection outline never silently disappears on a layout change.
  useEffect(() => {
    if (selectedId === null || !colMasterIdxs.length) return;
    if (colMasterIdxs.includes(selectedColIdx)) return; // still visible — nothing to do
    const target = colMasterIdxs.reduce(
      (best, i) => (Math.abs(i - selectedColIdx) < Math.abs(best - selectedColIdx) ? i : best),
      colMasterIdxs[0]);
    if (target !== selectedColIdx) setSelectedColIdx(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colOrder, selectedColIdx, selectedId]);

  // ── B583 — Formula-column add/edit/delete (persist on proj.formulaCols + colConfig) ──
  const [formulaEditor, setFormulaEditor] = useState(null); // { mode:'add'|'edit', colKey?, label, formula } | null
  const saveFormulaCol = ({ colKey, label, formula }) => setData(d => {
    const p = d.projects?.[pid]; if (!p) return d;
    const existing = Array.isArray(p.formulaCols) ? p.formulaCols : [];
    let fcs, visible;
    const curCfg = readGridCfg(p, d);
    if (colKey) {
      fcs = existing.map(fc => fc.k === colKey ? { ...fc, l: label, formula } : fc);
      visible = curCfg.visible;
    } else {
      const key = "f_" + Date.now().toString(36);
      fcs = [...existing, { k: key, l: label, formula, w: 140 }];
      visible = curCfg.visible.includes(key) ? curCfg.visible : [...curCfg.visible, key];
    }
    return { ...d, projects: { ...d.projects, [pid]: { ...p, formulaCols: fcs, colConfig: { visible, widths: curCfg.widths } } } };
  });
  const deleteFormulaCol = (colKey) => setData(d => {
    const p = d.projects?.[pid]; if (!p) return d;
    const fcs = (Array.isArray(p.formulaCols) ? p.formulaCols : []).filter(fc => fc.k !== colKey);
    const curCfg = readGridCfg(p, d);
    const visible = curCfg.visible.filter(k => k !== colKey);
    const widths = { ...curCfg.widths }; delete widths[colKey];
    return { ...d, projects: { ...d.projects, [pid]: { ...p, formulaCols: fcs, colConfig: { visible, widths } } } };
  });
  // Live preview for the editor: evaluate an in-progress formula against the selected
  // row (or the first task), including the OTHER formula columns' computed values.
  const previewFormula = (formula) => {
    const PF = window.PlanyrFormula;
    if (!PF) return { ok: false, error: "engine unavailable" };
    const sample = tasks.find(t => t.id === selectedId) || tasks.find(t => !t.hasChildren) || tasks[0];
    if (!sample) return { ok: true, value: PF.BLANK, display: "", sampleName: null };
    // Mirror computeFormulaValues: aggregation reads the FULL tree's LEAF tasks (so a
    // SUM([Cost]) preview matches the grid, not a double-counted visible-row sum). The
    // sample row's own cells (incl. computed formula columns) drive the this-row context.
    const allTasks = (proj && Array.isArray(proj.tasks) && proj.tasks.length) ? proj.tasks : tasks;
    const parentIds = new Set(allTasks.map(t => t.parentId).filter(x => x !== null && x !== undefined));
    const colMap = t => {
      const cols = buildFormulaRowColumns(t);
      const fcCells = formulaValues[t.id] || {};
      formulaCols.forEach(fc => { const c = fcCells[fc.k]; if (c && fc.l) cols[fc.l.toLowerCase()] = c.ok ? c.value : PF.errVal(c.error); });
      return cols;
    };
    const aggRows = allTasks.filter(t => !parentIds.has(t.id)).map(colMap);
    const dateFmt = serial => toShortDate(PF.serialToISO(serial));
    const res = PF.evaluateFormula(formula, { columns: colMap(sample), rows: aggRows, rowIndex: 0, calendar: formulaCalendar(), today: formulaToday(), formatDate: dateFmt });
    return { ...res, display: res.ok ? PF.formatValue(res.value, { formatDate: dateFmt }) : res.error, sampleName: sample.name || ("Task " + sample.id) };
  };

  const [dragColKey, setDragColKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [colMenuOpen, setColMenuOpen] = useState(false);  // the "Columns" chooser flyout (portal)
  const [hdrCtx, setHdrCtx] = useState(null);             // right-click header menu { x, y, colKey } (portal)

  const persistVisible = (visible) => writeGridCfg(setData, pid, { visible, widths: cfg.widths });
  const persistWidths  = (widths)  => writeGridCfg(setData, pid, { visible: colOrder, widths });

  const reorderCols = (fromKey, toKey) => {
    if (fromKey === toKey || !fromKey || !toKey) return;
    const next = [...colOrder];
    const fi = next.indexOf(fromKey), ti = next.indexOf(toKey);
    if (fi < 0 || ti < 0) return;
    next.splice(fi, 1); next.splice(ti, 0, fromKey);
    persistVisible(next);
  };
  const hideCol = (k) => { if (k === "name") return; persistVisible(colOrder.filter(c => c !== k)); };
  const showCol = (k, afterKey) => {
    if (!colByK[k] || colOrder.includes(k)) return;  // colByK includes formula (f_) columns; COL_BY_K is built-ins only
    const next = [...colOrder];
    const at = afterKey != null ? next.indexOf(afterKey) + 1 : next.length;
    next.splice(at > 0 ? at : next.length, 0, k);
    persistVisible(next);
  };
  const resetCols = () => writeGridCfg(setData, pid, { visible: [...DEFAULT_GRID_COLS], widths: {} });

  const startResize = (colKey, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = dispW[colKey] ?? widthOf(colKey);
    let latestW = startW;
    const move = ev => { latestW = Math.max(36, startW + ev.clientX - startX); setLiveW({ k: colKey, w: latestW }); };
    const release = window.pinSchedCursor("col-resize", { onExit: () => up() });   // held even when the pointer leaves the 6px grip
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      release();
      setLiveW(null);
      persistWidths({ ...cfg.widths, [colKey]: latestW });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  const autoSizeCol = (colKey) => {
    const col = colByK[colKey];
    if (!col) return;
    const values = tasks.map(t => {
      let val = '';
      switch(colKey) {
        case 'name': val = t.name||''; break;
        case 'start': case 'end': { if(!t[colKey]){ val=''; break; } const [y,m,d]=t[colKey].split('-'); val=`${String(+m).padStart(2,'0')}/${String(+d).padStart(2,'0')}/${(y||'').slice(2)}`; break; }  // empty date → measure nothing, not the literal "NaN/NaN/"
        case 'duration': val = `${t.duration}d`; break;
        case 'health': val = HEALTH[t.health]?.label||''; break;
        case 'percentComplete': val = `${t._pct ?? effectivePercentComplete(t, proj?.tasks)}%`; break;
        case 'responsibleParty': val = ownerDisplayParts(ownerListOf(t)).label; break;
        case 'predecessors': val = fmtPreds(normPreds(t.predecessors)); break;
        case 'successors': val = String((succMap[t.id]||[]).length>0?(succMap[t.id]||[]).join(', '):''); break;
        case 'id': val = String(t.id); break;
        case 'cost': case 'budget': case 'actualCost': { const v=Number(t[colKey])||0; val = v?("$"+v.toLocaleString("en-US")):''; break; }
        default: val = col.t === "formula" ? (formulaValues[t.id]?.[colKey]?.display || '') : String(t[colKey]||'');
      }
      return val;
    });
    persistWidths({ ...cfg.widths, [colKey]: measuredColWidth(col.l||colKey, values, 36) });
  };

  return (
    <div style={{position:"relative",flex:1,minWidth:0,minHeight:0,display:"flex"}}>
    <div ref={ref} data-grid-scroll="1" data-scroll-bounds style={{flex:1,overflow:"auto",position:"relative",zoom:gridZoom,paddingBottom:`calc(var(--fab-dock, 0px) / ${gridZoom})`}} onScroll={handleScroll} onMouseEnter={()=>setHoverZone?.("grid")}>
      <div data-grid-header="1" style={{position:"sticky",top:0,zIndex:10,display:"flex",background:"var(--surf)",borderBottom:"2px solid var(--amber)",borderLeft:"2px solid transparent",minWidth:totalW,height:30}}>
        {orderedCols.map(c => (
          <div key={c.k} data-hdr-col={c.k} className={pinCls(c.k) || undefined}
            draggable={c.k !== "health" && c.k !== "status"}
            onDragStart={e=>{e.dataTransfer.effectAllowed="move";setDragColKey(c.k);}}
            onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect="move";setDragOverKey(c.k);}}
            onDragLeave={()=>setDragOverKey(null)}
            onDrop={e=>{e.preventDefault();reorderCols(dragColKey,c.k);setDragColKey(null);setDragOverKey(null);}}
            onDragEnd={()=>{setDragColKey(null);setDragOverKey(null);}}
            onContextMenu={e=>{e.preventDefault();e.stopPropagation();setHdrCtx({x:e.clientX,y:e.clientY,colKey:c.k});}}
            style={{width:dispW[c.k],flexShrink:0,padding:"0 8px",fontSize:10,fontWeight:600,
              color:"var(--mut)",letterSpacing:".06em",textTransform:"uppercase",
              display:"flex",alignItems:"center",justifyContent:c.k==="health"?"center":"flex-start",
              borderRight:"1px solid var(--bd)",borderLeft:dragOverKey===c.k&&dragColKey!==c.k?"2px solid var(--blue)":"2px solid transparent",
              fontFamily:"'Inter',system-ui,sans-serif",position:"relative",userSelect:"none",
              cursor:c.k!=="health"&&c.k!=="status"?"grab":"default",
              opacity:dragColKey===c.k?0.4:1,transition:"border-color .1s,opacity .1s",
              ...(pinStyle(c.k, ["var(--surf)"], 4) || {})}}>
            {c.k === "health"
              ? <HealthColHeader current={healthColStyle||"stoplight"} onChange={setHealthColStyle} />
              : c.k === "status"
              ? <StatusHeaderDropdown data={data} setData={setData} />
              : c.k === "notes"
              ? <NotesColHeader data={data} setData={setData} />
              : c.l}
            {c.k !== "health" && <div
              onMouseDown={e=>{e.stopPropagation();e.preventDefault();startResize(c.k,e);}}
              onClick={e=>e.stopPropagation()}
              onDoubleClick={e=>{e.stopPropagation();autoSizeCol(c.k);}}
              style={{position:"absolute",right:0,top:0,bottom:0,width:6,cursor:"col-resize",zIndex:2}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--blue)33"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"} />}
          </div>
        ))}
      </div>

      <div style={{position:"relative",height:totalRows*ROW_H,minWidth:totalW}}>
        {/* NEW-ROWMOVE — insertion-line drop indicator: positioned imperatively via dragLineRef
            during a row drag (see startRowDrag/computeAndPaint), never through React state, so
            painting it never re-renders this row list. Hidden (display:none) when not dragging
            or when hovering a blocked target (itself or its own descendant). */}
        <div ref={dragLineRef} data-drag-insert-line
          style={{position:"absolute", left:0, right:0, height:3, background:"var(--blue)", zIndex:50, pointerEvents:"none", display:"none"}} />
        {/* NEW-ROWNEST — the nest-under target: a box around the hovered row (blue = legal, red dashed =
            a row being dragged or inside one). Same imperative contract as the line above. */}
        <div ref={dragNestRef} data-drag-nest
          style={{position:"absolute", left:0, right:0, boxSizing:"border-box", borderRadius:3, zIndex:49, pointerEvents:"none", display:"none"}}>
          <span style={{position:"absolute", top:"50%", transform:"translateY(-50%)", left:0, color:"#fff", fontSize:10, fontWeight:600, lineHeight:1, padding:"2px 6px", borderRadius:3, fontFamily:"'Inter',system-ui,sans-serif", whiteSpace:"nowrap"}} />
        </div>
        {tasks.slice(startIdx, endIdx).map((task, i) => {
          const ri = startIdx + i;
          if (task.__rvProposed) {
            const rv = review || {};
            const lvl = task.level || 0;
            const cs = {fontSize:12, padding:"0 8px", height:ROW_H, display:"flex", alignItems:"center", overflow:"hidden", whiteSpace:"nowrap"};
            const mono = {fontFamily:"'Inter',system-ui,sans-serif"};
            const dateDisp = iso => { if (!iso) return ""; const [y,m,d] = iso.split('-'); return String(+m).padStart(2,'0')+'/'+String(+d).padStart(2,'0')+'/'+y.slice(2); };
            const creating = !!(rv && rv.isCreate);
            return (
              <div key="__rvprop" className="drow rv-prow" style={{top:ri*ROW_H, height:ROW_H, minWidth:totalW, background: creating ? "var(--row-create)" : "var(--row-target)", borderLeft: creating ? "2px solid #16a34a" : "2px solid var(--amber)"}}>
                {orderedCols.map(c => {
                  const w = dispW[c.k];
                  let inner = <span style={cs} />;
                  if (c.k === "name") inner = creating ? (
                    <span style={{...cs, paddingLeft:4+lvl*14, gap:0, flex:1, minWidth:0}}>
                      <span style={{width:16, flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"center", color:"#16a34a"}}><i className="ti ti-plus" style={{fontSize:12}}/></span>
                      <span style={{color:"#15803d", fontWeight:600, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", minWidth:0}}>{rv.newName || "New task"}</span>
                      <span style={{flexShrink:0, marginLeft:6, fontSize:8.5, fontWeight:700, color:"#15803d", background:"#dcfce7", border:"1px solid #86efac", borderRadius:4, padding:"1px 4px", letterSpacing:".04em"}}>NEW</span>
                    </span>
                  ) : (
                    <span style={{...cs, paddingLeft:4+lvl*14, gap:0, flex:1, minWidth:0}}>
                      <span style={{width:16, flexShrink:0, display:"inline-flex", alignItems:"center", justifyContent:"center", color:"var(--amber)"}}><i className="ti ti-corner-down-right" style={{fontSize:12}}/></span>
                      <span style={{color:"var(--amber)", fontWeight:600, fontStyle:"italic", fontSize:12, overflow:"hidden", textOverflow:"ellipsis", minWidth:0}}>proposed</span>
                    </span>
                  );
                  else if (c.k === "start") inner = rv.startChanged
                    ? <span style={{...cs, ...mono, justifyContent:"center", color:"var(--mut)", fontSize:11}}>{dateDisp(rv.propStart)}</span>
                    : <span style={{...cs, ...mono, justifyContent:"center"}} />;
                  else if (c.k === "end") inner = (rvEdit === "end")
                    ? <input {...NO_AUTOFILL} autoFocus className="ei" placeholder="M/D or M/D/YY" defaultValue={toShortDate(rv.propEnd)}
                        onBlur={e => { const iso = parseFlexDate(e.target.value); if (iso && rv.onEnd) rv.onEnd(iso); setRvEdit(null); }}
                        onKeyDown={e => { if (e.key==="Enter"){ e.preventDefault(); const iso=parseFlexDate(e.target.value); if(iso&&rv.onEnd) rv.onEnd(iso); setRvEdit(null); } else if (e.key==="Escape"){ setRvEdit(null); } }} />
                    : <span style={{...cs, ...mono, justifyContent:"center", color:"var(--mut)", fontSize:11, cursor:"text"}} title="Click to edit" onClick={()=>setRvEdit("end")}>{dateDisp(rv.propEnd)}</span>;
                  else if (c.k === "predecessors") inner = (rv.addedPreds && rv.addedPreds.length)
                    ? <span style={{...cs, color:"var(--amber)", fontWeight:600, gap:5, display:"inline-flex", alignItems:"center"}}><i className="ti ti-arrow-bar-to-right" style={{fontSize:13}}/>{rv.addedPreds.join(", ")}</span>
                    : <span style={cs} />;
                  else if (c.k === "duration") inner = (rvEdit === "duration")
                    ? <input {...NO_AUTOFILL} autoFocus className="ei" placeholder="days" defaultValue={rv.propDur!=null ? String(rv.propDur) : ""}
                        onBlur={e => { const n = parseInt(e.target.value, 10); if (!isNaN(n) && n >= 0 && rv.onDur) rv.onDur(n); setRvEdit(null); }}
                        onKeyDown={e => { if (e.key==="Enter"){ e.preventDefault(); const n=parseInt(e.target.value,10); if(!isNaN(n)&&n>=0&&rv.onDur) rv.onDur(n); setRvEdit(null); } else if (e.key==="Escape"){ setRvEdit(null); } }} />
                    : <span style={{...cs, ...mono, color:"var(--mut)", cursor:"text"}} title="Click to edit" onClick={()=>setRvEdit("duration")}>{rv.propDur!=null ? rv.propDur+"d" : ""}</span>;
                  else if (c.k === "health") inner = <span style={{...cs, justifyContent:"center", padding:0}}><HealthPicker value={rv.propStatus||"gray"} onChange={hk=>rv.onStatus&&rv.onStatus(hk)} /></span>;
                  else if (c.k === "status") inner = <span style={{...cs, padding:"0 4px"}}><StatusPicker value={rv.propStatus||"gray"} onChange={hk=>rv.onStatus&&rv.onStatus(hk)} /></span>;
                  else if (c.k === "responsibleParty") inner = (rvEdit === "owner")
                    ? <input {...NO_AUTOFILL} autoFocus className="ei" placeholder="Owner" defaultValue={rv.propOwner||""}
                        onBlur={e => { if (rv.onOwner) rv.onOwner(e.target.value); setRvEdit(null); }}
                        onKeyDown={e => { if (e.key==="Enter"){ e.preventDefault(); if(rv.onOwner) rv.onOwner(e.target.value); setRvEdit(null); } else if (e.key==="Escape"){ setRvEdit(null); } }} />
                    : <span style={{...cs, color: rv.propOwner ? "var(--txt)" : "var(--mut)", cursor:"text"}} title="Click to edit" onClick={()=>setRvEdit("owner")}>{rv.propOwner||""}</span>;
                  const wrap = {width:w, flexShrink:0, height:ROW_H, position:"relative", overflow: c.k==="health" ? "visible" : "hidden", borderRight:GRID_LINE, borderBottom:GRID_LINE,
                    ...(pinStyle(c.k, [creating ? "var(--row-create)" : "var(--row-target)"], 5) || {})};
                  return <div key={c.k} data-row-line className={pinCls(c.k) || undefined} style={wrap}>{inner}</div>;
                })}
                <div data-grid-strip style={{flex:"1 1 0", minWidth:0, height:ROW_H, position:"relative", borderBottom:GRID_LINE}} />
              </div>
            );
          }
          const isFocused = selectedId === task.id;
          // A parent ALWAYS reflects rolled-up child health — collapsed or expanded — so a
          // conditional-format rule (overdue/due-soon/complete) on the parent's own stale, non-
          // rolled fields can't flip its color when you expand it. Matches GanttView + MasterView
          // (which key on isSummary, not expand state); only leaves get computeDisplayHealth.
          const displayHealth = task.hasChildren
            ? (rolledHealthMap?.[task.id] || task.health)
            : computeDisplayHealth(task, data.settings, taskById);
          const isExpandedParent = task.hasChildren && task.isExpanded;
          const rowBg = task.__rvMover ? "var(--row-mover)" : task.__rvTarget ? "var(--row-target)" : (task.rowColor || (isExpandedParent ? (ri%2?"var(--row-alt)":"var(--bg)") : (displayHealth==="red"?"var(--row-red)":displayHealth==="yellow"?"var(--row-yellow)":displayHealth==="green"?"var(--row-green)":displayHealth==="paused"?"var(--row-paused)":ri%2?"var(--row-alt)":"var(--bg)")));
          return (
            <div key={task.id} className="drow" data-task-row={task.id} data-row-sel={(isFocused && !hasRange) ? "1" : undefined}
              style={{top:ri*ROW_H, height:ROW_H,
                // the selected row's blue accent is drawn on the FIRST cell (it sticks with the pinned columns
                // at every scroll position) — a border on the row itself scrolls away with the row.
                borderLeft: task.__rvTarget ? "2px solid var(--amber)" : "2px solid transparent",
                background: rowBg}}>
              {(task.__rvTarget || task.__rvPending !== undefined) ? <span onMouseDown={task.__rvPending!==undefined ? (e=>{e.stopPropagation(); review && review.pick(task.__rvPending);}) : undefined} title={task.__rvPending!==undefined ? "Review this update" : "Being reviewed"} style={{position:"absolute",left:3,top:"50%",transform:"translateY(-50%)",width:7,height:7,borderRadius:"50%",background:"var(--amber)",boxShadow:"0 0 0 2.5px #eef2ff",zIndex:7,cursor:task.__rvPending!==undefined?"pointer":"default"}}/> : null}
              {task.__rvMover ? <span style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",fontSize:10,fontWeight:600,color:"var(--amber)",background:"#fff3d6",border:"1px solid #f0c98a",padding:"0 5px",borderRadius:9,zIndex:7,pointerEvents:"none"}}>{task.__rvMover>=0?"+":""}{task.__rvMover}d</span> : null}

              {orderedCols.map((c) => { const ci = allCols.indexOf(c);
                const activeInMulti = isFocused && selectedColIdx === ci && isMulti(selRange);   // B2530690 — with several ranges the active cell keeps its own outline
                const active = isFocused && selectedColIdx === ci && (!hasRange || activeInMulti);
                const selected = inRange(ri, ci);
                const tinted = selected && hasRange && !activeInMulti;
                const cfmt = task.cellFmt?.[c.k]; // per-cell format (bold/italic/fill/underline/color/size)
                const cellOverlay = tinted ? "#dbeafe" : (cfmt?.fill || null);   // NEW-1 — the cell's own fill over the row colour; ONE value, read by the cell AND by its pinned layer stack
                // Predecessor editor shows a live hint below the input — let it escape the clipped 24px cell.
                const predEditing = c.k==="predecessors" && edit?.taskId===task.id && edit?.col===c.k;
                return (
                  <div key={c.k} data-col-key={c.k} data-cell-active={active ? "1" : undefined} data-cell-in-range={(selected && hasRange) ? "1" : undefined} className={pinCls(c.k) || undefined} style={{
                    width:dispW[c.k], flexShrink:0,
                    overflow: (c.k==="health" || predEditing) ? "visible" : "hidden",
                    height:ROW_H,
                    position:"relative",
                    zIndex: predEditing ? 30 : (active ? 2 : "auto"),
                    backgroundColor: cellOverlay || "transparent",   // longhand only: a `background` shorthand here resets the pinned cells' own layers on a re-render
                    fontWeight: cfmt?.bold ? 700 : undefined,
                    fontStyle: cfmt?.italic ? "italic" : undefined,
                    textDecoration: cfmt?.underline ? "underline" : undefined,
                    color: cfmt?.color || undefined,
                    borderRight: tinted ? GRID_LINE_RANGE : GRID_LINE,
                    borderBottom: tinted ? GRID_LINE_RANGE : GRID_LINE,
                    boxShadow: [selShadow(ri, ci, selected, active), (isFocused && c === orderedCols[0]) ? "inset 2px 0 0 0 var(--blue)" : "none"].filter(x => x !== "none").join(",") || "none",
                    userSelect: isDraggingCells.current ? "none" : "auto",
                    cursor: (c.k === "id" && !review && idPressMovesRows(selRange, ri, allCols.length)) ? "grab" : "default",   // the range-select drag's own `cell` cursor is pinned by the gesture (cellDragPin), never read from a ref here; an ID cell inside a multi-row selection is a pick-up handle (B2445008 ×2)
                    // NEW-1 — a pinned cell paints its own opaque look (row colour, then any range / cell fill on top)
                    ...(pinStyle(c.k, [rowBg, cellOverlay], 5) || {})
                  }}
                    onMouseDown={e => cellMouseDown(e, task, ri, c, ci)}
                    onClick={() => { if (skipColClickRef.current) { skipColClickRef.current = false; return; } setSelectedColIdx(ci); }}
                    onContextMenu={e => cellContextMenu(e, task, ri, c, ci)}
                    onDoubleClick={() => {
                      if (review) return;
                      const isParentDateLocked = task.hasChildren && (c.k==="start"||c.k==="end"||c.k==="duration"||c.t==="cost");
                      // Picker columns (health/status) have their own popover — text-edit on them
                      // would render the raw value (e.g. "yellow") in an input, which is meaningless
                      // to the user. Notes also handled separately via the notes modal.
                      const isPicker = c.k === "health" || c.k === "status";
                      if (c.e && c.t !== "notes" && !isPicker && !isParentDateLocked) setEdit({taskId: task.id, col: c.k});
                    }}>
                    {c.k === "id" && !review && (
                      <span className="rowgrip" data-row-drag-handle={task.id} title="Drag to move"
                        onMouseDown={e => { e.stopPropagation(); e.preventDefault(); startRowDrag(e, task.id, { onClick: () => { setSelectedId(task.id); setSelectedColIdx(0); setSelRange({r1:ri, r2:ri, c1:0, c2:allCols.length-1}); } }); }}
                        style={{position:"absolute", left:0, top:0, bottom:0, width:8, display:"flex", alignItems:"center", justifyContent:"center", zIndex:3}}>
                        <i className="ti ti-grip-vertical" style={{fontSize:10, color:"var(--mut)"}} />
                      </span>
                    )}
                    <Cell task={task} col={{...c, w:dispW[c.k]}} colMasterIdxs={colMasterIdxs} edit={edit} setEdit={setEdit} commit={commit} commitAndAdvance={commitAndAdvance} applyCommit={applyCommit}
                      proj={proj} succMap={succMap} getTaskName={getTaskName} data={data}
                      setNotesCtx={setNotesCtx} projId={proj?.id} updateTask={updateTask}
                      editStartChar={edit?.taskId===task.id && edit?.col===c.k ? editStartChar : null}
                      contacts={data?.settings?.contacts||[]}
                      formulaCell={c.t === "formula" ? (formulaValues[task.id]?.[c.k]) : undefined}
                      addContact={(nc)=>setData(d=>({...d, settings:{...d.settings, contacts:[...(d.settings?.contacts||[]), {id:Date.now(), ...nc}]}}))}
                      isExpandedParent={isExpandedParent} dispHealth={displayHealth} setSelectedColIdx={setSelectedColIdx} expandAnchorRef={expandAnchorRef} />

                  </div>
                );
              })}
              {stripCol && <div data-grid-strip
                onMouseDown={e => cellMouseDown(e, task, ri, stripCol, stripCi)}
                onContextMenu={e => cellContextMenu(e, task, ri, stripCol, stripCi)}
                style={{flex:"1 1 0", minWidth:0, height:ROW_H, position:"relative", cursor:"default",
                  background: (stripJoinsRange && inRange(ri, stripCi)) ? "#dbeafe" : "transparent",
                  borderBottom: (stripJoinsRange && inRange(ri, stripCi)) ? GRID_LINE_RANGE : GRID_LINE,
                  boxShadow: stripShadow(ri)}} />}
            </div>
          );
        })}
        {Array.from({length: Math.max(0, Math.min(endIdx, totalRows) - Math.max(startIdx, tasks.length))}, (_, i) => {
          const ri = Math.max(startIdx, tasks.length) + i;
          const isNewTaskFocused = ri === tasks.length && selectedId === "__NEW_TASK__";
          return (
            <div key={`_e${ri}`} className="drow"
              data-new-task-row={ri===tasks.length ? (isNewTaskFocused ? "sel" : "1") : undefined}
              onClick={ri===tasks.length ? ()=>addTask() : undefined}
              style={{top:ri*ROW_H, height:ROW_H,
                borderLeft: isNewTaskFocused ? "2px solid var(--blue)" : "2px solid transparent",
                background: isNewTaskFocused ? "var(--row-focus)" : (ri%2?"var(--row-alt)":"var(--bg)"),
                cursor:ri===tasks.length?"pointer":"default"}}>
              {orderedCols.map(c => (
                <div key={c.k} data-row-line className={pinCls(c.k) || undefined} style={{width:dispW[c.k],flexShrink:0,borderRight:GRID_LINE,borderBottom:GRID_LINE,height:ROW_H,position:"relative",
                  ...(pinStyle(c.k, [isNewTaskFocused ? "var(--row-focus)" : (ri%2?"var(--row-alt)":"var(--bg)")], 5) || {}),
                  ...(ri===tasks.length && c.k==="name" ? {
                    color: isNewTaskFocused ? "var(--blue)" : "var(--mut)",
                    fontSize:11,display:"flex",alignItems:"center",paddingLeft:8,
                    fontWeight: isNewTaskFocused ? 600 : undefined
                  } : {})}}>
                  {ri===tasks.length && c.k==="name" ? "+ New task" : ""}
                </div>
              ))}
              <div data-grid-strip style={{flex:"1 1 0", minWidth:0, height:ROW_H, position:"relative", borderBottom:GRID_LINE}} />
            </div>
          );
        })}
      </div>
    </div>
    {/* B1397536 — corrects B1350080's dedicated 28px gutter, which the owner saw live as a dead
        extra column running the table's full height. The Columns (⋯) button now sits directly ON
        the header row, pinned to the pane's true right edge, and deliberately OVERLAPS the tail
        of whatever column is last — no reserved width, no column shrink, no per-row spacer. It's
        a sibling of the scrolling region (not inside it), so it never scrolls away with the
        columns even though it now shares their row instead of owning a strip of its own. */}
    <button ref={colBtnRef} onClick={()=>{setColMenuOpen(o=>!o);setHdrCtx(null);}}
      title="Show, hide, add or reorder table columns"
      style={{position:"absolute",top:4,right:14+pinRW,zIndex:30,display:"flex",alignItems:"center",justifyContent:"center",width:22,height:22,padding:0,
        border:"none",borderRadius:6,cursor:"pointer",
        color: colMenuOpen ? "var(--amber)" : "var(--mut)",
        background: colMenuOpen ? "#eef2ff" : "transparent"}}
      onMouseEnter={e=>{if(!colMenuOpen){e.currentTarget.style.color="var(--amber)";e.currentTarget.style.background="var(--surf)";}}}
      onMouseLeave={e=>{if(!colMenuOpen){e.currentTarget.style.color="var(--mut)";e.currentTarget.style.background="transparent";}}}>
      <svg viewBox="0 0 24 24" fill="currentColor" width={14} height={14}><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
    </button>
    {colMenuOpen && <GridColumnsChooser cols={allCols} visible={colOrder} hidden={hiddenCols}
      anchor={colBtnRef.current?.getBoundingClientRect()}
      onToggle={(k,on)=>on?showCol(k):hideCol(k)}
      onMove={(k,dir)=>{const next=[...colOrder];const i=next.indexOf(k);const j=i+dir;if(i<0||j<0||j>=next.length)return;next.splice(i,1);next.splice(j,0,k);persistVisible(next);}}
      onReset={resetCols} onClose={()=>setColMenuOpen(false)}
      onAddFormula={()=>{setColMenuOpen(false);setFormulaEditor({mode:"add",label:"",formula:""});}}
      onEditFormula={(k)=>{const fc=formulaCols.find(f=>f.k===k);if(fc){setColMenuOpen(false);setFormulaEditor({mode:"edit",colKey:k,label:fc.l||"",formula:fc.formula||""});}}}
      onDeleteFormula={(k)=>deleteFormulaCol(k)} />}
    {hdrCtx && <GridHeaderMenu ctx={hdrCtx} hidden={hiddenCols} isFormula={colByK[hdrCtx.colKey]?.t==="formula"}
      onHide={()=>{hideCol(hdrCtx.colKey);setHdrCtx(null);}}
      onInsert={(k)=>{showCol(k,hdrCtx.colKey);setHdrCtx(null);}}
      onColumns={()=>{setHdrCtx(null);setColMenuOpen(true);}}
      onAddFormula={()=>{setHdrCtx(null);setFormulaEditor({mode:"add",label:"",formula:""});}}
      onEditFormula={()=>{const fc=formulaCols.find(f=>f.k===hdrCtx.colKey);if(fc)setFormulaEditor({mode:"edit",colKey:fc.k,label:fc.l||"",formula:fc.formula||""});setHdrCtx(null);}}
      onDeleteFormula={()=>{deleteFormulaCol(hdrCtx.colKey);setHdrCtx(null);}}
      onClose={()=>setHdrCtx(null)} />}
    {formulaEditor && <FormulaColumnEditor
      mode={formulaEditor.mode} initLabel={formulaEditor.label} initFormula={formulaEditor.formula}
      columnNames={formulaColumnNames(proj)} existingLabels={formulaCols.filter(f=>f.k!==formulaEditor.colKey).map(f=>f.l)}
      preview={previewFormula}
      onSave={({label,formula})=>{saveFormulaCol({colKey:formulaEditor.colKey,label,formula});setFormulaEditor(null);}}
      onDelete={formulaEditor.mode==="edit"?()=>{deleteFormulaCol(formulaEditor.colKey);setFormulaEditor(null);}:null}
      onClose={()=>setFormulaEditor(null)} />}
    </div>
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  GridView: [() => GridView],
});
