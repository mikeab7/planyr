/* B2429233 — a schedule delete verifies its own result. The shell posts `planar:nav-delete` to the
 * embedded app and has no reply channel for it, so a delete the embedded app refused (or lost) used
 * to end with the confirm closing and nothing else. The embedded app's next `planar:nav-state` is
 * the truth: if the schedule is no longer in that list the delete worked; if it is still there after
 * DELETE_VERIFY_MS, say so. Pure so it is unit-tested; Scheduler.jsx owns the timer and the notice. */
export const DELETE_VERIFY_MS = 6000;

export function deleteStillPresent(projects, id) {
  return Array.isArray(projects) && projects.some((p) => p && p.id === id);
}

export function deleteFailureMessage(name) {
  const label = typeof name === "string" && name.trim() ? `“${name.trim()}”` : "That schedule";
  return `${label} could not be deleted — it is still there. Try again; if it keeps happening, reload the page.`;
}
