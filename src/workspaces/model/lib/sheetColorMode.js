/* Model workspace — the input/formula/cross-sheet-link COLOUR toggle (Stage 3, NEW-2, owner
 * brief 2026-09-03). The financial-modelling convention: BLUE for a hardcoded input, BLACK for
 * a same-sheet formula, GREEN for a formula linking to another sheet — derived automatically
 * (see sheetEngine.js's `cellColorKind`), ON by default, with a ribbon toggle for anyone
 * applying their own font colours (a manual colour always wins — SheetView.jsx's own render
 * decides that precedence, this module is just the ON/OFF switch's storage).
 *
 * A VIEW preference, not sheet data — never rides the undo stack, never syncs to the cloud (two
 * people looking at the same model have no reason to share this device's toggle). UNLIKE
 * Format Painter/AutoFilter (ModelApp.jsx's `painter`/`filterOn`, which deliberately reset with
 * every project because a stray one surviving a reload would be confusing), this one IS
 * persisted per project — it's a standing display choice ("I use my own colours, leave mine
 * alone"), not a mid-task gesture, so losing it on every reload would be the confusing part.
 * Same per-project localStorage tier `readZoom`/`writeZoom` (sheetZoom.js) already uses, for the
 * identical reason (TIER-BY-REBUILDABILITY, CLAUDE.md) — a few bytes, nothing to budget.
 */

const KEY_PREFIX = "planyr:model:autocolor:v1:";
export const DEFAULT_AUTO_COLOR = true;

export function readAutoColor(projectId) {
  if (!projectId || typeof localStorage === "undefined") return DEFAULT_AUTO_COLOR;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + projectId);
    return raw == null ? DEFAULT_AUTO_COLOR : JSON.parse(raw) !== false;
  } catch (_) {
    return DEFAULT_AUTO_COLOR;
  }
}

export function writeAutoColor(projectId, on) {
  if (!projectId || typeof localStorage === "undefined") return;
  try { localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(!!on)); } catch (_) { /* best-effort */ }
}
