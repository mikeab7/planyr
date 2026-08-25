/* Pinch-gesture telemetry (NEW — the iOS pinch-zoom mobile lap).
 *
 * Three pinch fixes had shipped (B554/B555/B331) into a hole where nothing observed the
 * outcome — no event source in `client_errors` recorded touch, pointer, gesture or pinch on
 * any platform. So every "pinch is buggy again" report started from zero: no data to tell a
 * genuine regression from a one-off, and no way to see whether the exact iOS Safari quirk
 * B555 was built around (a spurious pointercancel arriving while a second finger is already
 * down) is still happening in the wild now that touch, not pointer events, owns the gesture.
 *
 * Rides the EXISTING client_errors channel (`reportClientEvent`, source `event:pinch`) — no
 * new table, no new sink, same dedup/rate/session caps and the same fail-safe guarantee
 * (never throws into the app). Every canvas that drives a pinch calls `recordPinchGesture`
 * once per gesture, at the point the gesture ends (or is torn down).
 *
 * SAMPLED: a routine COMPLETED pinch is the overwhelming majority of real gestures — logging
 * every one would flood the table with "worked fine" rows the way B270912's audit found
 * `event:perf` already had. So a completed pinch is recorded at a low sample rate (a rough
 * baseline to compare cancellations against); every CANCELLED gesture and every recorded
 * ANOMALY (see below) is logged unconditionally, because those are rare and are exactly the
 * signal this exists to capture.
 */
import { reportClientEvent } from "./clientErrors.js";

// ~1 in 50 clean completions is recorded — enough for a baseline rate without flooding the table.
export const PINCH_COMPLETE_SAMPLE_RATE = 0.02;

export const PINCH_OUTCOMES = ["completed", "cancelled", "anomaly"];

/* Pure: should this gesture outcome be logged? `rand` is a caller-supplied [0,1) draw (never
 * Math.random() called from in here) so the decision stays pure and unit-testable. */
export function shouldLogPinch(outcome, rand, sampleRate = PINCH_COMPLETE_SAMPLE_RATE) {
  if (outcome !== "completed") return true; // every cancellation / anomaly is rare — always log it
  const r = typeof rand === "number" && Number.isFinite(rand) ? rand : 1; // an unreadable draw never over-samples
  return r < sampleRate;
}

/* Pure: the extra payload attached to the event message. Keeps units/keys stable across the
 * three canvases so the rows can be grouped/queried together. */
export function pinchEventDetail({ surface, eventSource, fingerCount, outcome, cancelReason, durationMs } = {}) {
  const extra = { surface: surface || "unknown", source: eventSource || "touch", fingers: fingerCount || 0, outcome: outcome || "completed" };
  if (outcome && outcome !== "completed" && cancelReason) extra.reason = cancelReason;
  if (Number.isFinite(durationMs) && durationMs >= 0) extra.ms = Math.round(durationMs);
  return extra;
}

/* Record one pinch gesture's outcome. Fire-and-forget, sampled, never throws — reportClientEvent
 * already guarantees that. `rand` lets a caller (or a test) inject the sample draw; production
 * call sites simply omit it and get Math.random(). */
export function recordPinchGesture(fields = {}) {
  try {
    const rand = typeof fields.rand === "number" ? fields.rand : Math.random();
    if (!shouldLogPinch(fields.outcome, rand)) return;
    const detail = pinchEventDetail(fields);
    reportClientEvent("pinch", `${detail.surface} pinch ${detail.outcome}`, detail);
  } catch { /* telemetry must never throw into the app */ }
}
