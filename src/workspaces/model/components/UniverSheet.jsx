/* Model workspace — the Univer grid (owner-only SPIKE; docs/SPREADSHEET-UNIVER-SPIKE.md). Lazy chunk: nothing in
 * this file, and none of @univerjs/*, is imported by any eagerly loaded module.
 *
 * It REPLACES nothing. ModelApp mounts it instead of the Ribbon / FormulaBar / SheetView / TabStrip ONLY while the
 * owner-only switch is on (lib/univerSwitch.js); every other account renders exactly today's grid.
 *
 * DATA FLOW (one direction each way, through the bridge — lib/univerBridge.js):
 *   Planyr workbook ──workbookToUniver──▶ Univer          (mount, and again only if the workbook changes from
 *                                                          OUTSIDE — a cloud load, an opened file, an undo)
 *   Univer edit ──(debounced)──univerToWorkbook──▶ onChange(workbook)  ──▶ ModelApp `commit` ──▶ the SAME
 *                                                          modelStore / modelSaveState / cloud push / fileWorkbook
 *                                                          path as today, so persistence is unchanged.
 * Echo guard: the canonical JSON of the last workbook this component emitted (or was built from) is remembered;
 * an incoming prop that equals it is our own edit coming back and is ignored — never re-imported into Univer.
 *
 * Open-source @univerjs/* only (no @univerjs-pro, no license key, no Univer server). xlsx / csv stay on the
 * existing ExcelJS / SheetJS path; this file never touches Univer's exchange packages. */
