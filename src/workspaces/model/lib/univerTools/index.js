/* Model workspace — the Planyr-only Spreadsheet tools ON the Univer grid (NEW-1, cutover step 6 of docs/SPREADSHEET-UNIVER-SPIKE.md).
 *
 * Five tools lived only in the old grid's own code and read its selection: formula-consistency flags + the Inconsistencies panel,
 * trace precedents / dependents, the command palette, the Name Manager and the blue-input / black-formula colour convention. This is
 * ONE Planyr plugin that gives all five to Univer, built ON Univer's own services and reading/writing the way the Excel-keys plugin
 * (lib/univerExcelKeys) and the indent plugin (lib/univerIndent.js) do:
 *   · READ the cells through the BRIDGE: `deps.snapshot()` is the Planyr workbook `univerToWorkbook` builds from Univer's live state,
 *     and the old grid's pure libraries (formulaConsistency / traceAudit / sheetEngine / namedRanges) run on it unchanged (./model.js).
 *   · DRAW on the canvas: a CELL_CONTENT interceptor (`SheetInterceptorService`, the route indent uses) gives flagged cells a corner
 *     marker and recolours input / cross-sheet text; a render extension (`SheetExtension`, registered on the sheet's main component)
 *     draws the trace arrows in sheet coordinates, so they scroll and zoom with the cells.
 *   · WRITE through Univer commands, one undo step each: a name edit is Univer's own SetDefinedNameCommand / RemoveDefinedNameCommand
 *     (a rename's formula rewrites ride in the same undo group); a dismissed flag is a Planyr mutation with its inverse pushed on
 *     Univer's undo stack. Nothing is written behind Univer's back.
 *   · EXECUTE through ICommandService: every action is a real command (`planyr.tools.*`), the palette runs commands by id, and Ctrl+K
 *     opens the palette (the 2026-10-29 decision).
 * The saved workbook format is unchanged: names stay per sheet, dismissals stay in `sheet.dismissedInconsistencies`.
 *
 * Everything Univer-shaped arrives in `deps.U` (UniverSheet.jsx imports it), so this file imports nothing from @univerjs — the lazy-chunk
 * rule (only UniverSheet.jsx and the Excel-keys files import @univerjs/*) still holds, and the controller is unit-testable with fakes. */
import { evaluateWorkbook } from "../sheetEngine.js";
import { renameName as planyrRenameName } from "../namedRanges.js";
import { COMMANDS } from "../commandRegistry.js";
import { readAutoColor, writeAutoColor } from "../sheetColorMode.js";
import { rawAt } from "../sheetModel.js";
import {
  entryOf, activeFlagsOf, flagLookup, markerFor, dismissKey, withDismissal, autoColorFor, traceFor, renderTrace, traceShapes,
  definedNameParams, nameIdFor,
} from "./model.js";
import { buildPaletteRows, TOOL_COMMAND_IDS, UNIVER_EXEC } from "./palette.js";

const MUTATION_SET_DISMISSED = "planyr.tools.mutation.set-dismissed";
const ICONS = {
  precedents: { paths: ["M4 18 L4 6", "M4 6 L12 6", "M12 3 L18 6 L12 9 Z", "M20 18 L10 18"], dots: [[4, 18]] },
  dependents: { paths: ["M4 6 L12 6", "M12 3 L18 6 L12 9 Z", "M20 6 L20 18", "M20 18 L10 18"], dots: [[4, 6]] },
  clear: { paths: ["M4 6 L14 6", "M14 3 L20 6 L14 9 Z", "M5 14 L19 22", "M19 14 L5 22"], dots: [] },
  flags: { paths: ["M12 3 L22 20 L2 20 Z", "M12 9 L12 14"], dots: [[12, 17]] },
  names: { paths: ["M3 7 L3 17 L21 17 L21 7 Z", "M7 11 L11 11", "M7 13.5 L15 13.5"], dots: [] },
  color: { paths: ["M6 17 L12 5 L18 17", "M8 13 L16 13", "M5 21 L19 21"], dots: [] },
  palette: { paths: ["M4 6 L20 6", "M4 12 L20 12", "M4 18 L14 18"], dots: [] },
};

