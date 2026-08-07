/* doubleTap.js — THE reconstructed double-click gesture (NEW-1).
 *
 * ⛔ THE BUDGET IS THE GESTURE'S OWN CLOCK, NEVER THE APP'S RESPONSE TIME.
 *
 * The planner cannot use the browser's native `dblclick` to detect a double-click on a feature:
 * every move handler calls `setPointerCapture` on pointerdown (so a drag survives leaving the SVG),
 * and pointer capture SUPPRESSES the synthetic dblclick on the element. So the pair is
 * reconstructed from two pointerdowns — the same test a native double-click uses: same target,
 * within `DBLTAP_MS`, within `DBLTAP_PX`.
 *
 * The defect this module exists to close (measured on the owner's Bain plan, 2026-08-06): the
 * comparison read `Date.now()` INSIDE THE HANDLER. On a busy plan the handler does not run when
 * the press happens — it runs when the main thread gets around to it. His second pointerdown fired
 * at e.timeStamp 330662 and its handler began at 330969: **307 ms of queueing delay, against a
 * 350 ms budget.** A perfectly ordinary 150 ms double-click therefore measured ~450 ms and was
 * discarded, so a double-click silently did nothing — and the busier the plan, the more often.
 *
 * `e.timeStamp` is stamped by the browser WHEN THE EVENT IS CREATED, so the difference between two
 * of them is the interval between the two PRESSES: the gesture, not our latency. Both events come
 * off the same monotonic clock (`performance.timeOrigin`-relative in every engine we run on), so
 * the subtraction is exact and unaffected by wall-clock adjustment.
 *
 * ⛔ DO NOT "fix" a recurrence of this by raising DBLTAP_MS. That hides the defect (the budget is
 * being spent by the wrong thing) and makes genuinely slow pairs — a deliberate click, pause,
 * click — misfire as an edit. The thresholds below are the native double-click's; leave them.
 *
 * Pure + Node-testable (test/doubleTap.test.js). The planner's `isDoubleTap` is a thin wrapper that
 * reads the event's clock through `tapTime` and keeps ONE record in a ref.
 */

/* The native double-click thresholds: time between presses, and how far the pointer may travel.
 * The distance gate is what stops "click here to select, then press over THERE to drag" misfiring
 * as an edit. */
export const DBLTAP_MS = 350;
export const DBLTAP_PX = 14;

/* The empty record — no press has landed yet. `t: 0` (not -Infinity) so the record is plain JSON
 * and `t` arithmetic never produces NaN; `id: null` is what actually makes it un-pairable. */
export const EMPTY_TAP = Object.freeze({ id: null, t: 0, x: 0, y: 0, wasSel: false });

/* The event's OWN clock, in ms, on the same monotonic timeline for every event in a document.
 *
 * The fallback matters: a hand-constructed event in a unit test (or a synthetic event some harness
 * built without one) can arrive with `timeStamp` undefined or 0. Falling back to `performance.now()`
 * keeps the SAME timeline as a real event's timeStamp — `Date.now()` would not, and mixing the two
 * epochs would make every comparison nonsense. */
export function tapTime(e, now) {
  const t = e ? e.timeStamp : undefined;
  if (typeof t === "number" && Number.isFinite(t) && t > 0) return t;
  if (typeof now === "number") return now;
  /* `typeof` first — `performance` may be UNDECLARED (not merely undefined) in a bare Node context,
   * where touching it directly, optional chaining included, is a ReferenceError. */
  if (typeof performance !== "undefined" && typeof performance?.now === "function") return performance.now();
  return 0;
}

/* Does this press pair with the previous one into a double-tap?
 *
 * `prev` / `next` are tap records: { id, t, x, y }. Same id, inside the time budget, inside the
 * distance budget. A `next.t` BEFORE `prev.t` (clock sources mixed by a caller bug, or two events
 * delivered out of order) is refused rather than treated as a huge gap — refusing is the safe
 * direction: it costs a double-click, it never fires an edit the user did not ask for. */
export function pairsWithLastTap(prev, next, { ms = DBLTAP_MS, px = DBLTAP_PX } = {}) {
  if (!prev || !next) return false;
  if (prev.id == null || next.id == null || prev.id !== next.id) return false;
  const dt = next.t - prev.t;
  if (!(dt >= 0) || !(dt < ms)) return false;
  return Math.abs(next.x - prev.x) <= px && Math.abs(next.y - prev.y) <= px;
}

/* Build the record a press leaves behind.
 *
 * `paired` re-arms to THIS press with `wasSel: true` rather than wiping the record, so a THIRD
 * rapid press (a real "click to select, then immediately double-click", all three inside one
 * window) still has something to pair with — see the SitePlanner call-site comment. */
export function tapRecord(id, t, x, y, wasSel) {
  return { id, t, x, y, wasSel: !!wasSel };
}

/* The whole gesture step in one pure call: given the previous record and this press, return
 * `{ double, record }`. The planner writes `record` back to its ref and branches on `double`. */
export function stepDoubleTap(prev, press, opts) {
  const next = tapRecord(press.id, press.t, press.x, press.y, press.wasSel);
  if (!pairsWithLastTap(prev, next, opts)) return { double: false, record: next };
  return { double: true, record: { ...next, wasSel: true } };
}