import { useEffect, useMemo, useRef, useState } from "react";
import { createUniver, LocaleType, mergeLocales, defaultTheme, ICommandService } from "@univerjs/presets";
import {
  UniverSheetsCorePreset, CalculationMode, IDefinedNamesService, SetDefinedNameMutation, RemoveDefinedNameMutation, IconManager,
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

const SAVE_DEBOUNCE_MS = 300;
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

export default function UniverSheet({ workbook, projectNames, onChange, onNotice, onReady }) {
  const hostRef = useRef(null);
  const live = useRef({});                 // everything the long-lived Univer callbacks read (never stale)
  live.current.onChange = onChange;
  live.current.onNotice = onNotice;
  live.current.onReady = onReady;
  const [error, setError] = useState(null);
  const incoming = useMemo(() => canonicalJson(migrateWorkbook(workbook)), [workbook]);

  // ---- mount: create Univer once, load the workbook, wire edit detection ----------------------------------------------
  useEffect(() => {
    let disposed = false;
    const L = live.current;
    try {
      const dark0 = isDark();
      const theme = buildUniverTheme(defaultTheme, readTokens(), { dark: dark0 });
      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(coreEnUS, sortEnUS, filterEnUS, findEnUS) },
        theme, darkMode: dark0,
        presets: [
          UniverSheetsCorePreset({ container: hostRef.current, ribbonType: RIBBON_TYPE, formula: { initialFormulaComputing: CalculationMode.WHEN_EMPTY } }),
          UniverSheetsSortPreset(), UniverSheetsFilterPreset(), UniverSheetsFindReplacePreset(),
        ],
      });
      L.univer = univer; L.univerAPI = univerAPI;
      L.injector = univer.__getInjector();
      // Curved undo / redo (NEW-2, B2574353): toolbar glyphs resolve by name through Univer's IconManager (not the facade's
      // registerComponent, which is a different registry). Replace the built-in ones; the toolbar draws them on its next render.
      const icons = L.injector.get(IconManager);
      for (const [name, icon] of Object.entries(CURVED_ICONS)) { icons.delete(name); icons.register(name, icon); }

      const load = (wb) => {
        const migrated = migrateWorkbook(wb);
        const { data, sidecar } = workbookToUniver(migrated);
        const defs = projectNamesToDefinedNames(live.current.projectNames);
        if (Object.keys(defs).length) {
          const res = data.resources.find((r) => r.name === "SHEET_DEFINED_NAME_PLUGIN");
          if (res) res.data = JSON.stringify({ ...JSON.parse(res.data), ...defs });
          else data.resources.push({ name: "SHEET_DEFINED_NAME_PLUGIN", data: JSON.stringify(defs) });
        }
        if (L.unitId) { try { univerAPI.disposeUnit(L.unitId); } catch (_) { /* already gone */ } }
        L.sidecar = sidecar;
        L.lastJson = canonicalJson(migrated);
        L.projectDefs = defs;
        const fWb = univerAPI.createWorkbook(data);
        L.unitId = fWb.getId();
        const active = migrated.sheets.find((s) => s.id === migrated.activeSheetId);
        if (active) { try { fWb.setActiveSheet(fWb.getSheetBySheetId(active.id)); } catch (_) { /* first sheet stays active */ } }
        return fWb;
      };
      L.load = load;

      const flush = () => {
        clearTimeout(L.timer); L.timer = 0;
        if (disposed || !L.unitId) return;
        const fWb = univerAPI.getWorkbook(L.unitId) || univerAPI.getActiveWorkbook();
        if (!fWb) return;
        const snap = fWb.save();
        const activeSheet = fWb.getActiveSheet();
        const { workbook: next, notes } = univerToWorkbook(snap, {
          sidecar: L.sidecar,
          activeSheetId: activeSheet ? activeSheet.getSheetId() : undefined,
          formulaOf: (sheetId, r, c) => {
            try { const s = fWb.getSheetBySheetId(sheetId); return s ? s.getRange(r, c).getFormula() : null; } catch (_) { return null; }
          },
        });
        const json = canonicalJson(next);
        if (json === L.lastJson) return;
        L.lastJson = json;
        if (notes.length && L.onNotice) L.onNotice(`Saved, but not everything Univer can hold fits Planyr's workbook: ${notes.join("; ")}.`);
        if (L.onChange) L.onChange(next, notes);
      };
      L.flush = flush;

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
        if (typeof e.id === "string" && e.id.includes(".mutation.") && !e.id.includes("selection") && !e.id.includes("scroll")) {
          clearTimeout(L.timer);
          L.timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
        }
      });
      L.off = off;

      load(workbook);
      if (L.onReady) L.onReady({ flush });

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

      const onHide = () => { if (document.visibilityState === "hidden") flush(); };
      document.addEventListener("visibilitychange", onHide);
      window.addEventListener("pagehide", flush);
      L.detach = () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", flush); };

      // Handle for the verification harness. The facade can WRITE, so unlike the read-only diagnostics it is gated on
      // `window.__PLANYR_E2E === true` (a harness sets it before load; no URL, storage key or console flag in a
      // production tab can), checked at CALL time. `sidecar` (read-only) and `flush` (idempotent: save what is pending now) use the same gate.
      // (Not the Site Planner's diagArm: importing that here would make it a shared chunk on the Site route.)
      const e2e = () => typeof window !== "undefined" && window.__PLANYR_E2E === true;
      window.__planyrUniverRead = {
        api: () => (e2e() ? univerAPI : null),
        sidecar: () => (e2e() ? L.sidecar : null),
        flush: () => { if (e2e()) flush(); return e2e(); },
      };
    } catch (err) {
      setError(err);
      // eslint-disable-next-line no-console
      console.error("UniverSheet: failed to start", err);
    }
    return () => {
      disposed = true;
      try { L.flush && L.timer && L.flush(); } catch (_) { /* the unmount path must not throw */ }
      disposed = true;
      clearTimeout(L.timer);
      try { L.off && L.off.dispose && L.off.dispose(); } catch (_) {}
      try { L.mo && L.mo.disconnect(); } catch (_) {}
      try { L.mq && L.mq.removeEventListener && L.mq.removeEventListener("change", L.applyTheme); } catch (_) {}
      try { L.detach && L.detach(); } catch (_) {}
      try { L.univerAPI && L.univerAPI.dispose(); } catch (_) {}
      try { L.univer && L.univer.dispose(); } catch (_) {}
      L.univer = null; L.univerAPI = null; L.unitId = null;
      if (typeof window !== "undefined") delete window.__planyrUniverRead;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Univer is created ONCE; later changes arrive through the effects below
  }, []);

  // ---- the workbook changed from OUTSIDE (cloud load, opened file, Planyr undo): rebuild; our own echo is ignored ------
  useEffect(() => {
    const L = live.current;
    if (!L.load || !L.univerAPI) return;
    if (incoming === L.lastJson) return;
    L.load(workbook);
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
  return <div ref={hostRef} data-testid="univer-grid" className="planyr-univer" style={{ flex: "1 1 auto", minHeight: 0, position: "relative", overflow: "hidden" }} />;
}

export { PROJECT_NAME_ID_PREFIX };
