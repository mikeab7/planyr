// src/shared/schedule/engine/pageEntry.js
//
// The ONE entry the Schedule page loads. `npm run build:sequence-engine` bundles this file (esbuild,
// IIFE) into public/sequence/engine.js, which public/sequence/index.html loads with a plain
// <script src> BEFORE its own code. Everything the page used to carry as pasted-in copies — the
// formula engine, schedule ownership, range selection, the health rule engine, and the date /
// cascade / merge / drop-rule engine — is imported here from its real module and published as
// globals, so the page (a classic script, not an ES module) calls them by bare name exactly as before.
//
// Live bindings: HOLIDAY_SET, NOW and MEETING_BODY_INDEX are reassigned over time (the page does
// `NOW = …` / `HOLIDAY_SET = …`). A plain copy would freeze the first value, so each is published
// as a global ACCESSOR whose getter reads the module's live binding and whose setter calls the
// module's setter.
import * as calendar from "./calendar.js";
import * as meetings from "./meetings.js";
import * as predecessors from "./predecessors.js";
import * as cascade from "./cascade.js";
import * as merge from "./merge.js";
import * as owners from "./owners.js";
import * as health from "./health.js";
import * as tasks from "./tasks.js";
import * as normalize from "./normalize.js";
import * as healthEngine from "../healthEngine.js";
import * as ownership from "../scheduleOwnership.js";
import * as rangeSelection from "../../selection/rangeSelection.js";
import * as edgeScroll from "../../selection/edgeScroll.js";
import * as formula from "../../formula/formula.js";

// name → [getter, setter] for every module-level `let` the page reassigns
const LIVE = {
  HOLIDAY_SET: [() => calendar.HOLIDAY_SET, calendar.setHolidaySet],
  NOW: [() => calendar.NOW, calendar.setNOW],
  MEETING_BODY_INDEX: [() => meetings.MEETING_BODY_INDEX, meetings.setMeetingBodyIndex],
};

const g = globalThis;
const publish = (ns) => {
  for (const k of Object.keys(ns)) {
    if (LIVE[k]) continue;
    Object.defineProperty(g, k, { value: ns[k], configurable: true, writable: true, enumerable: false });
  }
};
[calendar, meetings, predecessors, cascade, merge, owners, health, tasks, normalize, healthEngine, ownership, rangeSelection, edgeScroll].forEach(publish);
for (const [k, [get, set]] of Object.entries(LIVE)) {
  Object.defineProperty(g, k, { get, set, configurable: true, enumerable: false });
}

// The formula engine keeps its old single global.
const F = formula;
g.PlanyrFormula = {
  evaluateFormula: F.evaluateFormula, formatValue: F.formatValue, parseFormula: F.parseFormula,
  extractRefs: F.extractRefs, planFormulaColumns: F.planFormulaColumns,
  makeDate: F.makeDate, isDate: F.isDate, isoToSerial: F.isoToSerial, serialToISO: F.serialToISO,
  ymdToSerial: F.ymdToSerial, weekdayOf: F.weekdayOf,
  BLANK: F.BLANK, errVal: F.errVal, isErrVal: F.isErrVal, FORMULA_ERRORS: F.FORMULA_ERRORS,
  FUNCTION_NAMES: F.FUNCTION_NAMES, FUNCTION_HELP: F.FUNCTION_HELP,
};
