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
 *
 * B1939344 (NEW-1) — `projectName` is the QUALIFIED "<Project> / <Schedule>" label
 * (`crossScheduleLabel`, `src/shared/schedule/scheduleOwnership.js`), not the bare schedule name —
 * see scheduleHealth.js's own header for why a bare name is ambiguous on this account and why this
 * is the SAME helper the Reports tab already uses, not a second hand-copy.
 */
import { crossScheduleLabel } from "../../../shared/schedule/scheduleOwnership.js";

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
 * entered the state (oldest first — the row that has waited longest leads the list), ties broken
 * by `waiting` (more downstream tasks blocked wins) then task name — see B1411504 below for why
 * a tie-break was needed at all.
 *
 * ⛔ B1411504 — `bulkStamped`, and why `days` alone can't be trusted for a tied row. The
 * Scheduler's `reconcileNeedsAttention` (public/sequence/index.html) stamps `needsAttentionSince`
 * on every real data change — including the FIRST LOAD of an existing schedule after this field
 * shipped, which stamps EVERY already-red task at once with ONE shared `nowIso`. Confirmed against
 * the owner's real production row (2026-09-09): 25 of his 31 currently-flagged tasks carry the
 * exact same timestamp to the millisecond, another 6 share a second exact timestamp — two bulk
 * events, zero organic ones. Those tasks span due dates five weeks apart, so `days` for them means
 * "how long we've been WATCHING", not "how long it's actually been" — and there is no other
 * per-task timestamp anywhere in this document to backfill from (re-confirmed 2026-09-08,
 * dashboardScheduleFetch.js's own header). Rather than ship a confident-looking number that will
 * be wrong for weeks, a row is marked `bulkStamped: true` whenever its exact `needsAttentionSince`
 * is shared with at least one other currently-flagged task anywhere in the account — an
 * independent, organic transition landing on the same millisecond as another is not a real
 * possibility, so sharing IS the bulk-event signature. The card renders those with a "+" — "at
 * least this many days" — instead of a bare number that implies precision it doesn't have. */
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
        projectName: crossScheduleLabel(p),
        linkedSiteId: p?.linkedSiteId || null,
        dueDate: t.end || null,
        waiting: succ[t.id] || 0,
        days,
        stampedAt: t.needsAttentionSince,
      });
    }
  }
  const stampCounts = new Map();
  for (const r of rows) stampCounts.set(r.stampedAt, (stampCounts.get(r.stampedAt) || 0) + 1);
  for (const r of rows) r.bulkStamped = stampCounts.get(r.stampedAt) > 1;

  return rows.sort((a, b) => b.days - a.days || b.waiting - a.waiting || a.taskName.localeCompare(b.taskName));
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
