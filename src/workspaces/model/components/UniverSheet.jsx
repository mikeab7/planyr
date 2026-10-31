/* Model workspace — the Univer grid: THE grid on the Spreadsheet tab for every account (docs/SPREADSHEET-UNIVER-SPIKE.md). Lazy
 * chunk: nothing in this file, and none of @univerjs/*, is imported by any eagerly loaded module.
 *
 * ModelApp mounts it instead of the Ribbon / FormulaBar / SheetView / TabStrip, everywhere except the owner's per-device
 * regular-grid hatch (lib/gridChoice.js, lib/univerSwitch.js). The regular grid is deprecated, pending deletion.
 *
 * DATA FLOW (one direction each way, through the bridge — lib/univerBridge.js):
 *   Planyr workbook ──workbookToUniver──▶ Univer          (mount, and again only if the workbook changes from
 *                                                          OUTSIDE — a cloud load, an opened file, an undo)
 *   Univer edit ──(debounced)──univerToWorkbook──▶ onChange(workbook)  ──▶ ModelApp `commit` ──▶ the SAME
 *                                                          modelStore / modelSaveState / cloud push / fileWorkbook
 *                                                          path as today, so persistence is unchanged.
 * SAVING (NEW-2): the debounce, the "flush right now" every way out of the grid uses, and the echo guard (the canonical JSON
 * of what this component emitted, or was built from; an incoming prop that equals it is our own edit coming back and is
 * ignored — never re-imported into Univer) all live in ONE object, lib/univerSave.js. `onReady({ flush })` hands the host a
 * synchronous flush that returns the up-to-date workbook (Export, the grid toggle, a hidden tab); the page-hide,
 * beforeunload and unmount paths flush URGENTLY, which tells the host to persist synchronously (React would not render in time).
 * HEADER DRAG (NEW-1): a drag on an already-selected row / column header moves it in Univer; Excel needs Shift for that.
 * The gate in lib/univerHeaderMove.js sits in front of Univer's own header-move permission check.
 *
 * Open-source @univerjs/* only (no @univerjs-pro, no license key, no Univer server). xlsx / csv stay on the
 * existing ExcelJS / SheetJS path; this file never touches Univer's exchange packages. */
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { createUniver, LocaleType, mergeLocales, defaultTheme, ICommandService, CommandType, InterceptorEffectEnum, IUndoRedoService } from "@univerjs/presets";
import {
  UniverSheetsCorePreset, CalculationMode, IDefinedNamesService, SetDefinedNameMutation, RemoveDefinedNameMutation,
  SheetInterceptorService, INTERCEPTOR_POINT, SetRangeValuesCommand, IconManager,
  IRenderManagerService, HeaderMoveRenderController, SheetSkeletonManagerService, getCoordByOffset,
  SetDefinedNameCommand, RemoveDefinedNameCommand, SheetExtension, SHEET_EXTENSION_TYPE,
} from "@univerjs/preset-sheets-core";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import coreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import sortEnUS from "@univerjs/preset-sheets-sort/locales/en-US";
import filterEnUS from "@univerjs/preset-sheets-filter/locales/en-US";
import findEnUS from "@univerjs/preset-sheets-find-replace/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import "./univerSheet.css";
import { CURVED_ICONS } from "./univerIcons.jsx";
import { migrateWorkbook, canonicalJson } from "../lib/sheetModel.js";
import {
  workbookToUniver, univerToWorkbook, sidecarAfterStructure, projectNamesToDefinedNames, PROJECT_NAME_ID_PREFIX,
} from "../lib/univerBridge.js";
import { buildUniverTheme, THEME_TOKEN_VARS } from "../lib/univerTheme.js";
import { installExcelKeys } from "../lib/univerExcelKeys/index.js";
import { installUniverIndent } from "../lib/univerIndent.js";
import { installFormulaGuard } from "../lib/univerFormulaGuard.js";
import { circularNotice } from "../lib/evalValues.js";
import { migratePlanyrSyntaxInWorkbook, planyrSyntaxNote } from "../lib/planyrSyntax.js";
import { installUniverTools } from "../lib/univerTools/index.js";
import UniverToolPanels from "./UniverTools.jsx";
import { createSaveController } from "../lib/univerSave.js";
import UniverFormulaWorker from "../lib/univerFormulaWorker.js?worker";
import { createShiftGate, HEADER_MOVE_GATE_PRIORITY, pressOnSelectedHeader } from "../lib/univerHeaderMove.js";

