import { exposeToHarness } from "../harnessGlobals.js";

// NEW-1 (Schedule grid, one light full grid) — THE one cell-line rule for every grid cell, ID and TASK
// included: a faint solid line on the right (column divider) and bottom (row line), same token everywhere.
// Each cell draws its OWN bottom line because the pinned ID/TASK cells paint an opaque background that
// covers the row's border-bottom (the row is ROW_H tall, border-box, and its cells are ROW_H too).
export const GRID_LINE = "1px solid var(--bd)";
export const GRID_LINE_RANGE = "1px solid #93c5fd";

// NEW-1 — the ONE rule for how a frozen (pinned) grid cell stacks its fills. `fills` is bottom → top (the
// row's colour, then the cell's own range tint / per-cell fill); CSS lists the TOP layer first, so reverse.
// A solid fill each (no opacity), laid over --bg by the caller, so scrolled content never shows through.
export const pinnedFillLayers = (fills) => [...fills.filter(Boolean)].reverse().map(f => `linear-gradient(${f},${f})`).join(",");

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  GRID_LINE: [() => GRID_LINE],
  GRID_LINE_RANGE: [() => GRID_LINE_RANGE],
  pinnedFillLayers: [() => pinnedFillLayers],
});
