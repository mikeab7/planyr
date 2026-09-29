// src/shared/schedule/healthEngine.js
//
// B1953795 (S2/S4/S5) — the Scheduler's task-health rule engine + the ONE "is it complete / what %"
// answer, as a real ES module the Dashboard can import. The embedded Scheduler
// (public/sequence/index.html, compiled in-browser, cannot import from src/) holds the SAME text
// between its `@shared-engine:begin/end` markers; test/scheduleHealthEngineParity.test.js fails if
// the two ever differ, so there is ONE definition kept in two places by a machine check, not two
// hand-maintained heuristics (the Dashboard's old "simplified independent heuristic" is retired).
//
// Everything between the markers below is copied VERBATIM from index.html. Edit index.html first,
// then re-copy (node scripts/sync-health-engine.mjs writes this file from it).
//
// WHAT THIS DOES NOT COVER (said loudly, not hidden): the meeting-bound / deadline-row risk blocks of
// the grid's computeDisplayHealth need business-day math + cascade-derived fields (meetingInfeasible,
// deadlineInfeasible) that live only in the embedded app, so `displayHealth` here is the rule engine
// + the completion answer + the stored-status fallback, i.e. exactly the grid's answer for every task
// that is not meeting-bound / a deadline row.

const pd = s => new Date(s + "T12:00:00");
const dif  = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
const ownerListOf = t => {
  const rp = t && t.responsibleParty;
  const raw = Array.isArray(rp) ? rp : (rp ? [rp] : []);
  const seen = new Set(); const out = [];
  raw.forEach(name => {
    const s = String(name == null ? "" : name).trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k); out.push(s);
  });
  return out;
};

/* @shared-engine:begin — mirrored VERBATIM in src/shared/schedule/healthEngine.js (the Dashboard
 * consumes that module); test/scheduleHealthEngineParity.test.js fails if the two drift. Edit BOTH. */
