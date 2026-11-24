// src/shared/schedule/engine/health.js
//
// Task status (health) display and roll-up, on top of healthEngine.js (rules, completion).
//
// Pure functions only (no React, no DOM). The Schedule page (public/sequence/index.html) gets this code
// through the generated script public/sequence/page.js (npm run build:sequence-page), and the unit
// tests import it directly — ONE copy, no paste-in. Moved here verbatim from the page (audit batch J1);
// behaviour is unchanged.
import { evalHealthRules, isCompleteTask } from "../healthEngine.js";
import { NOW, difBD } from "./calendar.js";
import { omitKeys } from "./omit.js";


// Compute display health. ⛔ RULES-DECIDE (2026-08-25, owner correction — supersedes the earlier
// "RULES-ALWAYS-WIN" pass on this same item, which kept `healthOverride` as a fallback for when no
// rule matched). The override flag and its early return are RETIRED outright: nothing a user clicks
// can ever pin a task's color against a firing rule — owner, verbatim: "pill and color and status are
// all the same thing... red=needs attn. period. end of story." The rule list runs first (first match
// wins); when no rule matches, the meeting-bound / deadline-row risk blocks below get their say (an
// unrelated, always-on feature, unchanged), and the raw stored `health` is the final fallback either
// way. A task may still carry a `healthOverride` field in old stored data — it is dead, unread data;
// nothing in this function or anywhere else in the app consults it anymore (verified: see B752848's
// audit of every read site before this was deleted). Only ever called with a LEAF task — a
// parent/summary row always shows the worst-of-children ROLLED health (computeRolledHealth) instead,
// which itself calls this function once per LEAF descendant (never on a parent — a parent's own stale
// rollup fields can never leak into a health rule; see computeRolledHealth's own comment for why
// that's safe).
export const computeDisplayHealth = (task, settings, taskById) => {
  if (!task) return task?.health;
  // ⛔ B785744 SUPERSEDES the global "Complete beats all" short-circuit that briefly lived here
  // (PR 1178/B780448, an emergency hardcode for the same live regression: "if the finish date is
  // in the past, it should be marked red... UNLESS I click task complete, ... I CAN OVERRIDE IN
  // THAT SCENARIO"). Per that fix's own owner instruction, once an UNLESS clause is expressible the
  // hardcode becomes a visible, editable RULE, not invisible behavior baked into this function — see
  // migrateRule's RULE_COMPLETE_PAUSED_GUARD, auto-attached to every migrated attention-color rule.
  // Net effect for his real data is identical (Complete still beats overdue); the difference is a
  // user can now see, edit, or narrow that exception per rule instead of it being an unconditional,
  // un-editable global override — and it extends the same protection to Paused, matching the
  // meeting/deadline blocks' own existing `health !== "green" && health !== "paused"` exemption below.
  const ruleResult = evalHealthRules(task, settings, NOW, taskById);
  if (ruleResult) return ruleResult;
  // B817 — a meeting-bound task surfaces its schedule risk BEFORE it slips: infeasible = red (a genuine
  // alert), ≤2 working days of float to the agenda deadline = at-risk yellow. Reads the cascade-derived
  // fields (no body lookup). Opt-in (only fires on bound rows); complete/paused rows are exempt.
  if (task.meetingBound && !isCompleteTask(task) && task.health !== "paused") {
    if (task.meetingInfeasible) return "red";
    if (task.meetingDeadline && difBD(NOW, task.meetingDeadline) <= 2) return "yellow";
  }
  // Deadline rows (deadlineForTaskId): the row's date IS the call/file-by deadline — infeasible
  // (predecessors land after it) = red; within 2 working days = at-risk yellow. Same exemptions.
  if (task.deadlineForTaskId != null && !isCompleteTask(task) && task.health !== "paused") {
    if (task.deadlineInfeasible) return "red";
    if (task.end && difBD(NOW, task.end) >= 0 && difBD(NOW, task.end) <= 2) return "yellow";
  }
  // B1953795 (S2) - a task at 100% IS complete: show green even if its status pill was never set.
  return isCompleteTask(task) ? "green" : task.health;
};

