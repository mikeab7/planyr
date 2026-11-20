/* Model workspace — building the Univer framework instance, and building ONE AHEAD OF TIME (NEW-1, B2604xxx — docs/SPREADSHEET-UNIVER-SPIKE.md
 * "Load time"). Part of the lazy Univer chunk; UniverSheet.jsx is its only importer (test/modelUniverSwitch pins that).
 *
 * WHY A PRE-BUILT INSTANCE. Measured on the real app (click on the Spreadsheet tab, the chunk already warm): about 0.4 s from the click to
 * Univer's "Ready" stage and 0.6 s more to its "Rendered" stage — framework start-up (every sheet plugin's controllers are created when the
 * FIRST workbook exists), the formula worker booting, and Univer's own paint delay — none of which depends on the workbook. So the
 * moment the pointer rests on the tab (src/workspaces/model/lib/univerWarm.js, at idle time) one framework instance is built into an
 * off-screen element and left to reach Rendered. When the grid mounts, UniverSheet TAKES it: moves its element into place and loads the real workbook.
 * ROUND 3 (B2607857): when the page is a project's and this device holds that project's workbook, the instance is built WITH IT — the real unit,
 * formulas seeded from the remembered results, first frame drawn off-screen. If the workbook the grid then mounts with is byte-for-byte that one
 * (canonical text + same scope), UniverSheet adopts the unit as it stands, skipping the whole load and the first draw; anything else (an edit
 * elsewhere, a cloud copy that won, a Library file) drops it and loads normally. Without a stored workbook it is a one-cell placeholder, as in round 2.
 * Nothing about the workbook, the callbacks, the keys or the save path is in here — those are all wired by UniverSheet after it takes the
 * instance, exactly as for a fresh one. An instance nobody takes is disposed after EXPIRE_MS.
 *
 * ONE-AT-A-TIME: it is only ever built when no grid is alive (two Univer instances in one page fight over the keyboard) and at most once
 * until it is taken or expires. */
import { createUniver, LocaleType, mergeLocales, defaultTheme } from "@univerjs/presets";
import { UniverSheetsCorePreset, CalculationMode } from "@univerjs/preset-sheets-core";
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
import { buildUniverTheme, THEME_TOKEN_VARS } from "../lib/univerTheme.js";
import { readLocalSheet } from "../lib/modelStore.js";
import { prepareUnit } from "../lib/univerUnitPrep.js";
import { peekCalc, primeCalcCache, calcCacheSettled } from "../lib/univerCalcCache.js";
import UniverFormulaWorker from "../lib/univerFormulaWorker.js?worker";

// ONE header strip, everything left-aligned (NEW-1, B2574352): Univer's "collapsed" ribbon folds the Start / Formulas / Data / View
// tab strip into a dropdown at the strip's left edge and packs that tab's tools right beside it. (The default, "classic", is a
// centred tab row ABOVE the tool row = two headers.) Configuration only — the package is not forked; see univerSheet.css.
export const RIBBON_TYPE = "collapsed";
export const EXPIRE_MS = 60000;

export const readTokens = () => {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const [k, v] of Object.entries(THEME_TOKEN_VARS)) out[k] = cs.getPropertyValue(v).trim();
  return out;
};
export const isDark = () => {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
};

/** Create the Univer instance (presets, theme, formula worker) into `container`. With `data` (an IWorkbookData), also create THAT workbook as
 *  the first unit; with `blank`, a one-cell placeholder instead — Univer starts its sheet plugins (and so reaches Ready, then Rendered) only
 *  once a unit exists. Returns the live handles; wiring is the caller's. */
export function buildFramework({ container, blank = false, data = null }) {
  const dark = isDark();
  const theme = buildUniverTheme(defaultTheme, readTokens(), { dark });
  // The formula engine runs in a Web Worker (lib/univerFormulaWorker.js) so a calculation never blocks the grid. If a worker
  // cannot start, Univer calculates on the page as before — slower, never wrong — and the console says so.
  let worker = null;
  try { worker = new UniverFormulaWorker(); } catch (err) { console.error("UniverSheet: could not start the formula worker; calculating on the page", err); worker = null; }
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(coreEnUS, sortEnUS, filterEnUS, findEnUS) },
    theme, darkMode: dark,
    presets: [
      UniverSheetsCorePreset({ container, ribbonType: RIBBON_TYPE, ...(worker ? { workerURL: worker } : {}), formula: { initialFormulaComputing: CalculationMode.WHEN_EMPTY } }),
      UniverSheetsSortPreset(), UniverSheetsFilterPreset(), UniverSheetsFindReplacePreset(),
    ],
  });
  let unitId = null;
  if (data) unitId = univerAPI.createWorkbook(data).getId();
  else if (blank) unitId = univerAPI.createWorkbook({ id: "planyr-prewarm", name: "", appVersion: "", locale: LocaleType.EN_US, sheetOrder: ["p1"], sheets: { p1: { id: "p1", name: "Sheet1", rowCount: 10, columnCount: 6 } }, styles: {} }).getId();
  return { univer, univerAPI, injector: univer.__getInjector(), worker, dark, unitId };
}

