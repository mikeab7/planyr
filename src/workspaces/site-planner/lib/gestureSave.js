/* gestureSave — when may the whole-plan autosave be put off? (NEW-1, B217540 recurrence ×2). Pure, no React.
 *
 * ⛔ THE RULE. A gesture in flight (a drag, a resize, a vertex pull) changes the model on EVERY pointer-move frame,
 * and the autosave effect used to run the whole persistence stack — parse the entire device store, re-normalise the
 * plan, stringify and `setItem` the entire store, read it back — on every one of them (≥ every 50 ms). The cost of
 * that scales with everything ELSE stored on the device, not with the plan being edited, which is why the same drag
 * cost 1.0 s on an empty store, 2.4 s at 1.3 MB and 3.7 s at 3 MB (ui-audit/perf-edit-cycle.mjs). So a save is put
 * off while a gesture is active and taken the moment it ends.
 *
 * ⛔ THE LIMIT IS PART OF THE RULE, not a tuning knob. Autosave is the recovery net (B458: "a reload within 400 ms
 * must still find this edit"), and a `drag.current` that never clears — a lost pointer-up, a stuck capture — would
 * otherwise switch it off for as long as the tab lives, with nothing on screen to say so. So a deferral expires
 * after `GESTURE_SAVE_DEFER_MAX_MS`: past it the ordinary save runs even though the gesture is still active, which
 * doubles as the crash-safety write for a very long drag. The unload flush still writes the live state on its own.
 */
export const GESTURE_SAVE_DEFER_MAX_MS = 5000;
export const GESTURE_SAVE_POLL_MS = 120;

/** @param since the time the current deferral began (0 = none yet)  @param now the current time
 *  @returns "defer" while a gesture may still hold the save off, "write" once the limit is reached */
export function deferSaveDecision(since, now) {
  if (!since) return "defer";                                     // the first frame of a deferral
  return now - since < GESTURE_SAVE_DEFER_MAX_MS ? "defer" : "write";
}
