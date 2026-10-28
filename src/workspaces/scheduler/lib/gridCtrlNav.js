/* Scheduler grid — Ctrl/Cmd+Arrow jumps across blank cells the way Excel does.
 *
 * NEW-1 (owner request 2026-10-28, B2451776): "in Schedule › Grid, Ctrl + an arrow key should work like Excel,
 * skipping over blank cells." Dedupe: nothing in the grid's keyboard code handled Ctrl+Arrow (the plain-arrow
 * branch declines when a modifier is held; the Ctrl branch only knows Z/Y/C/X/V), so this is a new branch beside
 * the plain arrows, not a second handler for the same key.
 *
 * THE RULE (Excel's, exactly). From the active cell, look at the NEXT cell in the arrow's direction:
 *   · current AND next both non-blank → move to the LAST non-blank cell of that run (the cell before a blank);
 *   · otherwise (current blank, or next blank) → move to the NEXT non-blank cell in that direction;
 *   · none exists → the edge: first / last task row (never the "+ New task" row) for Up / Down, first / last
 *     VISIBLE column for Left / Right.
 * Navigation is by VISIBLE order — the rows and columns the user can see — so a collapsed group's children and a
 * Focus-hidden row are skipped exactly as Excel skips hidden rows, and a hidden column is never landed on.
 *
 * WHAT "BLANK" MEANS (gridCellBlank): the cell DRAWS nothing that carries data.
 *   · A computed / rolled-up value on a summary row (a rolled start / finish / duration / cost, a rolled
 *     percent) is a visible value → NON-blank. So is the ID, and the "N%" of a Complete column (0% is shown).
 *   · A placeholder is blank: the Notes "+", the "New task" prompt on an unnamed row, the "— none —" /
 *     "set up…" / "—" of the Meeting column, an empty Owner cell, and the Status / Health cell of an EXPANDED
 *     summary (the grid draws nothing there — its children carry the colour).
 *
 * ⚠ Pure + dependency-free: the three functions below are mirrored BYTE-IDENTICAL (save the `export `) in
 * public/sequence/index.html, which is a standalone in-browser Babel page and cannot import this module.
 * test/gridCtrlNav.test.js fails if any body diverges. The page-specific helpers (normPreds, ownerListOf,
 * the formula and meeting evaluators) reach gridCellBlank through `env`, so this file needs none of them.
 */

/**
 * The 1-D Excel jump.
 * @param {(i:number)=>boolean} isBlank  is position i (0 … n-1) blank?
 * @param {number} n                     how many positions there are
 * @param {number} cur                   the active position — may sit just OUTSIDE 0 … n-1 (the "+ New task"
 *                                       row is position n), where it counts as blank
 * @param {number} dir                   +1 or −1
 * @returns {?number} the position to land on (cur itself when already at the edge), or null when there is
 *                    nowhere to go from an out-of-range start
 */
export function ctrlJumpIndex(isBlank, n, cur, dir) {
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

/**
 * Where Ctrl+<key> takes the active cell.
 * @param {string} key                 ArrowUp | ArrowDown | ArrowLeft | ArrowRight
 * @param {number} rowCount            how many visible TASK rows there are ("+ New task" excluded)
 * @param {number[]} colMasters        master indices of the visible columns, in DISPLAY order
 * @param {number} row                 the active row's index in the visible list; rowCount means "+ New task"
 * @param {number} col                 the active column's master index
 * @param {(r:number, c:number)=>boolean} blankAt  is the cell at visible row r / master column c blank?
 * @returns {?{row:number, col:number}} the destination (the same cell when already at the edge), or null
 */
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

/**
 * Does this cell DRAW nothing that carries data? Mirrors what Cell() in the grid renders, column by column.
 * @param {object} task   a visible (flattened) task row: start / end / duration / notes / hasChildren /
 *                        isExpanded / rolledCost … as GridView sees it
 * @param {{k:string, t?:string}} col   the column's registry entry
 * @param {{formula:Function, predCount:Function, succCount:Function, ownerCount:Function,
 *          floatDays:Function, costDays:Function}} env   the page's own evaluators
 * @returns {boolean}
 */
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
