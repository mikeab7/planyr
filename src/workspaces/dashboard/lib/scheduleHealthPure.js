/* scheduleHealthPure.js — pure task classification shared by the "Schedule health" and "Needs an
 * owner" dashboard cards (B1196305, NEW-2). Reads the SAME `planar_data.value.projects` shape the
 * Schedule module itself saves (`public/sequence/index.html`'s own model) — never a second data
 * model. Classification is a deliberate, DOCUMENTED approximation of the Schedule's own richer
 * cascade/float rules (which live entirely inside the walled `public/sequence/index.html` and
 * are not reachable from here): "complete" and "overdue" match the Schedule's own rules exactly
 * (percentComplete >= 100; not complete AND past its end date); "at risk" is a simple due-soon
 * window, not the Schedule's own float-to-deadline cascade — a coarser, honestly-labelled
 * summary is the right scope for a dashboard tile, not a second implementation of the engine.
 */

const AT_RISK_WINDOW_DAYS = 3;

export function isTaskComplete(t) {
  return Number(t && t.percentComplete) >= 100;
}

export function isTaskOverdue(t, todayIso) {
  if (isTaskComplete(t)) return false;
  const end = t && t.end;
  return typeof end === "string" && !!end && end < todayIso;
}

export function isTaskAtRisk(t, todayIso) {
  if (isTaskComplete(t) || isTaskOverdue(t, todayIso)) return false;
  const end = t && t.end;
  if (typeof end !== "string" || !end) return false;
  const endMs = Date.parse(end), todayMs = Date.parse(todayIso);
  if (!isFinite(endMs) || !isFinite(todayMs)) return false;
  const days = Math.round((endMs - todayMs) / 86400000);
  return days >= 0 && days <= AT_RISK_WINDOW_DAYS;
}

export function isUnassigned(t) {
  return !String((t && t.responsibleParty) || "").trim();
}

function todayIsoOf(todayIso) {
  return todayIso || new Date().toISOString().slice(0, 10);
}

/** projectsObj: the raw `planar_data.value.projects` map, `{ [scheduleProjectId]: { id, name, tasks } }`.
 * Returns one row per schedule, worst (most overdue) first. */
export function summarizeScheduleHealth(projectsObj, todayIso) {
  const today = todayIsoOf(todayIso);
  const rows = Object.values(projectsObj || {}).map((proj) => {
    const tasks = Array.isArray(proj && proj.tasks) ? proj.tasks : [];
    let complete = 0, overdue = 0, atRisk = 0;
    for (const t of tasks) {
      if (isTaskComplete(t)) complete++;
      else if (isTaskOverdue(t, today)) overdue++;
      else if (isTaskAtRisk(t, today)) atRisk++;
    }
    return { id: proj && proj.id, name: (proj && proj.name) || "Untitled schedule", taskCount: tasks.length, complete, overdue, atRisk };
  });
  return rows.sort((a, b) => (b.overdue - a.overdue) || (b.atRisk - a.atRisk) || (b.taskCount - a.taskCount));
}

/** Every unassigned, overdue task across every schedule, oldest due date first. */
export function unassignedOverdueTasks(projectsObj, todayIso) {
  const today = todayIsoOf(todayIso);
  const out = [];
  for (const proj of Object.values(projectsObj || {})) {
    const tasks = Array.isArray(proj && proj.tasks) ? proj.tasks : [];
    for (const t of tasks) {
      if (isUnassigned(t) && isTaskOverdue(t, today)) {
        out.push({
          projectId: proj.id, projectName: proj.name || "Untitled schedule",
          taskId: t.id, taskName: t.name || "Untitled task", end: t.end || null,
        });
      }
    }
  }
  return out.sort((a, b) => String(a.end || "").localeCompare(String(b.end || "")));
}
