/* needsAttentionList — pure flat list of tasks in the "Needs Attn." state across EVERY schedule
 * project (B1161792, NEW-1 — the "Needs attention" dashboard card, Direction C).
 *
 * Reads `needsAttentionSince`, a per-task field the embedded Scheduler (public/sequence/
 * index.html) stamps the moment a task's RULE-COMPUTED health (`computeDisplayHealth`) first
 * reads "red" ("Needs Attn.") and clears the moment it stops — see that file's reconciliation
 * effect for the write side. This module does not re-derive health itself: the stamp is the one
 * API surface between the two apps for "is this task in the needs-attention state, and since
 * when" — computeDisplayHealth's rule engine (custom health statuses, per-account overdue/
 * due-soon config) lives ONLY in the Scheduler and is deliberately not re-implemented here
 * (same reasoning as scheduleHealth.js's own header).
 *
 * This field did not exist before this item — `health` itself is user-set and never carries a
 * transition timestamp, and computeDisplayHealth is a live, every-render derivation that is
 * never written back to `health` (public/sequence/index.html's own comment: "that computed color
 * is never written back to `health`"). So "days since it entered Needs Attn." is NOT the same
 * number as "days past due" — a task can be overdue for months before a rule promotes it to red,
 * or be red for a reason that has nothing to do with its end date (a custom account rule). The
 * dispatch that ordered this card was explicit that days-past-due must never be silently
 * substituted, so this module refuses to compute anything from `t.end` as a proxy for the sort
 * key — a task with no stamp simply isn't "needs attention" yet, full stop.
 */

const MS_PER_DAY = 86400000;

/** Extract predecessor ids from either shape a task's `predecessors` field can carry (a bare
 * number, or an object `{id, type, lag}` — see public/sequence/index.html's own `normPreds`). */
function normPredIds(preds) {
  if (!Array.isArray(preds)) return [];
  const out = [];
  for (const p of preds) {
    if (p == null) continue;
    if (typeof p === "object" && p.id != null) out.push(p.id);
    else if (typeof p === "number" && !Number.isNaN(p)) out.push(p);
  }
  return out;
}

/** { [taskId]: N } — how many OTHER tasks in this project name `taskId` as a predecessor, i.e.
 * how many tasks are "waiting" on it. Mirrors the Scheduler's own `succMap` derivation. */
function successorCounts(tasks) {
  const counts = {};
  for (const t of tasks) {
    for (const pid of normPredIds(t?.predecessors)) counts[pid] = (counts[pid] || 0) + 1;
  }
  return counts;
}

/** Leaf tasks only — a parent/summary row's own health can be a stale rollup (scheduleHealth.js's
 * own reasoning), and it is never what gets stamped `needsAttentionSince` (see the Scheduler's
 * reconciliation effect, which only ever stamps leaves). */
function leafTasks(tasks) {
  const parentIds = new Set();
  for (const t of tasks) { if (t && t.parentId != null) parentIds.add(t.parentId); }
  return tasks.filter((t) => t && !parentIds.has(t.id));
}

/** `projectsMap` — the raw `value.projects` map from the "hs-v1" planar_data row
 * (dashboardScheduleFetch.js's `fetchScheduleProjects`). Returns one row per task currently
 * stamped `needsAttentionSince`, across every project, sorted DESCENDING by days since it
 * entered the state (oldest first — the row that has waited longest leads the list). */
export function needsAttentionList(projectsMap, nowMs = Date.now()) {
  const projects = projectsMap && typeof projectsMap === "object" ? Object.values(projectsMap) : [];
  const rows = [];
  for (const p of projects) {
    const tasks = Array.isArray(p?.tasks) ? p.tasks : [];
    const leaves = leafTasks(tasks);
    const succ = successorCounts(tasks);
    for (const t of leaves) {
      if (!t || !t.needsAttentionSince) continue;
      const sinceMs = Date.parse(t.needsAttentionSince);
      if (Number.isNaN(sinceMs)) continue;
      const days = Math.max(0, Math.floor((nowMs - sinceMs) / MS_PER_DAY));
      rows.push({
        taskId: t.id,
        taskName: (t.name && String(t.name).trim()) || `Task #${t.id}`,
        projectId: p.id,
        projectName: (p && typeof p.name === "string" && p.name.trim()) || "Untitled schedule",
        linkedSiteId: p?.linkedSiteId || null,
        dueDate: t.end || null,
        waiting: succ[t.id] || 0,
        days,
      });
    }
  }
  return rows.sort((a, b) => b.days - a.days);
}

/** Per-project totals for the card footer, loudest (most rows) project first — e.g.
 * "Grand Port 153 · Goose Creek 147 · 8 South 54 · Pursuits 13". Ties broken by name so the
 * order is stable rather than depending on Map insertion order. */
export function needsAttentionTotals(rows) {
  const byProject = new Map();
  for (const r of rows || []) {
    if (!byProject.has(r.projectId)) byProject.set(r.projectId, { projectId: r.projectId, projectName: r.projectName, count: 0 });
    byProject.get(r.projectId).count++;
  }
  return [...byProject.values()].sort((a, b) => b.count - a.count || a.projectName.localeCompare(b.projectName));
}

/** How far a row's bar should extend, 0..1, relative to the TOP row's day count (the dispatch's
 * "a thin proportional bar... scaled to the top row's day count"). Returns 0 when there's nothing
 * to scale against (an empty list, or a top row at 0 days) rather than dividing by zero. */
export function attentionBarFraction(days, maxDays) {
  if (!maxDays || maxDays <= 0) return 0;
  return Math.max(0, Math.min(1, days / maxDays));
}