// ── B1953795 (S2) — "Complete" has ONE answer. A task's completion lives in two stored fields
// (`health === "green"` from the status pill, `percentComplete` from the % cell); leaf writers used to
// update only one, and readers picked whichever they liked. Now every reader asks these functions and
// every writer goes through completionDelta, so the two can never disagree. Stored data is untouched
// (non-destructive): the effective values are computed at read time.
//   complete   = not paused, and (status green OR % >= 100)
//   effective % = 100 when status green, else the stored % (clamped); a PARENT row's % is derived at
//                 read time from its leaf descendants (duration-weighted), never its stale stored leftover.
const isCompleteTask = t => !!t && t.health !== "paused" && (t.health === "green" || (Number(t.percentComplete) || 0) >= 100);
const leafPercent = t => !t ? 0 : t.health === "green" ? 100 : Math.max(0, Math.min(100, Math.round(Number(t.percentComplete) || 0)));
const _pctMapCache = new WeakMap();
const rolledPercentMap = all => {
  if (!Array.isArray(all)) return {};
  const hit = _pctMapCache.get(all); if (hit) return hit;
  const byId = {}; const kids = {};
  all.forEach(t => { if (!t) return; byId[t.id] = t; if (t.parentId != null) (kids[t.parentId] = kids[t.parentId] || []).push(t); });
  const map = {};
  const acc = (id, stack) => {   // -> [weightedSum, weight] over LEAF descendants
    const ch = kids[id];
    if (!ch || stack.has(id)) { const t = byId[id]; const w = Math.max(1, Number(t && t.duration) || 0); return [leafPercent(t) * w, w]; }
    stack.add(id); let sum = 0, wt = 0;
    for (const c of ch) { const [a, b] = acc(c.id, stack); sum += a; wt += b; }
    stack.delete(id); return [sum, wt];
  };
  Object.keys(kids).forEach(k => { const t = byId[k]; if (!t) return; const [a, b] = acc(t.id, new Set()); map[t.id] = b ? Math.round(a / b) : leafPercent(t); });
  _pctMapCache.set(all, map);
  return map;
};
const effectivePercentComplete = (t, all) => { if (!t) return 0; if (all) { const m = rolledPercentMap(all); if (m[t.id] != null) return m[t.id]; } return leafPercent(t); };
// Writer side: given a task's PREVIOUS state and an update patch, the extra fields that keep both
// stores consistent. green => % 100; % >= 100 => green; % < 100 on a green task => un-green (gray);
// leaving a complete state via a status pick resets a 100 to 0 (a typed 40 is never touched).
const completionDelta = (prev, updates) => {
  const extra = {};
  if (!prev || !updates) return extra;
  if ("health" in updates && updates.health !== prev.health) {
    if (updates.health === "green") { if ((Number(prev.percentComplete) || 0) < 100 && !("percentComplete" in updates)) extra.percentComplete = 100; }
    else if (isCompleteTask(prev) && !("percentComplete" in updates) && (Number(prev.percentComplete) || 0) >= 100) extra.percentComplete = 0;
  } else if ("percentComplete" in updates && !("health" in updates)) {
    const pct = Number(updates.percentComplete) || 0;
    if (pct >= 100 && prev.health !== "green") extra.health = "green";
    else if (pct < 100 && prev.health === "green") extra.health = "gray";
  }
  return extra;
};
// A status set on a PARENT cascades to every descendant; this is the % each descendant takes with it
// (green => 100, anything else clears a 100 so "un-complete the parent" un-completes its tasks too).
const cascadeDelta = (t, health) => health === "green" ? { percentComplete: 100 } : ((Number(t && t.percentComplete) || 0) >= 100 ? { percentComplete: 0 } : {});
const RULE_FIELDS = [
  {k:"finish",          label:"Finish date",   type:"date"},
  {k:"start",           label:"Start date",    type:"date"},
  {k:"status",          label:"Status",        type:"status"},
  {k:"owner",           label:"Owner",         type:"text"},
  {k:"percentComplete", label:"% Complete",    type:"number"},
  {k:"cost",            label:"Cost",          type:"number"},
  {k:"budget",          label:"Budget",        type:"number"},
  {k:"actualCost",      label:"Actual Cost",   type:"number"},
  {k:"predecessor",     label:"Predecessor",   type:"flag"},
];
const RULE_FIELD_BY_K = Object.fromEntries(RULE_FIELDS.map(f => [f.k, f]));
const RULE_OPS = {
  date: [
    {k:"pastDueAtLeast",    label:"is N+ days past due",       needsValue:true,  defaultValue:1},
    {k:"withinDays",        label:"is within N days",           needsValue:true,  defaultValue:7},
    {k:"moreThanDaysAway",  label:"is more than N days away",   needsValue:true,  defaultValue:14},
    {k:"isToday",           label:"is today",                   needsValue:false},
    {k:"isBlank",           label:"is blank",                   needsValue:false},
    {k:"isNotBlank",        label:"is not blank",               needsValue:false},
  ],
  status: [
    {k:"is",    label:"is",     needsValue:true, valueKind:"status"},
    {k:"isNot", label:"is not", needsValue:true, valueKind:"status"},
  ],
  text: [
    {k:"isBlank",    label:"is blank",     needsValue:false},
    {k:"isNotBlank", label:"is not blank", needsValue:false},
    {k:"is",         label:"is",           needsValue:true, valueKind:"text"},
    {k:"contains",   label:"contains",     needsValue:true, valueKind:"text"},
  ],
  number: [
    {k:"eq",         label:"is",          needsValue:true, valueKind:"number"},
    {k:"gt",         label:"is more than",needsValue:true, valueKind:"number"},
    {k:"lt",         label:"is less than",needsValue:true, valueKind:"number"},
    {k:"gte",        label:"is at least", needsValue:true, valueKind:"number"},
    {k:"lte",        label:"is at most",  needsValue:true, valueKind:"number"},
    {k:"isBlank",    label:"is blank",     needsValue:false},
    {k:"isNotBlank", label:"is not blank", needsValue:false},
  ],
  flag: [
    {k:"isLate", label:"is late", needsValue:false},
  ],
};
const opsForField = fieldK => RULE_OPS[RULE_FIELD_BY_K[fieldK]?.type] || [];

