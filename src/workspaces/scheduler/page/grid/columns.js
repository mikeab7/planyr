import { ownerJoin, ownerListOf } from "../../../../shared/schedule/engine/owners.js";
import { HOLIDAY_SET, NOW, fdLocal } from "../../../../shared/schedule/engine/calendar.js";
import { toShortDate } from "../../../../shared/schedule/engine/tasks.js";
import { exposeToHarness } from "../harnessGlobals.js";

// Which kind of pointer made the press that is being handled: React's onMouseDown cannot say (a MouseEvent has
// no pointerType), but the pointerdown that precedes every mousedown — a tap's compatibility mouse events
// included — can.
export let lastRowPointerType = "mouse";
export const installRowPointerTypeListener = () => { window.addEventListener("pointerdown", ev => { lastRowPointerType = ev.pointerType || "mouse"; }, true); };

export const COLS = [
  {k:"id",              l:"ID",      w:30,  e:false           },
  {k:"name",            l:"Task",    w:220, e:true            },
  {k:"start",           l:"Start",   w:62,  e:true, t:"date"  },
  {k:"end",             l:"Finish",  w:62,  e:true, t:"date"  },
  {k:"duration",        l:"Dur",     w:42,  e:true, t:"num"   },
  {k:"predecessors",    l:"Predecessor",    w:148, e:true, t:"pred"  },
  {k:"successors",      l:"Successor",      w:148, e:false,t:"succ"  },
  {k:"health",          l:"●",       w:36,  e:true, t:"health"},
  {k:"status",          l:"Status",  w:84,  e:false           },
  {k:"responsibleParty",l:"Owner",   w:132, e:true            },
  {k:"cost",            l:"Cost",    w:88,  e:true, t:"cost"  },
  {k:"notes",           l:"Notes",   w:192, e:true, t:"notes" },
  // B212 — additional available fields. Hidden by default; user shows them per-project
  // via the Columns chooser. Cost/budget fields render blank when a task has no value.
  {k:"percentComplete", l:"% Comp",  w:78,  e:true, t:"num"   },
  {k:"budget",          l:"Budget",  w:92,  e:true, t:"cost"  },
  {k:"actualCost",      l:"Actual",  w:92,  e:true, t:"cost"  },
  {k:"meetingBody",     l:"Meeting", w:130, e:false,t:"meeting"},   // B816 — bind a task to a meeting body (hidden by default)
  {k:"floatToDeadline", l:"Float",   w:64,  e:false,t:"meeting"},   // B817 — working days to the agenda deadline
  {k:"costIfMissed",    l:"Cost/miss",w:74, e:false,t:"meeting"},   // B817 — calendar days the hearing slips if missed
];
const TOTAL_W = COLS.reduce((s,c) => s+c.w, 0);
// B212 — column-config plumbing. COLS is the master AVAILABLE-field registry; the left
// table shows a per-project subset/order. DEFAULT_GRID_COLS is what a project starts from
// (the original twelve; the new fields above ship hidden). Config persists per project at
// projects[pid].colConfig and rides the existing cloud-save path (setData → autosave).
export const COL_BY_K = Object.fromEntries(COLS.map(c => [c.k, c]));
export const DEFAULT_GRID_COLS = ["id","name","start","end","duration","predecessors","successors","health","status","responsibleParty","cost","notes"];
// B583 — a project's user-defined Formula columns (proj.formulaCols) are valid grid
// columns alongside the built-in COLS. Their keys (f_…) must survive the visible-list
// filter and get a default width, or a saved formula column would silently vanish on load.
export const formulaColsOf = proj => (Array.isArray(proj && proj.formulaCols) ? proj.formulaCols : []);
export const readGridCfg = (proj, data) => {
  const fcs = formulaColsOf(proj);
  const fKeys = new Set(fcs.map(fc => fc.k));
  const isValidKey = k => !!COL_BY_K[k] || fKeys.has(k);
  const cfg = proj && proj.colConfig;
  let visible;
  if (cfg && Array.isArray(cfg.visible) && cfg.visible.length) visible = cfg.visible.filter(isValidKey);
  else if (data && Array.isArray(data.gridColOrder) && data.gridColOrder.length) visible = data.gridColOrder.filter(k => COL_BY_K[k] && DEFAULT_GRID_COLS.includes(k)); // migrate legacy global order
  else visible = [...DEFAULT_GRID_COLS];
  if (!visible.includes("name")) visible = ["name", ...visible];   // the Task name column can't be hidden
  // B817/B844 — meeting columns default ON (unless the user set an explicit column config). The Meeting
  // column appears once the project DEFINES ≥1 meeting body (so right-click binding is discoverable via the
  // column too — B844); Float / Cost appear once any task is actually BOUND. All render blank on unbound rows.
  // NEW-1 (B<PENDING>, 2026-09-23) — a schedule with ZERO meeting bodies of its own can still have tasks
  // bound to a body imported/borrowed from ANOTHER schedule (B816's ids are globally unique). The old
  // "the project DEFINES ≥1 body" gate missed exactly that case — a schedule like this stayed on the
  // OLD default column set forever, so the Meeting column (now correctly naming the foreign body/its
  // schedule, see Cell()'s "meetingBody" case) never appeared for anyone to see it. Same OR as the
  // Float/Cost line below: a body defined here, OR a task actually bound (however the body got there).
  const anyBound = Array.isArray(proj?.tasks) && proj.tasks.some(t => t.meetingBound);
  if (!(cfg && Array.isArray(cfg.visible) && cfg.visible.length)) {
    if ((Array.isArray(proj?.meetingBodies) && proj.meetingBodies.length || anyBound) && !visible.includes("meetingBody")) visible.push("meetingBody");
    if (anyBound) {
      ["floatToDeadline","costIfMissed"].forEach(k => { if (!visible.includes(k)) visible.push(k); });
    }
  }
  const saved = (cfg && cfg.widths) || (data && data.gridColWidths) || {};
  const widths = {};
  COLS.forEach(c => { widths[c.k] = saved[c.k] ?? c.w; });
  fcs.forEach(fc => { widths[fc.k] = saved[fc.k] ?? fc.w ?? 130; });
  return { visible, widths };
};
export const writeGridCfg = (setData, pid, next) => setData(d =>
  (d.projects && d.projects[pid]) ? {...d, projects: {...d.projects, [pid]: {...d.projects[pid], colConfig: next}}} : d);
