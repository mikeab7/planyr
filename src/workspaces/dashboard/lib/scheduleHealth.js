/* scheduleHealth — pure per-schedule task-health summary for the Dashboard's "Schedule health"
 * card (B1213313, NEW-2).
 *
 * Reads the SAME `public.planar_data` blob the embedded Scheduler (public/sequence/index.html)
 * reads (one row, key "hs-v1", RLS-scoped to the signed-in user — see dashboardScheduleFetch.js
 * for the actual Supabase call). `value.projects` is a MAP keyed by string project id, not an
 * array; each project holds `{ id, name, linkedSiteId, tasks: [...] }`.
 *
 * ⛔ This is a SIMPLIFIED, independent heuristic, not a re-implementation of the embedded app's
 * full Automation rule engine (`evalHealthRules`/`computeDisplayHealth`, public/sequence/
 * index.html ~3769-3912). Replicating that engine's per-account configurable rules here would
 * duplicate a lot of logic this card doesn't need to own. What IS replicated exactly is the one
 * rule virtually every schedule has — "overdue" — because the owner-visible number this card
 * shows should agree with the grid's own definition of overdue, not a re-guessed one:
 *   overdue = task.end is set, health is not "green"/"paused", and end is at least 1 full
 *             calendar day in the past.
 * "At-risk" (due soon) is this card's OWN heuristic — not read from any configured rule — so it
 * is deliberately named "at-risk" rather than "yellow"/"due soon", the words the grid itself
 * uses for its (possibly differently-configured) warning state.
 */

const MS_PER_DAY = 86400000;
const AT_RISK_WINDOW_DAYS = 7;

function calendarDayDiff(fromIso, toMs) {
  const fromMs = Date.parse(fromIso);
  if (Number.isNaN(fromMs)) return null;
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

/** Leaf tasks only — a summary/parent row's own start/end/health can be a stale rollup, so
 * counting it would double-count (or mis-count) whatever its children already contribute. */
function leafTasks(tasks) {
  const parentIds = new Set();
  for (const t of tasks) { if (t && t.parentId != null) parentIds.add(t.parentId); }
  return tasks.filter((t) => t && !parentIds.has(t.id));
}

/** One project's { complete, overdue, atRisk, onTrack, total }. `nowMs` is injectable for tests. */
export function summarizeProjectHealth(project, nowMs = Date.now()) {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
  const leaves = leafTasks(tasks);
  let complete = 0, overdue = 0, atRisk = 0, onTrack = 0;
  for (const t of leaves) {
    if (t.health === "green") { complete++; continue; }
    if (t.health === "paused") { onTrack++; continue; }
    const days = t.end ? calendarDayDiff(t.end, nowMs) : null;
    if (days != null && days >= 1) { overdue++; continue; }
    if (days != null && days >= -AT_RISK_WINDOW_DAYS) { atRisk++; continue; }
    onTrack++;
  }
  return { complete, overdue, atRisk, onTrack, total: leaves.length };
}

/** All projects with at least one task, sorted with the least-healthy (highest overdue share)
 * first — the ones that need a look are the ones worth seeing without scrolling. */
export function summarizeScheduleHealth(projectsMap, nowMs = Date.now()) {
  const projects = projectsMap && typeof projectsMap === "object" ? Object.values(projectsMap) : [];
  return projects
    .map((p) => ({
      id: p?.id ?? null,
      name: (p && typeof p.name === "string" && p.name.trim()) || "Untitled schedule",
      linkedSiteId: p?.linkedSiteId || null,
      ...summarizeProjectHealth(p, nowMs),
    }))
    .filter((p) => p.total > 0)
    .sort((a, b) => (b.overdue / b.total || 0) - (a.overdue / a.total || 0));
}
