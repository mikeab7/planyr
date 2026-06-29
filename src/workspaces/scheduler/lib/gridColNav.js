/* Scheduler grid — keyboard column navigation that skips hidden columns.
 *
 * The Schedule grid keeps a MASTER registry of every available column (`COLS` in
 * public/sequence/index.html) and a per-project subset that's actually shown, in the
 * user's chosen DISPLAY ORDER (the project's `colConfig.visible` list). The cell cursor
 * (`selectedColIdx`) is an index into the MASTER registry — NOT into the visible list.
 *
 * The bug these helpers fix: arrow/Tab navigation used to step `selectedColIdx` by ±1
 * through the master registry, clamped only at the registry ends. When a project hides
 * columns that sit between two visible ones (e.g. the default layout hides Health /
 * Status / Owner, which live immediately left of Cost in the registry), stepping left
 * from Cost walked onto Owner → Status → Health in turn. Those columns aren't rendered,
 * so no on-screen cell matched the cursor and the blue selection outline silently
 * vanished for several key-presses until the cursor happened back onto a visible column.
 *
 * The fix: walk the VISIBLE columns in DISPLAY ORDER, so the cursor always lands on the
 * adjacent on-screen column. The cursor stays a master index (smallest change to the
 * grid, whose `COLS[selectedColIdx]` reads and `selectedColIdx === ci` render check keep
 * working unchanged) — these helpers just translate "one column left/right on screen"
 * into the right master index.
 *
 * ⚠ Pure + dependency-free on purpose: the live algorithm is mirrored INLINE in
 * public/sequence/index.html (module-level `stepVisibleColIdx`, App's `visibleColIdxs` /
 * `stepGridCol`, and the GridView snap effect), because that file is a standalone in-browser
 * Babel page and cannot import this module. This module is the unit-tested source of truth
 * for the algorithm — keep the inline copy in sync with it.
 */

/**
 * Master-registry indices of the visible columns, in display order.
 * @param {string[]} masterKeys  every column key, in master-registry (COLS) order
 * @param {string[]} visibleKeys the shown column keys, in display order
 * @returns {number[]} the master indices of `visibleKeys`, display order, unknown keys dropped
 */
export function visibleColMasterIdxs(masterKeys, visibleKeys) {
  const pos = new Map();
  (masterKeys || []).forEach((k, i) => { if (!pos.has(k)) pos.set(k, i); });
  const out = [];
  (visibleKeys || []).forEach((k) => {
    const i = pos.get(k);
    if (i !== undefined) out.push(i);
  });
  return out;
}

/**
 * Nearest visible master-index to a cursor that is currently OFF-TABLE (its column is
 * hidden), biased by direction of travel. Used when the cursor sits on a just-hidden
 * column or the initial Id column is hidden.
 * @param {number[]} idxs   visible master indices, display order
 * @param {number}   curIdx the current (off-table) master index
 * @param {number}   dir    >0 → snap to the next column to the right, <0 → left, 0 → closest
 * @returns {number} a visible master index (or `curIdx` if there are none)
 */
export function snapToVisible(idxs, curIdx, dir) {
  if (!idxs || !idxs.length) return curIdx;
  if (dir > 0) {
    const fwd = idxs.find((i) => i > curIdx);
    return fwd !== undefined ? fwd : idxs[idxs.length - 1];
  }
  if (dir < 0) {
    let back;
    idxs.forEach((i) => { if (i < curIdx) back = i; });
    return back !== undefined ? back : idxs[0];
  }
  // dir 0 → closest remaining visible column by master-index distance (column-hidden snap)
  return idxs.reduce((best, i) => (Math.abs(i - curIdx) < Math.abs(best - curIdx) ? i : best), idxs[0]);
}

/**
 * Step the cursor to the adjacent VISIBLE column in DISPLAY ORDER, given the visible
 * columns already resolved to master indices. Clamps at the first / last visible column;
 * snaps onto the table if `curIdx` is off-table. This is the core the inline copy in
 * public/sequence/index.html mirrors (it has `orderedCols` on hand, so it precomputes the
 * indices once and calls this shape).
 * @param {number[]} idxs   visible master indices, display order
 * @param {number}   curIdx current cursor master index
 * @param {number}   dir    >0 → right/next column, <0 → left/previous column
 * @returns {number} the master index of the destination column
 */
export function stepVisibleColByIdx(idxs, curIdx, dir) {
  if (!idxs || !idxs.length) return curIdx; // nothing on screen to land on — leave the cursor put
  const pos = idxs.indexOf(curIdx);
  if (pos === -1) return snapToVisible(idxs, curIdx, dir); // off-table — snap onto the table
  const step = dir > 0 ? 1 : -1;
  const next = Math.max(0, Math.min(idxs.length - 1, pos + step));
  return idxs[next];
}

/**
 * Step the cursor (`curIdx`, a master index) to the adjacent VISIBLE column in DISPLAY
 * ORDER. Clamps at the first / last visible column — the cursor never leaves the table
 * and never lands on a hidden column.
 * @param {string[]} masterKeys  every column key, master order
 * @param {string[]} visibleKeys shown column keys, display order
 * @param {number}   curIdx      current cursor master index
 * @param {number}   dir         >0 → right/next column, <0 → left/previous column
 * @returns {number} the master index of the destination column
 */
export function stepVisibleCol(masterKeys, visibleKeys, curIdx, dir) {
  return stepVisibleColByIdx(visibleColMasterIdxs(masterKeys, visibleKeys), curIdx, dir);
}