// Friendly names for the chooser / context menu (some header labels are symbols, e.g. ● for health).
const COL_LABELS = {id:"ID", name:"Task name", start:"Start", end:"Finish", duration:"Duration",
  predecessors:"Predecessors", successors:"Successors", health:"Health", status:"Status",
  responsibleParty:"Owner", cost:"Cost", notes:"Notes", percentComplete:"% Complete",
  budget:"Budget", actualCost:"Actual / Spend", meetingBody:"Meeting body",
  floatToDeadline:"Float to deadline", costIfMissed:"Cost if missed"};
export const colLabel = c => COL_LABELS[c.k] || c.l || c.k;

// ── B583 — Formula columns: effective per-project column registry ─────────────
// A project's user-defined Formula columns (proj.formulaCols: [{k,l,formula,w}])
// join the built-in COLS to form the project's effective column list. A column is
// targeted by INDEX (selectedColIdx, copy/format/nav), so the same list must be used
// wherever a column is resolved by index — the App keyboard/copy/format handlers AND
// the grid's row render — or a formula column's index won't line up. Formula columns
// are derived display columns: read-only in the grid (e:false), computed after the
// date cascade.
const formulaColToColDef = fc => ({ k: fc.k, l: fc.l || "Formula", w: fc.w || 130, e: false, t: "formula", formula: fc.formula || "" });
export const effectiveColsOf = proj => (formulaColsOf(proj).length ? [...COLS, ...formulaColsOf(proj).map(formulaColToColDef)] : COLS);
export const activeEffectiveCols = d => effectiveColsOf(activeProjectOf(d));

