/* bootFramingDeadline — HOW LONG HAS *THIS PLAN* BEEN TRYING TO GET ITS FIRST FRAMING?
 *
 * ⛔ WHY THIS EXISTS. B1574432 hid the planner canvas until a framing had been computed, and backed
 * that with a 1.5 s watchdog that revealed the drawing anyway. The watchdog's `setTimeout` lived in
 * an effect scoped to ONE MOUNT (`[framingCommitted, active]`), so a remount tore it down and
 * recreated it from zero. A signed-in boot remounts the planner by construction — `SitePlannerApp`
 * keys it `${activeSiteId}:${loadEpoch}` and `applyUser` bumps `loadEpoch` when the cloud pull
 * settles — so "1.5 seconds" was really "1.5 seconds since the most recent remount", and a
 * repeating remount could postpone the reveal indefinitely. That is the structural weakness
 * docs/incidents/B1594320-CANVAS-VISIBILITY-OUTAGE.md names as requirement #2 for re-attempting the
 * gate at all, and #1686's per-mount deadline is explicitly NOT good enough for it.
 *
 * THE FIX IS A DEADLINE THAT IS ABSOLUTE AND OUTLIVES THE COMPONENT. The first mount to ask about a
 * plan stamps the wall clock; every later mount for that same plan is handed the SAME deadline and
 * therefore arms a timer for the time REMAINING, not a fresh full window. A remount cannot restart
 * the clock because the clock is not stored in the thing that remounts.
 *
 * ⛔ WHY MODULE STATE AND NOT `sessionStorage`, which the incident doc offers as the other option.
 * `sessionStorage` survives a RELOAD, which is precisely wrong here: a genuine second cold load in
 * the same tab would read a stamp minutes old, compute a deadline already in the past, and reveal
 * instantly — i.e. the gate would silently stop working after the first load of a tab's life, with
 * the flash back and nothing saying so. Module scope is re-created by every document load, so the
 * window is per-LOAD (which is what "one framing per load" is about) and per-PLAN, and it still
 * outlives any number of remounts of `SitePlanner` — and of `SitePlannerApp` above it.
 *
 * Per-PLAN rather than global on purpose: opening a different project is a new thing being loaded
 * and deserves its own window. Coming BACK to a plan does not — its deadline was stamped the first
 * time and is not reset, so alternating between two plans cannot postpone either one's reveal.
 */

/** The reveal ceiling. Long enough that a healthy-but-slow boot frames normally first; short enough
 *  that nobody sits looking at a blank sheet. Deliberately far shorter than the framing RETRY bound
 *  (`BOOT_FRAMING_RETRY_MS`, 10 s): a late flash on a pathological boot is a much smaller defect
 *  than ten seconds of blank canvas, and "never blank" is the lesson this whole family paid for. */
export const BOOT_FRAMING_CEILING_MS = 1500;

/** The slot a null/absent plan id shares. A plain string, never a real id (ids are base36). */
const NO_PLAN = "(no-plan)";

/** siteId → the wall-clock ms at which this plan first asked. Module scope: per document load. */
const stamps = new Map();

/**
 * The absolute wall-clock deadline by which this plan's canvas must be revealed, framed or not.
 * Stamps on first ask and returns the same answer for every later ask, so a remount inherits the
 * elapsed time instead of resetting it.
 *
 * @param {string|null|undefined} siteId  the plan being framed
 * @param {number} [now]                  injectable clock, for tests
 * @returns {number} absolute ms timestamp
 */
export function bootFramingDeadlineAt(siteId, now = Date.now()) {
  const k = siteId == null || siteId === "" ? NO_PLAN : String(siteId);
  if (!stamps.has(k)) stamps.set(k, now);
  return stamps.get(k) + BOOT_FRAMING_CEILING_MS;
}

/** Ms remaining before the ceiling, floored at 0 (an already-expired deadline fires immediately). */
export function bootFramingRemainingMs(siteId, now = Date.now()) {
  return Math.max(0, bootFramingDeadlineAt(siteId, now) - now);
}

/** Test-only: forget every stamp, so one test's clock cannot leak into the next. */
export function resetBootFramingDeadlines() {
  stamps.clear();
}
