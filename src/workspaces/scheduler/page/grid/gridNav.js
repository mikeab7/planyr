import { exposeToHarness } from "../harnessGlobals.js";


// Keyboard column navigation steps through the VISIBLE columns in DISPLAY ORDER so the
// cell cursor (a COLS/master index) never lands on a hidden, non-rendered column (which
// would make the blue selection outline vanish). `visIdxs` = master indices of the visible
// columns, display order. Mirrors stepVisibleColByIdx in
// src/workspaces/scheduler/lib/gridColNav.js (unit-tested) — keep the two in sync.
// NOTE: every caller passes dir = +1 or -1; the off-table snap below collapses dir<=0 into
// the backward walk. The module's distinct dir===0 closest-by-distance case is NOT needed
// here — that "selected column got hidden" snap is handled by the GridView effect instead.
export function stepVisibleColIdx(visIdxs, curIdx, dir) {
  if (!visIdxs || !visIdxs.length) return curIdx;
  const pos = visIdxs.indexOf(curIdx);
  if (pos === -1) { // cursor off-table (hidden / initial id column) — snap onto the table toward dir
    if (dir > 0) { const f = visIdxs.find(i => i > curIdx); return f !== undefined ? f : visIdxs[visIdxs.length - 1]; }
    let b; visIdxs.forEach(i => { if (i < curIdx) b = i; }); return b !== undefined ? b : visIdxs[0];
  }
  return visIdxs[Math.max(0, Math.min(visIdxs.length - 1, pos + (dir > 0 ? 1 : -1)))];
}

// NEW-1 (owner report 2026-10-19, B463922 lineage) — Up/Down arrow row navigation. A selection in the
// visible list moves exactly one row; a LOST selection (its row hidden by a collapse / Focus, or deleted)
// is re-anchored at the gap it occupied and moves one row from THERE — never to the first or last row,
// which is where the old `findIndex === -1` fallbacks sent it (measured: fold the group holding the
// selection, press ↓ or ↑ → row 1 and the view to the top; delete a row, press ↓ → row 1, ↑ → the last
// row). Mirrors stepGridRow in src/workspaces/scheduler/lib/gridRowNav.js BYTE-IDENTICALLY — the unit
// tests (test/gridRowNav.test.js) fail if the two diverge.
export function stepGridRow(flat, allTasks, selectedId, dir, lastIdx, topIdx) {
  const NEW = "__NEW_TASK__";
  const n = flat ? flat.length : 0;
  if (!n) return null;                                        // nothing to move through — never invent a destination
  const clamp = i => Math.max(0, Math.min(n - 1, i));
  if (selectedId === NEW) return dir < 0 ? flat[n - 1].id : null;
  const idx = selectedId == null ? -1 : flat.findIndex(t => t.id === selectedId);
  if (idx >= 0) {
    if (dir > 0) return idx === n - 1 ? NEW : flat[idx + 1].id;
    return flat[Math.max(0, idx - 1)].id;
  }
  // The selection is LOST: hidden (its group collapsed or Focused) or gone (deleted). Re-anchor at the
  // gap g where it sat — between flat[g] and flat[g + 1] — and move one row from there.
  let g = null;
  if (selectedId != null && allTasks) {
    // Still in the schedule, just hidden: the gap is after the last VISIBLE row that comes before it in
    // the full visual order (allTasks is stored in visual order).
    const pos = allTasks.findIndex(t => t.id === selectedId);
    if (pos >= 0) {
      const before = new Set(allTasks.slice(0, pos).map(t => t.id));
      g = -1;
      for (let i = 0; i < n; i++) if (before.has(flat[i].id)) g = i;
    }
  }
  if (g == null && Number.isInteger(lastIdx) && lastIdx >= 0) g = Math.min(lastIdx, n) - 1;  // deleted: the slot it last held
  if (g == null) return flat[clamp(Number.isInteger(topIdx) ? topIdx : 0)].id;               // nothing known: the row at the top of the view
  if (dir > 0) return g + 1 >= n ? NEW : flat[Math.max(0, g + 1)].id;
  return flat[clamp(g)].id;
}