// ── B583 — Formula-engine host glue ───────────────────────────────────────────
// Bridges the scheduler's task records to the pure engine (window.PlanyrFormula,
// inlined above). Built-in columns are exposed to formulas by friendly name; Start/
// Finish become engine date values; WORKDAY/NETWORKDAYS read the SAME working-day
// calendar (HOLIDAY_SET + weekends) the schedule cascade uses, so date math agrees
// with the durations. % Complete is the stored 0–100 number; Duration is working days.
const _pfDateRef = iso => { const PF = window.PlanyrFormula; if (!iso) return PF.BLANK; const s = PF.isoToSerial(iso); return s == null ? PF.BLANK : PF.makeDate(s); };
const _pfNumOrBlank = v => (v === "" || v == null) ? window.PlanyrFormula.BLANK : (Number(v) || 0);
const _pfCostRef = (t, key, rolledKey) => {
  const PF = window.PlanyrFormula;
  if (t.hasChildren) return Number(t[rolledKey] || 0);
  const raw = t[key];
  return (raw === "" || raw == null) ? PF.BLANK : (Number(raw) || 0);
};
// One row per built-in column a formula may read. `name` is the canonical reference
// (what autocomplete offers); `aliases` are also accepted; `get(task)` returns a typed value.
const FORMULA_BUILTIN_REFS = [
  { name: "ID",         aliases: [],                                  get: t => Number(t.id) },
  { name: "Task",       aliases: ["Name", "Task name"],               get: t => (t.name || "") },
  { name: "Start",      aliases: [],                                  get: t => _pfDateRef(t.start) },
  { name: "Finish",     aliases: ["End"],                             get: t => _pfDateRef(t.end) },
  { name: "Duration",   aliases: ["Dur"],                             get: t => _pfNumOrBlank(t.duration) },
  { name: "% Complete", aliases: ["% Comp", "Percent Complete"],      get: t => Number(t.percentComplete || 0) },
  { name: "Cost",       aliases: [],                                  get: t => _pfCostRef(t, "cost", "rolledCost") },
  { name: "Budget",     aliases: [],                                  get: t => _pfCostRef(t, "budget", "rolledBudget") },
  { name: "Actual",     aliases: ["Actual / Spend", "Actual Cost"],   get: t => _pfCostRef(t, "actualCost", "rolledActual") },
  { name: "Owner",      aliases: ["Responsible", "Responsible Party"],get: t => ownerJoin(ownerListOf(t)) },
  { name: "Health",     aliases: ["Status"],                          get: t => (t.health || "") },
];
export const formulaCalendar = () => {
  const PF = window.PlanyrFormula;
  return { isWorkingDay: serial => { const w = PF.weekdayOf(serial); if (w === 0 || w === 6) return false; return !HOLIDAY_SET.has(PF.serialToISO(serial)); } };
};
export const formulaToday = () => { const PF = window.PlanyrFormula; const s = PF.isoToSerial(NOW); return s == null ? PF.isoToSerial(fdLocal(new Date())) : s; };
// Lowercased reference-name → built-in getter (incl. aliases).
const _formulaBuiltinMap = () => { const m = new Map(); FORMULA_BUILTIN_REFS.forEach(r => { m.set(r.name.toLowerCase(), r); r.aliases.forEach(a => m.set(a.toLowerCase(), r)); }); return m; };
// The built-in column values for one task, keyed lowercased (what the engine looks up).
export const buildFormulaRowColumns = task => { const cols = {}; _formulaBuiltinMap().forEach((ref, lname) => { cols[lname] = ref.get(task); }); return cols; };
// Autocomplete name list = built-in canonical names + this project's formula labels.
export const formulaColumnNames = proj => {
  const names = FORMULA_BUILTIN_REFS.map(r => r.name);
  formulaColsOf(proj).forEach(fc => { if (fc.l) names.push(fc.l); });
  return names;
};
export const isBuiltinFormulaName = name => { const l = String(name || "").toLowerCase(); return FORMULA_BUILTIN_REFS.some(r => r.name.toLowerCase() === l || r.aliases.some(a => a.toLowerCase() === l)); };
// Compute every formula column's value for every task. Dependent formula columns are
// ordered topologically (a formula that reads another formula sees its value); cycles
// and parse errors surface as cell errors. Returns { [taskId]: { [colKey]: cell } }.
export const computeFormulaValues = (tasks, formulaColDefs, proj) => {
  const PF = window.PlanyrFormula;
  const out = {};
  if (!PF || !Array.isArray(formulaColDefs) || !formulaColDefs.length || !Array.isArray(tasks)) return out;
  const cal = formulaCalendar();
  const today = formulaToday();
  const dateFmt = serial => toShortDate(PF.serialToISO(serial));
  const defByKey = Object.fromEntries(formulaColDefs.map(d => [d.k, d]));
  const labelLowerByKey = Object.fromEntries(formulaColDefs.map(d => [d.k, (d.l || "").toLowerCase()]));
  const nameToKey = name => { const l = String(name).toLowerCase(); const fc = formulaColDefs.find(d => (d.l || "").toLowerCase() === l); return fc ? fc.k : null; };
  const plan = PF.planFormulaColumns(formulaColDefs.map(d => ({ key: d.k, formula: d.formula })), nameToKey);
  // Whole-column aggregation (SUM([Cost]), COUNTIF, XLOOKUP, …) must read the project's
  // LEAF tasks of the FULL tree — NOT the visible/flattened rows. The flattened list
  // double-counts an EXPANDED group (the parent shows the rolled-up sum AND its children
  // are listed too) and omits a COLLAPSED group's children entirely — so neither matches
  // the true total. Leaves carry the atomic values; a parent's cell is a pure roll-up of them.
  const allTasks = (proj && Array.isArray(proj.tasks) && proj.tasks.length) ? proj.tasks : tasks;
  const parentIds = new Set(allTasks.map(t => t.parentId).filter(x => x !== null && x !== undefined));
  const isLeaf = t => !parentIds.has(t.id);
  // Working set = the visible rows we must OUTPUT a value for, PLUS any leaf hidden under a
  // collapsed parent (absent from `tasks`). Deduped by id; prefer the visible/augmented row
  // object (it carries rolledCost/rolledBudget for a parent's own this-row display value).
  const byId = new Map();
  tasks.forEach(t => byId.set(t.id, t));
  allTasks.forEach(t => { if (isLeaf(t) && !byId.has(t.id)) byId.set(t.id, t); });
  const work = [...byId.values()];
  const rowOf = new Map(work.map(t => [t.id, buildFormulaRowColumns(t)]));
  const aggRows = work.filter(isLeaf).map(t => rowOf.get(t.id)); // leaves only → the aggregation view
  const visibleIds = new Set(tasks.map(t => t.id));
  tasks.forEach(t => { out[t.id] = {}; });
  // Compute COLUMN-BY-COLUMN in dependency order — so a formula that aggregates ANOTHER
  // formula column sees that column already filled for every leaf.
  plan.order.forEach(key => {
    const def = defByKey[key]; if (!def) return;
    const ll = labelLowerByKey[key];
    work.forEach(task => {
      const cols = rowOf.get(task.id);
      let res;
      if (plan.cyclic.has(key)) res = { ok: false, error: PF.FORMULA_ERRORS.CIRC, detail: "circular reference between formula columns" };
      else res = PF.evaluateFormula(def.formula, { columns: cols, rows: aggRows, rowIndex: 0, calendar: cal, today, formatDate: dateFmt });
      // Expose to dependent formula columns (aggRows share these maps). An errored cell is
      // stored as an ERROR VALUE (not BLANK) so a downstream SUM/COUNT/etc. over this column
      // PROPAGATES the error — matching Excel — instead of silently skipping the bad row.
      if (ll) cols[ll] = res.ok ? res.value : PF.errVal(res.error);
      if (visibleIds.has(task.id)) {
        const display = res.ok ? PF.formatValue(res.value, { formatDate: dateFmt }) : res.error;
        out[task.id][key] = { ok: res.ok, error: res.ok ? null : res.error, detail: res.detail, display, value: res.ok ? res.value : undefined };
      }
    });
  });
  return out;
};
export function activeProjectOf(d) {
  if (!d || typeof d !== "object" || !d.projects) return null;
  const p = d.aPid != null ? d.projects[d.aPid] : null;
  return p && typeof p === "object" ? p : null;
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  lastRowPointerType: [() => lastRowPointerType, (v) => { lastRowPointerType = v; }],
  installRowPointerTypeListener: [() => installRowPointerTypeListener],
  COLS: [() => COLS],
  TOTAL_W: [() => TOTAL_W],
  COL_BY_K: [() => COL_BY_K],
  DEFAULT_GRID_COLS: [() => DEFAULT_GRID_COLS],
  formulaColsOf: [() => formulaColsOf],
  readGridCfg: [() => readGridCfg],
  writeGridCfg: [() => writeGridCfg],
  COL_LABELS: [() => COL_LABELS],
  colLabel: [() => colLabel],
  formulaColToColDef: [() => formulaColToColDef],
  effectiveColsOf: [() => effectiveColsOf],
  activeEffectiveCols: [() => activeEffectiveCols],
  _pfDateRef: [() => _pfDateRef],
  _pfNumOrBlank: [() => _pfNumOrBlank],
  _pfCostRef: [() => _pfCostRef],
  FORMULA_BUILTIN_REFS: [() => FORMULA_BUILTIN_REFS],
  formulaCalendar: [() => formulaCalendar],
  formulaToday: [() => formulaToday],
  _formulaBuiltinMap: [() => _formulaBuiltinMap],
  buildFormulaRowColumns: [() => buildFormulaRowColumns],
  formulaColumnNames: [() => formulaColumnNames],
  isBuiltinFormulaName: [() => isBuiltinFormulaName],
  computeFormulaValues: [() => computeFormulaValues],
  activeProjectOf: [() => activeProjectOf],
});
