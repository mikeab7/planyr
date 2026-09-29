/* scheduleHealth — pure per-schedule task-health summary for the Dashboard's "Schedule health"
 * card (B1213313, NEW-2).
 *
 * Reads the SAME `public.planar_data` blob the embedded Scheduler (public/sequence/index.html)
 * reads (one row, key "hs-v1", RLS-scoped to the signed-in user — see dashboardScheduleFetch.js
 * for the actual Supabase call). `value.projects` is a MAP keyed by string project id, not an
 * array; each project holds `{ id, name, linkedSiteId, tasks: [...] }`.
 *
 * B1953795 (S4) — THE SAME RULES THE GRID USES. This card used to run its own "simplified
 * independent heuristic" (a fixed 7-day at-risk window; complete = status green only), so it
 * disagreed with the grid and with the Needs-attention card whenever the account had custom health
 * rules or the grid's own 3-day default. It now evaluates every leaf task through the shared rule
 * engine (`src/shared/schedule/healthEngine.js` — the Scheduler's own text, kept identical by
 * test/scheduleHealthEngineParity.test.js) using the account's `settings.healthRules`, so:
 *   complete = displays green (status green OR 100%), overdue = displays red ("Needs Attn."),
 *   atRisk = displays yellow, paused/other = onTrack.
 * `settings` is the schedule document's `settings` (dashboardScheduleFetch.fetchScheduleSettings).
 * Not covered (meeting-bound / deadline-row risk blocks): see healthEngine.js's header.
 *
 * B1939344 (NEW-1) — `name` is the QUALIFIED "<Project> / <Schedule>" label (`crossScheduleLabel`,
 * `src/shared/schedule/scheduleOwnership.js`), not the bare schedule name: two different projects
 * can each hold a schedule named "Master Schedule" (the owner's own account has four), which a bare
 * name can't tell apart. This is the SAME label the Reports tab (public/sequence/index.html) has
 * used since PR 1849 — one shared helper, not a second hand-copy.
 */
import { crossScheduleLabel } from "../../../shared/schedule/scheduleOwnership.js";
import { displayHealth } from "../../../shared/schedule/healthEngine.js";

/** Local "YYYY-MM-DD" for `nowMs` — the same "today" the grid's rule engine is handed. */
function localIso(nowMs) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Leaf tasks only — a summary/parent row's own start/end/health can be a stale rollup, so
 * counting it would double-count (or mis-count) whatever its children already contribute. */
function leafTasks(tasks) {
  const parentIds = new Set();
  for (const t of tasks) { if (t && t.parentId != null) parentIds.add(t.parentId); }
  return tasks.filter((t) => t && !parentIds.has(t.id));
}

/** One project's { complete, overdue, atRisk, onTrack, total }. `nowMs` is injectable for tests;
 * `settings` = the schedule document's settings (its healthRules), the same the grid evaluates. */
export function summarizeProjectHealth(project, nowMs = Date.now(), settings = null) {
  const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
  const leaves = leafTasks(tasks);
  const byId = {}; tasks.forEach((t) => { if (t) byId[t.id] = t; });
  const today = localIso(nowMs);
  let complete = 0, overdue = 0, atRisk = 0, onTrack = 0;
  for (const t of leaves) {
    const h = displayHealth(t, settings || {}, today, byId);
    if (h === "green") complete++;
    else if (h === "red") overdue++;
    else if (h === "yellow") atRisk++;
    else onTrack++;
  }
  return { complete, overdue, atRisk, onTrack, total: leaves.length };
}

/** All projects with at least one task, sorted with the least-healthy (highest overdue share)
 * first — the ones that need a look are the ones worth seeing without scrolling. */
export function summarizeScheduleHealth(projectsMap, nowMs = Date.now(), settings = null) {
  const projects = projectsMap && typeof projectsMap === "object" ? Object.values(projectsMap) : [];
  return projects
    .map((p) => ({
      id: p?.id ?? null,
      name: crossScheduleLabel(p),
      linkedSiteId: p?.linkedSiteId || null,
      ...summarizeProjectHealth(p, nowMs, settings),
    }))
    .filter((p) => p.total > 0)
    .sort((a, b) => (b.overdue / b.total || 0) - (a.overdue / a.total || 0));
}
