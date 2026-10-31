/* Model workspace — the command palette on the Univer grid: the PURE half (NEW-1, cutover step 6).
 *
 * Ctrl+K stays THE palette (owner decision 2026-10-29). The list is built from the SAME registry the old grid's keys, ribbon, key-tips
 * and palette run (lib/commandRegistry.js `COMMANDS` — one label, group, keyword set and shortcut per command), but every row EXECUTES
 * through Univer's ICommandService instead of the old grid's `ctx.onXxx` handlers. A registry command reaches a Univer command by one of
 * three routes, tried in this order:
 *   1. a Planyr TOOL command (trace, inconsistencies, name manager, colour convention) — `planyr.tools.*`, registered by ./index.js;
 *   2. the Excel-keys plugin's action of the same id — `planyr.excel.<id>` (lib/univerExcelKeys), which already drives Univer's own
 *      commands in ONE undo group (bold, borders, number formats, insert / delete, hide, autofit, sort, filter, freeze, merge…);
 *   3. a Univer-native command named in UNIVER_EXEC below (undo, redo, find, replace, zoom, add / remove sheet).
 * A registry command with none of the three is not shown as a dead row: it is NAMED in PALETTE_UNAVAILABLE with the reason (the
 * unit test fails if one is neither routed nor named). On top of the registry, EXTRA_UNIVER_COMMANDS lists a few Univer commands the
 * old grid had no row for.
 *
 * Pure: `has` and `exec` are injected, so the routing is unit-tested without Univer. */

import { NUMBER_FORMATS } from "../numberFormats.js";

/** Registry id → the Planyr tool command id ./index.js registers. */
export const TOOL_COMMAND = Object.freeze({
  "trace-precedents": "planyr.tools.trace-precedents",
  "trace-dependents": "planyr.tools.trace-dependents",
  "trace-remove-arrows": "planyr.tools.trace-clear",
  "show-inconsistencies": "planyr.tools.toggle-inconsistencies",
  "name-manager": "planyr.tools.toggle-name-manager",
  "autocolor-toggle": "planyr.tools.toggle-autocolor",
});
export const TOOL_COMMAND_IDS = Object.freeze({
  tracePrecedents: TOOL_COMMAND["trace-precedents"], traceDependents: TOOL_COMMAND["trace-dependents"], traceClear: TOOL_COMMAND["trace-remove-arrows"],
  inconsistencies: TOOL_COMMAND["show-inconsistencies"], nameManager: TOOL_COMMAND["name-manager"], autoColor: TOOL_COMMAND["autocolor-toggle"],
  dismiss: "planyr.tools.dismiss-inconsistency", palette: "planyr.tools.open-palette", numberFormat: "planyr.tools.number-format",
});

/** Registry id → a Univer-native command. `params(env)` builds its arguments from the live sheet (env = { unitId, sheetId, zoom }). */
export const UNIVER_EXEC = Object.freeze({
  undo: { id: "univer.command.undo" },
  redo: { id: "univer.command.redo" },
  find: { id: "ui.operation.open-find-dialog" },
  replace: { id: "ui.operation.open-replace-dialog" },
  "sheet-add": { id: "sheet.command.insert-sheet" },
  "sheet-delete": { id: "sheet.command.remove-sheet" },
  "zoom-in": { id: "sheet.command.set-zoom-ratio", params: (env) => ({ unitId: env.unitId, subUnitId: env.sheetId, zoomRatio: stepZoom(env.zoom, 1) }) },
  "zoom-out": { id: "sheet.command.set-zoom-ratio", params: (env) => ({ unitId: env.unitId, subUnitId: env.sheetId, zoomRatio: stepZoom(env.zoom, -1) }) },
  "zoom-reset": { id: "sheet.command.set-zoom-ratio", params: (env) => ({ unitId: env.unitId, subUnitId: env.sheetId, zoomRatio: 1 }) },
});

/** "Number Format: <name>" rows: the registry's own format list, applied by the tools' number-format command (the plugin only has Excel's chord formats). */
const NUMFMT_TOKEN = Object.freeze(Object.fromEntries(NUMBER_FORMATS.map((f) => [`numfmt-${f.id}`, f.token])));
/** Registry ids whose route depends on the live selection — resolved at RUN time to another command. */
const DYNAMIC = Object.freeze({
  "merge-toggle": (env) => (env.mergedHere ? "planyr.excel.unmerge-cells" : "planyr.excel.merge-cells"),
});