/** The edits that can change what a trace shows (values, formulas, structure, names, sheets). A row auto-height or a scroll is a mutation too; it must not wipe the arrows. */
const changesDependencies = (id) => /set-range-values|insert-(row|col)|remove-(row|col)|move-(rows|cols|range)|insert-sheet|remove-sheet|set-worksheet-name|defined-name|set-formula|remove-sheet/.test(id);
const isMutation = (id) => typeof id === "string" && id.includes(".mutation.") && !id.includes("selection") && !id.includes("scroll");

export function installUniverTools(deps) {
  const { univerAPI, injector, host, U, snapshot, getSidecar, setSidecar, getProjectNames, notice, viewKey } = deps;
  const commands = injector.get(U.ICommandService);
  const undoRedo = injector.get(U.IUndoRedoService);
  const disposers = [];
  const listeners = new Set();
  let disposed = false;

  // ---- state (what the React panels render) --------------------------------------------------------------------------------
  let state = {
    workbook: null, sheetId: null, sheetName: "", sheet: null,
    flags: [], flagSig: "", trace: null, rendered: null,
    autoColor: readAutoColor(viewKey), panel: null, paletteOpen: false,
    selRange: { r1: 0, r2: 0, c1: 0, c2: 0 }, paletteRows: [], paletteCtx: {},
  };
  const live = { flags: new Map(), graph: null, unitId: null, sheetId: null };
  const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((f) => { try { f(); } catch (_) { /* a bad subscriber must not stop the others */ } }); };
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const getState = () => state;

  // ---- reading the live grid -----------------------------------------------------------------------------------------------
  const sheetNow = () => {
    const wb = univerAPI.getActiveWorkbook();
    const ws = wb && wb.getActiveSheet();
    return ws ? { wb, ws, unitId: wb.getId(), sheetId: ws.getSheetId() } : null;
  };
  const activeCell = () => {
    const s = sheetNow(); if (!s) return null;
    const sel = s.ws.getSelection();
    const cur = sel && sel.getCurrentCell();
    if (cur) return { row: cur.actualRow, col: cur.actualColumn };
    const r = sel && sel.getActiveRange && sel.getActiveRange();
    return r ? { row: r.getRange().startRow, col: r.getRange().startColumn } : { row: 0, col: 0 };
  };
  const readSelection = () => {
    const s = sheetNow(); if (!s) return;
    const list = s.ws.getSelection().getActiveRangeList();
    const g = list && list[0] && list[0].getRange();
    if (!g) return;
    const next = { r1: g.startRow, r2: g.endRow, c1: g.startColumn, c2: g.endColumn };
    const cur = state.selRange;
    if (cur.r1 !== next.r1 || cur.r2 !== next.r2 || cur.c1 !== next.c1 || cur.c2 !== next.c2) set({ selRange: next });
  };

  // ---- repainting the canvas -----------------------------------------------------------------------------------------------
  const renderOf = () => {
    try { return live.unitId ? injector.get(U.IRenderManagerService).getRenderUnitById(live.unitId) : null; } catch (_) { return null; }
  };
  /** `content` = the interceptors' answers changed (the skeleton caches them); otherwise just redraw the extension. */
  const repaint = (content) => {
    try {
      const r = renderOf(); if (!r) return;
      if (content) {
        // The skeleton caches what the cell interceptors answered, so a changed answer needs the sheet's skeleton marked dirty and rebuilt.
        const sk = r.with(U.SheetSkeletonManagerService);
        const param = sk && sk.getCurrentParam && sk.getCurrentParam();
        if (param) { sk.makeDirty({ sheetId: param.sheetId }, true); sk.setCurrent({ sheetId: param.sheetId }); }   // setCurrent re-emits the skeleton, which is what makes the sheet component redraw from it
      }
      if (r.mainComponent && r.mainComponent.makeForceDirty) r.mainComponent.makeForceDirty(true);
      if (r.scene && r.scene.makeDirty) r.scene.makeDirty(true);
    } catch (err) { console.error("UniverTools: repaint failed", err); }   // eslint-disable-line no-console
  };

  // ---- recompute from the bridge --------------------------------------------------------------------------------------------
  const recompute = () => {
    if (disposed) return null;
    const s = sheetNow(); if (!s) return null;
    live.unitId = s.unitId;
    const wb = snapshot();
    if (!wb) return null;
    const entry = entryOf(wb, s.sheetId);
    if (!entry) return null;
    const flags = activeFlagsOf(entry.sheet);
    const sig = `${entry.id}|${flags.map((f) => `${f.row}:${f.col}:${f.kind}`).join(",")}`;
    const patch = { workbook: wb, sheetId: entry.id, sheetName: entry.name, sheet: entry.sheet };
    const sheetChanged = live.sheetId !== entry.id;
    live.sheetId = entry.id;
    if (sig !== state.flagSig) { patch.flags = flags; patch.flagSig = sig; live.flags = flagLookup(flags); }
    if (state.trace && live.graph && (sheetChanged || patch.flagSig)) patch.rendered = renderTrace(state.trace, live.graph, entry.id);
    set(patch);
    if (patch.flagSig !== undefined) repaint(true);
    else if (patch.rendered) repaint(false);
    return wb;
  };
  let refreshTimer = null;
  const scheduleRefresh = () => {
    if (disposed) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { try { recompute(); } catch (err) { console.error("UniverTools: refresh failed", err); } }, 250);   // eslint-disable-line no-console
  };

  // ---- 1. canvas: corner markers + input / link colours --------------------------------------------------------------------
  const interceptors = injector.get(U.SheetInterceptorService);
  const styleOf = (base, ctx) => (base.s == null ? null : (typeof base.s === "string" ? ctx.workbook.getStyles().get(base.s) : base.s));
  disposers.push(interceptors.intercept(U.INTERCEPTOR_POINT.CELL_CONTENT, {
    id: "planyr.tools.render",
    effect: U.InterceptorEffectEnum.Style,
    priority: 90,
    handler: (cell, ctx, next) => {
      const base = cell || ctx.rawData;
      if (!base) return next(cell);
      let out = base, changed = false;
      const flag = live.flags.size && ctx.subUnitId === live.sheetId ? live.flags.get(`${ctx.row}:${ctx.col}`) : null;
      if (flag) { out = { ...out, markers: markerFor(flag) }; changed = true; }
      if (state.autoColor) {
        const style = styleOf(base, ctx);
        const hasFormula = base.f != null || base.si != null;
        const raw = base.f != null ? base.f : (hasFormula ? "=" : (base.p ? "x" : (base.v == null ? "" : String(base.v))));
        const isError = hasFormula && typeof base.v === "string" && /^#[A-Z0-9/!?]+$/.test(base.v);
        const color = autoColorFor({ raw, hasManualColor: !!(style && style.cl && style.cl.rgb), isError, sheetName: ctx.worksheet.getName() });
        if (color) { out = { ...out, s: { ...(style || {}), cl: { rgb: color } } }; changed = true; }
      }
      return next(changed ? out : cell);
    },
  }));

  // ---- 2. canvas: trace arrows (a render extension on the sheet's main component) --------------------------------------------
  const ARROW = "#2563EB", BOX = "#2563EB", LABEL_BG = "#EFF6FF", LABEL_FG = "#1E3A8A"; // design-exempt: trace-arrow colours drawn on Univer's canvas (a colour string, no var() there) — Excel's blue arrows
  const makeExtension = () => {
    const Ext = class PlanyrTraceExtension extends U.SheetExtension {
      constructor() { super(); this.uKey = "planyr-trace-arrows"; this.Z_INDEX = 900; this.type = U.SHEET_EXTENSION_TYPE.GRID; }
      draw(ctx, parentScale, skeleton) {
        const rendered = state.rendered;
        if (!rendered || !skeleton || !skeleton.worksheet || skeleton.worksheet.getSheetId() !== state.sheetId) return;
        // false: no row / column header offset, as Univer's own marker layer reads it
        const rectOf = (row, col) => { const c = skeleton.getNoMergeCellWithCoordByIndex(row, col, false); return c ? { x1: c.startX, y1: c.startY, x2: c.endX, y2: c.endY } : null; };
        const shapes = traceShapes(rendered, rectOf);
        const scale = this._getScale(parentScale) || 1;
        ctx.save();
        ctx.lineWidth = 1.5 / scale; ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.strokeStyle = ARROW; ctx.fillStyle = ARROW;
        ctx.setLineDash([]);
        for (const l of shapes.lines) { ctx.beginPath(); ctx.moveTo(l.from.x, l.from.y); ctx.lineTo(l.to.x, l.to.y); ctx.stroke(); }
        for (const d of shapes.dots) { ctx.beginPath(); ctx.arc(d.x, d.y, 3.5 / scale, 0, Math.PI * 2); ctx.fill(); }
        for (const h of shapes.heads) {
          const len = 9 / scale, half = 4.5 / scale, a = h.angle;
          const bx = h.at.x - Math.cos(a) * len, by = h.at.y - Math.sin(a) * len;
          ctx.beginPath(); ctx.moveTo(h.at.x, h.at.y);
          ctx.lineTo(bx + Math.cos(a + Math.PI / 2) * half, by + Math.sin(a + Math.PI / 2) * half);
          ctx.lineTo(bx + Math.cos(a - Math.PI / 2) * half, by + Math.sin(a - Math.PI / 2) * half);
          ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = BOX; ctx.setLineDash([4 / scale, 3 / scale]);
        for (const b of shapes.boxes) ctx.strokeRect(b.x1 + 0.5 / scale, b.y1 + 0.5 / scale, b.x2 - b.x1 - 1 / scale, b.y2 - b.y1 - 1 / scale);
        ctx.setLineDash([]);
        ctx.font = `${11 / scale}px sans-serif`; ctx.textBaseline = "middle";
        for (const t of shapes.labels) {
          const w = ctx.measureText(t.text).width + 8 / scale, h = 16 / scale;
          ctx.fillStyle = LABEL_BG; ctx.strokeStyle = ARROW; ctx.lineWidth = 1 / scale;
          ctx.fillRect(t.x, t.y, w, h); ctx.strokeRect(t.x, t.y, w, h);
          ctx.fillStyle = LABEL_FG; ctx.fillText(t.text, t.x + 4 / scale, t.y + h / 2);
        }
        ctx.restore();
      }
    };
    return new Ext();
  };
  let extension = null, extensionOn = null;     // the extension, and the sheet component it is registered on (a rebuilt workbook reuses the unit ID but is a NEW component)
  /** Register the arrows on a (new) unit's sheet component. A rebuilt workbook is a new unit, so UniverSheet calls this after each load;
   *  the render unit appears a beat after the unit does, so it retries briefly (the same shape as the header-drag gate). */
  const attachUnit = (unitId, tries = 0) => {
    if (disposed || !unitId) return;
    live.unitId = unitId;
    const r = (() => { try { return injector.get(U.IRenderManagerService).getRenderUnitById(unitId); } catch (_) { return null; } })();
    const main = r && r.mainComponent;
    if (!main || !main.register) {
      if (tries < 200) setTimeout(() => attachUnit(unitId, tries + 1), 50);
      else console.error("UniverTools: could not attach the trace layer");   // eslint-disable-line no-console
      return;
    }
    if (extensionOn === main) return;
    try { if (!extension) extension = makeExtension(); main.register(extension); extensionOn = main; } catch (err) { console.error("UniverTools: could not register the trace layer", err); }   // eslint-disable-line no-console
    recompute();
  };

  // ---- 3. commands ----------------------------------------------------------------------------------------------------------
  const cmd = (id, handler) => disposers.push(commands.registerCommand({ id, type: U.CommandType.COMMAND, handler }));
  const startTrace = (mode) => () => {
    const wb = recompute(); const cell = activeCell();
    if (!wb || !cell) return false;
    const ev = evaluateWorkbook(wb, { projectNames: getProjectNames ? getProjectNames() : {} });
    live.graph = ev.graph;
    const trace = traceFor(state.trace, mode, state.sheetId, cell.row, cell.col, ev.graph);
    const rendered = renderTrace(trace, ev.graph, state.sheetId);
    set({ trace, rendered });
    repaint(false);
    if (trace.noFurther) notice && notice(mode === "precedents" ? "This cell has no (further) precedents." : "This cell has no (further) dependents.");
    return true;
  };
  const clearTrace = () => { if (!state.trace) return false; live.graph = null; set({ trace: null, rendered: null }); repaint(false); return true; };
  const togglePanel = (name) => () => { if (name === "inconsistencies" || name === "names") recompute(); set({ panel: state.panel === name ? null : name, paletteOpen: false }); return true; };

  // A dismissed flag: a Planyr mutation (it edits the sidecar the bridge saves from) with its inverse on Univer's undo stack.
  disposers.push(commands.registerCommand({
    id: MUTATION_SET_DISMISSED, type: U.CommandType.MUTATION,
    handler: (_accessor, params) => {
      const next = withDismissal(getSidecar(), params.sheetId, params.key, params.dismissed);
      if (next !== getSidecar()) setSidecar(next);
      scheduleRefresh();
      return true;
    },
  }));
  const setDismissed = ({ row, col, dismissed = true } = {}) => {
    const s = sheetNow(); if (!s) return false;
    const key = dismissKey(getSidecar(), s.sheetId, row, col);
    if (!key) return false;
    const params = { unitId: s.unitId, sheetId: s.sheetId, key, dismissed: !!dismissed };
    commands.syncExecuteCommand(MUTATION_SET_DISMISSED, params);
    undoRedo.pushUndoRedo({
      unitID: s.unitId,
      undoMutations: [{ id: MUTATION_SET_DISMISSED, params: { ...params, dismissed: !dismissed } }],
      redoMutations: [{ id: MUTATION_SET_DISMISSED, params }],
    });
    recompute();
    return true;
  };
  cmd(TOOL_COMMAND_IDS.tracePrecedents, startTrace("precedents"));
  cmd(TOOL_COMMAND_IDS.traceDependents, startTrace("dependents"));
  cmd(TOOL_COMMAND_IDS.traceClear, clearTrace);
  cmd(TOOL_COMMAND_IDS.inconsistencies, togglePanel("inconsistencies"));
  cmd(TOOL_COMMAND_IDS.nameManager, togglePanel("names"));
  cmd(TOOL_COMMAND_IDS.autoColor, () => { const on = !state.autoColor; writeAutoColor(viewKey, on); set({ autoColor: on }); repaint(true); return true; });
  cmd(TOOL_COMMAND_IDS.dismiss, (_a, params) => setDismissed(params));
  cmd(TOOL_COMMAND_IDS.palette, () => { openPalette(); return true; });

  // ---- 4. names: Univer's own defined-name commands, one undo step per edit ----------------------------------------------------
  let groupSeq = 0;
  const inOneUndo = async (unitId, fn) => {
    const scope = undoRedo.beginUndoRedoGroup(unitId, `planyr-tools-${++groupSeq}`, "append");
    try { return await fn(); } finally { scope.dispose(); }
  };
  const definedNames = () => {
    const s = sheetNow(); if (!s) return [];
    try { return Object.values(injector.get(U.IDefinedNamesService).getDefinedNameMap(s.unitId) || {}); } catch (_) { return []; }
  };
  const existingName = (sheetId, name) => definedNames().find((d) => d.localSheetId === sheetId && String(d.name).toLowerCase() === String(name).toLowerCase());
  const nameEdits = {
    define: async (name, rect) => {
      const s = sheetNow(); if (!s) return false;
      const params = definedNameParams(s.unitId, s.sheetId, s.ws.getSheetName(), name, rect);
      const r = await commands.executeCommand(U.SetDefinedNameCommand.id, params);
      recompute(); return r;
    },
    retarget: async (name, rect) => {
      const s = sheetNow(); if (!s) return false;
      const cur = existingName(s.sheetId, name);
      const params = { ...definedNameParams(s.unitId, s.sheetId, s.ws.getSheetName(), cur ? cur.name : name, rect), id: cur ? cur.id : nameIdFor(s.sheetId, name) };
      const r = await commands.executeCommand(U.SetDefinedNameCommand.id, params);
      recompute(); return r;
    },
    remove: async (name) => {
      const s = sheetNow(); if (!s) return false;
      const cur = existingName(s.sheetId, name); if (!cur) return false;
      const r = await commands.executeCommand(U.RemoveDefinedNameCommand.id, { unitId: s.unitId, id: cur.id, name: cur.name });
      recompute(); return r;
    },
    rename: async (oldName, newName) => {
      const s = sheetNow(); if (!s) return false;
      const cur = existingName(s.sheetId, oldName); if (!cur) return false;
      const wb = recompute(); const entry = wb && entryOf(wb, s.sheetId);
      // The formulas that mention the old spelling are rewritten by the SAME rule the old grid uses (namedRanges.renameName), found by
      // diffing its result against the sheet, and applied as ordinary cell edits inside the same undo group as the rename itself.
      const patch = [];
      if (entry) {
        const after = planyrRenameName(entry.sheet, oldName, newName);
        entry.sheet.columns.forEach((col, c) => {
          const rows = new Set();
          for (const k of Object.keys(after.cells)) if (k.startsWith(`${col.id}:`)) rows.add(Number(k.slice(col.id.length + 1)));
          for (const r of rows) {
            const was = rawAt(entry.sheet, r, c), now = rawAt(after, r, c);
            if (was !== now) patch.push({ r, c, text: now });
          }
        });
      }
      const ok = await inOneUndo(s.unitId, async () => {
        const r = await commands.executeCommand(U.SetDefinedNameCommand.id, { ...cur, unitId: s.unitId, name: String(newName).trim() });
        for (const p of patch) s.ws.getRange(p.r, p.c).setValue(p.text);
        return r;
      });
      recompute(); return ok;
    },
  };
  // "Number Format: <name>" from the palette: the SAME token the old grid applies, on every selected range, as ONE undo step.
  cmd(TOOL_COMMAND_IDS.numberFormat, async (_a, params) => {
    const s = sheetNow(); if (!s || !params || typeof params.token !== "string") return false;
    const ranges = s.ws.getSelection().getActiveRangeList();
    await inOneUndo(s.unitId, async () => { for (const r of ranges) r.setNumberFormat(params.token === "General" ? "General" : params.token); });
    return true;
  });
  const goTo = (r1, c1, r2 = r1, c2 = c1) => {
    const s = sheetNow(); if (!s) return;
    try { s.ws.getRange(r1, c1, Math.abs(r2 - r1) + 1, Math.abs(c2 - c1) + 1).activate(); } catch (err) { console.error("UniverTools: could not move the selection", err); }   // eslint-disable-line no-console
  };

  // ---- 5. the palette --------------------------------------------------------------------------------------------------------
  const exec = (id, params) => commands.executeCommand(id, params);
  const has = (id) => { try { return !!commands.hasCommand(id); } catch (_) { return false; } };
  const paletteEnv = () => {
    const s = sheetNow();
    let mergedHere = false;
    try { const a = activeCell(); mergedHere = !!(s && a && s.ws.getRange(a.row, a.col).isPartOfMerge()); } catch (_) { /* keep false */ }
    return { unitId: s ? s.unitId : null, sheetId: s ? s.sheetId : null, zoom: s && s.ws.getZoom ? s.ws.getZoom() : 1, mergedHere };
  };
  const paletteCtx = () => {
    const s = sheetNow();
    const sheet = state.sheet;
    let mergedHere = false;
    try { const a = activeCell(); mergedHere = !!(s && a && s.ws.getRange(a.row, a.col).isPartOfMerge()); } catch (_) { /* keep false */ }
    return {
      autoColor: state.autoColor, traceMode: state.rendered ? state.rendered.mode : null, mergedHere,
      freezeRows: sheet ? sheet.freezeRows : 0, freezeCols: sheet ? sheet.freezeCols : 0, filterOn: false, painterArmed: false,
      canUndo: true, canRedo: true, sheetCount: state.workbook ? state.workbook.sheets.length : 1, zoom: paletteEnv().zoom * 100,
      canDeleteColumn: true,
    };
  };
  const openPalette = () => {
    recompute();
    const { rows } = buildPaletteRows({ commands: COMMANDS, has, exec, env: paletteEnv });
    set({ paletteRows: rows, paletteCtx: paletteCtx(), paletteOpen: true, panel: state.panel });
  };
  const closePalette = () => set({ paletteOpen: false });

  // ---- 6. keys: Ctrl+K opens the palette; Esc removes trace arrows (like Excel) ---------------------------------------------
  const hostVisible = () => !!host && host.isConnected && host.getClientRects().length > 0;
  const onKey = (e) => {
    if (!hostVisible()) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && typeof e.key === "string" && e.key.toLowerCase() === "k") {
      e.preventDefault(); e.stopPropagation(); openPalette(); return;
    }
    if (e.key === "Escape" && state.trace && !state.paletteOpen && !(e.target instanceof Element && e.target.closest('[role="dialog"], .menu'))) clearTrace();
  };
  window.addEventListener("keydown", onKey, true);
  disposers.push({ dispose: () => window.removeEventListener("keydown", onKey, true) });

  // ---- 7. events: edits clear the trace and refresh the flags; selection feeds the Name Manager's "refers to" -------------------
  const off = univerAPI.addEvent(univerAPI.Event.CommandExecuted, (e) => {
    if (disposed || !e || typeof e.id !== "string") return;
    if (e.id.startsWith("planyr.tools.")) return;
    if (isMutation(e.id)) {
      if (state.trace && changesDependencies(e.id)) { live.graph = null; set({ trace: null, rendered: null }); repaint(false); }
      scheduleRefresh();
    } else if (e.id === "sheet.operation.set-worksheet-active") { scheduleRefresh(); readSelection(); }
    else if (e.id.includes("selection")) readSelection();
  });
  disposers.push(off);

  // ---- 8. toolbar buttons (Univer's own ribbon; all seven sit together on the Formulas tab, beside Univer's own formula tools) ---------
  const makeIcon = (spec) => ({ className, style }) => U.createElement("svg", { className, style, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
    ...spec.paths.map((d, i) => U.createElement("path", { key: i, d })),
    ...spec.dots.map(([cx, cy], i) => U.createElement("circle", { key: `c${i}`, cx, cy, r: 1.4, fill: "currentColor" })));
  const icons = injector.get(U.IconManager);
  const buttons = [
    ["precedents", TOOL_COMMAND_IDS.tracePrecedents, "Trace precedents", "Show which cells feed the selected one (click again for the next level)", "ribbon.formulas.basic", -17],
    ["dependents", TOOL_COMMAND_IDS.traceDependents, "Trace dependents", "Show which cells the selected one feeds (click again for the next level)", "ribbon.formulas.basic", -16],
    ["clear", TOOL_COMMAND_IDS.traceClear, "Remove arrows", "Remove the trace arrows (Esc)", "ribbon.formulas.basic", -15],
    ["flags", TOOL_COMMAND_IDS.inconsistencies, "Inconsistent formulas", "List the cells whose formula breaks its row / column pattern", "ribbon.formulas.basic", -14],
    ["names", TOOL_COMMAND_IDS.nameManager, "Name manager", "Define, rename, retarget and delete named ranges", "ribbon.formulas.basic", -13],
    ["color", TOOL_COMMAND_IDS.autoColor, "Input / formula colours", "Colour typed inputs blue and cross-sheet links green (a colour you set always wins)", "ribbon.formulas.basic", -12],
    ["palette", TOOL_COMMAND_IDS.palette, "Command palette", "Search every command (Ctrl+K)", "ribbon.formulas.basic", -11],
  ];
  for (const [key, id, title, tooltip, where, order] of buttons) {
    const name = `PlanyrTool${key[0].toUpperCase()}${key.slice(1)}Icon`;
    disposers.push(icons.register(name, makeIcon(ICONS[key])));
    try { univerAPI.createMenu({ id, action: id, icon: name, title, tooltip, order }).appendTo(where); } catch (err) { console.error(`UniverTools: could not add the "${title}" button`, err); }   // eslint-disable-line no-console
  }

  // first sight of the grid
  attachUnit(univerAPI.getActiveWorkbook() ? univerAPI.getActiveWorkbook().getId() : null);
  readSelection();

  return {
    getState, subscribe, recompute, attachUnit, openPalette, closePalette,
    run: (id, params) => exec(id, params),
    setPanel: (panel) => set({ panel }),
    closePanel: () => set({ panel: null }),
    dismiss: (row, col) => setDismissed({ row, col, dismissed: true }),
    goTo,
    names: nameEdits,
    // the harness's handles
    internals: { live: () => live, repaint, renderOf, TOOL_COMMAND_IDS, UNIVER_EXEC },
    dispose() {
      disposed = true;
      clearTimeout(refreshTimer);
      disposers.splice(0).forEach((d) => { try { d && d.dispose && d.dispose(); } catch (_) { /* disposing */ } });
      listeners.clear();
    },
  };
}
