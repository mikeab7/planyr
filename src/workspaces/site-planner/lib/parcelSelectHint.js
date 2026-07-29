/* NEW-1 — "Select parcels: off" stranded the user: the pure decision for the
 * point-of-failure hint.
 *
 * Background. B311 made parcels click-THROUGH when `settings.parcelSelect` is off — a press on a
 * lot's boundary / setback hit-stroke falls straight through to the background pan, exactly as if
 * it had landed on empty canvas. That is the intended browse/measure behaviour and it stays. What
 * was missing is FEEDBACK: the flag is saved per plan, so it silently persists across sessions and
 * devices, and the only indication was a quiet readout in the header. Clicking a lot did nothing,
 * with no way to tell why from the point of interaction.
 *
 * This module owns the "should we say something?" half so the host stays a thin wire and the rules
 * are unit-testable:
 *   • never when selection is ON (nothing failed),
 *   • never when the press did not actually land on a parcel (empty canvas stays silent),
 *   • at most ONE hint per press gesture — the caller passes a `gestureId` that is stable for one
 *     native pointerdown and different for the next (the event's `timeStamp`). Deliberately NOT
 *     `pointerId`: Chromium reuses id 1 for every mouse press, so keying on it would suppress the
 *     hint forever after the first one,
 *   • and no re-show more than once every `cooldownMs`, so a genuine pan that crosses several lots
 *     (one press, many lots under the cursor) can never turn into a stream of hints.
 *
 * Pure: no DOM, no timers, no clock — the caller passes `now`.
 */

/** How long the hint stays up, and the floor between two showings. */
export const PARCEL_HINT_COOLDOWN_MS = 6000;

/**
 * Decide whether a blocked parcel press should surface the "parcel selection is off" hint.
 *
 * @param {object} input
 * @param {boolean} input.parcelSelect   the live `settings.parcelSelect` value
 * @param {boolean} input.hitParcel      did this press actually land on a parcel hit-stroke?
 * @param {number}  input.now            ms epoch of this press
 * @param {number}  [input.lastShownAt]  ms epoch the hint was last shown (0 / undefined = never)
 * @param {*}       [input.lastGestureId] the gestureId that produced the last hint
 * @param {*}       [input.gestureId]    stable id for THIS press gesture (event.timeStamp)
 * @param {number}  [input.cooldownMs]
 * @returns {{show: boolean, reason: "select-on"|"no-parcel"|"same-gesture"|"cooldown"|"hint"}}
 */
export function parcelSelectHintDecision(input) {
  const {
    parcelSelect,
    hitParcel,
    now,
    lastShownAt = 0,
    lastGestureId = null,
    gestureId = null,
    cooldownMs = PARCEL_HINT_COOLDOWN_MS,
  } = input || {};
  // Selection is on — the press is being handled normally, there is nothing to explain.
  if (parcelSelect) return { show: false, reason: "select-on" };
  // Empty canvas / anything that isn't a parcel: a press there is SUPPOSED to pan. Hinting here
  // would fire on every background pan in the plan.
  if (!hitParcel) return { show: false, reason: "no-parcel" };
  // One hint per press gesture (two hit-strokes of the same lot can't double-fire it).
  if (gestureId != null && lastGestureId != null && gestureId === lastGestureId) {
    return { show: false, reason: "same-gesture" };
  }
  // Rate limit: a pan across a subdivision is one intent, not twenty.
  if (Number.isFinite(lastShownAt) && lastShownAt > 0 && Number.isFinite(now) && now - lastShownAt < cooldownMs) {
    return { show: false, reason: "cooldown" };
  }
  return { show: true, reason: "hint" };
}