/** Univer's own zoom is a ratio (1 = 100%); step it by 10 points and keep it in the range the Planyr zoom allows (10%–400%). */
export function stepZoom(current, dir) {
  const pct = Math.round((Number(current) || 1) * 100);
  const next = Math.max(10, Math.min(400, pct + dir * 10));
  return next / 100;
}

/** Registry commands the Univer grid has no palette route for yet — each with the honest reason. */
export const PALETTE_UNAVAILABLE = Object.freeze({
  copy: "the browser's clipboard needs a real keypress; use Ctrl+C",
  cut: "the browser's clipboard needs a real keypress; use Ctrl+X",
  paste: "the browser's clipboard needs a real keypress; use Ctrl+V",
  "cancel-cut": "Escape cancels a copy / cut on the Univer grid",
  "freeze-at-selection": "the Freeze Panes toggle does this", unfreeze: "the Freeze Panes toggle does this",
  "border-top": "the toolbar's Borders menu", "border-bottom-double": "the toolbar's Borders menu",
  "export-xlsx": "the File menu's Export", "export-csv": "the File menu's Export",
  "import-xlsx": "the File menu's Import", "import-csv": "the File menu's Import",
  "save-now": "the grid saves on its own (and on every way out)",
  "sheet-duplicate": "right-click the sheet tab", "sheet-rename": "double-click the sheet tab",
  "sheet-prev": "the sheet tabs", "sheet-next": "the sheet tabs",
  autosum: "Univer's own AutoSum button, Formulas tab", "repeat-last": "no Univer equivalent",
  "fill-right": "Ctrl+R",
});

/** A few Univer commands the old registry has no row for. */
export const EXTRA_UNIVER_COMMANDS = Object.freeze([
  { id: "univer-insert-row-after", label: "Insert Row Below", group: "structure", keywords: "add row after", exec: { id: "sheet.command.insert-row-after" } },
  { id: "univer-insert-column-after", label: "Insert Column Right", group: "structure", keywords: "add column after", exec: { id: "sheet.command.insert-col-after" } },
  { id: "univer-toggle-gridlines", label: "Show / Hide Gridlines", group: "view", keywords: "grid lines view", exec: { id: "sheet.command.toggle-gridlines" } },
]);

/**
 * Build the palette's rows.
 *   commands — the registry's COMMANDS array (id, label, group, shortcut?, keywords?, disabled?)
 *   has(id)  — does Univer's command service know this command?
 *   exec(id, params) — run one through ICommandService (returns a promise)
 *   env()    — the live { unitId, sheetId, zoom } (read at RUN time, never captured)
 * Returns { rows, unrouted } — `rows` are registry-shaped (`run` ignores its argument), `unrouted` the registry ids with no route.
 */
export function buildPaletteRows({ commands, has, exec, env }) {
  const rows = [];
  const unrouted = [];
  for (const cmd of commands) {
    let route = null;
    if (TOOL_COMMAND[cmd.id] && has(TOOL_COMMAND[cmd.id])) route = () => exec(TOOL_COMMAND[cmd.id]);
    else if (has(`planyr.excel.${cmd.id}`)) route = () => exec(`planyr.excel.${cmd.id}`);
    else if (NUMFMT_TOKEN[cmd.id] && has(TOOL_COMMAND_IDS.numberFormat)) route = () => exec(TOOL_COMMAND_IDS.numberFormat, { token: NUMFMT_TOKEN[cmd.id] });
    else if (DYNAMIC[cmd.id] && has("planyr.excel.merge-cells")) route = () => exec(DYNAMIC[cmd.id](env()));
    else if (UNIVER_EXEC[cmd.id] && has(UNIVER_EXEC[cmd.id].id)) {
      const u = UNIVER_EXEC[cmd.id];
      route = () => exec(u.id, u.params ? u.params(env()) : undefined);
    }
    if (!route) { unrouted.push(cmd.id); continue; }
    rows.push({ ...cmd, run: () => { route(); } });
  }
  for (const x of EXTRA_UNIVER_COMMANDS) {
    if (!has(x.exec.id)) { unrouted.push(x.id); continue; }
    rows.push({ id: x.id, label: x.label, group: x.group, keywords: x.keywords, run: () => { exec(x.exec.id, x.exec.params ? x.exec.params(env()) : undefined); } });
  }
  return { rows, unrouted };
}

/** Is this unrouted registry id one the table names? */
export const isNamedGap = (id) => Object.prototype.hasOwnProperty.call(PALETTE_UNAVAILABLE, id);
