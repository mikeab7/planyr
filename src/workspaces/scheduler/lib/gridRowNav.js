/* Scheduler grid — Up/Down arrow row navigation that never throws the cursor to the first or last row.
 *
 * NEW-1 (owner report 2026-10-19, B463922 lineage): "I just click the up or down arrow, and it will like
 * take me all the way up to the top of the schedule or all the way to the bottom." Measured (see
 * ui-audit/verify-grid-keynav-after-commit.mjs): the old App keydown handler moved from
 * `flat.findIndex(t => t.id === selectedId)`, and when the selected row was NOT in the visible list it
 * fell back to an extreme — `tasks[0]` for ArrowDown (idx −1 → +1 → 0) and for ArrowUp (idx −1 → max(0,−2)),
 * or the LAST row for ArrowUp when selectedId was null (idx = tasks.length). The selection leaves the list
 * whenever its row is hidden (its group is collapsed — the collapse toggle deliberately does not move the
 * selection, B463922 — or a Focused group hides it after a status edit) or deleted (Delete clears it to
 * null). One arrow press then put the cursor, and the selection-chase scroll, on row 1 or the last row.
 *
 * The rule here: a selection that is in the list moves exactly one row (unchanged). A LOST selection is
 * re-anchored at the GAP it occupies and moves one row from there:
 *   · hidden  → the gap is right after the last visible row that precedes it in the full visual order,
 *               so Up lands on the row just above where it sat (e.g. the collapsed group row) and Down on
 *               the row just below the folded group;
 *   · deleted → the gap is the slot it last held (`lastIdx`), so Down lands on the row that slid up into
 *               it and Up on the row above;
 *   · unknown → the row at the top of the viewport (`topIdx`) is selected, without moving.
 * An empty list returns null — never "+ New task" invented from an empty list.
 *
 * ⚠ Pure + dependency-free: mirrored BYTE-IDENTICAL (save the `export `) as module-level `stepGridRow` in
 * public/sequence/index.html, which is a standalone in-browser Babel page and cannot import this module.
 * test/gridRowNav.test.js fails if the two bodies diverge.
 *
 * @param {Array<{id:*}>} flat      the visible (flattened) rows, in display order
 * @param {Array<{id:*}>} allTasks  every task of the project, in visual order (proj.tasks)
 * @param {*}      selectedId       the selected task id, "__NEW_TASK__", or null
 * @param {number} dir              +1 (ArrowDown) or −1 (ArrowUp)
 * @param {?number} lastIdx         the flat index the selection was last seen at
 * @param {?number} topIdx          the flat index of the row at the top of the viewport
 * @returns {*} the id to select, "__NEW_TASK__", or null for "do nothing"
 */
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