// B1161792 (NEW-1, Planyr Dashboard "Needs attention" card) — stamp/clear `needsAttentionSince`
// the moment a LEAF task's RULE-COMPUTED health (computeDisplayHealth) enters/leaves "red"
// ("Needs Attn."). This is a NEW field, distinct from the raw stored `.health` a user sets via
// the HealthPicker: a task can be promoted to red purely by an overdue/due-soon RULE while its
// own `.health` stays "gray"/"yellow", and computeDisplayHealth's derivation is deliberately
// never written back to `.health` (see its own comment above) — so before this, there was no
// record anywhere of WHEN a task became "Needs Attn.", only whether it currently is. The
// Dashboard reads only this stamp; it never re-derives health itself (that rule engine — custom
// per-account health statuses, overdue/due-soon config — stays here, the one place it's defined).
// Pure: takes the whole `data` document, returns it UNCHANGED (same reference) when nothing
// needs restamping, so a caller's `setData(d => reconcileNeedsAttention(d))` is a safe no-op
// React bails out of re-rendering for. Only ever evaluates LEAF tasks — same rule
// computeDisplayHealth's own doc states: a parent/summary row's stale rollup fields must never
// reach a health rule, so a parent is left untouched here exactly as computeRolledHealth leaves
// it to the worst-of-children rollup instead.
export const reconcileNeedsAttention = (d) => {
  if (!d || !d.projects) return d;
  let changedAny = false;
  const nowIso = new Date().toISOString();
  const nextProjects = {};
  for (const [pid, proj] of Object.entries(d.projects)) {
    const tasks = proj && Array.isArray(proj.tasks) ? proj.tasks : [];
    const byId = {};
    tasks.forEach(t => { byId[t.id] = t; });
    const parentIds = new Set();
    tasks.forEach(t => { if (t && t.parentId != null) parentIds.add(t.parentId); });
    let changed = false;
    const nextTasks = tasks.map(t => {
      if (!t || parentIds.has(t.id)) return t; // summary rows use the worst-of-children rollup, not their own
      const isRed = computeDisplayHealth(t, d.settings, byId) === "red";
      if (isRed && !t.needsAttentionSince) { changed = true; return { ...t, needsAttentionSince: nowIso }; }
      if (!isRed && t.needsAttentionSince) { changed = true; return omitKeys(t, ["needsAttentionSince"]); }
      return t;
    });
    if (changed) { changedAny = true; nextProjects[pid] = { ...proj, tasks: nextTasks }; }
    else nextProjects[pid] = proj;
  }
  return changedAny ? { ...d, projects: nextProjects } : d;
};

// Worst-of-descendants rolled status for each PARENT task — the value the grid shows on a
// collapsed parent. Shared by the project grid (rolledHealthMap) and the cross-project
// dashboard (MasterView) so the two never disagree about a parent's status. Pure.
//
// A LEAF child's contribution is its RULE-COMPUTED display health (computeDisplayHealth) —
// the same value the grid/PDF would print for that row if it were shown on its own — never the
// raw stored `health` field. Before this fix, a child that was automatically red by rule but
// still "gray" in storage (health rules are display-only; they never write back to `.health`)
// could not turn its parent red on either the grid or the export, even though both surfaces
// agree the child itself is red (measured live, screen and PDF export identical: a "gray"-
// stored overdue child read "Needs Attn." on its own row but its collapsed parent stayed "Not
// Started" on both surfaces — B6864-class defect). A cycle-guarded parentId loop still falls
// back to that task's raw `.health` (never computeDisplayHealth — a summary row's own
// start/end/percentComplete can be stale rollup leftovers, exactly what computeDisplayHealth's
// own doc comment warns a health rule must never see).
//
// No self-reference risk: computeDisplayHealth only ever reads a LEAF's own start/end/percent-
// Complete/predecessors/health/meetingBound/deadlineForTaskId — predecessorLate
// reads a predecessor's raw `.end`/`.percentComplete`, never another task's rolled or computed
// health — so nothing here ever asks a parent's rolled colour to explain itself.
export const HEALTH_PRIO = { red: 4, yellow: 3, paused: 2, green: 1, gray: 0, "": 0 };

export const computeRolledHealth = (all, settings) => {
  const byId = {}; all.forEach(t => { byId[t.id] = t; });
  const rollup = (id, stack) => {
    if (stack.has(id)) return byId[id]?.health || "";
    const children = all.filter(t => t.parentId === id);
    if (!children.length) { const t = byId[id]; return t ? (computeDisplayHealth(t, settings, byId) || "") : ""; }
    stack.add(id);
    let best = "", bestP = 0;
    for (const c of children) { const h = rollup(c.id, stack); const p = HEALTH_PRIO[h] || 0; if (p > bestP) { bestP = p; best = h; } }
    stack.delete(id);
    return best;
  };
  const map = {};
  all.forEach(t => { if (all.some(c => c.parentId === t.id)) map[t.id] = rollup(t.id, new Set()); });
  return map;
};