// Pure, single condition. `taskById` is only read by the `predecessor` field.
const evalFieldCondition = (cond, task, NOW, taskById) => {
  const field = cond?.field, op = cond?.op, value = cond?.value;
  if (field === "predecessor") {
    if (op !== "isLate") return false;
    const preds = Array.isArray(task.predecessors) ? task.predecessors : [];
    if (!preds.length || !taskById) return false;
    return preds.some(p => {
      const pt = taskById[p?.id];
      return !!pt && !!pt.end && !isCompleteTask(pt) && dif(pt.end, NOW) >= 1;
    });
  }
  const ftype = RULE_FIELD_BY_K[field]?.type;
  if (!ftype) return false;
  if (ftype === "date") {
    const raw = field === "finish" ? task.end : task.start;
    const has = !!raw;
    switch (op) {
      case "isBlank":          return !has;
      case "isNotBlank":       return has;
      case "isToday":          return has && raw === NOW;
      case "pastDueAtLeast":   return has && dif(raw, NOW) >= (value ?? 1);
      case "withinDays":       { if (!has) return false; const d = dif(NOW, raw); return d >= 0 && d <= (value ?? 7); }
      case "moreThanDaysAway": return has && dif(NOW, raw) > (value ?? 0);
      default: return false;
    }
  }
  if (ftype === "status") {
    const raw = isCompleteTask(task) ? "green" : task.health;   // B1953795 - 100% reads as Complete (green)
    switch (op) {
      case "is":    return raw === value;
      case "isNot": return raw !== value;
      default: return false;
    }
  }
  if (ftype === "text") {
    // "owner" is the one text field today, and it is a LIST (NEW-1) — isBlank/isNotBlank read the
    // whole list; is/contains match ANY owner in it, not just the first (matches the grid/master
    // filter contract: a rule for "Owner contains X" must fire for a task where X is a co-owner).
    if (field === "owner") {
      const list = ownerListOf(task);
      const v = String(value || "").trim().toLowerCase();
      switch (op) {
        case "isBlank":    return list.length === 0;
        case "isNotBlank": return list.length > 0;
        case "is":         return list.some(n => n.toLowerCase() === v);
        case "contains":   return v ? list.some(n => n.toLowerCase().includes(v)) : false;
        default: return false;
      }
    }
    const s = String(task[field] || "").trim();
    const v = String(value || "").trim().toLowerCase();
    switch (op) {
      case "isBlank":    return !s;
      case "isNotBlank": return !!s;
      case "is":         return s.toLowerCase() === v;
      case "contains":   return s.toLowerCase().includes(v);
      default: return false;
    }
  }
  // number: percentComplete/cost/budget/actualCost — a missing value reads as 0 (matches the
  // long-standing `task.percentComplete || 0` convention), EXCEPT the two blank tests, whose job
  // is to distinguish "truly unset" from "explicitly 0".
  const raw = (field === "percentComplete" && task.health === "green") ? 100 : task[field];   // B1953795 - green means 100
  const isBlank = raw === "" || raw == null;
  const num = isBlank || isNaN(raw) ? 0 : Number(raw);
  switch (op) {
    case "isBlank":    return isBlank;
    case "isNotBlank": return !isBlank;
    case "eq":  return num === Number(value);
    case "gt":  return num > Number(value);
    case "lt":  return num < Number(value);
    case "gte": return num >= Number(value);
    case "lte": return num <= Number(value);
    default: return false;
  }
};
// A condition GROUP (a rule's `when` or `unless`) — empty groups never match (an empty `when`
// can't fire a rule; an empty `unless` never blocks one — the common, "no exception" case).
const evalConditionGroup = (conds, combinator, task, NOW, taskById) => {
  if (!Array.isArray(conds) || !conds.length) return false;
  return combinator === "OR"
    ? conds.some(c => evalFieldCondition(c, task, NOW, taskById))
    : conds.every(c => evalFieldCondition(c, task, NOW, taskById));
};
// Returns the rule's color if it fires (when-group matches AND unless-group does not), else null.
const evalRule = (rule, task, NOW, taskById) => {
  if (!rule || !evalConditionGroup(rule.when, rule.whenCombinator, task, NOW, taskById)) return null;
  if (evalConditionGroup(rule.unless, rule.unlessCombinator, task, NOW, taskById)) return null;
  return rule.color;
};

