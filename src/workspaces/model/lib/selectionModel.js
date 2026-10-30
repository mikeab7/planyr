/* The Spreadsheet's selection model now lives in src/shared/selection/rangeSelection.js so the Schedule grid
 * (inlined by scripts/sync-sequence-selection.mjs) and the Notes tables share the SAME code (B2530690). This
 * file is only the Spreadsheet's import path. */
export * from "../../../shared/selection/rangeSelection.js";