// NEW-1 (B2451776, owner request 2026-10-28) — Ctrl/Cmd+Arrow jumps across blank cells like Excel: ride a run of
// filled cells to its last one, otherwise land on the next filled cell, otherwise the edge (first / last TASK row
// — never "+ New task" — or first / last visible column). Navigation is by VISIBLE order, so collapsed / Focused-away
// rows are skipped. "Blank" = the cell draws nothing that carries data (a rolled-up date on a summary IS data; the
// Notes "+" and an empty Owner are not). These three functions mirror src/workspaces/scheduler/lib/gridCtrlNav.js
// BYTE-IDENTICALLY (save the `export `); test/gridCtrlNav.test.js fails if they diverge. Rules + rationale live there.
function ctrlJumpIndex(isBlank, n, cur, dir) {
  const inRange = i => i >= 0 && i < n;
  const edge = dir > 0 ? n - 1 : 0;
  const next = cur + dir;
  if (!inRange(next)) return inRange(cur) ? cur : null;           // already on the edge (or off it, heading away)
  if (inRange(cur) && !isBlank(cur) && !isBlank(next)) {
    let i = next;                                                   // inside a run: ride it to its last cell
    while (inRange(i + dir) && !isBlank(i + dir)) i += dir;
    return i;
  }
  let i = next;                                                     // on / before a gap: the next filled cell
  while (inRange(i) && isBlank(i)) i += dir;
  return inRange(i) ? i : edge;                                     // none → the edge
}

export function gridCtrlArrowTarget(key, rowCount, colMasters, row, col, blankAt) {
  const dir = (key === "ArrowDown" || key === "ArrowRight") ? 1 : -1;
  if (key === "ArrowUp" || key === "ArrowDown") {
    if (!(rowCount > 0)) return null;
    const r = ctrlJumpIndex(i => blankAt(i, col), rowCount, row, dir);
    return r == null ? null : { row: r, col };
  }
  const nc = colMasters ? colMasters.length : 0;
  if (!nc) return null;
  const pos = colMasters.indexOf(col);
  if (pos < 0) {                                                    // the cursor sits on a hidden column: snap toward dir
    if (dir > 0) { const f = colMasters.find(i => i > col); return { row, col: f !== undefined ? f : colMasters[nc - 1] }; }
    let b; colMasters.forEach(i => { if (i < col) b = i; });
    return { row, col: b !== undefined ? b : colMasters[0] };
  }
  const j = ctrlJumpIndex(q => blankAt(row, colMasters[q]), nc, pos, dir);
  return j == null ? null : { row, col: colMasters[j] };
}

export function gridCellBlank(task, col, env) {
  if (!task) return true;
  if (col.t === "formula") {
    const f = env.formula(task.id, col.k);
    return !f || f.display === "" || f.display == null;
  }
  switch (col.k) {
    case "id": return false;
    case "name": return String(task.name == null ? "" : task.name).trim() === "";
    case "start": case "end": return !task[col.k];
    case "duration": return task.duration === "" || task.duration == null;
    case "predecessors": return env.predCount(task.predecessors) === 0;
    case "successors": return env.succCount(task.id) === 0;
    case "health": case "status": return !!(task.hasChildren && task.isExpanded);
    case "percentComplete": return false;
    case "responsibleParty": return env.ownerCount(task) === 0;
    case "cost": case "budget": case "actualCost": {
      const rolledKey = col.k === "cost" ? "rolledCost" : col.k === "budget" ? "rolledBudget" : "rolledActual";
      return !(task[rolledKey] ?? (Number(task[col.k]) || 0));
    }
    case "notes": return !(task.notes && task.notes.length);
    case "meetingBody": return task.hasChildren ? true : !(task.deadlineForTaskId != null || task.meetingBound);
    case "floatToDeadline": return env.floatDays(task) == null;
    case "costIfMissed": return env.costDays(task) == null;
    default: return task[col.k] == null || task[col.k] === "";
  }
}