// ── v1 → v2 migration (pure, derived, never persisted — same philosophy as the old
// migrateCfRulesToHealthRules: a plan that never touches the panel keeps behaving exactly as
// before). HEALTH_CONDITIONS/evalHealthCondition below are RETAINED verbatim, unused by the live
// engine now, kept only so old data/tests have a frozen behavioral reference for this mapping. ──
const LEGACY_RULE_FIELD_MAP = {
  finishPastDays:   days => [{field:"finish", op:"pastDueAtLeast", value: days ?? 1}],
  finishWithinDays: days => [{field:"finish", op:"withinDays",     value: days ?? 7}],
  finishToday:      ()   => [{field:"finish", op:"isToday"}],
  notStarted:       ()   => [{field:"start", op:"pastDueAtLeast", value:1}, {field:"percentComplete", op:"lte", value:0}],
  predecessorLate:  ()   => [{field:"predecessor", op:"isLate"}],
  noOwner:          ()   => [{field:"owner", op:"isBlank"}],
  complete:         ()   => [{field:"percentComplete", op:"gte", value:100}],
};
// ⛔ B785744 — an old-shape (v1) rule had no exception clause at all; its only protection against
// painting a manually-completed task was ORDERING ("put a Complete rule first"), which silently
// stops working the moment that rule is missing — exactly what happened live: the owner's one
// configured rule (finish 1+ days overdue → red, no complete rule) mis-colored 212 of his 557 real
// leaf tasks red, because marking a task Complete only ever writes `health:"green"` and never
// touches `percentComplete` (verified: HealthPicker → commit → applyUpdate → `updateTask(id,
// {health:val})`, no percentComplete write, anywhere). PR 1178 patched this as an emergency global
// hardcode (`if (task.health==="green") return "green"` ahead of the whole rule engine). This
// migration is the real fix: every migrated attention-color (non-green) rule gets the same
// protection back as a VISIBLE, EDITABLE `unless` clause instead of invisible behavior — exactly
// what the rebuilt language exists to make expressible. computeDisplayHealth below no longer
// carries the global short-circuit; if PR 1178 lands first, its hardcode is redundant with this
// and should be removed as part of reconciling this branch.
const RULE_COMPLETE_PAUSED_GUARD = [{field:"status", op:"is", value:"green"}, {field:"status", op:"is", value:"paused"}];
const migrateRule = r => {
  if (r && Array.isArray(r.when)) return r; // already v2 shape
  const build = LEGACY_RULE_FIELD_MAP[r?.type];
  const when = build ? build(r.days) : [];
  const unless = (r && r.color && r.color !== "green") ? RULE_COMPLETE_PAUSED_GUARD : [];
  return {
    id: r?.id ?? `r${Math.random().toString(36).slice(2,10)}`,
    when, whenCombinator: "AND",
    color: r?.color,
    unless, unlessCombinator: "OR",
  };
};

// ⛔ RETAINED, UNUSED BY THE LIVE ENGINE (superseded by RULE_FIELDS/evalFieldCondition above) —
// kept only as the frozen behavioral reference migrateRule's LEGACY_RULE_FIELD_MAP translates
// against, and because the existing test suite pins its exact semantics. Do not extend; extend
// RULE_FIELDS/RULE_OPS instead.
// Finite vocabulary by design: no formula parser, no scripting, no boolean composer — each
// condition here is one named, parameterized (by N days) fact.
const HEALTH_CONDITIONS = [
  {k:"finishPastDays",   label:"Finish date is N+ days past due",     needsDays:true,  defaultDays:1},
  {k:"finishWithinDays", label:"Finish date is within N days",         needsDays:true,  defaultDays:7},
  {k:"finishToday",      label:"Finish date is today",                 needsDays:false},
  {k:"notStarted",       label:"Start date has passed, not started",   needsDays:false},
  {k:"predecessorLate",  label:"A predecessor is late",                needsDays:false},
  {k:"noOwner",          label:"No owner assigned",                    needsDays:false},
  {k:"complete",         label:"Task is 100% complete",                needsDays:false},
];
const HEALTH_CONDITION_BY_KEY = Object.fromEntries(HEALTH_CONDITIONS.map(c => [c.k, c]));

