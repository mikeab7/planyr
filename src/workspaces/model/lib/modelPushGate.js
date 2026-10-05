/* modelPushGate — the ONE answer to "may the Model workspace's automatic cloud push run right
 * now?", and the debounced push's body, evaluated at the moment it FIRES.
 *
 * ⛔ V537648 (live production finding, 2026-10-05) — a DIVERGENT local copy was silently pushed
 * over the cloud copy on reload, with no edit by the user; the red "Sync problem" badge showed for
 * under a second and was gone. The exact sequence (ModelApp.jsx, pre-fix):
 *   1. the load effect resets the workbook from the local copy and sets `ready` → the debounced
 *      push effect SCHEDULES an 800 ms timer (a reload always schedules one; no edit is needed);
 *   2. the cloud load resolves, sees local ≠ cloud, sets `cloudVersionRef = N` and
 *      `status = "diverged"`;
 *   3. the timer fires. It never consulted the diverged status (the effect only checked
 *      "not-provisioned", and only at SCHEDULE time, from a stale closure) — so it ran
 *      `setStatus("saving")` (clearing the warning) and a CAS write at the now-CURRENT version N,
 *      which succeeds cleanly: the cloud copy is overwritten and the badge turns green.
 * The CAS guard cannot catch this: nothing raced, the version really is current. Only the content
 * differs — which is exactly what "diverged" means.
 *
 * The fix has three parts, all here so they are unit-testable without a DOM:
 *   - `cloudPushVerdict` is asked at FIRE time (from refs, never a render closure), so a
 *     divergence detected AFTER a push was scheduled still stops it;
 *   - a divergence HOLD (a latch) is the authority, not the `status` string: only the user's own
 *     resolution (or opening a different workbook / a fresh load) releases it, so no later status
 *     write can quietly re-arm the push;
 *   - a push result that lands while the hold is set never overwrites the "diverged" status, so
 *     the warning PERSISTS until the user resolves it (LOUD-FAILURE).
 * Nothing about the non-diverged path changes: with no hold, the verdict and the body behave
 * exactly as the old inline timer did (same statuses, same order, same version bookkeeping).
 */

/** "push" | "hold-diverged" | "skip-not-provisioned". `diverged` is the latch (a ref's value). */
export function cloudPushVerdict({ status, diverged }) {
  if (diverged || status === "diverged") return "hold-diverged";
  if (status === "not-provisioned") return "skip-not-provisioned";
  return "push";
}

/** The debounced push's body. Every input is read at CALL time:
 *   readGate()   → { status, diverged } as of NOW (refs, not a render closure)
 *   save()       → Promise<{ ok, version?, reason? }> (saveCloudSheet / saveOrgWorkbookCloud)
 *   setStatus(s) · onSaved(version) — the caller's own bookkeeping, unchanged from before.
 * Returns the verdict it acted on, so a caller/test can see why nothing was written. */
export async function runCloudPush({ readGate, save, setStatus, onSaved }) {
  const before = cloudPushVerdict(readGate());
  if (before !== "push") return before;
  setStatus("saving");
  const r = await save();
  // A divergence detected while this save was in flight (only reachable as a refused INSERT —
  // a write sent before the cloud load resolved carries `expected: null`, which can never
  // overwrite an existing row) must not have its warning replaced by this result.
  const heldNow = cloudPushVerdict(readGate()) === "hold-diverged";
  if (r && r.ok) {
    onSaved?.(r.version);
    if (!heldNow) setStatus("saved");
  } else if (heldNow) {
    // keep "diverged" on screen — the user has not resolved it yet
  } else if (r && r.reason === "not-provisioned") setStatus("not-provisioned");
  else if (r && r.reason === "conflict") setStatus("conflict");
  else if (r && r.reason === "unavailable") setStatus("idle");
  else setStatus("error");
  return heldNow ? "hold-diverged" : "push";
}

/** What the screen should say. The hold outranks every status except a failed LOCAL write
 *  ("error" from the write-through), which is its own, more urgent, loud failure. */
export function shownModelStatus(status, diverged) {
  if (diverged && status !== "error") return "diverged";
  return status;
}