// ---- the pre-built instance ---------------------------------------------------------------------------------------------------------
let pool = null;          // { ...handles, container, expiry }
let alive = 0;            // grids currently mounted
let building = false;     // a pre-build is waiting for the remembered results to be read

export const noteGridMounted = () => { alive++; };
export const noteGridUnmounted = () => { alive = Math.max(0, alive - 1); };

function discard(p) {
  clearTimeout(p.expiry);
  try { (p.subs || []).forEach((d) => d && d.dispose && d.dispose()); } catch (_) { /* already gone */ }
  try { p.univerAPI.dispose(); } catch (_) { /* already gone */ }
  try { p.univer.dispose(); } catch (_) { /* already gone */ }
  try { p.worker && p.worker.terminate(); } catch (_) { /* already gone */ }
  try { p.container.remove(); } catch (_) { /* already gone */ }
}

/** Build the instance ahead of time. No-op when a grid is alive, one is already waiting, or there is no DOM. Never throws.
 *  With `projectId` (the project the pointer's page is on) and this device's stored workbook for it, the REAL unit is built — formulas
 *  seeded from the remembered results, first frame drawn off-screen — and UniverSheet adopts it as-is when the workbook it mounts with is
 *  byte-for-byte that one (NEW-1, B2607857). Without a stored workbook it is the one-cell placeholder, as before. */
const mark = (n) => { try { performance.mark(`uv:${n}`); } catch (_) { /* marks are a courtesy (read by ui-audit/measure-univer-tti.mjs) */ } };
export function prewarmFramework({ projectId = null, userId = null } = {}) {
  if (typeof document === "undefined" || pool || alive > 0 || building) return false;
  building = true;
  mark("pre-start");
  const go = () => {
    building = false;
    mark("pre-go");
    if (pool || alive > 0) return;
    let container = null;
    try {
      let prep = null;
      if (projectId) {
        try {
          const local = readLocalSheet(userId, projectId);
          if (local) prep = prepareUnit(local, { entry: peekCalc(projectId) });
        } catch (_) { prep = null; }                                          // an unreadable copy is just a placeholder build
      }
      mark("pre-prep");
      container = document.createElement("div");
      container.setAttribute("data-univer-prewarm", "1");
      container.className = "planyr-univer";
      // off-screen but LAID OUT (display:none would give Univer a zero-size canvas); sized like the grid will be so nothing re-lays-out much later
      container.style.cssText = `position:fixed;left:-20000px;top:0;width:${Math.max(600, window.innerWidth)}px;height:${Math.max(400, window.innerHeight - 120)}px;overflow:hidden;pointer-events:none`;
      document.body.appendChild(container);
      const fw = buildFramework({ container, blank: !prep, data: prep ? prep.data : null });
      mark("pre-framework");
      const entry = { ...fw, container, expiry: null, prep: null, viewKey: projectId, found: [], ended: false };
      if (prep) {
        prep.data = null;                                                     // Univer owns it now; keep only what the grid needs to adopt the unit
        entry.prep = prep;
        try {
          const wb = fw.univerAPI.getWorkbook(fw.unitId);
          const active = prep.migrated.sheets.find((x) => x.id === prep.migrated.activeSheetId);
          if (wb && active) wb.setActiveSheet(wb.getSheetBySheetId(active.id));
        } catch (_) { /* the first sheet stays active */ }
        // The unit's first calculation can finish before the grid exists to hear it: keep what it said (circular references, that it ended), hand it over.
        try {
          const f = fw.univerAPI.getFormula();
          entry.subs = [
            f.calculationStart(() => { entry.found = []; }),
            f.calculationProcessing((q) => { if (q && Array.isArray(q.circularReferences) && q.circularReferences.length) entry.found = q.circularReferences; }),
            f.calculationEnd(() => { entry.ended = true; }),
          ];
        } catch (_) { entry.subs = []; }
      }
      entry.expiry = setTimeout(() => { if (pool === entry) { pool = null; discard(entry); } }, EXPIRE_MS);
      pool = entry;
      mark("pre-done");
    } catch (err) {
      console.warn("univerFramework: could not pre-build the grid (it will be built when the grid opens)", err);
      if (container) { try { container.remove(); } catch (_) { /* gone */ } }
      pool = null;
    }
  };
  // the remembered results for this project must be IN MEMORY before the unit is built (they seed its formula cells)
  if (projectId && !calcCacheSettled(projectId)) { const p = primeCalcCache(projectId); if (p) { p.then(go, go); return true; } }
  go();
  return !!pool;
}

/** The waiting instance (or null). The caller owns it from here: it must move `container` into place and dispose everything on unmount. */
export function takePrewarmed() {
  const p = pool; pool = null;
  if (p) {
    clearTimeout(p.expiry);
    try { (p.subs || []).forEach((d) => d && d.dispose && d.dispose()); } catch (_) { /* already gone */ }   // the grid listens for itself from here
    p.subs = [];
  }
  return p;
}
export const prewarmWaiting = () => !!pool;