// Pure. `taskById` is only read by "predecessorLate" — every other condition looks at `task` alone.
const evalHealthCondition = (type, days, task, NOW, taskById) => {
  const pct = leafPercent(task);
  switch (type) {
    case "finishPastDays":
      if (!task.end || pct >= 100) return false;
      return dif(task.end, NOW) >= (days ?? 1);
    case "finishWithinDays": {
      if (!task.end || pct >= 100) return false;
      const d = dif(NOW, task.end);
      return d >= 0 && d <= (days ?? 7);
    }
    case "finishToday":
      return !!task.end && pct < 100 && task.end === NOW;
    case "notStarted":
      return !!task.start && pct <= 0 && dif(task.start, NOW) >= 1;
    case "predecessorLate": {
      const preds = Array.isArray(task.predecessors) ? task.predecessors : [];
      if (!preds.length || !taskById) return false;
      return preds.some(p => {
        const pt = taskById[p?.id];
        return !!pt && !!pt.end && !isCompleteTask(pt) && dif(pt.end, NOW) >= 1;
      });
    }
    case "noOwner":
      return ownerListOf(task).length === 0;
    case "complete":
      return pct >= 100;
    default:
      return false;
  }
};

// Legacy → new: the old 3-toggle cfRules expressed as an equivalent ordered rule list, in the SAME
// precedence the old code used (completeGreen, then overdueRed, then dueSoonYellow — each replicating
// its old threshold exactly: 1+ day overdue, within 7 days). Derived live, never persisted, so a plan
// that never set `healthRules` keeps behaving exactly as it did before this shipped (B... golden test).
const migrateCfRulesToHealthRules = cfRules => {
  const cf = cfRules || {};
  const out = [];
  if (cf.completeGreen) out.push({id:"legacy-complete", type:"complete", color:"green"});
  if (cf.overdueRed)    out.push({id:"legacy-overdue",  type:"finishPastDays", days:1, color:"red"});
  if (cf.dueSoonYellow) out.push({id:"legacy-duesoon",  type:"finishWithinDays", days:7, color:"yellow"});
  return out;
};
// A brand-new plan's starting point (v2 shape), offered via the panel's "Reset to suggested
// defaults" — never retrofitted onto an existing plan's settings (that would repaint tasks on
// upgrade). No separate "Complete → green" rule: marking a task Complete already sets
// `health:"green"` directly (the status pill), and the fallback at the bottom of
// computeDisplayHealth shows the raw stored health when no rule fires — a rule for it would be a
// no-op. Both defaults carry the visible "unless already Complete/Paused" exception His sentence
// asked for, in place of the old ordering trick.
const DEFAULT_HEALTH_RULES = [
  {id:"default-overdue", when:[{field:"finish", op:"pastDueAtLeast", value:1}], whenCombinator:"AND",
    color:"red", unless:[...RULE_COMPLETE_PAUSED_GUARD], unlessCombinator:"OR"},
  {id:"default-duesoon", when:[{field:"finish", op:"withinDays", value:3}], whenCombinator:"AND",
    color:"yellow", unless:[...RULE_COMPLETE_PAUSED_GUARD], unlessCombinator:"OR"},
];
// getHealthRules is the ONE place old (v1 ordered-list) and very-old (3-toggle cfRules) stored
// shapes become the v2 {when,unless} shape every caller (the panel, the evaluator) actually reads —
// pure and derived, never persisted, so nothing repaints until the owner touches the panel.
const getHealthRules = settings => {
  const raw = Array.isArray(settings?.healthRules) ? settings.healthRules : migrateCfRulesToHealthRules(settings?.cfRules);
  return raw.map(migrateRule);
};
const evalHealthRules = (task, settings, NOW, taskById) => {
  const rules = getHealthRules(settings);
  for (const r of rules) { const c = evalRule(r, task, NOW, taskById); if (c) return c; }
  return null;
};
/* @shared-engine:end */

export {
  isCompleteTask, leafPercent, rolledPercentMap, effectivePercentComplete, completionDelta, cascadeDelta,
  RULE_FIELDS, RULE_FIELD_BY_K, RULE_OPS, evalFieldCondition, evalConditionGroup, evalRule,
  migrateRule, migrateCfRulesToHealthRules, DEFAULT_HEALTH_RULES, getHealthRules, evalHealthRules,
  opsForField, HEALTH_CONDITIONS, HEALTH_CONDITION_BY_KEY, evalHealthCondition, LEGACY_RULE_FIELD_MAP, RULE_COMPLETE_PAUSED_GUARD,
};

/** The grid's display health for a LEAF task (no meeting/deadline blocks — see header). `now` = "YYYY-MM-DD". */
export function displayHealth(task, settings, now, taskById) {
  if (!task) return undefined;
  const ruleResult = evalHealthRules(task, settings, now, taskById);
  if (ruleResult) return ruleResult;
  return isCompleteTask(task) ? "green" : task.health;
}