// ONE header strip, everything left-aligned (NEW-1, B2574352): Univer's "collapsed" ribbon folds the Start / Formulas / Data / View
// tab strip into a dropdown at the strip's left edge and packs that tab's tools right beside it. (The default, "classic", is a
// centred tab row ABOVE the tool row = two headers.) Configuration only — the package is not forked; see univerSheet.css.
const RIBBON_TYPE = "collapsed";
const STRUCTURE_OPS = {
  "sheet.mutation.insert-row": "insert-row", "sheet.mutation.remove-row": "remove-row",
  "sheet.mutation.insert-col": "insert-col", "sheet.mutation.remove-col": "remove-col",
};

const readTokens = () => {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const [k, v] of Object.entries(THEME_TOKEN_VARS)) out[k] = cs.getPropertyValue(v).trim();
  return out;
};
const isDark = () => {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
};

export default function UniverSheet({ workbook, projectNames, viewKey, onChange, onNotice, onReady, onError }) {
  const hostRef = useRef(null);
  const live = useRef({});                 // everything the long-lived Univer callbacks read (never stale)
  live.current.onChange = onChange;
  live.current.onNotice = onNotice;
  live.current.onReady = onReady;
  live.current.onError = onError;
  live.current.viewKey = viewKey;
  const [error, setError] = useState(null);
  const [tools, setTools] = useState(null);                       // the Planyr-only tools' controller (consistency flags, trace, names, palette, colours)
  const incoming = useMemo(() => canonicalJson(migrateWorkbook(workbook)), [workbook]);

  // ---- mount: create Univer once, load the workbook, wire edit detection ----------------------------------------------
  useEffect(() => {
    let disposed = false;
    const L = live.current;
    try {
      const dark0 = isDark();
      const theme = buildUniverTheme(defaultTheme, readTokens(), { dark: dark0 });
      // The formula engine runs in a Web Worker (lib/univerFormulaWorker.js) so a calculation never blocks the grid. If a worker
      // cannot start, Univer calculates on the page as before — slower, never wrong — and the console says so.
      let worker = null;
      try {
        worker = new UniverFormulaWorker();
        // A worker that dies mid-session would leave every formula silently stale: say so, and where it can be fixed (a reload).
        worker.addEventListener("error", (e) => {
          console.error("UniverSheet: the formula worker stopped", e && e.message);
          if (!disposed && live.current.onNotice) live.current.onNotice("The new grid's formula calculator stopped, so formula results may be out of date. Reload the page to restart it.");
        });
      } catch (err) { console.error("UniverSheet: could not start the formula worker; calculating on the page", err); worker = null; }
      L.worker = worker;
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(coreEnUS, sortEnUS, filterEnUS, findEnUS) },
        theme, darkMode: dark0,
        presets: [
          UniverSheetsCorePreset({ container: hostRef.current, ribbonType: RIBBON_TYPE, ...(worker ? { workerURL: worker } : {}), formula: { initialFormulaComputing: CalculationMode.WHEN_EMPTY } }),
          UniverSheetsSortPreset(), UniverSheetsFilterPreset(), UniverSheetsFindReplacePreset(),
        ],
      });
      L.univer = univer; L.univerAPI = univerAPI;
      L.injector = univer.__getInjector();
      // The Excel keys the free Univer build lacks (Ctrl+1, Ctrl+Shift+$%!~#, Shift/Ctrl+Space, Ctrl+9/0, Ctrl+Plus/Minus, Ctrl+;, Alt key-tips…)
      // A formula typed or pasted in the same spellings gets the same rewrite before the cell is written (lib/univerFormulaGuard.js).
      L.formulaGuard = installFormulaGuard({ injector: L.injector, ICommandService });
      // Univer (like Excel) calculates a circular reference as 0, which looks like an answer: after each calculation, say so out loud.
      // The calculation runs in the formula Web Worker, so the circular cells are read from Univer's "calculation processing"
      // notification (it reaches this thread either way) — not from the engine's runtime service, which only the worker holds.
      try {
        const fw = univerAPI.getFormula();
        let found = [];
        const subs = [
          fw.calculationStart(() => { found = []; }),
          fw.calculationProcessing((p) => { if (p && Array.isArray(p.circularReferences) && p.circularReferences.length) found = p.circularReferences; }),
          fw.calculationEnd((state) => {
            if (disposed || state !== 3 /* FormulaExecutedStateType.SUCCESS */) return;
            try {
              const wb = L.unitId && univerAPI.getWorkbook(L.unitId);
              const list = found.filter((c) => c.unitId === L.unitId).map((c) => { const ws = wb && wb.getSheetBySheetId(c.sheetId); return { sheetName: ws ? ws.getSheetName() : c.sheetId, row: c.row, col: c.column }; });
              const key = JSON.stringify(list);
              if (key !== L.circularKey) { L.circularKey = key; if (list.length && L.onNotice) L.onNotice(circularNotice(list)); }
            } catch (_) { /* the read is a courtesy; the calculation itself is untouched */ }
          }),
        ];
        L.circularSub = { dispose: () => subs.forEach((d) => { try { d.dispose(); } catch (_) { /* already gone */ } }) };
      } catch (_) { /* no formula facade in this build */ }
      L.excelKeys = installExcelKeys({ univerAPI, injector: L.injector, host: hostRef.current, onNotice: (t) => { if (live.current.onNotice) live.current.onNotice(t); } });
      // Curved undo / redo (NEW-2, B2574353): toolbar glyphs resolve by name through Univer's IconManager (not the facade's
      // registerComponent, which is a different registry). Replace the built-in ones; the toolbar draws them on its next render.
      const icons = L.injector.get(IconManager);
      for (const [name, icon] of Object.entries(CURVED_ICONS)) { icons.delete(name); icons.register(name, icon); }

      const load = (wb) => {
        const migrated = migrateWorkbook(wb);
        // NEW-1 (one formula engine): [Column] names, interleaved XIRR/XNPV pairs and `=-Name` are rewritten to the spelling Univer's
        // engine calculates, with a visible note — and SAVED that way (the baseline stays the stored text, so the first flush after
        // this load sees a difference and commits the rewrite as one ordinary edit).
        const { workbook: forUniver, rewritten } = migratePlanyrSyntaxInWorkbook(migrated);
        const { data, sidecar } = workbookToUniver(forUniver);
        const defs = projectNamesToDefinedNames(live.current.projectNames);
        if (Object.keys(defs).length) {
          const res = data.resources.find((r) => r.name === "SHEET_DEFINED_NAME_PLUGIN");
          if (res) res.data = JSON.stringify({ ...JSON.parse(res.data), ...defs });
          else data.resources.push({ name: "SHEET_DEFINED_NAME_PLUGIN", data: JSON.stringify(defs) });
        }
        if (L.unitId) { try { univerAPI.disposeUnit(L.unitId); } catch (_) { /* already gone */ } }
        L.sidecar = sidecar;
        L.save.baseline(migrated);
        L.projectDefs = defs;
        const fWb = univerAPI.createWorkbook(data);
        L.unitId = fWb.getId();
        if (rewritten.length) {
          L.save.schedule();
          const note = planyrSyntaxNote(rewritten);
          if (note && L.onNotice) L.onNotice(note);
        }
        const active = migrated.sheets.find((s) => s.id === migrated.activeSheetId);
        if (active) { try { fWb.setActiveSheet(fWb.getSheetBySheetId(active.id)); } catch (_) { /* first sheet stays active */ } }
        if (L.tools) L.tools.attachUnit(L.unitId);                  // a rebuilt workbook is a NEW unit: its sheet component needs the trace layer again
        return fWb;
      };
      L.load = load;

      // ---- saving: ONE controller (lib/univerSave.js) owns the debounce, the flush and the echo guard ------------------
      const snapshot = () => {
        if (!L.unitId) return null;
        const fWb = univerAPI.getWorkbook(L.unitId) || univerAPI.getActiveWorkbook();
        if (!fWb) return null;
        const snap = fWb.save();
        const activeSheet = fWb.getActiveSheet();
        return univerToWorkbook(snap, {
          sidecar: L.sidecar,
          activeSheetId: activeSheet ? activeSheet.getSheetId() : undefined,
          formulaOf: (sheetId, r, c) => {
            try { const sh = fWb.getSheetBySheetId(sheetId); return sh ? sh.getRange(r, c).getFormula() : null; } catch (_) { return null; }
          },
        });
      };
      L.save = createSaveController({
        canonical: canonicalJson,
        snapshot,
        emit: (next, notes, meta) => {
          if (notes.length && L.onNotice) L.onNotice(`Saved, but not everything Univer can hold fits Planyr's workbook: ${notes.join("; ")}.`);
          if (L.onChange) L.onChange(next, notes, meta);
        },
        // LOUD-FAILURE: a save that cannot happen is said out loud; the edit stays pending and the next flush retries it.
        report: (err, stage) => {
          console.error(`UniverSheet: could not save an edit (${stage})`, err);
          if (L.onError) L.onError(err, stage);
          else if (L.onNotice) L.onNotice("Your last edit in the new grid could not be saved yet. It will be retried.");
        },
      });
      const flush = (opts) => L.save.flush(opts);
      L.flush = flush;

      // ---- Header drag (NEW-1): move only with Shift held, like Excel -------------------------------------------------
      const gate = createShiftGate();
      L.gate = gate;
      const host = hostRef.current;
      const onPtr = (e) => gate.pointer(e.shiftKey);
      // A plain press on an ALREADY-selected header: restart the selection there (see lib/univerHeaderMove.js). The press
      // reaches Univer's canvas after this capture listener, so by then the header is no longer "already selected".
      const restartHeaderSelection = (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.button !== 0 || !L.unitId) return;
        try {
          const canvas = host.querySelector('canvas[id^="univer-sheet-main-canvas"]');
          if (!canvas || /resize/.test(canvas.style.cursor || "")) return;          // a press on a header border resizes
          const render = L.injector.get(IRenderManagerService).getRenderUnitById(L.unitId);
          const skeleton = render && render.with(SheetSkeletonManagerService).getCurrentSkeleton();
          if (!skeleton) return;
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left, y = e.clientY - rect.top;
          const hx = skeleton.rowHeaderWidthAndMarginLeft, hy = skeleton.columnHeaderHeightAndMarginTop;
          const kind = y >= 0 && y < hy && x >= hx ? "column" : (x >= 0 && x < hx && y >= hy ? "row" : null);
          if (!kind) return;
          const { row, column } = getCoordByOffset(x, y, render.scene, skeleton);
          const ws = univerAPI.getWorkbook(L.unitId).getActiveSheet();
          const ranges = ws.getSelection().getActiveRangeList().map((r) => r.getRange());
          if (!pressOnSelectedHeader({ button: e.button, kind, index: kind === "row" ? row : column, ranges })) return;
          const v = ws.getVisibleRange();                                              // a cell in view, so nothing scrolls
          ws.setActiveRange(ws.getRange(v.startRow, v.startColumn));
        } catch (err) { L.gateError = String((err && err.message) || err); }
      };
      const onKey = (e) => gate.key(e);
      const onBlur = () => gate.reset();
      for (const t of ["pointerdown", "pointermove", "mousedown"]) host.addEventListener(t, onPtr, true);
      host.addEventListener("pointerdown", restartHeaderSelection, true);
      window.addEventListener("keydown", onKey, true); window.addEventListener("keyup", onKey, true); window.addEventListener("blur", onBlur);
      const gateDispose = [];
      const installHeaderGate = (unitId) => {
        try {
          const render = L.injector.get(IRenderManagerService).getRenderUnitById(unitId);
          const ctrl = render && render.with(HeaderMoveRenderController);
          if (!ctrl) return false;
          const point = ctrl.interceptor.getInterceptPoints().HEADER_MOVE_PERMISSION_CHECK;
          gateDispose.push(ctrl.interceptor.intercept(point, { priority: HEADER_MOVE_GATE_PRIORITY, handler: gate.handler }));
          L.gateInstalls = (L.gateInstalls || 0) + 1; L.gateError = null;
          return true;
        } catch (err) { L.gateError = String(err && err.message || err); return false; }
      };
      // Univer registers its header-move controller when the sheet UI has RENDERED (a lifecycle stage after createUniver), so the
      // first attempt right after mount usually finds nothing — retry shortly until it exists. A unit built later (an outside
      // reload) finds it at once. Said out loud if it never appears: the only cost is that a plain drag moves a selected header.
      const ensureHeaderGate = (unitId, tries = 0) => {
        if (disposed || L.unitId !== unitId) return;
        if (installHeaderGate(unitId)) return;
        if (tries >= 200) {
          console.error("UniverSheet: could not install the header-drag gate", L.gateError);
          return;
        }
        L.gateTimer = setTimeout(() => ensureHeaderGate(unitId, tries + 1), 50);
      };
      L.installHeaderGate = ensureHeaderGate;
      L.detachGate = () => {
        for (const t of ["pointerdown", "pointermove", "mousedown"]) host.removeEventListener(t, onPtr, true);
        host.removeEventListener("pointerdown", restartHeaderSelection, true);
        window.removeEventListener("keydown", onKey, true); window.removeEventListener("keyup", onKey, true); window.removeEventListener("blur", onBlur);
        gateDispose.splice(0).forEach((d) => { try { d(); } catch (_) {} });
      };

      const off = univerAPI.addEvent(univerAPI.Event.CommandExecuted, (e) => {
        if (disposed || !e) return;
        const op = STRUCTURE_OPS[e.id];
        if (op && e.params && e.params.range && L.sidecar) {
          const r = e.params.range;
          const rowOp = op.endsWith("row");
          const index = rowOp ? r.startRow : r.startColumn;
          const count = (rowOp ? r.endRow - r.startRow : r.endColumn - r.startColumn) + 1;
          L.sidecar = sidecarAfterStructure(L.sidecar, e.params.subUnitId || e.params.sheetId, { op, index, count });
        }
        // Only edits count (a mutation); selection moves, scrolls and hover are commands that change nothing.
        if (typeof e.id === "string" && e.id.includes(".mutation.") && !e.id.includes("selection") && !e.id.includes("scroll")) L.save.schedule();
      });
      L.off = off;

      load(workbook);
      // Indent (needs the sheets services, which exist once a workbook does): drawn + Increase/Decrease buttons and command ids (lib/univerIndent.js — Univer 1.x has no indent of its own).
      L.indent = installUniverIndent({
        univerAPI, injector: L.injector, SheetInterceptorService, INTERCEPTOR_POINT, InterceptorEffectEnum,
        SetRangeValuesCommand, ICommandService, CommandType, IconManager, createElement,
      });
      // The Planyr-only tools (NEW-1, cutover step 6): consistency flags + panel, trace arrows, command palette (Ctrl+K), Name Manager, the
      // input / formula colour convention. Everything is read through the bridge and written through Univer commands (lib/univerTools/).
      L.tools = installUniverTools({
        univerAPI, injector: L.injector, host: hostRef.current, viewKey: L.viewKey,
        U: {
          ICommandService, CommandType, IUndoRedoService, IDefinedNamesService, SetDefinedNameCommand, RemoveDefinedNameCommand,
          SheetInterceptorService, INTERCEPTOR_POINT, InterceptorEffectEnum, SheetExtension, SHEET_EXTENSION_TYPE,
          IRenderManagerService, SheetSkeletonManagerService, IconManager, createElement,
        },
        snapshot: () => { const r = snapshot(); return r ? r.workbook : null; },
        getSidecar: () => L.sidecar,
        setSidecar: (next) => { L.sidecar = next; },
        getProjectNames: () => L.projectNames || {},
        notice: (t) => { if (live.current.onNotice) live.current.onNotice(t); },
      });
      setTools(L.tools);
      ensureHeaderGate(L.unitId);
      if (L.onReady) {
        L.onReady({
          // Synchronous and idempotent. Returns the workbook as it is NOW — the edit included — so a caller (Export) never
          // has to wait for React to hand the saved copy back down.
          flush: (opts) => L.save.flush(opts),
          // Text still typed into an open cell editor is not an edit yet; this commits it first (Univer's API is async).
          commitEditing: async () => {
            try { const w = univerAPI.getWorkbook(L.unitId) || univerAPI.getActiveWorkbook(); if (w) await w.endEditingAsync(true); } catch (_) { /* nothing was being edited */ }
          },
        });
      }

      // Follow the light / dark theme the rest of the app is in.
      // The colour theme is REBUILT from the live tokens on every flip (the tokens differ per theme), then dark mode is set.
      const applyTheme = () => {
        try {
          const dark = isDark();
          univerAPI.setTheme(buildUniverTheme(defaultTheme, readTokens(), { dark }));
          univerAPI.toggleDarkMode(dark);
        } catch (_) { /* theme only */ }
      };
      const mo = new MutationObserver(applyTheme);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      L.mo = mo;
      const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
      if (mq && mq.addEventListener) mq.addEventListener("change", applyTheme);
      L.mq = mq; L.applyTheme = applyTheme;
      // The app's floating Help "?" lives in the bottom-right corner of every route and clears whatever marks itself `data-canvas-corner`
      // (src/shared/ui/cornerClearance.js). Univer's footer — sheet tabs, the zoom slider and "100%" — runs along that whole edge, so the
      // button sat ON the zoom readout and the footer's menu (measured on phone widths, 2026-10-31). Stamp the footer, and again if Univer
      // re-renders it, so the button rests above it instead.
      const stampFooter = () => { const f = hostRef.current && hostRef.current.querySelector("footer"); if (f && !f.hasAttribute("data-canvas-corner")) f.setAttribute("data-canvas-corner", "univer-footer"); };
      stampFooter();
      const moFooter = new MutationObserver(stampFooter);
      moFooter.observe(hostRef.current, { childList: true, subtree: true });
      L.moFooter = moFooter;

      // The page may be going away: URGENT, so the host persists synchronously instead of waiting for a render that may never come.
      // beforeunload covers a tab close / reload; pagehide covers the cases that never fire it (mobile, back-forward cache).
      const onHide = () => { if (document.visibilityState === "hidden") flush({ urgent: true }); };
      const onUnload = () => { flush({ urgent: true }); };
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("beforeunload", onUnload);
      window.addEventListener("pagehide", onUnload);
      L.detach = () => {
        document.removeEventListener("visibilitychange", onHide);
        window.removeEventListener("beforeunload", onUnload); window.removeEventListener("pagehide", onUnload);
      };

      // Handle for the verification harness. The facade can WRITE, so unlike the read-only diagnostics it is gated on
      // `window.__PLANYR_E2E === true` (a harness sets it before load; no URL, storage key or console flag in a
      // production tab can), checked at CALL time. `sidecar` (read-only) and `flush` (idempotent: save what is pending now) use the same gate.
      // (Not the Site Planner's diagArm: importing that here would make it a shared chunk on the Site route.)
      const e2e = () => typeof window !== "undefined" && window.__PLANYR_E2E === true;
      window.__planyrUniverRead = {
        api: () => (e2e() ? univerAPI : null),
        sidecar: () => (e2e() ? L.sidecar : null),
        flush: () => { if (e2e()) flush(); return e2e(); },
        tools: () => (e2e() ? L.tools : null),
        excelKeys: () => (e2e() ? { registered: L.excelKeys && L.excelKeys.registered, tips: L.excelKeys && L.excelKeys.keyTips.state, run: (id) => L.excelKeys.runAction(id) } : null),
        // harness-only: the header-drag gate's state and the controller's view of what is pending
        gate: () => (e2e() ? L.gate : null),
        gateInstalls: () => (e2e() ? { n: L.gateInstalls || 0, error: L.gateError || null } : null),
        pending: () => (e2e() ? L.save.hasPending() : null),
      };
    } catch (err) {
      setError(err);
      // eslint-disable-next-line no-console
      console.error("UniverSheet: failed to start", err);
    }
    return () => {
      // Flush BEFORE anything is torn down (this used to set `disposed` first, which turned its own flush into a no-op and
      // lost every edit made in the last debounce window when the grid unmounted).
      try { L.save && L.save.dispose(); } catch (_) { /* the unmount path must not throw */ }
      disposed = true;
      try { L.onReady && L.onReady(null); } catch (_) {}
      try { L.off && L.off.dispose && L.off.dispose(); } catch (_) {}
      try { L.mo && L.mo.disconnect(); } catch (_) {}
      try { L.moFooter && L.moFooter.disconnect(); } catch (_) {}
      try { L.mq && L.mq.removeEventListener && L.mq.removeEventListener("change", L.applyTheme); } catch (_) {}
      try { L.detach && L.detach(); } catch (_) {}
      try { L.formulaGuard && L.formulaGuard(); } catch (_) {}
      try { L.circularSub && L.circularSub.dispose(); } catch (_) {}
      try { L.excelKeys && L.excelKeys.dispose(); } catch (_) {}
      try { L.indent && L.indent.dispose(); } catch (_) {}
      try { L.tools && L.tools.dispose(); } catch (_) {}
      try { clearTimeout(L.gateTimer); L.detachGate && L.detachGate(); } catch (_) {}
      try { L.univerAPI && L.univerAPI.dispose(); } catch (_) {}
      try { L.univer && L.univer.dispose(); } catch (_) {}
      try { L.worker && L.worker.terminate(); } catch (_) {}            // a Worker handed to the RPC plugin is OURS to stop
      L.univer = null; L.worker = null; L.univerAPI = null; L.unitId = null; L.save = null; L.tools = null;
      if (typeof window !== "undefined") delete window.__planyrUniverRead;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Univer is created ONCE; later changes arrive through the effects below
  }, []);

  // ---- the workbook changed from OUTSIDE (cloud load, opened file, Planyr undo): rebuild; our own echo is ignored ------
  useEffect(() => {
    const L = live.current;
    if (!L.load || !L.univerAPI || !L.save) return;
    if (L.save.isOwnEcho(incoming)) return;
    L.load(workbook);
    L.installHeaderGate && L.installHeaderGate(L.unitId);
  }, [incoming, workbook]);

  // ---- Site.* / Plan.* / Comp.* ---------------------------------------------------------------------------------------
  useEffect(() => {
    const L = live.current;
    L.projectNames = projectNames;
    if (!L.injector || !L.unitId) return;
    const next = projectNamesToDefinedNames(projectNames);
    const prev = L.projectDefs || {};
    try {
      const commands = L.injector.get(ICommandService);
      const svc = L.injector.get(IDefinedNamesService);
      for (const [id, def] of Object.entries(prev)) {
        if (!next[id]) commands.syncExecuteCommand(RemoveDefinedNameMutation.id, { unitId: L.unitId, id, name: def.name });
      }
      for (const [id, def] of Object.entries(next)) {
        const cur = svc.getValueById(L.unitId, id);
        if (!cur || cur.formulaOrRefString !== def.formulaOrRefString) {
          commands.syncExecuteCommand(SetDefinedNameMutation.id, { unitId: L.unitId, ...def });
        }
      }
      L.projectDefs = next;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("UniverSheet: could not update project names", err);
      if (L.onNotice) L.onNotice("The Site.* / Plan.* / Comp.* names could not be refreshed in the new grid.");
    }
  }, [projectNames]);

  if (error) {
    return (
      <div role="alert" data-testid="univer-error" style={{ padding: 16, color: "var(--danger)", fontSize: 13 }}>
        The new grid could not start: {String(error && error.message || error)}. Turn it off from the File menu to go back to the regular grid.
      </div>
    );
  }
  return (
    <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <UniverToolPanels tools={tools} />
      <div ref={hostRef} data-testid="univer-grid" className="planyr-univer" style={{ flex: "1 1 auto", minHeight: 0, position: "relative", overflow: "hidden" }} />
    </div>
  );
}

export { PROJECT_NAME_ID_PREFIX };