// B2470832 — THE one rule for "this row is a Focus group": it has at least one child. `hasChildren` on the grid's
// rows (the flattened list and the review list), the Focus chip's visibility, and Alt+F's target all come from
// this set, so they can never disagree. Whether anything is currently HIDEABLE in the group is a different
// question (hideableCount) and decides only what the chip's tooltip and Alt+F's toast say — never whether the
// control exists. (It used to decide that too, plus "is expanded": a group whose children were all in progress,
// or one that was collapsed, had no Focus button at all while its siblings did.)
export function focusGroupIds(tasks) {
  const ids = new Set();
  (tasks || []).forEach(t => { if (t.parentId != null) ids.add(t.parentId); });
  return ids;
}
// The grid draws a Focus chip on exactly these rows. `hideableCount` is a number only on the Focus-aware
// grid list (flatTasks); the review list ignores Focus entirely, so it has no chip.
export function rowCanFocus(row) { return !!row && !!row.hasChildren && typeof row.hideableCount === "number"; }
// Chip tooltip. Every variant keeps its established prefix ("Focus: hide" / "Show all tasks") — other
// harnesses tell the chip's title apart from the task name by it.
export function focusChipTitle(row) {
  if (row.focused)
    return `Show all tasks in this group — ${row.hideableDone} completed, ${row.hideablePaused} paused, ${row.hideableUpcoming} not started hidden (Alt+F)`;
  if (row.hideableCount > 0)
    return `Focus: hide ${row.hideableCount} completed / paused / not-started task${row.hideableCount>1?'s':''} (Alt+F)`;
  return "Focus: hide completed / paused / not-started tasks here — none right now (Alt+F)";
}

// NEW-1 (B2455200) — Alt+F toggles Focus. WHICH group: the anchor row is the TOP selected row; if it is a
// summary (has children) it is that row's own Focus, if it is a plain task it is its parent group's, and a
// top-level plain task (no parent) has none -> null (the key does nothing, no error). Pure; unit-tested by
// extracting this source (test/scheduleFocusKey.test.js).
export function focusToggleTarget(allTasks, anchorId) {
  if (anchorId == null || anchorId === "__NEW_TASK__") return null;
  const t = (allTasks || []).find(x => x.id === anchorId);
  if (!t) return null;
  if (focusGroupIds(allTasks).has(t.id)) return t.id;
  return (t.parentId != null && allTasks.some(x => x.id === t.parentId)) ? t.parentId : null;
}
// After a Focus toggle: where the selection goes. Kept when its row is still visible; else the nearest
// ANCESTOR that is visible (the parent summary row, or higher when the parent is itself hidden); null when
// nothing qualifies (the selection is left alone).
export function focusReselectTarget(allTasks, visibleIds, selId) {
  if (selId == null || selId === "__NEW_TASK__" || visibleIds.has(selId)) return selId;
  const byId = new Map((allTasks || []).map(t => [t.id, t]));
  let cur = byId.get(selId);
  for (let guard = 0; cur && cur.parentId != null && guard < 1000; guard++) {
    if (visibleIds.has(cur.parentId)) return cur.parentId;
    cur = byId.get(cur.parentId);
  }
  return null;
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  stepVisibleColIdx: [() => stepVisibleColIdx],
  stepGridRow: [() => stepGridRow],
  ctrlJumpIndex: [() => ctrlJumpIndex],
  gridCtrlArrowTarget: [() => gridCtrlArrowTarget],
  gridCellBlank: [() => gridCellBlank],
  focusGroupIds: [() => focusGroupIds],
  rowCanFocus: [() => rowCanFocus],
  focusChipTitle: [() => focusChipTitle],
  focusToggleTarget: [() => focusToggleTarget],
  focusReselectTarget: [() => focusReselectTarget],
});
